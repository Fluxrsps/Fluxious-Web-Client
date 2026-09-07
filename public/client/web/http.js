/**
 * HTTP for TeaVM: cross-origin uses async prefetch + cache; same-origin can use sync XHR.
 */
const WebHttp = (function () {
  let lastStatus = -2;
  let lastBody = new Uint8Array(0);

  function cache() {
    if (!window.__httpCache) {
      window.__httpCache = Object.create(null);
    }
    return window.__httpCache;
  }

  function lookup(url) {
    const c = cache();
    if (c[url]) {
      return c[url];
    }
    const cfg = window.__webConfig;
    if (cfg && cfg.worldListFallbackProxy && c[cfg.worldListFallbackProxy]) {
      const primary = cfg.worldListUrl || cfg.worldListPrimaryUrl;
      if (primary && url === primary) {
        return c[cfg.worldListFallbackProxy];
      }
    }
    return null;
  }

  function responseTextToBytes(text) {
    const len = text.length;
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      out[i] = text.charCodeAt(i) & 0xff;
    }
    return out;
  }

  function applyCacheEntry(entry) {
    lastStatus = entry.status;
    lastBody = entry.body ? entry.body : new Uint8Array(0);
  }

  function isSameOrigin(url) {
    try {
      const u = new URL(url, location.href);
      return u.origin === location.origin;
    } catch (_) {
      return false;
    }
  }

  async function prefetch(url) {
    if (!url) {
      return false;
    }
    const c = cache();
    if (c[url] && c[url].body && c[url].body.length > 0) {
      return c[url].status >= 200 && c[url].status < 300;
    }
    try {
      const res = await fetch(url, { method: "GET", mode: "cors", credentials: "omit" });
      const buf = await res.arrayBuffer();
      c[url] = { status: res.status, body: new Uint8Array(buf) };
      const ok = res.ok && buf.byteLength > 0;
      return ok;
    } catch (e) {
      return false;
    }
  }

  /** Copy cached response from {@code sourceUrl} so {@code canonicalUrl} (param 17) still works. */
  function aliasCache(canonicalUrl, sourceUrl) {
    const c = cache();
    if (!c[sourceUrl] || !c[sourceUrl].body || c[sourceUrl].body.length === 0) {
      return false;
    }
    c[canonicalUrl] = { status: c[sourceUrl].status, body: c[sourceUrl].body };
    return true;
  }

  function fetchSync(url) {
    lastStatus = -2;
    lastBody = new Uint8Array(0);
    if (!url) {
      return;
    }
    const hit = lookup(url);
    if (hit) {
      applyCacheEntry(hit);
      return;
    }
    if (!isSameOrigin(url)) {
      return;
    }
    try {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", url, false);
      try {
        xhr.overrideMimeType("text/plain; charset=x-user-defined");
      } catch (_) {}
      // User-Agent and Connection are forbidden header names: the browser refuses them and
      // logs a warning for every request. It sets both itself anyway.
      xhr.send(null);
      const code = xhr.status;
      lastStatus = code === 0 ? 200 : code;
      if (xhr.responseText && xhr.responseText.length > 0) {
        lastBody = responseTextToBytes(xhr.responseText);
      }
      cache()[url] = { status: lastStatus, body: lastBody };
    } catch (e) {
      /* ignore */
    }
  }

  return {
    prefetch,
    aliasCache,
    fetchSync,
    lastStatus: () => lastStatus,
    lastBody: () => lastBody,
  };
})();

window.WebHttp = WebHttp;
