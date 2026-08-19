// Protocol layer for the PipiUI capability-tunnel browser client.
// Zero DOM. A faithful extraction of the WebSocket logic that previously
// lived in tunnel-browser.ts: connect/hello, request/response correlation,
// ready/replaced/invalidated/error frame handling. The wire protocol is
// byte-for-byte identical to before.

export type JSONValue = null | string | number | boolean | JSONValue[] | {
  [key: string]: JSONValue;
};
export type CommandBody = { [key: string]: JSONValue };
export type CommandResult = { status: number; body: JSONValue };

export type TunnelStatus =
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "reconnecting" }
  | { kind: "replaced" }
  | { kind: "invalidated" }
  | { kind: "error"; message: string }
  | { kind: "closed" };

export interface TunnelClientOptions {
  tunnelURL: string;
  roomID: string;
  secret: string;
  requestTimeoutMs?: number;
  onStatus?: (status: TunnelStatus) => void;
  random?: () => number;
  schedule?: (fn: () => void, ms: number) => number;
  cancel?: (id: number) => void;
}

function nextReconnectDelayMs(attempt: number, rng: () => number): number {
  const spread = Math.min(15_000, 500 * 2 ** Math.max(0, attempt));
  const delay = Math.round((0.5 + rng()) * spread);
  return Math.min(15_000, Math.max(500, delay));
}

const REQUEST_TIMEOUT_MS = 15_000;

type PendingEntry = {
  resolve: (value: CommandResult) => void;
  reject: (error: Error) => void;
  timer: number;
};

export class TunnelClient {
  private socket: WebSocket | null = null;
  private connected = false;
  private revoked = false;
  private terminal = false;
  private reconnectAttempt = 0;
  private reconnectTimer = 0;
  private readonly pending = new Map<string, PendingEntry>();

  constructor(private readonly options: TunnelClientOptions) {}

  get isConnected(): boolean {
    return this.connected;
  }

  private setStatus(status: TunnelStatus): void {
    this.options.onStatus?.(status);
  }

  private schedule(fn: () => void, ms: number): number {
    return (this.options.schedule ?? ((cb, delay) => window.setTimeout(cb, delay)))(fn, ms);
  }

  private cancelTimer(): void {
    if (!this.reconnectTimer) return;
    (this.options.cancel ?? ((id) => window.clearTimeout(id)))(this.reconnectTimer);
    this.reconnectTimer = 0;
  }

  private retireSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onopen = null;
    socket.onerror = null;
    socket.onclose = null;
    socket.onmessage = null;
    try { socket.close(); } catch { /* ignore */ }
  }

  private scheduleReconnect(): void {
    if (this.revoked || this.terminal) return;
    this.setStatus({ kind: "reconnecting" });
    this.cancelTimer();
    const delay = nextReconnectDelayMs(this.reconnectAttempt, this.options.random ?? Math.random);
    this.reconnectAttempt += 1;
    this.reconnectTimer = this.schedule(() => {
      this.reconnectTimer = 0;
      this.connect();
    }, delay);
  }

  connect(): void {
    if (this.revoked || this.terminal) return;
    this.cancelTimer();
    this.retireSocket();
    const socket = new WebSocket(this.options.tunnelURL);
    this.socket = socket;
    if (!this.connected && this.reconnectAttempt === 0) this.setStatus({ kind: "connecting" });
    else this.setStatus({ kind: "reconnecting" });
    socket.onopen = () => {
      socket.send(JSON.stringify({
        v: 1,
        type: "hello",
        roomID: this.options.roomID,
        secret: this.options.secret,
        role: "browser",
      }));
    };
    socket.onerror = () => {
      // Close follows; do not flash a separate error status.
    };
    socket.onclose = (event) => {
      this.connected = false;
      this.failPending("连接已断开");
      if (this.revoked) return;
      if (event?.reason === "replaced") {
        this.terminal = true;
        this.setStatus({ kind: "replaced" });
        return;
      }
      this.scheduleReconnect();
    };
    socket.onmessage = (event) => {
      this.onMessage(socket, String(event.data));
    };
  }

  private failPending(message: string): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(message));
    }
    this.pending.clear();
  }

  private onMessage(socket: WebSocket, data: string): void {
    let frame: Record<string, any>;
    try {
      frame = JSON.parse(data) as Record<string, any>;
    } catch {
      socket.close();
      return;
    }
    if (frame?.v !== 1 || typeof frame.type !== "string") {
      socket.close();
      return;
    }
    if (frame.type === "ready") {
      this.connected = true;
      this.reconnectAttempt = 0;
      this.setStatus({ kind: "connected" });
      return;
    }
    if (frame.type === "replaced") {
      this.connected = false;
      this.terminal = true;
      this.cancelTimer();
      this.setStatus({ kind: "replaced" });
      return;
    }
    if (frame.type === "invalidated") {
      this.connected = false;
      this.terminal = true;
      this.cancelTimer();
      this.setStatus({ kind: "invalidated" });
      return;
    }
    if (frame.type === "error" && typeof frame.requestID === "string") {
      const entry = this.pending.get(frame.requestID);
      if (!entry) return;
      this.pending.delete(frame.requestID);
      clearTimeout(entry.timer);
      entry.reject(new Error(
        typeof frame.message === "string" ? frame.message : "隧道请求失败",
      ));
      return;
    }
    if (frame.type !== "response" || typeof frame.requestID !== "string"
      || !Number.isInteger(frame.status)) {
      socket.close();
      return;
    }
    const entry = this.pending.get(frame.requestID);
    if (!entry) return;
    this.pending.delete(frame.requestID);
    clearTimeout(entry.timer);
    entry.resolve({ status: frame.status, body: frame.body as JSONValue });
  }

  async command(name: string, body: CommandBody): Promise<any> {
    if (this.revoked || !this.connected || !this.socket
      || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Mac 尚未连接");
    }
    const socket = this.socket;
    const requestID = crypto.randomUUID();
    const result = await new Promise<CommandResult>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(requestID);
        reject(new Error("Mac 响应超时"));
      }, this.options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS);
      this.pending.set(requestID, { resolve, reject, timer });
      socket.send(JSON.stringify({
        v: 1,
        type: "request",
        requestID,
        command: name,
        body,
      }));
    });
    if (result.status === 304) return null;
    if (result.status < 200 || result.status >= 300) {
      const bodyValue = result.body as { error?: unknown } | null;
      throw new Error(typeof bodyValue?.error === "string"
        ? bodyValue.error : `命令失败 (${result.status})`);
    }
    return result.body as any;
  }

  revoke(): void {
    this.revoked = true;
    this.connected = false;
    this.cancelTimer();
    this.socket?.close(1000, "revoked by browser");
  }

  close(): void {
    this.revoked = true;
    this.cancelTimer();
    this.socket?.close(1000, "page closed");
  }
}