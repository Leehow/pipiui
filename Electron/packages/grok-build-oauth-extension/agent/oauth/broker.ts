/**
 * OAuth Credential Broker — single API for provider requests and image tools.
 *
 * Invariants: earlyRefresh, rotation, 401 single retry, no-refresh -> re-login,
 * invalid_grant cleanup, network/5xx preserve old, in-process dedup,
 * cross-process lock + re-read + freshness guard, 0600 tmp/fsync/rename, no token logs.
 *
 * Symlink/shared-profile safety (reviewer MUST-FIX #1):
 * - The credential target is resolved to its REAL path first. PipiUI links each
 *   project's `.pi/agent/auth.json` at the App-profile canonical file; the lock
 *   and the atomic tmp+rename therefore act on the canonical file, never on the
 *   project symlink (a rename through the symlink path would replace the link
 *   and split the shared login), and every project pointing at the same
 *   canonical file shares the SAME lock.
 * - Persistence mirrors pi's `FileAuthStorageBackend` semantics (whole-file
 *   auth.json, 0600, only this provider's entry mutated per merge) and is only
 *   reachable through this broker's controlled methods — no second persistence
 *   path exists in the package.
 *
 * Lock safety (reviewer MUST-FIX #2): the dependency-free heartbeat lock in
 * `./lock.js` keeps a live refresh from ever being treated as stale; takeover
 * only happens after the holder stopped heartbeating (crash), and release is
 * owner-checked so a late release can never delete a new holder's lock.
 */
import { chmodSync, mkdirSync } from "node:fs";
import { open, readFile, rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { refreshAccessToken, OAuthError } from "./device.js";
import { toOAuthCredentials, type StoredOAuthCredential } from "./credentials.js";
import { redactMessage } from "./redact.js";
import { resolveOAuthConfig } from "./config.js";
import { acquireFileLock, resolveCredentialTarget, type LockOptions } from "./lock.js";

export type BrokerCredential = StoredOAuthCredential & { type: "oauth" };

type Clock = { nowMs: () => number };

export type BrokerOptions = {
  authPath?: string;
  providerId?: string;
  earlyRefreshSec?: number;
  fetchImpl?: typeof fetch;
  clock?: Clock;
  lock?: LockOptions;
  /** Network timeout for refresh calls. Default 30s. */
  refreshTimeoutMs?: number;
};

function ensureDirSecure(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch {}
}

/**
 * Atomic JSON write against the REAL target file (tmp + fsync + chmod 0600 +
 * rename inside the real file's directory). `rename` may replace a regular
 * file — it must never be pointed at a symlink path, which is why callers
 * resolve the real target first.
 */
async function atomicWriteJson(realPath: string, data: Record<string, unknown>): Promise<void> {
  const dir = dirname(realPath);
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
    await rename(tmp, realPath);
    try { chmodSync(realPath, 0o600); } catch {}
    // fsync dir for durability (best-effort)
    try {
      const dirFd = await open(dir, "r");
      try { await dirFd.sync(); } finally { await dirFd.close(); }
    } catch {}
  } finally {
    if (fd) try { await fd.close(); } catch {}
    // cleanup tmp if rename failed
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(tmp).catch(() => {});
    } catch {}
  }
}

