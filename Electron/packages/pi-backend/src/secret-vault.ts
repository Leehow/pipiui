import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";

export const VAULT_FILE = "secret-vault.json";
export const VAULT_KEY_FILE = "secret-vault.key";
export const MIN_SECRET_LEN = 8;
export const MEMORY_VAULT_MESSAGE = "密钥仅保存在当前 App 主进程内存中，退出 App 后清除。";

export type VaultDiagKind =
  | "available"
  | "missing-packages"
  | "session-bus-unavailable"
  | "secret-service-unreachable"
  | "keyring-locked"
  | "no-graphical-session"
  | "encryption-unavailable";

export type VaultDiagnosis = {
  available: boolean;
  kind: VaultDiagKind;
  message: string;
  installHint?: string;
  retryable: boolean;
  platform: NodeJS.Platform;
};

export function posixFileSecurity(): boolean {
  return process.platform !== "win32";
}

export function ensureSecureDirectory(dir: string): void {
  mkdirSync(dir, { recursive: true });
  if (posixFileSecurity()) {
    try { chmodSync(dir, 0o700); } catch { /* best-effort on exotic filesystems */ }
  }
}

export function memoryVaultDiagnosis(platform: NodeJS.Platform = process.platform): VaultDiagnosis {
  return {
    available: true,
    kind: "available",
    message: MEMORY_VAULT_MESSAGE,
    retryable: false,
    platform,
  };
}

/** @deprecated Memory vault is always available; kept for leftover diagnosis callers. */
export function vaultDiagnosisMessage(_kind: VaultDiagKind = "available"): string {
  return MEMORY_VAULT_MESSAGE;
}

/** @deprecated Memory vault is always available; kept for leftover diagnosis callers. */
export function vaultDiagnosisFor(_kind: VaultDiagKind = "available", platform: NodeJS.Platform = process.platform): VaultDiagnosis {
  return memoryVaultDiagnosis(platform);
}

export type VaultSecretMeta = {
  id: string;
  name: string;
  envName: string;
  createdAt: string;
};

export type VaultMount = { secretId: string; envName: string };

export type VaultSecretRecord = VaultSecretMeta & {
  value: string;
};

export type VaultDocument = {
  version: 1;
  revision: number;
  secrets: VaultSecretRecord[];
  mounts: Record<string, VaultMount[]>;
};

const stores = new Map<string, VaultDocument>();
const writeQueues = new Map<string, Promise<unknown>>();

export function resetInMemoryVault(dir?: string): void {
  if (dir) stores.delete(dir);
  else stores.clear();
}

export function vaultPaths(dir: string): { file: string; key: string } {
  return { file: join(dir, VAULT_FILE), key: join(dir, VAULT_KEY_FILE) };
}

export function isSafeEnvName(name: string): boolean {
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(name);
}

function emptyVault(): VaultDocument {
  return { version: 1, revision: 0, secrets: [], mounts: {} };
}

function vaultOf(dir: string): VaultDocument {
  const existing = stores.get(dir);
  if (existing) return existing;
  const created = emptyVault();
  stores.set(dir, created);
  return created;
}

export function loadVault(dir: string): VaultDocument {
  const vault = vaultOf(dir);
  return {
    version: 1,
    revision: vault.revision,
    secrets: vault.secrets.map((secret) => ({ ...secret })),
    mounts: Object.fromEntries(
      Object.entries(vault.mounts).map(([sessionId, mounts]) => [sessionId, mounts.map((mount) => ({ ...mount }))]),
    ),
  };
}

export function atomicWriteFile(path: string, data: string | Buffer): void {
  const dir = dirname(path);
  ensureSecureDirectory(dir);
  const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | undefined;
  try {
    fd = openSync(tmp, "w", 0o600);
    if (typeof data === "string") writeSync(fd, data);
    else writeSync(fd, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmp, path);
    if (posixFileSecurity()) {
      try { chmodSync(path, 0o600); } catch { /* best-effort */ }
      try {
        const dirFd = openSync(dir, "r");
        try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
      } catch { /* directory fsync is best-effort */ }
    }
  } catch (error) {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* ignore */ }
    }
    try { unlinkSync(tmp); } catch { /* leftover tmp must not remain */ }
    throw error;
  }
}

