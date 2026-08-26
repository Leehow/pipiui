import type { PreparedCache } from "./cache.js";
import type { Candidate, PreparedEntry, WorkerStats } from "./types.js";
export interface WorkerClient {
    health(signal?: AbortSignal): Promise<boolean>;
    compress(candidate: Candidate, modelId: string, signal?: AbortSignal): Promise<unknown>;
    retrieve(hash: string, signal?: AbortSignal): Promise<string | undefined>;
}
export interface WorkerOptions {
    client: WorkerClient;
    cache: PreparedCache;
    maxQueue?: number;
    concurrency?: number;
    onAccepted?: (entry: PreparedEntry) => void;
    onRejected?: (candidate: Candidate, reason: string) => void;
    onFault?: (reason: string) => void;
    onStateChange?: (state: WorkerStats["state"]) => void;
}
export declare class CompressionWorker {
    #private;
    constructor(options: WorkerOptions);
    checkHealth(options?: {
        faultOnFailure?: boolean;
    }): Promise<boolean>;
    enqueue(candidate: Candidate, modelId: string): boolean;
    stop(): void;
    stats(): WorkerStats;
}
