/**
 * Browser-watch RPC + reverse-trigger helper.
 *
 * Runtime → host: POST /rpc action=browser_watch (register / unwatch / list / subscribe).
 * Host → runtime: POST 127.0.0.1:<callbackPort>/rpc action=browser_watch_trigger
 * with the secret minted at subscribe. There is no reverse ExtensionAPI handle
 * in the main process; this loopback callback is the wake channel.
 */

export const BROWSER_WATCH_MAX_TIMEOUT_SECS = 1800;
export const BROWSER_WATCH_ACTION = "browser_watch";
export const BROWSER_WATCH_TRIGGER_ACTION = "browser_watch_trigger";
export const BROWSER_WATCH_POST_ATTEMPTS = 3;
export const BROWSER_WATCH_POST_RETRY_MS = 2_000;
export const BROWSER_WATCH_POST_TIMEOUT_MS = 2_000;

export type BrowserWatchCondition =
  | { type: "selector"; selector: string; snapshotId?: string; elementIndex?: number; elementToken?: string }
  | { type: "idle"; idleMs?: number }
  | { type: "url_matches"; pattern: string }
  | { type: "expression"; expression: string }
  | { type: "timer" };

export type BrowserWatchRecord = {
  watchId: string;
  sessionKey: string;
  condition: BrowserWatchCondition;
  createdAt: number;
  timeoutAt: number;
  intervalMs: number;
  status: string;
};

export type BrowserWatchRegisterResult =
  | { ok: true; watch: BrowserWatchRecord }
  | { ok: false; error: string };

export type BrowserWatchHost = {
  registerWatch(input: {
    sessionKey: string;
    condition: BrowserWatchCondition;
    timeoutMs: number;
    intervalMs?: number;
  }): BrowserWatchRegisterResult;
  unwatch(watchId: string): { ok: true };
  listWatches(sessionKey?: string): BrowserWatchRecord[];
};

export type BrowserWatchCallbackTarget = {
  port: number;
  secret: string;
};

export type BrowserWatchTriggerPayload = {
  watchId: string;
  reason: "matched" | "timeout" | "disposed" | "navigating-lost";
  waitedMs: number;
  url?: string;
  title?: string;
};

export class BrowserWatchCallbackRegistry {
  private readonly targets = new Map<string, BrowserWatchCallbackTarget>();
  private readonly pending = new Map<string, BrowserWatchTriggerPayload[]>();

  subscribe(sessionId: string, target: BrowserWatchCallbackTarget): void {
    this.targets.set(sessionId, target);
    const queued = this.pending.get(sessionId);
    if (!queued?.length) return;
    this.pending.delete(sessionId);
    for (const payload of queued) void this.deliver(sessionId, payload);
  }

  unsubscribe(sessionId: string): void {
    this.targets.delete(sessionId);
  }

  get(sessionId: string): BrowserWatchCallbackTarget | undefined {
    return this.targets.get(sessionId);
  }

  /** POST the trigger, or queue it until the next subscribe. */
  async deliver(
    sessionId: string,
    payload: BrowserWatchTriggerPayload,
    fetchImpl: typeof fetch = fetch,
    postOptions?: BrowserWatchPostOptions,
  ): Promise<boolean> {
    const target = this.targets.get(sessionId);
    if (!target) {
      this.enqueue(sessionId, payload);
      return false;
    }
    const ok = await postBrowserWatchTrigger(target, payload, fetchImpl, postOptions);
    if (!ok) {
      this.enqueue(sessionId, payload);
      console.warn(`[browser-watch] trigger POST failed for ${payload.watchId} (${payload.reason}); queued for next subscribe`);
    }
    return ok;
  }

  private enqueue(sessionId: string, payload: BrowserWatchTriggerPayload): void {
    const list = this.pending.get(sessionId) ?? [];
    list.push(payload);
    this.pending.set(sessionId, list);
  }
}

