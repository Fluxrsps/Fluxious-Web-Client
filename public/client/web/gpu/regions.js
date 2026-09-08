/**
 * Which map a chunk belongs to.
 *
 * The world is not one continuous surface. Places that sit next to each other in the map file are
 * often nowhere near each other in the game, and the scene the client loads is a square of map
 * regardless — so standing at the edge of one area shows a slice of an unrelated one through the
 * walls. The desktop renderer solves this with a table of which chunks form which map, and drops the
 * tiles of every map but the one the player is standing in.
 *
 * This is that table, and the grammar it is written in, ported from RuneLite's `Regions`. It loads
 * asynchronously alongside the other runtime scripts; until it has, every chunk answers zero, which
 * means nothing is hidden — the same as the setting being off.
 */
(function () {
    'use strict';

    /** Each entry is one rectangle of chunks belonging to one map. */
    const regions = [];

    /**
     * Rectangles bucketed by the map square they fall in.
     *
     * A scene load asks about five hundred chunks, and the table holds a few thousand rectangles;
     * scanning all of them each time is a million comparisons for something that happens while the
     * player is walking. A chunk belongs to exactly one map square, so the bucket for that square is
     * the only place its rectangle can be.
     */
    const buckets = new Map();

    let ready = false;

    /**
     * Parses the table.
     *
     * The grammar is a handful of one-letter commands, several to a line:
     *   n                       start a new map
     *   m <rx> <ry>             select a region, without claiming it
     *   r <rx> <ry>             claim a whole region
     *   R <rx1> <ry1> <rx2> <ry2>   claim a rectangle of regions
     *   c <cx> <cy>             claim one chunk of the selected region
     *   C <cx1> <cy1> <cx2> <cy2>   claim a rectangle of chunks
     */
    function parse(text) {
        const lines = text.split('\n');

        let rx1 = 0;
        let ry1 = 0;
        let rx2 = 0;
        let ry2 = 0;
        let id = 0;

        for (const raw of lines) {
            const comment = raw.indexOf('//');
            const line = (comment === -1 ? raw : raw.slice(0, comment)).trim();

            if (line.length === 0) {
                continue;
            }

            const tokens = line.split(/[ \t]+/);

            for (let i = 0; i < tokens.length; ) {
                const command = tokens[i++];
                const number = () => parseInt(tokens[i++], 10);

                if (command === 'n') {
                    id++;
                    continue;
                }

                if (command === 'm') {
                    rx2 = rx1 = number();
                    ry2 = ry1 = number();
                    continue;
                }

                let claim = false;

                if (command === 'r') {
                    rx2 = rx1 = number();
                    ry2 = ry1 = number();
                    claim = true;
                } else if (command === 'R') {
                    rx1 = number();
                    ry1 = number();
                    rx2 = number();
                    ry2 = number();
                    claim = true;
                }

                let cx1 = rx1 * 8;
                let cy1 = ry1 * 8;
                let cx2 = rx2 * 8 + 7;
                let cy2 = ry2 * 8 + 7;

                if (command === 'c') {
                    cx2 = cx1 = cx1 + number();
                    cy2 = cy1 = cy1 + number();
                } else if (command === 'C') {
                    const ox1 = number();
                    const oy1 = number();

                    cx2 = cx1 + number();
                    cy2 = cy1 + number();
                    cx1 += ox1;
                    cy1 += oy1;
                } else if (!claim) {
                    // An unknown token would put every following number in the wrong place, so stop
                    // reading this line rather than build a table that is quietly wrong.
                    break;
                }

                const region = { id: id, cx1: cx1, cy1: cy1, cx2: cx2, cy2: cy2 };

                regions.push(region);
                index(region);
            }
        }

        ready = true;
    }

    /** Files a rectangle under every map square it covers. */
    function index(region) {
        for (let rx = region.cx1 >> 3; rx <= region.cx2 >> 3; rx++) {
            for (let ry = region.cy1 >> 3; ry <= region.cy2 >> 3; ry++) {
                const key = (rx << 8) | ry;
                const bucket = buckets.get(key);

                if (bucket) {
                    bucket.push(region);
                } else {
                    buckets.set(key, [region]);
                }
            }
        }
    }

    /** Where this script came from, which is where the table sits beside it. */
    function url() {
        const script = document.querySelector('script[src*="web/gpu/regions.js"]');
        const src = script ? script.getAttribute('src') : 'web/gpu/regions.js';

        return src.replace('regions.js', 'regions.txt');
    }

    fetch(url())
        .then((response) => (response.ok ? response.text() : Promise.reject(new Error('HTTP ' + response.status))))
        .then(parse)
        .catch((e) => console.warn('[gpu] region table unavailable: ' + (e && e.message ? e.message : e)));

    window.WebGpuRegions = {
        get ready() {
            return ready;
        },

        /** The map a chunk belongs to, or zero for a chunk no map claims. */
        regionId: function (cx, cy) {
            const bucket = buckets.get(((cx >> 3) << 8) | (cy >> 3));

            if (!bucket) {
                return 0;
            }

            for (const region of bucket) {
                if (cx >= region.cx1 && cy >= region.cy1 && cx <= region.cx2 && cy <= region.cy2) {
                    return region.id;
                }
            }

            return 0;
        },
    };
})();
