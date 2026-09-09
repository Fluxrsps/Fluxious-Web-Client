const FluxOrientation = (function () {
  const ROTATE_CLASS = "flux-rotate-landscape";

  const state = {
    rotation: 0,
    locked: false,
    lockAttempted: false,
  };

  // The hosting page decides this, and publishes the answer as `data-flux-mobile` on the document,
  // so the rotation, the login screen's layout and the plugin sidebar cannot disagree about what a
  // phone is. The test below is the fallback for this script running without that page.
  //
  // A touchscreen laptop reports touch points and still has a mouse, so requiring the absence of
  // hover keeps the orientation lock — and the fullscreen fallback it triggers — off desktops.
  function isTouchDevice() {
    const decided = document.documentElement.getAttribute("data-flux-mobile");
    if (decided === "1") {
      return true;
    }
    if (decided === "0") {
      return false;
    }
    if (typeof window.matchMedia !== "function") {
      return "ontouchstart" in window || (navigator.maxTouchPoints | 0) > 0;
    }
    return (
      window.matchMedia("(pointer: coarse)").matches && window.matchMedia("(hover: none)").matches
    );
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

  function tryNativeLock() {
    // Once per page load: the fallback below enters fullscreen, so a lock that keeps failing must
    // not retry on every click.
    if (state.locked || state.lockAttempted || !isTouchDevice() || !isPortrait()) {
      return;
    }
    const orientation = window.screen && window.screen.orientation;
    if (!orientation || typeof orientation.lock !== "function") {
      return;
    }
    state.lockAttempted = true;
    const lock = function () {
      return orientation.lock("landscape").then(function () {
        state.locked = true;
        refresh();
      });
    };
    lock().catch(function () {
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
    get rotation() {
      return state.rotation;
    },
    isTouchDevice,
    refresh,
  };
})();

window.FluxOrientation = FluxOrientation;
