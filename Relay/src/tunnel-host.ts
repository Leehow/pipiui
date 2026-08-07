type StartConfig = {
  generation: string;
  roomID: string;
  secret: string;
  tunnelURL: string;
};
type JSONValue = null | string | number | boolean | JSONValue[] | {
  [key: string]: JSONValue;
};
type CommandBody = { [key: string]: JSONValue };
type NativeResponse = { status: number; body: JSONValue };

declare global {
  interface Window {
    webkit?: { messageHandlers?: {
      pipiRemotePeer?: { postMessage: (value: unknown) => void };
    } };
  }
}

let socket: WebSocket | null = null;
let generation = "";
let config: StartConfig | null = null;
let stopped = true;
let attempt = 0;
let retryTimer: number | null = null;
const pending = new Set<string>();
const MAX_RETRY_DELAY_MS = 15_000;

function post(type: string, extra: Record<string, unknown> = {}) {
  window.webkit?.messageHandlers?.pipiRemotePeer?.postMessage({
    v: 1, type, generation, ...extra,
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
  const delay = Math.min(1_000 * (2 ** attempt), MAX_RETRY_DELAY_MS);
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
      roomID: config!.roomID,
      secret: config!.secret,
      role: "host",
    }));
  };
  next.onerror = () => { /* onclose follows and drives the reconnect */ };
  next.onclose = () => {
    if (socket !== next) return;
    socket = null;
    pending.clear();
    if (stopped) return;
    // Unexpected drop: rejoin the same room with backoff, indefinitely.
    scheduleReconnect();
  };
  next.onmessage = (event) => {
    let frame: Record<string, unknown>;
    try { frame = JSON.parse(String(event.data)) as Record<string, unknown>; }
    catch { return next.close(1008, "invalid frame"); }
    if (frame.v !== 1 || typeof frame.type !== "string") {
      return next.close(1008, "invalid frame");
    }
    if (frame.type === "host-ready") return post("tunnelReady");
    if (frame.type === "ready") return post("tunnelBrowserAccepted");
    if (frame.type === "replaced" || frame.type === "invalidated") {
      // This host is no longer the room's host (replaced by another host, the
      // room was invalidated, or the room expired). Stop reconnecting.
      stopped = true;
      clearRetry();
      return post("tunnelInvalidated");
    }
    if (frame.type !== "request"
      || typeof frame.requestID !== "string"
      || typeof frame.command !== "string"
      || !frame.body || typeof frame.body !== "object"
      || Array.isArray(frame.body) || pending.size >= 32
      || pending.has(frame.requestID)) {
      return next.close(1008, "invalid request");
    }
    pending.add(frame.requestID);
    post("tunnelRequest", {
      requestID: frame.requestID,
      command: frame.command,
      body: frame.body,
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
  // Tell the server this is an intentional host teardown so it can
  // invalidate + tombstone the room (vs. a transient drop to rejoin).
  if (current && current.readyState === WebSocket.OPEN) {
    current.send(JSON.stringify({ v: 1, type: "end" }));
  }
  if (current && current.readyState < WebSocket.CLOSING) {
    current.close(1000, "host stopped");
  }
}

// Drop the host socket without ending the room. Used on app quit / client
// restart so the same roomID+secret can re-hello within the server TTL.
function disconnect() {
  stopped = true;
  config = null;
  clearRetry();
  const current = socket;
  socket = null;
  pending.clear();
  if (current && current.readyState < WebSocket.CLOSING) {
    current.close(1000, "host disconnected");
  }
}

function start(incoming: StartConfig) {
  stopped = false;
  config = incoming;
  generation = incoming.generation;
  attempt = 0;
  clearRetry();
  // Drop any previous socket without sending "end" (we are switching to a new
  // generation, not tearing the room down).
  const current = socket;
  socket = null;
  pending.clear();
  if (current && current.readyState < WebSocket.CLOSING) {
    current.close(1000, "restart");
  }
  connect();
}

function resolveRequest(
  requestID: string,
  response: NativeResponse | null,
  errorMessage?: string,
) {
  if (!pending.delete(requestID) || !socket
    || socket.readyState !== WebSocket.OPEN) return;
  const value = errorMessage
    ? { status: 500, body: { error: errorMessage } }
    : response ?? { status: 500, body: { error: "empty native response" } };
  socket.send(JSON.stringify({
    v: 1,
    type: "response",
    requestID,
    status: value.status,
    body: value.body,
  }));
}

Object.assign(window, {
  pipiTunnelHost: Object.freeze({ start, leave, disconnect, resolveRequest }),
});
