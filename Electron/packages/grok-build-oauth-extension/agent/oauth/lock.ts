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
import { mkdir, readFile, rename, rmdir, stat, unlink, utimes } from "node:fs/promises";
import { rmdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

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

const LOCK_SUFFIX = ".lock";

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          reject(abortError());
        },
        { once: true },
      );
    }
  });
}

function abortError(): Error {
  const e = new Error("Aborted");
  e.name = "AbortError";
  return e;
}

/** Best-effort cleanup when the process exits while holding (mirrors proper-lockfile's onExit). */
const heldLockDirs = new Set<string>();
let exitHookInstalled = false;
function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on("exit", () => {
    for (const dir of heldLockDirs) {
      try { rmdirSync(dir); } catch { /* already gone / not empty */ }
    }
  });
}

async function observeMtimeMs(lockPath: string): Promise<number | undefined> {
  try {
    return (await stat(lockPath)).mtimeMs;
  } catch {
    return undefined;
  }
}

/**
 * Acquire an exclusive lock guarding `guardedPath` using proper-lockfile's
 * on-disk format: a lock DIRECTORY at `<guardedPath>.lock`.
 */
export async function acquireCredentialLock(guardedPath: string, opts: LockOptions = {}): Promise<LockHandle> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const staleMs = Math.max(2_000, opts.staleMs ?? 45_000);
  const heartbeatMs = Math.min(Math.max(250, opts.heartbeatMs ?? 2_000), Math.floor(staleMs / 2));
  const nowMs = opts.nowMs ?? Date.now;
  const lockPath = `${guardedPath}${LOCK_SUFFIX}`;
  const owner = randomUUID();
  const deadline = nowMs() + timeoutMs;
  let observedMtimeMs: number | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let compromised = false;
  let released = false;
  let retry = 0;

  installExitHook();

  // ── contend ──────────────────────────────────────────────────────────────
  for (;;) {
    opts.signal?.throwIfAborted();

    // Fast path: atomic mkdir (this is the acquisition).
    try {
      await mkdir(lockPath, { mode: 0o700 });
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code !== "EEXIST") throw e;

      // Locked. Stale? (no heartbeat for staleMs — same rule proper-lockfile applies)
      const mtimeMs = await observeMtimeMs(lockPath);
      if (mtimeMs === undefined) continue; // lock vanished between mkdir and stat — retry
      if (nowMs() - mtimeMs > staleMs) {
        await rmdir(lockPath).catch(() => {});
        continue; // someone else may win the re-mkdir race; loop decides
      }

      const remaining = deadline - nowMs();
      if (remaining <= 0) {
        throw new Error(`Failed to acquire lock on ${guardedPath}: timeout after ${timeoutMs}ms (holder alive)`);
      }
      const backoff = Math.min(20 * 2 ** Math.min(retry, 8), 250, remaining);
      retry += 1;
      await sleepAbortable(backoff, opts.signal);
      continue;
    }

    // Created — record the mtime we now own. If it vanished instantly
    // (stale-takeover race), loop again instead of operating unlocked.
    observedMtimeMs = await observeMtimeMs(lockPath);
    if (observedMtimeMs === undefined) continue;
    break;
  }

  heldLockDirs.add(lockPath);

  const stopHeartbeat = () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  };

  // ── hold: keep the mtime fresh and verify ownership ─────────────────────
  const beat = async () => {
    if (released || compromised) return;
    try {
      const current = await observeMtimeMs(lockPath);
      if (current === undefined || current !== observedMtimeMs) {
        // Lock dir removed and recreated by another contender (takeover).
        compromised = true;
        stopHeartbeat();
        heldLockDirs.delete(lockPath);
        return;
      }
      const next = new Date();
      await utimes(lockPath, next, next);
      observedMtimeMs = (await observeMtimeMs(lockPath)) ?? observedMtimeMs;
    } catch {
      compromised = true;
      stopHeartbeat();
      heldLockDirs.delete(lockPath);
    }
  };
  heartbeatTimer = setInterval(() => {
    void beat();
  }, heartbeatMs);
  heartbeatTimer.unref?.();

  return {
    owner,
    get compromised() {
      return compromised;
    },
    assertValid(): void {
      if (compromised) {
        const e = new Error(`Credential lock on ${guardedPath} was compromised (taken over) — aborting store operation`);
        (e as NodeJS.ErrnoException).code = "ECOMPROMISED";
        throw e;
      }
    },
    async release(): Promise<void> {
      if (released) return;
      released = true;
      stopHeartbeat();
      heldLockDirs.delete(lockPath);
      if (compromised) return; // not ours anymore — never delete the new holder's lock
      const current = await observeMtimeMs(lockPath);
      if (current === undefined || current !== observedMtimeMs) return; // taken over
      await rmdir(lockPath).catch(() => {});
    },
  };
}

/** Test/introspection helper: the proper-lockfile lock dir guarding `guardedPath`. */
export function lockPathFor(guardedPath: string): string {
  return `${guardedPath}${LOCK_SUFFIX}`;
}

/**
 * Resolve the *real* credential target for a (possibly symlinked) auth path.
 * Locks and atomic writes act on the real file, never on a project symlink —
 * a tmp+rename against the symlink path would replace the symlink and split
 * the App-profile shared credential (reviewer MUST-FIX #1). When the file does
 * not exist yet, resolve the nearest existing ancestor directory so projects
 * pointing at the same canonical location still share one lock path.
 */
export async function resolveCredentialTarget(authPath: string): Promise<{ asGiven: string; real: string }> {
  const { realpath } = await import("node:fs/promises");
  try {
    const real = await realpath(authPath);
    return { asGiven: authPath, real };
  } catch {
    /* missing file — resolve parent */
  }
  try {
    const realDir = await realpath(dirname(authPath));
    return { asGiven: authPath, real: join(realDir, basename(authPath)) };
  } catch {
    // Parent missing too: use the path as-is (mkdir happens before locking).
    return { asGiven: authPath, real: authPath };
  }
}

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
export async function acquireAuthStoreLocks(
  target: { asGiven: string; real: string },
  opts: LockOptions = {},
): Promise<{ handles: LockHandle[]; release(): Promise<void> }> {
  const paths = target.real === target.asGiven ? [target.real] : [target.real, target.asGiven];
  const handles: LockHandle[] = [];
  try {
    for (const p of paths) {
      handles.push(await acquireCredentialLock(p, opts));
    }
  } catch (err) {
    for (const h of handles.reverse()) await h.release().catch(() => {});
    throw err;
  }
  return {
    handles,
    async release(): Promise<void> {
      for (const h of [...handles].reverse()) await h.release().catch(() => {});
    },
  };
}

// Re-exported for the atomic writer in store-adapter.js (same module keeps fs imports in one place).
export const _fs = { readFile, rename, stat, unlink, utimes };
