import { computed, readonly, ref } from 'vue';
import { rememberPlayer, updateTotalLevel } from './savedPlayers';

/**
 * The game client's login screen, rendered by the page instead of the canvas.
 *
 * The client publishes a snapshot of its login state through `window.FluxLogin` once per frame
 * while its login screen is up, and `null` as soon as it is not — the same shape of contract as
 * `FluxLoading`. Commands go the other way through `window.WebLogin`, which queues them for the
 * client to drain on its next frame; nothing here reaches into the client directly.
 */

export type LoginWorld = {
    id: number;
    players: number;
    /** Server-assigned region code; see LOCATION_NAMES. */
    location: number;
    activity: string;
    members: boolean;
};

export type LoginSnapshot = {
    /** The client's own screen id: 2 the credential form, 3 its error variant, 4 two-factor. */
    index: number;
    /** Client game state; 20 means a login attempt is in flight. */
    gameState: number;
    world: number;
    username: string;
    line1: string;
    line2: string;
    line3: string;
    muted: boolean;
    worlds: LoginWorld[];
};

export const SCREEN_LOGIN = 2;
export const SCREEN_LOGIN_ERROR = 3;
export const SCREEN_TWO_FACTOR = 4;
export const GAME_STATE_LOGGING_IN = 20;

/**
 * Region code to country, as the world list reports it.
 *
 * The codes come from the server's world table, so this is the one place to edit when a region is
 * added. Anything unmapped falls back to "Unknown" rather than guessing.
 */
export const LOCATION_NAMES: Record<number, string> = {
    0: 'United States',
    1: 'United Kingdom',
    3: 'Australia',
    7: 'Germany',
};

export function locationName(code: number): string {
    return LOCATION_NAMES[code] ?? 'Unknown';
}

const snapshot = ref<LoginSnapshot | null>(null);

export const loginSnapshot = readonly(snapshot);
export const loginVisible = computed(() => snapshot.value !== null);

/**
 * The attempt currently in flight, held so it can be saved if it succeeds.
 *
 * Captured at submit time rather than read back afterwards: by the time an attempt has succeeded
 * the snapshot is null, so the world it was made against is no longer available to read.
 */
let pendingLogin: { username: string; password: string; world: number; remember: boolean } | null = null;

export function installLoginBridge(): void {
    window.FluxLogin = {
        state: (value) => {
            const wasOnLoginScreen = snapshot.value !== null;

            snapshot.value = value;

            // The login screen going away is the only signal that an attempt succeeded — a rejected
            // one keeps the screen up and reports itself through the message lines instead.
            //
            // This deliberately lives here and not in the component: the page unmounts the login
            // screen the instant the snapshot goes null, which stops its watchers before they run.
            if (wasOnLoginScreen && value === null && pendingLogin !== null) {
                if (pendingLogin.remember) {
                    rememberPlayer(pendingLogin.username, pendingLogin.world, pendingLogin.password);
                }

                pendingLogin = null;
            }
        },

        // Sent by the client once the character is in the world, repeatedly, because the skills it
        // reads the total level from are not loaded at the moment the login completes.
        player: (info) => {
            updateTotalLevel(info.name, info.totalLevel);
        },
    };
}

/** Queues a login attempt. Errors come back through the next snapshot's message lines. */
export function submitLogin(username: string, password: string, world: number, remember: boolean): void {
    pendingLogin = { username, password, world, remember };
    window.WebLogin?.login(username, password, world);
}

export function submitOtp(code: string): void {
    window.WebLogin?.otp(code);
}

export function backToLogin(): void {
    window.WebLogin?.backToLogin();
}

export function selectWorld(world: number): void {
    window.WebLogin?.selectWorld(world);
}

export function refreshWorlds(): void {
    window.WebLogin?.refreshWorlds();
}

export function setMuted(muted: boolean): void {
    window.WebLogin?.setMuted(muted);
}
