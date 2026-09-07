/**
 * Bridge between the client's login state and the page's login screen.
 *
 * <p>The browser build does not draw a login screen on the canvas: the page draws it in HTML, the
 * same way it draws the loading screen. That leaves two directions to carry.
 *
 * <p><b>Client to page.</b> While the client sits on its login screen it calls {@link publish} once
 * per frame with a snapshot of its login state. The snapshot is forwarded to
 * {@code window.FluxLogin} only when it actually changed, so a Vue component can bind to it without
 * re-rendering fifty times a second.
 *
 * <p><b>Page to client.</b> The page queues commands here and the client drains them from its own
 * thread on the next frame. This is the same arrangement {@code web/input.js} uses: nothing calls
 * into the client, because there is no safe moment to do so from the outside.
 *
 * <p>Whether the login screen is up at all is inferred rather than announced. {@link frame} runs on
 * every painted frame; if the client did not publish during that frame, it was not on the login
 * screen, and the page hides the overlay.
 */
const WebLogin = (function () {
  const FIELD = "\n";

  let commands = [];
  let publishedThisFrame = false;
  let active = false;
  let lastState = "";
  let lastWorlds = "";
  let lastPlayer = "";
  let worlds = [];

  function sink() {
    return window.FluxLogin;
  }

  function emit() {
    const target = sink();
    if (!target || !target.state) {
      return;
    }
    if (!active) {
      target.state(null);
      return;
    }
    const parsed = JSON.parse(lastState);
    parsed.worlds = worlds;
    target.state(parsed);
  }

  /** Called by the client, once per frame, while its login screen is the active screen. */
  function publish(json) {
    publishedThisFrame = true;
    if (json === lastState && active) {
      return;
    }
    lastState = json;
    active = true;
    emit();
  }

  /**
   * The world list, published separately because it changes rarely and is by far the largest part
   * of the state. The client only calls this when its own list is replaced.
   */
  function publishWorlds(json) {
    if (json === lastWorlds) {
      return;
    }
    lastWorlds = json;
    worlds = JSON.parse(json);
    if (active) {
      emit();
    }
  }

  /**
   * The logged-in character.
   *
   * <p>Arrives while the login screen is gone, which is the point: the saved-player list is written
   * when the screen closes, before the client knows anything about the character it just logged in.
   * Skills land a moment after the login completes, so this is sent repeatedly and the page takes
   * the latest.
   */
  function publishPlayer(json) {
    if (json === lastPlayer) {
      return;
    }
    lastPlayer = json;
    const target = sink();
    if (target && target.player) {
      target.player(JSON.parse(json));
    }
  }

  /**
   * End of a painted frame.
   *
   * <p>A frame with no {@link publish} behind it means the client has moved off the login screen —
   * it logged in, or it is still loading — so the overlay goes away.
   */
  function frame() {
    const wasActive = active;
    active = publishedThisFrame;
    publishedThisFrame = false;
    if (wasActive && !active) {
      lastState = "";
      emit();
    }
  }

  function push() {
    commands.push(Array.prototype.join.call(arguments, FIELD));
  }

  /** Drained by the client on its own thread; empty string means nothing is queued. */
  function takeCommand() {
    return commands.length === 0 ? "" : commands.shift();
  }

  return {
    publish,
    publishWorlds,
    publishPlayer,
    frame,
    takeCommand,

    // Page-facing. Everything here only queues; the client applies it on its next frame.
    login: function (username, password, world) {
      push("login", username, password, String(world));
    },
    otp: function (code) {
      push("otp", code);
    },
    backToLogin: function () {
      push("back");
    },
    selectWorld: function (world) {
      push("world", String(world));
    },
    refreshWorlds: function () {
      push("refresh");
    },
    setMuted: function (muted) {
      push("mute", muted ? "1" : "0");
    },
  };
})();

window.WebLogin = WebLogin;
