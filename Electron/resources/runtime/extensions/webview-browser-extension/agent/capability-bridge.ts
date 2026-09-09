/**
 * Host Capability API client for the webview-browser-extension agent half.
 *
 * Every WebContentsView/session call travels as one versioned
 * `HostCapabilityRequestV1` envelope over the authenticated loopback bridge
 * (`action: "host_capability"`). The running host re-negotiates the manifest
 * `hostApi` range, re-checks the per-project `browser.session` grant, and
 * consumes a one-time capability token before the BrowserSessionHost driver
 * (WebContentsView lifecycle, partition, tabs, DOM bridge) runs. Broker deny
 * envelopes surface as ordinary bridge failures, so tool results keep the
 * frozen `{ ok: false, error, code }` shape the pre-migration extension had.
 *
 * Token seam: tokens are host-minted one-time secrets (CONSTITUTION §7 class
 * C). By default every call first mints a fresh one-time token from the host
 * over the loopback `host_capability_token` action ({extensionId, permission,
 * projectRoot} in; {ok:true, token, expiresAt} out) — broker tokens are strictly
 * one-time (replay answers `token_consumed`), so there is no session-level
 * token to cache. A mint deny passes through fail-closed as the frozen
 * `{ ok: false, error, code }` shape with the broker's code; a mint transport
 * failure throws like any other transport error. Tests inject a
 * `tokenProvider` backed by `HostCapabilityBroker.issueToken` to bypass the
 * mint wire.
 */
import { randomUUID } from "node:crypto";

export const WEBVIEW_BROWSER_EXTENSION_ID = "webview-browser-extension";
/** Mirrors the manifest `hostApi` range; pinned by the extension tests. */
export const WEBVIEW_BROWSER_HOST_API = ">=1.0.0 <2.0.0";
export const WEBVIEW_BROWSER_PERMISSION = "browser.session";

/** Ceiling for the best-effort disconnect cancel (pre-migration parity). */
export const CANCEL_TIMEOUT_MS = 1_500;

export type WebviewBrowserHostConfig = {
  port?: number;
  sessionCapability?: string;
  projectRoot?: string;
  /** One-time token source, consulted fresh for every call (and every cancel). */
  tokenProvider?: () => string | undefined | Promise<string | undefined>;
};

let override: WebviewBrowserHostConfig | undefined;

/** Test/land seam: pin the bridge endpoint and the token source explicitly. */
export function configureWebviewBrowserHost(config: WebviewBrowserHostConfig): void {
  override = config;
}

function currentPort(): number {
  const raw = override?.port ?? process.env.PIPIUI_BRIDGE_PORT;
  return Number(raw);
}

function currentCapability(): string | undefined {
  return override?.sessionCapability ?? process.env.PIPIUI_SESSION_CAPABILITY;
}

function currentProjectRoot(): string {
  return override?.projectRoot ?? process.cwd();
}

type MintOutcome = { ok: true; token: string } | { ok: false; error: string; code?: string };

/**
 * Mint one one-time capability token from the host (loopback
 * `host_capability_token`; envelope mirrors cua-extension's minting token
 * provider, minus `hostApi` — the range is re-negotiated on every gated
 * dispatch, so mint only has to prove the permission gates). A broker deny
 * comes back as `{ ok:false, error, code }` for the callers to pass through
 * fail-closed; a transport failure throws.
 */
