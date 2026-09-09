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
  const CAMERA_DOWN = 10;

  const BUTTON_LEFT = 0;
  const BUTTON_MIDDLE = 1;
  const BUTTON_RIGHT = 2;

  const DRAG_SLOP = 12;
  const HOLD_MS = 500;
  const PINCH_STEP = 40;

  const GESTURE_NONE = 0;
  const GESTURE_PENDING = 1;
  const GESTURE_CAMERA = 2;
  const GESTURE_HOLD = 3;
  const GESTURE_PINCH = 4;

  let singleTap = false;
  let pinchZoom = true;

  const PREVENT_DEFAULT_KEYS = new Set([
    "Space",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Tab",
  ]);

  const VK_BACK_SPACE = 8;

  let queue = [];
  let attached = false;
  let keyboard = null;

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

  // A canvas cannot raise the keyboard, so a real text field is focused instead: transparent and a
  // pixel across, because a hidden or zero-sized one is ignored. Keystrokes are read from
  // `beforeinput` because Android IMEs report every character key as keycode 229.
  function createSoftKeyboard(canvas, focusCanvas) {
    const field = document.createElement("input");

    field.type = "text";
    field.setAttribute("autocomplete", "off");
    field.setAttribute("autocorrect", "off");
    field.setAttribute("autocapitalize", "off");
    field.setAttribute("spellcheck", "false");
    field.setAttribute("aria-hidden", "true");
    field.tabIndex = -1;
    field.style.cssText =
      "position:fixed;bottom:0;left:0;width:1px;height:1px;padding:0;border:0;" +
      "opacity:0;pointer-events:none;z-index:-1;";

    (canvas.parentElement || document.body).appendChild(field);

    function typeText(text) {
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        push(KEY_TYPED, code === 13 || code === 10 ? 10 : code);
      }
    }

    function backspace() {
      push(KEY_DOWN, VK_BACK_SPACE);
      push(KEY_UP, VK_BACK_SPACE);
    }

    field.addEventListener("beforeinput", (e) => {
      const type = e.inputType;

      if (type === "insertText" || type === "insertCompositionText") {
        if (e.data) {
          typeText(e.data);
        }
      } else if (type === "insertLineBreak" || type === "insertParagraph") {
        push(KEY_TYPED, 10);
      } else if (type === "deleteContentBackward" || type === "deleteWordBackward") {
        backspace();
      }

      e.preventDefault();
    });

    // Some IMEs commit regardless of the preventDefault above.
    field.addEventListener("input", () => {
      if (field.value !== "") {
        typeText(field.value);
        field.value = "";
      }
    });

    field.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        push(KEY_TYPED, 10);
        e.preventDefault();
      } else if (e.key === "Backspace") {
        backspace();
        e.preventDefault();
      }
    });

    return {
      // Read from the document rather than tracked: dismissing the keyboard with the system back
      // gesture leaves the field focused without firing blur, so a flag of our own goes stale and
      // the next tap re-raises the keyboard.
      isOpen() {
        return document.activeElement === field;
      },

      show() {
        field.value = "";
        try {
          field.focus({ preventScroll: true });
        } catch (err) {
          field.focus();
        }
      },

      hide() {
        field.blur();
        focusCanvas();
      },
    };
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

    // Also dismisses the keyboard, by taking focus off the hidden field: tapping the world is how
    // the mobile client closes it, and leaving it up would cover the game with no way to reach it.
    function focusCanvas() {
      try {
        canvas.focus({ preventScroll: true });
      } catch (err) {
        canvas.focus();
      }
    }

    keyboard = createSoftKeyboard(canvas, focusCanvas);

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

    // Every touch handler calls preventDefault, which is also what stops the browser synthesising
    // the mouse events the handlers above would otherwise see, delivering every gesture twice.

    let gesture = GESTURE_NONE;
    let holdTimer = 0;
    let startX = 0;
    let startY = 0;
    let pinchDistance = 0;

    function clearHold() {
      if (holdTimer !== 0) {
        window.clearTimeout(holdTimer);
        holdTimer = 0;
      }
    }

    function tap(x, y, button) {
      push(MOVE, x, y);
      push(DOWN, x, y, button, 0);
      push(UP);
    }

    // The point between two fingers, in game pixels. Rotating follows this rather than either
    // finger, so spreading and pinching about a fixed centre does not drag the camera with it.
    function touchMidpoint(a, b) {
      return canvasCoords(canvas, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
    }

    function touchDistance(a, b) {
      const dx = a.clientX - b.clientX;
      const dy = a.clientY - b.clientY;

      return Math.sqrt(dx * dx + dy * dy);
    }

    canvas.addEventListener(
      "touchstart",
      (e) => {
        focusCanvas();
        e.preventDefault();

        if (e.touches.length >= 2) {
          // Another finger landing during a pinch only re-bases the measurements: the camera button
          // is already held, and pressing it again would leave a press with no release.
          if (gesture === GESTURE_PINCH) {
            pinchDistance = touchDistance(e.touches[0], e.touches[1]);
            return;
          }

          // A second finger mid-gesture: release whatever the first one had already pressed.
          clearHold();
          if (gesture === GESTURE_CAMERA || gesture === GESTURE_HOLD) {
            push(UP);
          }
          gesture = GESTURE_PINCH;
          pinchDistance = touchDistance(e.touches[0], e.touches[1]);

          // Held for as long as two fingers are down, so the midpoint's movement rotates the
          // camera while the distance between them zooms it.
          const start = touchMidpoint(e.touches[0], e.touches[1]);
          push(CAMERA_DOWN, start.x, start.y);
          return;
        }

        if (gesture === GESTURE_PINCH) {
          return;
        }

        const p = canvasCoords(canvas, e.touches[0].clientX, e.touches[0].clientY);
        startX = p.x;
        startY = p.y;
        gesture = GESTURE_PENDING;

        // The client picks its menu from where the cursor is, so move before any press.
        push(MOVE, p.x, p.y);

        clearHold();
        holdTimer = window.setTimeout(() => {
          holdTimer = 0;
          if (gesture !== GESTURE_PENDING) {
            return;
          }
          gesture = GESTURE_HOLD;
          push(DOWN, startX, startY, BUTTON_RIGHT, 0);
        }, HOLD_MS);
      },
      { passive: false }
    );

    canvas.addEventListener(
      "touchmove",
      (e) => {
        e.preventDefault();

        if (gesture === GESTURE_PINCH) {
          if (e.touches.length < 2) {
            return;
          }

          // Rotate and zoom off the same move: the camera button is already held, so the midpoint
          // drives rotation while the distance drives the wheel, and neither waits for the other.
          const mid = touchMidpoint(e.touches[0], e.touches[1]);
          push(MOVE, mid.x, mid.y);

          if (!pinchZoom) {
            return;
          }

          const distance = touchDistance(e.touches[0], e.touches[1]);
          const steps = (distance - pinchDistance) / PINCH_STEP;
          if (steps >= 1 || steps <= -1) {
            const notches = steps > 0 ? Math.floor(steps) : Math.ceil(steps);
            for (let i = 0; i < Math.abs(notches); i++) {
              push(WHEEL, notches > 0 ? -1 : 1);
            }
            pinchDistance += notches * PINCH_STEP;
          }
          return;
        }

        if (e.touches.length !== 1) {
          return;
        }

        const p = canvasCoords(canvas, e.touches[0].clientX, e.touches[0].clientY);

        if (gesture === GESTURE_PENDING) {
          if (Math.abs(p.x - startX) < DRAG_SLOP && Math.abs(p.y - startY) < DRAG_SLOP) {
            return;
          }
          // Pressed at the origin so the client's drag delta starts where the finger landed.
          clearHold();
          gesture = GESTURE_CAMERA;
          push(CAMERA_DOWN, startX, startY);
        }

        if (gesture === GESTURE_CAMERA || gesture === GESTURE_HOLD) {
          push(MOVE, p.x, p.y);
        }
      },
      { passive: false }
    );

    function endTouch(e) {
      e.preventDefault();

      if (e.touches.length > 0) {
        // Lifting one finger out of a pinch must not fire a tap.
        return;
      }

      clearHold();

      if (gesture === GESTURE_CAMERA || gesture === GESTURE_HOLD || gesture === GESTURE_PINCH) {
        push(UP);
      } else if (gesture === GESTURE_PENDING) {
        tap(startX, startY, singleTap ? BUTTON_RIGHT : BUTTON_LEFT);
      }

      gesture = GESTURE_NONE;
    }

    canvas.addEventListener("touchend", endTouch, { passive: false });
    canvas.addEventListener("touchcancel", endTouch, { passive: false });

    canvas.addEventListener("keydown", (e) => {
      const code = domKeyCode(e);
      if (code !== 0) {
        push(KEY_DOWN, code);
      }
      if (
        PREVENT_DEFAULT_KEYS.has(e.code) ||
        (e.code && e.code.startsWith("F") && e.code.length <= 3)
      ) {
        if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key && e.key.length === 1) {
          push(KEY_TYPED, e.key.charCodeAt(0));
        }
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

  return {
    attach,
    takeEventBatch,

    setSingleTap(enabled) {
      singleTap = !!enabled;
    },

    setPinchZoom(enabled) {
      pinchZoom = !!enabled;
    },

    // Must be called from inside a user gesture, or the keyboard will not appear.
    showKeyboard() {
      if (keyboard !== null) {
        keyboard.show();
      }
    },

    hideKeyboard() {
      if (keyboard !== null) {
        keyboard.hide();
      }
    },

    isKeyboardOpen() {
      return keyboard !== null && keyboard.isOpen();
    },

    toggleKeyboard() {
      if (keyboard === null) {
        return;
      }
      if (keyboard.isOpen()) {
        keyboard.hide();
      } else {
        keyboard.show();
      }
    },
  };
})();

window.WebInput = WebInput;
