import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

import { projectPiAgentDir } from "./project-pi-home.js";
import { withElectronRunAsNode } from "./spawn-assembly.js";

export const HEADROOM_EXTENSION_ID = "pipiui-headroom";
export const HEADROOM_ENGINE_VERSION = "0.37.0";
export const HEADROOM_UV_VERSION = "0.12.5";
export const HEADROOM_MANAGED_SETTINGS = {
  baseUrl: "ext.pipiui-headroom.baseUrl",
  managed: "ext.pipiui-headroom.managed",
  state: "ext.pipiui-headroom.managedState",
  statePath: "ext.pipiui-headroom.managedStatePath",
  engineVersion: "ext.pipiui-headroom.managedEngineVersion",
} as const;

export type ManagedHeadroomState = "installing" | "starting" | "ready" | "failed" | "stopped";

export type ManagedHeadroomSnapshot = {
  schemaVersion: 1;
  state: ManagedHeadroomState;
  engineVersion: string;
  baseUrl: string;
  statePath: string;
  updatedAt: string;
  pid?: number;
  error?: string;
};

export interface HeadroomManagedRuntimeLike {
  settingsForProject(projectRoot: string): Promise<Record<string, unknown>>;
  prepare(projectRoot: string): Promise<ManagedHeadroomSnapshot>;
  stopProject(projectRoot: string): Promise<void>;
  stopAll(): Promise<void>;
  close(): Promise<void>;
}

export type PortReservation = {
  port: number;
  close(): Promise<void>;
};

export type ProcessResult = { status: number; detail: string };

export type ManagedHeadroomOps = {
  reservePort(): Promise<PortReservation>;
  ensureEngine(options: EnsureManagedHeadroomEngineOptions): Promise<string>;
  spawnProxy(input: SpawnManagedHeadroomInput): ChildProcessWithoutNullStreams;
  waitUntilReady(baseUrl: string, signal: AbortSignal): Promise<boolean>;
};

export type HeadroomManagedRuntimeOptions = {
  /** Electron App-profile `pi-agent`, never a project Pi home. */
  agentDir: string;
  /** Packaged Electron supplies its bundled Node helper here. */
  nodeExecutable?: string;
  env?: NodeJS.ProcessEnv;
  ops?: Partial<ManagedHeadroomOps>;
};

export type EnsureManagedHeadroomEngineOptions = {
  managedRoot: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  platform?: NodeJS.Platform;
  arch?: string;
  fetchImpl?: typeof fetch;
  run?: (command: string, args: readonly string[], options: { env: NodeJS.ProcessEnv; signal: AbortSignal }) => Promise<ProcessResult>;
};

export type SpawnManagedHeadroomInput = {
  nodeExecutable: string;
  executable: string;
  projectRoot: string;
  projectAgentDir: string;
  port: number;
  env: NodeJS.ProcessEnv;
};

type UvAsset = {
  archiveName: string;
  directoryName: string;
  url: string;
  sha256: string;
};

const UV_DARWIN_ASSETS: Readonly<Record<"arm64" | "x64", Omit<UvAsset, "url">>> = {
  arm64: {
    archiveName: "uv-aarch64-apple-darwin.tar.gz",
    directoryName: "uv-aarch64-apple-darwin",
    sha256: "5bb0e5fe008a773c3dbcb97ff79cd89e1241464fe9d2f986d52ad8f1b037bd62",
  },
  x64: {
    archiveName: "uv-x86_64-apple-darwin.tar.gz",
    directoryName: "uv-x86_64-apple-darwin",
    sha256: "b3b2137477cf96c9686ebfb71524614cec780c673fd73e59bce099aef02e70e8",
  },
};

const MAX_UV_ARCHIVE_BYTES = 64 * 1024 * 1024;
const PROCESS_DETAIL_LIMIT = 8_000;
const READY_TIMEOUT_MS = 90_000;
const READY_POLL_MS = 500;
// The inline supervisor escalates its Python child after 2s. Give that
// escalation time to finish before the host ever kills the supervisor itself.
const STOP_GRACE_MS = 4_000;

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/[\r\n]+/g, " ").trim().slice(-1_000) || "unknown error";
}

