export declare const HEADROOM_POLICY_VERSION = "pipiui-v1";
export interface HeadroomConfig {
    baseUrl: string;
    /** True only for the endpoint injected by the PipiUI host. */
    managed: boolean;
    managedState?: "installing" | "starting" | "ready" | "failed" | "stopped";
    managedStatePath?: string;
    /** Host-injected engine identity used to validate the project rendezvous file. */
    managedEngineVersion: string;
    managedStartupTimeoutMs: number;
    minContextTokens: number;
    minResultChars: number;
    protectRecentToolResults: number;
    protectedTools: readonly string[];
    maxCacheBytes: number;
    healthTimeoutMs: number;
    requestTimeoutMs: number;
}
export interface Candidate {
    key: string;
    toolCallId: string;
    toolName: string;
    originalText: string;
}
export interface PreparedEntry extends Candidate {
    compressedText: string;
    ccrHashes: string[];
    retrievals: Map<string, string>;
    tokensBefore: number;
    tokensAfter: number;
    tokensSaved: number;
    originalBytes: number;
    compressedBytes: number;
    sizeBytes: number;
    originalSha256: string;
    policyVersion: string;
    createdAt: number;
    lastAccessedAt: number;
}
export interface WorkerStats {
    candidates: number;
    queued: number;
    active: number;
    accepted: number;
    rejected: number;
    skipped: number;
    dropped: number;
    state: "warming" | "online" | "offline" | "stopped";
    lastError?: string;
}
export interface RuntimeSnapshot {
    enabled: boolean;
    ownsPrimary: boolean;
    sessionId?: string;
    modelId: string;
    upstreamVersion: string;
    tokensSaved: number;
    bytesSaved: number;
    substitutions: number;
    uniqueSubstitutions: number;
    retrievals: number;
    fallbackReason?: string;
    config: HeadroomConfig;
    worker: WorkerStats;
    cache: {
        entries: number;
        bytes: number;
        maxBytes: number;
    };
    rewriteGate?: {
        usageFraction: number;
        quietDelayMs: number;
        armed: boolean;
        activeTurn: boolean;
        armedAt?: number;
        lastObservedFraction?: number;
    };
    warnings: string[];
}
