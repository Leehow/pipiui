/**
 * Cross-process file lock with holder identity, heartbeat, and stale takeover —
 * dependency-free (no `proper-lockfile`), so the lock behaves identically in the
 * workspace build and in the packaged bundle.
 *
 * Invariants (reviewer MUST-FIX #2):
 * - A live holder heartbeats the lock mtime, so an in-flight refresh that takes
 *   longer than any fixed threshold is NEVER considered stale and never deleted
 *   by a second process.
 * - Stale takeover only happens after `staleMs` without any heartbeat (crash /
 *   killed holder) and is atomic (rename race: exactly one contender wins).
 * - Release deletes the lock only when the on-disk owner nonce still matches,
 *   so a late release from a compromised/stale holder can never delete a lock
 *   that a new holder legitimately acquired.
 *
 * Lock file: `<path>.groklock` (regular file). The `.groklock` suffix keeps us
 * clear of pi's own `proper-lockfile` lock *directories* (`<path>.lock`).
 */
import { open, readFile, rename, stat, unlink, utimes } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

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

const LOCK_SUFFIX = ".groklock";

type LockFileContent = { v: 1; owner: string; pid: number; acquiredAtMs: number };

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

function readLockContent(path: string): Promise<LockFileContent | undefined> {
  return readFile(path, "utf8")
    .then((text) => {
      try {
        const parsed = JSON.parse(text) as LockFileContent;
        if (parsed && typeof parsed === "object" && typeof parsed.owner === "string" && parsed.owner) {
          return parsed;
        }
      } catch {
        /* malformed content — treated by mtime staleness */
      }
      return undefined;
    })
    .catch(() => undefined);
}

/**
 * Acquire an exclusive lock guarding `guardedPath` (the *resolved real*
 * credential file — callers resolve symlinks first so projects sharing one
 * App-profile file also share one lock).
 */
export async function acquireFileLock(guardedPath: string, opts: LockOptions = {}): Promise<LockHandle> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const staleMs = Math.max(1_000, opts.staleMs ?? 45_000);
  const heartbeatMs = Math.min(Math.max(250, opts.heartbeatMs ?? 5_000), Math.floor(staleMs / 3));
  const nowMs = opts.nowMs ?? Date.now;
  const lockPath = `${guardedPath}${LOCK_SUFFIX}`;
  const owner = randomUUID();
  const deadline = nowMs() + timeoutMs;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let released = false;

  const startHeartbeat = () => {
    heartbeatTimer = setInterval(() => {
      // Best-effort liveness touch: a live holder never looks stale.
      utimes(lockPath, new Date(), new Date()).catch(() => {});
    }, heartbeatMs);
    heartbeatTimer.unref?.();
  };

  const stopHeartbeat = () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  };

  const release = async () => {
    if (released) return;
    released = true;
    stopHeartbeat();
    // Owner-checked release: never delete a lock a new holder took over.
    const current = await readLockContent(lockPath);
    if (current?.owner === owner) {
      await unlink(lockPath).catch(() => {});
    }
  };

  let retry = 0;
  for (;;) {
    opts.signal?.throwIfAborted();

    // Fast path: exclusive create.
    let fd;
    try {
      fd = await open(lockPath, "wx", 0o600);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code !== "EEXIST") throw e;

      // Locked. Stale? (no heartbeat for staleMs)
      let mtimeMs: number | undefined;
      try {
        mtimeMs = (await stat(lockPath)).mtimeMs;
      } catch {
        continue; // lock vanished between open and stat — retry immediately
      }
      const age = nowMs() - mtimeMs;
      if (age > staleMs) {
        // Atomic takeover: rename wins for exactly one contender.
        const tombstone = `${lockPath}.stale.${randomUUID()}`;
        try {
          await rename(lockPath, tombstone);
          await unlink(tombstone).catch(() => {});
        } catch {
          /* someone else took it over — fall through to wait */
        }
        continue;
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

    // Created — write holder identity and heartbeat for the hold duration.
    try {
      const content: LockFileContent = { v: 1, owner, pid: process.pid, acquiredAtMs: nowMs() };
      await fd.writeFile(JSON.stringify(content), "utf8");
      await fd.sync();
      await fd.chmod(0o600);
    } finally {
      await fd.close();
    }
    startHeartbeat();
    // Paranoia: if we were starved past the deadline while creating, still hold —
    // we own the lock now; release is owner-checked.
    return { owner, release };
  }
}

/** Test/introspection helper: the lock path guarding `guardedPath`. */
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
