import { type StoredOAuthCredential } from "./credentials.js";
export type BrokerCredential = StoredOAuthCredential & {
    type: "oauth";
};
type Clock = {
    nowMs: () => number;
};
declare function atomicWriteJson(filePath: string, data: Record<string, unknown>): Promise<void>;
declare function readAuthJson(authPath: string): Promise<Record<string, unknown>>;
declare function isExpiring(cred: BrokerCredential, earlyRefreshSec: number, nowMs: number): boolean;
declare function isFreshEnough(newer: BrokerCredential, older: BrokerCredential | undefined): boolean;
declare function acquireLock(authPath: string, signal?: AbortSignal): Promise<() => Promise<void>>;
export type BrokerOptions = {
    authPath?: string;
    providerId?: string;
    earlyRefreshSec?: number;
    fetchImpl?: typeof fetch;
    clock?: Clock;
};
export declare class GrokCredentialBroker {
    private inflight;
    private opts;
    constructor(opts?: BrokerOptions);
    private nowMs;
    private readCredential;
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
     * Non-secret credential status for host/UI surfaces (登录状态/过期时间/凭证来源).
     * Never returns token values.
     */
    status(): Promise<{
        loggedIn: boolean;
        expired: boolean;
        expiresAtMs?: number;
        hasRefresh: boolean;
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
    acquireLock: typeof acquireLock;
    isExpiring: typeof isExpiring;
    isFreshEnough: typeof isFreshEnough;
};
export {};
