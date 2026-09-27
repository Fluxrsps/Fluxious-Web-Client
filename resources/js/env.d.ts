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
     * Where the world list lives.
     *
     * Empty takes `worldslist.ws` from the same server as the config, which is where central puts
     * it. Set only when the two are served from different places.
     */
    readonly VITE_WORLD_LIST_URL?: string;
    /**
     * Force `wss`/`https` on or off. Empty follows the page, which is what a site and bridge served
     * the same way want; set it to `false` only for a plain-HTTP bridge behind an HTTPS site, and
     * expect the browser to block that as mixed content.
     */
    readonly VITE_GAME_WS_SECURE?: string;
    /**
     * The bridge's host, bypassing the one derived from `jav_config.ws`.
     *
     * Empty is the deployed behaviour: the config names the world and the bridge host follows from
     * it. Set it to play against a bridge on this machine while the published config still names a
     * live world, which is the usual development case.
     */
    readonly VITE_BRIDGE_HOST?: string;
    /**
     * The port the bridge answers on. Empty uses 8091, the bridge's own port; behind TLS set it to
     * whatever terminates.
     */
    readonly VITE_BRIDGE_PORT?: string;
    /**
     * A hash of the client files under public/client, set by vite.config.ts at build time.
     *
     * Not a setting: it goes on every client URL as `?v=` so the files can be served as immutable
     * and still update the moment a new client is deployed.
     */
    readonly VITE_CLIENT_BUILD?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
