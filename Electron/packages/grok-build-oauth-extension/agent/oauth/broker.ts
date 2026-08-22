/**
 * OAuth Credential Broker — single API for provider requests and image tools.
 *
 * Invariants: earlyRefresh, rotation, 401 single retry, no-refresh -> re-login,
 * invalid_grant cleanup (conditional — never clears a rotated credential),
 * network/5xx preserve old, in-process dedup, cross-process lock + re-read +
 * freshness guard, 0600 tmp/fsync/rename, no token logs.
 *
 * Lock unification (round-2 reviewer Critical #1): EVERY read/write goes
 * through a CredentialStoreAdapter (`./store-adapter.js`). The default file
 * adapter takes the SAME lock Pipi's `FileAuthStorageBackend` takes
 * (proper-lockfile mkdir `<authPath>.lock`, plus the as-given path for
 * session-embedded pi writers) and mutates the whole auth.json with identical
 * RMW semantics — only this provider's entry changes, so concurrent
 * login/logout/other-provider updates are never lost. Hosts that own a real
 * CredentialStore instance can inject it and the broker uses THAT instead.
 *
 * Symlink/shared-profile safety (reviewer MUST-FIX #1): the credential target
 * is resolved to its REAL path first. PipiUI links each project's
 * `.pi/agent/auth.json` at the App-profile canonical file; the lock and the
 * atomic tmp+rename act on the canonical file, never on the project symlink.
 *
 * Lock safety (reviewer MUST-FIX #2): the holder heartbeats the lock dir
 * mtime (proper-lockfile wire format), so a live refresh is never treated as
 * stale; takeover only happens after the holder stopped heartbeating (crash),
 * and release is mtime-checked so a late release can never delete a new
 * holder's lock.
 */
import { OAuthError } from "./device.js";
import { refreshCredentialUnlocked } from "./refresh.js";
import type { StoredOAuthCredential } from "./credentials.js";
import { resolveOAuthConfig } from "./config.js";
import { authJsonPath } from "./home.js";
import {
  createFileCredentialStoreAdapter,
  createCredentialStoreAdapterFromStore,
  type CredentialEntry,
  type CredentialStoreAdapter,
} from "./store-adapter.js";
import type { LockOptions } from "./lock.js";

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
  /**
   * Host-injected credential store (pi `AuthStorage` shape: read/modify/delete
   * — or a ready-made adapter). ALL broker mutations then go through it.
   */
  credentialStore?: CredentialStoreAdapter | { read: unknown; modify: unknown; delete: unknown };
};

function isAdapter(v: unknown): v is CredentialStoreAdapter {
  const c = v as CredentialStoreAdapter;
  return typeof c?.read === "function" && typeof c?.modify === "function";
}

