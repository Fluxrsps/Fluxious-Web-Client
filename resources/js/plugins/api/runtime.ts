/**
 * The bridge the generated API wrappers are built on.
 *
 * `net.runelite.api` is a graph of objects, and only numbers and strings cross into the page. An
 * object is therefore represented by an integer handle, and a wrapper class turns that handle back
 * into something plugin code can read like the Java original:
 *
 * ```ts
 * const player = client.getLocalPlayer();
 * if (player) { console.log(player.getName(), player.getCombatLevel()); }
 * ```
 *
 * Calls go through four entry points on `window.FluxApi` keyed by a generated method id, rather
 * than a function per method — see `generateApiBridge` in the client's `build.gradle.kts` for why.
 */

/** Returned by the client for a null object, and for a handle that no longer resolves. */
export const NO_HANDLE = -1;

/** The handle for the client itself, which is where most calls start. */
const CLIENT_HANDLE = -1;

interface Bridge {
    __num(id: number, handle: number, a0: number, a1: number, a2: number, a3: number): number;
    __str(id: number, handle: number, a0: number, a1: number, a2: number, a3: number): string | null;
    __void(id: number, handle: number, a0: number, a1: number, a2: number, a3: number): void;
    __strArg(index: number, value: string): void;
    __alen(unused: number, handle: number, a0: number, a1: number, a2: number, a3: number): number;
    __aget(index: number, handle: number, a0: number, a1: number, a2: number, a3: number): number;
    __astr(index: number, handle: number, a0: number, a1: number, a2: number, a3: number): string | null;
    __subscribe(id: number, on: number): void;
    releaseHandle(handle: number): void;
}

function bridge(): Bridge | undefined {
    return (window as unknown as { FluxApi?: Bridge }).FluxApi;
}

/**
 * Whether the client has installed its bridge yet.
 *
 * Its absence is a normal state rather than an error: the page mounts and plugins start well before
 * the client finishes booting, so every call here answers with a zero value until it does.
 */
export function apiReady(): boolean {
    return bridge() !== undefined;
}

export function callNum(id: number, handle: number, args: number[]): number {
    return bridge()?.__num(id, handle, args[0] ?? 0, args[1] ?? 0, args[2] ?? 0, args[3] ?? 0) ?? 0;
}

export function callStr(id: number, handle: number, args: number[]): string | null {
    return bridge()?.__str(id, handle, args[0] ?? 0, args[1] ?? 0, args[2] ?? 0, args[3] ?? 0) ?? null;
}

export function callVoid(id: number, handle: number, args: number[]): void {
    bridge()?.__void(id, handle, args[0] ?? 0, args[1] ?? 0, args[2] ?? 0, args[3] ?? 0);
}

/**
 * Stages a string argument.
 *
 * A string cannot ride in one of the numeric argument slots, so it is written to a buffer on the
 * client immediately before the call that reads it. Nothing else may cross the bridge in between,
 * which the generated wrappers guarantee by emitting the write and the call together.
 */
export function callStrArg(index: number, value: string): void {
    bridge()?.__strArg(index, value);
}

/**
 * Wrappers by handle, so the same client object is always the same JavaScript object.
 *
 * Two things want this. Plugin code compares objects — the NPC seen last tick against the one seen
 * now — and that comparison should hold in the page as it does in Java. And a handle is released
 * when its wrapper is collected, which would be wrong if two wrappers shared one handle: collecting
 * either would pull the reference from under the other.
 */
const interned = new Map<number, WeakRef<ApiObject>>();

/**
 * Tells the client when a wrapper has been collected, so it can drop its own reference.
 *
 * Without this the client's handle table only ever grows. With it, an object lives exactly as long
 * as the page keeps a reference to it, which is as close to the JVM's behaviour as the two runtimes
 * allow — non-deterministic timing included, so handles are released eventually, not promptly.
 */
const finalizer =
    typeof FinalizationRegistry === 'undefined'
        ? undefined
        : new FinalizationRegistry<number>((handle) => {
              interned.delete(handle);
              bridge()?.releaseHandle(handle);
          });

/** Base class of every generated wrapper: a handle and nothing else. */
export class ApiObject {
    constructor(readonly handle: number) {
        // Negative handles stand for the client itself and for absent objects; neither is a table
        // entry, so neither is interned or released.
        if (handle >= 0) {
            interned.set(handle, new WeakRef(this));
            finalizer?.register(this, handle);
        }
    }
}

/**
 * Calls a method returning an object and wraps the result.
 *
 * Returns null where the client returned null, matching the Java signature — most of this API is
 * only meaningful in some game states, and null-checking every call is how the desktop plugins are
 * written too.
 */
export function wrap<T extends ApiObject>(
    id: number,
    handle: number,
    args: number[],
    type: new (handle: number) => T,
): T | null {
    return fromHandle(callNum(id, handle, args), type);
}

/** The wrapper for a handle, reusing the existing one where the page still holds it. */
export function fromHandle<T extends ApiObject>(
    handle: number,
    type: new (handle: number) => T,
): T | null {
    if (handle < 0) {
        return null;
    }

    const existing = interned.get(handle)?.deref();

    if (existing) {
        return existing as T;
    }

    return new type(handle);
}

/**
 * A Java array, read across the bridge one element at a time.
 *
 * Copying the whole thing would be wasteful for the arrays that matter: `getPlayers()` is around
 * 2000 entries on a busy world and a caller normally wants one of them. Length and element reads go
 * to the client on demand, and `toArray()` is there for when the whole thing genuinely is wanted.
 */
export class ApiArray<T> implements Iterable<T> {
    constructor(
        readonly handle: number,
        private readonly kind: 'num' | 'str' | 'handle' | 'none',
        private readonly element: (new (handle: number) => ApiObject) | null,
    ) {}

    get length(): number {
        if (this.handle < 0) {
            return 0;
        }

        return bridge()?.__alen(0, this.handle, 0, 0, 0, 0) ?? 0;
    }

    get(index: number): T {
        if (this.handle < 0) {
            return (this.kind === 'num' ? 0 : null) as T;
        }

        if (this.kind === 'str') {
            return (bridge()?.__astr(index, this.handle, 0, 0, 0, 0) ?? null) as T;
        }

        const value = bridge()?.__aget(index, this.handle, 0, 0, 0, 0) ?? 0;

        if (this.kind === 'handle' && this.element) {
            return fromHandle(value, this.element) as T;
        }

        return value as T;
    }

    toArray(): T[] {
        const out: T[] = [];
        const length = this.length;

        for (let i = 0; i < length; i++) {
            out.push(this.get(i));
        }

        return out;
    }

    *[Symbol.iterator](): Iterator<T> {
        const length = this.length;

        for (let i = 0; i < length; i++) {
            yield this.get(i);
        }
    }
}

/** Turns an event subscription on or off on the client, so unwatched events cost nothing. */
export function setSubscribed(eventId: number, on: boolean): void {
    bridge()?.__subscribe(eventId, on ? 1 : 0);
}

/** The handle standing for the client object itself. */
export function clientHandle(): number {
    return CLIENT_HANDLE;
}