async function readAuthJson(path: string): Promise<Record<string, unknown>> {
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    // Missing or corrupt file -> treat as empty; merges only touch our key.
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

/** Read the credential entry from a specific file path (real or as-given). */
async function readCredentialFrom(path: string, providerId: string, nowMs: () => number): Promise<BrokerCredential | undefined> {
  const data = await readAuthJson(path);
  const entry = data[providerId] as Record<string, unknown> | undefined;
  if (!entry || entry.type !== "oauth") return undefined;
  const access = entry.access as string | undefined;
  const refresh = entry.refresh as string | undefined;
  const expires = entry.expires as number | undefined;
  if (typeof access !== "string" || !access || typeof expires !== "number" || !Number.isFinite(expires)) return undefined;
  const cfg = resolveOAuthConfig();
  return {
    type: "oauth",
    access,
    refresh: typeof refresh === "string" ? refresh : "",
    expires,
    issuer: typeof entry.issuer === "string" ? entry.issuer : cfg.issuer,
    client_id: typeof entry.client_id === "string" ? entry.client_id : cfg.clientId,
    scopes: Array.isArray(entry.scopes) ? entry.scopes as string[] : cfg.scopes,
    token_type: typeof entry.token_type === "string" ? entry.token_type : "Bearer",
    obtained_at: typeof entry.obtained_at === "number" ? entry.obtained_at : nowMs(),
  } as BrokerCredential;
}

export class GrokCredentialBroker {
  private inflight = new Map<string, Promise<BrokerCredential>>();
  private opts: {
    authPath: string;
    providerId: string;
    earlyRefreshSec: number;
    fetchImpl: typeof fetch;
    clock: Clock;
    lock: LockOptions;
    refreshTimeoutMs: number;
  };
  /** Resolved real credential target (symlinks followed). */
  private target: { asGiven: string; real: string } | undefined;

  constructor(opts: BrokerOptions = {}) {
    const cfg = resolveOAuthConfig();
    this.opts = {
      authPath: opts.authPath ?? join(process.cwd(), "auth.json"),
      providerId: opts.providerId ?? "grok-build",
      earlyRefreshSec: opts.earlyRefreshSec ?? cfg.earlyRefreshSec,
      fetchImpl: (opts.fetchImpl ?? fetch) as typeof fetch,
      clock: opts.clock ?? { nowMs: () => Date.now() },
      lock: opts.lock ?? {},
      refreshTimeoutMs: opts.refreshTimeoutMs ?? 30_000,
    };
  }

  private nowMs(): number { return this.opts.clock.nowMs(); }

  /** Resolve (and cache) the real credential target; locks and writes act on it. */
  private async resolveTarget(): Promise<{ asGiven: string; real: string }> {
    if (!this.target) this.target = await resolveCredentialTarget(this.opts.authPath);
    return this.target;
  }

  /** The path reads/writes/locks act on (real target, symlink-followed). */
  async realAuthPath(): Promise<string> {
    return (await this.resolveTarget()).real;
  }

  private async readCredential(): Promise<BrokerCredential | undefined> {
    const { real } = await this.resolveTarget();
    // Read through the as-given path first (matches what the holder sees via
    // their project link); fall back to the real file. Both resolve to the same
    // bytes when the link is healthy.
    return (
      (await readCredentialFrom(this.opts.authPath, this.opts.providerId, () => this.nowMs())) ??
      (await readCredentialFrom(real, this.opts.providerId, () => this.nowMs()))
    );
  }

  /** Controlled write: merge only this provider's entry into the real file. */
  private async writeCredential(cred: BrokerCredential | undefined): Promise<void> {
    const { real } = await this.resolveTarget();
    const data = await readAuthJson(real);
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
    await atomicWriteJson(real, data);
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

    const { real } = await this.resolveTarget();
    ensureDirSecure(dirname(real));

    // Cross-process lock on the REAL target — projects sharing the App-profile
    // canonical file share this one lock (in-flight refresh is never stale-broken:
    // heartbeat lock).
    const lock = await acquireFileLock(real, { ...this.opts.lock, signal });
    signal?.throwIfAborted();

    try {
      // Re-read inside lock (from the real file — the authoritative bytes).
      const inside = await readCredentialFrom(real, this.opts.providerId, () => this.nowMs());
      if (!inside) throw new OAuthError("auth_expired", "Not logged in — please run /login grok-build");
      // Freshness guard: another process already refreshed while we waited.
      if (
        !isExpiring(inside, this.opts.earlyRefreshSec, this.nowMs()) &&
        isFreshEnough(inside, before) &&
        (inside.obtained_at !== before.obtained_at || inside.access !== before.access)
      ) {
        return inside;
      }

      const cfg = resolveOAuthConfig();
      const issuer = inside.issuer || cfg.issuer;
      const clientId = inside.client_id || cfg.clientId;

      // Issuer mismatch -> require re-login
      if (inside.issuer && inside.issuer.replace(/\/+$/, "") !== cfg.issuer.replace(/\/+$/, "")) {
        throw new OAuthError("auth_expired", "Issuer mismatch — please run /login grok-build again. [redacted]");
      }

      let tokens;
      try {
        const timeoutSignal = AbortSignal.timeout(this.opts.refreshTimeoutMs);
        const effective = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
        tokens = await refreshAccessToken({ issuer, clientId, refreshToken: inside.refresh, fetchImpl: this.opts.fetchImpl, signal: effective });
      } catch (err) {
        if (signal?.aborted) throw err;
        const code = (err as OAuthError)?.code;
        const msg = err instanceof Error ? err.message : String(err);
        const redacted = redactMessage(msg, [inside.refresh, inside.access]);
        if (code === "invalid_grant") {
          // Clear credential on invalid_grant (invalidated refresh token)
          await this.writeCredential(undefined);
          throw new OAuthError("auth_expired", "Refresh token expired or revoked — please run /login grok-build again. [redacted]");
        }
        // Network/5xx/timeout -> preserve old credential, throw retryable error
        throw new OAuthError(code ?? "refresh_failed", redacted);
      }

      const next = toOAuthCredentials(tokens, {
        issuer,
        clientId,
        scopes: inside.scopes,
        refreshFallback: inside.refresh,
      }) as BrokerCredential & { type: "oauth" };
      const nextCred: BrokerCredential = { ...next, type: "oauth" as const };

      // Freshness guard before write (we hold the lock, but belt-and-braces).
      const current = await readCredentialFrom(real, this.opts.providerId, () => this.nowMs());
      if (current && !isFreshEnough(nextCred, current)) {
        return current;
      }

      await this.writeCredential(nextCred);
      return nextCred;
    } finally {
      await lock.release().catch(() => {});
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
   * Controlled one-shot import of an externally obtained credential (US-09).
   * Validates issuer/client/expiry, then merges into the real auth.json under
   * the shared lock. The source file is never modified or deleted.
   */
  async importCredential(input: {
    access: string;
    refresh?: string;
    expiresAtMs: number;
    issuer?: string;
    clientId?: string;
    scopes?: string[];
  }): Promise<BrokerCredential> {
    if (!input.access || typeof input.access !== "string") {
      throw new OAuthError("invalid_params", "导入的凭证缺少 access token");
    }
    const cfg = resolveOAuthConfig();
    if (input.issuer && input.issuer.replace(/\/+$/, "") !== cfg.issuer.replace(/\/+$/, "")) {
      throw new OAuthError("invalid_params", `导入凭证的 issuer 不匹配（期望 ${cfg.issuer}）— 请重新登录 grok-build`);
    }
    if (input.clientId && input.clientId !== cfg.clientId) {
      throw new OAuthError("invalid_params", `导入凭证的 client_id 不匹配（期望 ${cfg.clientId}）— 请重新登录 grok-build`);
    }
    if (!Number.isFinite(input.expiresAtMs) || input.expiresAtMs <= this.nowMs()) {
      throw new OAuthError("invalid_params", "导入的凭证已过期 — 请重新登录 grok-build");
    }
    const { real } = await this.resolveTarget();
    ensureDirSecure(dirname(real));
    const lock = await acquireFileLock(real, { ...this.opts.lock });
    try {
      const cred: BrokerCredential = {
        type: "oauth",
        access: input.access,
        refresh: input.refresh ?? "",
        expires: input.expiresAtMs,
        issuer: input.issuer ?? cfg.issuer,
        client_id: input.clientId ?? cfg.clientId,
        scopes: input.scopes ?? cfg.scopes,
        token_type: "Bearer",
        obtained_at: this.nowMs(),
      };
      await this.writeCredential(cred);
      return cred;
    } finally {
      await lock.release().catch(() => {});
    }
  }

  /**
   * Non-secret credential status for host/UI surfaces (登录状态/过期时间/凭证来源).
   * Never returns token values. `usable` folds expiry + refresh presence so
   * compat consumers can decide without duplicating broker logic.
   */
  async status(): Promise<{
    loggedIn: boolean;
    expired: boolean;
    hasRefresh: boolean;
    usable: boolean;
    expiresAtMs?: number;
    issuer?: string;
  }> {
    const cred = await this.readCredential();
    if (!cred) return { loggedIn: false, expired: false, hasRefresh: false, usable: false };
    const expired = Number.isFinite(cred.expires) && cred.expires <= Date.now();
    const hasRefresh = Boolean(cred.refresh);
    return {
      loggedIn: true,
      expired,
      hasRefresh,
      usable: !expired || hasRefresh,
      expiresAtMs: Number.isFinite(cred.expires) ? cred.expires : undefined,
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

// Re-export helpers for tests
export const _internal = { atomicWriteJson, readAuthJson, isExpiring, isFreshEnough };
