import { execFile, spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { basename, delimiter, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import type { AuthType } from "@pipi/host-api";
import type { AuthInteractionLike, AuthRuntimeLike } from "./provider-auth.js";
import { withElectronRunAsNode } from "./spawn-assembly.js";

const execFileAsync = promisify(execFile);
export interface ExternalAuthRuntimeOptions { helperPath: string; piPath: string; agentDir: string; sessionsRoot?: string; enforceProfile?: boolean; env?: NodeJS.ProcessEnv; nodePath?: string; /** Optional per-request RPC timeout (tests use a short value to exercise timeout paths cheaply). */ rpcTimeoutMs?: number }

function parseDotEnv(source: string): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const raw of source.split(/\r?\n/)) {
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(raw.trim());
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[match[1]] = value;
  }
  return result;
}

export async function modelRuntimeEnvironment(agentDir: string, piPath: string, base: NodeJS.ProcessEnv, sessionsRoot = join(agentDir, "sessions"), enforceProfile = false): Promise<NodeJS.ProcessEnv> {
  let overlay: NodeJS.ProcessEnv = {};
  try { overlay = parseDotEnv(await readFile(join(agentDir, ".env"), "utf8")); } catch { /* optional */ }
  return withElectronRunAsNode({ ...base, ...overlay, PATH: [dirname(piPath), "/opt/homebrew/bin", "/usr/local/bin", base.PATH].filter(Boolean).join(delimiter), PIPIUI_PI_PATH: piPath, ...(enforceProfile ? { PI_CODING_AGENT_DIR: agentDir, PI_CODING_AGENT_SESSION_DIR: sessionsRoot } : {}) });
}

async function resolveNode(explicit: string | undefined, env: NodeJS.ProcessEnv): Promise<string> {
  const executable = process.platform === "win32" ? "node.exe" : "node";
  const piSibling = env.PIPIUI_PI_PATH ? join(dirname(env.PIPIUI_PI_PATH), executable) : undefined;
  const currentNode = basename(process.execPath).toLowerCase().startsWith("node") ? process.execPath : undefined;
  const pathNodes = (env.PATH ?? "").split(delimiter).filter(Boolean).map(dir => join(dir, executable));
  for (const candidate of [explicit, env.PIPIUI_NODE_PATH, piSibling, ...pathNodes, "/opt/homebrew/bin/node", "/usr/local/bin/node", currentNode]) {
    if (!candidate) continue;
    try { await access(candidate); return candidate; } catch { /* next */ }
  }
  throw new Error("找不到可运行 Pi ModelRuntime 的 Node.js；请安装 pi CLI/Node.js 或设置 PIPIUI_NODE_PATH");
}

const RPC_TIMEOUT_MS = 5_000;

interface ResidentWorker {
  child: ChildProcessWithoutNullStreams;
  pending: Map<string, { resolve: (value: any) => void; reject: (error: unknown) => void; timer: NodeJS.Timeout | undefined }>;
  seq: number;
  /** Serializes requests so the worker processes commands strictly one at a time. */
  tail: Promise<unknown>;
  disposed: boolean;
  ready: Promise<void>;
  kill(): void;
  lines: ReturnType<typeof createInterface>;
}

function spawnWorker(node: string, helperPath: string, env: NodeJS.ProcessEnv): ResidentWorker {
  const child = spawn(node, [helperPath, "serve"], { env, stdio: ["pipe", "pipe", "pipe"] });
  let readyResolve: () => void = () => {};
  const worker: ResidentWorker = {
    child,
    pending: new Map(),
    seq: 0,
    tail: Promise.resolve(),
    disposed: false,
    ready: new Promise(resolve => { readyResolve = resolve; }),
    kill() { worker.disposed = true; try { worker.lines.close(); child.stdin.end(); child.kill(); } catch { /* already gone */ } },
    lines: undefined as any,
  };
  worker.lines = createInterface({ input: child.stdout });
  worker.lines.on("line", line => {
    let msg: any;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg && msg.ready) { readyResolve(); return; }
    const waiter = msg && worker.pending.get(String(msg.id));
    if (!waiter) return;
    clearTimeout(waiter.timer);
    worker.pending.delete(String(msg.id));
    if (msg.ok) waiter.resolve(msg.data);
    else waiter.reject(new Error(msg.error || "helper returned an invalid result"));
  });
  child.on("exit", code => {
    worker.disposed = true;
    readyResolve();
    for (const [, waiter] of worker.pending) { clearTimeout(waiter.timer); waiter.reject(new Error(`worker exited with code ${code}`)); }
    worker.pending.clear();
  });
  // Best-effort stderr drain so a chatty runtime never backpressures the pipe.
  child.stderr.on("data", () => {});
  return worker;
}

