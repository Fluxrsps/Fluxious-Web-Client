/**
 * At-rest encryption for the saved-player passwords.
 *
 * AES-GCM, with a key generated once and kept in IndexedDB as a non-extractable `CryptoKey`. The
 * ciphertext in localStorage is useless on its own, and the key cannot be read back out by script
 * even though it can still be used — so a copied browser profile, a synced backup or someone
 * reading localStorage in devtools gets nothing.
 *
 * What this does not defend against: code already running on this origin. It can ask this module to
 * decrypt just as the login screen does. Storing a password the client has to replay is inherently
 * reversible by whoever controls the page; this raises the floor from "plain text in a file" to
 * "needs code execution on the origin", and no browser-side scheme can do better.
 */

const DB_NAME = 'flux.keys';
const DB_STORE = 'keys';
const KEY_ID = 'saves.v1';

const IV_BYTES = 12;

function subtle(): SubtleCrypto | null {
    return window.crypto?.subtle ?? null;
}

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = window.indexedDB.open(DB_NAME, 1);

        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(DB_STORE)) {
                request.result.createObjectStore(DB_STORE);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function readKey(db: IDBDatabase): Promise<CryptoKey | null> {
    return new Promise((resolve, reject) => {
        const request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(KEY_ID);

        request.onsuccess = () => resolve((request.result as CryptoKey | undefined) ?? null);
        request.onerror = () => reject(request.error);
    });
}

function writeKey(db: IDBDatabase, key: CryptoKey): Promise<void> {
    return new Promise((resolve, reject) => {
        const request = db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).put(key, KEY_ID);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

let keyPromise: Promise<CryptoKey | null> | null = null;

function secretKey(): Promise<CryptoKey | null> {
    if (keyPromise === null) {
        keyPromise = resolveKey().catch(() => null);
    }

    return keyPromise;
}

async function resolveKey(): Promise<CryptoKey | null> {
    const crypto = subtle();

    if (crypto === null || !window.indexedDB) {
        return null;
    }

    const db = await openDb();
    const existing = await readKey(db);

    if (existing !== null) {
        return existing;
    }

    // `false` is the important argument: the key is usable but never exportable.
    const generated = await crypto.generateKey({ name: 'AES-GCM', length: 256 }, false, [
        'encrypt',
        'decrypt',
    ]);

    await writeKey(db, generated);

    return generated;
}

function toBase64(bytes: Uint8Array): string {
    let binary = '';

    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    return window.btoa(binary);
}

function fromBase64(text: string): Uint8Array {
    const binary = window.atob(text);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
}

/** Ciphertext for [plaintext], or null when the browser cannot encrypt it. */
export async function encryptSecret(plaintext: string): Promise<string | null> {
    const crypto = subtle();
    const key = await secretKey();

    if (crypto === null || key === null) {
        return null;
    }

    try {
        const iv = window.crypto.getRandomValues(new Uint8Array(IV_BYTES));
        const encoded = new TextEncoder().encode(plaintext);
        const sealed = await crypto.encrypt({ name: 'AES-GCM', iv }, key, encoded);
        const combined = new Uint8Array(iv.length + sealed.byteLength);

        combined.set(iv, 0);
        combined.set(new Uint8Array(sealed), iv.length);

        return toBase64(combined);
    } catch {
        return null;
    }
}

/** The plaintext behind [stored], or an empty string when it cannot be recovered. */
export async function decryptSecret(stored: string): Promise<string> {
    const crypto = subtle();
    const key = await secretKey();

    if (crypto === null || key === null || stored === '') {
        return '';
    }

    try {
        const combined = fromBase64(stored);

        if (combined.length <= IV_BYTES) {
            return '';
        }

        const iv = combined.slice(0, IV_BYTES);
        const sealed = combined.slice(IV_BYTES);
        const opened = await crypto.decrypt({ name: 'AES-GCM', iv }, key, sealed);

        return new TextDecoder().decode(opened);
    } catch {
        return '';
    }
}

/** True when passwords can actually be encrypted, so callers can refuse to save otherwise. */
export async function canEncryptSecrets(): Promise<boolean> {
    return (await secretKey()) !== null;
}