export function summarizeWatchCondition(condition: BrowserWatchCondition): string {
  if (condition.type === "selector") {
    if (condition.selector) return `selector=${condition.selector}`;
    if (condition.elementToken) return `selector=token:${condition.elementToken}`;
    if (typeof condition.elementIndex === "number") return `selector=index:${condition.elementIndex}`;
    return "selector";
  }
  if (condition.type === "idle") {
    return typeof condition.idleMs === "number" ? `idle=${condition.idleMs}ms` : "idle";
  }
  if (condition.type === "url_matches") return `url_matches=/${condition.pattern}/`;
  if (condition.type === "expression") return `expression=${condition.expression}`;
  return "timer";
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nonBlank(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function parseWatchCondition(event: Record<string, unknown>):
  | { ok: true; condition: BrowserWatchCondition }
  | { ok: false; error: string } {
  const selector = nonBlank(event.selector);
  const urlMatches = nonBlank(event.url_matches);
  const expression = nonBlank(event.expression);
  const idleFlag = event.idle === true || event.idle === false
    ? event.idle
    : finiteNumber(event.idle);
  const idleMs = finiteNumber(event.idle_ms) ?? (typeof idleFlag === "number" ? idleFlag : undefined);
  const wantsIdle = idleFlag === true || (typeof idleFlag === "number" && idleFlag > 0) || event.mode === "idle";
  const snapshotId = nonBlank(event.snapshot_id);
  const elementIndex = finiteNumber(event.element_index);
  const elementToken = nonBlank(event.element_token);
  const wantsSelector = Boolean(selector || snapshotId || elementIndex != null || elementToken);

  const kinds = [
    wantsSelector ? "selector" : "",
    wantsIdle ? "idle" : "",
    urlMatches ? "url_matches" : "",
    expression ? "expression" : "",
  ].filter(Boolean);
  if (kinds.length > 1) {
    return { ok: false, error: `watch accepts exactly one condition; got ${kinds.join(", ")}` };
  }
  if (wantsSelector) {
    return {
      ok: true,
      condition: {
        type: "selector",
        selector: selector ?? "",
        ...(snapshotId ? { snapshotId } : {}),
        ...(elementIndex != null ? { elementIndex } : {}),
        ...(elementToken ? { elementToken } : {}),
      },
    };
  }
  if (wantsIdle) {
    return { ok: true, condition: { type: "idle", ...(idleMs != null ? { idleMs } : {}) } };
  }
  if (urlMatches) return { ok: true, condition: { type: "url_matches", pattern: urlMatches } };
  if (expression) return { ok: true, condition: { type: "expression", expression } };
  return { ok: true, condition: { type: "timer" } };
}

export function parseTimeoutSecs(value: unknown): { ok: true; timeoutMs: number } | { ok: false; error: string } {
  const secs = finiteNumber(value);
  if (secs == null) return { ok: false, error: "watch requires timeoutSecs (1..1800)" };
  if (secs < 1 || secs > BROWSER_WATCH_MAX_TIMEOUT_SECS) {
    return { ok: false, error: `timeoutSecs must be between 1 and ${BROWSER_WATCH_MAX_TIMEOUT_SECS}` };
  }
  return { ok: true, timeoutMs: Math.round(secs * 1000) };
}

function parseCallbackTarget(event: Record<string, unknown>):
  | { ok: true; target: BrowserWatchCallbackTarget }
  | { ok: false; error: string } {
  const port = finiteNumber(event.callbackPort);
  const secret = nonBlank(event.callbackSecret);
  if (port == null || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: "subscribe requires callbackPort" };
  }
  if (!secret) return { ok: false, error: "subscribe requires callbackSecret" };
  return { ok: true, target: { port, secret } };
}

export function handleBrowserWatchEvent(
  event: Record<string, unknown>,
  sessionId: string,
  host: BrowserWatchHost,
  callbacks: BrowserWatchCallbackRegistry,
): Record<string, unknown> {
  const op = typeof event.op === "string" ? event.op : typeof event.action === "string" ? event.action : "";
  if (op === "subscribe") {
    const parsed = parseCallbackTarget(event);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    callbacks.subscribe(sessionId, parsed.target);
    return { ok: true, subscribed: true };
  }
  if (op === "unwatch") {
    const watchId = nonBlank(event.watchId) ?? nonBlank(event.watch_id);
    if (!watchId) return { ok: false, error: "unwatch requires watchId" };
    return host.unwatch(watchId);
  }
  if (op === "list" || op === "watches") {
    return { ok: true, watches: host.listWatches(sessionId) };
  }
  if (op !== "register" && op !== "watch") {
    return { ok: false, error: `unsupported browser_watch op: ${op || "(missing)"}` };
  }
  const timeout = parseTimeoutSecs(event.timeoutSecs ?? event.timeout_secs);
  if (!timeout.ok) return { ok: false, error: timeout.error };
  const condition = parseWatchCondition(event);
  if (!condition.ok) return { ok: false, error: condition.error };
  const intervalMs = finiteNumber(event.intervalMs ?? event.interval_ms);
  const registered = host.registerWatch({
    sessionKey: sessionId,
    condition: condition.condition,
    timeoutMs: timeout.timeoutMs,
    ...(intervalMs != null ? { intervalMs } : {}),
  });
  if (!registered.ok) return registered;
  return {
    ok: true,
    watchId: registered.watch.watchId,
    condition: registered.watch.condition,
    conditionSummary: summarizeWatchCondition(registered.watch.condition),
    timeoutAt: registered.watch.timeoutAt,
    intervalMs: registered.watch.intervalMs,
    watch: registered.watch,
  };
}

/** Map host trigger reasons onto the delivery envelope (no navigating-lost there). */
export function deliveryReasonFor(
  reason: BrowserWatchTriggerPayload["reason"],
): "matched" | "timeout" | "disposed" {
  return reason === "navigating-lost" ? "disposed" : reason;
}

export type BrowserWatchPostOptions = {
  attempts?: number;
  retryMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export async function postBrowserWatchTrigger(
  target: BrowserWatchCallbackTarget,
  payload: BrowserWatchTriggerPayload,
  fetchImpl: typeof fetch = fetch,
  options: BrowserWatchPostOptions = {},
): Promise<boolean> {
  const attempts = Math.max(1, options.attempts ?? BROWSER_WATCH_POST_ATTEMPTS);
  const retryMs = options.retryMs ?? BROWSER_WATCH_POST_RETRY_MS;
  const timeoutMs = options.timeoutMs ?? BROWSER_WATCH_POST_TIMEOUT_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise(resolve => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < attempts; attempt++) {
    const ok = await postBrowserWatchTriggerOnce(target, payload, fetchImpl, timeoutMs);
    if (ok) return true;
    if (attempt + 1 < attempts) await sleep(retryMs);
  }
  return false;
}

async function postBrowserWatchTriggerOnce(
  target: BrowserWatchCallbackTarget,
  payload: BrowserWatchTriggerPayload,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`http://127.0.0.1:${target.port}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        sessionCapability: target.secret,
        action: BROWSER_WATCH_TRIGGER_ACTION,
        event: {
          watchId: payload.watchId,
          reason: deliveryReasonFor(payload.reason),
          waitedMs: payload.waitedMs,
          ...(payload.url ? { url: payload.url } : {}),
          ...(payload.title ? { title: payload.title } : {}),
        },
      }),
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
