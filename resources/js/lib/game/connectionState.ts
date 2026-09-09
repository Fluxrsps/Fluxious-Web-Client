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

/**
 * Whether the game connection was taken away and the client did not recover.
 *
 * Not raised the moment the socket closes: a drop normally puts the client back on its own login
 * screen, which needs nothing from here. This fires only when that has not happened.
 */
const lost = ref(false);

export const connectionLost = readonly(lost);

const RECOVERY_GRACE_MS = 1500;

let graceTimer = 0;
let onLoginScreen: () => boolean = () => false;

function cancelGrace(): void {
    if (graceTimer !== 0) {
        window.clearTimeout(graceTimer);
        graceTimer = 0;
    }
}

function giveUpUnlessRecovered(): void {
    graceTimer = 0;
    if (!onLoginScreen()) {
        lost.value = true;
    }
}

/**
 * Watches for a game connection that went away and was not recovered from.
 *
 * `visibilitychange` matters as much as the socket event on a phone: a backgrounded page has its
 * loop stalled, so the client can come back to a socket that died while it was not running.
 */
export function installConnectionBridge(isLoginVisible: () => boolean): () => void {
    onLoginScreen = isLoginVisible;

    window.FluxConnection = {
        dropped: (label) => {
            // JS5 is the cache stream; losing that is not a lost session.
            if (label !== 'GAME' || lost.value || graceTimer !== 0) {
                return;
            }
            graceTimer = window.setTimeout(giveUpUnlessRecovered, RECOVERY_GRACE_MS);
        },
    };

    const onVisibilityChange = (): void => {
        if (document.visibilityState !== 'visible' || lost.value || graceTimer !== 0) {
            return;
        }
        const game = (window.WebSocketBridge?.getStats() ?? []).find((socket) => socket.label === 'GAME');
        if (game !== undefined && game.state !== 'open') {
            graceTimer = window.setTimeout(giveUpUnlessRecovered, RECOVERY_GRACE_MS);
        }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
        cancelGrace();
        document.removeEventListener('visibilitychange', onVisibilityChange);
        delete window.FluxConnection;
    };
}
