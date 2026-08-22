import { type StoredOAuthCredential } from "./credentials.js";
import { type CredentialEntry, type CredentialStoreAdapter } from "./store-adapter.js";
import type { LockOptions } from "./lock.js";
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
    /**
     * Host-injected credential store (pi `AuthStorage` shape: read/modify/delete
     * — or a ready-made adapter). ALL broker mutations then go through it.
     */
    credentialStore?: CredentialStoreAdapter | {
        read: unknown;
        modify: unknown;
        delete: unknown;
    };
};
declare function isExpiring(cred: BrokerCredential, earlyRefreshSec: number, nowMs: number): boolean;
declare function isFreshEnough(newer: BrokerCredential, older: BrokerCredential | undefined): boolean;
/** Map a stored auth.json entry onto a broker credential. */
export declare function brokerCredentialFromEntry(entry: CredentialEntry | undefined, nowMs: () => number): BrokerCredential | undefined;
export declare class GrokCredentialBroker {
    private inflight;
    private opts;
    constructor(opts?: BrokerOptions);
    private nowMs;
    private readCredential;
    /** Controlled write: merge only this provider's entry into the real file. */
    private writeCredential;
    /** Shared API for provider and image tools: returns a fresh access token, refreshing early if needed */
    getAccessToken(signal?: AbortSignal): Promise<string>;
    /** Force refresh, deduped in-process, cross-process locked (when the adapter has a lock), with re-read + freshness guard */
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
        tier?: string;
        tierRaw?: string;
        tierSource?: "jwt";
    }): Promise<BrokerCredential>;
    /**
     * Non-secret credential status for host/UI surfaces (登录状态/过期时间/凭证来源/tier).
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
        /** Subscription tier carried by the credential (official id_token `tier` claim); undefined = unknown. */
        tier?: string;
        tierRaw?: string;
        tierSource?: "jwt";
    }>;
    /** For tests: expose read */
    _readForTest(): Promise<BrokerCredential | undefined>;
    _writeForTest(cred: BrokerCredential | undefined): Promise<void>;
}
export declare function createBroker(opts?: BrokerOptions): GrokCredentialBroker;
export declare const _internal: {
    isExpiring: typeof isExpiring;
    isFreshEnough: typeof isFreshEnough;
};
export { atomicWriteJson, readAuthJson } from "./store-adapter.js";
