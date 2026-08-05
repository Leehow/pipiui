"use strict";
(() => {
  // src/tunnel-host.ts
  var socket = null;
  var generation = "";
  var config = null;
  var stopped = true;
  var attempt = 0;
  var retryTimer = null;
  var pending = /* @__PURE__ */ new Set();
  var MAX_RETRY_DELAY_MS = 15e3;
  function post(type, extra = {}) {
    window.webkit?.messageHandlers?.pipiRemotePeer?.postMessage({
      v: 1,
      type,
      generation,
      ...extra
    });
  }
  function clearRetry() {
    if (retryTimer !== null) {
      window.clearTimeout(retryTimer);
      retryTimer = null;
    }
  }
  function scheduleReconnect() {
    if (stopped || !config) return;
    const delay = Math.min(1e3 * 2 ** attempt, MAX_RETRY_DELAY_MS);
    attempt += 1;
    retryTimer = window.setTimeout(connect, delay);
  }
  function connect() {
    if (stopped || !config) return;
    const next = new WebSocket(config.tunnelURL);
    socket = next;
    next.onopen = () => {
      attempt = 0;
      next.send(JSON.stringify({
        v: 1,
        type: "hello",
        roomID: config.roomID,
        secret: config.secret,
        role: "host"
      }));
    };
    next.onerror = () => {
    };
    next.onclose = () => {
      if (socket !== next) return;
      socket = null;
      pending.clear();
      if (stopped) return;
      scheduleReconnect();
    };
    next.onmessage = (event) => {
      let frame;
      try {
        frame = JSON.parse(String(event.data));
      } catch {
        return next.close(1008, "invalid frame");
      }
      if (frame.v !== 1 || typeof frame.type !== "string") {
        return next.close(1008, "invalid frame");
      }
      if (frame.type === "host-ready") return post("tunnelReady");
      if (frame.type === "ready") return post("tunnelBrowserAccepted");
      if (frame.type === "replaced" || frame.type === "invalidated") {
        stopped = true;
        clearRetry();
        return post("tunnelInvalidated");
      }
      if (frame.type !== "request" || typeof frame.requestID !== "string" || typeof frame.command !== "string" || !frame.body || typeof frame.body !== "object" || Array.isArray(frame.body) || pending.size >= 32 || pending.has(frame.requestID)) {
        return next.close(1008, "invalid request");
      }
      pending.add(frame.requestID);
      post("tunnelRequest", {
        requestID: frame.requestID,
        command: frame.command,
        body: frame.body
      });
    };
  }
  function leave() {
    stopped = true;
    config = null;
    clearRetry();
    const current = socket;
    socket = null;
    pending.clear();
    if (current && current.readyState === WebSocket.OPEN) {
      current.send(JSON.stringify({ v: 1, type: "end" }));
    }
    if (current && current.readyState < WebSocket.CLOSING) {
      current.close(1e3, "host stopped");
    }
  }
  function start(incoming) {
    stopped = false;
    config = incoming;
    generation = incoming.generation;
    attempt = 0;
    clearRetry();
    const current = socket;
    socket = null;
    pending.clear();
    if (current && current.readyState < WebSocket.CLOSING) {
      current.close(1e3, "restart");
    }
    connect();
  }
  function resolveRequest(requestID, response, errorMessage) {
    if (!pending.delete(requestID) || !socket || socket.readyState !== WebSocket.OPEN) return;
    const value = errorMessage ? { status: 500, body: { error: errorMessage } } : response ?? { status: 500, body: { error: "empty native response" } };
    socket.send(JSON.stringify({
      v: 1,
      type: "response",
      requestID,
      status: value.status,
      body: value.body
    }));
  }
  Object.assign(window, {
    pipiTunnelHost: Object.freeze({ start, leave, resolveRequest })
  });
})();
