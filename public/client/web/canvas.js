const WebCanvas = (function () {
  let canvas = null;
  let ctx = null;
  let imageData = null;
  let scaleBuffer = null;
  let scaleCtx = null;

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
    if (!canvas || !ctx) {
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
    imageData = ctx.createImageData(w, h);
  }

  function attach(canvasId) {
    canvas = document.getElementById(canvasId);
    if (!canvas) {
      throw new Error("Canvas not found: " + canvasId);
    }
    ctx = canvas.getContext("2d", { alpha: false });
    imageData = ctx.createImageData(canvas.width, canvas.height);
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
    if (!ctx) {
      return;
    }
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
      // One 32-bit store per pixel instead of four 8-bit ones. ImageData is RGBA in memory
      // order, which on a little-endian host reads back as 0xAABBGGRR.
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

  /**
   * Reports loading progress to the HTML overlay.
   *
   * <p>Both the boot sequence and the client itself funnel through here, so this is the one place
   * that has to know where loading is displayed. Nothing is drawn on the canvas: the overlay sits
   * above it and is styled with CSS.
   */
  function drawLoadingBar(progress, message, clearBackground, alternateLayout) {
    if (window.FluxLoading) {
      window.FluxLoading.report(progress, message);
    }
  }

  return { attach, blit, drawOverlayText, drawLoadingBar, setSize };
})();

window.WebCanvas = WebCanvas;
