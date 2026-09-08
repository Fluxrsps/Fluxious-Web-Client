/**
 * Counters for the GPU renderer, and the overlay that shows them.
 *
 * The renderer is being built in stages and most of it cannot be seen from a screenshot — whether a
 * zone uploaded, how many draw calls a frame took, how much geometry crossed. This is how that is
 * visible while the work is in progress.
 *
 * Counters come in two kinds. Per-frame ones are reset every frame and reported as a per-second
 * average; totals accumulate for the session. Both are plain numbers, and reading them costs nothing
 * when the overlay is hidden.
 */
(function () {
    'use strict';

    /** Reset every frame; reported as a mean over the last second. */
    const FRAME_KEYS = ['drawCalls', 'uiUploads', 'uploadedBytes', 'zonesDrawn', 'zonesUploaded', 'modelsDrawn', 'modelsSorted', 'vertices', 'triangles', 'texturesUploaded'];

    const frame = {};
    const perSecond = {};
    const totals = {};
    const timings = {};

    for (const key of FRAME_KEYS) {
        frame[key] = 0;
        perSecond[key] = 0;
    }

    let frames = 0;
    let framesPerSecond = 0;

    /** Time this frame spent in the renderer, and the mean of it; the basis for the unlocked rate. */
    let busy = 0;
    let busyMean = 0;
    let frameStart = 0;
    let windowStart = performance.now();
    let element = null;
    let visible = false;

    /** Latest value of something that is not a rate: a uniform, a mode, a setting. */
    const values = {};

    function value(key, v) {
        values[key] = v;
    }

    /** Adds to a per-frame counter. */
    function add(key, amount) {
        frame[key] = (frame[key] || 0) + (amount || 0);
        totals[key] = (totals[key] || 0) + (amount || 0);
    }

    /**
     * Marks the start of the client's render work for this frame.
     *
     * The client paces itself against a clock and sleeps out the remainder, so frames per second says
     * what the loop allows rather than what the machine can do. Timing from here to the end of the
     * frame's blit covers the work — the world, the interface, and the renderer — and leaves out the
     * waiting, which is what makes the ceiling below meaningful.
     */
    function beginFrame() {
        frameStart = performance.now();
    }

    /** Adds to the work this frame did, whatever part of the renderer did it. */
    function busyTime(ms) {
        busy += ms;
    }

    /** Records how long something took, kept as a rolling mean in milliseconds. */
    function time(key, ms) {
        const previous = timings[key];

        // Exponential mean rather than a sample buffer: one number, and recent frames matter more
        // than what happened a thousand frames ago.
        timings[key] = previous === undefined ? ms : previous * 0.9 + ms * 0.1;
    }

    function endFrame() {
        frames++;

        // The whole render pass when there was one, and just the renderer's own time otherwise —
        // the login screen has no scene to start the clock.
        const worked = frameStart > 0 ? performance.now() - frameStart : busy;

        busyMean = busyMean === 0 ? worked : busyMean * 0.9 + worked * 0.1;
        busy = 0;
        frameStart = 0;

        const now = performance.now();
        const elapsed = now - windowStart;

        if (elapsed >= 1000) {
            const scale = 1000 / elapsed;

            framesPerSecond = frames * scale;

            for (const key of FRAME_KEYS) {
                perSecond[key] = frame[key] * scale;
                frame[key] = 0;
            }

            frames = 0;
            windowStart = now;

            if (visible) {
                render();
            }
        }
    }

    function bytes(n) {
        if (n > 1048576) return (n / 1048576).toFixed(1) + ' MB/s';
        if (n > 1024) return (n / 1024).toFixed(0) + ' KB/s';

        return n.toFixed(0) + ' B/s';
    }

    function render() {
        if (!element) {
            return;
        }

        const gpu = window.WebGpu || {};
        const lines = [
            `backend   ${gpu.backend || 'software'}`,
            `canvas    ${gpu.canvasSize ? gpu.canvasSize() : '-'}`,
            `fps       ${framesPerSecond.toFixed(1)}`,
            // What the renderer could sustain if nothing else paced it: the client's loop runs to a
            // clock, so the rate above is what it allows, not what the GPU is capable of.
            `unlocked  ${busyMean > 0 ? (1000 / busyMean).toFixed(0) : '-'} fps   ${busyMean.toFixed(2)} ms work`,
            `frame     ${(timings.frame || 0).toFixed(2)} ms`,
            // Where the render pass goes: building triangles in Java, handing them to the driver, and
            // the draw itself.
            `build     ${(timings.build || 0).toFixed(2)} ms`,
            `geometry  ${(timings.geometry || 0).toFixed(2)} ms`,
            `scene     ${(timings.scene || 0).toFixed(2)} ms`,
            `upload    ${(timings.upload || 0).toFixed(2)} ms   ${bytes(perSecond.uploadedBytes)}`,
            `present   ${(timings.present || 0).toFixed(2)} ms`,
            `draws     ${(perSecond.drawCalls / Math.max(framesPerSecond, 1)).toFixed(1)} /frame`,
        ];

        // Scene counters only mean something once the scene renderer exists.
        if (totals.zonesDrawn || totals.modelsDrawn) {
            lines.push(
                `zones     ${(perSecond.zonesDrawn / Math.max(framesPerSecond, 1)).toFixed(0)} /frame`,
                `models    ${(perSecond.modelsDrawn / Math.max(framesPerSecond, 1)).toFixed(0)} /frame  ${(perSecond.modelsSorted / Math.max(framesPerSecond, 1)).toFixed(0)} sorted`,
                `tris      ${(perSecond.triangles / Math.max(framesPerSecond, 1) / 1000).toFixed(1)}k /frame`,
                // A total, not a rate: textures arrive once, over the first seconds of play, and what
                // is worth knowing is whether they arrived at all.
                `textures  ${(totals.texturesUploaded || 0).toFixed(0)} uploaded`,
                // The two inputs that decide how bright the world comes out.
                `bright    ${(values.brightness === undefined ? 0 : values.brightness).toFixed(3)}`,
                `overlay   0x${((values.overlay || 0) >>> 0).toString(16).padStart(8, '0')}`,
            );
        }

        element.textContent = lines.join('\n');
    }

    function show() {
        if (!element) {
            element = document.createElement('pre');
            element.id = 'flx-gpu-stats';
            element.style.cssText = [
                'position:fixed',
                'top:8px',
                'left:8px',
                'z-index:2147483647',
                'margin:0',
                'padding:6px 8px',
                'font:11px/1.35 ui-monospace,Consolas,monospace',
                'color:#8f8',
                'background:rgba(0,0,0,0.72)',
                'border:1px solid #2a2a2a',
                'border-radius:3px',
                'pointer-events:none',
                'white-space:pre',
            ].join(';');
            document.body.appendChild(element);
        }

        element.style.display = 'block';
        visible = true;
        render();
    }

    function hide() {
        if (element) {
            element.style.display = 'none';
        }

        visible = false;
    }

    function toggle() {
        if (visible) hide();
        else show();
    }

    window.WebGpuStats = {
        add,
        value,
        time,
        busyTime,
        beginFrame,
        endFrame,
        show,
        hide,
        toggle,
        get visible() {
            return visible;
        },
        values,
        snapshot: () => ({ fps: framesPerSecond, values: { ...values }, unlockedFps: busyMean > 0 ? 1000 / busyMean : 0, perSecond: { ...perSecond }, totals: { ...totals }, timings: { ...timings } }),
    };

    // Ctrl+Shift+G toggles it wherever you are, which is what you want when something is wrong and
    // the settings panel is not the thing you want to be opening.
    window.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && (e.key === 'G' || e.key === 'g')) {
            e.preventDefault();
            toggle();
        }
    }, true);

    // Off unless asked for. It used to switch itself on for anything served from localhost, which was
    // convenient while the renderer was being built and is wrong now that there is a plugin whose job
    // is to decide: a setting that something else can turn on behind your back is not a setting.
    // `?gpuStats=1` still forces it, for a page loaded before any plugin has started.
    if (new URLSearchParams(window.location.search).get('gpuStats') === '1') {
        if (document.body) show();
        else window.addEventListener('DOMContentLoaded', show, { once: true });
    }
})();
