/**
 * Picks a GPU backend and presents frames through it.
 *
 * WebGPU if the browser has it, WebGL2 if not, and software only if neither exists. There is no
 * setting for this: a player on a machine that can render on the GPU should be rendering on the GPU.
 * `?gpu=webgl2` / `?gpu=off` force a path for testing.
 *
 * The choice has to be made before the client starts, because a canvas gets one kind of context for
 * its lifetime — `canvas.js` asks here at attach time and takes the 2D path only if this said no.
 */
(function () {
    'use strict';

    let backend = null;
    let canvas = null;
    let initialised = false;

    const stats = () => window.WebGpuStats;

    /** Which backends to try, in order, honouring `?gpu=`. */
    function candidates() {
        const forced = new URLSearchParams(window.location.search).get('gpu');

        if (forced === 'off' || forced === 'software' || forced === 'cpu') {
            return [];
        }

        const webgpu = window.WebGpuBackendWebGpu;
        const webgl2 = window.WebGpuBackendWebGl2;

        if (forced === 'webgl2') return [webgl2];
        if (forced === 'webgpu') return [webgpu];

        return [webgpu, webgl2];
    }

    async function init(canvasId) {
        if (initialised) {
            return backend !== null;
        }

        initialised = true;
        canvas = document.getElementById(canvasId);

        if (!canvas) {
            console.warn('[gpu] no canvas #' + canvasId + '; staying on the software renderer');

            return false;
        }

        // The shaders are files, and a backend cannot be brought up without them. This is the one
        // place in the renderer that waits for anything.
        if (!(await window.WebGpuShaders.load())) {
            console.warn('[gpu] shaders did not load; staying on the software renderer');

            return false;
        }

        for (const candidate of candidates()) {
            if (!candidate) {
                continue;
            }

            const attempt = candidate.create();

            try {
                if (await attempt.init(canvas)) {
                    backend = attempt;
                    console.log('[gpu] rendering with ' + attempt.name);

                    return true;
                }
            } catch (e) {
                // A backend that throws is a backend that is not available. Say so and try the next
                // one rather than taking the client down with it.
                console.warn('[gpu] ' + attempt.name + ' unavailable: ' + (e && e.message ? e.message : e));
            }
        }

        console.log('[gpu] no GPU backend available; rendering in software');

        return false;
    }

    /**
     * Hands the client's framebuffer to the GPU and presents it.
     *
     * Called from `canvas.js` in place of the 2D blit. Returns false if there is no backend, which is
     * how the software path knows to draw the frame itself.
     */
    function blit(pixels, width, height) {
        if (!backend) {
            return false;
        }

        const start = performance.now();
        const uploaded = backend.uploadUi(pixels, width, height);
        const uploaded_at = performance.now();

        const draws = backend.present();
        const done = performance.now();

        const s = stats();

        if (s) {
            s.add('uiUploads', 1);
            s.add('uploadedBytes', uploaded);
            s.add('drawCalls', draws);
            s.time('upload', uploaded_at - start);
            s.time('present', done - uploaded_at);
            s.time('frame', done - start);
            s.busyTime(done - start);
            s.endFrame();
        }

        return true;
    }

    window.WebGpu = {
        init: init,
        blit: blit,

        get ready() {
            return backend !== null;
        },

        get backend() {
            return backend ? backend.name : null;
        },

        resize: function (width, height) {
            if (backend) {
                backend.resize(width, height);
            }
        },

        /** One pixel of the scene target, for comparing against the composited canvas. */
        debugPixel: function (x, y) {
            return backend && backend.debugPixel ? backend.debugPixel(x, y) : null;
        },

        canvasSize: function () {
            return backend ? backend.canvasSize() : canvas ? canvas.width + 'x' + canvas.height : '-';
        },
    };
})();
