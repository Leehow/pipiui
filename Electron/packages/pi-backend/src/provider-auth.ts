import { readFile } from "node:fs/promises";
import type { AuthLoginEvent, AuthProviderInfo, AuthType } from "@pipi/host-api";

/**
 * Provider auth driven by pi's real ModelRuntime (the same API Swift's
 * pi-auth-helper.mjs bridges). Injectable for tests — credential values never
 * leave the runtime; only metadata (providerId + type) is read from auth.json.
 */

/** Structural surface of pi's ModelRuntime.login/getProviders/logout. */
export interface AuthRuntimeLike {
  getProviders(): Promise<readonly {
    id: string;
    name: string;
    auth?: { oauth?: { loginLabel?: string }; apiKey?: { login?: unknown } };
  }[]>;
  getAvailable(): Promise<readonly { provider: string; id: string; name?: string; reasoning?: boolean; input?: unknown }[]>;
  login(providerId: string, authType: AuthType, interaction: AuthInteractionLike): Promise<unknown>;
  logout(providerId: string): Promise<void>;
}

/** pi-ai AuthPrompt shape. */
export interface AuthPromptLike {
  type: "text" | "secret" | "select" | "manual_code";
  message: string;
  placeholder?: string;
  options?: readonly { id: string; label: string; description?: string }[];
  signal?: AbortSignal;
}

/** pi-ai AuthEvent shape (notify). */
export interface AuthEventLike {
  type: "info" | "auth_url" | "device_code" | "progress";
  message?: string;
  url?: string;
  instructions?: string;
  userCode?: string;
  verificationUri?: string;
}

/** pi-ai AuthInteraction shape. */
export interface AuthInteractionLike {
  signal?: AbortSignal;
  prompt(p: AuthPromptLike): Promise<string>;
  notify(e: AuthEventLike): void;
}

/**
 * Bridges pi's interactive login (prompt/notify) into a pull-based event queue
 * the renderer consumes via begin/continue/cancel. Mirrors Swift's
 * pi-auth-helper.mjs makeInteraction semantics (single-option select
 * auto-picks; cancel rejects the pending prompt).
 */
export class ProviderLoginSession {
  readonly id: string;
  readonly controller = new AbortController();
  cancelled = false;
  private queue: AuthLoginEvent[] = [];
  private waiters: Array<(e: AuthLoginEvent) => void> = [];
  private promptResolve?: (v: string) => void;
  private promptReject?: (e: Error) => void;
  private terminal?: AuthLoginEvent;

  constructor(id: string) {
    this.id = id;
  }

  push(event: AuthLoginEvent): void {
    if (event.kind === "completed" || event.kind === "failed" || event.kind === "cancelled") {
      if (this.terminal) return; // single terminal event only
      this.terminal = event;
    }
    const waiter = this.waiters.shift();
    if (waiter) waiter(event);
    else this.queue.push(event);
  }

  next(): Promise<AuthLoginEvent> {
    const head = this.queue.shift();
    if (head) return Promise.resolve(head);
    if (this.terminal) return Promise.resolve(this.terminal);
    return new Promise(resolve => this.waiters.push(resolve));
  }

  prompt(p: AuthPromptLike): Promise<string> {
    if (this.cancelled) return Promise.reject(new Error("Login cancelled"));
    // Prefer the single default option when non-interactive (Swift parity).
    if (p.type === "select" && p.options?.length === 1) return Promise.resolve(p.options[0].id);
    const event: AuthLoginEvent = p.type === "select"
      ? { kind: "prompt", promptType: "select", message: p.message, options: p.options?.map(o => ({ id: o.id, label: o.label })) }
      : { kind: "prompt", promptType: p.type === "secret" ? "secret" : "text", message: p.message, placeholder: p.placeholder };
    this.push(event);
    return new Promise((resolve, reject) => {
      this.promptResolve = resolve;
      this.promptReject = reject;
    });
  }

  notify(e: AuthEventLike): void {
    if (e.type === "auth_url" && e.url) {
      this.push({ kind: "auth_url", url: e.url, code: e.instructions });
    } else if (e.type === "device_code") {
      this.push({ kind: "auth_url", url: e.verificationUri ?? "", code: e.userCode, instructions: e.message });
    } else if (e.type === "info" || e.type === "progress") {
      this.push({ kind: "notice", message: e.message ?? e.type });
    }
  }

  async answer(input: string): Promise<boolean> {
    const resolve = this.promptResolve;
    if (!resolve) return false;
    this.promptResolve = undefined;
    this.promptReject = undefined;
    resolve(input);
    return true;
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.controller.abort();
    // Drop queued non-terminal events; the terminal 'cancelled' follows from runLogin's catch.
    this.queue = this.queue.filter(e => e.kind === "completed" || e.kind === "failed" || e.kind === "cancelled");
    const reject = this.promptReject;
    if (reject) {
      this.promptReject = undefined;
      reject(new Error("Login cancelled"));
    }
  }

  interaction(): AuthInteractionLike {
    return {
      signal: this.controller.signal,
      prompt: p => this.prompt(p),
      notify: e => this.notify(e),
    };
  }
}

