/**
 * Whether the player is on a phone or tablet, published as document classes.
 *
 * One predicate, because the forced-landscape rotation, the login screen's compact layout, the
 * on-screen keyboard button and the plugin sidebar all need the same answer and must not disagree.
 *
 * No user-agent test, and deliberately no screen-size test either: browser scaling and device pixel
 * ratio both move those numbers far enough to make any threshold wrong somewhere. What is left is
 * the pointer, which is the thing actually being asked about.
 *
 * `?mobile=1` and `?mobile=0` override it and are remembered. `?mobile=android` and `?mobile=ios`
 * do the same and additionally tell the client which mobile OS to report, which is what makes it
 * pick the resizable display mode and the android/ios client type rather than the browser one.
 */

const MOBILE_CLASS = 'flx-mobile';
const COMPACT_LOGIN_CLASS = 'flx-login-compact';

/** Set by web/orientation.js when it rotates the client to landscape by transform. */
const ROTATED_CLASS = 'flux-rotate-landscape';

const OVERRIDE_KEY = 'flx.mobile';

const COMPACT_LOGIN_HEIGHT = 500;

/** The values `?mobile=` accepts, mapped to what they mean. */
const OVERRIDES: Record<string, { mobile: boolean; os: MobileOs | null }> = {
    '0': { mobile: false, os: null },
    '1': { mobile: true, os: null },
    android: { mobile: true, os: 'android' },
    ios: { mobile: true, os: 'ios' },
};

export type MobileOs = 'android' | 'ios';

function readOverride(): { mobile: boolean; os: MobileOs | null } | null {
    const param = new URLSearchParams(window.location.search).get('mobile');

    if (param !== null && param in OVERRIDES) {
        try {
            window.localStorage.setItem(OVERRIDE_KEY, param);
        } catch {
            // Private browsing; the query param still applies for this page load.
        }

        return OVERRIDES[param];
    }

    try {
        const stored = window.localStorage.getItem(OVERRIDE_KEY);

        return stored !== null && stored in OVERRIDES ? OVERRIDES[stored] : null;
    } catch {
        return null;
    }
}

const override = readOverride();

/**
 * The mobile OS to claim, when the override names one.
 *
 * `null` means "do not claim anything" — either there is no override or it only said mobile — and
 * leaves the client on its own user-agent check.
 */
export function mobileOsOverride(): MobileOs | null {
    return override?.os ?? null;
}

export function isMobileDevice(): boolean {
    if (override !== null) {
        return override.mobile;
    }

    // A touch device that says so.
    if (window.matchMedia('(pointer: coarse)').matches && window.matchMedia('(hover: none)').matches) {
        return true;
    }

    // Otherwise: touch hardware with nothing precise also pointing at it. `any-pointer: fine` is
    // what separates a tablet from a touchscreen laptop, because it reports every pointer present
    // rather than only the primary one, so a mouse shows up even when a finger is being used.
    //
    // `ontouchstart` is not consulted: Chrome on Windows defines it whether or not the machine has
    // a touchscreen, which made every desktop look like a phone.
    return (navigator.maxTouchPoints | 0) > 0 && !window.matchMedia('(any-pointer: fine)').matches;
}

// Forced landscape rotates `.flx-login` by a transform, which does not affect layout: the viewport
// keeps reporting portrait, so the box's height is the viewport's width.
function loginBoxHeight(): number {
    return document.documentElement.classList.contains(ROTATED_CLASS) ? window.innerWidth : window.innerHeight;
}

function apply(): void {
    const mobile = isMobileDevice();
    const root = document.documentElement;

    root.classList.toggle(MOBILE_CLASS, mobile);
    root.classList.toggle(COMPACT_LOGIN_CLASS, mobile || loginBoxHeight() <= COMPACT_LOGIN_HEIGHT);

    // web/orientation.js reads this: a plain script that cannot import this module, but which must
    // reach the same answer or the client rotates while the login screen does not.
    root.dataset.fluxMobile = mobile ? '1' : '0';
}

/**
 * Holds the screen awake while the client is on top.
 *
 * The browser drops the lock whenever the page is hidden and it cannot be retaken from the
 * background, so it is re-requested on the way back rather than held once.
 */
export function installWakeLock(): () => void {
    if (!('wakeLock' in navigator)) {
        return () => {};
    }

    let sentinel: WakeLockSentinel | null = null;
    let stopped = false;

    async function acquire(): Promise<void> {
        if (stopped || sentinel !== null || document.visibilityState !== 'visible') {
            return;
        }
        try {
            sentinel = await navigator.wakeLock.request('screen');
            sentinel.addEventListener('release', () => (sentinel = null));
        } catch {
            // Refused. Not worth retrying in a loop.
        }
    }

    void acquire();
    document.addEventListener('visibilitychange', acquire);

    return () => {
        stopped = true;
        document.removeEventListener('visibilitychange', acquire);
        void sentinel?.release();
        sentinel = null;
    };
}

/**
 * Takes the browser fullscreen on a phone, hiding the address bar and the system buttons.
 *
 * Once, on the first touch of the session, and never again. It cannot happen on load — every
 * browser requires a user gesture and rejects the request otherwise — but re-arming afterwards
 * would mean a player who deliberately left fullscreen is dragged back into it by their next tap.
 * Leaving is a decision, so it is honoured for the rest of the session; the Fullscreen plugin is
 * the way back in.
 *
 * Phones only, and Chromium only: WebKit allows fullscreen for video alone, so on iOS this does
 * nothing and "Add to Home Screen" is the route to the same result.
 */
export function installFullscreen(): () => void {
    const root = document.documentElement;

    if (!isMobileDevice() || typeof root.requestFullscreen !== 'function') {
        return () => {};
    }

    let stop = (): void => {};

    const enter = (): void => {
        stop();

        if (document.fullscreenElement !== null) {
            return;
        }

        // navigationUI is honoured by Chromium and ignored elsewhere. The promise rejects when the
        // gesture has already been spent, which is not worth reporting or retrying.
        void root.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    };

    stop = () => {
        window.removeEventListener('touchend', enter);
    };

    // touchend rather than pointerdown: a tap that turns out to be the start of a camera drag or a
    // pinch should not spend itself entering fullscreen, and pointerdown fires for a mouse too.
    window.addEventListener('touchend', enter, { passive: true, once: true });

    return stop;
}

/** Publishes the device classes and keeps them current. Returns the function that stops. */
export function installDeviceClasses(): () => void {
    apply();

    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);

    return () => {
        window.removeEventListener('resize', apply);
        window.removeEventListener('orientationchange', apply);
        document.documentElement.classList.remove(MOBILE_CLASS, COMPACT_LOGIN_CLASS);
        delete document.documentElement.dataset.fluxMobile;
    };
}
