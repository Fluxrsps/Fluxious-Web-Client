const WebCanvas = (function () {
  let canvas = null;
  let ctx = null;
  let imageData = null;
  let scaleBuffer = null;
  let scaleCtx = null;

  // Interfaces are drawn at a fixed pixel size, so how large they appear is decided entirely by how
  // many pixels the client is given: the mobile toplevel's touch-sized widgets over a host's ~850
  // CSS pixels swallow the screen and run into the minimap. The mobile client draws at the device's
  // own resolution, which is what makes the same widgets sit small on a 2340x1080 phone, so that is
  // what is asked for here - CSS then scales the canvas back to the element, one game pixel per
  // device pixel.
  //
  // The 765x503 floor is separate and applies whatever the density: below it the fixed-mode layout
  // has panels overlapping regardless.
  const MIN_GAME_WIDTH = 765;
  const MIN_GAME_HEIGHT = 503;
  // Phone pixel ratios run to 4, and a frame that size costs more than the layout is worth, so the
  // automatic choice stops at 2. A caller can still ask for more.
  const MAX_AUTO_SCALE = 2;
  const MAX_RENDER_SCALE = 4;

  // 0 picks the scale from the host size; anything else is the caller's own choice.
  let renderScale = 0;

  /**
   * How large the interface should be drawn, as a percentage of the automatic choice.
   *
   * Interfaces are a fixed number of game pixels, so their size on screen is decided entirely by how
   * many game pixels the canvas has: fewer pixels over the same element makes each one bigger, which
   * is what "zoomed in" means here. So this divides the render scale rather than multiplying it.
   *
   * The default is above 100 on a phone. Matching the device's pixel density - what 100 means - is
   * what the real mobile client does, and it leaves the touch-sized widgets of the mobile layout
   * looking small on a dense screen; a hand-held screen wants them larger than that.
   *
   * How far it can actually go is limited by the floor below, because the mobile layout's widgets
   * start running into each other and into the minimap once the game surface gets too small.
   */
  const DEFAULT_UI_SCALE_MOBILE = 150;
  const DEFAULT_UI_SCALE_DESKTOP = 100;
  const MIN_UI_SCALE = 50;
  const MAX_UI_SCALE = 200;

  /**
   * Where the player's choice is stored.
   *
   * Read straight out of storage rather than waited for from the plugin that owns the setting: the
   * canvas is sized before any plugin has started, and a first frame at the wrong scale would resize
   * the client a moment later - which the client answers by rebuilding its buffers and relaying out
   * every interface. Same key the config store writes; see `configStore.ts`.
   */
  const UI_SCALE_KEY = "flux.config.fluxious.uiScale";

  let uiScalePercent = 0;

  function clampUiScale(percent) {
    return Math.max(MIN_UI_SCALE, Math.min(MAX_UI_SCALE, percent));
  }

  function storedUiScale() {
    try {
      const raw = window.localStorage.getItem(UI_SCALE_KEY);
      if (raw !== null && raw !== "") {
        const parsed = parseFloat(raw);
        if (isFinite(parsed) && parsed > 0) {
          return clampUiScale(parsed);
        }
      }
    } catch (ignored) {
      // Blocked or private-mode storage throws rather than answering null; the default is fine.
    }
    return isMobileHost() ? DEFAULT_UI_SCALE_MOBILE : DEFAULT_UI_SCALE_DESKTOP;
  }

  function currentUiScale() {
    if (uiScalePercent === 0) {
      uiScalePercent = storedUiScale();
    }
    return uiScalePercent;
  }

  // The hosting page decides what a phone is and publishes it, the same source web/orientation.js
  // reads, so the rotation and the render scale cannot disagree.
  function isMobileHost() {
    const decided = document.documentElement.getAttribute("data-flux-mobile");
    if (decided === "1") {
      return true;
    }
    if (decided === "0") {
      return false;
    }
    return !!(window.FluxOrientation && window.FluxOrientation.isTouchDevice());
  }

  function scaleFor(w, h) {
    if (renderScale > 0) {
      return Math.min(MAX_RENDER_SCALE, renderScale);
    }

    // One game pixel per CSS pixel on a desktop, the device's own pixels on a phone. See the note on
    // the constants above for why the two differ.
    let automatic = 1;

    if (isMobileHost()) {
      const density = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
      automatic = Math.min(MAX_AUTO_SCALE, density);
    }

    const scale = currentUiScale();

    if (scale === 100) {
      return automatic;
    }

    // The player's zoom divides it: fewer game pixels over the same element is a larger interface.
    // The floor still wins, because past it the layout overlaps itself whatever was asked for.
    const floor = Math.max(MIN_GAME_WIDTH / w, MIN_GAME_HEIGHT / h);

    return Math.max(floor, Math.min(MAX_RENDER_SCALE, automatic / (scale / 100)));
  }

  // Both axes take the same scale, so the canvas keeps the host's aspect and CSS scales it without
  // distortion.
  function hostSize() {
    const host = document.getElementById("game-host");
    if (!host) {
      return { width: MIN_GAME_WIDTH, height: MIN_GAME_HEIGHT };
    }
    const w = Math.max(1, host.clientWidth | 0);
    const h = Math.max(1, host.clientHeight | 0);
    const scale = scaleFor(w, h);
    return {
      width: Math.max(1, Math.round(w * scale)),
      height: Math.max(1, Math.round(h * scale)),
    };
  }

  function ensureScaleBuffer(w, h) {
    if (!scaleBuffer || scaleBuffer.width !== w || scaleBuffer.height !== h) {
      scaleBuffer = document.createElement("canvas");
      scaleBuffer.width = w;
      scaleBuffer.height = h;
      scaleCtx = scaleBuffer.getContext("2d", { alpha: false });
    }
    return scaleCtx;
  }

  function setStretchHostClass(on) {
    const host = document.getElementById("game-host");
    if (!host) return;
    if (on) {
      host.classList.add("game-host--stretched");
    } else {
      host.classList.remove("game-host--stretched");
    }
  }

  function setSize(w, h) {
    if (!canvas) {
      return;
    }
    w = Math.max(1, w | 0);
    h = Math.max(1, h | 0);
    const stats = window.__clientStats;
    const gameW =
      stats && stats.canvasW > 0 ? stats.canvasW | 0 : 765;
    const gameH =
      stats && stats.canvasH > 0 ? stats.canvasH | 0 : 503;
    const stretched = w > gameW + 2 || h > gameH + 2;
    setStretchHostClass(stretched);
    if (canvas.width === w && canvas.height === h) {
      return;
    }
    canvas.width = w;
    canvas.height = h;

    if (ctx) {
      imageData = ctx.createImageData(w, h);
    } else if (window.WebGpu) {
      window.WebGpu.resize(w, h);
    }
  }

  function attach(canvasId) {
    canvas = document.getElementById(canvasId);
    if (!canvas) {
      throw new Error("Canvas not found: " + canvasId);
    }
    // A canvas has one kind of context for its lifetime, so the GPU has to have been asked first;
    // boot does that before the client starts. When it took the canvas, there is no 2D context to
    // get and every frame goes through WebGpu.blit instead.
    if (window.WebGpu && window.WebGpu.ready) {
      ctx = null;
    } else {
      ctx = canvas.getContext("2d", { alpha: false });
      imageData = ctx.createImageData(canvas.width, canvas.height);
    }
    const host = document.getElementById("game-host");
    if (host && typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(function () {
        window.dispatchEvent(new Event("resize"));
      });
      ro.observe(host);
    }
  }

  let out32 = null;

  function blit(pixels, width, height, dstX, dstY) {
    if (window.FluxLoading) {
      window.FluxLoading.frame();
    }
    if (window.WebLogin) {
      window.WebLogin.frame();
    }
    width = width | 0;
    height = height | 0;
    dstX = dstX | 0;
    dstY = dstY | 0;

    // The GPU takes the frame whole: no swizzle pass, no ImageData, no putImageData. The client's
    // bytes are already in the layout the texture wants.
    if (window.WebGpu && window.WebGpu.blit(pixels, width, height)) {
      return;
    }

    if (!ctx) {
      return;
    }
    if (imageData.width !== width || imageData.height !== height) {
      imageData = ctx.createImageData(width, height);
      out32 = null;
    }
    const data = imageData.data;
    const useLoginTitle =
      window.__webLoginTitleEnabled &&
      window.WebImage &&
      WebImage.compositeLoginTitleIntoImageData;

    if (useLoginTitle) {
      data.fill(0);
      WebImage.compositeLoginTitleIntoImageData(data, width, height);
      let p = 0;
      for (let i = 0; i < pixels.length && p < data.length; i++) {
        const c = pixels[i] | 0;
        if (c === 0) {
          p += 4;
          continue;
        }
        let a = (c >>> 24) & 0xff;
        if (a === 0) {
          a = 0xff;
        }
        data[p++] = (c >> 16) & 0xff;
        data[p++] = (c >> 8) & 0xff;
        data[p++] = c & 0xff;
        data[p++] = a;
      }
    } else {
      if (!out32 || out32.buffer !== data.buffer) {
        out32 = new Uint32Array(data.buffer);
      }
      const count = Math.min(pixels.length, out32.length);
      for (let i = 0; i < count; i++) {
        const c = pixels[i] | 0;
        let a = (c >>> 24) & 0xff;
        if (a === 0) {
          a = 0xff;
        }
        out32[i] = (a << 24) | ((c & 0xff) << 16) | (c & 0xff00) | ((c >> 16) & 0xff);
      }
    }

    const destW = canvas.width - dstX;
    const destH = canvas.height - dstY;
    if (width === destW && height === destH) {
      ctx.putImageData(imageData, dstX, dstY);
      return;
    }

    const sctx = ensureScaleBuffer(width, height);
    sctx.putImageData(imageData, 0, 0);
    const smooth = false;
    ctx.imageSmoothingEnabled = smooth;
    if (ctx.msImageSmoothingEnabled !== undefined) {
      ctx.msImageSmoothingEnabled = smooth;
    }
    if (ctx.webkitImageSmoothingEnabled !== undefined) {
      ctx.webkitImageSmoothingEnabled = smooth;
    }
    ctx.drawImage(scaleBuffer, 0, 0, width, height, dstX, dstY, destW, destH);
  }

  function drawOverlayText(text, centerX, centerY) {
    if (!ctx || !text) {
      return;
    }
    ctx.font = "bold 13px Helvetica, Arial, sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, centerX, centerY);
  }

  function drawLoadingBar(progress, message, clearBackground, alternateLayout) {
    if (window.FluxLoading) {
      window.FluxLoading.report(progress, message);
    }
  }

  return {
    attach,
    blit,
    drawOverlayText,
    drawLoadingBar,
    setSize,

    hostWidth() {
      return hostSize().width;
    },

    hostHeight() {
      return hostSize().height;
    },

    // 0 or less returns to picking the scale from the host size.
    setRenderScale(scale) {
      renderScale = scale > 0 ? +scale : 0;
      window.dispatchEvent(new Event("resize"));
    },

    /**
     * How large to draw the interface, as a percentage of the automatic scale. Higher is larger.
     *
     * The resize is what makes it take effect: the client reads the host size every frame and
     * rebuilds its buffers when it changes, so nothing here has to reach into the client.
     */
    setUiScalePercent(percent) {
      const next = percent > 0 ? clampUiScale(+percent) : storedUiScale();
      if (next === uiScalePercent) {
        return;
      }
      uiScalePercent = next;
      window.dispatchEvent(new Event("resize"));
    },

    getUiScalePercent() {
      return currentUiScale();
    },

    /** The most zoomed-in this host can go, as a percentage, for a settings panel to show a limit. */
    maxUsefulUiScalePercent() {
      const host = document.getElementById("game-host");
      if (!host) {
        return MAX_UI_SCALE;
      }
      const w = Math.max(1, host.clientWidth | 0);
      const h = Math.max(1, host.clientHeight | 0);
      const floor = Math.max(MIN_GAME_WIDTH / w, MIN_GAME_HEIGHT / h);
      let automatic = 1;
      if (isMobileHost()) {
        const density = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
        automatic = Math.min(MAX_AUTO_SCALE, density);
      }
      return Math.min(MAX_UI_SCALE, Math.max(MIN_UI_SCALE, Math.round((automatic / floor) * 100)));
    },

    getRenderScale() {
      const size = hostSize();
      const host = document.getElementById("game-host");
      return host ? size.width / Math.max(1, host.clientWidth | 0) : 1;
    },
  };
})();

window.WebCanvas = WebCanvas;
