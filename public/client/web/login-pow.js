const WebLoginPow = (function () {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  function rotr(x, n) {
    return (x >>> n) | (x << (32 - n));
  }

  function sha256Utf8(text) {
    const enc = new TextEncoder().encode(text);
    const len = enc.length;
    const bitLenHi = Math.floor((len * 8) / 0x100000000);
    const bitLenLo = (len * 8) >>> 0;
    const padLen = ((56 - ((len + 1) % 64)) + 64) % 64;
    const total = len + 1 + padLen + 8;
    const buf = new Uint8Array(total);
    buf.set(enc);
    buf[len] = 0x80;
    const view = new DataView(buf.buffer);
    view.setUint32(total - 8, bitLenHi, false);
    view.setUint32(total - 4, bitLenLo, false);

    let h0 = 0x6a09e667;
    let h1 = 0xbb67ae85;
    let h2 = 0x3c6ef372;
    let h3 = 0xa54ff53a;
    let h4 = 0x510e527f;
    let h5 = 0x9b05688c;
    let h6 = 0x1f83d9ab;
    let h7 = 0x5be0cd19;
    const w = new Uint32Array(64);

    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) {
        w[i] = view.getUint32(off + i * 4, false);
      }
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = h0;
      let b = h1;
      let c = h2;
      let d = h3;
      let e = h4;
      let f = h5;
      let g = h6;
      let h = h7;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + t1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) >>> 0;
      }
      h0 = (h0 + a) >>> 0;
      h1 = (h1 + b) >>> 0;
      h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0;
      h5 = (h5 + f) >>> 0;
      h6 = (h6 + g) >>> 0;
      h7 = (h7 + h) >>> 0;
    }
    const out = new Uint8Array(32);
    const ov = new DataView(out.buffer);
    ov.setUint32(0, h0, false);
    ov.setUint32(4, h1, false);
    ov.setUint32(8, h2, false);
    ov.setUint32(12, h3, false);
    ov.setUint32(16, h4, false);
    ov.setUint32(20, h5, false);
    ov.setUint32(24, h6, false);
    ov.setUint32(28, h7, false);
    return out;
  }

  function leadingZeroBits(hash) {
    let total = 0;
    for (let i = 0; i < hash.length; i++) {
      const b = hash[i];
      if (b === 0) {
        total += 8;
        continue;
      }
      let bits = 0;
      for (let v = b & 0xff; (v & 0x80) === 0; v <<= 1) {
        bits++;
      }
      return total + bits;
    }
    return total;
  }

  const HEX_CODES = new Uint8Array(
    "0123456789abcdef".split("").map((c) => c.charCodeAt(0))
  );
  const TWO_POW = new Float64Array(16);
  for (let i = 0; i < 16; i++) {
    TWO_POW[i] = Math.pow(2, i * 4);
  }
  const encoder = new TextEncoder();
  const scratch = new Uint8Array(4096);
  const scratchView = new DataView(scratch.buffer);
  const w = new Uint32Array(64);

  function writeHex(offset, n) {
    if (n === 0) {
      scratch[offset] = 48;
      return offset + 1;
    }
    if (n < 0x100000000) {
      let started = false;
      for (let shift = 28; shift >= 0; shift -= 4) {
        const digit = (n >>> shift) & 0xf;
        if (!started && digit === 0) {
          continue;
        }
        started = true;
        scratch[offset++] = HEX_CODES[digit];
      }
      return offset;
    }
    let started = false;
    for (let shift = 60; shift >= 0; shift -= 4) {
      const digit = shift >= 32
        ? (Math.floor(n / TWO_POW[shift >> 2]) & 0xf)
        : ((n >>> shift) & 0xf);
      if (!started && digit === 0) {
        continue;
      }
      started = true;
      scratch[offset++] = HEX_CODES[digit];
    }
    return offset;
  }

  const midstate = new Uint32Array(8);
  let midstateBlocks = 0;

  function computeMidstate(prefixLen) {
    midstateBlocks = Math.floor(prefixLen / 64);
    midstate[0] = 0x6a09e667; midstate[1] = 0xbb67ae85;
    midstate[2] = 0x3c6ef372; midstate[3] = 0xa54ff53a;
    midstate[4] = 0x510e527f; midstate[5] = 0x9b05688c;
    midstate[6] = 0x1f83d9ab; midstate[7] = 0x5be0cd19;
    compress(0, midstateBlocks * 64, midstate);
  }

  function compress(from, to, state) {
    let h0 = state[0], h1 = state[1], h2 = state[2], h3 = state[3];
    let h4 = state[4], h5 = state[5], h6 = state[6], h7 = state[7];
    for (let off = from; off < to; off += 64) {
      for (let i = 0; i < 16; i++) {
        w[i] = scratchView.getUint32(off + i * 4, false);
      }
      for (let i = 16; i < 64; i++) {
        const x = w[i - 15];
        const y = w[i - 2];
        const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
        const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e;
        e = (d + t1) >>> 0;
        d = c; c = b; b = a;
        a = (t1 + t2) >>> 0;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }
    state[0] = h0; state[1] = h1; state[2] = h2; state[3] = h3;
    state[4] = h4; state[5] = h5; state[6] = h6; state[7] = h7;
  }

  const working = new Uint32Array(8);

  function digestFirstWord(len) {
    const bitLen = len * 8;
    const padLen = ((56 - ((len + 1) % 64)) + 64) % 64;
    const total = len + 1 + padLen + 8;
    scratch[len] = 0x80;
    scratch.fill(0, len + 1, total - 8);
    scratchView.setUint32(total - 8, Math.floor(bitLen / 0x100000000), false);
    scratchView.setUint32(total - 4, bitLen >>> 0, false);
    working.set(midstate);
    compress(midstateBlocks * 64, total, working);
    return working[0];
  }

  function unusedLegacyDigest(total) {
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) {
        w[i] = scratchView.getUint32(off + i * 4, false);
      }
      for (let i = 16; i < 64; i++) {
        const x = w[i - 15];
        const y = w[i - 2];
        const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
        const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e;
        e = (d + t1) >>> 0;
        d = c; c = b; b = a;
        a = (t1 + t2) >>> 0;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }
    return h0;
  }

  let cachedPrefix = null;
  let cachedPrefixLen = 0;

  function solveRange(prefix, difficulty, startNonce, maxAttempts) {
    if (difficulty <= 0 || difficulty > 32) {
      return solveRangeGeneric(prefix, difficulty, startNonce, maxAttempts);
    }
    if (cachedPrefix !== prefix) {
      const bytes = encoder.encode(prefix);
      if (bytes.length + 24 > scratch.length) {
        console.warn("[WebLoginPow] prefix of " + bytes.length
          + " bytes exceeds the scratch buffer; using the slow solver");
        return solveRangeGeneric(prefix, difficulty, startNonce, maxAttempts);
      }
      scratch.set(bytes, 0);
      cachedPrefix = prefix;
      cachedPrefixLen = bytes.length;
      computeMidstate(bytes.length);
    }

    const limit = Math.pow(2, 32 - difficulty);
    const end = startNonce + maxAttempts;
    for (let n = startNonce; n < end; n++) {
      const len = writeHex(cachedPrefixLen, n);
      if (digestFirstWord(len) < limit) {
        return String(n);
      }
    }
    return "";
  }

  function solveRangeGeneric(prefix, difficulty, startNonce, maxAttempts) {
    let n = startNonce;
    const end = startNonce + maxAttempts;
    while (n < end) {
      const hash = sha256Utf8(prefix + n.toString(16));
      if (leadingZeroBits(hash) >= difficulty) {
        return String(n);
      }
      n++;
    }
    return "";
  }

  return { solveRange, sha256Utf8, leadingZeroBits };
})();

window.WebLoginPow = WebLoginPow;
