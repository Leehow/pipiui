/**
 * CredentialStore adapter — the ONLY path the broker uses to touch `auth.json`.
 *
 * Round-2 reviewer Critical #1: the broker previously did its own whole-file
 * read-modify-write under a private `.groklock`, while Pi's ModelRuntime
 * (login/logout) and session writers mutated the same file under pi's
 * `proper-lockfile` `<path>.lock` — two independent lock files over one file
 * means concurrent writers silently drop each other's fields.
 *
 * Every adapter mutates the store with FileAuthStorageBackend semantics:
 * - cross-process exclusion via the SAME `<real>.lock` mkdir lock proper-lockfile
 *   uses (plus `<asGiven>.lock`, see lock.ts), held for the whole RMW;
 * - read-modify-write of the WHOLE auth.json, mutating ONLY this provider's
 *   entry, so other providers' logins/logouts are never lost;
 * - 0600 tmp+fsync+rename writes against the resolved REAL target (never
 *   through a project symlink, which a rename would replace).
 *
 * `withExclusive` runs an arbitrary section (e.g. a token refresh: network call
 * included) under the same locks, giving cross-process refresh serialization
 * without a second lock file.
 *
 * `createCredentialStoreAdapterFromStore` wraps a host-injected CredentialStore
 * (pi `AuthStorage` shape: read/modify/delete) so hosts that own a real store
 * instance can route every broker mutation through it instead.
 */
import { chmodSync, mkdirSync } from "node:fs";
import { open, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { acquireAuthStoreLocks, resolveCredentialTarget, type LockOptions } from "./lock.js";

/** One provider's raw auth.json entry (shape owned by the credential store). */
export type CredentialEntry = Record<string, unknown>;

/** What a modify callback wants to do with the provider's entry. */
export type CredentialMutation =
  | { op: "set"; value: CredentialEntry }
  | { op: "delete" }
  | { op: "noop" };

/** Locked, pre-resolved store handed to a `withExclusive` section. */
export type ExclusiveStore = {
  read(providerId: string): Promise<CredentialEntry | undefined>;
  write(providerId: string, value: CredentialEntry): Promise<void>;
  remove(providerId: string): Promise<void>;
};

export type CredentialStoreAdapter = {
  /** Best-effort latest read of one provider's entry (no lock). */
  read(providerId: string): Promise<CredentialEntry | undefined>;
  /**
   * Locked read-modify-write of one provider's entry. The callback receives the
   * CURRENT entry (read under the lock) and returns the mutation; every other
   * provider's entry — and any field this callback does not manage — is
   * preserved verbatim.
   */
  modify(
    providerId: string,
    fn: (current: CredentialEntry | undefined) => Promise<CredentialMutation>,
  ): Promise<CredentialEntry | undefined>;
  /**
   * Cross-process exclusive section under the same locks (refresh
   * serialization). Optional: adapters without a file lock (host-injected
   * CredentialStore wrappers) omit it and the broker falls back to in-process
   * dedup plus freshness-guarded, conditionally-applied writes.
   */
  withExclusive?<T>(fn: (store: ExclusiveStore) => Promise<T>): Promise<T>;
};

// ── shared file helpers ─────────────────────────────────────────────────────

function ensureDirSecure(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch {}
}

/**
 * Atomic JSON write against the REAL target file (tmp + fsync + chmod 0600 +
 * rename inside the real file's directory). `rename` may replace a regular
 * file — it must never be pointed at a symlink path, which is why callers
 * resolve the real target first.
 */
export async function atomicWriteJson(realPath: string, data: Record<string, unknown>): Promise<void> {
  const dir = dirname(realPath);
  ensureDirSecure(dir);
  const tmp = join(dir, `.${randomUUID()}.tmp`);
  const content = `${JSON.stringify(data, null, 2)}\n`;
  let fd: import("node:fs/promises").FileHandle | undefined;
  try {
    fd = await open(tmp, "w", 0o600);
    await fd.writeFile(content, "utf8");
    await fd.sync();
    await fd.chmod(0o600);
    await fd.close();
    fd = undefined;
    await rename(tmp, realPath);
    try { chmodSync(realPath, 0o600); } catch {}
    // fsync dir for durability (best-effort)
    try {
      const dirFd = await open(dir, "r");
      try { await dirFd.sync(); } finally { await dirFd.close(); }
    } catch {}
  } finally {
    if (fd) try { await fd.close(); } catch {}
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(tmp).catch(() => {});
    } catch {}
  }
}

export async function readAuthJson(path: string): Promise<Record<string, unknown>> {
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    // Missing or corrupt file -> treat as empty; merges only touch our key.
    return {};
  }
}

// ── default adapter: file store with the shared proper-lockfile lock ───────

export type FileCredentialStoreOptions = {
  authPath: string;
  lock?: LockOptions;
};

