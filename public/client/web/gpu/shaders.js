/**
 * Loads the shaders.
 *
 * They live in `web/gpu/shaders` as ordinary `.glsl` and `.wgsl` files rather than as strings inside
 * a script, so an editor highlights them, a diff of one reads as a shader change, and the port from
 * the desktop renderer can be compared line for line against its original.
 *
 * `#include "name"` works the way it does in the desktop renderer's own template system: the line is
 * replaced by the named file, recursively, and a file already pulled in is not pulled in twice. That
 * is what lets the HSL conversion and the colourblind correction be one file each rather than one per
 * shader that needs them.
 *
 * Everything is fetched once at boot, before a backend is chosen, because compiling a shader is not
 * something that can wait on a network round trip.
 */
(function () {
    'use strict';

    /** Every file the two backends between them compile, plus what those files include. */
    const FILES = [
        'hsl_to_rgb.glsl',
        'colorblind.glsl',
        'bicubic.glsl',
        'hybrid.glsl',
        'xbr.glsl',
        'vert.glsl',
        'frag.glsl',
        'vertui.glsl',
        'fragui.glsl',
        'hsl_to_rgb.wgsl',
        'colorblind.wgsl',
        'xbr.wgsl',
        'scene.wgsl',
        'ui.wgsl',
    ];

    const sources = new Map();

    let loading = null;

    /** Where this script came from, which is where the shaders sit beside it. */
    function directory() {
        const script = document.querySelector('script[src*="web/gpu/shaders.js"]');
        const src = script ? script.getAttribute('src') : 'web/gpu/shaders.js';

        return src.replace('shaders.js', 'shaders/');
    }

    /**
     * Replaces every `#include "name"` with the file it names.
     *
     * `seen` carries down the recursion so a file included twice by different paths appears once —
     * two definitions of the same function is a compile error, not a merge.
     */
    function resolve(name, seen) {
        const source = sources.get(name);

        if (source === undefined) {
            throw new Error('no shader ' + name);
        }

        return source.replace(/^[ \t]*#include[ \t]+"([^"]+)"[ \t]*$/gm, (line, included) => {
            if (seen.has(included)) {
                return '';
            }

            seen.add(included);

            return resolve(included, seen);
        });
    }

    window.WebGpuShaders = {
        /** Fetches every shader. Resolves once; later calls get the same promise. */
        load: function () {
            if (loading) {
                return loading;
            }

            const base = directory();

            loading = Promise.all(FILES.map((name) =>
                fetch(base + name)
                    .then((response) => (response.ok ? response.text() : Promise.reject(new Error(name + ': HTTP ' + response.status))))
                    .then((text) => sources.set(name, text))))
                .then(() => true)
                .catch((e) => {
                    console.error('[gpu] shaders unavailable: ' + (e && e.message ? e.message : e));

                    return false;
                });

            return loading;
        },

        get ready() {
            return sources.size === FILES.length;
        },

        /** One shader, with its includes resolved. */
        get: function (name) {
            return resolve(name, new Set([name]));
        },
    };
})();
