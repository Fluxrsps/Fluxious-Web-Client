import { ref } from 'vue';

/**
 * The saved-player list behind the login screen's left-hand panel.
 *
 * Browser-only, and deliberately so: the desktop client keeps its own encrypted profile store, but
 * that lives on a filesystem this build does not have.
 *
 * SECURITY: a save holds the account password in plain text in localStorage, because clicking a
 * saved player logs straight in and there is no other way to do that without it. Anything with
 * access to the browser profile — another script on this origin, an extension, someone at the
 * machine — can read it. That is the cost of one-click login; the alternative is to store only the
 * username and make the player type the password each time.
 */

export type SavedPlayer = {
    name: string;
    /** Password, in plain text. See the security note above. */
    password: string;
    /** Total level as last reported by the client, or 0 before it has ever been seen. */
    totalLevel: number;
    /** World last logged into. Kept so the save can restore it; not shown on the card. */
    world: number;
    /** Epoch milliseconds of the last login through this save. */
    lastPlayed: number;
    /** At most one save is the favourite; it fills the form on load. */
    fav: boolean;
};

export const MAX_SAVES = 5;

const STORAGE_KEY = 'flux.game.saves';

const players = ref<SavedPlayer[]>(load());

export const savedPlayers = players;

function load(): SavedPlayer[] {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);

        if (!raw) {
            return [];
        }

        const parsed: unknown = JSON.parse(raw);

        if (!Array.isArray(parsed)) {
            return [];
        }

        // Anything in localStorage is user-editable, so every field is re-checked rather than cast.
        return parsed
            .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
            .map((entry) => ({
                name: typeof entry.name === 'string' ? entry.name : '',
                password: typeof entry.password === 'string' ? entry.password : '',
                totalLevel: typeof entry.totalLevel === 'number' ? entry.totalLevel : 0,
                world: typeof entry.world === 'number' ? entry.world : 0,
                lastPlayed: typeof entry.lastPlayed === 'number' ? entry.lastPlayed : 0,
                fav: entry.fav === true,
            }))
            .filter((entry) => entry.name !== '')
            .slice(0, MAX_SAVES);
    } catch {
        return [];
    }
}

function persist(): void {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(players.value));
    } catch {
        // Private browsing and full quotas both land here. Losing the list is not worth an error.
    }
}

function find(name: string): SavedPlayer | undefined {
    return players.value.find((entry) => entry.name.toLowerCase() === name.trim().toLowerCase());
}

/** The save that should pre-fill the form on load, if the player marked one. */
export function favouritePlayer(): SavedPlayer | null {
    return players.value.find((entry) => entry.fav) ?? null;
}

/**
 * Records a successful login.
 *
 * An existing save is updated in place so its position — and its favourite flag and total level —
 * survive. A new one goes to the front, and the oldest falls off the end once the list is full.
 */
export function rememberPlayer(name: string, world: number, password: string): void {
    const trimmed = name.trim();

    if (trimmed === '') {
        return;
    }

    const existing = find(trimmed);

    if (existing) {
        existing.name = trimmed;
        existing.world = world;
        existing.password = password;
        existing.lastPlayed = Date.now();
    } else {
        players.value = [
            { name: trimmed, password, totalLevel: 0, world, lastPlayed: Date.now(), fav: false },
            ...players.value,
        ].slice(0, MAX_SAVES);
    }

    persist();
}

/**
 * Records the total level the client reported for a character.
 *
 * Separate from {@link rememberPlayer} because the two facts arrive at different times: the save is
 * written when the login screen closes, and the level only becomes known once the character is in
 * the world with its skills loaded.
 */
export function updateTotalLevel(name: string, totalLevel: number): void {
    const existing = find(name);

    if (!existing || totalLevel <= 0 || existing.totalLevel === totalLevel) {
        return;
    }

    existing.totalLevel = totalLevel;
    persist();
}

export function forgetPlayer(name: string): void {
    players.value = players.value.filter((entry) => entry.name !== name);
    persist();
}

/** Marks a save as the favourite, or clears it. Only one save can hold the flag. */
export function toggleFavourite(name: string): void {
    const wasFavourite = players.value.find((entry) => entry.name === name)?.fav === true;

    players.value = players.value.map((entry) => ({ ...entry, fav: !wasFavourite && entry.name === name }));
    persist();
}

/** "Never", "Just now", "3 hours ago", "2 days ago" — enough to tell saves apart at a glance. */
export function lastPlayedLabel(lastPlayed: number): string {
    if (!lastPlayed) {
        return 'Never played';
    }

    const seconds = Math.max(0, Math.round((Date.now() - lastPlayed) / 1000));

    if (seconds < 60) {
        return 'Just now';
    }

    const units: Array<[number, string]> = [
        [60, 'minute'],
        [60, 'hour'],
        [24, 'day'],
        [7, 'week'],
    ];

    let value = seconds;
    let label = 'second';

    for (const [size, name] of units) {
        if (value < size) {
            break;
        }

        value = Math.floor(value / size);
        label = name;
    }

    return `${value} ${label}${value === 1 ? '' : 's'} ago`;
}
