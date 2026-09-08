const WebInput = (function () {
  const MOVE = 1;
  const DOWN = 2;
  const UP = 3;
  const LEAVE = 4;
  const WHEEL = 5;
  const KEY_DOWN = 6;
  const KEY_UP = 7;
  const KEY_TYPED = 8;
  const FOCUS = 9;

  const PREVENT_DEFAULT_KEYS = new Set([
    "Space",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Tab",
  ]);

  let queue = [];
  let attached = false;

  function push() {
    for (let i = 0; i < arguments.length; i++) {
      queue.push(arguments[i] | 0);
    }
  }

  function takeEventBatch() {
    if (queue.length === 0) {
      return null;
    }
    const batch = queue;
    queue = [];
    return batch;
  }

  function canvasCoords(canvas, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const stats = window.__clientStats;
    const gameW =
      stats && stats.canvasW > 0 ? stats.canvasW | 0 : canvas.width | 0;
    const gameH =
      stats && stats.canvasH > 0 ? stats.canvasH | 0 : canvas.height | 0;
    if (rect.width <= 0 || rect.height <= 0) {
      return { x: 0, y: 0 };
    }

    let u;
    let v;
    if (window.FluxOrientation && window.FluxOrientation.rotation === 90) {
      const boxW = rect.height;
      const boxH = rect.width;
      const dx = clientX - (rect.left + rect.width / 2);
      const dy = clientY - (rect.top + rect.height / 2);
      u = (dy + boxW / 2) / boxW;
      v = (boxH / 2 - dx) / boxH;
    } else {
      u = (clientX - rect.left) / rect.width;
      v = (clientY - rect.top) / rect.height;
    }

    const x = Math.floor(u * gameW);
    const y = Math.floor(v * gameH);
    return {
      x: Math.max(0, Math.min(gameW - 1, x)),
      y: Math.max(0, Math.min(gameH - 1, y)),
    };
  }

  function domKeyCode(e) {
    if (e.code === "Enter" || e.code === "NumpadEnter") {
      return 10;
    }
    if (e.keyCode != null && e.keyCode !== 0) {
      if (e.keyCode === 13) {
        return 10;
      }
      return e.keyCode;
    }
    if (e.which != null && e.which !== 0) {
      if (e.which === 13) {
        return 10;
      }
      return e.which;
    }
    return 0;
  }

  function attach(canvasId) {
    if (attached) {
      return true;
    }
    const canvas = document.getElementById(canvasId);
    if (!canvas) {
      throw new Error("WebInput: canvas not found: " + canvasId);
    }
    attached = true;

    canvas.tabIndex = 0;
    canvas.style.outline = "none";

    function focusCanvas() {
      try {
        canvas.focus({ preventScroll: true });
      } catch (err) {
        canvas.focus();
      }
    }

    let pressed = false;

    canvas.addEventListener("mousedown", (e) => {
      focusCanvas();
      const p = canvasCoords(canvas, e.clientX, e.clientY);
      const flags = (e.altKey ? 1 : 0) | (e.metaKey ? 2 : 0);
      pressed = true;
      push(DOWN, p.x, p.y, e.button, flags);
      e.preventDefault();
    });

    function releaseOnce() {
      if (pressed) {
        pressed = false;
        push(UP);
      }
    }

    canvas.addEventListener("mouseup", releaseOnce);
    window.addEventListener("mouseup", releaseOnce);

    canvas.addEventListener("mousemove", (e) => {
      const p = canvasCoords(canvas, e.clientX, e.clientY);
      push(MOVE, p.x, p.y);
    });

    canvas.addEventListener("mouseleave", () => {
      push(LEAVE);
    });

    canvas.addEventListener(
      "wheel",
      (e) => {
        const delta = e.deltaY > 0 ? 1 : e.deltaY < 0 ? -1 : 0;
        if (delta !== 0) {
          push(WHEEL, delta);
        }
        e.preventDefault();
      },
      { passive: false }
    );

    canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
    });

    canvas.addEventListener("keydown", (e) => {
      const code = domKeyCode(e);
      if (code !== 0) {
        push(KEY_DOWN, code);
      }
      if (
        PREVENT_DEFAULT_KEYS.has(e.code) ||
        (e.code && e.code.startsWith("F") && e.code.length <= 3)
      ) {
        e.preventDefault();
      }
    });

    canvas.addEventListener("keyup", (e) => {
      const code = domKeyCode(e);
      if (code !== 0) {
        push(KEY_UP, code);
      }
      if (PREVENT_DEFAULT_KEYS.has(e.code)) {
        e.preventDefault();
      }
    });

    canvas.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        push(KEY_TYPED, 10);
        e.preventDefault();
        return;
      }
      if (e.charCode != null && e.charCode !== 0) {
        const ch = e.charCode === 13 ? 10 : e.charCode;
        push(KEY_TYPED, ch);
        e.preventDefault();
      }
    });

    window.addEventListener("blur", () => {
      push(FOCUS, 0);
    });

    canvas.addEventListener("focus", () => {
      push(FOCUS, 1);
    });

    canvas.addEventListener("blur", () => {
      push(FOCUS, 0);
    });

    focusCanvas();
    return true;
  }

  return { attach, takeEventBatch };
})();

window.WebInput = WebInput;
