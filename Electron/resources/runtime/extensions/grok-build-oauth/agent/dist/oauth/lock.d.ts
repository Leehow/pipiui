/**
 * Credential-store file lock — proper-lockfile wire compatible (dependency-free).
 *
 * Pipi's `FileAuthStorageBackend` (the store behind ModelRuntime login/logout)
 * locks `auth.json` with `proper-lockfile`:
 *   lock  = mkdir `<path>.lock`            (atomic EEXIST check)
 *   stale = lock-dir mtime older than `stale` ms → rmdir + retry
 *   fresh = holder `utimes()`s the lock dir while holding
 *   free  = rmdir `<path>.lock`
 * This module speaks EXACTLY that wire format, so a grok-build broker and a
 * Pipi ModelRuntime writing the same `auth.json` exclude each other across
 * processes — one lock, one file, no second `.groklock` (reviewer round-2
 * Critical #1: independent lock files let whole-file read-modify-write races
 * drop concurrent logins/logouts/other-provider updates).
 *
 * Safety properties beyond the wire format:
 * - A live holder heartbeats the lock dir mtime, so an in-flight refresh that
 *   outlasts any fixed threshold is never considered stale and never removed.
 * - Takeover only happens `staleMs` after the last heartbeat (crashed holder).
 *   Default 45s > pi's async-lock stale (30s), so we never steal a lock pi
 *   itself still considers live; our heartbeat (2s) is far below pi's sync
 *   stale (10s), so pi never steals ours while we are working.
 * - Release and heartbeat verify the observed mtime is still ours; a holder
 *   whose lock was taken over after a crash never deletes the new holder's
 *   lock, and the broker can detect compromise and fail safely.
 *
 * All paths are the *resolved real* credential file (see `resolveCredentialTarget`)
 * — projects sharing one App-profile file through a symlink share ONE real lock.
 * Sessions constructed by pi lock the *symlink path* (`realpath: false`), so
 * callers additionally lock the as-given path (see `acquireAuthStoreLocks`).
 */
import { readFile, rename, stat, unlink, utimes } from "node:fs/promises";
export type LockHandle = {
    owner: string;
    /** True when the lock dir was taken over (mtime no longer ours). */
    readonly compromised: boolean;
    /** Throws when the lock was compromised (caller must not touch the store). */
    assertValid(): void;
    release(): Promise<void>;
};
export type LockOptions = {
    /** Total acquire deadline. Default 60s. */
    timeoutMs?: number;
    /**
     * A lock dir whose mtime is older than this (no heartbeat) is stale and may
     * be taken over. Default 45s (must exceed proper-lockfile's 30s async stale).
     */
    staleMs?: number;
    /** Holder heartbeat interval. Default min(2s, staleMs/2) (must stay below pi's 10s sync stale). */
    heartbeatMs?: number;
    signal?: AbortSignal;
    /** Test hook: injected clock (default Date.now). */
    nowMs?: () => number;
};
/**
 * Acquire an exclusive lock guarding `guardedPath` using proper-lockfile's
 * on-disk format: a lock DIRECTORY at `<guardedPath>.lock`.
 */
export declare function acquireCredentialLock(guardedPath: string, opts?: LockOptions): Promise<LockHandle>;
/** Test/introspection helper: the proper-lockfile lock dir guarding `guardedPath`. */
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
/**
 * Acquire the full auth-store guard for a credential target:
 * 1. `<real>.lock`   — the lock Pipi's host ModelRuntime (authPath = canonical
 *                      file) and every other broker instance take.
 * 2. `<asGiven>.lock`— the lock a session-embedded pi ModelRuntime takes
 *                      (pi locks its authPath with `realpath: false`, and a
 *                      project's `.pi/agent/auth.json` is a symlink to the
 *                      canonical file).
 * Fixed order (real, then as-given) prevents broker/broker deadlock; pi
 * parties hold exactly one of the two, so they never wait on each other here.
 */
export declare function acquireAuthStoreLocks(target: {
    asGiven: string;
    real: string;
}, opts?: LockOptions): Promise<{
    handles: LockHandle[];
    release(): Promise<void>;
}>;
export declare const _fs: {
    readFile: typeof readFile;
    rename: typeof rename;
    stat: typeof stat;
    unlink: typeof unlink;
    utimes: typeof utimes;
};
