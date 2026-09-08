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

  function publish(json) {
    publishedThisFrame = true;
    if (json === lastState && active) {
      return;
    }
    lastState = json;
    active = true;
    emit();
  }

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

  function takeCommand() {
    return commands.length === 0 ? "" : commands.shift();
  }

  return {
    publish,
    publishWorlds,
    publishPlayer,
    frame,
    takeCommand,

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