async function mintHostCapabilityToken(signal?: AbortSignal): Promise<MintOutcome> {
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${currentPort()}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // The mint is a real hop to the host and can hang exactly like the action hop:
      // a main process busy in a nested run loop (a native dialog, a long synchronous
      // operation) answers neither. Unsignalled, it was the one await in this file that
      // the caller's timeout and the user's Stop button could not reach.
      ...(signal ? { signal } : {}),
      body: JSON.stringify({
        schemaVersion: 1,
        sessionCapability: currentCapability(),
        action: "host_capability_token",
        event: {
          extensionId: WEBVIEW_BROWSER_EXTENSION_ID,
          permission: WEBVIEW_BROWSER_PERMISSION,
          projectRoot: currentProjectRoot(),
        },
      }),
    });
  } catch (error) {
    throw new Error(`host capability token mint failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  let body: any;
  try {
    body = await res.json();
  } catch {
    throw new Error(`host capability token mint returned a non-JSON response (HTTP ${res.status})`);
  }
  if (body && typeof body === "object" && body.ok === true && typeof body.token === "string" && body.token) {
    return { ok: true, token: body.token };
  }
  if (body && typeof body === "object" && body.ok === false) {
    return { ok: false, error: body.error || "host capability token mint was denied", code: body.code };
  }
  throw new Error(`host capability token mint failed (HTTP ${res.status})`);
}

/** Best-effort token for the disconnect cancel: "" on any mint failure (the broker denies an empty token without a session touch). */
async function cancelToken(): Promise<string> {
  if (override?.tokenProvider) return (await override.tokenProvider()) ?? "";
  // The cancel path exists to unblock a caller that already timed out; its own mint must
  // therefore be bounded too, or cancelling inherits the hang it was sent to clear.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CANCEL_TIMEOUT_MS);
  try {
    const mint = await mintHostCapabilityToken(controller.signal);
    return mint.ok ? mint.token : "";
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One gated browser.session call. Resolves with the driver result (the same
 * shape the pre-migration loopback `browser_action`/`browser_watch` events
 * returned) or a `{ ok: false, error, code }` failure; throws on transport
 * errors exactly like the old bridge() did, after a best-effort cancel.
 */
export async function capabilityCall(
  op: "browser.action" | "browser.watch",
  params: Record<string, unknown> = {},
  externalSignal?: AbortSignal,
  timeoutMs = 35_000,
): Promise<any> {
  const requestID = randomUUID();
  // One budget and one signal for the whole call, armed BEFORE the mint. The mint is a
  // host round trip of its own, so arming afterwards left it outside every deadline and
  // outside the user's Stop: a call parked there could never be interrupted at all.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const forwardAbort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener("abort", forwardAbort, { once: true });
  try {
    // A params-level requestID (the disconnect cancel for another call) wins.
    // Token: the injected provider (test seam) may hand back "" and let the
    // broker deny `token_required`; the default path mints a fresh one-time
    // token per call, passing a mint deny through fail-closed.
    let token: string;
    if (override?.tokenProvider) {
      token = (await override.tokenProvider()) ?? "";
    } else {
      const mint = await mintHostCapabilityToken(controller.signal);
      if (!mint.ok) return { ok: false, error: mint.error, code: mint.code ?? "token_required" };
      token = mint.token;
    }
    const event = {
      schemaVersion: 1,
      extensionId: WEBVIEW_BROWSER_EXTENSION_ID,
      hostApi: WEBVIEW_BROWSER_HOST_API,
      permission: WEBVIEW_BROWSER_PERMISSION,
      projectRoot: currentProjectRoot(),
      token,
      op,
      params: { requestID, ...params },
    };
    const res = await fetch(`http://127.0.0.1:${currentPort()}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        schemaVersion: 1,
        sessionCapability: currentCapability(),
        action: "host_capability",
        event,
      }),
    });
    const body = await res.json();
    // Broker deny envelopes arrive as HTTP 200 `{ schemaVersion, ok:false,
    // code, error, hostApiVersion }`; flatten them onto the frozen bridge
    // failure shape so bridgeFailure()/error rendering stays byte-identical.
    if (body && typeof body === "object" && body.ok === false && typeof body.code === "string") {
      return { ok: false, error: body.error || "browser bridge action failed", code: body.code };
    }
    return body?.ok === true && body.result !== undefined ? body.result : body;
  } catch (error) {
    if (controller.signal.aborted) {
      await cancelCapabilityRequest(requestID);
      throw new Error("browser request timed out or was cancelled");
    }
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", forwardAbort);
  }
}

/** Best-effort disconnect cancel; never throws (pre-migration parity). */
export async function cancelCapabilityRequest(requestID: string, timeoutMs = CANCEL_TIMEOUT_MS): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(`http://127.0.0.1:${currentPort()}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        schemaVersion: 1,
        sessionCapability: currentCapability(),
        action: "host_capability",
        event: {
          schemaVersion: 1,
          extensionId: WEBVIEW_BROWSER_EXTENSION_ID,
          hostApi: WEBVIEW_BROWSER_HOST_API,
          permission: WEBVIEW_BROWSER_PERMISSION,
          projectRoot: currentProjectRoot(),
          token: await cancelToken(),
          op: "browser.action",
          params: { action: "browser_cancel", requestID },
        },
      }),
    });
  } catch {
    // Disconnect cancellation is best-effort. It is allowed to be: every host operation
    // is bounded on its own, and the per-session action queue advances at its ceiling
    // whether or not this cancel lands. (That was stated here before it was true.)
  } finally {
    clearTimeout(timer);
  }
}
