/**
 * OAuth Credential Broker — M3
 * Single API for provider requests and image tools.
 * Invariants: earlyRefresh, rotation, 401 single retry, no-refresh -> re-login,
 * invalid_grant cleanup, network/5xx preserve old, in-process dedup,
 * cross-process flock + re-read + freshness guard, 0600 tmp/fsync/rename, no token logs.
 */
import { chmodSync, mkdirSync } from "node:fs";
import { open, readFile, rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { refreshAccessToken, OAuthError } from "./device.js";
import { toOAuthCredentials, type StoredOAuthCredential } from "./credentials.js";
import { redactMessage } from "./redact.js";
import { resolveOAuthConfig } from "./config.js";

export type BrokerCredential = StoredOAuthCredential & { type: "oauth" };

type Clock = { nowMs: () => number };

function defaultAuthPath(): string {
  const envDir = process.env.PI_CODING_AGENT_DIR?.trim();
  if (envDir) return join(envDir, "auth.json");
  // fallback to homedir for tests / pi-coc repo-local may override via opts
  return join(homedir(), ".pi", "agent", "auth.json");
}

function ensureDirSecure(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch {}
}

async function atomicWriteJson(filePath: string, data: Record<string, unknown>): Promise<void> {
  const dir = dirname(filePath);
  ensureDirSecure(dir);
  const tmp = join(dir, `.${randomUUID()}.tmp`);
  const content = `${JSON.stringify(data, null, 2)}\n`;
  let fd: import("node:fs/promises").FileHandle | undefined;
  try {
    fd = await open(tmp, "w", 0o600);
    await fd.writeFile(content, "utf8");
    await fd.sync();
    await fd.chmod(0o600);
    await fd.close();
    fd = undefined;
    await rename(tmp, filePath);
    try { chmodSync(filePath, 0o600); } catch {}
    // fsync dir for durability (best-effort)
    try {
      const dirFd = await open(dir, "r");
      try { await dirFd.sync(); } finally { await dirFd.close(); }
    } catch {}
  } finally {
    if (fd) try { await fd.close(); } catch {}
    try { await stat(tmp).then(() => {}).catch(() => {}); } catch {}
    // cleanup tmp if rename failed
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(tmp).catch(() => {});
    } catch {}
  }
}

async function readAuthJson(authPath: string): Promise<Record<string, unknown>> {
  try {
    const text = await readFile(authPath, "utf8");
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return {};
    // corrupt file -> treat as empty but don't overwrite silently
    if (e instanceof SyntaxError) return {};
    return {};
  }
}

function isExpiring(cred: BrokerCredential, earlyRefreshSec: number, nowMs: number): boolean {
  const earlyMs = Math.min(120, Math.max(30, earlyRefreshSec)) * 1000;
  return cred.expires - nowMs < earlyMs;
}

function isFreshEnough(newer: BrokerCredential, older: BrokerCredential | undefined): boolean {
  if (!older) return true;
  // freshness guard: obtained_at or expires newer means fresher
  if (typeof newer.obtained_at === "number" && typeof older.obtained_at === "number") {
    if (newer.obtained_at > older.obtained_at) return true;
    if (newer.obtained_at < older.obtained_at) return false;
  }
  return newer.expires > older.expires;
}

