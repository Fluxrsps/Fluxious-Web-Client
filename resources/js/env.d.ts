/// <reference types="vite/client" />

/**
 * Build-time settings.
 *
 * Deliberately few. Which server to play against is not one of them — that comes from
 * `jav_config.ws` at boot, so a world move needs no rebuild of anything.
 */
interface ImportMetaEnv {
    /**
     * Where `jav_config.ws` lives.
     *
     * Empty uses the published one. Point it elsewhere to bring up a client against a test server
     * without touching the live configuration.
     */
    readonly VITE_JAV_CONFIG_URL?: string;
    /**
     * Force `wss`/`https` on or off. Empty follows the page, which is what a site and bridge served
     * the same way want; set it to `false` only for a plain-HTTP bridge behind an HTTPS site, and
     * expect the browser to block that as mixed content.
     */
    readonly VITE_GAME_WS_SECURE?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
