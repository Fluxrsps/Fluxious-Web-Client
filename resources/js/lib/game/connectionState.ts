import { readonly, ref } from 'vue';

/**
 * What the client is connecting to, for the loading screen to show.
 *
 * Where the host came from matters as much as the host itself: a world that answers on the page's
 * own hostname because `jav_config.ws` could not be read looks identical to a working one until it
 * fails, so the source is reported alongside.
 */
export interface ConnectionInfo {
    host: string;
    port: string;
    secure: boolean;
    revision: number;
    /** How the host was decided: the launcher config, a query override, or the page itself. */
    source: string;
}

const info = ref<ConnectionInfo | null>(null);

export const connectionInfo = readonly(info);

export function reportConnection(value: ConnectionInfo): void {
    info.value = value;
    console.info(
        `[boot] connecting to ${value.secure ? 'https' : 'http'}://${value.host}:${value.port} ` +
            `(rev ${value.revision}, host from ${value.source})`,
    );
}