// Minimal cross-process lock using proper-lockfile when available,
// fallback to simple fs lock file with stale handling.
async function acquireLock(authPath: string, signal?: AbortSignal): Promise<() => Promise<void>> {
  const staleMs = 30_000;
  const maxDelayMs = 2_000;
  const deadline = Date.now() + staleMs;
  let retry = 0;
  // Try proper-lockfile first
  let useProper = false;
  let properLock: unknown;
  try {
    // @ts-ignore — optional dep, fallback if missing
    const mod = await import("proper-lockfile");
    properLock = (mod as Record<string, unknown>).default ?? mod;
    useProper = true;
  } catch {
    useProper = false;
  }

  if (useProper && properLock) {
    const pl = properLock as { lock: (p: string, o: unknown) => Promise<() => Promise<void>> };
    // retry loop matching Pi's FileAuthStorageBackend.acquireLockAsync
    while (true) {
      signal?.throwIfAborted();
      let release: (() => Promise<void>) | undefined;
      let compromised = false;
      let compromisedError: unknown;
      try {
        release = await pl.lock(authPath, {
          realpath: false,
          retries: 0,
          stale: staleMs,
          onCompromised: (err: unknown) => { compromised = true; compromisedError = err; },
        } as never);
      } catch (err) {
        signal?.throwIfAborted();
        const code = (err as { code?: string })?.code;
        const remaining = deadline - Date.now();
        if (code !== "ELOCKED" || remaining <= 0) throw err;
        const base = Math.min(10 * 2 ** retry, maxDelayMs / 2);
        retry++;
        const delay = Math.min(Math.round(base * (1 + Math.random())), remaining);
        if (signal) {
          await new Promise<void>((res, rej) => {
            const t = setTimeout(res, delay);
            signal.addEventListener("abort", () => { clearTimeout(t); rej(signal.reason ?? new DOMException("Aborted", "AbortError")); }, { once: true });
          });
        } else {
          await new Promise<void>((res) => setTimeout(res, delay));
        }
        continue;
      }
      if (signal?.aborted) {
        if (release) await release().catch(() => {});
        signal.throwIfAborted();
      }
      if (compromised) {
        if (release) await release().catch(() => {});
        throw compromisedError ?? new Error("Auth storage lock was compromised");
      }
      // wrap release to always be async
      return async () => {
        if (release) await (release as () => Promise<void>)().catch(() => {});
      };
    }
  }

  // Fallback: simple lock file auth.json.lock with PID:TS and flock via fs
  // Uses open + exclusive create + stale check.
  const lockPath = `${authPath}.lock`;
  const pid = process.pid;
  const writeHolder = async () => {
    const ts = Math.floor(Date.now() / 1000);
    await atomicWriteJson(lockPath, { holder: `${pid}:${ts}` } as unknown as Record<string, unknown>);
  };
  // simple busy-wait with stale break
  while (true) {
    signal?.throwIfAborted();
    try {
      // try exclusive create
      const fd = await open(lockPath, "wx", 0o600);
      try { await fd.writeFile(`${pid}:${Math.floor(Date.now()/1000)}`); await fd.sync(); } finally { await fd.close(); }
      return async () => {
        try {
          const { unlink } = await import("node:fs/promises");
          await unlink(lockPath).catch(() => {});
        } catch {}
      };
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code !== "EEXIST") throw e;
      // check stale
      try {
        const st = await stat(lockPath);
        const ageMs = Date.now() - st.mtimeMs;
        if (ageMs > staleMs) {
          // try to break stale lock
          try {
            const { unlink } = await import("node:fs/promises");
            await unlink(lockPath);
            continue;
          } catch {}
        }
      } catch {}
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`Failed to acquire lock on ${authPath}: timeout`);
      const base = Math.min(10 * 2 ** retry, maxDelayMs / 2);
      retry++;
      const delay = Math.min(Math.round(base * (1 + Math.random())), Math.min(100, remaining));
      if (signal) {
        await new Promise<void>((res, rej) => {
          const t = setTimeout(res, delay);
          signal.addEventListener("abort", () => { clearTimeout(t); rej(signal.reason ?? new DOMException("Aborted","AbortError")); }, { once:true });
        });
      } else {
        await new Promise<void>((res) => setTimeout(res, delay));
      }
    }
  }
}

export type BrokerOptions = {
  authPath?: string;
  providerId?: string;
  earlyRefreshSec?: number;
  fetchImpl?: typeof fetch;
  clock?: Clock;
};

export class GrokCredentialBroker {
  private inflight = new Map<string, Promise<BrokerCredential>>();
  private opts: { authPath: string; providerId: string; earlyRefreshSec: number; fetchImpl: typeof fetch; clock: Clock };

  constructor(opts: BrokerOptions = {}) {
    const cfg = resolveOAuthConfig();
    this.opts = {
      authPath: opts.authPath ?? defaultAuthPath(),
      providerId: opts.providerId ?? "grok-build",
      earlyRefreshSec: opts.earlyRefreshSec ?? cfg.earlyRefreshSec,
      fetchImpl: (opts.fetchImpl ?? fetch) as typeof fetch,
      clock: opts.clock ?? { nowMs: () => Date.now() },
    };
  }

  private nowMs(): number { return this.opts.clock.nowMs(); }

