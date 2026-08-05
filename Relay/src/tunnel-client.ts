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
  private readonly pending = new Map<string, PendingEntry>();

  constructor(private readonly options: TunnelClientOptions) {}

  get isConnected(): boolean {
    return this.connected;
  }

  private setStatus(status: TunnelStatus): void {
    this.options.onStatus?.(status);
  }

  connect(): void {
    const socket = new WebSocket(this.options.tunnelURL);
    this.socket = socket;
    this.setStatus({ kind: "connecting" });
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
      // The onclose handler surfaces the failure; keep the same semantics as
      // the original client (an error status is shown).
      this.setStatus({ kind: "error", message: "服务器隧道连接失败" });
    };
    socket.onclose = (event) => {
      this.connected = false;
      this.failPending("连接已断开");
      if (this.revoked) return;
      if (event?.reason === "replaced") {
        this.setStatus({ kind: "replaced" });
        return;
      }
      this.setStatus({ kind: "closed" });
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
      this.setStatus({ kind: "connected" });
      return;
    }
    if (frame.type === "replaced") {
      this.connected = false;
      this.setStatus({ kind: "replaced" });
      return;
    }
    if (frame.type === "invalidated") {
      this.connected = false;
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
    this.socket?.close(1000, "revoked by browser");
  }

  close(): void {
    this.revoked = true;
    this.socket?.close(1000, "page closed");
  }
}