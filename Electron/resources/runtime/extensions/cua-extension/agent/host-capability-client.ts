// cua-extension host capability transport.
//
// Every driver call travels as one versioned `HostCapabilityRequestV1` envelope
// over the loopback bridge `host_capability` action (see
// `packages/host-api/src/host-capability.ts` and `packages/pi-backend/src/host-capability.ts`).
// The broker re-negotiates the manifest `hostApi` range, re-checks the
// per-project permission grant, and consumes a one-time capability token before
// CuaDriverHost runs; the desktop-grant capability (`PIPIUI_COMPUTER_CAPABILITY`)
// still rides inside `params` so the host-side grant check and the driver's
// session/pid/window owner binding see byte-identical fields.
//
// Tokens are host-minted one-time secrets (CONSTITUTION §7 class C). This
// client never invents one: it asks the host to mint via the loopback
// `host_capability_token` op and fails closed when the host does not answer.
import { randomUUID } from "node:crypto";

export const HOST_CAPABILITY_WIRE_VERSION = 1;
export const CUA_EXTENSION_ID = "cua-extension";
export const CUA_HOST_API_RANGE = ">=1.0.0 <2.0.0";
const REQUEST_TIMEOUT_MS = 35_000;
const CANCEL_TIMEOUT_MS = 1_500;

/** Error raised for broker denies, transport failures, and missing tokens. */
export class HostCapabilityError extends Error {
  /** Broker deny code (`token_required`, `permission_denied`, ...) when known. */
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "HostCapabilityError";
    if (code) this.code = code;
  }
}

export type NativeCuaClientOptions = {
  bridgePort: string;
  /** Bridge session capability (`PIPIUI_SESSION_CAPABILITY`); authenticates the `host_capability` route. */
  sessionCapability: string;
  /** Session key (`PIPIUI_SESSION_KEY`); the driver's pid/window owner binding input, unchanged. */
  sessionKey: string;
  /** Desktop-grant capability (`PIPIUI_COMPUTER_CAPABILITY`), presented inside params, unchanged. */
  computerCapability: string;
  extensionId?: string;
  hostApi?: string;
  projectRoot?: string;
  requestTimeoutMs?: number;
  cancelTimeoutMs?: number;
  /** One-time token source. Defaults to the loopback `host_capability_token` mint op. */
  /** Receives the call's abort signal so the mint hop is bounded like the action hop. */
  tokenProvider?: (signal?: AbortSignal) => string | Promise<string>;
  fetchImpl?: typeof fetch;
};