function serializeDir<T>(dir: string, work: () => T): Promise<T> {
  const previous = writeQueues.get(dir) ?? Promise.resolve();
  const next = previous.then(work, work);
  writeQueues.set(dir, next.then(() => undefined, () => undefined));
  return next;
}

export function saveVault(dir: string, vault: VaultDocument): void {
  stores.set(dir, {
    version: 1,
    revision: vault.revision,
    secrets: vault.secrets.map((secret) => ({ ...secret })),
    mounts: Object.fromEntries(
      Object.entries(vault.mounts).map(([sessionId, mounts]) => [sessionId, mounts.map((mount) => ({ ...mount }))]),
    ),
  });
}

async function mutateVault<T>(dir: string, mutate: (vault: VaultDocument) => T): Promise<T> {
  return serializeDir(dir, () => {
    const vault = vaultOf(dir);
    const result = mutate(vault);
    vault.revision += 1;
    return result;
  });
}

export async function putSecret(
  dir: string,
  input: { name: string; envName: string; value: string; id?: string },
): Promise<VaultSecretMeta> {
  const name = input.name.trim();
  const envName = input.envName.trim().toUpperCase();
  if (!name) throw new Error("name is required");
  if (!isSafeEnvName(envName)) throw new Error("envName must match [A-Z][A-Z0-9_]{0,63}");
  if (input.value.length < MIN_SECRET_LEN) throw new Error(`value must be at least ${MIN_SECRET_LEN} characters`);
  return mutateVault(dir, (vault) => {
    const existing = input.id
      ? vault.secrets.find((s) => s.id === input.id)
      : vault.secrets.find((s) => s.name === name || s.envName === envName);
    const id = existing?.id ?? input.id ?? randomUUID();
    const record: VaultSecretRecord = {
      id,
      name,
      envName,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      value: input.value,
    };
    vault.secrets = [...vault.secrets.filter((s) => s.id !== id && s.envName !== envName), record];
    return { id: record.id, name: record.name, envName: record.envName, createdAt: record.createdAt };
  });
}

export function listSecretMeta(dir: string): VaultSecretMeta[] {
  return loadVault(dir).secrets.map(({ id, name, envName, createdAt }) => ({ id, name, envName, createdAt }));
}

export async function mountSecret(dir: string, sessionId: string, secretIdOrName: string, envName?: string): Promise<VaultMount> {
  return mutateVault(dir, (vault) => {
    const secret = vault.secrets.find((s) => s.id === secretIdOrName || s.name === secretIdOrName || s.envName === secretIdOrName);
    if (!secret) throw new Error("secret not found");
    const bind: VaultMount = { secretId: secret.id, envName: (envName ?? secret.envName).toUpperCase() };
    if (!isSafeEnvName(bind.envName)) throw new Error("envName must match [A-Z][A-Z0-9_]{0,63}");
    const current = vault.mounts[sessionId] ?? [];
    vault.mounts[sessionId] = [...current.filter((m) => m.secretId !== secret.id && m.envName !== bind.envName), bind];
    return bind;
  });
}

export async function unmountSecret(dir: string, sessionId: string, secretIdOrName: string): Promise<boolean> {
  return mutateVault(dir, (vault) => {
    const secret = vault.secrets.find((s) => s.id === secretIdOrName || s.name === secretIdOrName || s.envName === secretIdOrName);
    const before = vault.mounts[sessionId] ?? [];
    const next = before.filter((m) => m.secretId !== (secret?.id ?? secretIdOrName) && m.envName !== secretIdOrName);
    vault.mounts[sessionId] = next;
    return next.length !== before.length;
  });
}