/** Reentrancy guard: a withExclusive section may nest (broker compose helpers). */
const exclusiveContext = new AsyncLocalStorage<{ real: string; store: ExclusiveStore }>();

export function createFileCredentialStoreAdapter(opts: FileCredentialStoreOptions): CredentialStoreAdapter {
  const lockOpts = opts.lock ?? {};
  let target: { asGiven: string; real: string } | undefined;
  const resolve = async (): Promise<{ asGiven: string; real: string }> => {
    if (!target) target = await resolveCredentialTarget(opts.authPath);
    return target;
  };

  const unlockedRead = async (providerId: string): Promise<CredentialEntry | undefined> => {
    const { asGiven, real } = await resolve();
    // Read through the as-given path first (matches what the holder sees via
    // their project link); fall back to the real file. Both resolve to the same
    // bytes when the link is healthy.
    const first = await readAuthJson(asGiven);
    const entry = first[providerId] ?? (await readAuthJson(real))[providerId];
    return entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as CredentialEntry) : undefined;
  };

  const lockedStoreFor = (): ExclusiveStore => ({
    async read(providerId) {
      const { real } = await resolve();
      const entry = (await readAuthJson(real))[providerId];
      return entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as CredentialEntry) : undefined;
    },
    async write(providerId, value) {
      const { real } = await resolve();
      const data = await readAuthJson(real);
      data[providerId] = value;
      await atomicWriteJson(real, data);
    },
    async remove(providerId) {
      const { real } = await resolve();
      const data = await readAuthJson(real);
      if (!(providerId in data)) return;
      delete data[providerId];
      await atomicWriteJson(real, data);
    },
  });

  const applyMutation = async (
    store: ExclusiveStore,
    providerId: string,
    fn: (current: CredentialEntry | undefined) => Promise<CredentialMutation>,
  ): Promise<CredentialEntry | undefined> => {
    const current = await store.read(providerId);
    const mutation = await fn(current);
    if (mutation.op === "noop") return current;
    if (mutation.op === "delete") {
      await store.remove(providerId);
      return undefined;
    }
    await store.write(providerId, mutation.value);
    return mutation.value;
  };

  return {
    read: unlockedRead,
    async modify(providerId, fn) {
      return withExclusiveFile((store) => applyMutation(store, providerId, fn));
    },
    withExclusive: withExclusiveFile,
  };

  async function withExclusiveFile<T>(fn: (store: ExclusiveStore) => Promise<T>): Promise<T> {
    const { asGiven, real } = await resolve();
    // Nested section (same async chain): reuse the already-held lock+store.
    const ctx = exclusiveContext.getStore();
    if (ctx && ctx.real === real) return fn(ctx.store);
    ensureDirSecure(dirname(real));
    const locks = await acquireAuthStoreLocks({ asGiven, real }, lockOpts);
    const store = lockedStoreFor();
    try {
      locks.handles.forEach((h) => h.assertValid());
      return await exclusiveContext.run({ real, store }, fn, store);
    } finally {
      await locks.release().catch(() => {});
    }
  }
}

// ── host-injected CredentialStore (pi AuthStorage shape) wrapper ───────────

type MinimalCredentialStore = {
  read(providerId: string): Promise<unknown>;
  modify(
    providerId: string,
    fn: (current: unknown) => Promise<unknown>,
  ): Promise<unknown>;
  delete(providerId: string): Promise<void>;
};

/**
 * Wrap a host-owned CredentialStore (pi `AuthStorage`: read/modify/delete).
 * ALL broker mutations go through the injected store, so the host's own lock
 * implementation (FileAuthStorageBackend + proper-lockfile) is the single
 * mutex. Pi's `modify` treats a `undefined` return as "no change", so deletes
 * are routed to `store.delete`.
 */
export function createCredentialStoreAdapterFromStore(store: MinimalCredentialStore): CredentialStoreAdapter {
  const asEntry = (v: unknown): CredentialEntry | undefined =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as CredentialEntry) : undefined;
  return {
    async read(providerId) {
      return asEntry(await store.read(providerId));
    },
    async modify(providerId, fn) {
      // Pi's modify re-invokes fn with the current value under ITS lock, which
      // gives the locked RMW; deletes fall back to store.delete after the
      // callback confirms from the locked read that the entry should go.
      let pendingDelete = false;
      const result = await store.modify(providerId, async (current) => {
        const mutation = await fn(asEntry(current));
        if (mutation.op === "noop") return current; // rewrite-as-is = no semantic change
        if (mutation.op === "delete") {
          pendingDelete = true;
          return current; // cannot delete through modify; handled below
        }
        return mutation.value;
      });
      if (pendingDelete) {
        await store.delete(providerId);
        return undefined;
      }
      return asEntry(result);
    },
    // No file lock of our own: the injected store serializes each modify, but
    // long refresh sections are NOT cross-process serialized; the broker's
    // freshness guards + conditional invalid_grant clear keep that safe.
  };
}
