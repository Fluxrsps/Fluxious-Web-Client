/**
 * The scene renderer: geometry in, world on the screen.
 *
 * The client hands over the world through `web.gpu.WebGpuRenderer`, and this passes it to whichever
 * backend took the canvas. Static geometry crosses once per zone and stays on the GPU; only models
 * that move cross every frame. A frame therefore says which zones to draw and which ranges within
 * them, which is how roof hiding and level clipping cost nothing.
 *
 * Colours are the client's own HSL, converted on the GPU. That is what the desktop renderer does, and
 * it is why the gradients across a tile look right rather than banded.
 */
(function () {
    'use strict';

    /** Vertices reserved up front for models that move; static geometry lives in per-zone buffers. */
    const INITIAL_VERTICES = 131072;

    /**
     * The renderer's settings, with the desktop plugin's defaults.
     *
     * These live here rather than in Java because almost all of them are shader uniforms, and the two
     * that are not — draw distance and map loading — are read back by the client each frame. The
     * settings plugin writes into this object and nothing else has to be told.
     */
    const settings = {
        drawDistance: 50,
        hideUnrelatedMaps: true,
        expandedMapLoadingChunks: 3,
        smoothBanding: true,
        antiAliasingMode: 'MSAA_2',
        uiScalingMode: 'HYBRID',
        fogDepth: 0,
        anisotropicFilteringLevel: 1,
        colorBlindMode: 'NONE',
        colorBlindIntensity: 100,
        brightTextures: false,
        unlockFps: false,
        vsyncMode: 'OFF',
        fpsTarget: 60,
        removeVertexSnapping: true,
    };

    let backend = null;
    let active = false;

    const stats = () => window.WebGpuStats;

    /**
     * How fast the display refreshes, as the only way a page can find out: time two frames of it.
     *
     * Measured once, lazily, and rounded to the rates monitors actually run at so a 143.8 reading
     * does not become the client's target. Sixty until the measurement lands.
     */
    const RATES = [60, 75, 90, 100, 120, 144, 165, 240];

    let measuredRate = 0;

    function displayRate() {
        if (measuredRate === 0) {
            measuredRate = 60;
            measureDisplayRate();
        }

        return measuredRate;
    }

    function measureDisplayRate() {
        let first = 0;
        let frames = 0;

        const tick = (now) => {
            if (frames === 0) {
                first = now;
            }

            if (++frames <= 10) {
                requestAnimationFrame(tick);
                return;
            }

            const rate = 1000 / ((now - first) / (frames - 1));

            measuredRate = RATES.reduce((best, candidate) =>
                Math.abs(candidate - rate) < Math.abs(best - rate) ? candidate : best);
        };

        requestAnimationFrame(tick);
    }

    /** Records one draw and the vertices it covered; every draw call goes through here. */
    function tally(vertices) {
        const s = stats();

        if (s && vertices > 0) {
            s.add('drawCalls', 1);
            s.add('vertices', vertices);
            s.add('triangles', vertices / 3);
        }
    }

    window.WebGpuScene = {
        /** Set by the backend once its scene pipeline is built. */
        get ready() {
            return backend !== null;
        },

        attach: function (implementation) {
            backend = implementation;
        },

        /** How much room a backend reserves for models that move, before it has seen any. */
        initialVertices: INITIAL_VERTICES,

        /** The sampling functions, numbered as the interface shader switches on them. */
        sampling: { NEAREST: 0, LINEAR: 1, MITCHELL: 2, CATMULL_ROM: 3, XBR: 4, HYBRID: 5 },

        /** The deficiency the colour correction compensates for, as the shaders number them. */
        colourblind: { NONE: 0, PROTANOPE: 1, DEUTERANOPE: 2, TRITANOPE: 3 },

        /** How many samples each antialiasing setting asks for. */
        samples: { DISABLED: 0, MSAA_2: 2, MSAA_4: 4, MSAA_8: 8, MSAA_16: 16 },

        settings: settings,

        /** One setting, with the caller's fallback if it has been cleared. */
        setting: function (name, fallback) {
            const value = settings[name];

            return value === undefined || value === null ? fallback : value;
        },

        /**
         * The frame rate the client should aim for, or zero to leave it to the client's own timer.
         *
         * The desktop plugin drops the target when vsync is on, because the driver is pacing the
         * frames and a target would fight it. A browser has no swap interval to hand that job to:
         * the client's loop yields through a timer, and an unlocked loop with no target asks for the
         * next frame immediately, which starves the page and stops the tab responding.
         *
         * So unlocked never means uncapped here. Vsync on targets the display's own rate — the same
         * thing a swap interval of one would have achieved — and off targets whatever was set.
         */
        effectiveFpsTarget: function () {
            if (!settings.unlockFps) {
                // The client keeps its own 20ms timer when the cap is on; a target would do nothing.
                return 0;
            }

            return settings.vsyncMode === 'OFF' ? Math.max(1, settings.fpsTarget) : displayRate();
        },

        /**
         * Applies changed settings.
         *
         * Anything the backend has to rebuild for — antialiasing, filtering — it rebuilds here; the
         * rest are uniforms and are picked up on the next frame.
         */
        configure: function (changes) {
            Object.assign(settings, changes || {});

            if (backend && backend.configure) {
                backend.configure(settings);
            }
        },

        /**
         * Starts the frame's scene.
         *
         * The viewport is the game world's rectangle inside the canvas, not the canvas: in fixed mode
         * the client draws its interface around a smaller window into the world.
         */
        beginScene: function (matrix, x, y, width, height, cameraX, cameraZ, drawDistance, tick, brightness, fogColour, expandedChunks) {
            if (!backend) {
                return;
            }

            active = true;

            const s = stats();

            if (s) {
                s.beginFrame();
            }

            const st = stats();

            if (st) {
                st.value('brightness', brightness);
            }

            backend.beginScene(matrix, x, y, width, height, {
                cameraX: cameraX,
                cameraZ: cameraZ,
                drawDistance: drawDistance,
                tick: tick,
                brightness: brightness,
                fogColour: fogColour,
                expandedChunks: expandedChunks,
                settings: settings,
            });
        },

        /** Gives a zone's geometry to the GPU, where it stays until the zone changes. */
        uploadZone: function (zone, positions, colours, textures, uvs, vertexCount) {
            if (!backend || vertexCount <= 0) {
                return;
            }

            const start = performance.now();

            backend.uploadZone(zone, positions, colours, textures, uvs, vertexCount);

            const s = stats();

            if (s) {
                s.time('zoneUpload', performance.now() - start);
                s.add('uploadedBytes', vertexCount * 28);
                s.add('zonesUploaded', 1);
            }
        },

        /** Draws parts of a zone already on the GPU: pairs of first vertex and count. */
        drawZone: function (zone, ranges, count) {
            if (!backend || !active || count <= 0) {
                return;
            }

            tally(backend.drawZone(zone, ranges, count));
        },

        freeZone: function (zone) {
            if (backend) {
                backend.freeZone(zone);
            }
        },

        /** A zone's transparent geometry, which lives on the GPU alongside its solid geometry. */
        uploadZoneAlpha: function (zone, positions, colours, textures, uvs, vertexCount) {
            if (!backend || vertexCount <= 0) {
                return;
            }

            backend.uploadZoneAlpha(zone, positions, colours, textures, uvs, vertexCount);

            const s = stats();

            if (s) {
                s.add('uploadedBytes', vertexCount * 28);
            }
        },

        /** Switches the pass: blending on, depth writes off, and the scene's own tint applied. */
        beginAlphaPass: function (hue, saturation, luminance, amount) {
            if (backend && active) {
                backend.beginAlphaPass(hue, saturation, luminance, amount);
            }
        },

        /** The frame's transparent moving geometry, sent once before the pass that draws it. */
        setDynamicAlpha: function (positions, colours, textures, uvs, vertexCount) {
            if (!backend || !active || vertexCount <= 0) {
                return;
            }

            const start = performance.now();

            backend.setDynamicAlpha(positions, colours, textures, uvs, vertexCount);

            const s = stats();

            if (s) {
                s.time('geometry', performance.now() - start);
                s.add('uploadedBytes', vertexCount * 28);
            }
        },

        drawZoneAlphaRanges: function (zone, ranges, count) {
            if (backend && active && count > 0) {
                tally(backend.drawZoneAlphaRanges(zone, ranges, count));
            }
        },

        drawZoneAlphaIndexed: function (zone, indices, count) {
            if (backend && active && count > 0) {
                tally(backend.drawZoneAlphaIndexed(zone, indices, count));
            }
        },

        drawDynamicAlpha: function (ranges, count) {
            if (backend && active && count > 0) {
                tally(backend.drawDynamicAlpha(ranges, count));
            }
        },

        /** Draws the frame's moving models, closing the solid part of the frame. */
        drawDynamic: function () {
            if (backend && active) {
                tally(backend.drawDynamic());
            }
        },

        /** The colour the client wants laid over the finished frame. */
        setOverlay: function (colour) {
            const st = stats();

            if (st) {
                st.value('overlay', colour);
            }

            if (backend && backend.setOverlay) {
                backend.setOverlay(colour);
            }
        },

        /** Adds geometry that only exists this frame: players, animated objects, anything moving. */
        addGeometry: function (positions, colours, textures, uvs, vertexCount, offset) {
            if (!backend || !active || vertexCount <= 0) {
                return;
            }

            const start = performance.now();

            backend.addGeometry(positions, colours, textures, uvs, vertexCount, offset || 0);

            const s = stats();

            if (s) {
                s.time('geometry', performance.now() - start);
                s.add('uploadedBytes', vertexCount * 28);
            }
        },

        /** Closes the frame's pass and submits it. */
        endScene: function () {
            if (!backend || !active) {
                return;
            }

            const start = performance.now();

            backend.endScene();

            const s = stats();

            if (s) {
                const elapsed = performance.now() - start;

                s.time('scene', elapsed);
                s.busyTime(elapsed);
            }

            active = false;
        },

        /** Allocates the texture array once the client knows how many textures it has. */
        createTextureArray: function (count, size) {
            if (backend && backend.createTextureArray) {
                backend.createTextureArray(count, size);
            }
        },

        /** One texture layer, as the client's ARGB pixels. */
        uploadTexture: function (layer, pixels) {
            if (backend && backend.uploadTexture) {
                backend.uploadTexture(layer, pixels);

                const s = stats();

                if (s) {
                    s.add('texturesUploaded', 1);
                }
            }
        },

        /** Scroll direction and speed per texture, two floats each. */
        uploadTextureAnimations: function (animations, count) {
            if (backend && backend.uploadTextureAnimations) {
                backend.uploadTextureAnimations(animations, count);
            }
        },

        /** What the frame drew, for the overlay. */
        stats: function (zones, models, sorted, buildMicros) {
            const s = window.WebGpuStats;

            if (s) {
                s.add('zonesDrawn', zones);
                s.add('modelsDrawn', models);
                s.add('modelsSorted', sorted);
                s.time('build', buildMicros / 1000);
            }
        },

        /** The scene changed underneath us; whatever was cached for the old one is gone. */
        reset: function () {
            if (backend && backend.resetZones) {
                backend.resetZones();
            }
        },
    };
})();
