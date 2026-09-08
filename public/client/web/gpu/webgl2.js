/**
 * WebGL2 backend.
 *
 * Everything the WebGPU backend does, on the API almost every browser has. The differences are in
 * the details rather than the capability: there is no `bgra8unorm`, so the client's B,G,R,A bytes are
 * uploaded as RGBA and swizzled in the shader instead, and GLSL ES has no `noperspective`, so the
 * desktop renderer's one qualifier that does not exist here is dropped.
 */
(function () {
    'use strict';

    function compile(gl, type, source) {
        const shader = gl.createShader(type);

        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const log = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error('shader: ' + log);
        }

        return shader;
    }

    /** Renderer switches for bringing the scene up: ?gpuNoCull=1, ?gpuNoDepth=1. */
    const params = new URLSearchParams(window.location.search);
    const debug = { cull: params.get('gpuNoCull') !== '1', depth: params.get('gpuNoDepth') !== '1' };

    /** As many ranges as one zone can need; the renderer merges adjacent ones before sending them. */
    const MAX_RANGES = 256;

    function create() {
        let gl = null;
        let program = null;
        let texture = null;
        let vao = null;
        let textureWidth = 0;
        let textureHeight = 0;
        let canvas = null;
        let multiDraw = null;
        let anisotropy = null;

        // Scene state.
        let sceneProgram = null;
        let dynamicVao = null;
        let positionBuffer = null;
        let colourBuffer = null;
        let textureBuffer = null;
        let uvBuffer = null;
        let sceneCapacity = 0;
        let dynamicVertices = 0;
        let uniform = {};
        let sceneFbo = null;
        let sceneColour = null;
        let sceneDepth = null;
        let resolveFbo = null;
        let resolveColour = null;
        let sceneTargetWidth = 0;
        let sceneTargetHeight = 0;
        let sceneSamples = -1;
        let sceneDrawn = false;
        let sceneReady = false;
        let textureArray = null;
        let textureSize = 0;
        let animationTexture = null;
        let mipmapsStale = false;
        let elementBuffer = null;
        let overlay = 0;

        // The frame's transparent moving geometry, and the vertex array that reads it.
        let alphaVao = null;
        let alphaPosition = null;
        let alphaColour = null;
        let alphaTexture = null;
        let alphaUv = null;
        let alphaCapacity = 0;
        let alphaVertices = 0;

        /** Static geometry, one entry per zone, kept until the client says the zone changed. */
        const zones = new Map();

        const rangeFirsts = new Int32Array(MAX_RANGES);
        const rangeCounts = new Int32Array(MAX_RANGES);

        /**
         * The scene's render target.
         *
         * Multisampled when antialiasing is on, which means the scene is drawn into renderbuffers and
         * then resolved into a plain texture for the interface pass to read — a multisample buffer
         * cannot be sampled directly. With antialiasing off there is one target and no resolve.
         */
        function ensureSceneTarget() {
            const settings = window.WebGpuScene.settings;
            const wanted = Math.min(
                window.WebGpuScene.samples[settings.antiAliasingMode] || 0,
                gl.getParameter(gl.MAX_SAMPLES));

            if (sceneFbo
                && sceneTargetWidth === canvas.width
                && sceneTargetHeight === canvas.height
                && sceneSamples === wanted) {
                return;
            }

            releaseSceneTarget();

            sceneTargetWidth = canvas.width;
            sceneTargetHeight = canvas.height;
            sceneSamples = wanted;

            // What the interface pass samples: always a plain texture, whatever the scene drew into.
            resolveColour = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, resolveColour);
            gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, sceneTargetWidth, sceneTargetHeight);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

            resolveFbo = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, resolveFbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, resolveColour, 0);

            sceneDepth = gl.createRenderbuffer();
            gl.bindRenderbuffer(gl.RENDERBUFFER, sceneDepth);
            gl.renderbufferStorageMultisample(
                gl.RENDERBUFFER, sceneSamples, gl.DEPTH_COMPONENT24, sceneTargetWidth, sceneTargetHeight);

            if (sceneSamples > 0) {
                sceneColour = gl.createRenderbuffer();
                gl.bindRenderbuffer(gl.RENDERBUFFER, sceneColour);
                gl.renderbufferStorageMultisample(
                    gl.RENDERBUFFER, sceneSamples, gl.RGBA8, sceneTargetWidth, sceneTargetHeight);

                sceneFbo = gl.createFramebuffer();
                gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
                gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, sceneColour);
            } else {
                sceneFbo = resolveFbo;
                gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
            }

            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, sceneDepth);

            const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);

            gl.bindFramebuffer(gl.FRAMEBUFFER, null);

            if (status !== gl.FRAMEBUFFER_COMPLETE) {
                console.warn('[gpu] scene target incomplete (' + status + '), dropping antialiasing');

                if (sceneSamples > 0) {
                    releaseSceneTarget();
                    window.WebGpuScene.settings.antiAliasingMode = 'DISABLED';
                    ensureSceneTarget();
                }
            }
        }

        function releaseSceneTarget() {
            if (sceneFbo && sceneFbo !== resolveFbo) {
                gl.deleteFramebuffer(sceneFbo);
            }

            if (resolveFbo) {
                gl.deleteFramebuffer(resolveFbo);
            }

            if (sceneColour) {
                gl.deleteRenderbuffer(sceneColour);
            }

            if (resolveColour) {
                gl.deleteTexture(resolveColour);
            }

            if (sceneDepth) {
                gl.deleteRenderbuffer(sceneDepth);
            }

            sceneFbo = resolveFbo = sceneColour = resolveColour = sceneDepth = null;
        }

        /** Copies a multisampled scene down to the texture the interface pass reads. */
        function resolveScene() {
            if (sceneSamples <= 0 || !sceneFbo || sceneFbo === resolveFbo) {
                return;
            }

            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sceneFbo);
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, resolveFbo);
            gl.blitFramebuffer(
                0, 0, sceneTargetWidth, sceneTargetHeight,
                0, 0, sceneTargetWidth, sceneTargetHeight,
                gl.COLOR_BUFFER_BIT, gl.NEAREST);
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
        }

        /** Points a vertex array at four buffers in the layout both shaders expect. */
        function bindAttributes(target) {
            gl.bindBuffer(gl.ARRAY_BUFFER, target.positions);
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, target.colours);
            gl.enableVertexAttribArray(1);
            // An integer attribute, not a normalised float: the colour is a bit field, and reading it
            // as a float would round the hue away.
            gl.vertexAttribIPointer(1, 1, gl.INT, 0, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, target.textures);
            gl.enableVertexAttribArray(2);
            gl.vertexAttribIPointer(2, 1, gl.INT, 0, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, target.uvs);
            gl.enableVertexAttribArray(3);
            gl.vertexAttribPointer(3, 2, gl.FLOAT, false, 0, 0);
        }

        function ensureDynamicCapacity(vertices) {
            if (vertices <= sceneCapacity) {
                return;
            }

            // Doubling, and never shrinking: the number of models on screen settles at a size and
            // reallocating every frame is worse than holding the memory.
            sceneCapacity = Math.max(sceneCapacity * 2, vertices, window.WebGpuScene.initialVertices);

            gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, sceneCapacity * 12, gl.STREAM_DRAW);

            gl.bindBuffer(gl.ARRAY_BUFFER, colourBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, sceneCapacity * 4, gl.STREAM_DRAW);

            gl.bindBuffer(gl.ARRAY_BUFFER, textureBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, sceneCapacity * 4, gl.STREAM_DRAW);

            gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, sceneCapacity * 8, gl.STREAM_DRAW);
        }

        function ensureAlphaCapacity(vertices) {
            if (vertices <= alphaCapacity) {
                return;
            }

            alphaCapacity = Math.max(alphaCapacity * 2, vertices, 16384);

            gl.bindBuffer(gl.ARRAY_BUFFER, alphaPosition);
            gl.bufferData(gl.ARRAY_BUFFER, alphaCapacity * 12, gl.STREAM_DRAW);

            gl.bindBuffer(gl.ARRAY_BUFFER, alphaColour);
            gl.bufferData(gl.ARRAY_BUFFER, alphaCapacity * 4, gl.STREAM_DRAW);

            gl.bindBuffer(gl.ARRAY_BUFFER, alphaTexture);
            gl.bufferData(gl.ARRAY_BUFFER, alphaCapacity * 4, gl.STREAM_DRAW);

            gl.bindBuffer(gl.ARRAY_BUFFER, alphaUv);
            gl.bufferData(gl.ARRAY_BUFFER, alphaCapacity * 8, gl.STREAM_DRAW);
        }

        /** Issues a set of vertex ranges, in one call where the extension allows it. */
        function drawRanges(ranges, count) {
            let vertices = 0;

            for (let i = 0; i < count && i < MAX_RANGES; i++) {
                rangeFirsts[i] = ranges[i * 2];
                rangeCounts[i] = ranges[i * 2 + 1];
                vertices += rangeCounts[i];
            }

            const issued = Math.min(count, MAX_RANGES);

            if (multiDraw) {
                multiDraw.multiDrawArraysWEBGL(gl.TRIANGLES, rangeFirsts, 0, rangeCounts, 0, issued);
            } else {
                for (let i = 0; i < issued; i++) {
                    gl.drawArrays(gl.TRIANGLES, rangeFirsts[i], rangeCounts[i]);
                }
            }

            return vertices;
        }

        function ensureTexture(width, height) {
            if (texture && textureWidth === width && textureHeight === height) {
                return;
            }

            // A new texture object every time, not a resize of the old one. `texStorage2D` allocates
            // immutable storage, and calling it a second time on a texture that already has some is
            // an error the driver reports and otherwise ignores — which left the interface stuck at
            // whatever size it was first given. Switching to resizable mode is exactly that case.
            if (texture) {
                gl.deleteTexture(texture);
            }

            texture = gl.createTexture();

            gl.bindTexture(gl.TEXTURE_2D, texture);
            // Immutable storage: the size is fixed until the canvas changes, and texSubImage into it
            // is the cheapest per-frame upload WebGL2 offers.
            gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

            textureWidth = width;
            textureHeight = height;
        }

        /** Builds the scene pipeline; the interface pipeline is already up by the time this runs. */
        function initScene() {
            const scene = window.WebGpuScene;

            if (!scene) {
                return;
            }

            const shaders = window.WebGpuShaders;
            const vertex = compile(gl, gl.VERTEX_SHADER, shaders.get('vert.glsl'));
            const fragment = compile(gl, gl.FRAGMENT_SHADER, shaders.get('frag.glsl'));

            sceneProgram = gl.createProgram();
            gl.attachShader(sceneProgram, vertex);
            gl.attachShader(sceneProgram, fragment);
            gl.linkProgram(sceneProgram);

            if (!gl.getProgramParameter(sceneProgram, gl.LINK_STATUS)) {
                throw new Error('scene link: ' + gl.getProgramInfoLog(sceneProgram));
            }

            gl.deleteShader(vertex);
            gl.deleteShader(fragment);

            for (const name of ['uProjection', 'uCameraX', 'uCameraZ', 'uDrawDistance', 'uFogDepth', 'uUseFog',
                'uExpandedChunks', 'uTick', 'uBrightness', 'uSmoothBanding', 'uTextureLightMode', 'uFogColour',
                'uColourblindMode', 'uColourblindIntensity', 'uTint']) {
                uniform[name] = gl.getUniformLocation(sceneProgram, name);
            }

            positionBuffer = gl.createBuffer();
            colourBuffer = gl.createBuffer();
            textureBuffer = gl.createBuffer();
            uvBuffer = gl.createBuffer();
            dynamicVao = gl.createVertexArray();

            gl.bindVertexArray(dynamicVao);
            bindAttributes({ positions: positionBuffer, colours: colourBuffer, textures: textureBuffer, uvs: uvBuffer });
            gl.bindVertexArray(null);

            alphaPosition = gl.createBuffer();
            alphaColour = gl.createBuffer();
            alphaTexture = gl.createBuffer();
            alphaUv = gl.createBuffer();
            alphaVao = gl.createVertexArray();

            gl.bindVertexArray(alphaVao);
            bindAttributes({ positions: alphaPosition, colours: alphaColour, textures: alphaTexture, uvs: alphaUv });
            gl.bindVertexArray(null);

            // Sorted transparent geometry is drawn by index rather than by range: the faces of one
            // model end up in an order that has nothing to do with the order they were uploaded in.
            elementBuffer = gl.createBuffer();

            gl.useProgram(sceneProgram);
            gl.uniform1i(gl.getUniformLocation(sceneProgram, 'uTextures'), 2);
            gl.uniform1i(gl.getUniformLocation(sceneProgram, 'uTextureAnim'), 3);

            // A texture with no animation until the client's own arrives, so the first frames have
            // something to sample.
            animationTexture = gl.createTexture();
            gl.activeTexture(gl.TEXTURE3);
            gl.bindTexture(gl.TEXTURE_2D, animationTexture);
            gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG32F, 1, 1);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

            ensureDynamicCapacity(scene.initialVertices);
            ensureAlphaCapacity(16384);

            sceneReady = true;
            scene.attach(backendApi);
        }

        /** Frees a zone's buffers. Zones come and go as the player walks; nothing here is permanent. */
        function destroyZone(zone) {
            releaseChannels(zone.opaque);
            releaseChannels(zone.alpha);
        }

        function releaseChannels(channels) {
            if (!channels) {
                return;
            }

            gl.deleteVertexArray(channels.vao);
            gl.deleteBuffer(channels.positions);
            gl.deleteBuffer(channels.colours);
            gl.deleteBuffer(channels.textures);
            gl.deleteBuffer(channels.uvs);
        }

        /**
         * Uploads one set of four channels and wires a vertex array to them.
         *
         * Written once and read every frame after, which is exactly what STATIC_DRAW means.
         */
        function createChannels(positions, colours, textures, uvs, vertexCount) {
            const channels = {
                vao: gl.createVertexArray(),
                positions: gl.createBuffer(),
                colours: gl.createBuffer(),
                textures: gl.createBuffer(),
                uvs: gl.createBuffer(),
                count: vertexCount,
            };

            gl.bindBuffer(gl.ARRAY_BUFFER, channels.positions);
            gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW, 0, vertexCount * 3);

            gl.bindBuffer(gl.ARRAY_BUFFER, channels.colours);
            gl.bufferData(gl.ARRAY_BUFFER, colours, gl.STATIC_DRAW, 0, vertexCount);

            gl.bindBuffer(gl.ARRAY_BUFFER, channels.textures);
            gl.bufferData(gl.ARRAY_BUFFER, textures, gl.STATIC_DRAW, 0, vertexCount);

            gl.bindBuffer(gl.ARRAY_BUFFER, channels.uvs);
            gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW, 0, vertexCount * 2);

            gl.bindVertexArray(channels.vao);
            bindAttributes(channels);
            gl.bindVertexArray(null);

            return channels;
        }

        const backendApi = {
            name: 'webgl2',

            async init(target) {
                gl = target.getContext('webgl2', {
                    alpha: false,
                    antialias: false,
                    depth: true,
                    stencil: false,
                    desynchronized: true,
                    powerPreference: 'high-performance',
                    preserveDrawingBuffer: false,
                });

                if (!gl) {
                    return false;
                }

                canvas = target;
                // One call for a zone's ranges instead of one per range. Widely available, and the
                // loop below is the same drawing when it is not.
                multiDraw = gl.getExtension('WEBGL_multi_draw');
                anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');

                // Float textures are only needed for the per-texture scroll table, which is tiny.
                gl.getExtension('OES_texture_float_linear');

                const shaders = window.WebGpuShaders;
                const vertex = compile(gl, gl.VERTEX_SHADER, shaders.get('vertui.glsl'));
                const fragment = compile(gl, gl.FRAGMENT_SHADER, shaders.get('fragui.glsl'));

                program = gl.createProgram();
                gl.attachShader(program, vertex);
                gl.attachShader(program, fragment);
                gl.linkProgram(program);

                if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
                    throw new Error('link: ' + gl.getProgramInfoLog(program));
                }

                gl.deleteShader(vertex);
                gl.deleteShader(fragment);

                // Drawing with no attributes still needs a bound VAO in WebGL2.
                vao = gl.createVertexArray();

                gl.useProgram(program);
                gl.uniform1i(gl.getUniformLocation(program, 'uUi'), 0);
                gl.uniform1i(gl.getUniformLocation(program, 'uScene'), 1);

                for (const name of ['uHasScene', 'uSampling', 'uSourceDimensions', 'uTargetDimensions',
                    'uOverlay', 'uUiColourblindMode', 'uUiColourblindIntensity']) {
                    uniform[name] = gl.getUniformLocation(program, name);
                }

                target.addEventListener('webglcontextlost', (e) => {
                    e.preventDefault();
                    console.error('[gpu] WebGL context lost');
                });

                initScene();

                return true;
            },

            uploadUi(pixels, width, height) {
                ensureTexture(width, height);

                const bytes = new Uint8Array(pixels.buffer, pixels.byteOffset, width * height * 4);

                gl.bindTexture(gl.TEXTURE_2D, texture);
                gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);

                return bytes.byteLength;
            },

            // --- scene ---------------------------------------------------

            beginScene(matrix, x, y, width, height, frame) {
                if (!sceneReady) {
                    return;
                }

                dynamicVertices = 0;
                sceneDrawn = false;

                ensureSceneTarget();
                gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);

                gl.viewport(0, 0, canvas.width, canvas.height);
                gl.clearColor(0, 0, 0, 1);
                // Reversed depth: the projection puts 1/z in the buffer, so nearer is greater.
                gl.clearDepth(0);
                gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

                gl.enable(gl.DEPTH_TEST);
                gl.depthFunc(gl.GREATER);
                gl.depthMask(true);
                gl.disable(gl.BLEND);

                // Culling and depth can be turned off from the URL while the renderer is being
                // brought up: a black screen is either winding or depth, and this says which.
                if (debug.cull) {
                    gl.enable(gl.CULL_FACE);
                    gl.cullFace(gl.BACK);
                    // The projection's negative Y flips winding, so front faces are the GL default.
                    gl.frontFace(gl.CCW);
                } else {
                    gl.disable(gl.CULL_FACE);
                }

                if (!debug.depth) {
                    gl.disable(gl.DEPTH_TEST);
                }

                const settings = frame.settings;
                const sky = frame.fogColour;

                gl.useProgram(sceneProgram);
                gl.uniformMatrix4fv(uniform.uProjection, false, matrix);
                gl.uniform1f(uniform.uCameraX, frame.cameraX);
                gl.uniform1f(uniform.uCameraZ, frame.cameraZ);
                gl.uniform1i(uniform.uDrawDistance, frame.drawDistance);
                gl.uniform1i(uniform.uExpandedChunks, frame.expandedChunks);
                gl.uniform1i(uniform.uTick, frame.tick);
                gl.uniform1f(uniform.uBrightness, frame.brightness);
                gl.uniform1i(uniform.uFogDepth, settings.fogDepth);
                gl.uniform1i(uniform.uUseFog, settings.fogDepth > 0 ? 1 : 0);
                gl.uniform4f(uniform.uFogColour, ((sky >> 16) & 0xFF) / 255, ((sky >> 8) & 0xFF) / 255, (sky & 0xFF) / 255, 1);
                // The uniform is the inverse of the setting: it is how much banding to keep.
                gl.uniform1f(uniform.uSmoothBanding, settings.smoothBanding ? 0 : 1);
                gl.uniform1f(uniform.uTextureLightMode, settings.brightTextures ? 1 : 0);
                gl.uniform1i(uniform.uColourblindMode, window.WebGpuScene.colourblind[settings.colorBlindMode] || 0);
                gl.uniform1f(uniform.uColourblindIntensity, settings.colorBlindIntensity);
                gl.uniform4i(uniform.uTint, 0, 0, 0, 0);

                if (textureArray) {
                    gl.activeTexture(gl.TEXTURE2);
                    gl.bindTexture(gl.TEXTURE_2D_ARRAY, textureArray);

                    if (mipmapsStale) {
                        gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
                        mipmapsStale = false;
                    }
                }

                if (animationTexture) {
                    gl.activeTexture(gl.TEXTURE3);
                    gl.bindTexture(gl.TEXTURE_2D, animationTexture);
                }

                // The world occupies a rectangle inside the canvas; in fixed mode the interface is
                // drawn around it.
                gl.viewport(x, canvas.height - y - height, width, height);
            },

            uploadZone(id, positions, colours, textures, uvs, vertexCount) {
                const zone = zones.get(id) || {};

                releaseChannels(zone.opaque);
                zone.opaque = createChannels(positions, colours, textures, uvs, vertexCount);
                zones.set(id, zone);
            },

            uploadZoneAlpha(id, positions, colours, textures, uvs, vertexCount) {
                const zone = zones.get(id) || {};

                releaseChannels(zone.alpha);
                zone.alpha = createChannels(positions, colours, textures, uvs, vertexCount);
                zones.set(id, zone);
            },

            drawZone(id, ranges, count) {
                const zone = zones.get(id);

                if (!sceneReady || !zone || !zone.opaque) {
                    return 0;
                }

                gl.bindVertexArray(zone.opaque.vao);

                const vertices = drawRanges(ranges, count);

                sceneDrawn = true;

                return vertices;
            },

            // --- the alpha pass ------------------------------------------

            beginAlphaPass(hue, saturation, luminance, amount) {
                if (!sceneReady) {
                    return;
                }

                gl.useProgram(sceneProgram);
                gl.uniform4i(uniform.uTint, hue, saturation, luminance, amount);

                // Blending on, depth writes off. The depth test stays, so a translucent face is still
                // hidden by solid geometry in front of it; it just no longer hides its own neighbours.
                gl.enable(gl.BLEND);
                gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
                gl.depthMask(false);
            },

            setDynamicAlpha(positions, colours, textures, uvs, vertexCount) {
                if (!sceneReady) {
                    return;
                }

                ensureAlphaCapacity(vertexCount);

                gl.bindBuffer(gl.ARRAY_BUFFER, alphaPosition);
                gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions, 0, vertexCount * 3);

                gl.bindBuffer(gl.ARRAY_BUFFER, alphaColour);
                gl.bufferSubData(gl.ARRAY_BUFFER, 0, colours, 0, vertexCount);

                gl.bindBuffer(gl.ARRAY_BUFFER, alphaTexture);
                gl.bufferSubData(gl.ARRAY_BUFFER, 0, textures, 0, vertexCount);

                gl.bindBuffer(gl.ARRAY_BUFFER, alphaUv);
                gl.bufferSubData(gl.ARRAY_BUFFER, 0, uvs, 0, vertexCount * 2);

                alphaVertices = vertexCount;
            },

            drawZoneAlphaRanges(id, ranges, count) {
                const zone = zones.get(id);

                if (!sceneReady || !zone || !zone.alpha) {
                    return 0;
                }

                gl.bindVertexArray(zone.alpha.vao);

                return drawRanges(ranges, count);
            },

            drawZoneAlphaIndexed(id, indices, count) {
                const zone = zones.get(id);

                if (!sceneReady || !zone || !zone.alpha) {
                    return 0;
                }

                gl.bindVertexArray(zone.alpha.vao);
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elementBuffer);
                gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STREAM_DRAW, 0, count);
                gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, 0);
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

                return count;
            },

            drawDynamicAlpha(ranges, count) {
                if (!sceneReady || alphaVertices === 0) {
                    return 0;
                }

                gl.bindVertexArray(alphaVao);

                return drawRanges(ranges, count);
            },

            freeZone(id) {
                const zone = zones.get(id);

                if (zone) {
                    destroyZone(zone);
                    zones.delete(id);
                }
            },

            resetZones() {
                for (const zone of zones.values()) {
                    destroyZone(zone);
                }

                zones.clear();
            },

            addGeometry(positions, colours, textures, uvs, vertexCount, offset) {
                if (!sceneReady) {
                    return;
                }

                ensureDynamicCapacity(dynamicVertices + vertexCount);

                gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
                gl.bufferSubData(gl.ARRAY_BUFFER, dynamicVertices * 12, positions, offset * 3, vertexCount * 3);

                gl.bindBuffer(gl.ARRAY_BUFFER, colourBuffer);
                gl.bufferSubData(gl.ARRAY_BUFFER, dynamicVertices * 4, colours, offset, vertexCount);

                gl.bindBuffer(gl.ARRAY_BUFFER, textureBuffer);
                gl.bufferSubData(gl.ARRAY_BUFFER, dynamicVertices * 4, textures, offset, vertexCount);

                gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
                gl.bufferSubData(gl.ARRAY_BUFFER, dynamicVertices * 8, uvs, offset * 2, vertexCount * 2);

                dynamicVertices += vertexCount;
            },

            /** One array, one layer per texture: a face carries its id and the shader reads it. */
            createTextureArray(count, size) {
                if (textureArray) {
                    gl.deleteTexture(textureArray);
                }

                textureSize = size;
                textureArray = gl.createTexture();

                gl.activeTexture(gl.TEXTURE2);
                gl.bindTexture(gl.TEXTURE_2D_ARRAY, textureArray);
                // Eight levels covers 128x128 down to one pixel; without them a textured floor
                // shimmers as the camera moves.
                gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 8, gl.RGBA8, size, size, count);
                gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
                gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
                gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);

                this.configure(window.WebGpuScene.settings);
            },

            uploadTexture(layer, pixels) {
                if (!textureArray) {
                    return;
                }

                // The client's pixels are 0xAARRGGBB, which in memory is B,G,R,A — and it leaves
                // alpha at zero for the parts it means to be transparent, marking them by colour.
                const size = textureSize;
                const bytes = new Uint8Array(size * size * 4);
                const source = new Uint8Array(pixels.buffer, pixels.byteOffset, size * size * 4);

                for (let i = 0; i < size * size; i++) {
                    const at = i * 4;
                    const opaque = source[at] || source[at + 1] || source[at + 2];

                    bytes[at] = source[at + 2];
                    bytes[at + 1] = source[at + 1];
                    bytes[at + 2] = source[at];
                    bytes[at + 3] = opaque ? 255 : 0;
                }

                gl.activeTexture(gl.TEXTURE2);
                gl.bindTexture(gl.TEXTURE_2D_ARRAY, textureArray);
                gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);

                // Mipmaps are rebuilt once for the frame, not once per texture: the client hands over
                // every texture that has arrived in one go, and each rebuild covers the whole array.
                mipmapsStale = true;
            },

            uploadTextureAnimations(animations, count) {
                if (!animationTexture) {
                    return;
                }

                gl.deleteTexture(animationTexture);
                animationTexture = gl.createTexture();

                gl.activeTexture(gl.TEXTURE3);
                gl.bindTexture(gl.TEXTURE_2D, animationTexture);
                gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG32F, count, 1);
                gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, count, 1, gl.RG, gl.FLOAT, animations, 0);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            },

            /** Settings that change GPU state rather than a uniform. */
            configure(settings) {
                if (anisotropy && textureArray) {
                    const max = gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT);

                    gl.activeTexture(gl.TEXTURE2);
                    gl.bindTexture(gl.TEXTURE_2D_ARRAY, textureArray);
                    gl.texParameterf(
                        gl.TEXTURE_2D_ARRAY,
                        anisotropy.TEXTURE_MAX_ANISOTROPY_EXT,
                        Math.min(max, Math.max(1, settings.anisotropicFilteringLevel)));
                }
            },

            /** Draws the frame's solid moving models, closing the opaque half of the frame. */
            drawDynamic() {
                if (!sceneReady || dynamicVertices === 0) {
                    return 0;
                }

                gl.bindVertexArray(dynamicVao);
                gl.drawArrays(gl.TRIANGLES, 0, dynamicVertices);

                const vertices = dynamicVertices;

                dynamicVertices = 0;
                sceneDrawn = true;

                return vertices;
            },

            setOverlay(colour) {
                overlay = colour;
            },

            endScene() {
                if (!sceneReady) {
                    return;
                }

                gl.bindVertexArray(null);
                gl.disable(gl.BLEND);
                gl.depthMask(true);

                resolveScene();

                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                gl.disable(gl.DEPTH_TEST);
                gl.disable(gl.CULL_FACE);
            },

            present() {
                if (!texture) {
                    return 0;
                }

                const settings = window.WebGpuScene.settings;
                const sampling = window.WebGpuScene.sampling;
                const mode = sampling[settings.uiScalingMode] === undefined
                    ? sampling.HYBRID
                    : sampling[settings.uiScalingMode];

                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                gl.viewport(0, 0, canvas.width, canvas.height);
                gl.disable(gl.DEPTH_TEST);
                gl.disable(gl.BLEND);

                // One pass, two textures: the world underneath, the interface over it, composited by
                // the interface's own alpha.
                gl.useProgram(program);
                gl.uniform1f(uniform.uHasScene, sceneDrawn ? 1.0 : 0.0);
                gl.uniform1i(uniform.uSampling, mode);
                gl.uniform2i(uniform.uSourceDimensions, textureWidth, textureHeight);
                gl.uniform2i(uniform.uTargetDimensions, canvas.width, canvas.height);
                gl.uniform4f(uniform.uOverlay,
                    ((overlay >> 16) & 0xFF) / 255,
                    ((overlay >> 8) & 0xFF) / 255,
                    (overlay & 0xFF) / 255,
                    ((overlay >>> 24) & 0xFF) / 255);
                gl.uniform1i(uniform.uUiColourblindMode, window.WebGpuScene.colourblind[settings.colorBlindMode] || 0);
                gl.uniform1f(uniform.uUiColourblindIntensity, settings.colorBlindIntensity);

                gl.bindVertexArray(vao);

                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, texture);

                // Linear and hybrid want the hardware filter; the rest do their own sampling and are
                // simpler to write against unfiltered texels.
                const filter = mode === sampling.LINEAR || mode === sampling.HYBRID ? gl.LINEAR : gl.NEAREST;

                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);

                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, resolveColour || texture);

                gl.drawArrays(gl.TRIANGLES, 0, 3);

                sceneDrawn = false;

                return 1;
            },

            resize() {
                // The drawing buffer follows canvas.width/height; the viewport is set per present.
            },

            /**
             * What the last scene draw actually produced.
             *
             * Reads the render target back, which is slow and deliberate: it answers "did anything
             * land in the target" without guessing, and nothing calls it unless asked from a console.
             */
            /**
             * One pixel of the scene target, before the interface pass touches it.
             *
             * Comparing this against the same pixel of the canvas says whether compositing changed
             * the world's colour, which is the difference between a shading bug and a blending one.
             */
            debugPixel(x, y) {
                if (!resolveFbo) {
                    return null;
                }

                const pixel = new Uint8Array(4);

                gl.bindFramebuffer(gl.FRAMEBUFFER, resolveFbo);
                // The target is bottom-up; the caller is thinking in page coordinates.
                gl.readPixels(x, sceneTargetHeight - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);

                return [pixel[0], pixel[1], pixel[2], pixel[3]];
            },

            debugScene() {
                if (!sceneFbo) {
                    return { error: 'no scene target' };
                }

                const width = Math.min(sceneTargetWidth, 256);
                const height = Math.min(sceneTargetHeight, 256);
                const pixels = new Uint8Array(width * height * 4);

                gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
                gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);

                let lit = 0;

                for (let i = 0; i < pixels.length; i += 4) {
                    if (pixels[i] || pixels[i + 1] || pixels[i + 2]) {
                        lit++;
                    }
                }

                return {
                    glError: gl.getError(),
                    sampled: width * height,
                    lit: lit,
                    zones: zones.size,
                    multiDraw: !!multiDraw,
                    target: sceneTargetWidth + 'x' + sceneTargetHeight,
                };
            },

            canvasSize() {
                return canvas ? canvas.width + 'x' + canvas.height : '-';
            },
        };

        return backendApi;
    }

    window.WebGpuBackendWebGl2 = { create: create };
})();
