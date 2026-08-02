"use strict";
(() => {
  // src/tunnel-host.ts
  var socket = null;
  var generation = "";
  var pending = /* @__PURE__ */ new Set();
  function post(type, extra = {}) {
    window.webkit?.messageHandlers?.pipiRemotePeer?.postMessage({
      v: 1,
      type,
      generation,
      ...extra
    });
  }
  function leave() {
    const current = socket;
    socket = null;
    pending.clear();
    if (current && current.readyState < WebSocket.CLOSING) {
      current.close(1e3, "host stopped");
    }
  }
  function start(config) {
    leave();
    generation = config.generation;
    const next = new WebSocket(config.tunnelURL);
    socket = next;
    next.onopen = () => next.send(JSON.stringify({
      v: 1,
      type: "hello",
      roomID: config.roomID,
      secret: config.secret,
      role: "host"
    }));
    next.onerror = () => post("tunnelError", { message: "\u670D\u52A1\u5668\u96A7\u9053\u8FDE\u63A5\u5931\u8D25" });
    next.onclose = () => {
      if (socket !== next) return;
      socket = null;
      pending.clear();
      post("tunnelClosed");
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
      if (frame.type === "invalidated") return post("tunnelInvalidated");
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
