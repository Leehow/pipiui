/**
 * Project-scoped host workers: an extension's third half.
 *
 * The agent half only exists while a session runs, and the app half is a component in the
 * renderer. Neither can keep something going while the app is merely open — so anything
 * that must observe or collect continuously had to be a process the user started by hand.
 * A host worker is that missing lifetime: one child process per enabled extension that
 * declares `host.worker`, started when its project is loaded and stopped when it is not.
 *
 * What it is not: a new grant of power. An enabled extension already runs its own code
 * whenever a session starts. What changes is *when* — so the gates are the ones that
 * decide enablement (the project's own extensions directory, the enable overlay) plus an
 * explicit `host.worker` capability, and every start and stop is reported.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";

export type HostWorkerSpec = {
  extensionId: string;
  /** Absolute path to the worker module; the loader resolves it inside the package. */
  entry: string;
  /** Project root the worker is started for; also its cwd. */
  projectRoot: string;
};

export type HostWorkerEvent =
  | { type: "started"; extensionId: string; pid: number }
  | { type: "stopped"; extensionId: string; code: number | null }
  | { type: "error"; extensionId: string; message: string };

export type ExtensionHostWorkersOptions = {
  /** Defaults to this process's binary run as Node (see ELECTRON_RUN_AS_NODE below). */
  nodePath?: string;
  onEvent?: (event: HostWorkerEvent) => void;
  /** Injected in tests; defaults to `child_process.spawn`. */
  spawnImpl?: typeof spawn;
  /** A worker that dies faster than this repeatedly is broken, not restarting. */
  minRunMs?: number;
  maxRestarts?: number;
  /** Injected in tests; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
};

type Running = {
  spec: HostWorkerSpec;
  child: ChildProcess;
  startedAt: number;
  restarts: number;
  stopping: boolean;
};

const DEFAULT_MIN_RUN_MS = 5000;
const DEFAULT_MAX_RESTARTS = 3;

export class ExtensionHostWorkers {
  private readonly running = new Map<string, Running>();
  private readonly nodePath: string;
  private readonly onEvent?: (event: HostWorkerEvent) => void;
  private readonly spawnImpl: typeof spawn;
  private readonly minRunMs: number;
  private readonly maxRestarts: number;
  /**
   * A worker never manages workers.
   *
   * Recursion here is not a slow leak, it is a fork bomb: one bad spawn makes a child that
   * repeats the mistake. `ELECTRON_RUN_AS_NODE` stops the known cause; this stops the
   * class — inside a worker (its own env marks it), reconcile does nothing at all.
   */
  private readonly insideWorker: boolean;

  constructor(options: ExtensionHostWorkersOptions = {}) {
    this.nodePath = options.nodePath ?? process.execPath;
    this.onEvent = options.onEvent;
    this.spawnImpl = options.spawnImpl ?? spawn;
    this.minRunMs = options.minRunMs ?? DEFAULT_MIN_RUN_MS;
    this.maxRestarts = options.maxRestarts ?? DEFAULT_MAX_RESTARTS;
    this.insideWorker = Boolean((options.env ?? process.env).PIPIUI_EXTENSION_ID);
  }

  /** Ids with a live worker. */
  list(): string[] {
    return [...this.running.keys()].sort();
  }

  pid(extensionId: string): number | undefined {
    return this.running.get(extensionId)?.child.pid;
  }

  /**
   * Converge on `specs`: start what is missing, stop what is gone, and restart a worker
   * whose project changed. Idempotent — a rescan that changes nothing spawns nothing.
   */
  reconcile(specs: readonly HostWorkerSpec[]): void {
    if (this.insideWorker) return;
    const wanted = new Map(specs.map((spec) => [spec.extensionId, spec]));
    for (const [id, running] of [...this.running]) {
      const spec = wanted.get(id);
      if (!spec || spec.projectRoot !== running.spec.projectRoot || spec.entry !== running.spec.entry) {
        this.stop(id);
      }
    }
    for (const [id, spec] of wanted) {
      if (!this.running.has(id)) this.start(spec);
    }
  }

  stop(extensionId: string): void {
    const running = this.running.get(extensionId);
    if (!running) return;
    running.stopping = true;
    this.running.delete(extensionId);
    try {
      running.child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }

  stopAll(): void {
    for (const id of [...this.running.keys()]) this.stop(id);
  }

  private start(spec: HostWorkerSpec, restarts = 0): void {
    if (!existsSync(spec.entry)) {
      this.emit({ type: "error", extensionId: spec.extensionId, message: `worker entry missing: ${spec.entry}` });
      return;
    }
    let child: ChildProcess;
    try {
      child = this.spawnImpl(this.nodePath, [spec.entry], {
        cwd: spec.projectRoot,
        env: {
          ...process.env,
          // 在 Electron 里 process.execPath 是**应用自己**的二进制：不带这个开关地 spawn 它，
          // 启动的是又一个完整的 app，而那个副本又会起自己的 worker——指数级繁殖。
          // 这一行是这个类必须成立的前提，不是可选优化。
          ELECTRON_RUN_AS_NODE: "1",
          PIPIUI_EXTENSION_ID: spec.extensionId,
          PIPIUI_PROJECT_ROOT: spec.projectRoot,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      this.emit({
        type: "error",
        extensionId: spec.extensionId,
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    const running: Running = { spec, child, startedAt: Date.now(), restarts, stopping: false };
    this.running.set(spec.extensionId, running);
    if (child.pid) this.emit({ type: "started", extensionId: spec.extensionId, pid: child.pid });

    child.on("exit", (code) => {
      const current = this.running.get(spec.extensionId);
      if (current === running) this.running.delete(spec.extensionId);
      this.emit({ type: "stopped", extensionId: spec.extensionId, code: code ?? null });
      if (running.stopping) return;
      // 起来就死的 worker 是坏的，不是需要重启的。有限次数，且只对活够 minRunMs 的重启。
      const lived = Date.now() - running.startedAt;
      const next = lived >= this.minRunMs ? 0 : running.restarts + 1;
      if (next > this.maxRestarts) {
        this.emit({
          type: "error",
          extensionId: spec.extensionId,
          message: `worker exited ${next} times without staying up; not restarting`,
        });
        return;
      }
      this.start(spec, next);
    });
    child.on("error", (error) => {
      this.emit({ type: "error", extensionId: spec.extensionId, message: error.message });
    });
  }

  private emit(event: HostWorkerEvent): void {
    try {
      this.onEvent?.(event);
    } catch {
      /* an observer must never break the lifecycle */
    }
  }
}

export function createExtensionHostWorkers(options: ExtensionHostWorkersOptions = {}): ExtensionHostWorkers {
  return new ExtensionHostWorkers(options);
}
