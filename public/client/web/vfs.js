const WebVfs = (function () {
  const CACHE_PREFIX = "cache/";
  const DATA_FILE = "main_file_cache.dat2";
  let ready = false;
  let backend = "idb";
  let rootDir = null;
  const memoryFiles = new Map();

  function setFile(key, data) {
    memoryFiles.set(key, { buf: data, len: data.length, dirtyFrom: -1, dirtyTo: -1 });
  }

  function markRange(f, from, to) {
    f.dirtyFrom = f.dirtyFrom < 0 ? from : Math.min(f.dirtyFrom, from);
    f.dirtyTo = f.dirtyTo < 0 ? to : Math.max(f.dirtyTo, to);
  }

  function fileBytes(key) {
    const f = memoryFiles.get(key);
    if (!f) {
      return null;
    }
    return f.len === f.buf.length ? f.buf : f.buf.subarray(0, f.len);
  }
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
    const names = [DATA_FILE, "main_file_cache.idx255", "random.dat"];
    for (let i = 0; i < 256; i++) {
      names.push("main_file_cache.idx" + i);
    }
    return names;
  }

  // Opt-in, because seeding the data file means downloading the whole cache up front. The indexes
  // are only a few hundred KB and are what the client needs to know the archive layout; the groups
  // themselves arrive over JS5 as the client asks for them and are written into this same VFS, so
  // they accumulate across sessions exactly as the desktop cache does.
  function seedsDataFile() {
    const config = window.__webConfig;
    return !!(config && config.seedCacheData);
  }

  function seedFileNames() {
    const names = cacheFileNames();
    if (seedsDataFile()) {
      return names;
    }
    return names.filter(function (name) {
      return name !== DATA_FILE;
    });
  }

  async function ensureCacheBootstrap() {
    if (!ready) {
      await init();
    }
    const names = cacheFileNames();
    for (const name of names) {
      await openFile(name);
    }

    // Every file is opened above so the client has somewhere to write, but only these are
    // downloaded; anything left out is filled in over JS5 on demand.
    const seedNames = seedFileNames();

    let seeded = 0;
    let consecutiveMisses = 0;
    for (const name of seedNames) {
      if (consecutiveMisses >= 4 && name.startsWith("main_file_cache.idx")) {
        continue;
      }
      const key = normalize(name);
      const existing = memoryFiles.get(key);
      const localLength = existing ? existing.len : 0;

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
      setFile(key, bytes);
      seeded++;
    }
    return { files: names.length, seeded: seeded, seededData: seedsDataFile() };
  }

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
      const length = response.headers.get("Content-Length");
      return length === null ? -1 : parseInt(length, 10);
    } catch (e) {
      return -1;
    }
  }

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
    // Scheduled here rather than only from flush(): the client writes JS5 groups as they arrive but
    // does not flush each one, so without this the bytes never left memory and every reload
    // re-downloaded everything it had already been given.
    scheduleFlush(key);
  }

  function scheduleFlush(key) {
    if (backend === "opfs-mem") {
      const h = syncHandles.get(key);
      if (h) {
        markDirty(key, h.fileHandle);
      }
      return;
    }
    if (backend === "idb") {
      markDirty(key, null);
    }
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

  const FLUSH_DEBOUNCE_MS = 5000;
  const dirtyFiles = new Map();
  let flushTimer = null;

  // A reload inside the debounce window would otherwise throw away everything written since the
  // last flush, which for a fresh cache is most of what JS5 just sent.
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("pagehide", runPendingFlushes);
    window.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") {
        runPendingFlushes();
      }
    });
  }

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