/** Metadata-only read of pi's auth.json ({providerId: {type, ...}}). Never returns key values. */
export async function readAuthMetadata(authPath: string): Promise<Map<string, AuthType>> {
  const map = new Map<string, AuthType>();
  for (const [providerId, entry] of await readAuthMetadataEntries(authPath)) {
    map.set(providerId, entry.type);
  }
  return map;
}

export type AuthMetadataEntry = { type: AuthType; /** OAuth expiry in epoch ms when the stored entry carries one. */ expiresAtMs?: number };

export type StoredAuthStatus = {
  authenticated: boolean;
  authType?: AuthType;
  expiresAtMs?: number;
};

function oauthExpiresAtMs(expires: unknown): number | undefined {
  return typeof expires === "number" && Number.isFinite(expires)
    ? expires < 1e12 ? expires * 1000 : expires
    : undefined;
}

/** Typeless but oauth-shaped: object with a non-empty access token and finite expires. */
function isTypelessOauthEntry(entry: unknown): entry is { access: string; expires: number } {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
  const record = entry as Record<string, unknown>;
  if ("type" in record && record.type !== undefined && record.type !== null) return false;
  return typeof record.access === "string" && record.access.length > 0
    && typeof record.expires === "number" && Number.isFinite(record.expires);
}

function oauthMetadataFromEntry(entry: { expires?: unknown }): AuthMetadataEntry {
  const expiresAtMs = oauthExpiresAtMs(entry.expires);
  return expiresAtMs === undefined ? { type: "oauth" } : { type: "oauth", expiresAtMs };
}

/** Same metadata read, keeping the non-secret expiry so UIs can show remaining validity. */
export async function readAuthMetadataEntries(authPath: string): Promise<Map<string, AuthMetadataEntry>> {
  const map = new Map<string, AuthMetadataEntry>();
  try {
    const raw: any = JSON.parse(await readFile(authPath, "utf8"));
    for (const [providerId, entry] of Object.entries<any>(raw ?? {})) {
      if (entry?.type === "api_key") {
        map.set(providerId, { type: "api_key" });
      } else if (entry?.type === "oauth") {
        map.set(providerId, oauthMetadataFromEntry(entry));
      } else if (isTypelessOauthEntry(entry)) {
        map.set(providerId, oauthMetadataFromEntry(entry));
      }
    }
  } catch {
    /* missing/corrupt auth.json = no credentials */
  }
  return map;
}

export interface ProviderAuthOptions {
  runtime: AuthRuntimeLike;
  authPath: string;
  /**
   * Awaited AFTER runtime login succeeds but BEFORE the terminal 'completed' event is
   * published: the model catalog must finish load + invalidate/publish/tombstone settle so
   * no caller can observe success while revoked/added providers are still stale on disk.
   * A rejection becomes the login's explicit terminal failure (never an unhandled
   * rejection, never a silent fire-and-forget).
   */
  onLoginCompleted?: () => void | Promise<void>;
}

/** Owns interactive login sessions and the provider catalog listing. */
export class ProviderAuthBackend {
  private sessions = new Map<string, ProviderLoginSession>();
  private seq = 0;
  private providersCache: { value: AuthProviderInfo[]; at: number } | null = null;
  private providersInFlight: Promise<AuthProviderInfo[]> | null = null;

  constructor(private options: ProviderAuthOptions) {}

  /** How long a cached provider listing is served before a background refresh is kicked. */
  private static readonly PROVIDERS_CACHE_TTL_MS = 60_000;

  /**
   * Cached provider listing for UI panels. The backend prefetches it at startup so the
   * add-model panel paints instantly; reads never block on the runtime once warm, and a
   * stale entry refreshes in the background (stale-while-revalidate). Auth mutations
   * invalidate explicitly via invalidateProvidersCache.
   */
  async listProvidersCached(): Promise<AuthProviderInfo[]> {
    const cached = this.providersCache;
    if (cached) {
      if (Date.now() - cached.at > ProviderAuthBackend.PROVIDERS_CACHE_TTL_MS) {
        void this.refreshProvidersCache().catch(() => undefined);
      }
      return cached.value;
    }
    return this.refreshProvidersCache();
  }

  /** Drop the cache and re-warm it in the background; used after auth mutations. */
  invalidateProvidersCache(): void {
    this.providersCache = null;
    void this.refreshProvidersCache().catch(() => undefined);
  }

  /** Fire-and-forget startup warm-up: never throws, never blocks construction. */
  prefetchProviders(): void {
    if (!this.providersCache) void this.refreshProvidersCache().catch(() => undefined);
  }

  private refreshProvidersCache(): Promise<AuthProviderInfo[]> {
    if (this.providersInFlight) return this.providersInFlight;
    const load = this.listProviders();
    this.providersInFlight = load;
    return load.then(
      value => {
        if (this.providersInFlight === load) this.providersInFlight = null;
        this.providersCache = { value, at: Date.now() };
        return value;
      },
      error => {
        if (this.providersInFlight === load) this.providersInFlight = null;
        throw error;
      },
    );
  }

