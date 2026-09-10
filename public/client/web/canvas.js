const WebCanvas = (function () {
  let canvas = null;
  let ctx = null;
  let imageData = null;
  let scaleBuffer = null;
  let scaleCtx = null;

  // The interfaces are drawn at a fixed pixel size and are laid out for the fixed-mode 765x503, so
  // a host smaller than that gets the same widgets over fewer pixels: they take a larger share of
  // the screen, and under 503 tall the panels reach each other and overlap. A phone in forced
  // landscape reports about 844x390 CSS pixels, which is exactly that case. Rendering more game
  // pixels than the element has CSS pixels and letting CSS scale the canvas back down restores the
  // layout the client expects, at the cost of a larger frame to draw.
  const MIN_GAME_WIDTH = 765;
  const MIN_GAME_HEIGHT = 503;
  // Past this the frame costs more than the layout is worth on a phone.
  const MAX_RENDER_SCALE = 2;

  // 0 picks the scale from the host size; anything else is the caller's own choice.
  let renderScale = 0;

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
      return renderScale;
    }
    if (!isMobileHost()) {
      return 1;
    }
    return Math.min(MAX_RENDER_SCALE, Math.max(1, MIN_GAME_WIDTH / w, MIN_GAME_HEIGHT / h));
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

    getRenderScale() {
      const size = hostSize();
      const host = document.getElementById("game-host");
      return host ? size.width / Math.max(1, host.clientWidth | 0) : 1;
    },
  };
})();

window.WebCanvas = WebCanvas;