function isWithin(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function forbiddenGlobalPiHome(path: string): boolean {
  return isWithin(join(homedir(), ".pi"), path);
}

export function uvAssetFor(platform: NodeJS.Platform, arch: string): UvAsset {
  if (platform !== "darwin" || (arch !== "arm64" && arch !== "x64")) {
    throw new Error(`Headroom managed runtime does not support ${platform}/${arch}`);
  }
  const asset = UV_DARWIN_ASSETS[arch];
  return {
    ...asset,
    url: `https://github.com/astral-sh/uv/releases/download/${HEADROOM_UV_VERSION}/${asset.archiveName}`,
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveValue, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolveValue();
    }, ms);
    timer.unref?.();
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function reserveLoopbackPort(): Promise<PortReservation> {
  const server = createServer((_request, response) => {
    response.statusCode = 503;
    response.setHeader("connection", "close");
    response.end("PipiUI is preparing Headroom\n");
  });
  server.unref();
  await new Promise<void>((resolveValue, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveValue();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("unable to reserve a loopback port for Headroom");
  }
  let closed = false;
  return {
    port: address.port,
    async close() {
      if (closed) return;
      closed = true;
      await closeServer(server);
    },
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveValue) => {
    try {
      server.close(() => resolveValue());
    } catch {
      resolveValue();
    }
  });
}

export async function runManagedProcess(
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; signal: AbortSignal },
): Promise<ProcessResult> {
  return new Promise((resolveValue) => {
    if (options.signal.aborted) {
      resolveValue({ status: -1, detail: "aborted" });
      return;
    }
    const child = spawn(command, [...args], {
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let detail = "";
    const append = (chunk: unknown) => {
      detail = `${detail}${String(chunk)}`.slice(-PROCESS_DETAIL_LIMIT);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    let abortKillTimer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => {
      try { child.kill("SIGTERM"); } catch { /* already exited */ }
      abortKillTimer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* already exited */ }
      }, STOP_GRACE_MS);
      abortKillTimer.unref?.();
    };
    options.signal.addEventListener("abort", abort, { once: true });
    let settled = false;
    const finish = (status: number) => {
      if (settled) return;
      settled = true;
      options.signal.removeEventListener("abort", abort);
      if (abortKillTimer) clearTimeout(abortKillTimer);
      resolveValue({ status, detail: detail.trim().slice(-PROCESS_DETAIL_LIMIT) });
    };
    child.once("error", (error) => {
      append(error.message);
      finish(-1);
    });
    child.once("close", (status) => finish(status ?? -1));
  });
}

