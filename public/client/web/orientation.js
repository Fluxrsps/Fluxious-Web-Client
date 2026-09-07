/**
 * Keeps the game landscape on phones and tablets.
 *
 * <p>Two mechanisms, in order of preference:
 *
 * <ol>
 *   <li>The Screen Orientation API. Chrome on Android honours {@code lock("landscape")} once the
 *       page is fullscreen, which is the real thing: the OS rotates and the status bar follows.
 *       It needs a user gesture, so the attempt is deferred to the first tap.
 *   <li>A CSS fallback that rotates {@code #game-host} and {@code #shell-root} 90 degrees while the
 *       viewport is portrait. iOS Safari has no orientation lock at all, so without this the client
 *       would be stuck in a tall, unusable box there.
 * </ol>
 *
 * <p>The fallback only changes how the host is painted; its layout box is swapped to
 * {@code width: 100vh / height: 100vw}, so {@code clientWidth}/{@code clientHeight} — what the
 * client reads to size itself — already report landscape dimensions. Input is the one thing that
 * does not follow automatically: {@code web/input.js} reads {@link #rotation} and un-rotates
 * pointer coordinates itself.
 */
const FluxOrientation = (function () {
  const ROTATE_CLASS = "flux-rotate-landscape";

  const state = {
    rotation: 0,
    locked: false,
  };

  function isTouchDevice() {
    if (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches) {
      return true;
    }
    return "ontouchstart" in window || (navigator.maxTouchPoints | 0) > 0;
  }

  function isPortrait() {
    if (typeof window.matchMedia === "function") {
      return window.matchMedia("(orientation: portrait)").matches;
    }
    return window.innerHeight > window.innerWidth;
  }

  function applyRotation(rotation) {
    if (state.rotation === rotation) {
      return;
    }
    state.rotation = rotation;
    const root = document.documentElement;
    if (rotation === 90) {
      root.classList.add(ROTATE_CLASS);
    } else {
      root.classList.remove(ROTATE_CLASS);
    }
    // The client sizes itself from #game-host, and the host's layout box just changed.
    window.dispatchEvent(new Event("resize"));
  }

  function refresh() {
    if (!isTouchDevice()) {
      applyRotation(0);
      return;
    }
    applyRotation(isPortrait() ? 90 : 0);
  }

  function requestFullscreen(el) {
    const fn =
      el.requestFullscreen ||
      el.webkitRequestFullscreen ||
      el.webkitRequestFullScreen ||
      el.msRequestFullscreen;
    if (!fn) {
      return Promise.reject(new Error("fullscreen unsupported"));
    }
    try {
      return Promise.resolve(fn.call(el, { navigationUI: "hide" }));
    } catch (err) {
      return Promise.reject(err);
    }
  }

  /**
   * Best-effort native lock. Every step here is allowed to fail — iOS has no lock, and desktop
   * browsers reject it outright — so a rejection just leaves the CSS fallback in charge.
   */
  function tryNativeLock() {
    if (state.locked || !isTouchDevice()) {
      return;
    }
    const orientation = window.screen && window.screen.orientation;
    if (!orientation || typeof orientation.lock !== "function") {
      return;
    }
    const lock = function () {
      return orientation.lock("landscape").then(function () {
        state.locked = true;
        refresh();
      });
    };
    lock().catch(function () {
      // Chrome refuses to lock outside fullscreen; take the page fullscreen and retry once.
      requestFullscreen(document.documentElement)
        .then(lock)
        .catch(function () {});
    });
  }

  function install() {
    refresh();

    window.addEventListener("resize", refresh);
    window.addEventListener("orientationchange", refresh);
    if (window.screen && window.screen.orientation) {
      window.screen.orientation.addEventListener("change", refresh);
    }

    // The lock needs a user gesture. Keep trying until one succeeds: the first gesture is often
    // spent on a permission-style prompt, and fullscreen can be exited at any time.
    const onGesture = function () {
      tryNativeLock();
    };
    window.addEventListener("pointerdown", onGesture, { passive: true });
    window.addEventListener("touchend", onGesture, { passive: true });
    window.addEventListener("keydown", onGesture, { passive: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }

  return {
    /** 0 when the page is upright, 90 when the CSS fallback has rotated the host clockwise. */
    get rotation() {
      return state.rotation;
    },
    isTouchDevice,
    refresh,
  };
})();

window.FluxOrientation = FluxOrientation;