  /** Metadata-only lookup of one stored provider. Never returns token/key values. */
  async getStoredAuthStatus(providerId: string): Promise<StoredAuthStatus> {
    const entry = (await readAuthMetadataEntries(this.options.authPath)).get(providerId);
    if (!entry) return { authenticated: false };
    return {
      authenticated: true,
      authType: entry.type,
      ...(entry.expiresAtMs !== undefined ? { expiresAtMs: entry.expiresAtMs } : {}),
    };
  }

  async listProviders(): Promise<AuthProviderInfo[]> {
    const stored = await readAuthMetadataEntries(this.options.authPath);
    let registry: Awaited<ReturnType<AuthRuntimeLike["getProviders"]>>;
    let availableProviders = new Set<string>();
    try {
      registry = await this.options.runtime.getProviders();
      availableProviders = new Set((await this.options.runtime.getAvailable()).map(model => model.provider));
    } catch (err) {
      throw new Error(`无法读取 pi provider 目录：${err instanceof Error ? err.message : String(err)}`);
    }
    if (!Array.isArray(registry)) throw new Error("无法读取 pi provider 目录：返回了无效 registry");

    const result: AuthProviderInfo[] = [];
    const diagnostics: string[] = [];
    for (const provider of registry) {
      try {
        if (!provider || typeof provider.id !== "string" || !provider.id || typeof provider.name !== "string") {
          throw new Error("provider 元数据无效");
        }
        const authTypes: AuthType[] = [];
        if (provider.auth?.oauth) authTypes.push("oauth");
        // pi 0.84 advertises API-key capability with the apiKey descriptor;
        // do not require a truthy implementation detail on `login`.
        if (provider.auth?.apiKey) authTypes.push("api_key");
        if (authTypes.length === 0) continue;
        // Swift's T20 migration keeps API keys in ~/.pi/agent/.env rather than
        // auth.json. Pi ModelRuntime availability is the non-secret canonical
        // proof that such a provider is configured. Never expose the key or
        // infer OAuth when only API-key auth can explain availability.
        const storedEntry = stored.get(provider.id);
        const credentialType = storedEntry?.type
          ?? (authTypes.includes("api_key") && availableProviders.has(provider.id) ? "api_key" : undefined);
        const info: AuthProviderInfo = {
          id: provider.id,
          name: provider.name,
          authTypes,
          loginLabel: provider.auth?.oauth?.loginLabel,
          authenticated: Boolean(credentialType),
          authType: credentialType,
        };
        if (storedEntry) {
          info.credentialSource = "stored";
          if (storedEntry.expiresAtMs !== undefined) info.expiresAtMs = storedEntry.expiresAtMs;
        } else if (credentialType) {
          info.credentialSource = "environment";
        }
        result.push(info);
      } catch (err) {
        diagnostics.push(err instanceof Error ? err.message : String(err));
      }
    }
    if (result.length === 0 && diagnostics.length > 0) {
      throw new Error(`无法读取 pi provider 目录：${diagnostics.join("；")}`);
    }
    result.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return result;
  }

  beginLogin(providerId: string, authType: AuthType): string {
    const loginId = `${providerId}-${authType}-${++this.seq}`;
    const session = new ProviderLoginSession(loginId);
    this.sessions.set(loginId, session);
    void this.runLogin(loginId, providerId, authType, session);
    return loginId;
  }

  async continueLogin(loginId: string, input?: string): Promise<AuthLoginEvent> {
    const session = this.sessions.get(loginId);
    if (!session) return { kind: "failed", error: "登录会话不存在或已结束" };
    if (input !== undefined && input !== "") {
      const answered = await session.answer(input);
      if (!answered && session.cancelled) return { kind: "cancelled" };
    }
    const event = await session.next();
    if (event.kind === "completed" || event.kind === "failed" || event.kind === "cancelled") {
      this.sessions.delete(loginId); // prune finished sessions
    }
    return event;
  }

  cancelLogin(loginId: string): void {
    // Keep the session so a terminal 'cancelled' event can be consumed once.
    this.sessions.get(loginId)?.cancel();
  }

  private async runLogin(loginId: string, providerId: string, authType: AuthType, session: ProviderLoginSession): Promise<void> {
    try {
      await this.options.runtime.login(providerId, authType, session.interaction());
      if (!session.cancelled) {
        try {
          // Completion ordering contract: catalog refresh + publication SETTLE before any
          // consumer can observe 'completed'. Failures surface as an explicit failed login.
          await this.options.onLoginCompleted?.();
          session.push({ kind: "completed", providerId });
        } catch (refreshError) {
          const message = refreshError instanceof Error ? refreshError.message : String(refreshError);
          console.warn(`[pipi-auth] post-login model catalog refresh failed for ${providerId}: ${message}`);
          session.push({ kind: "failed", error: `登录已成功，但登录后模型目录刷新失败：${message}` });
        }
      }
    } catch (err) {
      session.push(session.cancelled ? { kind: "cancelled" } : { kind: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  }
}