export class ExternalAuthRuntime implements AuthRuntimeLike {
  constructor(private readonly options: ExternalAuthRuntimeOptions) {}
  private worker?: ResidentWorker;
  private workerReady = false;
  private envCache?: Promise<NodeJS.ProcessEnv>;
  private nodeCache?: Promise<string>;
  private workerEnv(): Promise<NodeJS.ProcessEnv> {
    if (!this.envCache) this.envCache = modelRuntimeEnvironment(this.options.agentDir, this.options.piPath, this.options.env ?? process.env, this.options.sessionsRoot, this.options.enforceProfile);
    return this.envCache;
  }
  private resolveNode(): Promise<string> { if (!this.nodeCache) this.nodeCache = this.workerEnv().then(env => resolveNode(this.options.nodePath, env)); return this.nodeCache; }
  /**
   * One-shot cold execFile path, kept as an always-available fallback when the
   * resident worker can't be spawned or has died (backward compatible).
   */
  private async command(command: string, ...args: string[]): Promise<any> {
    const env = await modelRuntimeEnvironment(this.options.agentDir, this.options.piPath, this.options.env ?? process.env, this.options.sessionsRoot, this.options.enforceProfile);
    const node = await resolveNode(this.options.nodePath, env);
    try {
      const { stdout } = await execFileAsync(node, [this.options.helperPath, command, ...args], { env, maxBuffer: 4 * 1024 * 1024 });
      const value = JSON.parse(stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "{}");
      if (!value.ok) throw new Error(value.error || "helper returned an invalid result");
      return value;
    } catch (error) { throw new Error(`外部 Pi runtime ${command} 失败：${error instanceof Error ? error.message : String(error)}`); }
  }
  /** Send {id,cmd,args}, await the correlated stdout line on the resident worker. */
  private async rpc(cmd: string, args: string[] = []): Promise<any> {
    const [env, node] = await Promise.all([this.workerEnv(), this.resolveNode()]);
    const worker = await this.ensureWorker(node, env, this.options.helperPath);
    const id = String(++worker.seq);
    const timeoutMs = this.options.rpcTimeoutMs ?? RPC_TIMEOUT_MS;
    return new Promise<any>((resolve, reject) => {
      // The timeout is armed only when the request is actually written to the
      // worker, never from request creation. To make that meaningful, writes are
      // also response-gated on the serialization tail: this request's write waits
      // until every earlier command has been fully answered, so time spent simply
      // queued behind a slow earlier reload never counts toward this command's
      // budget. A healthy worker is therefore never killed just because the
      // serial queue is deep.
      let settleDone: () => void = () => {};
      const done = new Promise<void>(r => { settleDone = r; });
      const resolveWrapper = (value: any) => { resolve(value); settleDone(); };
      const rejectWrapper = (error: unknown) => { reject(error); settleDone(); };
      const waiter = { resolve: resolveWrapper, reject: rejectWrapper, timer: undefined as NodeJS.Timeout | undefined };
      worker.pending.set(id, waiter);
      worker.tail = worker.tail.then(async () => {
        // If the worker already died (exit handler rejected this pending) or the
        // request was otherwise cleaned up while queued, don't write or arm a timer.
        if (!worker.pending.has(id)) { settleDone(); return; }
        waiter.timer = setTimeout(() => {
          // Clean up ONLY this pending (and its timer); the worker itself stays
          // alive so unrelated queued/new commands are not affected.
          worker.pending.delete(id);
          rejectWrapper(new Error(`worker 响应超时 (>${timeoutMs}ms)`));
        }, timeoutMs);
        try { worker.child.stdin.write(`${JSON.stringify({ id, cmd, args })}\n`); } catch { /* stdin closed */ }
        // Hold the tail until this command is answered (or its timer fires), so the
        // next queued command only starts its own clock when this one completes.
        await done;
      });
    });
  }
  /**
   * Query via the resident worker with a backward-compatible one-shot execFile
   * fallback (covers spawn failure and worker death). reloadFirst resets the
   * worker's refresh cache before the command so auth changes re-fetch.
   */
  private async query(cmd: string, args: string[] = [], reloadFirst = false): Promise<any> {
    try {
      if (reloadFirst) await this.rpc("reload");
      return await this.rpc(cmd, args);
    } catch (workerError) {
      // A timeout/error of just this pending must not cascade: if the worker is
      // still healthy (alive, not disposed), keep it and fall back only THIS
      // command to a cold one-shot execFile. Only when the worker itself has died
      // do we drop our reference so the next call lazily respawns.
      const workerAlive = !!this.worker && !this.worker.disposed && this.worker.child.exitCode === null;
      if (workerAlive) {
        return this.command(cmd, ...args);
      }
      // Worker is unusable for this call: drop it and fall back to a cold execFile.
      try { if (this.worker) this.worker.kill(); } catch { /* already gone */ }
      this.worker = undefined;
      this.workerReady = false;
      return this.command(cmd, ...args);
    }
  }
  /** Lazily spawn the resident worker once; recreate after a death/stop; else throw so the caller falls back. */
  private spawnPromise?: Promise<ResidentWorker>;
  private async ensureWorker(node: string, env: NodeJS.ProcessEnv, helperPath: string): Promise<ResidentWorker> {
    if (this.workerReady && this.worker && !this.worker.disposed && this.worker.child.exitCode === null) return this.worker;
    // Single-flight: concurrent first calls (e.g. a preloaded void runtimeModels()
    // racing listProviders→getProviders) must share ONE spawn promise. Without
    // this, each caller spawned its own worker and the loser was orphaned with no
    // reference — a permanent child-process leak that defeats this design.
    if (this.spawnPromise) return this.spawnPromise;
    const spawnPromise = this.doEnsureWorker(node, env, helperPath);
    this.spawnPromise = spawnPromise;
    void spawnPromise.then(
      () => { if (this.spawnPromise === spawnPromise) this.spawnPromise = undefined; },
      () => { if (this.spawnPromise === spawnPromise) this.spawnPromise = undefined; },
    );
    return spawnPromise;
  }
  private async doEnsureWorker(node: string, env: NodeJS.ProcessEnv, helperPath: string): Promise<ResidentWorker> {
    // Spawn a fresh worker and wait for its ready handshake (or exit) so an
    // immediate helper load failure doesn't leak a zombie worker.
    const worker = spawnWorker(node, helperPath, env);
    this.worker = worker;
    this.workerReady = false;
    await Promise.race([
      worker.ready,
      new Promise<void>(resolve => setTimeout(resolve, RPC_TIMEOUT_MS * 2)).then(() => worker.kill()),
    ]);
    if (worker.disposed || worker.child.exitCode !== null) {
      if (this.worker === worker) this.worker = undefined;
      this.workerReady = false;
      throw new Error("worker failed to start");
    }
    this.workerReady = true;
    return worker;
  }
  /** Reset the worker's internal refresh cache so the next query re-fetches (after auth change). */
  async reload(): Promise<void> { await this.rpc("reload"); }
  /** Kill the resident worker. Safe to call anytime; next use lazily respawns. */
  stop(): void {
    if (this.worker && !this.worker.disposed) this.worker.kill();
    this.worker = undefined;
    this.workerReady = false;
    this.spawnPromise = undefined;
  }
  async getProviders() { return (await this.query("list-providers", [], true)).providers; }
  /** getAvailable resets the worker cache first (cheap in-process refresh, not a respawn) so post-auth changes re-fetch. */
  async getAvailable() { return (await this.query("list-models", [], true)).models; }
  async logout(providerId: string) { await this.query("logout", [providerId]); }
  async login(providerId: string, authType: AuthType, interaction: AuthInteractionLike): Promise<unknown> {
    const env = await modelRuntimeEnvironment(this.options.agentDir, this.options.piPath, this.options.env ?? process.env, this.options.sessionsRoot, this.options.enforceProfile);
    const node = await resolveNode(this.options.nodePath, env);
    const child = spawn(node, [this.options.helperPath, "login-json", providerId, authType], { env, stdio: ["pipe", "pipe", "pipe"] });
    const abort = () => child.kill();
    interaction.signal?.addEventListener("abort", abort, { once: true });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-4096); });
    const lines = createInterface({ input: child.stdout });
    try {
      for await (const line of lines) {
        const event = JSON.parse(line);
        if (event.event === "prompt") child.stdin.write(`${JSON.stringify({ answer: await interaction.prompt(event.prompt) })}\n`);
        else if (event.event === "notify") interaction.notify(event.notification);
        else if (event.ok) return event.result;
        else if (event.error) throw new Error(event.error);
      }
      throw new Error(stderr.trim() || `helper exited with code ${child.exitCode ?? "unknown"}`);
    } finally { interaction.signal?.removeEventListener("abort", abort); lines.close(); child.stdin.end(); }
  }
}
