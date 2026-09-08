import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
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

export default defineConfig({
    plugins: [vue()],
    publicDir: 'public',
    server: {
        // Proxied rather than fetched directly so the browser sees same-origin requests. The local
        // central has no CORS headers, and a dev setup should not depend on it having been rebuilt
        // with them. In production the client talks to central directly, which is why those routes
        // send `Access-Control-Allow-Origin`.
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
});
