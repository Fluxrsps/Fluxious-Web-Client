const WebSocketBridge = (function () {
  const sockets = {};
  let nextId = 1;

  function labelForUrl(url) {
    if (!url) return "ws";
    if (url.indexOf("/js5") >= 0) return "JS5";
    if (url.indexOf("/game") >= 0) return "GAME";
    return "WS";
  }

  function connect(url) {
    const id = nextId++;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    const entry = {
      id,
      url,
      label: labelForUrl(url),
      ws,
      inbound: [],
      inboundBytes: 0,
      outboundBytes: 0,
      open: false,
      closed: false,
      error: false,
      openedAt: 0,
      lastRxAt: 0,
      lastTxAt: 0,
    };
    sockets[id] = entry;
    ws.onopen = () => {
      entry.open = true;
      entry.openedAt = Date.now();
    };
    ws.onmessage = (ev) => {
      const u8 = new Uint8Array(ev.data);
      entry.inbound.push(u8);
      entry.inboundBytes += u8.length;
      entry.lastRxAt = Date.now();
    };
    ws.onerror = () => {
      entry.error = true;
    };
    ws.onclose = () => {
      entry.closed = true;
    };
    return id;
  }

  function isOpen(id) {
    const e = sockets[id];
    return e && e.open && !e.closed;
  }

  function send(id, data) {
    const e = sockets[id];
    if (!e || e.closed) {
      return false;
    }
    const len = data && data.byteLength != null ? data.byteLength : data.length || 0;
    e.outboundBytes += len;
    e.lastTxAt = Date.now();
    e.ws.send(data);
    return true;
  }

  function available(id) {
    const e = sockets[id];
    return e ? e.inboundBytes : 0;
  }

  function read(id, maxLen) {
    const e = sockets[id];
    if (!e || e.inboundBytes === 0) {
      return new Uint8Array(0);
    }
    const out = new Uint8Array(Math.min(maxLen, e.inboundBytes));
    let offset = 0;
    while (offset < out.length && e.inbound.length > 0) {
      const chunk = e.inbound[0];
      const take = Math.min(chunk.length, out.length - offset);
      out.set(chunk.subarray(0, take), offset);
      offset += take;
      if (take === chunk.length) {
        e.inbound.shift();
      } else {
        e.inbound[0] = chunk.subarray(take);
      }
    }
    e.inboundBytes -= offset;
    return out.subarray(0, offset);
  }

  function close(id) {
    const e = sockets[id];
    if (e) {
      e.closed = true;
      try {
        e.ws.close();
      } catch (ignored) {}
      delete sockets[id];
    }
  }

  function getStats() {
    const now = Date.now();
    return Object.keys(sockets).map((k) => {
      const e = sockets[k];
      let state = "connecting";
      if (e.error) state = "error";
      else if (e.closed) state = "closed";
      else if (e.open) state = "open";
      return {
        id: e.id,
        label: e.label,
        url: e.url,
        state,
        rxBytes: e.inboundBytes,
        txBytes: e.outboundBytes,
        lastRxAgoMs: e.lastRxAt ? now - e.lastRxAt : -1,
      };
    });
  }

  return { connect, isOpen, send, available, read, close, getStats };
})();

window.WebSocketBridge = WebSocketBridge;
