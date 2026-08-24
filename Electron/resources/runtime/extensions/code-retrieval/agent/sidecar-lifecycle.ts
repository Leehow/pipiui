import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sidecarJsonPath, sidecarLockPath, retrievalHome } from "./paths.js";
import type { SidecarConnection, SidecarSnapshot } from "./types.js";

const DEFAULT_IDLE_MS = 60_000;
/** Conservative minute-level lease so a crashed client cannot pin the sidecar forever. */
const DEFAULT_SESSION_TTL_MS = 300_000;
const SPAWN_WAIT_MS = 4000;
const PING_TIMEOUT_MS = 400;

export type AttachOptions = {
  projectRoot: string;
  sessionId: string;
  idleMs?: number;
  spawn?: boolean;
};

export function defaultIdleMs(): number {
  const raw = process.env.PIPIUI_CODE_RETRIEVAL_IDLE_MS;
  const n = raw ? Number(raw) : DEFAULT_IDLE_MS;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_IDLE_MS;
}

export function defaultSessionTtlMs(): number {
  const raw = process.env.PIPIUI_CODE_RETRIEVAL_SESSION_TTL_MS;
  const n = raw ? Number(raw) : DEFAULT_SESSION_TTL_MS;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SESSION_TTL_MS;
}

export function defaultHeartbeatMs(): number {
  const raw = process.env.PIPIUI_CODE_RETRIEVAL_HEARTBEAT_MS;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return Math.max(50, Math.floor(defaultSessionTtlMs() / 3));
}

export type HeartbeatHandle = { stop: () => void };

/** Unref'd interval that renews the session lease. Failures never throw or stick. */
export function startSidecarHeartbeat(options: {
  projectRoot: string;
  sessionId: string;
  intervalMs?: number;
  onMissing?: () => void;
}): HeartbeatHandle {
  const intervalMs = options.intervalMs ?? defaultHeartbeatMs();
  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  };
  const timer = setInterval(() => {
    if (stopped) return;
    void heartbeatSidecarOutcome(options.projectRoot, options.sessionId)
      .then((outcome) => {
        if (stopped) return;
        // Unknown/detached session: stop. Do not spin. Runtime may re-attach on next ensure.
        if (outcome.kind === "missing") {
          stop();
          options.onMissing?.();
        }
      })
      .catch(() => {
        // transient: next tick retries; search path reconnects/degrades on its own
      });
  }, intervalMs);
  timer.unref();
  return { stop };
}

