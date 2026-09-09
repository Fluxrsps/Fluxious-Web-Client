const WebDevice = (function () {
  // Both APIs are Chromium-only; the unknown values below match what the desktop client returns.
  // Cached because the client runs a frame at a time and cannot await getBattery().

  const LEVEL_UNKNOWN = -1;

  const CONNECTION_UNKNOWN = 0;
  const CONNECTION_WIFI = 1;
  const CONNECTION_CELLULAR = 2;

  const state = {
    level: LEVEL_UNKNOWN,
    charging: false,
  };

  function readBattery(manager) {
    state.level = Math.round(manager.level * 100);
    state.charging = !!manager.charging;
  }

  function install() {
    if (typeof navigator.getBattery !== "function") {
      return;
    }
    navigator
      .getBattery()
      .then(function (manager) {
        readBattery(manager);
        const update = function () {
          readBattery(manager);
        };
        manager.addEventListener("levelchange", update);
        manager.addEventListener("chargingchange", update);
      })
      .catch(function () {});
  }

  install();

  return {
    // Whole percent, or -1 where the browser will not say.
    batteryLevel() {
      return state.level;
    },

    batteryCharging() {
      return state.charging;
    },

    // Reads `type`, not `effectiveType`: the latter is a speed bucket and says nothing about the
    // medium, so a fast phone on 5G would read as wi-fi.
    connectionType() {
      const connection = navigator.connection;
      if (!connection || !connection.type) {
        return CONNECTION_UNKNOWN;
      }
      if (connection.type === "wifi" || connection.type === "ethernet") {
        return CONNECTION_WIFI;
      }
      if (connection.type === "cellular") {
        return CONNECTION_CELLULAR;
      }
      return CONNECTION_UNKNOWN;
    },
  };
})();

window.WebDevice = WebDevice;