function entryOf(cred: BrokerCredential): CredentialEntry {
  const entry: CredentialEntry = {
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
  if (cred.tier !== undefined) entry.tier = cred.tier;
  if (cred.tier_raw !== undefined) entry.tier_raw = cred.tier_raw;
  if (cred.tier_source !== undefined) entry.tier_source = cred.tier_source;
  return entry;
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

/** Map a stored auth.json entry onto a broker credential. */
export function brokerCredentialFromEntry(entry: CredentialEntry | undefined, nowMs: () => number): BrokerCredential | undefined {
  if (!entry || entry.type !== "oauth") return undefined;
  const access = entry.access as string | undefined;
  const refresh = entry.refresh as string | undefined;
  const expires = entry.expires as number | undefined;
  if (typeof access !== "string" || !access || typeof expires !== "number" || !Number.isFinite(expires)) return undefined;
  const cfg = resolveOAuthConfig();
  const cred: BrokerCredential = {
    type: "oauth",
    access,
    refresh: typeof refresh === "string" ? refresh : "",
    expires,
    issuer: typeof entry.issuer === "string" ? entry.issuer : cfg.issuer,
    client_id: typeof entry.client_id === "string" ? entry.client_id : cfg.clientId,
    scopes: Array.isArray(entry.scopes) ? entry.scopes as string[] : cfg.scopes,
    token_type: typeof entry.token_type === "string" ? entry.token_type : "Bearer",
    obtained_at: typeof entry.obtained_at === "number" ? entry.obtained_at : nowMs(),
  };
  if (typeof entry.tier === "string") cred.tier = entry.tier;
  if (typeof entry.tier_raw === "string") cred.tier_raw = entry.tier_raw;
  if (entry.tier_source === "jwt") cred.tier_source = "jwt";
  return cred;
}

export class GrokCredentialBroker {
  private inflight = new Map<string, Promise<BrokerCredential>>();
  private opts: {
    providerId: string;
    earlyRefreshSec: number;
    fetchImpl: typeof fetch;
    clock: Clock;
    lock: LockOptions;
    refreshTimeoutMs: number;
    store: CredentialStoreAdapter;
  };

  constructor(opts: BrokerOptions = {}) {
    const cfg = resolveOAuthConfig();
    const store: CredentialStoreAdapter = opts.credentialStore
      ? isAdapter(opts.credentialStore)
        ? opts.credentialStore
        : createCredentialStoreAdapterFromStore(opts.credentialStore as never)
      : createFileCredentialStoreAdapter({
          // Fail closed like every other entry point: no cwd fallback.
          authPath: opts.authPath ?? authJsonPath(),
          lock: opts.lock,
        });
    this.opts = {
      providerId: opts.providerId ?? "grok-build",
      earlyRefreshSec: opts.earlyRefreshSec ?? cfg.earlyRefreshSec,
      fetchImpl: (opts.fetchImpl ?? fetch) as typeof fetch,
      clock: opts.clock ?? { nowMs: () => Date.now() },
      lock: opts.lock ?? {},
      refreshTimeoutMs: opts.refreshTimeoutMs ?? 30_000,
      store,
    };
  }

  private nowMs(): number { return this.opts.clock.nowMs(); }

  private async readCredential(): Promise<BrokerCredential | undefined> {
    const entry = await this.opts.store.read(this.opts.providerId);
    return brokerCredentialFromEntry(entry, () => this.nowMs());
  }

  /** Controlled write: merge only this provider's entry into the real file. */
  private async writeCredential(cred: BrokerCredential | undefined): Promise<void> {
    await this.opts.store.modify(this.opts.providerId, async () =>
      cred ? { op: "set", value: entryOf(cred) } : { op: "delete" },
    );
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

  /** Force refresh, deduped in-process, cross-process locked (when the adapter has a lock), with re-read + freshness guard */
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

    const cfg = resolveOAuthConfig();

    // Issuer mismatch -> require re-login
    if (before.issuer && before.issuer.replace(/\/+$/, "") !== cfg.issuer.replace(/\/+$/, "")) {
      throw new OAuthError("auth_expired", "Issuer mismatch — please run /login grok-build again. [redacted]");
    }

    const runRefresh = async (store?: {
      read(id: string): Promise<CredentialEntry | undefined>;
      write(id: string, value: CredentialEntry): Promise<void>;
      remove(id: string): Promise<void>;
    }): Promise<BrokerCredential> => {
      signal?.throwIfAborted();

      const readNow = async (): Promise<BrokerCredential | undefined> => {
        if (!store) return this.readCredential();
        return brokerCredentialFromEntry(await store.read(this.opts.providerId), () => this.nowMs());
      };

      // Re-read inside the lock (authoritative bytes).
      const inside = await readNow();
      if (!inside) throw new OAuthError("auth_expired", "Not logged in — please run /login grok-build");
      // Freshness guard: another process already refreshed while we waited.
      if (
        !isExpiring(inside, this.opts.earlyRefreshSec, this.nowMs()) &&
        isFreshEnough(inside, before) &&
        (inside.obtained_at !== before.obtained_at || inside.access !== before.access)
      ) {
        return inside;
      }

      // Pure network refresh (shared with the provider's in-lock callback —
      // see oauth/refresh.js): no store access, no lock, no persistence.
      // We already hold the unified store lock here and do the RMW below.
      let next: StoredOAuthCredential;
      try {
        next = await refreshCredentialUnlocked(inside, signal, {
          fetchImpl: this.opts.fetchImpl,
          refreshTimeoutMs: this.opts.refreshTimeoutMs,
        });
      } catch (err) {
        if (signal?.aborted) throw err;
        if ((err as OAuthError)?.code === "invalid_grant") {
          // Clear credential on invalid_grant (invalidated refresh token) —
          // but ONLY when the stored credential is still the one we tried:
          // if another process rotated it meanwhile, that token is valid and
          // must survive (rotation race).
          if (store) {
            const current = await store.read(this.opts.providerId);
            if ((current?.refresh as string | undefined) === inside.refresh) {
              await store.remove(this.opts.providerId);
            } else {
              return (await readNow()) ?? inside;
            }
          } else {
            await this.opts.store.modify(this.opts.providerId, async (current) =>
              (current?.refresh as string | undefined) === inside.refresh ? { op: "delete" } : { op: "noop" },
            );
          }
          throw new OAuthError("auth_expired", "Refresh token expired or revoked — please run /login grok-build again. [redacted]");
        }
        // Network/5xx/timeout (already redacted by the pure refresh) —
        // preserve old credential, throw retryable error.
        throw err;
      }
      const nextCred: BrokerCredential = { ...next, type: "oauth" as const };

      // Freshness guard before write (we hold the lock, but belt-and-braces).
      const current = await readNow();
      if (current && !isFreshEnough(nextCred, current)) {
        return current;
      }

      if (store) await store.write(this.opts.providerId, entryOf(nextCred));
      else await this.writeCredential(nextCred);
      return nextCred;
    };

    // Cross-process refresh serialization under the SAME lock as every store
    // mutation (heartbeat keeps a live — possibly slow — refresh non-stale).
    if (this.opts.store.withExclusive) {
      return this.opts.store.withExclusive(runRefresh);
    }
    // Injected store without a lock: rely on in-process dedup + the
    // freshness-guarded, conditionally-applied writes above.
    return runRefresh(undefined);
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
    tier?: string;
    tierRaw?: string;
    tierSource?: "jwt";
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
      ...(input.tier !== undefined ? { tier: input.tier } : {}),
      ...(input.tierRaw !== undefined ? { tier_raw: input.tierRaw } : {}),
      ...(input.tierSource !== undefined ? { tier_source: input.tierSource } : {}),
    };
    await this.writeCredential(cred);
    return cred;
  }

  /**
   * Non-secret credential status for host/UI surfaces (登录状态/过期时间/凭证来源/tier).
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
    /** Subscription tier carried by the credential (official id_token `tier` claim); undefined = unknown. */
    tier?: string;
    tierRaw?: string;
    tierSource?: "jwt";
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
      ...(cred.tier !== undefined ? { tier: cred.tier } : {}),
      ...(cred.tier_raw !== undefined ? { tierRaw: cred.tier_raw } : {}),
      ...(cred.tier_source !== undefined ? { tierSource: cred.tier_source } : {}),
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
export const _internal = { isExpiring, isFreshEnough };
export { atomicWriteJson, readAuthJson } from "./store-adapter.js";
