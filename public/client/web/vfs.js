/**
 * Virtual filesystem: OPFS (sync access handles when available) with IndexedDB fallback.
 * Loaded before TeaVM; exposes global WebVfs.
 */
const WebVfs = (function () {
  const CACHE_PREFIX = "cache/";
  let ready = false;
  /** idb | opfs-sync | opfs-mem */
  let backend = "idb";
  let rootDir = null;
  // key -> { buf, len }. Capacity is grown geometrically and `len` is the real file size, so an
  // append does not reallocate and copy the whole file every time it extends it.
  const memoryFiles = new Map();

  function setFile(key, data) {
    memoryFiles.set(key, { buf: data, len: data.length, dirtyFrom: -1, dirtyTo: -1 });
  }

  function markRange(f, from, to) {
    f.dirtyFrom = f.dirtyFrom < 0 ? from : Math.min(f.dirtyFrom, from);
    f.dirtyTo = f.dirtyTo < 0 ? to : Math.max(f.dirtyTo, to);
  }

  /** The file's bytes, without the spare capacity past `len`. */
  function fileBytes(key) {
    const f = memoryFiles.get(key);
    if (!f) {
      return null;
    }
    return f.len === f.buf.length ? f.buf : f.buf.subarray(0, f.len);
  }
  /** key -> { access?, fileHandle } for opfs-sync; { fileHandle } for opfs-mem */
  const syncHandles = new Map();
  const pendingFlush = new Map();

  function log(msg) {
    console.log("[WebVfs]", msg);
  }

  function usesOpfs() {
    return backend === "opfs-sync" || backend === "opfs-mem";
  }

  async function init() {
    if (ready) {
      return;
    }
    if (typeof navigator !== "undefined" && navigator.storage && navigator.storage.getDirectory) {
      try {
        const dir = await navigator.storage.getDirectory();
        const probe = await dir.getFileHandle("__webvfs_probe", { create: true });
        if (typeof probe.createSyncAccessHandle === "function") {
          const access = await probe.createSyncAccessHandle();
          access.close();
          try {
            await dir.removeEntry("__webvfs_probe");
          } catch (_) {
            /* removeEntry optional */
          }
          rootDir = dir;
          backend = "opfs-sync";
          log("Using OPFS (sync access handles)");
        } else {
          rootDir = dir;
          backend = "opfs-mem";
          log("OPFS without sync handles; using buffered OPFS (async flush)");
        }
      } catch (e) {
        log("OPFS unavailable, using IndexedDB: " + e);
        backend = "idb";
        rootDir = null;
      }
    } else {
      backend = "idb";
      log("Using IndexedDB backend");
    }
    ready = true;
  }

  function isReady() {
    return ready;
  }

  function normalize(path) {
    return CACHE_PREFIX + path.replace(/\\/g, "/").replace(/^\/+/, "");
  }

  async function getOpfsFileHandleFromRoot(dir, logicalPath, create) {
    const parts = logicalPath.split("/").filter((p) => p.length > 0);
    if (parts.length === 0) {
      throw new TypeError("Invalid cache path");
    }
    let current = dir;
    for (let i = 0; i < parts.length - 1; i++) {
      current = await current.getDirectoryHandle(parts[i], { create });
    }
    const fileName = parts[parts.length - 1];
    return await current.getFileHandle(fileName, { create });
  }

  async function loadOpfsIntoMemory(fileHandle) {
    try {
      const file = await fileHandle.getFile();
      if (file.size === 0) {
        return new Uint8Array(0);
      }
      return new Uint8Array(await file.arrayBuffer());
    } catch (e) {
      return new Uint8Array(0);
    }
  }

  /**
   * Writes only the bytes that changed.
   *
   * <p>Rewriting the whole file was costing O(size) per flush, so as the cache grew past tens of
   * megabytes the flushes alone saturated the main thread and JS5 throughput collapsed. Cache
   * writes are almost all appends, so a single dirty range covers them cheaply.
   */
  async function persistOpfsMemory(key, fileHandle, from, to, data) {
    const writable = await fileHandle.createWritable({ keepExistingData: true });
    await writable.write({ type: "write", position: from, data: data.subarray(from, to) });
    await writable.close();
    pendingFlush.delete(key);
  }

  async function ensureOpfsFile(path) {
    const key = normalize(path);
    if (syncHandles.has(key)) {
      return syncHandles.get(key);
    }
    const fileHandle = await getOpfsFileHandleFromRoot(rootDir, key, true);
    if (backend === "opfs-sync") {
      const access = await fileHandle.createSyncAccessHandle();
      syncHandles.set(key, { fileHandle, access });
      return syncHandles.get(key);
    }
    const data = await loadOpfsIntoMemory(fileHandle);
    setFile(key, data);
    syncHandles.set(key, { fileHandle });
    return syncHandles.get(key);
  }

  async function loadIdb(path) {
    const key = normalize(path);
    if (memoryFiles.has(key)) {
      return fileBytes(key);
    }
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("openrune-web-cache", 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("files");
      };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("files", "readonly");
        const get = tx.objectStore("files").get(key);
        get.onsuccess = () => {
          const data = get.result ? new Uint8Array(get.result) : new Uint8Array(0);
          setFile(key, data);
          resolve(data);
        };
        get.onerror = () => reject(get.error);
      };
    });
  }

  async function persistIdb(path, data) {
    const key = normalize(path);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("openrune-web-cache", 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("files");
      };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("files", "readwrite");
        tx.objectStore("files").put(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  }

  function cacheFileNames() {
    const names = ["main_file_cache.dat2", "main_file_cache.idx255", "random.dat"];
    for (let i = 0; i < 256; i++) {
      names.push("main_file_cache.idx" + i);
    }
    return names;
  }

  /**
   * Opens the local cache files, seeding them from the server's cache when they are empty.
   *
   * <p>Without a seed the client pulls every archive over JS5 � tens of thousands of round trips
   * for a few hundred megabytes, which takes many minutes before the login can even finish. The
   * proxy serves the same cache over HTTP, so a handful of bulk downloads replaces all of it.
   * Falls back to empty files (and therefore to JS5) when the seed is not configured.
   */
  async function ensureCacheBootstrap() {
    if (!ready) {
      await init();
    }
    const names = cacheFileNames();
    for (const name of names) {
      await openFile(name);
    }

    let seeded = 0;
    // Most of the 259 candidate names are index files the cache does not have. Probing every one
    // costs a few hundred 404s, so give up on the index range after a run of misses.
    let consecutiveMisses = 0;
    for (const name of names) {
      if (consecutiveMisses >= 4 && name.startsWith("main_file_cache.idx")) {
        continue;
      }
      const key = normalize(name);
      const existing = memoryFiles.get(key);
      const localLength = existing ? existing.len : 0;

      // Size, not mere presence, decides. A partially downloaded cache left over from an earlier
      // session is non-empty but wrong, and skipping it there would keep the broken copy forever.
      const remoteLength = await seedLength(name);
      if (remoteLength < 0) {
        consecutiveMisses++;
        continue;
      }
      consecutiveMisses = 0;
      if (localLength === remoteLength) {
        continue;
      }
      if (localLength > 0) {
        log("reseeding " + name + ": have " + localLength + " bytes, server has " + remoteLength);
      }
      const bytes = await fetchSeed(name);
      if (!bytes) {
        continue;
      }
      // Deliberately not marked dirty: the seed came from the proxy over HTTP, which the browser
      // already caches, so writing all of it back to OPFS would cost far more than re-fetching it.
      // Only what JS5 adds afterwards needs persisting.
      setFile(key, bytes);
      seeded++;
    }
    return { files: names.length, seeded: seeded };
  }

  /**
   * Size of the seed on the server, or -1 when it does not offer one.
   *
   * <p>Asks for a single byte rather than using HEAD: static file handlers commonly serve GET and
   * not HEAD, and a failed probe is indistinguishable from a missing file, which would silently
   * skip seeding entirely. The Content-Range of a one-byte request carries the full length.
   */
  async function seedLength(name) {
    try {
      const response = await fetch(cacheUrl(name), {
        headers: { Range: "bytes=0-0" },
        cache: "no-store",
      });
      if (!response.ok) {
        return -1;
      }
      const range = response.headers.get("Content-Range");
      if (range) {
        const total = range.split("/")[1];
        if (total && total !== "*") {
          return parseInt(total, 10);
        }
      }
      // Range was ignored and the whole file came back; its length is the answer.
      const length = response.headers.get("Content-Length");
      return length === null ? -1 : parseInt(length, 10);
    } catch (e) {
      return -1;
    }
  }

  /**
   * Where the cache seed lives.
   *
   * <p>The client is served by the website but the seed comes from the game server, which is the
   * only thing that knows the cache the server is actually running. Falls back to the page's own
   * origin so a self-hosted build still works.
   */
  function cacheUrl(name) {
    const base = window.__webConfig && window.__webConfig.cacheBaseUrl;
    return (base ? base.replace(/\/$/, "") + "/cache/" : "cache/") + name;
  }

  async function fetchSeed(name) {
    try {
      const response = await fetch(cacheUrl(name), { cache: "force-cache" });
      if (!response.ok) {
        return null;
      }
      const buffer = await response.arrayBuffer();
      return buffer.byteLength > 0 ? new Uint8Array(buffer) : null;
    } catch (e) {
      return null;
    }
  }

  async function openFile(path) {
    if (usesOpfs()) {
      await ensureOpfsFile(path);
      return;
    }
    await loadIdb(path);
  }

  function getLength(path) {
    const key = normalize(path);
    if (backend === "opfs-sync") {
      const h = syncHandles.get(key);
      if (!h || !h.access) {
        return 0;
      }
      return Number(h.access.getSize());
    }
    if (backend === "opfs-mem" || backend === "idb") {
      const f = memoryFiles.get(key);
      return f ? f.len : 0;
    }
    return 0;
  }

  function readBytes(path, position, length) {
    const key = normalize(path);
    const out = new Uint8Array(length);
    if (backend === "opfs-sync") {
      const h = syncHandles.get(key);
      if (!h || !h.access) {
        return out.subarray(0, 0);
      }
      const n = h.access.read(out, { at: position });
      if (n < length) {
        return out.subarray(0, Math.max(0, n));
      }
      return out;
    }
    const mem = fileBytes(key) || new Uint8Array(0);
    const end = Math.min(mem.length, position + length);
    if (end <= position) {
      return out.subarray(0, 0);
    }
    const slice = mem.subarray(position, end);
    out.set(slice);
    return out.subarray(0, slice.length);
  }

  function writeBytes(path, position, data) {
    const key = normalize(path);
    if (backend === "opfs-sync") {
      const h = syncHandles.get(key);
      if (h && h.access) {
        h.access.write(data, { at: position });
      }
      return;
    }
    let f = memoryFiles.get(key);
    if (!f) {
      f = { buf: new Uint8Array(0), len: 0, dirtyFrom: -1, dirtyTo: -1 };
      memoryFiles.set(key, f);
    }
    const need = position + data.length;
    if (need > f.buf.length) {
      // Double the capacity rather than fitting exactly: JS5 fills the cache with a long run of
      // appends, and growing to fit each time makes that quadratic.
      let capacity = Math.max(f.buf.length * 2, need, 64 * 1024);
      const grown = new Uint8Array(capacity);
      grown.set(f.buf.subarray(0, f.len));
      f.buf = grown;
    }
    f.buf.set(data, position);
    if (need > f.len) {
      f.len = need;
    }
    markRange(f, position, need);
  }

  function flush(path) {
    const key = normalize(path);
    if (backend === "opfs-sync") {
      const h = syncHandles.get(key);
      if (h && h.access) {
        h.access.flush();
      }
      return;
    }
    if (backend === "opfs-mem") {
      const h = syncHandles.get(key);
      if (!h || !memoryFiles.has(key)) {
        return;
      }
      markDirty(key, h.fileHandle);
      return;
    }
    if (memoryFiles.has(key)) {
      markDirty(key, null);
    }
  }

  // Persisting rewrites the whole file, and the client flushes after each archive it writes.
  // Doing that inline turns a cache download into repeated full-file writes, so flushes are
  // coalesced onto a timer instead. A crash costs at most the last window; the client refetches.
  const FLUSH_DEBOUNCE_MS = 5000;
  const dirtyFiles = new Map();
  let flushTimer = null;

  function markDirty(key, fileHandle) {
    dirtyFiles.set(key, fileHandle);
    if (flushTimer === null) {
      flushTimer = setTimeout(runPendingFlushes, FLUSH_DEBOUNCE_MS);
    }
  }

  function runPendingFlushes() {
    flushTimer = null;
    const work = Array.from(dirtyFiles.entries());
    dirtyFiles.clear();
    for (let i = 0; i < work.length; i++) {
      const key = work[i][0];
      const fileHandle = work[i][1];
      if (pendingFlush.has(key)) {
        // Still writing the previous snapshot; pick it up on the next pass.
        dirtyFiles.set(key, fileHandle);
        continue;
      }
      const f = memoryFiles.get(key);
      const bytes = fileBytes(key);
      if (!bytes || !f || f.dirtyFrom < 0) {
        continue;
      }
      const from = f.dirtyFrom;
      const to = Math.min(f.dirtyTo, bytes.length);
      f.dirtyFrom = -1;
      f.dirtyTo = -1;
      if (to <= from) {
        continue;
      }
      if (fileHandle) {
        const p = persistOpfsMemory(key, fileHandle, from, to, bytes);
        pendingFlush.set(key, p);
        p.catch((e) => {
          console.error("[WebVfs] OPFS flush failed", key, e);
          pendingFlush.delete(key);
        });
      } else {
        persistIdb(key, bytes);
      }
    }
    if (dirtyFiles.size > 0 && flushTimer === null) {
      flushTimer = setTimeout(runPendingFlushes, FLUSH_DEBOUNCE_MS);
    }
  }

  if (typeof window !== "undefined") {
    // Last chance to get the pending window on disk before the tab goes away.
    window.addEventListener("pagehide", runPendingFlushes);
  }

  function getDebugStats() {
    return backend + " ready=" + ready + " memFiles=" + memoryFiles.size + " opfsHandles=" + syncHandles.size;
  }

  return {
    init,
    isReady,
    ensureCacheBootstrap,
    openFile,
    getLength,
    readBytes,
    writeBytes,
    flush,
    normalize,
    getDebugStats,
  };
})();

window.WebVfs = WebVfs;
