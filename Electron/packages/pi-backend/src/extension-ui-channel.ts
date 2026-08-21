import { PIPI_HOST_PROTOCOL_VERSION } from "@pipi/host-api";

/** Official pi UI hooks (notify/confirm/select/input/widget) — parallel to `ext.emit` (spec D12). */
export const EXTUI_CHANNEL = "extui" as const;
/** Host-side dialog timeout. Tests may override via PiBackendOptions.extensionUiTimeoutMs. */
export const EXTUI_TIMEOUT_MS = 30_000;

const DIALOG_KINDS = new Set(["confirm", "select", "input", "editor"]);
const METHOD_KIND: Record<string, string> = { setWidget: "widget" };

export type ExtUiCancelReason = "timeout" | "aborted";

export type ExtUiEvent =
  | {
      type: "request";
      sessionId: string;
      requestId: string;
      kind: string;
      payload: unknown;
    }
  | {
      type: "cancel";
      sessionId: string;
      requestId: string;
      reason: ExtUiCancelReason;
    };

export type ExtUiHostEvent = {
  protocolVersion: typeof PIPI_HOST_PROTOCOL_VERSION;
  channel: typeof EXTUI_CHANNEL;
  event: ExtUiEvent;
};

export type ExtUiResponseBody = {
  value?: unknown;
  confirmed?: boolean;
  cancelled?: boolean;
};

export type ExtUiRespondResult =
  | { ok: true; command: { type: "extension_ui_response"; id: string } & ExtUiResponseBody }
  | { ok: false; error: "late" | "invalid" };

export function isExtensionUiRequest(e: { type?: unknown } | null | undefined): boolean {
  return e?.type === "extension_ui_request";
}

export function kindFromMethod(method: unknown): string {
  if (typeof method !== "string" || !method) return "unknown";
  return METHOD_KIND[method] ?? method;
}

export function needsResponse(kind: string): boolean {
  return DIALOG_KINDS.has(kind);
}

export function mapExtensionUiRequest(
  sessionId: string,
  rpc: Record<string, unknown>,
): ExtUiHostEvent | undefined {
  if (!isExtensionUiRequest(rpc)) return undefined;
  const requestId = typeof rpc.id === "string" ? rpc.id : "";
  if (!requestId) return undefined;
  const kind = kindFromMethod(rpc.method);
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rpc)) {
    if (key === "type" || key === "id" || key === "method") continue;
    payload[key] = value;
  }
  return {
    protocolVersion: PIPI_HOST_PROTOCOL_VERSION,
    channel: EXTUI_CHANNEL,
    event: { type: "request", sessionId, requestId, kind, payload },
  };
}

function sanitizeResponse(response: unknown): ExtUiResponseBody | undefined {
  if (!response || typeof response !== "object" || Array.isArray(response)) return undefined;
  const src = response as Record<string, unknown>;
  const body: ExtUiResponseBody = {};
  if ("value" in src) body.value = src.value;
  if (typeof src.confirmed === "boolean") body.confirmed = src.confirmed;
  if (src.cancelled === true) body.cancelled = true;
  return body;
}

type Pending = {
  sessionId: string;
  requestId: string;
  timer: ReturnType<typeof setTimeout>;
};

export type ExtensionUiChannelOptions = {
  emit: (event: ExtUiHostEvent) => void;
  /** Write `extension_ui_response` on timeout/abort so pi does not hang. */
  writeResponse?: (sessionId: string, body: { type: "extension_ui_response"; id: string; cancelled: true }) => void;
  timeoutMs?: number;
};

/** In-flight dialog table keyed by sessionId + requestId. */
export class ExtensionUiChannel {
  private readonly pending = new Map<string, Pending>();
  private readonly emit: ExtensionUiChannelOptions["emit"];
  private readonly writeResponse: ExtensionUiChannelOptions["writeResponse"];
  private readonly timeoutMs: number;

  constructor(options: ExtensionUiChannelOptions) {
    this.emit = options.emit;
    this.writeResponse = options.writeResponse;
    this.timeoutMs = options.timeoutMs ?? EXTUI_TIMEOUT_MS;
  }

  private key(sessionId: string, requestId: string): string {
    return `${sessionId}\0${requestId}`;
  }

  isPending(sessionId: string, requestId: string): boolean {
    return this.pending.has(this.key(sessionId, requestId));
  }

  /** Map a pi stdout RPC event. Returns true when consumed (caller must not treat it as stream). */
  handleRpc(sessionId: string, rpc: Record<string, unknown>): boolean {
    const event = mapExtensionUiRequest(sessionId, rpc);
    if (!event) return false;
    this.emit(event);
    if (event.event.type === "request" && needsResponse(event.event.kind)) {
      this.arm(sessionId, event.event.requestId);
    }
    return true;
  }

  respond(sessionId: string, requestId: string, response: unknown): ExtUiRespondResult {
    if (typeof sessionId !== "string" || !sessionId || typeof requestId !== "string" || !requestId) {
      return { ok: false, error: "invalid" };
    }
    const body = sanitizeResponse(response);
    if (!body) return { ok: false, error: "invalid" };
    const key = this.key(sessionId, requestId);
    const pending = this.pending.get(key);
    if (!pending) return { ok: false, error: "late" };
    clearTimeout(pending.timer);
    this.pending.delete(key);
    return { ok: true, command: { type: "extension_ui_response", id: requestId, ...body } };
  }

  abortSession(sessionId: string): void {
    for (const [key, pending] of [...this.pending]) {
      if (pending.sessionId !== sessionId) continue;
      this.finish(key, pending, "aborted");
    }
  }

  dispose(): void {
    for (const [key, pending] of [...this.pending]) {
      this.finish(key, pending, "aborted");
    }
  }

  private arm(sessionId: string, requestId: string): void {
    const key = this.key(sessionId, requestId);
    const existing = this.pending.get(key);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      const current = this.pending.get(key);
      if (!current) return;
      this.finish(key, current, "timeout");
    }, this.timeoutMs);
    timer.unref?.();
    this.pending.set(key, { sessionId, requestId, timer });
  }

  private finish(key: string, pending: Pending, reason: ExtUiCancelReason): void {
    clearTimeout(pending.timer);
    this.pending.delete(key);
    this.emit({
      protocolVersion: PIPI_HOST_PROTOCOL_VERSION,
      channel: EXTUI_CHANNEL,
      event: {
        type: "cancel",
        sessionId: pending.sessionId,
        requestId: pending.requestId,
        reason,
      },
    });
    try {
      this.writeResponse?.(pending.sessionId, {
        type: "extension_ui_response",
        id: pending.requestId,
        cancelled: true,
      });
    } catch {
      /* process may already be gone */
    }
  }
}
