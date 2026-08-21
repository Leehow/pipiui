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

/** Same metadata read, keeping the non-secret expiry so UIs can show remaining validity. */
export async function readAuthMetadataEntries(authPath: string): Promise<Map<string, AuthMetadataEntry>> {
  const map = new Map<string, AuthMetadataEntry>();
  try {
    const raw: any = JSON.parse(await readFile(authPath, "utf8"));
    for (const [providerId, entry] of Object.entries<any>(raw ?? {})) {
      if (entry?.type === "api_key") {
        map.set(providerId, { type: "api_key" });
      } else if (entry?.type === "oauth") {
        const expires = entry.expires;
        const expiresAtMs =
          typeof expires === "number" && Number.isFinite(expires)
            ? expires < 1e12 ? expires * 1000 : expires
            : undefined;
        map.set(providerId, expiresAtMs === undefined ? { type: "oauth" } : { type: "oauth", expiresAtMs });
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
  /** Called after a successful login so the model catalog can be refreshed. */
  onLoginCompleted?: () => void;
}

/** Owns interactive login sessions and the provider catalog listing. */
export class ProviderAuthBackend {
  private sessions = new Map<string, ProviderLoginSession>();
  private seq = 0;

  constructor(private options: ProviderAuthOptions) {}

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
        session.push({ kind: "completed", providerId });
        this.options.onLoginCompleted?.();
      }
    } catch (err) {
      session.push(session.cancelled ? { kind: "cancelled" } : { kind: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  }
}
