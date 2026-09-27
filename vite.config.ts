import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

/**
 * A static site, and nothing more.
 *
 * The page is one HTML file that boots a canvas; everything after that is the client talking to the
 * game server over its own WebSocket. There is no server side, so a deploy is `dist/` on a CDN.
 *
 * `public/` is copied verbatim, which is what carries the TeaVM client and its runtime scripts:
 * they are built elsewhere, and hashing or transforming them would break the paths the client loads
 * them by.
 */
/** The central server in local development; serves jav_config.ws, worlds.js and worldslist.ws. */
const LOCAL_CENTRAL = 'http://127.0.0.1:8080';

/** Where the TeaVM client and its runtime scripts live. */
const CLIENT_DIR = fileURLToPath(new URL('./public/client', import.meta.url));

/**
 * A short hash of every file under public/client.
 *
 * The client cannot be content-hashed into its filename the way Vite does for its own assets — the
 * runtime scripts are loaded by fixed paths — so the boot script stamps every client URL with this
 * as `?v=` instead. The files are then served as immutable (see vercel.json): a client that has not
 * changed comes out of the browser's cache, and one that has is fetched once under its new stamp.
 */
function clientBuildId(): string {
    const hash = createHash('sha1');

    const walk = (dir: string) => {
        for (const name of readdirSync(dir).sort()) {
            const path = join(dir, name);

            if (statSync(path).isDirectory()) {
                walk(path);
            } else {
                hash.update(name);
                hash.update(readFileSync(path));
            }
        }
    };

    try {
        walk(CLIENT_DIR);
    } catch {
        // No client deployed yet; the boot script reports that itself when it fails to load.
        return 'none';
    }

    return hash.digest('hex').slice(0, 12);
}

export default defineConfig(({ command }) => {
    // Through the environment rather than `define`, so index.html can use it too
    // (%VITE_CLIENT_BUILD%) and start the client download from the HTML itself. In development the
    // client may be redeployed under a running server, so the stamp is the server's start time
    // rather than a hash that would go stale.
    process.env.VITE_CLIENT_BUILD = command === 'build' ? clientBuildId() : `dev-${Date.now()}`;

    return {
        plugins: [vue()],
        publicDir: 'public',
        server: {
            // Proxied rather than fetched directly so the browser sees same-origin requests. The
            // local central has no CORS headers, and a dev setup should not depend on it having
            // been rebuilt with them. In production the client talks to central directly, which is
            // why those routes send `Access-Control-Allow-Origin`.
            proxy: {
                '/central': {
                    target: LOCAL_CENTRAL,
                    changeOrigin: true,
                    rewrite: (path) => path.replace(/^\/central/, ''),
                },
            },
        },
        build: {
            outDir: 'dist',
            emptyOutDir: true,
        },
        resolve: {
            alias: {
                '@': fileURLToPath(new URL('./resources/js', import.meta.url)),
            },
        },
    };
});
