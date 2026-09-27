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
      // Everything ever received, as opposed to inboundBytes, which is what the client has not read
      // yet; this is the one to difference for a transfer rate.
      totalInboundBytes: 0,
      outboundBytes: 0,
      pending: [],
      pendingBytes: 0,
      flushQueued: false,
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
      entry.totalInboundBytes += u8.length;
      entry.lastRxAt = Date.now();
    };
    ws.onerror = () => {
      entry.error = true;
    };
    ws.onclose = (ev) => {
      entry.closed = true;
      // One line per socket lifetime: a JS5 reconnect mid-load or a game socket dropping is
      // otherwise invisible, and which side closed it is the first thing worth knowing.
      console.log(
        "[ws] " + entry.label + " closed by " + (entry.byClient ? "client" : "server") +
        " code=" + (ev && ev.code) + " rx=" + entry.totalInboundBytes + " tx=" + entry.outboundBytes
      );
      // A socket that never opened failed to connect, and boot already reports that. A socket the
      // client closed on purpose is a logout. Anything else is the connection being taken away —
      // on a phone that is a wifi handoff or the browser reclaiming a backgrounded page.
      if (entry.open && !entry.byClient) {
        report(entry.label);
      }
    };
    return id;
  }

  /**
   * Tells the page a live connection went away.
   *
   * One-way and optional, like the loading and login bridges: the client cannot do anything with
   * this — its session is gone either way — so the page is the only thing that can react.
   */
  function report(label) {
    const sink = window.FluxConnection;
    if (sink && typeof sink.dropped === "function") {
      try {
        sink.dropped(label);
      } catch (ignored) {}
    }
  }

  function isOpen(id) {
    const e = sockets[id];
    return e && e.open && !e.closed;
  }

  /**
   * Queues bytes to go out, and sends everything queued once the current task ends.
   *
   * The client writes a JS5 request as its own 4-byte send, hundreds of them in one game cycle,
   * and each WebSocket.send is a frame with its own per-call cost — a cold load spent a third of a
   * second in it. A microtask runs as soon as the client's cycle returns to the event loop, so the
   * requests still leave this frame, only as one WebSocket frame. The bridge writes frames straight
   * to the game socket, so the server sees the same byte stream either way.
   */
  function send(id, data) {
    const e = sockets[id];
    if (!e || e.closed) {
      return false;
    }
    const bytes = data instanceof Uint8Array
      ? data
      : data && data.buffer
        ? new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength)
        : new Uint8Array(data);
    // Copied: the caller may reuse its array before the flush runs.
    e.pending.push(bytes.slice());
    e.pendingBytes += bytes.length;
    e.outboundBytes += bytes.length;
    e.lastTxAt = Date.now();
    if (!e.flushQueued) {
      e.flushQueued = true;
      queueMicrotask(() => flushPending(e));
    }
    return true;
  }

  function flushPending(e) {
    e.flushQueued = false;
    if (e.pending.length === 0) {
      return;
    }
    let frame;
    if (e.pending.length === 1) {
      frame = e.pending[0];
    } else {
      frame = new Uint8Array(e.pendingBytes);
      let offset = 0;
      for (let i = 0; i < e.pending.length; i++) {
        frame.set(e.pending[i], offset);
        offset += e.pending[i].length;
      }
    }
    e.pending.length = 0;
    e.pendingBytes = 0;
    if (e.closed || e.ws.readyState !== 1) {
      return;
    }
    try {
      e.ws.send(frame);
    } catch (err) {
      console.error("[ws] " + e.label + " send failed", err);
      entryError(e);
    }
  }

  function entryError(e) {
    e.error = true;
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

  /**
   * Reads straight into the client's own byte array, and says how many bytes landed.
   *
   * `target` is the Java array's backing Int8Array (the caller passes it by reference), so the
   * bytes cross once: the version above allocates a fresh array, hands it to Java - which copies it
   * into a Java array - and Java then copies that into its buffer. On a fresh cache that was three
   * copies and two allocations per 512-byte block, tens of thousands of times over.
   */
  function readInto(id, target, offset, maxLen) {
    const e = sockets[id];
    if (!e || e.inboundBytes === 0) {
      return 0;
    }
    const want = Math.min(maxLen, e.inboundBytes, target.length - offset);
    let done = 0;
    while (done < want && e.inbound.length > 0) {
      const chunk = e.inbound[0];
      const take = Math.min(chunk.length, want - done);
      target.set(take === chunk.length ? chunk : chunk.subarray(0, take), offset + done);
      done += take;
      if (take === chunk.length) {
        e.inbound.shift();
      } else {
        e.inbound[0] = chunk.subarray(take);
      }
    }
    e.inboundBytes -= done;
    return done;
  }

  function close(id) {
    const e = sockets[id];
    if (e) {
      // Anything still queued goes first: a logout packet is the usual last thing sent.
      flushPending(e);
      // Marked before the close so the onclose handler above knows this was deliberate.
      e.byClient = true;
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
        totalRxBytes: e.totalInboundBytes,
        txBytes: e.outboundBytes,
        lastRxAgoMs: e.lastRxAt ? now - e.lastRxAt : -1,
      };
    });
  }

  return { connect, isOpen, send, available, read, readInto, close, getStats };
})();

window.WebSocketBridge = WebSocketBridge;