export async function deleteSecret(dir: string, secretIdOrName: string): Promise<boolean> {
  return mutateVault(dir, (vault) => {
    const secret = vault.secrets.find((s) => s.id === secretIdOrName || s.name === secretIdOrName || s.envName === secretIdOrName);
    if (!secret) return false;
    vault.secrets = vault.secrets.filter((s) => s.id !== secret.id);
    for (const [sid, mounts] of Object.entries(vault.mounts)) {
      vault.mounts[sid] = mounts.filter((m) => m.secretId !== secret.id);
    }
    return true;
  });
}

export function listSessionMounts(dir: string, sessionId: string): Array<VaultMount & { name: string }> {
  const vault = loadVault(dir);
  return (vault.mounts[sessionId] ?? []).flatMap((m) => {
    const secret = vault.secrets.find((s) => s.id === m.secretId);
    return secret ? [{ ...m, name: secret.name }] : [];
  });
}

export type RevealedSecret = { id: string; name: string; envName: string; value: string };

export function revealMountedSecrets(dir: string, sessionId: string): RevealedSecret[] {
  const vault = loadVault(dir);
  return (vault.mounts[sessionId] ?? []).flatMap((m) => {
    const secret = vault.secrets.find((s) => s.id === m.secretId);
    if (!secret) return [];
    return [{ id: secret.id, name: secret.name, envName: m.envName, value: secret.value }];
  });
}

export function revealRedactionSecrets(dir: string, sessionId?: string): RevealedSecret[] {
  const vault = loadVault(dir);
  const byKey = new Map<string, RevealedSecret>();
  for (const secret of vault.secrets) {
    byKey.set(`${secret.id}:${secret.envName}`, {
      id: secret.id,
      name: secret.name,
      envName: secret.envName,
      value: secret.value,
    });
  }
  if (sessionId) {
    for (const mount of vault.mounts[sessionId] ?? []) {
      const secret = vault.secrets.find((item) => item.id === mount.secretId);
      if (!secret) continue;
      byKey.set(`${secret.id}:${mount.envName}`, {
        id: secret.id,
        name: secret.name,
        envName: mount.envName,
        value: secret.value,
      });
    }
  }
  return [...byKey.values()];
}

export function workerEnvFromVault(dir: string, sessionId: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const secret of revealMountedSecrets(dir, sessionId)) env[secret.envName] = secret.value;
  return env;
}

export function applySessionMountsToMainEnv(
  parent: NodeJS.ProcessEnv,
  mounts: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(parent)) {
    if (value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(mounts)) env[key] = value;
  delete env.PIPIUI_VAULT_DEK;
  delete env.PIPIUI_SECRET_VAULT_DEK;
  return env;
}

/** Worker/subagent env: same mounts, but never inherit a DEK. */
export function applySessionMountsToWorkerEnv(
  parent: NodeJS.ProcessEnv,
  mounts: Record<string, string>,
): Record<string, string> {
  const env = applySessionMountsToMainEnv(parent, mounts);
  delete env.PIPIUI_VAULT_DEK;
  delete env.PIPIUI_SECRET_VAULT_DEK;
  return env;
}

export function secretPlaceholder(secret: { envName: string }): string {
  return `{{secret:${secret.envName}}}`;
}

export function redactText(text: string, secrets: readonly RevealedSecret[]): string {
  if (!text || secrets.length === 0) return text;
  const ordered = [...secrets].sort((a, b) => b.value.length - a.value.length);
  let out = text;
  for (const secret of ordered) {
    if (secret.value.length < MIN_SECRET_LEN) continue;
    if (!out.includes(secret.value)) continue;
    out = out.split(secret.value).join(secretPlaceholder(secret));
  }
  return out;
}

export function redactJsonValue(value: unknown, secrets: readonly RevealedSecret[]): unknown {
  if (typeof value === "string") return redactText(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactJsonValue(item, secrets));
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) next[key] = redactJsonValue(item, secrets);
    return next;
  }
  return value;
}

function heldSecretPrefixLength(text: string, secrets: readonly RevealedSecret[]): number {
  let held = 0;
  for (const secret of secrets) {
    const value = secret.value;
    if (!value || value.length < MIN_SECRET_LEN) continue;
    const max = Math.min(text.length, value.length - 1);
    for (let n = max; n > held; n--) {
      if (text.endsWith(value.slice(0, n))) {
        held = n;
        break;
      }
    }
  }
  return held;
}