  private async readCredential(): Promise<BrokerCredential | undefined> {
    const data = await readAuthJson(this.opts.authPath);
    const entry = data[this.opts.providerId] as Record<string, unknown> | undefined;
    if (!entry || entry.type !== "oauth") return undefined;
    const access = entry.access as string | undefined;
    const refresh = entry.refresh as string | undefined;
    const expires = entry.expires as number | undefined;
    if (typeof access !== "string" || !access || typeof expires !== "number" || !Number.isFinite(expires)) return undefined;
    return {
      type: "oauth",
      access,
      refresh: typeof refresh === "string" ? refresh : "",
      expires,
      issuer: typeof entry.issuer === "string" ? entry.issuer : resolveOAuthConfig().issuer,
      client_id: typeof entry.client_id === "string" ? entry.client_id : resolveOAuthConfig().clientId,
      scopes: Array.isArray(entry.scopes) ? entry.scopes as string[] : resolveOAuthConfig().scopes,
      token_type: typeof entry.token_type === "string" ? entry.token_type : "Bearer",
      obtained_at: typeof entry.obtained_at === "number" ? entry.obtained_at : this.nowMs(),
    } as BrokerCredential;
  }

  private async writeCredential(cred: BrokerCredential | undefined): Promise<void> {
    const data = await readAuthJson(this.opts.authPath);
    if (!cred) {
      delete data[this.opts.providerId];
    } else {
      data[this.opts.providerId] = {
        type: "oauth",
        access: cred.access,
        refresh: cred.refresh,
        expires: cred.expires,
        issuer: cred.issuer,
        client_id: cred.client_id,
        scopes: cred.scopes,
        token_type: cred.token_type,
        obtained_at: cred.obtained_at,
      };
    }
    await atomicWriteJson(this.opts.authPath, data);
  }

  /** Shared API for provider and image tools: returns a fresh access token, refreshing early if needed */
  async getAccessToken(signal?: AbortSignal): Promise<string> {
    const cred = await this.readCredential();
    if (!cred) throw new OAuthError("auth_expired", "Not logged in — please run /login grok-build");
    if (!isExpiring(cred, this.opts.earlyRefreshSec, this.nowMs())) {
      return cred.access;
    }
    const refreshed = await this.forceRefresh(signal);
    return refreshed.access;
  }

  /** Force refresh, deduped in-process, cross-process locked, with re-read + freshness guard */
  async forceRefresh(signal?: AbortSignal): Promise<BrokerCredential> {
    const key = this.opts.providerId;
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const p = this.doRefresh(signal).finally(() => {
      if (this.inflight.get(key) === p) this.inflight.delete(key);
    });
    this.inflight.set(key, p);
    return p;
  }

  private async doRefresh(signal?: AbortSignal): Promise<BrokerCredential> {
    signal?.throwIfAborted();
    const before = await this.readCredential();
    if (!before) throw new OAuthError("auth_expired", "Not logged in — please run /login grok-build");
    if (!before.refresh) {
      // No refresh token -> require re-login, don't attempt network
      throw new OAuthError("auth_expired", "No refresh token — please run /login grok-build again.");
    }

    let release: (() => Promise<void>) | undefined;
    try {
      release = await acquireLock(this.opts.authPath, signal);
      signal?.throwIfAborted();

      // Re-read inside lock
      const inside = await this.readCredential();
      if (!inside) throw new OAuthError("auth_expired", "Not logged in — please run /login grok-build");
      // Freshness guard: if inside was already refreshed by another process, reuse it
      if (inside && before && !isExpiring(inside, this.opts.earlyRefreshSec, this.nowMs()) && isFreshEnough(inside, before)) {
        // If inside is fresh enough (newer), no need to refresh
        if (inside.obtained_at !== before.obtained_at || inside.access !== before.access) {
          // Another process refreshed, use that
          return inside;
        }
      }
      // If inside is same as before but still expiring, proceed to refresh

      const cfg = resolveOAuthConfig();
      const issuer = inside.issuer || cfg.issuer;
      const clientId = inside.client_id || cfg.clientId;

      // Issuer mismatch -> require re-login
      if (inside.issuer && inside.issuer.replace(/\/+$/, "") !== cfg.issuer.replace(/\/+$/, "")) {
        // Clear credential? Spec says invalid issuer requires re-login, don't keep stale?
        // We'll throw auth_expired and let caller clear if needed.
        throw new OAuthError("auth_expired", "Issuer mismatch — please run /login grok-build again. [redacted]");
      }

      let tokens;
      try {
        tokens = await refreshAccessToken({ issuer, clientId, refreshToken: inside.refresh, fetchImpl: this.opts.fetchImpl, signal });
      } catch (err) {
        const code = (err as OAuthError)?.code;
        const msg = err instanceof Error ? err.message : String(err);
        const redacted = redactMessage(msg, [inside.refresh, inside.access]);
        // Never log token
        if (code === "invalid_grant") {
          // Clear credential on invalid_grant
          await this.writeCredential(undefined);
          throw new OAuthError("auth_expired", "Refresh token expired or revoked — please run /login grok-build again. [redacted]");
        }
        // Network/5xx -> preserve old credential, throw retryable error
        // Do not overwrite file
        throw new OAuthError(code ?? "refresh_failed", redacted);
      }

      const next = toOAuthCredentials(tokens, {
        issuer,
        clientId,
        scopes: inside.scopes,
        refreshFallback: inside.refresh,
      }) as BrokerCredential & { type: "oauth" };
      const nextCred: BrokerCredential = { ...next, type: "oauth" as const };

      // Freshness guard before write: re-read again? But we already hold lock, so no race except we already checked.
      // Ensure we don't overwrite with older obtained_at
      const current = await this.readCredential();
      if (current && !isFreshEnough(nextCred, current)) {
        // Current on disk is fresher (another holder wrote after we read but before we acquired lock? Already handled)
        // But we hold lock, so this shouldn't happen. Still guard.
        return current;
      }

      await this.writeCredential(nextCred);
      return nextCred;
    } finally {
      if (release) await release().catch(() => {});
    }
  }

