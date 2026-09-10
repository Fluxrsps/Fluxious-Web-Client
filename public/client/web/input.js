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

  // Moving straight away swings the camera; resting the finger first and then moving drags with the
  // left button held, which is what the client wants for an inventory item, a scrollbar or a
  // slider. Nothing here can tell what the finger landed on — the client alone knows that — so how
  // long it waited before moving is what picks between the two. Holding still past HOLD_MS is
  // still the menu, so the window to start a drag runs from here to there.
  let dragDwellMs = 180;

  // Long enough for the tap to reach the client and its keyboard script to run: a tap is delivered
  // on touchend and the client acts on it a frame later.
  const DISMISS_DELAY_MS = 400;

  // How long after such a tap a show from the client still counts as that tap's answer. Longer than
  // the dismiss, to cover a press held past it and a client busy enough to answer a tick or two
  // late.
  const TOGGLE_WINDOW_MS = 900;

  const GESTURE_NONE = 0;
  const GESTURE_PENDING = 1;
  const GESTURE_CAMERA = 2;
  const GESTURE_HOLD = 3;
  const GESTURE_PINCH = 4;
  const GESTURE_DRAG = 5;

  // Two fingers can mean zoom or rotate, and doing both at once is why a pinch used to swing the
  // camera: no one pinches without the point between their fingers wandering. Whichever the hands
  // commit to first is what the gesture stays as until a finger lifts.
  const PINCH_UNDECIDED = 0;
  const PINCH_ZOOM = 1;
  const PINCH_ROTATE = 2;

  // In CSS pixels, measured from where the fingers landed. Rotating asks for more travel than
  // zooming, so a pinch that drifts loses the race to the spread that caused the drift.
  const PINCH_ZOOM_SLOP = 16;
  const PINCH_ROTATE_SLOP = 32;

  // Holding opens the menu; sliding onto an entry, resting on it and lifting picks it, the way the
  // mobile client does. Only after the finger has moved into the menu - lifting straight off the
  // press that opened it leaves the menu up, since the cursor is on the title bar at that point.
  let hoverClickMs = 200;
  // How far the finger has to travel to count as having moved to a different entry.
  const HOVER_SLOP = 6;

  let singleTap = false;
  let pinchZoom = true;
  let keyboardDebug = false;

  // Whether the client says the cursor is over something draggable; see WebCallbacks.
  let dragTarget = false;

  // `navigator.vibrate` is Android only: iOS has no vibration API in the browser at all, so this
  // does nothing there. Inside the Android wrapper it additionally needs the VIBRATE permission in
  // the manifest, or the call returns without buzzing.
  //
  // Milliseconds, or an on/off pattern such as [10, 30, 10] for a double tick. Short is the point:
  // these fire mid-gesture, and anything longer reads as the phone stuttering.
  const hapticPatterns = {
    op: 8,
    menu: 18,
    drag: 12,
    drop: 10,
  };
  let hapticsEnabled = true;

  // The game's own haptic settings, republished by the client whenever the varbits behind them
  // change (WebCallbacks.publishHapticPolicy). Everything is on until the client says otherwise,
  // which is what those settings default to; `hover` is the one that defaults off.
  const hapticPolicy = {
    op: true,
    drag: true,
    menu: true,
    hover: false,
  };

  // A drop is the end of a drag, so the drag setting covers both.
  const HAPTIC_SETTING = {
    op: "op",
    menu: "menu",
    drag: "drag",
    drop: "drag",
    hover: "hover",
  };

  function haptic(kind) {
    if (!hapticsEnabled || typeof navigator.vibrate !== "function") {
      return;
    }
    if (!hapticPolicy[HAPTIC_SETTING[kind]]) {
      return;
    }
    const pattern = hapticPatterns[kind];
    if (!pattern) {
      return;
    }
    try {
      navigator.vibrate(pattern);
    } catch (err) {
      /* a browser that refuses the pattern is not worth a broken gesture */
    }
  }

  const PREVENT_DEFAULT_KEYS = new Set([
    "Space",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Tab",
  ]);

  const VK_BACK_SPACE = 8;
  const VK_ENTER = 10;

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

    let dismissTimer = 0;
    let dismissRequestedAt = 0;

    field.type = "text";
    field.setAttribute("autocomplete", "off");
    field.setAttribute("autocorrect", "off");
    field.setAttribute("autocapitalize", "off");
    field.setAttribute("spellcheck", "false");
    field.setAttribute("aria-hidden", "true");
    // Without this the IME labels the action key "Go" or "Done", which some of them treat as
    // submitting the field rather than as a key, so no Enter is reported at all.
    field.setAttribute("enterkeyhint", "enter");
    field.tabIndex = -1;
    field.style.cssText =
      "position:fixed;bottom:0;left:0;width:1px;height:1px;padding:0;border:0;" +
      "opacity:0;pointer-events:none;z-index:-1;";

    (canvas.parentElement || document.body).appendChild(field);

    // The typed character alone is not enough: sending a chat line and continuing a dialogue are
    // key bindings, and the client reads those from the press, the way the canvas keydown handler
    // reports a desktop Enter.
    function enter() {
      push(KEY_DOWN, VK_ENTER);
      push(KEY_TYPED, 10);
      push(KEY_UP, VK_ENTER);
    }

    function typeText(text) {
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code === 13 || code === 10) {
          enter();
        } else {
          push(KEY_TYPED, code);
        }
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
        enter();
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
        enter();
        e.preventDefault();
      } else if (e.key === "Backspace") {
        backspace();
        e.preventDefault();
      }
    });

    // Read from the document rather than tracked: dismissing the keyboard with the system back
    // gesture leaves the field focused without firing blur, so a flag of our own goes stale and
    // the next tap re-raises the keyboard.
    function isOpen() {
      return document.activeElement === field;
    }

    function cancelDismiss() {
      if (dismissTimer !== 0) {
        window.clearTimeout(dismissTimer);
        dismissTimer = 0;
      }
      dismissRequestedAt = 0;
    }

    function show() {
      // The interface asks to show on every press of its keyboard button, the press meant to close
      // it included: on a real phone the toggle is the native client's to keep, and here that is
      // us. A show arriving just after a tap that began with the keyboard already up is that second
      // press, so it closes rather than raising the keyboard again.
      if (dismissRequestedAt !== 0 && Date.now() - dismissRequestedAt < TOGGLE_WINDOW_MS) {
        hide();
        return;
      }

      cancelDismiss();
      field.value = "";
      try {
        field.focus({ preventScroll: true });
      } catch (err) {
        field.focus();
      }
    }

    function hide() {
      cancelDismiss();
      field.blur();
      focusCanvas();
    }

    return {
      isOpen,
      show,
      hide,

      // Tapping the world is how the mobile client dismisses the keyboard, but the keyboard button
      // is a tap too, and the client's show/hide for it only reaches us a tick later. Dismissing
      // straight from the touch handler hid the keyboard before the button's script ran, so the
      // script's show raised it again. The dismiss waits instead, and the tap is remembered for a
      // little longer than that so a slow press - where the dismiss has already run by the time the
      // client answers - still reads as the toggle it was.
      dismissSoon() {
        if (!isOpen() || dismissTimer !== 0) {
          return;
        }
        dismissRequestedAt = Date.now();
        dismissTimer = window.setTimeout(() => {
          dismissTimer = 0;
          field.blur();
          focusCanvas();
        }, DISMISS_DELAY_MS);
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

    function focusCanvas() {
      try {
        canvas.focus({ preventScroll: true });
      } catch (err) {
        canvas.focus();
      }
    }

    keyboard = createSoftKeyboard(canvas, focusCanvas);

    // Focus for a press that starts a gesture. While the keyboard is up, taking focus back would
    // close it before the client has seen the tap, so the dismiss is deferred and the client's own
    // show or hide for that tap wins over it.
    function focusForTap() {
      if (keyboard !== null && keyboard.isOpen()) {
        keyboard.dismissSoon();
        return;
      }
      focusCanvas();
    }

    let pressed = false;

    canvas.addEventListener("mousedown", (e) => {
      focusForTap();
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
    let startTime = 0;
    let pinchDistance = 0;
    let pinchStartDistance = 0;
    let pinchStartMidX = 0;
    let pinchStartMidY = 0;
    let pinchMode = PINCH_UNDECIDED;
    let cameraHeld = false;
    let hoverX = 0;
    let hoverY = 0;
    let hoverSince = 0;

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
        focusForTap();
        e.preventDefault();

        if (e.touches.length >= 2) {
          // Another finger landing during a pinch only re-bases the measurements: whatever the
          // gesture had settled on is already under way and pressing again would leave a press with
          // no release.
          if (gesture === GESTURE_PINCH) {
            pinchDistance = touchDistance(e.touches[0], e.touches[1]);
            return;
          }

          // A drag holds the left button over something the client is carrying, and the camera
          // holds the middle button; running both at once means the item is dropped wherever the
          // camera happens to leave the cursor. The drag started first, so it keeps the gesture and
          // the extra fingers are ignored until it ends.
          if (gesture === GESTURE_DRAG) {
            return;
          }

          // A second finger mid-gesture: release whatever the first one had already pressed.
          clearHold();
          if (gesture === GESTURE_CAMERA || gesture === GESTURE_HOLD) {
            push(UP);
            cameraHeld = false;
          }
          gesture = GESTURE_PINCH;
          pinchDistance = touchDistance(e.touches[0], e.touches[1]);
          pinchStartDistance = pinchDistance;
          pinchStartMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
          pinchStartMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

          // Nothing is pressed yet: the camera button only goes down if the fingers turn out to be
          // rotating, so a zoom never drags the camera with it.
          pinchMode = PINCH_UNDECIDED;
          return;
        }

        if (gesture === GESTURE_PINCH) {
          return;
        }

        const p = canvasCoords(canvas, e.touches[0].clientX, e.touches[0].clientY);
        startX = p.x;
        startY = p.y;
        startTime = Date.now();
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
          haptic("menu");
          // Zero until the finger moves: the press that opened the menu is not a hover over one of
          // its entries.
          hoverSince = 0;
          hoverX = startX;
          hoverY = startY;
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

          const distance = touchDistance(e.touches[0], e.touches[1]);

          if (pinchMode === PINCH_UNDECIDED) {
            const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            const midTravel = Math.hypot(midX - pinchStartMidX, midY - pinchStartMidY);
            const spread = Math.abs(distance - pinchStartDistance);

            if (pinchZoom && spread >= PINCH_ZOOM_SLOP) {
              pinchMode = PINCH_ZOOM;
              // Measured from here, so the spread that decided it is not also zoomed through.
              pinchDistance = distance;
            } else if (midTravel >= PINCH_ROTATE_SLOP) {
              pinchMode = PINCH_ROTATE;
              const start = touchMidpoint(e.touches[0], e.touches[1]);
              push(CAMERA_DOWN, start.x, start.y);
              cameraHeld = true;
            } else {
              return;
            }
          }

          if (pinchMode === PINCH_ROTATE) {
            const mid = touchMidpoint(e.touches[0], e.touches[1]);
            push(MOVE, mid.x, mid.y);
            return;
          }

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
          // Both are pressed at the origin so the client's drag delta starts where the finger
          // landed: for a widget drag that is also the slot the client picks the item up from.
          clearHold();
          // The client has already said whether the finger landed on something it can drag, so no
          // pause is needed over an item; the dwell is the fallback for the world and for a client
          // that has not answered yet.
          if (dragTarget || Date.now() - startTime >= dragDwellMs) {
            gesture = GESTURE_DRAG;
            push(DOWN, startX, startY, BUTTON_LEFT, 0);
            haptic("drag");
          } else {
            gesture = GESTURE_CAMERA;
            push(CAMERA_DOWN, startX, startY);
            cameraHeld = true;
          }
        }

        if (gesture === GESTURE_CAMERA || gesture === GESTURE_HOLD || gesture === GESTURE_DRAG) {
          push(MOVE, p.x, p.y);
        }

        // The rest restarts whenever the finger moves off the entry it was over, so the dwell is
        // measured against the entry that is about to be picked, not the whole gesture.
        if (gesture === GESTURE_HOLD) {
          if (Math.abs(p.x - hoverX) >= HOVER_SLOP || Math.abs(p.y - hoverY) >= HOVER_SLOP) {
            hoverX = p.x;
            hoverY = p.y;
            hoverSince = Date.now();
          }
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

      // A pinch that only ever zoomed pressed nothing, so it has nothing to release.
      if (
        gesture === GESTURE_CAMERA ||
        gesture === GESTURE_HOLD ||
        gesture === GESTURE_DRAG ||
        (gesture === GESTURE_PINCH && cameraHeld)
      ) {
        // The release lands where the finger was last reported, which is the slot a dragged item
        // is dropped on.
        push(UP);
        cameraHeld = false;
        if (gesture === GESTURE_DRAG) {
          haptic("drop");
        }

        // Releasing the button that opened the menu selects nothing, so resting on an entry and
        // lifting is answered with the click the client is waiting for.
        if (
          gesture === GESTURE_HOLD &&
          hoverSince !== 0 &&
          Date.now() - hoverSince >= hoverClickMs
        ) {
          tap(hoverX, hoverY, BUTTON_LEFT);
          haptic("op");
        }
      } else if (gesture === GESTURE_PENDING) {
        tap(startX, startY, singleTap ? BUTTON_RIGHT : BUTTON_LEFT);
        // A tap is what performs an op, including picking an entry out of an open menu.
        haptic("op");
      }

      gesture = GESTURE_NONE;
      pinchMode = PINCH_UNDECIDED;
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

    // How long a finger must rest before moving counts as a drag rather than a camera swing. Must
    // stay under the 500 ms hold that opens the menu, or a drag can never start.
    setDragDwell(ms) {
      dragDwellMs = ms > 0 ? ms | 0 : 0;
    },

    // How long a finger has to rest on a menu entry before lifting picks it. 0 picks whatever the
    // finger is over however briefly it paused there.
    setHoverClickDelay(ms) {
      hoverClickMs = ms > 0 ? ms | 0 : 0;
    },

    setHapticsEnabled(enabled) {
      hapticsEnabled = !!enabled;
    },

    // Called by the client each time the cursor moves onto or off something it can drag.
    setDragTarget(draggable) {
      dragTarget = !!draggable;
    },

    isOverDragTarget() {
      return dragTarget;
    },

    // Called by the client from the game's haptic settings; see WebJs.setHapticPolicy.
    setHapticPolicy(op, drag, menu, hover) {
      hapticPolicy.op = !!op;
      hapticPolicy.drag = !!drag;
      hapticPolicy.menu = !!menu;
      hapticPolicy.hover = !!hover;
    },

    getHapticPolicy() {
      return Object.assign({}, hapticPolicy);
    },

    hapticsSupported() {
      return typeof navigator.vibrate === "function";
    },

    // `kind` is "menu", "drag" or "drop"; `pattern` is milliseconds or an on/off array such as
    // [10, 30, 10]. 0 turns that one off without touching the others.
    setHapticPattern(kind, pattern) {
      if (Object.prototype.hasOwnProperty.call(hapticPatterns, kind)) {
        hapticPatterns[kind] = pattern;
      }
    },

    getHapticPatterns() {
      return Object.assign({}, hapticPatterns);
    },

    // For trying patterns out from the console.
    testHaptic(kind) {
      haptic(kind);
    },

    // Reports which of the client's keyboard scripts actually ran, for telling a button that never
    // asks to close apart from one whose close is being undone.
    setKeyboardDebug(enabled) {
      keyboardDebug = !!enabled;
    },

    // Must be called from inside a user gesture, or the keyboard will not appear.
    showKeyboard() {
      if (keyboardDebug) {
        console.log("WebInput: client asked to show keyboard");
      }
      if (keyboard !== null) {
        keyboard.show();
      }
    },

    hideKeyboard() {
      if (keyboardDebug) {
        console.log("WebInput: client asked to hide keyboard");
      }
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
