/**
 * WebGPU backend.
 *
 * The same renderer as the WebGL2 backend, on the newer API. Two things it does better: the client's
 * framebuffer is bgra8unorm, so the interface upload needs no swizzle at all, and depth is natively
 * [0,1], so the reversed-Z projection uses the whole buffer rather than half of it.
 *
 * What it does not have is multi-draw, so a zone's ranges are issued one draw each. They are few —
 * the renderer merges adjacent ranges before sending them — and a draw call here is cheap.
 */
(function () {
    'use strict';

    /** Sixteen floats of matrix, twelve of scalars, four of fog colour, four of tint. */
    const UNIFORM_FLOATS = 36;

    /** Two dimensions, two more, four of overlay, four of scalars. */
    const UI_UNIFORM_FLOATS = 12;

    /** As many ranges as one zone can need; the renderer merges adjacent ones before sending them. */
    const MAX_RANGES = 256;

    function create() {
        let device = null;
        let context = null;
        let format = null;
        let canvas = null;

        // The interface pass.
        let uiPipeline = null;
        let uiSampler = null;
        let uiSamplerLinear = null;
        let uiTexture = null;
        let uiBindGroup = null;
        let uiUniformBuffer = null;
        let uiUniformData = new Float32Array(UI_UNIFORM_FLOATS);
        let uiWidth = 0;
        let uiHeight = 0;
        let uiFilter = '';
        let overlay = 0;

        // The scene passes.
        let opaquePipeline = null;
        let alphaPipeline = null;
        let sceneBindGroup = null;
        let alphaBindGroup = null;
        let uniformBuffer = null;
        let alphaUniformBuffer = null;
        let uniformData = new Float32Array(UNIFORM_FLOATS);
        let positionBuffer = null;
        let colourBuffer = null;
        let textureBuffer = null;
        let uvBuffer = null;
        let sceneCapacity = 0;
        let dynamicVertices = 0;
        let alphaPosition = null;
        let alphaColour = null;
        let alphaTexture = null;
        let alphaUv = null;
        let alphaCapacity = 0;
        let alphaVertices = 0;
        let indexBuffer = null;
        let indexCapacity = 0;
        let indexAt = 0;
        let indexStaging = null;
        let sceneReady = false;
        let frameView = null;
        let sceneDrawn = false;
        let encoder = null;
        let pass = null;
        let textureArray = null;
        let textureSampler = null;
        let textureSize = 0;
        let animationTexture = null;
        let depthTexture = null;
        let colourTexture = null;
        let samples = 1;
        let targetWidth = 0;
        let targetHeight = 0;

        /** Static geometry, one entry per zone, kept until the client says the zone changed. */
        const zones = new Map();

        /** The frame's target, taken once so the scene and the interface land in the same image. */
        function currentView() {
            if (!frameView) {
                frameView = context.getCurrentTexture().createView();
            }

            return frameView;
        }

        /**
         * The scene's depth buffer, and its colour buffer when antialiasing is on.
         *
         * Multisampling here is one texture rather than a separate resolve step: the pass names the
         * swapchain image as its resolve target and the hardware writes the averaged result there.
         */
        function ensureTargets() {
            const wanted = Math.max(1, window.WebGpuScene.samples[window.WebGpuScene.settings.antiAliasingMode] || 1);

            if (depthTexture && targetWidth === canvas.width && targetHeight === canvas.height && samples === wanted) {
                return;
            }

            if (depthTexture) {
                depthTexture.destroy();
            }

            if (colourTexture) {
                colourTexture.destroy();
                colourTexture = null;
            }

            targetWidth = canvas.width;
            targetHeight = canvas.height;

            // WebGPU has exactly two sample counts: one and four. Any setting above "off" therefore
            // means four — asking for two would be asking for something the API does not have.
            samples = wanted > 1 ? 4 : 1;

            depthTexture = device.createTexture({
                size: { width: targetWidth, height: targetHeight },
                format: 'depth32float',
                sampleCount: samples,
                usage: GPUTextureUsage.RENDER_ATTACHMENT,
            });

            if (samples > 1) {
                colourTexture = device.createTexture({
                    size: { width: targetWidth, height: targetHeight },
                    format: format,
                    sampleCount: samples,
                    usage: GPUTextureUsage.RENDER_ATTACHMENT,
                });
            }

            buildScenePipelines();
        }

        function ensureDynamicCapacity(vertices) {
            if (vertices <= sceneCapacity) {
                return;
            }

            sceneCapacity = Math.max(sceneCapacity * 2, vertices, window.WebGpuScene.initialVertices);

            if (positionBuffer) positionBuffer.destroy();
            if (colourBuffer) colourBuffer.destroy();
            if (textureBuffer) textureBuffer.destroy();
            if (uvBuffer) uvBuffer.destroy();

            const usage = GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST;

            positionBuffer = device.createBuffer({ size: sceneCapacity * 12, usage: usage });
            colourBuffer = device.createBuffer({ size: sceneCapacity * 4, usage: usage });
            textureBuffer = device.createBuffer({ size: sceneCapacity * 4, usage: usage });
            uvBuffer = device.createBuffer({ size: sceneCapacity * 8, usage: usage });
        }

        function ensureAlphaCapacity(vertices) {
            if (vertices <= alphaCapacity) {
                return;
            }

            alphaCapacity = Math.max(alphaCapacity * 2, vertices, 16384);

            if (alphaPosition) alphaPosition.destroy();
            if (alphaColour) alphaColour.destroy();
            if (alphaTexture) alphaTexture.destroy();
            if (alphaUv) alphaUv.destroy();

            const usage = GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST;

            alphaPosition = device.createBuffer({ size: alphaCapacity * 12, usage: usage });
            alphaColour = device.createBuffer({ size: alphaCapacity * 4, usage: usage });
            alphaTexture = device.createBuffer({ size: alphaCapacity * 4, usage: usage });
            alphaUv = device.createBuffer({ size: alphaCapacity * 8, usage: usage });
        }

        /**
         * The frame's index buffer.
         *
         * Sized once and generously rather than grown on demand: a frame's draws are recorded before
         * any of them run, so a buffer replaced part-way through would pull the ground out from under
         * the draws already recorded against it. A frame that somehow needs more than this drops its
         * remaining sorted alpha rather than corrupt what is already there.
         */
        function ensureIndexCapacity(count) {
            if (count <= indexCapacity) {
                return;
            }

            indexCapacity = Math.max(count, 262144);

            if (indexBuffer) {
                indexBuffer.destroy();
            }

            indexBuffer = device.createBuffer({
                size: indexCapacity * 4,
                usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
            });

            // Gathered here first and sent in one write at the end of the frame.
            indexStaging = new Int32Array(indexCapacity);
        }

        /**
         * Points the scene at its textures.
         *
         * A bind group holds the resources themselves rather than a reference to whatever is current,
         * so this runs again whenever one is replaced. There is always something bound — the shader
         * samples before it knows whether the face is textured, and a binding it can only sometimes
         * use is not something WebGPU allows.
         */
        function bindScene() {
            if (!sceneBindGroupLayout) {
                return;
            }

            const bind = (buffer) => device.createBindGroup({
                layout: sceneBindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: buffer } },
                    { binding: 1, resource: textureSampler },
                    { binding: 2, resource: textureArray.createView({ dimension: '2d-array' }) },
                    { binding: 3, resource: animationTexture.createView() },
                ],
            });

            // One group per uniform buffer, for the same reason the indices are appended rather than
            // overwritten: both passes are recorded before either runs, so they cannot share a buffer
            // that each of them writes.
            sceneBindGroup = bind(uniformBuffer);
            alphaBindGroup = bind(alphaUniformBuffer);
        }

        let sceneModule = null;
        let sceneBindGroupLayout = null;
        let scenePipelineLayout = null;

        /**
         * The resources the scene shaders read, declared rather than inferred.
         *
         * Both scene pipelines share one bind group, and a layout WebGPU works out per pipeline is
         * only compatible with that pipeline — so the opaque and transparent passes would each need
         * their own copy of the same group. Declaring it once makes them interchangeable.
         */
        function buildSceneLayout() {
            sceneBindGroupLayout = device.createBindGroupLayout({
                entries: [
                    {
                        binding: 0,
                        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                        buffer: { type: 'uniform' },
                    },
                    { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
                    {
                        binding: 2,
                        visibility: GPUShaderStage.FRAGMENT,
                        texture: { sampleType: 'float', viewDimension: '2d-array' },
                    },
                    {
                        // Read with textureLoad rather than sampled, and rg32float cannot be filtered.
                        binding: 3,
                        visibility: GPUShaderStage.VERTEX,
                        texture: { sampleType: 'unfilterable-float', viewDimension: '2d' },
                    },
                ],
            });

            scenePipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [sceneBindGroupLayout] });
        }

        /**
         * The two scene pipelines.
         *
         * Same shaders throughout; what differs is what they are allowed to write. The opaque one
         * writes depth and does not blend. The transparent one blends and leaves depth alone, so a
         * translucent face is still hidden by solid geometry in front of it without hiding the faces
         * drawn after it.
         */
        function buildScenePipelines() {
            const common = {
                layout: scenePipelineLayout,
                vertex: {
                    module: sceneModule,
                    entryPoint: 'vs',
                    buffers: [
                        { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
                        { arrayStride: 4, attributes: [{ shaderLocation: 1, offset: 0, format: 'uint32' }] },
                        { arrayStride: 4, attributes: [{ shaderLocation: 2, offset: 0, format: 'sint32' }] },
                        { arrayStride: 8, attributes: [{ shaderLocation: 3, offset: 0, format: 'float32x2' }] },
                    ],
                },
                // The projection's negative Y flips winding, so front faces are counter-clockwise.
                primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
                multisample: { count: samples },
            };

            opaquePipeline = device.createRenderPipeline(Object.assign({}, common, {
                fragment: { module: sceneModule, entryPoint: 'fs', targets: [{ format: format }] },
                depthStencil: {
                    format: 'depth32float',
                    depthWriteEnabled: true,
                    // Reversed depth, matching the projection.
                    depthCompare: 'greater',
                },
            }));

            alphaPipeline = device.createRenderPipeline(Object.assign({}, common, {
                fragment: {
                    module: sceneModule,
                    entryPoint: 'fs',
                    targets: [
                        {
                            format: format,
                            blend: {
                                color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
                                alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
                            },
                        },
                    ],
                },
                depthStencil: {
                    format: 'depth32float',
                    depthWriteEnabled: false,
                    depthCompare: 'greater',
                },
            }));

            bindScene();
        }

        /** Recreates the UI texture; the client resizes its framebuffer whenever the canvas changes. */
        function ensureUiTexture(width, height) {
            const filter = uiFilterFor(window.WebGpuScene.settings.uiScalingMode);

            if (uiTexture && uiWidth === width && uiHeight === height && uiFilter === filter) {
                return;
            }

            if (uiTexture && (uiWidth !== width || uiHeight !== height)) {
                uiTexture.destroy();
                uiTexture = null;
            }

            if (!uiTexture) {
                uiTexture = device.createTexture({
                    size: { width: width, height: height },
                    format: 'bgra8unorm',
                    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
                });
            }

            uiWidth = width;
            uiHeight = height;
            uiFilter = filter;

            uiBindGroup = device.createBindGroup({
                layout: uiPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: filter === 'linear' ? uiSamplerLinear : uiSampler },
                    { binding: 1, resource: uiTexture.createView() },
                    { binding: 2, resource: { buffer: uiUniformBuffer } },
                ],
            });
        }

        /** Linear and hybrid want the hardware filter; the rest sample the texels themselves. */
        function uiFilterFor(mode) {
            return mode === 'LINEAR' || mode === 'HYBRID' ? 'linear' : 'nearest';
        }

        /** Builds the scene pipeline once the device exists. */
        function initScene() {
            const scene = window.WebGpuScene;

            if (!scene) {
                return;
            }

            sceneModule = device.createShaderModule({ code: window.WebGpuShaders.get('scene.wgsl') });

            uniformBuffer = device.createBuffer({
                size: UNIFORM_FLOATS * 4,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });

            alphaUniformBuffer = device.createBuffer({
                size: UNIFORM_FLOATS * 4,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });

            textureSampler = device.createSampler({
                magFilter: 'linear',
                minFilter: 'linear',
                mipmapFilter: 'linear',
                addressModeU: 'repeat',
                addressModeV: 'repeat',
            });

            // Stand-ins until the client's own arrive, so there is something to bind from the first
            // frame.
            textureArray = device.createTexture({
                size: { width: 1, height: 1, depthOrArrayLayers: 1 },
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            });

            animationTexture = device.createTexture({
                size: { width: 1, height: 1 },
                format: 'rg32float',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            });

            buildSceneLayout();
            ensureTargets();
            ensureDynamicCapacity(scene.initialVertices);
            ensureAlphaCapacity(16384);
            ensureIndexCapacity(262144);

            sceneReady = true;
            scene.attach(backendApi);
        }

        function destroyZone(zone) {
            releaseChannels(zone.opaque);
            releaseChannels(zone.alpha);
        }

        function releaseChannels(channels) {
            if (!channels) {
                return;
            }

            channels.positions.destroy();
            channels.colours.destroy();
            channels.textures.destroy();
            channels.uvs.destroy();
        }

        /** A vertex buffer holding exactly what was handed over, written at creation and never again. */
        function staticBuffer(source, bytes) {
            const buffer = device.createBuffer({
                size: Math.max(4, bytes),
                usage: GPUBufferUsage.VERTEX,
                mappedAtCreation: true,
            });

            const view = source instanceof Float32Array
                ? new Float32Array(buffer.getMappedRange())
                : new Int32Array(buffer.getMappedRange());

            view.set(source.subarray(0, bytes / 4));
            buffer.unmap();

            return buffer;
        }

        function createChannels(positions, colours, textures, uvs, vertexCount) {
            return {
                positions: staticBuffer(positions, vertexCount * 12),
                colours: staticBuffer(colours, vertexCount * 4),
                textures: staticBuffer(textures, vertexCount * 4),
                uvs: staticBuffer(uvs, vertexCount * 8),
                count: vertexCount,
            };
        }

        function bindChannels(channels) {
            pass.setVertexBuffer(0, channels.positions);
            pass.setVertexBuffer(1, channels.colours);
            pass.setVertexBuffer(2, channels.textures);
            pass.setVertexBuffer(3, channels.uvs);
        }

        /** Issues a set of vertex ranges; without multi-draw that is one call each. */
        function drawRanges(ranges, count) {
            let vertices = 0;
            const issued = Math.min(count, MAX_RANGES);

            for (let i = 0; i < issued; i++) {
                const first = ranges[i * 2];
                const length = ranges[i * 2 + 1];

                pass.draw(length, 1, first);
                vertices += length;
            }

            return vertices;
        }

        const backendApi = {
            name: 'webgpu',

            async init(target) {
                if (!navigator.gpu) {
                    return false;
                }

                const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });

                if (!adapter) {
                    return false;
                }

                device = await adapter.requestDevice();
                context = target.getContext('webgpu');

                if (!context) {
                    return false;
                }

                canvas = target;
                format = navigator.gpu.getPreferredCanvasFormat();
                context.configure({ device: device, format: format, alphaMode: 'opaque' });

                const module = device.createShaderModule({ code: window.WebGpuShaders.get('ui.wgsl') });

                uiPipeline = device.createRenderPipeline({
                    layout: 'auto',
                    vertex: { module: module, entryPoint: 'vs' },
                    fragment: {
                        module: module,
                        entryPoint: 'fs',
                        targets: [
                            {
                                format: format,
                                // Over the scene, not instead of it.
                                blend: {
                                    color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
                                    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
                                },
                            },
                        ],
                    },
                    primitive: { topology: 'triangle-list' },
                });

                uiSampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
                uiSamplerLinear = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
                uiUniformBuffer = device.createBuffer({
                    size: UI_UNIFORM_FLOATS * 4,
                    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
                });

                device.lost.then((info) => {
                    console.error('[gpu] WebGPU device lost:', info.message);
                });

                device.addEventListener('uncapturederror', (e) => {
                    console.error('[gpu] ' + e.error.message);
                });

                initScene();

                return true;
            },

            // --- scene ---------------------------------------------------

            beginScene(matrix, x, y, width, height, frame) {
                if (!sceneReady) {
                    return;
                }

                dynamicVertices = 0;
                alphaVertices = 0;
                indexAt = 0;
                sceneDrawn = false;

                const settings = frame.settings;
                const sky = frame.fogColour;

                ensureTargets();

                uniformData.set(matrix, 0);
                uniformData[16] = frame.cameraX;
                uniformData[17] = frame.cameraZ;
                uniformData[18] = frame.drawDistance;
                uniformData[19] = frame.expandedChunks;
                uniformData[20] = frame.tick;
                uniformData[21] = frame.brightness;
                uniformData[22] = settings.fogDepth;
                uniformData[23] = settings.fogDepth > 0 ? 1 : 0;
                // The uniform is the inverse of the setting: it is how much banding to keep.
                uniformData[24] = settings.smoothBanding ? 0 : 1;
                uniformData[25] = settings.brightTextures ? 1 : 0;
                uniformData[26] = window.WebGpuScene.colourblind[settings.colorBlindMode] || 0;
                uniformData[27] = settings.colorBlindIntensity;
                uniformData[28] = ((sky >> 16) & 0xFF) / 255;
                uniformData[29] = ((sky >> 8) & 0xFF) / 255;
                uniformData[30] = (sky & 0xFF) / 255;
                uniformData[31] = 1;
                uniformData[32] = 0;
                uniformData[33] = 0;
                uniformData[34] = 0;
                uniformData[35] = 0;

                device.queue.writeBuffer(uniformBuffer, 0, uniformData);

                const view = samples > 1 ? colourTexture.createView() : currentView();

                encoder = device.createCommandEncoder();
                pass = encoder.beginRenderPass({
                    colorAttachments: [
                        {
                            view: view,
                            resolveTarget: samples > 1 ? currentView() : undefined,
                            loadOp: 'clear',
                            storeOp: 'store',
                            clearValue: { r: 0, g: 0, b: 0, a: 1 },
                        },
                    ],
                    depthStencilAttachment: {
                        view: depthTexture.createView(),
                        // Reversed depth: the projection leaves 1/z, so the clear is zero and the
                        // comparison is "greater".
                        depthClearValue: 0,
                        depthLoadOp: 'clear',
                        depthStoreOp: 'store',
                    },
                });

                pass.setPipeline(opaquePipeline);
                pass.setBindGroup(0, sceneBindGroup);
                // The world occupies a rectangle inside the canvas; in fixed mode the interface is
                // drawn around it.
                pass.setViewport(x, y, Math.max(1, width), Math.max(1, height), 0, 1);
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

                if (!pass || !zone || !zone.opaque) {
                    return 0;
                }

                bindChannels(zone.opaque);

                const vertices = drawRanges(ranges, count);

                sceneDrawn = true;

                return vertices;
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

                device.queue.writeBuffer(
                    positionBuffer, dynamicVertices * 12, positions.buffer, positions.byteOffset + offset * 12, vertexCount * 12);
                device.queue.writeBuffer(
                    colourBuffer, dynamicVertices * 4, colours.buffer, colours.byteOffset + offset * 4, vertexCount * 4);
                device.queue.writeBuffer(
                    textureBuffer, dynamicVertices * 4, textures.buffer, textures.byteOffset + offset * 4, vertexCount * 4);
                device.queue.writeBuffer(
                    uvBuffer, dynamicVertices * 8, uvs.buffer, uvs.byteOffset + offset * 8, vertexCount * 8);

                dynamicVertices += vertexCount;
            },

            drawDynamic() {
                if (!pass || dynamicVertices === 0) {
                    return 0;
                }

                pass.setVertexBuffer(0, positionBuffer);
                pass.setVertexBuffer(1, colourBuffer);
                pass.setVertexBuffer(2, textureBuffer);
                pass.setVertexBuffer(3, uvBuffer);
                pass.draw(dynamicVertices);

                const vertices = dynamicVertices;

                dynamicVertices = 0;
                sceneDrawn = true;

                return vertices;
            },

            // --- the alpha pass ------------------------------------------

            beginAlphaPass(hue, saturation, luminance, amount) {
                if (!pass) {
                    return;
                }

                uniformData[32] = hue;
                uniformData[33] = saturation;
                uniformData[34] = luminance;
                uniformData[35] = amount;

                device.queue.writeBuffer(alphaUniformBuffer, 0, uniformData);

                pass.setPipeline(alphaPipeline);
                pass.setBindGroup(0, alphaBindGroup);
            },

            setDynamicAlpha(positions, colours, textures, uvs, vertexCount) {
                if (!sceneReady) {
                    return;
                }

                ensureAlphaCapacity(vertexCount);

                device.queue.writeBuffer(alphaPosition, 0, positions.buffer, positions.byteOffset, vertexCount * 12);
                device.queue.writeBuffer(alphaColour, 0, colours.buffer, colours.byteOffset, vertexCount * 4);
                device.queue.writeBuffer(alphaTexture, 0, textures.buffer, textures.byteOffset, vertexCount * 4);
                device.queue.writeBuffer(alphaUv, 0, uvs.buffer, uvs.byteOffset, vertexCount * 8);

                alphaVertices = vertexCount;
            },

            drawZoneAlphaRanges(id, ranges, count) {
                const zone = zones.get(id);

                if (!pass || !zone || !zone.alpha) {
                    return 0;
                }

                bindChannels(zone.alpha);

                return drawRanges(ranges, count);
            },

            drawZoneAlphaIndexed(id, indices, count) {
                const zone = zones.get(id);

                if (!pass || !zone || !zone.alpha) {
                    return 0;
                }

                // Appended, never overwritten. `writeBuffer` is a queue operation: every write for the
                // frame lands before the pass that was recorded alongside them runs. Writing each
                // zone's indices to the same offset therefore left every indexed draw in the frame
                // reading the last zone's list, which is the whole of the transparency corruption
                // this backend had and the WebGL2 one did not.
                if (indexAt + count > indexCapacity) {
                    return 0;
                }

                // Copied into the frame's own array rather than sent now. Every write is a queue
                // operation that lands before the pass runs, so a write per zone per level bought
                // nothing over one write for the lot — and there are hundreds of them a frame.
                indexStaging.set(indices.subarray(0, count), indexAt);

                bindChannels(zone.alpha);
                pass.setIndexBuffer(indexBuffer, 'uint32');
                pass.drawIndexed(count, 1, indexAt);

                indexAt += count;

                return count;
            },

            drawDynamicAlpha(ranges, count) {
                if (!pass || alphaVertices === 0) {
                    return 0;
                }

                pass.setVertexBuffer(0, alphaPosition);
                pass.setVertexBuffer(1, alphaColour);
                pass.setVertexBuffer(2, alphaTexture);
                pass.setVertexBuffer(3, alphaUv);

                return drawRanges(ranges, count);
            },

            /** One array, one layer per texture: a face carries its id and the shader reads it. */
            createTextureArray(count, size) {
                if (!sceneReady) {
                    return;
                }

                if (textureArray) {
                    textureArray.destroy();
                }

                textureSize = size;
                textureArray = device.createTexture({
                    size: { width: size, height: size, depthOrArrayLayers: count },
                    format: 'rgba8unorm',
                    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
                });

                bindScene();
            },

            uploadTexture(layer, pixels) {
                if (!textureArray || textureSize === 0) {
                    return;
                }

                // The client's pixels are 0xAARRGGBB, which in memory is B,G,R,A — and it leaves
                // alpha at zero for the parts it means to be transparent, marking them by colour.
                // There is no bgra8unorm for a sampled array, so the swizzle happens here.
                const size = textureSize;
                const bytes = new Uint8Array(size * size * 4);
                const source = new Uint8Array(pixels.buffer, pixels.byteOffset, size * size * 4);

                for (let i = 0; i < size * size; i++) {
                    const at = i * 4;
                    const opaquePixel = source[at] || source[at + 1] || source[at + 2];

                    bytes[at] = source[at + 2];
                    bytes[at + 1] = source[at + 1];
                    bytes[at + 2] = source[at];
                    bytes[at + 3] = opaquePixel ? 255 : 0;
                }

                device.queue.writeTexture(
                    { texture: textureArray, origin: { x: 0, y: 0, z: layer } },
                    bytes,
                    { bytesPerRow: size * 4, rowsPerImage: size },
                    { width: size, height: size, depthOrArrayLayers: 1 },
                );
            },

            uploadTextureAnimations(animations, count) {
                if (animationTexture) {
                    animationTexture.destroy();
                }

                animationTexture = device.createTexture({
                    size: { width: count, height: 1 },
                    format: 'rg32float',
                    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
                });

                device.queue.writeTexture(
                    { texture: animationTexture },
                    animations,
                    { bytesPerRow: count * 8, rowsPerImage: 1 },
                    { width: count, height: 1 },
                );

                bindScene();
            },

            configure() {
                // Antialiasing and interface filtering are both picked up where they are used, on the
                // next frame; nothing here has to be rebuilt eagerly.
            },

            endScene() {
                if (!pass) {
                    return;
                }

                // The frame's sorted alpha indices, in one write. The draws recorded above already
                // point at their offsets in here.
                if (indexAt > 0) {
                    device.queue.writeBuffer(indexBuffer, 0, indexStaging.buffer, 0, indexAt * 4);
                }

                pass.end();
                device.queue.submit([encoder.finish()]);

                pass = null;
                encoder = null;
            },

            setOverlay(colour) {
                overlay = colour;
            },

            /** `pixels` is the client's own Int32Array — the bytes are already BGRA. */
            uploadUi(pixels, width, height) {
                ensureUiTexture(width, height);

                // A view, not a copy: the client's buffer with the trailing slot the client keeps
                // past the end of the image excluded.
                const bytes = new Uint8Array(pixels.buffer, pixels.byteOffset, width * height * 4);

                device.queue.writeTexture(
                    { texture: uiTexture },
                    bytes,
                    { bytesPerRow: width * 4, rowsPerImage: height },
                    { width: width, height: height },
                );

                return bytes.byteLength;
            },

            present() {
                if (!uiBindGroup) {
                    return 0;
                }

                const settings = window.WebGpuScene.settings;
                const sampling = window.WebGpuScene.sampling;
                const mode = sampling[settings.uiScalingMode] === undefined
                    ? sampling.HYBRID
                    : sampling[settings.uiScalingMode];

                uiUniformData[0] = uiWidth;
                uiUniformData[1] = uiHeight;
                uiUniformData[2] = canvas.width;
                uiUniformData[3] = canvas.height;
                uiUniformData[4] = ((overlay >> 16) & 0xFF) / 255;
                uiUniformData[5] = ((overlay >> 8) & 0xFF) / 255;
                uiUniformData[6] = (overlay & 0xFF) / 255;
                uiUniformData[7] = ((overlay >>> 24) & 0xFF) / 255;
                uiUniformData[8] = mode;
                uiUniformData[9] = sceneDrawn ? 0 : 1;
                uiUniformData[10] = window.WebGpuScene.colourblind[settings.colorBlindMode] || 0;
                uiUniformData[11] = settings.colorBlindIntensity;

                device.queue.writeBuffer(uiUniformBuffer, 0, uiUniformData);

                const uiEncoder = device.createCommandEncoder();
                const uiPass = uiEncoder.beginRenderPass({
                    colorAttachments: [
                        {
                            view: currentView(),
                            // Keep the scene if one was drawn this frame; the interface has the alpha
                            // that lets it through.
                            loadOp: sceneDrawn ? 'load' : 'clear',
                            storeOp: 'store',
                            clearValue: { r: 0, g: 0, b: 0, a: 1 },
                        },
                    ],
                });

                uiPass.setPipeline(uiPipeline);
                uiPass.setBindGroup(0, uiBindGroup);
                uiPass.draw(3);
                uiPass.end();

                device.queue.submit([uiEncoder.finish()]);

                // The frame is finished with; the next one takes a fresh swapchain image.
                frameView = null;
                sceneDrawn = false;

                return 1;
            },

            resize() {
                // WebGPU takes the canvas size from the element itself; nothing to do but keep the
                // configuration current after a size change.
                if (context && device) {
                    context.configure({ device: device, format: format, alphaMode: 'opaque' });
                }
            },

            debugScene() {
                return { zones: zones.size, samples: samples, dynamic: dynamicVertices, alpha: alphaVertices };
            },

            canvasSize() {
                return canvas ? canvas.width + 'x' + canvas.height : '-';
            },
        };

        return backendApi;
    }

    window.WebGpuBackendWebGpu = { create: create };
})();
