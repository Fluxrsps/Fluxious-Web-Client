import { ref } from 'vue';

import { decryptSecret, encryptSecret } from './secretStore';

/**
 * The saved-player list behind the login screen's left-hand panel.
 *
 * Browser-only, and deliberately so: the desktop client keeps its own profile store, but that lives
 * on a filesystem this build does not have.
 *
 * SECURITY: passwords are held in memory in plain text — clicking a saved player logs straight in,
 * so the plaintext has to exist at that moment — but what reaches localStorage is AES-GCM
 * ciphertext, keyed by a non-extractable key in IndexedDB. See `secretStore.ts` for what that does
 * and does not protect against.
 */

export type SavedPlayer = {
    name: string;
    /** Plain text in memory only; encrypted on the way to storage. */
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

/** Bumped when the stored password stopped being plain text, so old saves can be re-encrypted. */
const ENCRYPTED_VERSION = 2;

type StoredEntry = {
    name: string;
    password: string;
    totalLevel: number;
    world: number;
    lastPlayed: number;
    fav: boolean;
};

const players = ref<SavedPlayer[]>([]);

export const savedPlayers = players;

/**
 * The list loads in two steps because decryption is async and the panel is rendered synchronously.
 * Everything except the passwords is available immediately; each password arrives a tick later and
 * is filled in place, long before a card can be clicked.
 */
const stored = loadStored();

players.value = stored.entries.map((entry) => ({ ...entry, password: '' }));

void hydratePasswords(stored);

function loadStored(): { entries: StoredEntry[]; encrypted: boolean } {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);

        if (!raw) {
            return { entries: [], encrypted: true };
        }

        const parsed: unknown = JSON.parse(raw);
        const list = Array.isArray(parsed) ? parsed : (parsed as Record<string, unknown>)?.saves;
        const version = Array.isArray(parsed) ? 1 : Number((parsed as Record<string, unknown>)?.v ?? 1);

        if (!Array.isArray(list)) {
            return { entries: [], encrypted: true };
        }

        // Anything in localStorage is user-editable, so every field is re-checked rather than cast.
        const entries = list
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

        return { entries, encrypted: version >= ENCRYPTED_VERSION };
    } catch {
        return { entries: [], encrypted: true };
    }
}

async function hydratePasswords(source: { entries: StoredEntry[]; encrypted: boolean }): Promise<void> {
    if (source.entries.length === 0) {
        return;
    }

    const passwords = await Promise.all(
        source.entries.map((entry) =>
            source.encrypted ? decryptSecret(entry.password) : Promise.resolve(entry.password),
        ),
    );

    players.value = players.value.map((entry, index) => ({ ...entry, password: passwords[index] ?? '' }));

    // A list written before encryption existed is rewritten now, so the plaintext stops sitting in
    // localStorage without waiting for the player's next login.
    if (!source.encrypted) {
        void persist();
    }
}

async function persist(): Promise<void> {
    const snapshot = players.value;

    const entries = await Promise.all(
        snapshot.map(async (entry) => {
            const sealed = entry.password === '' ? '' : await encryptSecret(entry.password);

            return { ...entry, password: sealed ?? '' };
        }),
    );

    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: ENCRYPTED_VERSION, saves: entries }));
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

    void persist();
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
    void persist();
}

export function forgetPlayer(name: string): void {
    players.value = players.value.filter((entry) => entry.name !== name);
    void persist();
}

/** Marks a save as the favourite, or clears it. Only one save can hold the flag. */
export function toggleFavourite(name: string): void {
    const wasFavourite = players.value.find((entry) => entry.name === name)?.fav === true;

    players.value = players.value.map((entry) => ({ ...entry, fav: !wasFavourite && entry.name === name }));
    void persist();
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
