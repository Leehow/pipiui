import { randomUUID } from "node:crypto";
import { chmod, lstat, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { CommandCase, CommandSpec, ExperimentRecord, TrialCheck, TrialMetric, TrialRecord, TrialRequest, TrialResponse, TrialState } from "../contracts.js";
import type { AvailabilityReader } from "./availability.js";
import type { SandboxDriver, SandboxRunResult } from "./sandbox-contract.js";
import { atomicJson, immutableJson, ExperimentError, readRegular, relativePath, safeDirectory, semanticId } from "./paths.js";
import { DATA_DIRECTORY, ExperimentService } from "./service.js";
import { sha256 } from "./snapshot.js";

const ACTIVE: readonly TrialState[] = ["queued", "preparing", "running", "verifying"];
const STATES: readonly TrialState[] = [...ACTIVE, "succeeded", "failed", "timed-out", "cancelled", "invalid", "interrupted"];
const RECORD_LIMIT = 48 * 1024;
const METRIC_LIMIT = 1024 * 1024;
type ActiveTrial = { experimentId: string; controller: AbortController; promise: Promise<TrialRecord>; reason?: string; finishing?: boolean };
export type TrialDependencies = {
  store?: ExperimentService;
  driver: SandboxDriver;
  availability: AvailabilityReader;
  availabilityPollMs?: number;
  ownerSessionId?: string;
  onUpdate?: (trial: TrialRecord) => void;
};
const isActive = (record: TrialRecord) => ACTIVE.includes(record.state);

/** One coordinator per mounted project/session. JSON records outlive this owner. */
export class TrialCoordinator {
  private root: string;
  private initialized?: Promise<void>;
  private readonly store: ExperimentService;
  private readonly generation = randomUUID();
  private readonly active = new Map<string, ActiveTrial>();
  private readonly completions = new Map<string, Promise<TrialRecord>>();
  private readonly mutations = new Map<string, Promise<unknown>>();
  private readonly leases = new Map<string, DatabaseSync>();
  private stopping = false;
  private poll?: ReturnType<typeof setInterval>;
  private polling = false;
  constructor(projectRoot: string, private readonly deps: TrialDependencies) {
    this.root = resolve(projectRoot);
    this.store = deps.store ?? new ExperimentService(projectRoot);
  }
  private async initialize() {
    this.initialized ??= (async () => { this.root = await realpath(this.root); })();
    await this.initialized;
  }
  private key(experimentId: string, trialId: string) { return `${semanticId(experimentId)}/${semanticId(trialId)}`; }
  private base(experimentId: string, ...parts: string[]) { return join(this.root, DATA_DIRECTORY, semanticId(experimentId), "runs", ...parts); }
  private trialFile(experimentId: string, trialId: string) { return this.base(experimentId, `${semanticId(trialId)}.json`); }
  private async load(experimentId: string, trialId: string, repair = false): Promise<TrialRecord> {
    await this.initialize();
    this.key(experimentId, trialId);
    const directory = this.base(experimentId, trialId, "events");
    let entries: string[];
    try { await safeDirectory(this.root, directory, false); entries = await readdir(directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ExperimentError("trial-not-found", "该项目实验没有此运行。"); throw error; }
    const latest = entries.filter((name) => /^\d{8,16}\.json$/.test(name)).reduce<string | undefined>((max, name) => max === undefined || Number(name.slice(0, -5)) > Number(max.slice(0, -5)) ? name : max, undefined);
    if (!latest) throw new ExperimentError("trial-not-found", "运行没有已提交事件。");
    const record = JSON.parse((await readRegular(this.root, join(directory, latest), RECORD_LIMIT)).toString("utf8")) as TrialRecord;
    if (record?.version !== 1 || record.id !== trialId || record.experimentId !== experimentId || !Number.isSafeInteger(record.sequence) || record.sequence !== Number(latest.slice(0, -5)) || record.sequence < 1 || !Number.isSafeInteger(record.revision) || record.revision < 1 || !STATES.includes(record.state) || !["pass", "fail", "unknown"].includes(record.quality) || !record.owner || !Number.isInteger(record.owner.pid) || record.owner.pid < 1 || typeof record.owner.generation !== "string" || !Number.isFinite(Date.parse(record.createdAt)) || !Array.isArray(record.artifacts) || !Array.isArray(record.metrics) || !Array.isArray(record.checks)) throw new ExperimentError("invalid-trial", "运行事件身份、状态或版本不匹配。");
    if (repair) {
      const saved = await readRegular(this.root, this.trialFile(experimentId, trialId), RECORD_LIMIT).then((bytes) => bytes.toString("utf8")).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
        throw error;
      });
      if (saved !== `${JSON.stringify(record)}\n`) await atomicJson(this.root, this.trialFile(experimentId, trialId), record);
    }
    return record;
  }
  private async records(experimentId: string): Promise<TrialRecord[]> {
    await this.initialize();
    const directory = this.base(experimentId);
    try { await safeDirectory(this.root, directory, false); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const entries = await readdir(directory, { withFileTypes: true });
    const ids = [...new Set(entries.flatMap((entry) => entry.isDirectory() && /^[a-z][a-z0-9-]*$/.test(entry.name) ? [entry.name] : entry.isFile() && /^[a-z][a-z0-9-]*\.json$/.test(entry.name) ? [entry.name.slice(0, -5)] : []))].sort();
    if (ids.length > 10000) throw new ExperimentError("trial-limit", "运行目录超过读取上限。");
    const values: TrialRecord[] = [];
    for (const id of ids) values.push(await this.load(experimentId, id, true));
    return values;
  }
  private leaseFile(record: TrialRecord): string {
    return join(this.root, DATA_DIRECTORY, ".owners", `${sha256(JSON.stringify([record.experimentId, record.id, record.owner.generation]))}.sqlite`);
  }
  private async acquireLease(record: TrialRecord): Promise<void> {
    const path = this.leaseFile(record);
    await safeDirectory(this.root, dirname(path));
    try { const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink()) throw new ExperimentError("unsafe-path", "owner租约必须是普通文件。"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const lease = new DatabaseSync(path);
    try { lease.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE"); await chmod(path, 0o600); }
    catch (error) { lease.close(); throw error; }
    this.leases.set(this.key(record.experimentId, record.id), lease);
  }
  private releaseLease(experimentId: string, trialId: string): void {
    const key = this.key(experimentId, trialId);
    const lease = this.leases.get(key);
    if (!lease) return;
    this.leases.delete(key);
    try { lease.exec("ROLLBACK"); } finally { lease.close(); }
  }
  private async ownerProof(record: TrialRecord): Promise<"active" | "released" | "unknown"> {
    let lease: DatabaseSync | undefined;
    try {
      const path = this.leaseFile(record);
      await safeDirectory(this.root, dirname(path), false);
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink()) return "unknown";
      lease = new DatabaseSync(path);
      try { lease.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE; ROLLBACK"); return "released"; }
      catch (error) { return /locked|busy/i.test(String(error)) ? "active" : "unknown"; }
    } catch { return "unknown"; }
    finally { lease?.close(); }
  }
  private async reconcileRecord(record: TrialRecord): Promise<TrialRecord> {
    if (!isActive(record)) return record;
    const proof = await this.ownerProof(record);
    if (proof === "active") return record;
    return this.persist({ ...record, sequence: record.sequence + 1, state: "interrupted", phase: "terminal", quality: "unknown", endedAt: new Date().toISOString(), reason: proof === "released" ? "owner-not-active" : "owner-unconfirmed" });
  }
  private async persist(record: TrialRecord): Promise<TrialRecord> {
    if (Buffer.byteLength(JSON.stringify(record)) > RECORD_LIMIT) throw new ExperimentError("trial-record-limit", "运行记录过大，不能发布不可读取的结果。");
    await immutableJson(this.root, this.base(record.experimentId, record.id, "events", `${String(record.sequence).padStart(8, "0")}.json`), record, RECORD_LIMIT);
    await atomicJson(this.root, this.trialFile(record.experimentId, record.id), record);
    try { this.deps.onUpdate?.(structuredClone(record)); } catch { /* A notification failure cannot undo a committed state. */ }
    return record;
  }
  private async mutate<T>(experimentId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutations.get(experimentId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      const deadline = Date.now() + 2000;
      while (true) {
        try { return await this.store.withExperimentLock(experimentId, operation, "trials"); }
        catch (error) {
          if (!(error instanceof ExperimentError) || error.code !== "experiment-busy" || Date.now() >= deadline) throw error;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
    });
    this.mutations.set(experimentId, current);
    try { return await current; } finally { if (this.mutations.get(experimentId) === current) this.mutations.delete(experimentId); }
  }
  private async change(experimentId: string, trialId: string, patch: Partial<TrialRecord>): Promise<TrialRecord> {
    return this.mutate(experimentId, async () => {
      const record = await this.load(experimentId, trialId, true);
      return this.persist({ ...record, ...patch, id: record.id, experimentId: record.experimentId, sequence: record.sequence + 1 });
    });
  }
  private async enabled(signal?: AbortSignal): Promise<void> {
    if (this.stopping) throw new ExperimentError("session-ended", "会话已结束，不能启动实验。");
    const state = await this.deps.availability(signal);
    if (!state.enabled) throw new ExperimentError(state.reason ?? "extension-disabled", "当前宿主未授权实验台运行，未启动命令。");
    signal?.throwIfAborted();
  }
  private beginPoll(): void {
    if (this.poll) return;
    this.poll = setInterval(() => {
      if (this.polling || !this.active.size) return;
      this.polling = true;
      void this.deps.availability().then((state) => {
        if (!state.enabled) for (const run of this.active.values()) this.requestAbort(run, state.reason ?? "extension-disabled");
      }).catch(() => {
        for (const run of this.active.values()) this.requestAbort(run, "host-unavailable");
      }).finally(() => { this.polling = false; });
    }, Math.max(5, this.deps.availabilityPollMs ?? 500));
    this.poll.unref?.();
  }
  private requestAbort(run: ActiveTrial, reason: string): void {
    if (run.controller.signal.aborted || run.finishing) return;
    run.reason = reason;
    run.controller.abort();
  }
  async start(input: { experimentId: string; caseId: string; requestId: string; revision?: number }, signal?: AbortSignal): Promise<{ trial: TrialRecord; reused: boolean }> {
    signal?.throwIfAborted();
    await this.initialize();
    const id = semanticId(input.experimentId);
    const caseId = semanticId(input.caseId);
    if (typeof input.requestId !== "string" || !input.requestId || input.requestId.length > 512) throw new ExperimentError("invalid-request", "启动需要有界的请求关联标识。");
    await this.enabled(signal);
    const requestDigest = sha256(input.requestId);
    let definition: CommandCase | undefined;
    let experiment: ExperimentRecord | undefined;
    const claimed = await this.mutate(id, async () => {
      signal?.throwIfAborted();
      const previous: TrialRecord[] = [];
      for (const record of await this.records(id)) previous.push(await this.reconcileRecord(record));
      const repeated = previous.find((item) => item.requestDigest === requestDigest);
      if (repeated) {
        if (repeated.caseId !== caseId || (input.revision !== undefined && repeated.revision !== input.revision)) throw new ExperimentError("request-conflict", "同一请求标识不能指向不同测例或修订。");
        return { trial: repeated, reused: true };
      }
      experiment = await this.store.get(id, input.revision);
      if (experiment.projectRoot !== this.root) throw new ExperimentError("wrong-project", "实验不属于当前项目。");
      if (experiment.state !== "frozen" || !experiment.baseline) throw new ExperimentError("experiment-not-frozen", "请先冻结带测例的实验修订。");
      if (experiment.kind !== "command") throw new ExperimentError("unsupported-runner", "此入口仅运行命令测例。");
      if (experiment.metrics.some((metric) => ["runtime-total-ms", "workload-wall-ms"].includes(metric.id))) throw new ExperimentError("invalid-metric", "被测指标不能覆盖运行时计时。");
      definition = experiment.cases?.find((item) => item.id === caseId);
      if (!definition) throw new ExperimentError("case-not-found", "冻结修订没有该测例。");
      const revisionRuns = previous.filter((item) => item.revision === experiment!.revision);
      if (revisionRuns.length >= experiment.budget.maxTrials) throw new ExperimentError("budget-exhausted", "该修订已达到最大运行次数；扩大预算需新修订。");
      const firstRun = revisionRuns.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      const budgetDeadline = firstRun ? (firstRun.budgetDeadlineAt ? Date.parse(firstRun.budgetDeadlineAt) : Date.parse(firstRun.createdAt) + experiment.budget.totalTimeoutMs) : Date.now() + experiment.budget.totalTimeoutMs;
      if (!Number.isFinite(budgetDeadline) || Date.now() >= budgetDeadline) throw new ExperimentError("budget-exhausted", "该冻结修订的整体执行时间预算已耗尽，请新建修订；重试不补满预算。");
      if (previous.filter(isActive).length >= experiment.budget.concurrency) throw new ExperimentError("experiment-busy", "该实验已达到并发上限；本次未创建新运行。");
      const ordinal = previous.length + 1;
      const trialId = `${caseId.slice(0, 40).replace(/-+$/, "")}-trial-${ordinal}`;
      const record: TrialRecord = {
        version: 1, id: trialId, experimentId: id, revision: experiment.revision, variantId: "baseline", caseId, sequence: 1,
        requestDigest, definitionFingerprint: sha256(JSON.stringify(definition)), baselineFingerprint: experiment.baseline.fingerprint,
        state: "queued", phase: "queued", quality: "unknown", owner: { pid: process.pid, generation: this.generation, ...(this.deps.ownerSessionId ? { sessionId: this.deps.ownerSessionId } : {}) },
        runtime: { coordinatorNode: process.version, platform: process.platform, arch: process.arch },
        createdAt: new Date().toISOString(), budgetDeadlineAt: new Date(budgetDeadline).toISOString(), checks: [], metrics: [], artifacts: [],
      };
      await this.acquireLease(record);
      try { await this.persist(record); } catch (error) { this.releaseLease(id, trialId); throw error; }
      return { trial: record, reused: false };
    });
    if (claimed.reused) return claimed;
    if (signal?.aborted) {
      try { return { trial: await this.change(id, claimed.trial.id, { state: "cancelled", phase: "terminal", reason: "request-cancelled", endedAt: new Date().toISOString() }), reused: false }; }
      finally { this.releaseLease(id, claimed.trial.id); }
    }
    const controller = new AbortController();
    const entry = { experimentId: id, controller, promise: Promise.resolve(claimed.trial) } as ActiveTrial;
    const key = this.key(id, claimed.trial.id);
    this.active.set(key, entry);
    this.beginPoll();
    // Start after returning the durable queued receipt; the command does not own
    // the model turn and status/cancel remain responsive while execution runs.
    entry.promise = Promise.resolve().then(() => this.executeTrial(claimed.trial, experiment!, definition!, entry)).finally(() => {
      this.releaseLease(id, claimed.trial.id);
      this.active.delete(key);
      this.completions.delete(key);
      if (!this.active.size && this.poll) { clearInterval(this.poll); this.poll = undefined; }
    });
    this.completions.set(key, entry.promise);
    void entry.promise.catch(() => undefined);
    return claimed;
  }
  async wait(experimentId: string, trialId: string): Promise<TrialRecord> {
    const completion = this.completions.get(this.key(experimentId, trialId));
    return completion ?? this.load(experimentId, trialId);
  }
  async list(experimentId: string): Promise<TrialRecord[]> {
    return this.mutate(semanticId(experimentId), async () => {
      const records: TrialRecord[] = [];
      for (const record of await this.records(experimentId)) records.push(await this.reconcileRecord(record));
      return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20);
    });
  }
  async status(experimentId: string, trialId: string): Promise<TrialRecord> {
    return this.mutate(semanticId(experimentId), async () => this.reconcileRecord(await this.load(experimentId, trialId, true)));
  }
  async cancel(experimentId: string, trialId: string): Promise<TrialRecord> {
    return this.mutate(semanticId(experimentId), async () => {
      const record = await this.reconcileRecord(await this.load(experimentId, trialId, true));
      if (!isActive(record)) return record;
      const run = this.active.get(this.key(experimentId, trialId));
      if (!run || run.experimentId !== experimentId || record.owner.generation !== this.generation) throw new ExperimentError("trial-not-owned", "运行由其他会话持有，本会话不会按一个PID强制终止它。");
      if (run.finishing) return record;
      this.requestAbort(run, "user-cancelled");
      return this.persist({ ...record, sequence: record.sequence + 1, cancelRequested: true });
    });
  }
  async cleanup(experimentId: string, trialId: string): Promise<TrialRecord> {
    if (this.active.has(this.key(experimentId, trialId))) throw new ExperimentError("trial-active", "活跃运行不能清理。");
    await this.mutate(semanticId(experimentId), async () => {
      const record = await this.load(experimentId, trialId);
      if (isActive(record)) throw new ExperimentError("trial-active", "活跃运行不能清理。");
      if (record.state === "interrupted") throw new ExperimentError("cleanup-unconfirmed", "中断运行的子树状态尚未核实，工作副本已保留。");
    });
    // Terminal trials never restart or reuse their directory. Large removal must
    // not hold the experiment's mutation lane and block another trial's result.
    for (const dir of ["workspace", "home", "tmp"]) {
      const path = this.base(experimentId, trialId, dir);
      try { await safeDirectory(this.root, path, false); await rm(path, { recursive: true, force: true }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    return this.change(experimentId, trialId, { workspaceCleaned: true });
  }
  async shutdown(): Promise<void> {
    this.stopping = true;
    if (this.poll) { clearInterval(this.poll); this.poll = undefined; }
    for (const run of this.active.values()) this.requestAbort(run, "session-ended");
    await Promise.allSettled([...this.active.values()].map((run) => run.promise));
  }
  private async copySnapshot(record: ExperimentRecord, workspace: string, signal: AbortSignal): Promise<void> {
    const source = this.store.snapshotPath(record.id, record.revision);
    await safeDirectory(this.root, workspace);
    for (const file of record.baseline!.files) {
      signal.throwIfAborted();
      const name = relativePath(file.path);
      const data = await readRegular(source, join(source, name), Math.min(16 * 1024 * 1024, file.bytes + 1), signal);
      if (data.length !== file.bytes || sha256(data) !== file.sha256) throw new ExperimentError("baseline-changed", "冻结快照被修改，未启动命令。");
      const path = join(workspace, name);
      await safeDirectory(workspace, dirname(path));
      await writeFile(path, data, { flag: "wx", mode: file.executable ? 0o700 : 0o600, signal });
      await chmod(path, file.executable ? 0o700 : 0o600);
    }
  }
  private async logResult(record: TrialRecord, phase: "prepare" | "workload", result: SandboxRunResult): Promise<TrialRecord["artifacts"]> {
    const artifacts: TrialRecord["artifacts"] = [];
    for (const kind of ["stdout", "stderr"] as const) {
      const relative = `${DATA_DIRECTORY}/${record.experimentId}/runs/${record.id}/artifacts/${phase}.${kind}.txt`;
      const target = join(this.root, relative);
      await safeDirectory(this.root, dirname(target));
      await writeFile(target, result[kind], { flag: "wx", mode: 0o600 });
      artifacts.push({ kind, phase, path: relative, bytes: kind === "stdout" ? result.stdoutBytes : result.stderrBytes, truncated: kind === "stdout" ? result.stdoutTruncated : result.stderrTruncated });
    }
    return artifacts;
  }
  private async verify(record: ExperimentRecord, definition: CommandCase, workspace: string, signal: AbortSignal, trialId: string): Promise<{ checks: TrialCheck[]; metrics: TrialMetric[]; metricError?: string; metricEvidence?: TrialRecord["metricEvidence"] }> {
    const checks: TrialCheck[] = [];
    for (const check of definition.checks) {
      signal.throwIfAborted();
      try {
        const bytes = await readRegular(workspace, join(workspace, relativePath(check.path)), METRIC_LIMIT, signal);
        const passed = (check.expectedText === undefined || bytes.toString("utf8") === check.expectedText) && (check.sha256 === undefined || sha256(bytes) === check.sha256);
        checks.push({ path: check.path, passed, ...(!passed ? { reason: "content-mismatch" } : {}) });
      } catch (error) {
        signal.throwIfAborted();
        checks.push({ path: check.path, passed: false, reason: error instanceof ExperimentError ? error.code : "file-unavailable" });
      }
    }
    let values: Record<string, unknown> | undefined;
    let metricError: string | undefined;
    let metricEvidence: TrialRecord["metricEvidence"];
    if (definition.metricsFile) {
      try {
        const bytes = await readRegular(workspace, join(workspace, definition.metricsFile), METRIC_LIMIT, signal);
        const path = `${DATA_DIRECTORY}/${record.id}/runs/${semanticId(trialId)}/artifacts/metrics.raw.json`;
        await safeDirectory(this.root, dirname(join(this.root, path)));
        await writeFile(join(this.root, path), bytes, { flag: "wx", mode: 0o600, signal });
        metricEvidence = { path, bytes: bytes.length, sha256: sha256(bytes), validation: "invalid" };
        const parsed = JSON.parse(bytes.toString("utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
        const expected = new Set(record.metrics.map((metric) => metric.id));
        if (Object.keys(parsed).some((key) => !expected.has(key)) || record.metrics.some((metric) => typeof parsed[metric.id] !== "number" || !Number.isFinite(parsed[metric.id]))) throw new Error("invalid metric fields");
        values = parsed;
        metricEvidence.validation = "valid";
      } catch { signal.throwIfAborted(); metricError = "metrics-invalid-or-missing"; }
    }
    const metrics = record.metrics.map((metric): TrialMetric => ({ id: metric.id, value: values ? values[metric.id] as number : null, unit: metric.unit, source: values ? "workload-output" : "unavailable" }));
    return { checks, metrics, ...(metricError ? { metricError } : {}), ...(metricEvidence ? { metricEvidence } : {}) };
  }
  private async executeTrial(initial: TrialRecord, experiment: ExperimentRecord, definition: CommandCase, run: ActiveTrial): Promise<TrialRecord> {
    const started = performance.now();
    const deadline = Math.min(Date.now() + experiment.budget.trialTimeoutMs, Date.parse(initial.budgetDeadlineAt!));
    const signal = run.controller.signal;
    const timeout = setTimeout(() => this.requestAbort(run, "timeout"), Math.max(1, deadline - Date.now()));
    timeout.unref?.();
    const workspace = this.base(initial.experimentId, initial.id, "workspace");
    const home = this.base(initial.experimentId, initial.id, "home");
    const tmp = this.base(initial.experimentId, initial.id, "tmp");
    let artifacts: TrialRecord["artifacts"] = [];
    let preparationMs = 0;
    let workload: SandboxRunResult | undefined;
    let lastProgress = -Infinity;
    try {
      await this.enabled(signal);
      await this.change(initial.experimentId, initial.id, { state: "preparing", phase: "preparing", startedAt: new Date().toISOString() });
      const probe = await this.deps.driver.probe(signal);
      signal.throwIfAborted();
      if (!probe.available) throw new ExperimentError("sandbox-unavailable", "本机沙盒不可用，未执行裸命令。");
      await this.copySnapshot(experiment, workspace, signal);
      await safeDirectory(this.root, home); await safeDirectory(this.root, tmp);
      const invoke = async (command: CommandSpec) => {
        await this.enabled(signal);
        signal.throwIfAborted();
        // "node" deliberately means this Pi host's Node path, not a user PATH
        // shim. Grant that exact immutable executable, never the whole home tree.
        const useNode = !command.shell && (command.executable === "node" || command.executable === process.execPath);
        const nodePath = useNode ? await realpath(process.execPath) : undefined;
        signal.throwIfAborted();
        const priorStdout = artifacts.filter((item) => item.kind === "stdout").reduce((sum, item) => sum + item.bytes, 0);
        const priorStderr = artifacts.filter((item) => item.kind === "stderr").reduce((sum, item) => sum + item.bytes, 0);
        return this.deps.driver.run({
          trialId: initial.id, command: nodePath ? { ...command, executable: nodePath } : command, workspaceRoot: workspace, cwd: workspace, homeRoot: home, tempRoot: tmp,
          protectedReadRoots: [...new Set([this.root, join(this.root, ".pi"), homedir()])], trustedReadRoots: nodePath ? [nodePath] : [],
          allowedDomains: definition.allowedDomains, env: {}, timeoutMs: Math.max(1, deadline - Date.now()), maxOutputBytes: 64 * 1024,
        }, { signal, onProgress: (progress) => {
          const now = performance.now();
          if (now - lastProgress < 1000) return;
          lastProgress = now;
          void this.mutate(initial.experimentId, async () => {
            const current = await this.load(initial.experimentId, initial.id);
            if (!isActive(current) || current.owner.generation !== this.generation) return current;
            return this.persist({ ...current, sequence: current.sequence + 1, progress: {
              elapsedMs: now - started,
              stdoutBytes: priorStdout + progress.stdoutBytes,
              stderrBytes: priorStderr + progress.stderrBytes,
              updatedAt: new Date().toISOString(),
            } });
          }).catch(() => undefined); // Final result persistence remains mandatory.
        } });
      };
      if (definition.prepare) {
        const prepared = await invoke(definition.prepare);
        artifacts.push(...await this.logResult(initial, "prepare", prepared));
        signal.throwIfAborted();
        if (prepared.state !== "exited" || prepared.exitCode !== 0 || !prepared.sandbox.applied) {
          run.finishing = true;
          return await this.change(initial.experimentId, initial.id, { state: prepared.state === "timed-out" ? "timed-out" : prepared.state === "sandbox-unavailable" || !prepared.sandbox.applied ? "invalid" : "failed", phase: "terminal", quality: "unknown", reason: "preparation-failed", exitCode: prepared.exitCode, exitSignal: prepared.signal, sandbox: prepared.sandbox, artifacts, totalMs: performance.now() - started, endedAt: new Date().toISOString() });
        }
      }
      preparationMs = performance.now() - started;
      await this.change(initial.experimentId, initial.id, { state: "running", phase: "workload", preparationMs, artifacts });
      workload = await invoke(definition.command);
      artifacts.push(...await this.logResult(initial, "workload", workload));
      signal.throwIfAborted();
      if (workload.state !== "exited" || !workload.sandbox.applied) {
        run.finishing = true;
        return await this.change(initial.experimentId, initial.id, { state: workload.state === "timed-out" ? "timed-out" : workload.state === "cancelled" ? "cancelled" : workload.state === "sandbox-unavailable" || !workload.sandbox.applied ? "invalid" : "failed", phase: "terminal", quality: "unknown", reason: workload.reason ?? (workload.state === "exited" ? "sandbox-not-applied" : workload.state), sandbox: workload.sandbox, exitCode: workload.exitCode, exitSignal: workload.signal, artifacts, totalMs: performance.now() - started, workloadMs: workload.workloadWallMs, endedAt: new Date().toISOString() });
      }
      await this.change(initial.experimentId, initial.id, { state: "verifying", phase: "verifying", artifacts, workloadMs: workload.workloadWallMs });
      const verification = await this.verify(experiment, definition, workspace, signal, initial.id);
      signal.throwIfAborted();
      const quality = verification.checks.length ? verification.checks.every((check) => check.passed) ? "pass" : "fail" : "unknown";
      const exitOk = workload.exitCode === definition.expectedExitCode;
      const totalMs = performance.now() - started;
      run.finishing = true;
      return await this.change(initial.experimentId, initial.id, {
        state: exitOk && quality !== "fail" && !verification.metricError ? "succeeded" : "failed", phase: "terminal", quality, cancelRequested: false,
        ...(!exitOk ? { reason: "unexpected-exit-code" } : quality === "fail" ? { reason: "verification-failed" } : verification.metricError ? { reason: verification.metricError } : {}),
        exitCode: workload.exitCode, exitSignal: workload.signal, checks: verification.checks, artifacts, sandbox: workload.sandbox,
        ...(verification.metricEvidence ? { metricEvidence: verification.metricEvidence } : {}),
        metrics: [...verification.metrics, { id: "runtime-total-ms", value: totalMs, unit: "ms", source: "runtime" }, { id: "workload-wall-ms", value: workload.workloadWallMs, unit: "ms", source: workload.workloadWallMs === null ? "unavailable" : "runtime" }],
        totalMs, preparationMs, workloadMs: workload.workloadWallMs, endedAt: new Date().toISOString(),
      });
    } catch (error) {
      const reason = run.reason ?? (error instanceof ExperimentError ? error.code : "execution-error");
      run.finishing = true;
      return this.change(initial.experimentId, initial.id, {
        state: reason === "timeout" ? "timed-out" : signal.aborted ? "cancelled" : "invalid", phase: "terminal", quality: "unknown", reason,
        ...(workload ? { sandbox: workload.sandbox, exitCode: workload.exitCode, exitSignal: workload.signal, workloadMs: workload.workloadWallMs } : {}),
        artifacts, preparationMs, totalMs: performance.now() - started, endedAt: new Date().toISOString(),
      });
    } finally { clearTimeout(timeout); }
  }
  async execute(request: TrialRequest, requestId?: string, signal?: AbortSignal): Promise<TrialResponse> {
    if (request.version !== undefined && request.version !== 1) throw new ExperimentError("invalid-version", "只支持实验契约版本1。");
    const id = semanticId(request.experimentId);
    const envelope = { version: 1 as const, action: request.action, ...(request.requestId ? { requestId: request.requestId } : {}) };
    if (request.action === "run") return { ...envelope, ...await this.start({ experimentId: id, caseId: semanticId(request.caseId), revision: request.revision, requestId: requestId ?? request.requestId ?? randomUUID() }, signal) };
    if (request.action === "status") return request.trialId ? { ...envelope, trial: await this.status(id, semanticId(request.trialId)) } : { ...envelope, trials: await this.list(id) };
    if (request.action === "cancel") return { ...envelope, trial: await this.cancel(id, semanticId(request.trialId)) };
    if (request.action === "cleanup") return { ...envelope, trial: await this.cleanup(id, semanticId(request.trialId)) };
    throw new ExperimentError("unsupported-action", "未知运行操作。");
  }
}