async function downloadManagedUv(
  managedRoot: string,
  input: {
    platform: NodeJS.Platform;
    arch: string;
    env: NodeJS.ProcessEnv;
    signal: AbortSignal;
    fetchImpl: typeof fetch;
    run: NonNullable<EnsureManagedHeadroomEngineOptions["run"]>;
  },
): Promise<string> {
  const asset = uvAssetFor(input.platform, input.arch);
  const uvVersionRoot = join(managedRoot, "uv", HEADROOM_UV_VERSION);
  const finalDirectory = join(uvVersionRoot, asset.directoryName);
  const finalExecutable = join(finalDirectory, "uv");
  try {
    await access(finalExecutable, fsConstants.X_OK);
    return finalExecutable;
  } catch {
    /* download the pinned build */
  }

  await mkdir(uvVersionRoot, { recursive: true });
  const staging = join(uvVersionRoot, `.staging-${process.pid}-${randomUUID()}`);
  const archive = join(staging, asset.archiveName);
  await mkdir(staging, { recursive: true });
  try {
    const response = await input.fetchImpl(asset.url, { redirect: "follow", signal: input.signal });
    if (!response.ok) throw new Error(`uv download failed with HTTP ${response.status}`);
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_UV_ARCHIVE_BYTES) {
      throw new Error(`uv archive is unexpectedly large (${declaredLength} bytes)`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_UV_ARCHIVE_BYTES) {
      throw new Error(`uv archive size is invalid (${bytes.length} bytes)`);
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== asset.sha256) throw new Error("uv archive checksum mismatch");
    await writeFile(archive, bytes, { mode: 0o600 });
    const extracted = await input.run("/usr/bin/tar", ["-xzf", archive, "-C", staging], {
      env: input.env,
      signal: input.signal,
    });
    if (extracted.status !== 0) throw new Error(`uv extraction failed: ${extracted.detail || `exit ${extracted.status}`}`);
    const stagedDirectory = join(staging, asset.directoryName);
    const stagedExecutable = join(stagedDirectory, "uv");
    await chmod(stagedExecutable, 0o755);
    await access(stagedExecutable, fsConstants.X_OK);
    await rm(finalDirectory, { recursive: true, force: true });
    await rename(stagedDirectory, finalDirectory);
    return finalExecutable;
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

function uvEnvironment(managedRoot: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const engineRoot = join(managedRoot, "engines", HEADROOM_ENGINE_VERSION);
  return {
    ...env,
    UV_TOOL_DIR: join(engineRoot, "tools"),
    UV_TOOL_BIN_DIR: join(engineRoot, "bin"),
    UV_PYTHON_INSTALL_DIR: join(managedRoot, "python"),
    UV_PYTHON_BIN_DIR: join(managedRoot, "python-bin"),
    UV_CACHE_DIR: join(managedRoot, "cache"),
    UV_NO_PROGRESS: "1",
  };
}

export async function ensureManagedHeadroomEngine(options: EnsureManagedHeadroomEngineOptions): Promise<string> {
  const platform = options.platform ?? process.platform;
  const architecture = options.arch ?? process.arch;
  const fetchImpl = options.fetchImpl ?? fetch;
  const run = options.run ?? runManagedProcess;
  const engineRoot = join(options.managedRoot, "engines", HEADROOM_ENGINE_VERSION);
  const executable = join(engineRoot, "bin", "headroom");
  const env = uvEnvironment(options.managedRoot, options.env);
  try {
    await access(executable, fsConstants.X_OK);
    const version = await run(executable, ["--version"], { env, signal: options.signal });
    if (version.status === 0 && new RegExp(`\\b${HEADROOM_ENGINE_VERSION.replaceAll(".", "\\.")}\\b`).test(version.detail)) {
      return executable;
    }
  } catch {
    /* install or repair below */
  }

  const uv = await downloadManagedUv(options.managedRoot, {
    platform,
    arch: architecture,
    env,
    signal: options.signal,
    fetchImpl,
    run,
  });
  await mkdir(engineRoot, { recursive: true });
  const installed = await run(uv, [
    "tool",
    "install",
    "--python",
    "3.13",
    "--managed-python",
    "--force",
    "--default-index",
    "https://pypi.org/simple",
    "--no-config",
    `headroom-ai[proxy]==${HEADROOM_ENGINE_VERSION}`,
  ], { env, signal: options.signal });
  if (installed.status !== 0) {
    throw new Error(`Headroom ${HEADROOM_ENGINE_VERSION} install failed: ${installed.detail || `exit ${installed.status}`}`);
  }
  await access(executable, fsConstants.X_OK);
  const verified = await run(executable, ["--version"], { env, signal: options.signal });
  if (verified.status !== 0 || !new RegExp(`\\b${HEADROOM_ENGINE_VERSION.replaceAll(".", "\\.")}\\b`).test(verified.detail)) {
    throw new Error(`Headroom install did not produce version ${HEADROOM_ENGINE_VERSION}`);
  }
  return executable;
}

const ISOLATED_ENV_KEYS = new Set([
  // Headroom's proxy extra installs httpx without its optional SOCKS transport.
  // Keep HTTP(S)_PROXY, but do not let an ambient SOCKS catch-all make the
  // otherwise local service fail during httpx construction.
  "ALL_PROXY",
  "all_proxy",
  "HF_HOME",
  "HUGGINGFACE_HUB_CACHE",
  "TRANSFORMERS_CACHE",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
]);

export function managedHeadroomEnvironment(
  env: NodeJS.ProcessEnv,
  projectAgentDir: string,
  port: number,
): NodeJS.ProcessEnv {
  const clean = Object.fromEntries(Object.entries(env).filter(([key, value]) =>
    value !== undefined && !key.startsWith("HEADROOM_") && !ISOLATED_ENV_KEYS.has(key),
  ));
  const root = join(projectAgentDir, "headroom");
  const cache = join(root, "cache");
  return {
    ...clean,
    HEADROOM_WORKSPACE_DIR: join(root, "workspace"),
    HEADROOM_CONFIG_DIR: join(root, "config"),
    HEADROOM_HOST: "127.0.0.1",
    HEADROOM_PORT: String(port),
    HEADROOM_WORKERS: "1",
    HEADROOM_TELEMETRY: "off",
    HEADROOM_SKIP_UPSTREAM_CHECK: "1",
    HEADROOM_NO_SUBSCRIPTION_TRACKING: "1",
    HF_HOME: join(cache, "huggingface"),
    HUGGINGFACE_HUB_CACHE: join(cache, "huggingface", "hub"),
    TRANSFORMERS_CACHE: join(cache, "huggingface", "transformers"),
    XDG_CACHE_HOME: cache,
    XDG_CONFIG_HOME: join(root, "xdg-config"),
    XDG_DATA_HOME: join(root, "xdg-data"),
    NO_COLOR: "1",
    PYTHONUNBUFFERED: "1",
  };
}

/**
 * Small Node supervisor used instead of launching Python directly. Its stdin is
 * owned by the Electron host: normal close sends SIGTERM, and a host crash
 * closes the pipe. Either event reaps the Headroom grandchild, so the managed
 * service cannot silently turn into a permanent user daemon.
 */
export const HEADROOM_SUPERVISOR_SOURCE = String.raw`
const { spawn } = require("node:child_process");
const executable = process.argv[1];
const args = process.argv.slice(2);
const child = spawn(executable, args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
let stopping = false;
let timer;
function stop() {
  if (stopping) return;
  stopping = true;
  try { child.kill("SIGTERM"); } catch {}
  timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 2000);
  timer.unref();
}
process.stdin.resume();
process.stdin.on("end", stop);
process.stdin.on("error", stop);
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
child.on("error", error => { console.error(error && error.message ? error.message : String(error)); stop(); });
child.on("exit", (code, signal) => {
  if (timer) clearTimeout(timer);
  process.stdin.destroy();
  process.exitCode = typeof code === "number" ? code : signal ? 1 : 0;
});
`;

export function spawnManagedHeadroom(input: SpawnManagedHeadroomInput): ChildProcessWithoutNullStreams {
  const env = withElectronRunAsNode({
    ...managedHeadroomEnvironment(input.env, input.projectAgentDir, input.port),
  });
  return spawn(input.nodeExecutable, [
    "-e",
    HEADROOM_SUPERVISOR_SOURCE,
    input.executable,
    "proxy",
    "--host",
    "127.0.0.1",
    "--port",
    String(input.port),
    "--workers",
    "1",
  ], {
    cwd: input.projectRoot,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export async function waitForManagedHeadroom(
  baseUrl: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (!signal.aborted && Date.now() < deadline) {
    const timeout = AbortSignal.timeout(1_500);
    try {
      const response = await fetchImpl(`${baseUrl}/readyz`, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.any([signal, timeout]),
      });
      if (response.ok) return true;
    } catch {
      if (signal.aborted) return false;
    }
    try { await sleep(READY_POLL_MS, signal); } catch { return false; }
  }
  return false;
}

type ManagedEntry = {
  projectRoot: string;
  projectAgentDir: string;
  statePath: string;
  baseUrl: string;
  port: number;
  state: ManagedHeadroomState;
  updatedAt: string;
  reservation?: PortReservation;
  child?: ChildProcessWithoutNullStreams;
  abort: AbortController;
  task?: Promise<void>;
  stopping: boolean;
  stderrTail: string;
  pid?: number;
  error?: string;
};

async function writeManagedState(entry: ManagedEntry): Promise<void> {
  await mkdir(entry.projectAgentDir, { recursive: true });
  const payload: ManagedHeadroomSnapshot = {
    schemaVersion: 1,
    state: entry.state,
    engineVersion: HEADROOM_ENGINE_VERSION,
    baseUrl: entry.baseUrl,
    statePath: entry.statePath,
    updatedAt: entry.updatedAt,
    ...(entry.pid ? { pid: entry.pid } : {}),
    ...(entry.error ? { error: entry.error } : {}),
  };
  const temporary = `${entry.statePath}.${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    await rename(temporary, entry.statePath);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function snapshot(entry: ManagedEntry): ManagedHeadroomSnapshot {
  return {
    schemaVersion: 1,
    state: entry.state,
    engineVersion: HEADROOM_ENGINE_VERSION,
    baseUrl: entry.baseUrl,
    statePath: entry.statePath,
    updatedAt: entry.updatedAt,
    ...(entry.pid ? { pid: entry.pid } : {}),
    ...(entry.error ? { error: entry.error } : {}),
  };
}

async function waitForChildExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise<void>((resolveValue) => child.once("close", () => resolveValue())),
    sleep(timeoutMs).catch(() => undefined),
  ]);
}

async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try { child.stdin.end(); } catch { /* already closed */ }
  try { child.kill("SIGTERM"); } catch { /* already exited */ }
  await waitForChildExit(child, STOP_GRACE_MS);
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill("SIGKILL"); } catch { /* already exited */ }
    await waitForChildExit(child, STOP_GRACE_MS);
  }
}

function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    signal.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")), { once: true });
  });
}

export class HeadroomManagedRuntime implements HeadroomManagedRuntimeLike {
  readonly #agentDir: string;
  readonly #managedRoot: string;
  readonly #nodeExecutable: string;
  readonly #env: NodeJS.ProcessEnv;
  readonly #ops: ManagedHeadroomOps;
  readonly #entries = new Map<string, ManagedEntry>();
  readonly #creating = new Map<string, Promise<ManagedEntry>>();
  readonly #engineAbort = new AbortController();
  #enginePromise?: Promise<string>;
  #closed = false;

  constructor(options: HeadroomManagedRuntimeOptions) {
    this.#agentDir = resolve(options.agentDir);
    this.#managedRoot = join(this.#agentDir, "managed-headroom");
    this.#nodeExecutable = options.nodeExecutable ?? process.execPath;
    this.#env = { ...(options.env ?? process.env) };
    this.#ops = {
      reservePort: options.ops?.reservePort ?? reserveLoopbackPort,
      ensureEngine: options.ops?.ensureEngine ?? ensureManagedHeadroomEngine,
      spawnProxy: options.ops?.spawnProxy ?? spawnManagedHeadroom,
      waitUntilReady: options.ops?.waitUntilReady ?? ((baseUrl, signal) => waitForManagedHeadroom(baseUrl, signal)),
    };
  }

  async settingsForProject(projectRoot: string): Promise<Record<string, unknown>> {
    const current = await this.prepare(projectRoot);
    return {
      [HEADROOM_MANAGED_SETTINGS.baseUrl]: current.baseUrl,
      [HEADROOM_MANAGED_SETTINGS.managed]: true,
      [HEADROOM_MANAGED_SETTINGS.state]: current.state,
      [HEADROOM_MANAGED_SETTINGS.statePath]: current.statePath,
      [HEADROOM_MANAGED_SETTINGS.engineVersion]: HEADROOM_ENGINE_VERSION,
    };
  }

  async prepare(projectRoot: string): Promise<ManagedHeadroomSnapshot> {
    if (this.#closed) throw new Error("Headroom managed runtime is closed");
    const root = resolve(projectRoot);
    let entry = this.#entries.get(root);
    if (entry?.state === "failed" || entry?.state === "stopped") {
      await this.stopProject(root);
      entry = undefined;
    }
    if (!entry) entry = await this.#create(root);
    return snapshot(entry);
  }

  async stopProject(projectRoot: string): Promise<void> {
    const root = resolve(projectRoot);
    const creating = this.#creating.get(root);
    if (creating) await creating.catch(() => undefined);
    const entry = this.#entries.get(root);
    if (!entry) return;
    entry.stopping = true;
    entry.abort.abort(new Error("Headroom project runtime stopped"));
    await entry.reservation?.close().catch(() => undefined);
    entry.reservation = undefined;
    if (entry.child) await stopChild(entry.child);
    await entry.task?.catch(() => undefined);
    entry.child = undefined;
    entry.pid = undefined;
    entry.state = "stopped";
    entry.error = undefined;
    entry.updatedAt = new Date().toISOString();
    await writeManagedState(entry).catch(() => undefined);
    this.#entries.delete(root);
  }

  async stopAll(): Promise<void> {
    const roots = [...new Set([...this.#entries.keys(), ...this.#creating.keys()])];
    await Promise.allSettled(roots.map((root) => this.stopProject(root)));
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#engineAbort.abort(new Error("Headroom host closed"));
    await this.stopAll();
    if (this.#enginePromise) {
      await Promise.race([
        this.#enginePromise.catch(() => undefined),
        sleep(STOP_GRACE_MS + 1_000).catch(() => undefined),
      ]);
    }
  }

  #create(projectRoot: string): Promise<ManagedEntry> {
    const existing = this.#creating.get(projectRoot);
    if (existing) return existing;
    const creating = (async () => {
      let entry: ManagedEntry | undefined;
      try {
        if (projectRoot === resolve("/")) throw new Error("Headroom refuses the filesystem root as a project");
        const projectAgentDir = projectPiAgentDir(projectRoot);
        if (!isWithin(projectRoot, projectAgentDir)) throw new Error("Headroom project state escaped the project root");
        const stateRoot = join(projectAgentDir, "headroom");
        const statePath = join(stateRoot, "service.json");
        const reservation = await this.#ops.reservePort();
        entry = {
          projectRoot,
          projectAgentDir: stateRoot,
          statePath,
          baseUrl: `http://127.0.0.1:${reservation.port}`,
          port: reservation.port,
          state: "installing",
          updatedAt: new Date().toISOString(),
          reservation,
          abort: new AbortController(),
          stopping: false,
          stderrTail: "",
        };
        this.#entries.set(projectRoot, entry);
        await writeManagedState(entry);
        entry.task = this.#run(entry);
        void entry.task.catch(() => undefined);
        return entry;
      } catch (error) {
        await entry?.reservation?.close().catch(() => undefined);
        if (this.#entries.get(projectRoot) === entry) this.#entries.delete(projectRoot);
        throw error;
      }
    })().finally(() => this.#creating.delete(projectRoot));
    this.#creating.set(projectRoot, creating);
    return creating;
  }

  #engine(): Promise<string> {
    if (forbiddenGlobalPiHome(this.#managedRoot)) {
      return Promise.reject(new Error("Headroom refuses to install under global ~/.pi"));
    }
    if (!this.#enginePromise) {
      const pending = this.#ops.ensureEngine({
        managedRoot: this.#managedRoot,
        env: this.#env,
        signal: this.#engineAbort.signal,
      });
      const tracked = pending.catch((error) => {
        if (this.#enginePromise === tracked) this.#enginePromise = undefined;
        throw error;
      });
      this.#enginePromise = tracked;
    }
    return this.#enginePromise;
  }

  async #run(entry: ManagedEntry): Promise<void> {
    try {
      const executable = await Promise.race([this.#engine(), aborted(entry.abort.signal)]);
      if (entry.abort.signal.aborted || entry.stopping) return;
      entry.state = "starting";
      entry.updatedAt = new Date().toISOString();
      await writeManagedState(entry);
      await entry.reservation?.close();
      entry.reservation = undefined;
      if (entry.abort.signal.aborted || entry.stopping) return;
      const child = this.#ops.spawnProxy({
        nodeExecutable: this.#nodeExecutable,
        executable,
        projectRoot: entry.projectRoot,
        projectAgentDir: projectPiAgentDir(entry.projectRoot),
        port: entry.port,
        env: this.#env,
      });
      entry.child = child;
      entry.pid = child.pid;
      const appendStderr = (chunk: unknown) => {
        entry.stderrTail = `${entry.stderrTail}${String(chunk)}`.slice(-PROCESS_DETAIL_LIMIT);
      };
      child.stderr.on("data", appendStderr);
      child.stdout.on("data", () => { /* drain to prevent backpressure */ });
      child.once("error", appendStderr);
      child.once("close", (code, signal) => {
        void this.#handleUnexpectedExit(entry, code, signal);
      });
      const ready = await this.#ops.waitUntilReady(entry.baseUrl, entry.abort.signal);
      if (!ready) throw new Error(entry.stderrTail || "Headroom readiness timed out");
      if (entry.abort.signal.aborted || entry.stopping) return;
      entry.state = "ready";
      entry.error = undefined;
      entry.updatedAt = new Date().toISOString();
      await writeManagedState(entry);
    } catch (error) {
      if (entry.stopping || entry.abort.signal.aborted) return;
      entry.state = "failed";
      entry.error = errorText(error);
      entry.updatedAt = new Date().toISOString();
      await entry.reservation?.close().catch(() => undefined);
      entry.reservation = undefined;
      if (entry.child) await stopChild(entry.child);
      entry.child = undefined;
      entry.pid = undefined;
      await writeManagedState(entry).catch(() => undefined);
    }
  }

  async #handleUnexpectedExit(entry: ManagedEntry, code: number | null, signal: NodeJS.Signals | null): Promise<void> {
    if (entry.stopping || entry.abort.signal.aborted || entry.state === "failed" || entry.state === "stopped") return;
    entry.child = undefined;
    entry.pid = undefined;
    entry.state = "failed";
    const exit = signal ? `signal ${signal}` : `exit ${code ?? "unknown"}`;
    entry.error = errorText(entry.stderrTail ? `${exit}: ${entry.stderrTail}` : exit);
    entry.updatedAt = new Date().toISOString();
    await writeManagedState(entry).catch(() => undefined);
  }
}
