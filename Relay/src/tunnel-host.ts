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
const pending = new Set<string>();

function post(type: string, extra: Record<string, unknown> = {}) {
  window.webkit?.messageHandlers?.pipiRemotePeer?.postMessage({
    v: 1, type, generation, ...extra,
  });
}

function leave() {
  const current = socket;
  socket = null;
  pending.clear();
  if (current && current.readyState < WebSocket.CLOSING) {
    current.close(1000, "host stopped");
  }
}

function start(config: StartConfig) {
  leave();
  generation = config.generation;
  const next = new WebSocket(config.tunnelURL);
  socket = next;
  next.onopen = () => next.send(JSON.stringify({
    v: 1,
    type: "hello",
    roomID: config.roomID,
    secret: config.secret,
    role: "host",
  }));
  next.onerror = () => post("tunnelError", { message: "服务器隧道连接失败" });
  next.onclose = () => {
    if (socket !== next) return;
    socket = null;
    pending.clear();
    post("tunnelClosed");
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
    if (frame.type === "invalidated") return post("tunnelInvalidated");
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
  pipiTunnelHost: Object.freeze({ start, leave, resolveRequest }),
});
