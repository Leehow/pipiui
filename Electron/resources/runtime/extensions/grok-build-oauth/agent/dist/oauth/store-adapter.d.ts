import { type LockOptions } from "./lock.js";
/** One provider's raw auth.json entry (shape owned by the credential store). */
export type CredentialEntry = Record<string, unknown>;
/** What a modify callback wants to do with the provider's entry. */
export type CredentialMutation = {
    op: "set";
    value: CredentialEntry;
} | {
    op: "delete";
} | {
    op: "noop";
};
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
    modify(providerId: string, fn: (current: CredentialEntry | undefined) => Promise<CredentialMutation>): Promise<CredentialEntry | undefined>;
    /**
     * Cross-process exclusive section under the same locks (refresh
     * serialization). Optional: adapters without a file lock (host-injected
     * CredentialStore wrappers) omit it and the broker falls back to in-process
     * dedup plus freshness-guarded, conditionally-applied writes.
     */
    withExclusive?<T>(fn: (store: ExclusiveStore) => Promise<T>): Promise<T>;
};
/**
 * Atomic JSON write against the REAL target file (tmp + fsync + chmod 0600 +
 * rename inside the real file's directory). `rename` may replace a regular
 * file — it must never be pointed at a symlink path, which is why callers
 * resolve the real target first.
 */
export declare function atomicWriteJson(realPath: string, data: Record<string, unknown>): Promise<void>;
export declare function readAuthJson(path: string): Promise<Record<string, unknown>>;
export type FileCredentialStoreOptions = {
    authPath: string;
    lock?: LockOptions;
};
export declare function createFileCredentialStoreAdapter(opts: FileCredentialStoreOptions): CredentialStoreAdapter;
type MinimalCredentialStore = {
    read(providerId: string): Promise<unknown>;
    modify(providerId: string, fn: (current: unknown) => Promise<unknown>): Promise<unknown>;
    delete(providerId: string): Promise<void>;
};
/**
 * Wrap a host-owned CredentialStore (pi `AuthStorage`: read/modify/delete).
 * ALL broker mutations go through the injected store, so the host's own lock
 * implementation (FileAuthStorageBackend + proper-lockfile) is the single
 * mutex. Pi's `modify` treats a `undefined` return as "no change", so deletes
 * are routed to `store.delete`.
 */
export declare function createCredentialStoreAdapterFromStore(store: MinimalCredentialStore): CredentialStoreAdapter;
export {};
