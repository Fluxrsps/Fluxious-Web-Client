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
export default defineConfig({
    plugins: [vue()],
    publicDir: 'public',
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