export async function readSidecarSnapshot(projectRoot: string): Promise<SidecarSnapshot | undefined> {
  try {
    const raw = JSON.parse(await readFile(sidecarJsonPath(projectRoot), "utf8")) as Partial<SidecarSnapshot>;
    if (typeof raw.pid === "number" && typeof raw.port === "number" && typeof raw.token === "string") {
      return { pid: raw.pid, port: raw.port, token: raw.token, startedAt: raw.startedAt };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function pidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function pingSidecar(snapshot: SidecarSnapshot, timeoutMs = PING_TIMEOUT_MS): Promise<SidecarConnection | undefined> {
  if (!pidAlive(snapshot.pid)) return undefined;
  try {
    const resp = await sidecarRequest(snapshot, "GET", "/health", undefined, timeoutMs);
    if (!resp || resp.body.ok !== true) return undefined;
    return {
      ...snapshot,
      refcount: typeof resp.body.refcount === "number" ? resp.body.refcount : undefined,
      ready: resp.body.ready !== false,
    };
  } catch {
    return undefined;
  }
}

export async function attachSidecar(options: AttachOptions): Promise<SidecarConnection | undefined> {
  const existing = await readSidecarSnapshot(options.projectRoot);
  if (existing) {
    const live = await pingSidecar(existing);
    if (live) {
      // Health-only is not a lease. ensure() success === attach success.
      return postAttach(live, options.sessionId);
    }
  }
  if (options.spawn === false) return undefined;

  const lock = await tryAcquireLock(options.projectRoot);
  if (!lock) {
    // Another writer holds the lock — read the old snapshot; do not start a second writer.
    const raced = await waitForSnapshot(options.projectRoot, 800);
    if (raced) {
      const live = await pingSidecar(raced);
      if (live) return postAttach(live, options.sessionId);
    }
    return undefined;
  }

  try {
    const again = await readSidecarSnapshot(options.projectRoot);
    if (again) {
      const live = await pingSidecar(again);
      if (live) return postAttach(live, options.sessionId);
    }
    const spawned = await spawnSidecar(options.projectRoot, options.idleMs ?? defaultIdleMs());
    if (!spawned) return undefined;
    return postAttach(spawned, options.sessionId);
  } finally {
    await lock.release();
  }
}

export async function detachSidecar(projectRoot: string, sessionId: string): Promise<number | undefined> {
  const snapshot = await readSidecarSnapshot(projectRoot);
  if (!snapshot) return undefined;
  const live = await pingSidecar(snapshot);
  if (!live) return undefined;
  try {
    const resp = await sidecarRequest(live, "POST", "/detach", { sessionId });
    return typeof resp?.body.refcount === "number" ? resp.body.refcount : undefined;
  } catch {
    return undefined;
  }
}

export type HeartbeatOutcome =
  | { kind: "renewed"; refcount?: number }
  | { kind: "missing" }
  | { kind: "error" };

export async function heartbeatSidecarOutcome(
  projectRoot: string,
  sessionId: string,
): Promise<HeartbeatOutcome> {
  const snapshot = await readSidecarSnapshot(projectRoot);
  if (!snapshot) return { kind: "error" };
  try {
    const resp = await sidecarRequest(snapshot, "POST", "/heartbeat", { sessionId });
    if (!resp) return { kind: "error" };
    if (resp.status === 404) return { kind: "missing" };
    if (resp.body.ok !== true) return { kind: "error" };
    return {
      kind: "renewed",
      refcount: typeof resp.body.refcount === "number" ? resp.body.refcount : undefined,
    };
  } catch {
    return { kind: "error" };
  }
}

export async function heartbeatSidecar(projectRoot: string, sessionId: string): Promise<number | undefined> {
  const outcome = await heartbeatSidecarOutcome(projectRoot, sessionId);
  return outcome.kind === "renewed" ? outcome.refcount : undefined;
}

export async function sidecarSearch(
  conn: SidecarConnection,
  args: { query: string; path?: string; glob?: string; topK?: number; excludeGlobs?: string[] },
): Promise<{ hits: unknown[]; degraded: boolean } | undefined> {
  try {
    const resp = await sidecarRequest(conn, "POST", "/search", args, 8000);
    if (!resp || resp.body.ok !== true) return undefined;
    return {
      hits: Array.isArray(resp.body.hits) ? resp.body.hits : [],
      degraded: resp.body.degraded === true,
    };
  } catch {
    return undefined;
  }
}

async function postAttach(conn: SidecarConnection, sessionId: string): Promise<SidecarConnection | undefined> {
  try {
    const resp = await sidecarRequest(conn, "POST", "/attach", { sessionId });
    if (!resp || resp.body.ok !== true) return undefined;
    return {
      ...conn,
      refcount: typeof resp.body.refcount === "number" ? resp.body.refcount : conn.refcount,
    };
  } catch {
    return undefined;
  }
}

async function sidecarRequest(
  snapshot: SidecarSnapshot,
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = 2000,
): Promise<{ status: number; body: Record<string, unknown> } | undefined> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${snapshot.port}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${snapshot.token}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await res.text();
    const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    return { status: res.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

async function waitForSnapshot(projectRoot: string, budgetMs: number): Promise<SidecarSnapshot | undefined> {
  const start = Date.now();
  while (Date.now() - start < budgetMs) {
    const snap = await readSidecarSnapshot(projectRoot);
    if (snap) return snap;
    await sleep(50);
  }
  return undefined;
}

function resolveTantivyBinary(): string | undefined {
  const override = process.env.PIPIUI_CODE_RETRIEVAL_SIDECAR?.trim();
  if (override) return existsSync(override) ? override : undefined;
  if (process.env.PIPIUI_CODE_RETRIEVAL_FORCE_RG === "1") return undefined;
  if (process.platform !== "darwin" || process.arch !== "arm64") return undefined;
  const dir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(dir, "sidecar", "bin", "darwin-arm64", "tantivy-sidecar"),
    join(dir, "..", "sidecar", "bin", "darwin-arm64", "tantivy-sidecar"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function resolveSidecarScript(): string | undefined {
  const dir = dirname(fileURLToPath(import.meta.url));
  for (const name of ["query-sidecar.js", "query-sidecar.ts"]) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

async function spawnSidecar(projectRoot: string, idleMs: number): Promise<SidecarConnection | undefined> {
  const rustBin = resolveTantivyBinary();
  if (rustBin) {
    const spawned = await spawnProcess(rustBin, [], projectRoot, idleMs);
    if (spawned) return spawned;
  }
  // D8: missing / failed Rust binary falls back to the Node rg sidecar.
  const script = resolveSidecarScript();
  if (!script) return undefined;
  return spawnProcess(process.execPath, [script], projectRoot, idleMs);
}

async function spawnProcess(
  command: string,
  args: string[],
  projectRoot: string,
  idleMs: number,
): Promise<SidecarConnection | undefined> {
  await mkdir(retrievalHome(projectRoot), { recursive: true });
  const child: ChildProcess = spawn(command, args, {
    env: {
      ...process.env,
      PIPIUI_CODE_RETRIEVAL_PROJECT: projectRoot,
      PIPIUI_CODE_RETRIEVAL_IDLE_MS: String(idleMs),
      PIPIUI_CODE_RETRIEVAL_SESSION_TTL_MS: String(defaultSessionTtlMs()),
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  child.unref();

  const deadline = Date.now() + SPAWN_WAIT_MS;
  while (Date.now() < deadline) {
    const snap = await readSidecarSnapshot(projectRoot);
    if (snap && pidAlive(snap.pid)) {
      const live = await pingSidecar(snap);
      if (live) return live;
    }
    if (child.exitCode !== null) return undefined;
    await sleep(40);
  }
  // Process still alive but snapshot never appeared — do not start a second writer.
  if (child.exitCode === null && child.pid && pidAlive(child.pid)) return undefined;
  return undefined;
}

type LockHandle = { release: () => Promise<void> };

async function tryAcquireLock(projectRoot: string): Promise<LockHandle | undefined> {
  const lockPath = sidecarLockPath(projectRoot);
  await mkdir(dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await writeFile(lockPath, String(process.pid), { flag: "wx" });
      return {
        release: async () => {
          try {
            await unlink(lockPath);
          } catch {
            // ignore
          }
        },
      };
    } catch {
      try {
        const holder = Number((await readFile(lockPath, "utf8")).trim());
        if (!holder || !pidAlive(holder)) {
          await unlink(lockPath);
          continue;
        }
      } catch {
        return undefined;
      }
      return undefined;
    }
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
