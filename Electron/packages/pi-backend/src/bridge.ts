import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Loopback host bridge — the Node counterpart of Swift `BridgeServer`.
 *
 * The subagent extension POSTs one JSON envelope per lifecycle event to
 * `http://127.0.0.1:<port>/rpc`. Without a listener those POSTs are silently dropped
 * (`postPipiuiReport` returns early), which is why workers ran but the panel stayed empty.
 *
 * This host speaks the canonical v1 protocol only: every request must carry the
 * per-session capability this process minted. A capability is never derived from the
 * session id, never reused across sessions, and never read from the inherited
 * environment — otherwise any local process could inject agent events into a session.
 */
export type BridgeAgentEvent = Record<string, unknown> & { kind?: string; agentId?: string; runId?: string };
export type BridgeHandlers = {
  onAgentEvent(event: BridgeAgentEvent, sessionId: string): void;
  /** Plan tools POST here; a host with no plan surface still has to answer. */
  onPlanEvent?(event: Record<string, unknown>, sessionId: string): void;
  onBrowserAction?(event: Record<string, unknown>, sessionId: string): Promise<Record<string, unknown>>;
  onTerminalAction?(event: Record<string, unknown>, sessionId: string): Promise<Record<string, unknown>>;
  onComputerAction?(event: Record<string, unknown>, sessionId: string): Promise<Record<string, unknown>>;
};

/** Agent logs are the largest payload; anything past this is refused, not buffered. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export class HostBridge {
  private server?: Server;
  private port?: number;
  /** capability → sessionId. The capability is the only credential; the map is the router. */
  private sessions = new Map<string, string>();
  private computers = new Map<string, string>();

  constructor(private handlers: BridgeHandlers) {}

  /** Idempotent: repeated calls return the port of the already-listening server. */
  async listen(): Promise<number> {
    if (this.port !== undefined) return this.port;
    const server = createServer((request, response) => this.route(request, response));
    server.on("clientError", (_error, socket) => socket.destroy());
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      // Loopback only. A bridge reachable off-host would let any machine on the network
      // drive this session's agent tree.
      server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve() });
    });
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("bridge failed to bind a TCP port");
    this.server = server;
    this.port = address.port;
    return this.port;
  }

  /** Mint this session's capability. Re-registering a session rotates it. */
  register(sessionId: string): string {
    for (const [capability, owner] of this.sessions) if (owner === sessionId) this.sessions.delete(capability);
    const capability = randomBytes(32).toString("base64url");
    this.sessions.set(capability, sessionId);
    return capability;
  }

  registerComputer(sessionId: string): string {
    for (const [capability, owner] of this.computers) if (owner === sessionId) this.computers.delete(capability);
    const capability = randomBytes(32).toString("base64url");
    this.computers.set(capability, sessionId);
    return capability;
  }

  unregister(sessionId: string): void {
    for (const [capability, owner] of this.sessions) if (owner === sessionId) this.sessions.delete(capability);
    for (const [capability, owner] of this.computers) if (owner === sessionId) this.computers.delete(capability);
  }

  async close(): Promise<void> {
    this.sessions.clear();
    this.computers.clear();
    const server = this.server;
    this.server = undefined;
    this.port = undefined;
    if (!server) return;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }

  private sessionFor(capability: unknown): string | undefined {
    if (typeof capability !== "string" || !capability) return undefined;
    for (const [known, sessionId] of this.sessions) if (safeEqual(known, capability)) return sessionId;
    return undefined;
  }

  private route(request: IncomingMessage, response: ServerResponse): void {
    if (request.method !== "POST" || (request.url ?? "").split("?")[0] !== "/rpc") {
      this.reply(response, 404, { ok: false, error: "not found" });
      request.resume();
      return;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { this.reply(response, 413, { ok: false, error: "payload too large" }); request.destroy(); return }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (response.writableEnded) return;
      let body: any;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")) } catch { return this.reply(response, 400, { ok: false, error: "invalid JSON body" }) }
      void this.dispatch(body, response);
    });
    request.on("error", () => { if (!response.writableEnded) this.reply(response, 400, { ok: false, error: "request aborted" }) });
  }

  private async dispatch(body: any, response: ServerResponse): Promise<void> {
    const computerSession =
      body && typeof body === "object" && typeof body.computerCapability === "string"
        ? [...this.computers].find(([capability]) => safeEqual(capability, body.computerCapability))?.[1]
        : undefined;
    if (
      computerSession &&
      body.sessionKey === computerSession &&
      typeof body.action === "string" &&
      body.action.startsWith("computer_")
    ) {
      try {
        return this.reply(
          response,
          200,
          await (this.handlers.onComputerAction?.(body, computerSession) ??
            Promise.resolve({ ok: false, error: "computer host unavailable" })),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return this.reply(response, 200, {
          ok: false,
          error: message,
          runtimeError: {
            code: "computer_host_error",
            message,
            retryable: true,
            requiresObservation: true,
          },
        });
      }
    }
    const sessionId = body && typeof body === "object" ? this.sessionFor(body.sessionCapability) : undefined;
    // Fail closed and identically for a missing, stale or forged capability: an unauthorized
    // caller learns nothing about which sessions exist.
    if (!sessionId || body.schemaVersion !== 1) return this.reply(response, 403, { ok: false, error: "unauthorized bridge capability" });
    const event = body.event;
    if (!event || typeof event !== "object") return this.reply(response, 400, { ok: false, error: "missing event" });
    try {
      if (body.action === "agent_event") this.handlers.onAgentEvent(event as BridgeAgentEvent, sessionId);
      else if (body.action === "plan_event") this.handlers.onPlanEvent?.(event as Record<string, unknown>, sessionId);
      else if (body.action === "browser_action") return this.reply(response, 200, await (this.handlers.onBrowserAction?.(event as Record<string, unknown>, sessionId) ?? Promise.resolve({ ok: false, error: "browser host unavailable" })));
      else if (body.action === "terminal_action") return this.reply(response, 200, await (this.handlers.onTerminalAction?.(event as Record<string, unknown>, sessionId) ?? Promise.resolve({ ok: false, error: "terminal host unavailable" })));
      else return this.reply(response, 400, { ok: false, error: `unsupported action ${String(body.action)}` });
    } catch (error) {
      // A handler fault is this host's problem; never make the worker's reporting call fail.
      console.warn(`[pipi-bridge] handler error: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.reply(response, 200, { ok: true });
  }

  private reply(response: ServerResponse, status: number, payload: unknown): void {
    if (response.writableEnded) return;
    const data = Buffer.from(JSON.stringify(payload));
    response.writeHead(status, { "content-type": "application/json", "content-length": data.length });
    response.end(data);
  }
}
