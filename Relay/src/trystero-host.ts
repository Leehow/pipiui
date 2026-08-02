import { joinRoom, type Room } from "@trystero-p2p/ws-relay";
import { OneTimePeerGate } from "./trystero-peer-gate.js";

type StartConfig = {
  generation: string;
  roomID: string;
  password: string;
  signalURL: string;
};
type JSONValue = null | string | number | boolean | JSONValue[] | {
  [key: string]: JSONValue;
};
type CommandBody = { [key: string]: JSONValue };
type NativeResponse = { status: number; body: JSONValue };

declare global {
  interface Window {
    webkit?: {
      messageHandlers?: {
        pipiRemotePeer?: { postMessage: (value: unknown) => void };
      };
    };
  }
}

let room: Room | null = null;
let generation = "";
let peerGate = new OneTimePeerGate();
const pending = new Map<string, {
  resolve: (value: NativeResponse) => void;
  reject: (error: Error) => void;
  timer: number;
}>();

function post(type: string, extra: Record<string, unknown> = {}) {
  window.webkit?.messageHandlers?.pipiRemotePeer?.postMessage({
    v: 1, type, generation, ...extra,
  });
}

function nativeRequest(command: string, body: CommandBody) {
  return new Promise<NativeResponse>((resolve, reject) => {
    const requestID = crypto.randomUUID();
    const timer = window.setTimeout(() => {
      pending.delete(requestID);
      reject(new Error("native command timed out"));
    }, 15_000);
    pending.set(requestID, { resolve, reject, timer });
    post("trysteroRequest", { requestID, command, body });
  });
}

async function leave() {
  const current = room;
  room = null;
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(new Error("link revoked"));
  }
  pending.clear();
  if (current) await current.leave();
}

async function start(config: StartConfig) {
  await leave();
  peerGate = new OneTimePeerGate();
  generation = config.generation;
  const next = joinRoom({
    appId: "pipiui-remote-v1",
    password: config.password,
    relayConfig: { urls: [config.signalURL] },
    ...(["127.0.0.1", "localhost"].includes(new URL(config.signalURL).hostname)
      ? { _test_only_mdnsHostFallbackToLoopback: true } : {}),
  }, config.roomID, {
    handshakeTimeoutMs: 8_000,
    onPeerHandshake: async (peerID, send, receive) => {
      await send({ v: 1, role: "host" });
      const remote = await receive();
      peerGate.reserveBrowser(peerID, remote.data);
    },
    onJoinError: ({ error }) => post("trysteroError", { message: error }),
  });
  room = next;
  const action = next.makeAction<
    { command: string; body: CommandBody },
    NativeResponse
  >("pipiui-command-v1", { kind: "request" });
  action.onRequest = async (data, context) => {
    if (!peerGate.accepts(context.peerId)
      || !data || typeof data.command !== "string"
      || !data.body || typeof data.body !== "object") {
      throw new Error("request rejected");
    }
    return nativeRequest(data.command, data.body);
  };
  next.onPeerJoin = (peerID) => {
    if (peerGate.accepts(peerID)) post("trysteroPeerAccepted", { peerID });
  };
  next.onPeerLeave = (peerID) => {
    if (!peerGate.expire(peerID)) return;
    post("trysteroPeerLeft", { peerID });
    // The link is consumed permanently. Leaving the room removes signaling
    // subscriptions so even the same Trystero self ID cannot reconnect.
    void leave();
  };
  post("trysteroReady");
}

function resolveRequest(
  requestID: string,
  response: NativeResponse | null,
  errorMessage?: string,
) {
  const entry = pending.get(requestID);
  if (!entry) return;
  pending.delete(requestID);
  clearTimeout(entry.timer);
  if (errorMessage) entry.reject(new Error(errorMessage));
  else if (response) entry.resolve(response);
  else entry.reject(new Error("empty native response"));
}

Object.assign(window, {
  pipiTrysteroHost: Object.freeze({ start, leave, resolveRequest }),
});