  /**
   * Execute operation with Bearer token, retrying once on 401 via forced refresh.
   * Shared by provider requests and image tools.
   */
  async with401Retry<T>(operation: (token: string) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const token = await this.getAccessToken(signal);
    try {
      return await operation(token);
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status ?? (err as { statusCode?: number })?.statusCode;
      const msg = err instanceof Error ? err.message : String(err);
      const is401 = status === 401 || /401|auth_expired|Unauthorized/i.test(msg);
      if (!is401) throw err;
      // Single forced refresh retry
      let refreshed: BrokerCredential;
      try {
        refreshed = await this.forceRefresh(signal);
      } catch (refreshErr) {
        // Preserve original 401 if refresh fails due to no refresh token / invalid_grant -> propagate auth_expired
        throw refreshErr;
      }
      // Retry once with new token
      try {
        return await operation(refreshed.access);
      } catch (retryErr: unknown) {
        const retryStatus = (retryErr as { status?: number })?.status ?? (retryErr as { statusCode?: number })?.statusCode;
        if (retryStatus === 401) {
          throw new OAuthError("auth_expired", "Authentication expired — please run /login grok-build again. [redacted]");
        }
        throw retryErr;
      }
    }
  }

  /** Whether a grok-build OAuth credential is currently persisted (no network). */
  async hasCredential(): Promise<boolean> {
    return (await this.readCredential()) !== undefined;
  }

  /**
   * Non-secret credential status for host/UI surfaces (登录状态/过期时间/凭证来源).
   * Never returns token values.
   */
  async status(): Promise<{
    loggedIn: boolean;
    expired: boolean;
    expiresAtMs?: number;
    hasRefresh: boolean;
    issuer?: string;
  }> {
    const cred = await this.readCredential();
    if (!cred) return { loggedIn: false, expired: false, hasRefresh: false };
    return {
      loggedIn: true,
      expired: Number.isFinite(cred.expires) && cred.expires <= Date.now(),
      expiresAtMs: Number.isFinite(cred.expires) ? cred.expires : undefined,
      hasRefresh: Boolean(cred.refresh),
      issuer: cred.issuer,
    };
  }

  /** For tests: expose read */
  async _readForTest(): Promise<BrokerCredential | undefined> { return this.readCredential(); }
  async _writeForTest(cred: BrokerCredential | undefined): Promise<void> { return this.writeCredential(cred); }
}

export function createBroker(opts?: BrokerOptions): GrokCredentialBroker {
  return new GrokCredentialBroker(opts);
}

// Re-export atomic helpers for tests
export const _internal = { atomicWriteJson, readAuthJson, acquireLock, isExpiring, isFreshEnough };
