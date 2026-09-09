/**
 * Whether the player is on a phone or tablet, published as document classes.
 *
 * One predicate, because the forced-landscape rotation, the login screen's compact layout and the
 * plugin sidebar all need the same answer and must not disagree.
 *
 * No user-agent test: Chrome for Android's "Desktop site" rewrites it and reports `pointer: fine`,
 * leaving touch hardware as the only signal that survives. `?mobile=1` and `?mobile=0` override the
 * heuristic, which can be wrong on a touchscreen laptop.
 */

const MOBILE_CLASS = 'flx-mobile';
const COMPACT_LOGIN_CLASS = 'flx-login-compact';

/** Set by web/orientation.js when it rotates the client to landscape by transform. */
const ROTATED_CLASS = 'flux-rotate-landscape';

const OVERRIDE_KEY = 'flx.mobile';

/** Wide enough for a phone reporting a 980px desktop-mode viewport, below any laptop. */
const HANDHELD_SHORT_SIDE = 1000;

const COMPACT_LOGIN_HEIGHT = 500;

function readOverride(): boolean | null {
    const param = new URLSearchParams(window.location.search).get('mobile');

    if (param === '1' || param === '0') {
        const value = param === '1';

        try {
            window.localStorage.setItem(OVERRIDE_KEY, param);
        } catch {
            // Private browsing; the query param still applies for this page load.
        }

        return value;
    }

    try {
        const stored = window.localStorage.getItem(OVERRIDE_KEY);

        return stored === null ? null : stored === '1';
    } catch {
        return null;
    }
}

const override = readOverride();

export function isMobileDevice(): boolean {
    if (override !== null) {
        return override;
    }

    if (window.matchMedia('(pointer: coarse)').matches && window.matchMedia('(hover: none)').matches) {
        return true;
    }

    // Desktop mode, or any browser that lies about its pointer: trust the hardware and the screen.
    const touch = 'ontouchstart' in window || (navigator.maxTouchPoints | 0) > 0;
    const shortSide = Math.min(window.screen.width, window.screen.height);

    return touch && shortSide <= HANDHELD_SHORT_SIDE;
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
 * Cannot happen on load: fullscreen needs a user gesture, so the first tap is what triggers it and
 * every later tap re-arms it in case the player left. Chromium only — WebKit allows fullscreen for
 * video alone, so on iOS this does nothing and "Add to Home Screen" is the way to the same result.
 */
export function installFullscreen(): () => void {
    const root = document.documentElement;

    if (!isMobileDevice() || typeof root.requestFullscreen !== 'function') {
        return () => {};
    }

    const enter = (): void => {
        if (document.fullscreenElement !== null) {
            return;
        }
        // navigationUI is honoured by Chromium and ignored elsewhere; either way the promise can
        // reject when the gesture has already been spent, and a refusal is not worth reporting.
        void root.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    };

    window.addEventListener('pointerdown', enter, { passive: true });
    window.addEventListener('touchend', enter, { passive: true });

    return () => {
        window.removeEventListener('pointerdown', enter);
        window.removeEventListener('touchend', enter);
    };
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