export class StreamRedactor {
  private buffer = "";

  constructor(private readonly secrets: readonly RevealedSecret[]) {}

  push(delta: string): string {
    if (!delta) return "";
    this.buffer = redactText(this.buffer + delta, this.secrets);
    const held = heldSecretPrefixLength(this.buffer, this.secrets);
    const emit = this.buffer.slice(0, this.buffer.length - held);
    this.buffer = this.buffer.slice(this.buffer.length - held);
    return emit;
  }

  flush(): string {
    const out = redactText(this.buffer, this.secrets);
    this.buffer = "";
    return out;
  }
}

export type ExclusiveSessionWork = <T>(work: () => Promise<T>) => Promise<T>;

export function createSessionWriteBarrier(): ExclusiveSessionWork {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>) => {
    const run = tail.then(work, work);
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
}

export type SessionRedactionDecision = "rewritten" | "deferred" | "skipped";

export function createSessionRedactionGate(hooks: {
  hasWork(sessionId: string): boolean;
  canRewrite(sessionId: string): boolean;
  confirmWriterIdle(sessionId: string): Promise<boolean>;
  rewrite(sessionId: string): Promise<void>;
}): {
  request(sessionId: string): void;
  flush(sessionId: string): Promise<SessionRedactionDecision>;
  hasPending(sessionId: string): boolean;
} {
  const pending = new Set<string>();
  const inflight = new Set<string>();
  const quietRetry = new Set<string>();

  const scheduleQuietRetry = (sessionId: string) => {
    if (quietRetry.has(sessionId) || inflight.has(sessionId)) return;
    quietRetry.add(sessionId);
    queueMicrotask(() => {
      quietRetry.delete(sessionId);
      void flush(sessionId);
    });
  };

  const flush = async (sessionId: string): Promise<SessionRedactionDecision> => {
    if (!pending.has(sessionId)) return "skipped";
    if (inflight.has(sessionId)) return "deferred";
    if (!hooks.hasWork(sessionId)) {
      pending.delete(sessionId);
      return "skipped";
    }
    if (!hooks.canRewrite(sessionId)) return "deferred";
    inflight.add(sessionId);
    try {
      if (!await hooks.confirmWriterIdle(sessionId)) {
        scheduleQuietRetry(sessionId);
        return "deferred";
      }
      await hooks.rewrite(sessionId);
      pending.delete(sessionId);
      return "rewritten";
    } finally {
      inflight.delete(sessionId);
    }
  };

  return {
    request(sessionId: string) { pending.add(sessionId); },
    flush,
    hasPending: (sessionId: string) => pending.has(sessionId),
  };
}

export function createSessionEnvRefreshGate(hooks: {
  canRefresh(sessionId: string): boolean;
  stopWriter(sessionId: string): Promise<boolean>;
}) {
  return createSessionRedactionGate({
    hasWork: () => true,
    canRewrite: hooks.canRefresh,
    confirmWriterIdle: hooks.stopWriter,
    rewrite: async () => undefined,
  });
}

export async function redactSessionJsonl(
  path: string,
  secrets: readonly RevealedSecret[],
  options: { exclusive?: ExclusiveSessionWork } = {},
): Promise<{ changed: boolean }> {
  const rewrite = async (): Promise<{ changed: boolean }> => {
    if (!existsSync(path) || secrets.length === 0) return { changed: false };
    const raw = readFileSync(path, "utf8");
    const redacted = redactText(raw, secrets);
    if (redacted === raw) return { changed: false };
    atomicWriteFile(path, redacted);
    return { changed: true };
  };
  return options.exclusive ? options.exclusive(rewrite) : rewrite();
}

export function vaultDirFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dir = env.PIPIUI_SECRET_VAULT_DIR;
  return dir && dir.length > 0 ? dir : undefined;
}

export function sessionIdFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env.PIPIUI_SESSION_ID || env.PIPIUI_SESSION_KEY || "default";
}
