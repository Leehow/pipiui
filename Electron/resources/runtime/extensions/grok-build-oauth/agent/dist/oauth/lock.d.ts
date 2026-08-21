export type LockHandle = {
    owner: string;
    release: () => Promise<void>;
};
export type LockOptions = {
    /** Total acquire deadline. Default 60s. */
    timeoutMs?: number;
    /** A lock whose mtime is older than this (no heartbeat) is stale. Default 45s. */
    staleMs?: number;
    /** Holder heartbeat interval. Default 5s (staleMs should be ≥ 3×). */
    heartbeatMs?: number;
    signal?: AbortSignal;
    /** Test hook: injected clock. */
    nowMs?: () => number;
};
/**
 * Acquire an exclusive lock guarding `guardedPath` (the *resolved real*
 * credential file — callers resolve symlinks first so projects sharing one
 * App-profile file also share one lock).
 */
export declare function acquireFileLock(guardedPath: string, opts?: LockOptions): Promise<LockHandle>;
/** Test/introspection helper: the lock path guarding `guardedPath`. */
export declare function lockPathFor(guardedPath: string): string;
/**
 * Resolve the *real* credential target for a (possibly symlinked) auth path.
 * Locks and atomic writes act on the real file, never on a project symlink —
 * a tmp+rename against the symlink path would replace the symlink and split
 * the App-profile shared credential (reviewer MUST-FIX #1). When the file does
 * not exist yet, resolve the nearest existing ancestor directory so projects
 * pointing at the same canonical location still share one lock path.
 */
export declare function resolveCredentialTarget(authPath: string): Promise<{
    asGiven: string;
    real: string;
}>;