export type NativeCuaClient = {
  /**
   * Run one legacy computer_* driver op (`computer_batch`,
   * `computer_open_application`, `computer_cancel`,
   * `computer_runtime_capabilities`) through the broker. `params` is the exact
   * body the legacy bridge route handed to CuaDriverHost.handle.
   */
  call(params: Record<string, unknown>, externalSignal?: AbortSignal): Promise<Record<string, unknown>>;
  /** Mint a fresh one-time capability token (host side). Exposed for tests. */
  mintToken(signal?: AbortSignal): Promise<string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Default token source: ask the host to mint one token per call. Fails closed. */
function createMintingTokenProvider(options: Required<Pick<NativeCuaClientOptions, "bridgePort" | "sessionCapability" | "extensionId" | "projectRoot">> & { fetchImpl: typeof fetch }): (signal?: AbortSignal) => Promise<string> {
  return async (signal?: AbortSignal) => {
    const response = await options.fetchImpl(`http://127.0.0.1:${options.bridgePort}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // The mint is a host round trip and hangs the same ways the action hop does;
      // unsignalled it sits outside every deadline, including the user's Stop.
      ...(signal ? { signal } : {}),
      body: JSON.stringify({
        schemaVersion: HOST_CAPABILITY_WIRE_VERSION,
        sessionCapability: options.sessionCapability,
        action: "host_capability_token",
        event: {
          extensionId: options.extensionId,
          permission: "native.exec",
          projectRoot: options.projectRoot,
        },
      }),
    });
    let json: any;
    try {
      json = await response.json();
    } catch {
      throw new HostCapabilityError("host capability token mint returned a non-JSON response");
    }
    if (!response.ok || !isRecord(json) || json.ok !== true || typeof json.token !== "string" || !json.token) {
      const detail = isRecord(json) && typeof json.error === "string" ? json.error : `HTTP ${response.status}`;
      throw new HostCapabilityError(`host capability token mint failed: ${detail}`);
    }
    return json.token;
  };
}

export function createNativeCuaClient(options: NativeCuaClientOptions): NativeCuaClient {
  const bridgePort = options.bridgePort;
  const sessionCapability = options.sessionCapability;
  const extensionId = options.extensionId ?? CUA_EXTENSION_ID;
  const hostApi = options.hostApi ?? CUA_HOST_API_RANGE;
  const projectRoot = options.projectRoot ?? process.cwd();
  const requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const cancelTimeoutMs = options.cancelTimeoutMs ?? CANCEL_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const tokenProvider = options.tokenProvider
    ?? createMintingTokenProvider({ bridgePort, sessionCapability, extensionId, projectRoot, fetchImpl });

  async function postBridge(body: Record<string, unknown>, timeoutMs: number, externalSignal?: AbortSignal): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const forwardAbort = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    else externalSignal?.addEventListener("abort", forwardAbort, { once: true });
    try {
      const response = await fetchImpl(`http://127.0.0.1:${bridgePort}/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(body),
      });
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        throw new HostCapabilityError("host capability response was not JSON");
      }
      if (!response.ok) {
        const error = isRecord(json) && typeof json.error === "string" ? json.error : `HTTP ${response.status}`;
        throw new HostCapabilityError(error);
      }
      if (!isRecord(json) || json.schemaVersion !== HOST_CAPABILITY_WIRE_VERSION || typeof json.ok !== "boolean") {
        throw new HostCapabilityError("invalid host capability response envelope");
      }
      return json;
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", forwardAbort);
    }
  }

  async function mintToken(signal?: AbortSignal): Promise<string> {
    const token = await tokenProvider(signal);
    if (typeof token !== "string" || !token) {
      throw new HostCapabilityError(
        `host capability token for '${extensionId}' is not configured; the host has not minted a capability token for this session`,
      );
    }
    return token;
  }

  async function cancelDriverOp(requestID: string): Promise<void> {
    try {
      const token = await mintToken();
      await postBridge({
        schemaVersion: HOST_CAPABILITY_WIRE_VERSION,
        sessionCapability,
        action: "host_capability",
        event: {
          schemaVersion: HOST_CAPABILITY_WIRE_VERSION,
          extensionId,
          hostApi,
          permission: "native.exec",
          projectRoot,
          token,
          op: "native.cua",
          // sessionKey/computerCapability are the unchanged desktop-grant and
          // driver owner-binding fields every legacy computer_* body carried.
          params: {
            sessionKey: options.sessionKey,
            computerCapability: options.computerCapability,
            action: "computer_cancel",
            protocolVersion: 1,
            requestID,
          },
        },
      }, cancelTimeoutMs);
    } catch {
      // The driver also runs a disconnect/timeout cancellation watchdog.
    }
  }

  async function call(params: Record<string, unknown>, externalSignal?: AbortSignal): Promise<Record<string, unknown>> {
    const requestID = typeof params.requestID === "string" && params.requestID
      ? params.requestID
      : randomUUID();
    const label = params.action === "computer_open_application"
      ? "open_application"
      : "computer";
    let brokerResponse: Record<string, unknown>;
    // Armed before the mint: one budget and one signal cover both host hops.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    const forwardAbort = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    else externalSignal?.addEventListener("abort", forwardAbort, { once: true });
    try {
      const token = await mintToken(controller.signal);
      const response = await fetchImpl(`http://127.0.0.1:${bridgePort}/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          schemaVersion: HOST_CAPABILITY_WIRE_VERSION,
          sessionCapability,
          action: "host_capability",
          event: {
            schemaVersion: HOST_CAPABILITY_WIRE_VERSION,
            extensionId,
            hostApi,
            permission: "native.exec",
            projectRoot,
            token,
            op: "native.cua",
            params: {
              ...params,
              // Desktop grant + driver owner binding: byte-identical to the
              // legacy computer_* request body fields.
              sessionKey: options.sessionKey,
              computerCapability: options.computerCapability,
              requestID,
            },
          },
        }),
      });
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        json = undefined;
      }
      if (controller.signal.aborted) {
        throw new HostCapabilityError(`${label} request was cancelled while decoding the bridge response`);
      }
      if (!isRecord(json)) {
        throw new HostCapabilityError(`${label} bridge response was not JSON`);
      }
      if (!response.ok) {
        const error = typeof json.error === "string" ? json.error : `HTTP ${response.status}`;
        throw new HostCapabilityError(error);
      }
      if (json.schemaVersion !== HOST_CAPABILITY_WIRE_VERSION || typeof json.ok !== "boolean") {
        throw new HostCapabilityError("invalid host capability response envelope");
      }
      brokerResponse = json;
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        await cancelDriverOp(requestID);
        throw new HostCapabilityError(`${label} request timed out and was cancelled`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", forwardAbort);
    }
    if (brokerResponse.ok !== true) {
      const code = typeof brokerResponse.code === "string" ? brokerResponse.code : undefined;
      const error = typeof brokerResponse.error === "string" ? brokerResponse.error : "computer host capability request failed";
      throw new HostCapabilityError(error, code);
    }
    const result = brokerResponse.result;
    if (!isRecord(result)) {
      throw new HostCapabilityError("host capability success payload missing driver result");
    }
    return result;
  }

  return { call, mintToken };
}
