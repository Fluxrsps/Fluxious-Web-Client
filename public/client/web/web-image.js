const WebImage = (function () {
  function pakoLib() {
    return window.pako || (typeof pako !== "undefined" ? pako : null);
  }

  function toUint8(bytes) {
    if (!bytes) {
      return null;
    }
    if (bytes instanceof Uint8Array) {
      return bytes;
    }
    if (ArrayBuffer.isView(bytes)) {
      return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    const n = bytes.length | 0;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const v = bytes[i];
      out[i] = typeof v === "number" ? v & 0xff : 0;
    }
    return out;
  }

  function hexHead(u8, n) {
    const parts = [];
    const lim = Math.min(u8.length, n | 0);
    for (let i = 0; i < lim; i++) {
      parts.push((u8[i] & 0xff).toString(16).padStart(2, "0"));
    }
    return parts.join(" ");
  }

  function isJpegAt(u8, i) {
    return u8.length > i + 1 && u8[i] === 0xff && u8[i + 1] === 0xd8;
  }

  function isPngAt(u8, i) {
    return (
      u8.length > i + 3 &&
      u8[i] === 0x89 &&
      u8[i + 1] === 0x50 &&
      u8[i + 2] === 0x4e &&
      u8[i + 3] === 0x47
    );
  }

  function isZlibAt(u8, i) {
    if (u8.length < i + 2) {
      return false;
    }
    const b0 = u8[i];
    const b1 = u8[i + 1];
    return b0 === 0x78 && (b1 === 0x01 || b1 === 0x5e || b1 === 0x9c || b1 === 0xda);
  }

  function isGzipAt(u8, i) {
    return u8.length > i + 1 && u8[i] === 0x1f && u8[i + 1] === 0x8b;
  }

  function maybeDecompress(u8) {
    const p = pakoLib();
    if (!p || !u8 || u8.length < 4) {
      return u8;
    }
    if (isJpegAt(u8, 0) || isPngAt(u8, 0)) {
      return u8;
    }
    if (isZlibAt(u8, 0)) {
      try {
        const out = p.inflate(u8);
        return out;
      } catch (e) {
      }
    }
    if (isGzipAt(u8, 0) && p.ungzip) {
      try {
        const out = p.ungzip(u8);
        return out;
      } catch (e) {
      }
    }
    return u8;
  }

  /** Strip Jagex / archive prefix before the real image file. */
  function findImagePayload(u8) {
    if (!u8 || u8.length < 4) {
      return u8;
    }
    if (isJpegAt(u8, 0) || isPngAt(u8, 0)) {
      return u8;
    }
    let best = -1;
    const limit = Math.min(u8.length - 4, 2048);
    for (let i = 1; i < limit; i++) {
      if (isJpegAt(u8, i) || isPngAt(u8, i)) {
        if (best < 0 || i < best) {
          best = i;
        }
      }
    }
    if (best > 0) {
      return u8.subarray(best);
    }
    return u8;
  }

  function packArgb(w, h, rgba) {
    const pixels = new Int32Array(2 + w * h);
    pixels[0] = w;
    pixels[1] = h;
    let j = 2;
    for (let i = 0, p = 0; i < w * h; i++, j++, p += 4) {
      pixels[j] =
        0xff000000 |
        ((rgba[p] & 0xff) << 16) |
        ((rgba[p + 1] & 0xff) << 8) |
        (rgba[p + 2] & 0xff);
    }
    return pixels;
  }

  function decodeJpegBytes(u8) {
    if (!window["jpeg-js"] || !window["jpeg-js"].decode) {
      return { pixels: null, reason: "jpeg-js missing" };
    }
    try {
      const decoded = window["jpeg-js"].decode(u8, {
        useTArray: true,
        formatAsRGBA: true,
        tolerantDecoding: true,
      });
      const w = decoded.width | 0;
      const h = decoded.height | 0;
      if (w <= 0 || h <= 0) {
        return { pixels: null, reason: "jpeg zero size" };
      }
      return { pixels: packArgb(w, h, decoded.data), reason: null };
    } catch (e) {
      return { pixels: null, reason: "jpeg: " + (e.message || e) };
    }
  }

  function decodePngBytes(u8) {
    const p = pakoLib();
    if (!window.UPNG || !window.UPNG.decode) {
      return { pixels: null, reason: "UPNG missing" };
    }
    if (!p || !p.inflate) {
      return { pixels: null, reason: "pako.inflate missing" };
    }
    if (!window.pako) {
      window.pako = p;
    }
    try {
      const img = window.UPNG.decode(u8);
      const rgbaBuf = window.UPNG.toRGBA8(img)[0];
      const rgba =
        rgbaBuf instanceof Uint8Array ? rgbaBuf : new Uint8Array(rgbaBuf);
      const w = img.width | 0;
      const h = img.height | 0;
      if (w <= 0 || h <= 0) {
        return { pixels: null, reason: "png zero size" };
      }
      return { pixels: packArgb(w, h, rgba), reason: null };
    } catch (e) {
      return { pixels: null, reason: "png: " + (e.message || e) };
    }
  }

  function decodeRaster(u8) {
    if (isJpegAt(u8, 0)) {
      const j = decodeJpegBytes(u8);
      if (j.pixels) {
        return j;
      }
      const p = decodePngBytes(u8);
      return p.pixels ? p : j;
    }
    if (isPngAt(u8, 0)) {
      const p = decodePngBytes(u8);
      if (p.pixels) {
        return p;
      }
      const j = decodeJpegBytes(u8);
      return j.pixels ? j : p;
    }
    const j = decodeJpegBytes(u8);
    if (j.pixels) {
      return j;
    }
    const p = decodePngBytes(u8);
    return p.pixels ? p : j;
  }

  function preparePayload(bytes) {
    const raw = toUint8(bytes);
    if (!raw || raw.length < 4) {
      return { u8: null, rawLen: 0, head: "" };
    }
    const inflated = maybeDecompress(raw);
    const u8 = findImagePayload(inflated);
    return { u8: u8, rawLen: raw.length, head: hexHead(raw, 12) };
  }

  function decodeJpeg(bytes) {
    const prep = preparePayload(bytes);
    if (!prep.u8) {
      return null;
    }
    const u8 = prep.u8;
    const result = decodeRaster(u8);
    if (result.pixels) {
      return result.pixels;
    }
    const reason = result.reason || "unknown";
    return null;
  }

  /**
   * Decode into a Java int[] (TeaVM): [w, h, argb...] at offset.
   * destLen is required because TeaVM arrays may not expose .length in JS.
   */
  function decodeJpegInto(bytes, dest, offset, destLen) {
    try {
      const packed = decodeJpeg(bytes);
      if (!packed || packed.length < 2) {
        return -1;
      }
      const n = packed.length | 0;
      const need = (offset | 0) + n;
      const cap = destLen | 0;
      if (cap <= 0 || need > cap) {
        return -1;
      }
      for (let i = 0; i < n; i++) {
        dest[(offset | 0) + i] = packed[i] | 0;
      }
      return n;
    } catch (e) {
      console.warn("[WebImage] decodeJpegInto failed", e);
      return -1;
    }
  }

  let loginTitleRgba = null;
  let loginTitleArgb = null;
  let loginTitleRgbaPos = 0;
  let loginTitleW = 0;
  let loginTitleH = 0;

  function beginLoginTitleDecode(bytes) {
    loginTitleRgbaPos = 0;
    loginTitleRgba = null;
    loginTitleArgb = null;
    loginTitleW = 0;
    loginTitleH = 0;
    const packed = decodeJpeg(bytes);
    if (!packed || packed.length < 2) {
      return false;
    }
    const w = packed[0] | 0;
    const h = packed[1] | 0;
    const n = w * h;
    if (w <= 0 || h <= 0 || packed.length < 2 + n) {
      return false;
    }
    loginTitleW = w;
    loginTitleH = h;
    loginTitleArgb = new Int32Array(n);
    loginTitleRgba = new Uint8Array(n * 4);
    let j = 2;
    for (let i = 0; i < n; i++) {
      const c = packed[j++] | 0;
      loginTitleArgb[i] = c;
      const p = i * 4;
      loginTitleRgba[p] = (c >> 16) & 0xff;
      loginTitleRgba[p + 1] = (c >> 8) & 0xff;
      loginTitleRgba[p + 2] = c & 0xff;
      loginTitleRgba[p + 3] = 0xff;
    }
    return true;
  }

  function exportLoginTitleRgba() {
    return loginTitleRgba;
  }

  /** Paint login title into RGBA canvas buffer (after Java framebuffer is unpacked). */
  function compositeLoginTitleIntoImageData(data, screenW, screenH) {
    if (!loginTitleArgb || loginTitleW <= 0 || loginTitleH <= 0 || !data) {
      return;
    }
    const w = loginTitleW | 0;
    const h = loginTitleH | 0;
    const sw = screenW | 0;
    const sh = screenH | 0;
    if (sw <= 0 || sh <= 0) {
      return;
    }
    const leftX = Math.max(0, (sw - 765) >> 1);
    const rightX = leftX + 382;
    const rows = h < sh ? h : sh;

    function putAt(dx, dy, argb) {
      if (argb === 0) {
        return;
      }
      const p = (dy * sw + dx) * 4;
      if (p < 0 || p + 3 >= data.length) {
        return;
      }
      data[p] = (argb >> 16) & 0xff;
      data[p + 1] = (argb >> 8) & 0xff;
      data[p + 2] = argb & 0xff;
      data[p + 3] = 0xff;
    }

    for (let row = 0; row < rows; row++) {
      const srcRow = row * w;
      for (let col = 0; col < w; col++) {
        putAt(leftX + col, row, loginTitleArgb[srcRow + col] | 0);
        putAt(rightX + col, row, loginTitleArgb[srcRow + (w - 1 - col)] | 0);
      }
    }
  }

  function loginTitleWidth() {
    return loginTitleW | 0;
  }

  function loginTitleHeight() {
    return loginTitleH | 0;
  }

  function copyLoginTitleRgba(dest, destOffset, maxLen) {
    if (!loginTitleRgba || loginTitleRgbaPos >= loginTitleRgba.length) {
      return 0;
    }
    const off = destOffset | 0;
    const max = maxLen | 0;
    if (max <= 0) {
      return 0;
    }
    const remain = loginTitleRgba.length - loginTitleRgbaPos;
    const n = remain < max ? remain : max;
    for (let i = 0; i < n; i++) {
      dest[off + i] = loginTitleRgba[loginTitleRgbaPos + i];
    }
    loginTitleRgbaPos += n;
    return n;
  }

  function decodeImagePacked(bytes) {
    const u8 = toUint8(bytes);
    if (!u8 || u8.length === 0) {
      return null;
    }
    return decodeRaster(u8);
  }

  /**
   * Assets decoded up front by the browser itself.
   *
   * <p>The decoders above only handle JPEG and PNG; the login background is a GIF.
   * `createImageBitmap` handles every format the browser does, but it is asynchronous, so assets
   * are decoded during boot and read synchronously afterwards.
   */
  const assets = new Map();

  /**
   * Pack RGBA into the client's sprite format.
   *
   * <p>Unlike `packArgb`, which forces every pixel opaque because JPEG has no alpha, this keeps
   * the colour-key convention SpritePixels uses: fully transparent becomes 0, and everything else
   * drops its alpha byte. Without it the login border's transparent centre paints over the
   * background instead of showing it through.
   */
  function packSpriteArgb(w, h, rgba) {
    const pixels = new Int32Array(w * h);
    for (let i = 0, p = 0; i < pixels.length; i++, p += 4) {
      if ((rgba[p + 3] & 0xff) === 0) {
        pixels[i] = 0;
        continue;
      }
      pixels[i] =
        ((rgba[p] & 0xff) << 16) | ((rgba[p + 1] & 0xff) << 8) | (rgba[p + 2] & 0xff);
    }
    return pixels;
  }

  async function preloadAsset(name, url) {
    try {
      const response = await fetch(url, { cache: "force-cache" });
      if (!response.ok) {
        console.warn("[WebImage] asset " + name + " -> HTTP " + response.status);
        return false;
      }
      const blob = await response.blob();
      const decoded = (await decodeAnimated(blob, response.headers.get("Content-Type"))) ||
        (await decodeStill(blob));
      if (!decoded) {
        return false;
      }
      assets.set(name, decoded);
      return true;
    } catch (e) {
      console.warn("[WebImage] asset " + name + " failed", e);
      return false;
    }
  }

  /** Draws a decoded frame and packs it into sprite pixels. */
  function packFrame(source, w, h) {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0);
    return packSpriteArgb(w, h, ctx.getImageData(0, 0, w, h).data);
  }

  /**
   * Every frame of an animation, via the ImageDecoder API.
   *
   * <p>`createImageBitmap` only ever yields the first frame of a GIF. ImageDecoder exposes the
   * rest along with their durations; where it is unavailable the caller falls back to a still.
   */
  async function decodeAnimated(blob, type) {
    if (typeof ImageDecoder === "undefined") {
      console.warn("[WebImage] ImageDecoder unavailable; animations will show a still frame");
      return null;
    }
    try {
      const decoder = new ImageDecoder({ data: await blob.arrayBuffer(), type: type || blob.type });
      // Track metadata is only populated once tracks.ready settles; selectedTrack is null before
      // that, which reads as a single-frame image.
      await decoder.tracks.ready;
      await decoder.completed;
      const track = decoder.tracks.selectedTrack;
      const count = track ? track.frameCount : 1;
      if (!count || count < 2) {
        console.warn("[WebImage] no animation track (frameCount=" + count + ")");
        return null;
      }

      const frames = [];
      const delays = [];
      let width = 0;
      let height = 0;
      let total = 0;
      for (let i = 0; i < count; i++) {
        const result = await decoder.decode({ frameIndex: i });
        const image = result.image;
        if (i === 0) {
          width = image.displayWidth | 0;
          height = image.displayHeight | 0;
        }
        frames.push(packFrame(image, width, height));
        // Durations are microseconds; GIFs commonly report 0, which browsers render as 100ms.
        const delay = Math.max(20, Math.round((image.duration || 100000) / 1000));
        delays.push(delay);
        total += delay;
        image.close();
      }
      decoder.close();
      return { width: width, height: height, frames: frames, delays: delays, total: total };
    } catch (e) {
      console.warn("[WebImage] animated decode failed, using a still frame", e);
      return null;
    }
  }

  async function decodeStill(blob) {
    const bitmap = await createImageBitmap(blob);
    const w = bitmap.width | 0;
    const h = bitmap.height | 0;
    if (w <= 0 || h <= 0) {
      bitmap.close();
      return null;
    }
    const pixels = packFrame(bitmap, w, h);
    bitmap.close();
    return { width: w, height: h, frames: [pixels], delays: [0], total: 0 };
  }

  /** Index of the frame that should be showing now. */
  function assetFrameIndex(name) {
    const a = assets.get(name);
    if (!a || a.frames.length < 2 || a.total <= 0) {
      return 0;
    }
    let t = Date.now() % a.total;
    for (let i = 0; i < a.delays.length; i++) {
      t -= a.delays[i];
      if (t < 0) {
        return i;
      }
    }
    return a.frames.length - 1;
  }

  function assetFrameCount(name) {
    const a = assets.get(name);
    return a ? a.frames.length : 0;
  }

  function assetWidth(name) {
    const a = assets.get(name);
    return a ? a.width : 0;
  }

  function assetHeight(name) {
    const a = assets.get(name);
    return a ? a.height : 0;
  }

  /** Sprite pixels for the frame showing now, or null when the asset is missing. */
  function assetPixels(name) {
    const a = assets.get(name);
    return a ? a.frames[assetFrameIndex(name)] : null;
  }

  return {
    preloadAsset,
    assetWidth,
    assetHeight,
    assetPixels,
    assetFrameIndex,
    assetFrameCount,
    decodeJpeg,
    decodeJpegInto,
    decodeImagePacked,
    beginLoginTitleDecode,
    loginTitleWidth,
    loginTitleHeight,
    copyLoginTitleRgba,
    exportLoginTitleRgba,
    compositeLoginTitleIntoImageData,
  };
})();

window.WebImage = WebImage;
