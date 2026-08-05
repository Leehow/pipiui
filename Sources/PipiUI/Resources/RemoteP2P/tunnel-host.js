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
  var FIRST_RETRY_DELAY_MS = 800;
  var MAX_RECONNECT_ATTEMPTS = 8;
  // Dead-link liveness probe. The relay sends WebSocket-level pings every 25s
  // and terminates the socket if no pong returns; a host that lost connectivity
  // (e.g. Wi-Fi -> cellular handoff) won't receive that terminate either, so
  // the browser-side onclose can stay dormant for a long time. We cannot emit
  // arbitrary application frames (the relay only accepts hello/request/response/
  // end from hosts), so we fall back to a silence watchdog: if no frame at all
  // arrives within the deadline while a browser is attached, treat the link as
  // half-open and force a reconnect. Idle rooms without a browser stay quiet on
  // purpose, so the watchdog only arms once a browser has joined.
  var SILENCE_TIMEOUT_MS = 6e4;
  var lastReceivedAt = 0;
  var silenceTimer = null;
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
  function clearSilence() {
    if (silenceTimer !== null) {
      window.clearTimeout(silenceTimer);
      silenceTimer = null;
    }
  }
  function armSilence() {
    clearSilence();
    silenceTimer = window.setTimeout(onSilence, SILENCE_TIMEOUT_MS);
  }
  function markReceived() {
    lastReceivedAt = Date.now();
    armSilence();
  }
  function onSilence() {
    const current = socket;
    if (stopped || !current || current.readyState !== WebSocket.OPEN) return;
    current.close(4001, "silence watchdog");
  }
  function nextDelay() {
    if (attempt === 0) return FIRST_RETRY_DELAY_MS;
    return Math.min(FIRST_RETRY_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS);
  }
  function scheduleReconnect() {
    if (stopped || !config) return;
    if (attempt >= MAX_RECONNECT_ATTEMPTS) {
      pending.clear();
      post("tunnelClosed", { reason: "reconnect attempts exhausted" });
      return;
    }
    const delay = nextDelay();
    attempt += 1;
    post("tunnelReconnecting", { attempt, delayMs: delay });
    retryTimer = window.setTimeout(connect, delay);
  }
  function connect() {
    if (stopped || !config) return;
    const next = new WebSocket(config.tunnelURL);
    socket = next;
    next.onopen = () => {
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
      clearSilence();
      pending.clear();
      if (stopped) return;
      scheduleReconnect();
    };
    next.onmessage = (event) => {
      markReceived();
      let frame;
      try {
        frame = JSON.parse(String(event.data));
      } catch {
        return next.close(1008, "invalid frame");
      }
      if (frame.v !== 1 || typeof frame.type !== "string") {
        return next.close(1008, "invalid frame");
      }
      if (frame.type === "host-ready") {
        attempt = 0;
        return post("tunnelReady");
      }
      if (frame.type === "ready") return post("tunnelBrowserAccepted");
      if (frame.type === "replaced" || frame.type === "invalidated") {
        stopped = true;
        clearRetry();
        clearSilence();
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
    clearSilence();
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
    clearSilence();
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
