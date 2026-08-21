import { type StoredOAuthCredential } from "./credentials.js";
import { type LockOptions } from "./lock.js";
export type BrokerCredential = StoredOAuthCredential & {
    type: "oauth";
};
type Clock = {
    nowMs: () => number;
};
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
/**
 * Atomic JSON write against the REAL target file (tmp + fsync + chmod 0600 +
 * rename inside the real file's directory). `rename` may replace a regular
 * file — it must never be pointed at a symlink path, which is why callers
 * resolve the real target first.
 */
declare function atomicWriteJson(realPath: string, data: Record<string, unknown>): Promise<void>;
declare function readAuthJson(path: string): Promise<Record<string, unknown>>;
declare function isExpiring(cred: BrokerCredential, earlyRefreshSec: number, nowMs: number): boolean;
declare function isFreshEnough(newer: BrokerCredential, older: BrokerCredential | undefined): boolean;
export declare class GrokCredentialBroker {
    private inflight;
    private opts;
    /** Resolved real credential target (symlinks followed). */
    private target;
    constructor(opts?: BrokerOptions);
    private nowMs;
    /** Resolve (and cache) the real credential target; locks and writes act on it. */
    private resolveTarget;
    /** The path reads/writes/locks act on (real target, symlink-followed). */
    realAuthPath(): Promise<string>;
    private readCredential;
    /** Controlled write: merge only this provider's entry into the real file. */
    private writeCredential;
    /** Shared API for provider and image tools: returns a fresh access token, refreshing early if needed */
    getAccessToken(signal?: AbortSignal): Promise<string>;
    /** Force refresh, deduped in-process, cross-process locked, with re-read + freshness guard */
    forceRefresh(signal?: AbortSignal): Promise<BrokerCredential>;
    private doRefresh;
    /**
     * Execute operation with Bearer token, retrying once on 401 via forced refresh.
     * Shared by provider requests and image tools.
     */
    with401Retry<T>(operation: (token: string) => Promise<T>, signal?: AbortSignal): Promise<T>;
    /** Whether a grok-build OAuth credential is currently persisted (no network). */
    hasCredential(): Promise<boolean>;
    /**
     * Controlled one-shot import of an externally obtained credential (US-09).
     * Validates issuer/client/expiry, then merges into the real auth.json under
     * the shared lock. The source file is never modified or deleted.
     */
    importCredential(input: {
        access: string;
        refresh?: string;
        expiresAtMs: number;
        issuer?: string;
        clientId?: string;
        scopes?: string[];
    }): Promise<BrokerCredential>;
    /**
     * Non-secret credential status for host/UI surfaces (登录状态/过期时间/凭证来源).
     * Never returns token values. `usable` folds expiry + refresh presence so
     * compat consumers can decide without duplicating broker logic.
     */
    status(): Promise<{
        loggedIn: boolean;
        expired: boolean;
        hasRefresh: boolean;
        usable: boolean;
        expiresAtMs?: number;
        issuer?: string;
    }>;
    /** For tests: expose read */
    _readForTest(): Promise<BrokerCredential | undefined>;
    _writeForTest(cred: BrokerCredential | undefined): Promise<void>;
}
export declare function createBroker(opts?: BrokerOptions): GrokCredentialBroker;
export declare const _internal: {
    atomicWriteJson: typeof atomicWriteJson;
    readAuthJson: typeof readAuthJson;
    isExpiring: typeof isExpiring;
    isFreshEnough: typeof isFreshEnough;
};
export {};
