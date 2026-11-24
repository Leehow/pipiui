import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, open, readdir, realpath, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ExperimentBudget } from "../contracts.js";
import type { BatchInput, BatchLogPage, BatchLogView, BatchRecord, BatchSummary, BatchTrial, FrozenVariant, PiCase } from "./batch-contract.js";
import { atomicJson, ExperimentError, readRegular, relativePath, safeDirectory, semanticId } from "./paths.js";
import { startPiSession, type PiRunEvent, type PiRunHandle, type PiRuntime } from "./pi-session.js";
import { DATA_DIRECTORY, ExperimentService } from "./service.js";
import { sha256 } from "./snapshot.js";
import { VariantStore } from "./variants.js";

const META_LIMIT = 2 * 1024 * 1024, TRIAL_LIMIT = 512 * 1024, LOG_LIMIT = 256 * 1024;
const activeTrial = (trial: BatchTrial) => ["queued", "preparing", "running", "waiting-input", "verifying"].includes(trial.state);
const activeBatch = (batch: Pick<BatchRecord, "state">) => batch.state === "queued" || batch.state === "running";
const stamp = () => new Date().toISOString();
const failure = (code: string) => new ExperimentError(code, code);
const canonical = (value: unknown): string => JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
type Metadata = Omit<BatchRecord, "trials"> & { trialIds: string[] };
type RunningTrial = { controller: AbortController; handle?: PiRunHandle; reason?: string; events: Promise<void>; secrets: string[]; lastSequence: number; lastSaved: number };
type Active = { record: BatchRecord; lease: DatabaseSync; variants: Map<string, FrozenVariant>; environment: Map<string, Record<string, string>>; resources: Map<string, string>; running: Map<string, RunningTrial>; promise: Promise<BatchRecord>; reason?: string; writes: Promise<void> };
export type BatchDependencies = {
  store?: ExperimentService;
  variants?: VariantStore;
  runtime: PiRuntime;
  ownerSessionId?: string;
  onUpdate?: (batch: BatchSummary) => void;
  /** Resolves only explicitly named, already-authorized mounted values. Never persisted. */
  resolveEnvironment?: (key: string) => string | undefined | Promise<string | undefined>;
};

export function summarizeBatch(record: BatchRecord): BatchSummary {
  const { owner: _owner, cases: _cases, trials, ...meta } = record;
  const states: BatchSummary["progress"]["states"] = {};
  for (const trial of trials) states[trial.state] = (states[trial.state] ?? 0) + 1;
  const queued = states.queued ?? 0, active = trials.filter(activeTrial).length - queued;
  return structuredClone({ ...meta, progress: { queued, active, finished: trials.length - queued - active, total: trials.length, states }, trials: trials.map(({ run, ...trial }) => ({ ...trial, ...(run ? { run: { state: run.state, totalMs: run.totalMs, usage: run.usage, stopReason: run.stopReason, toolCalls: run.toolCalls } } : {}) })) });
}

/** Project-local scheduler. Writable cwd isolation is NOT an OS permissions sandbox. */
export class BatchCoordinator {
  private root: string;
  private readonly store: ExperimentService;
  private readonly variants: VariantStore;
  private readonly generation = randomUUID();
  private readonly active = new Map<string, Active>();
  private readonly lanes = new Map<string, Promise<unknown>>();
  private stopping = false;
  constructor(projectRoot: string, private readonly deps: BatchDependencies) {
    this.root = resolve(projectRoot);
    this.store = deps.store ?? new ExperimentService(projectRoot);
    this.variants = deps.variants ?? new VariantStore(projectRoot, { store: this.store });
  }
  private base(exp: string, ...parts: string[]) { return join(this.root, DATA_DIRECTORY, semanticId(exp), "batches", ...parts); }
  private path(exp: string, batch: string, ...parts: string[]) { return this.base(exp, semanticId(batch), ...parts); }
  private trialPath(record: BatchRecord, trial: BatchTrial, file: string) { return this.path(record.experimentId, record.id, "trials", semanticId(trial.id), file); }
  private key(exp: string, batch: string) { return `${semanticId(exp)}/${semanticId(batch)}`; }
  private async lock<T>(exp: string, action: () => Promise<T>): Promise<T> {
    semanticId(exp);
    const next = (this.lanes.get(exp) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      this.root = await realpath(this.root);
      const deadline = Date.now() + 2000;
      for (;;) {
        try { return await this.store.withExperimentLock(exp, action, "trials"); }
        catch (error) {
          if (!(error instanceof ExperimentError) || error.code !== "experiment-busy" || Date.now() >= deadline) throw error;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
    });
    this.lanes.set(exp, next);
    try { return await next; } finally { if (this.lanes.get(exp) === next) this.lanes.delete(exp); }
  }
  // One long-lived kernel lock per experiment, distinct from the short mutation lock.
  // A PID, a timestamp or an expired heartbeat is never evidence that an owner died.
  private async lease(exp: string): Promise<DatabaseSync | undefined> {
    const path = this.base(exp, "owner.sqlite");
    await safeDirectory(this.root, dirname(path));
    try { const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink()) throw failure("unsafe-path"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const db = new DatabaseSync(path);
    try { db.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE"); await chmod(path, 0o600); return db; }
    catch (error) { db.close(); if (/locked|busy/i.test(String(error))) return undefined; throw error; }
  }
  private release(db: DatabaseSync) { try { db.exec("ROLLBACK"); } finally { db.close(); } }
  private async json<T>(path: string, limit: number): Promise<T> { return JSON.parse((await readRegular(this.root, path, limit)).toString("utf8")); }
  private async save(path: string, data: unknown, limit: number): Promise<void> {
    if (Buffer.byteLength(JSON.stringify(data)) + 1 > limit) throw failure("batch-record-limit");
    // A transient storage failure must not strand an otherwise finished process.
    for (let attempt = 0; ; attempt++) {
      try { await atomicJson(this.root, path, data); return; }
      catch (error) { if (attempt >= 1) throw error; await new Promise((resolve) => setTimeout(resolve, 10)); }
    }
  }
  private metadata(record: BatchRecord): Metadata { const { trials, ...meta } = record; return { ...meta, trialIds: trials.map((trial) => trial.id) }; }
  private async saveMeta(record: BatchRecord) { await this.save(this.path(record.experimentId, record.id, "batch.json"), this.metadata(record), META_LIMIT); }
  private async saveTrial(record: BatchRecord, trial: BatchTrial) {
    const { run, ...value } = trial;
    // Large answer/profile/transport evidence is separate, not rewritten per event.
    await this.save(this.trialPath(record, trial, "trial.json"), { ...value, ...(run ? { run: { state: run.state, totalMs: run.totalMs, usage: run.usage, stopReason: run.stopReason, toolCalls: run.toolCalls } } : {}) }, TRIAL_LIMIT);
  }
  private notify(record: BatchRecord) { try { this.deps.onUpdate?.(summarizeBatch(record)); } catch { /* UI is not authority. */ } }
  private async load(exp: string, batch: string, detail = false): Promise<BatchRecord> {
    const meta = await this.json<Metadata>(this.path(exp, batch, "batch.json"), META_LIMIT);
    if (meta.version !== 1 || meta.experimentId !== exp || meta.id !== batch || !Number.isSafeInteger(meta.revision) || meta.revision < 1 || !Array.isArray(meta.trialIds) || meta.trialIds.length > 512 || new Set(meta.trialIds).size !== meta.trialIds.length || !["queued", "running", "completed", "cancelled", "interrupted"].includes(meta.state) || !meta.owner?.generation) throw failure("invalid-batch");
    const { trialIds, ...record } = meta;
    const trials: BatchTrial[] = [];
    for (const id of trialIds) {
      const trial = await this.json<BatchTrial>(this.path(exp, batch, "trials", semanticId(id), "trial.json"), TRIAL_LIMIT);
      if (trial.id !== id || !Number.isSafeInteger(trial.sequence) || !["queued", "preparing", "running", "waiting-input", "verifying", "succeeded", "failed", "timed-out", "cancelled", "invalid", "interrupted"].includes(trial.state)) throw failure("invalid-batch");
      if (detail && trial.run) trial.run = await this.json(this.path(exp, batch, "trials", id, "run.json"), TRIAL_LIMIT);
      trials.push(trial);
    }
    return { ...record, trials };
  }
  private async ids(exp: string): Promise<string[]> {
    try {
      await safeDirectory(this.root, this.base(exp), false);
      const entries = await readdir(this.base(exp), { withFileTypes: true });
      const ids = entries.filter((entry) => entry.isDirectory() && /^[a-z][a-z0-9-]*$/.test(entry.name)).map((entry) => semanticId(entry.name)).sort();
      if (ids.length > 10000) throw failure("batch-limit");
      return ids;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }
  private async recover(record: BatchRecord): Promise<BatchRecord> {
    if (!activeBatch(record)) return record;
    // Caller holds the experiment lease and short mutation lock: ownership absence proven.
    for (const trial of record.trials) if (activeTrial(trial)) {
      Object.assign(trial, { state: "interrupted", quality: "unknown", reason: "owner-released", endedAt: stamp(), sequence: trial.sequence + 1 });
      delete trial.inputRequest;
      await this.saveTrial(record, trial);
    }
    Object.assign(record, { state: "interrupted", endedAt: stamp(), sequence: record.sequence + 1 });
    await this.saveMeta(record);
    return record;
  }
  private validate(input: BatchInput): BatchInput {
    const value = structuredClone(input);
    if (Object.keys(value).some((key) => !["experimentId", "revision", "batchId", "variants", "cases", "budget", "mode"].includes(key))) throw failure("invalid-batch-input");
    semanticId(value.experimentId); semanticId(value.batchId);
    if (value.mode !== undefined && !["comparison", "throughput"].includes(value.mode)) throw failure("invalid-mode");
    if (!Array.isArray(value.variants) || !value.variants.length || value.variants.length > 4 || new Set(value.variants.map((v) => v.id)).size !== value.variants.length) throw failure("invalid-variants");
    if (!Array.isArray(value.cases) || !value.cases.length || value.cases.length > 100 || new Set(value.cases.map((c) => c.id)).size !== value.cases.length) throw failure("invalid-cases");
    for (const variant of value.variants) {
      if (Object.keys(variant).some((key) => !["id", "profile", "environmentKeys"].includes(key)) || !variant.profile || Object.keys(variant.profile).some((key) => !["id", "provider", "model", "thinking", "tools", "extensions", "skills", "systemPrompt"].includes(key))) throw failure("invalid-profile");
      semanticId(variant.id); semanticId(variant.profile.id);
      if (Buffer.byteLength(canonical(variant.profile)) > 32768 || !variant.profile.provider || !variant.profile.model || !Array.isArray(variant.profile.tools)) throw failure("invalid-profile");
      if (variant.environmentKeys !== undefined && !Array.isArray(variant.environmentKeys)) throw failure("invalid-environment");
      variant.environmentKeys = [...new Set(variant.environmentKeys ?? [])].sort();
      if (variant.environmentKeys.length > 64 || variant.environmentKeys.some((key) => !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key))) throw failure("invalid-environment");
    }
    for (const definition of value.cases) {
      if (Object.keys(definition).some((key) => !["id", "title", "prompt", "checks", "expectedAnswer", "metricsFile"].includes(key))) throw failure("invalid-case");
      semanticId(definition.id);
      if (typeof definition.prompt !== "string" || !definition.prompt.trim() || definition.prompt.length > 100000 || typeof definition.title !== "string" || definition.title.length > 2000 || !Array.isArray(definition.checks) || definition.checks.length > 32 || (definition.expectedAnswer !== undefined && (typeof definition.expectedAnswer !== "string" || definition.expectedAnswer.length > 65536))) throw failure("invalid-case");
      for (const check of definition.checks) {
        relativePath(check.path);
        if ((check.expectedText !== undefined && (typeof check.expectedText !== "string" || check.expectedText.length > 65536)) || (check.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(check.sha256))) throw failure("invalid-check");
      }
      if (definition.metricsFile) relativePath(definition.metricsFile);
    }
    if (Buffer.byteLength(canonical(value)) > 1024 * 1024) throw failure("batch-definition-limit");
    return value;
  }
  private budget(input: BatchInput, ceiling: ExperimentBudget): ExperimentBudget {
    const budget = { ...ceiling, ...input.budget };
    for (const [key, value] of Object.entries(budget)) if (!(key in ceiling) || !Number.isSafeInteger(value) || value < 1 || value > ceiling[key as keyof ExperimentBudget]) throw failure("invalid-budget");
    return budget;
  }
  private async resourceFingerprint(profile: BatchInput["variants"][number]["profile"]): Promise<string> {
    const resources = [];
    for (const path of [...(profile.extensions ?? []), ...(profile.skills ?? [])]) {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw failure("invalid-profile-resource");
      resources.push({ path, digest: sha256(await readFile(path)) });
    }
    return sha256(canonical({ profile, resources, runtime: this.deps.runtime }));
  }
  async start(raw: BatchInput): Promise<BatchRecord> {
    if (process.env.PIPIUI_EXPERIMENT_CHILD === "1") throw failure("nested-experiment-not-allowed");
    const input = this.validate(raw);
    return this.lock(input.experimentId, async () => {
      if (this.stopping) throw failure("session-ended");
      const experiment = await this.store.get(input.experimentId, input.revision);
      if (experiment.projectRoot !== this.root || experiment.state !== "frozen" || !experiment.baseline || experiment.kind !== "pi") throw failure("pi-experiment-not-frozen");
      const budget = this.budget(input, experiment.budget);
      const fingerprint = sha256(canonical({ ...input, revision: experiment.revision, budget, mode: input.mode ?? "comparison" }));
      const ids = await this.ids(input.experimentId);
      if (ids.includes(input.batchId)) {
        const existing = await this.load(input.experimentId, input.batchId);
        if (existing.definitionFingerprint !== fingerprint) throw failure("batch-conflict");
        return existing;
      }
      const lease = await this.lease(input.experimentId);
      if (!lease) throw failure("batch-busy");
      let retained = false;
      try {
        const previous: BatchRecord[] = [];
        for (const id of ids) previous.push(await this.recover(await this.load(input.experimentId, id)));
        const revisionBatches = previous.filter((record) => record.revision === experiment.revision);
        const count = input.variants.length * input.cases.length * budget.repetitions;
        const reserved = revisionBatches.reduce((sum, batch) => sum + batch.trials.length, 0);
        if (count > 512 || reserved + count > budget.maxTrials) throw failure("budget-exhausted");
        const firstAt = revisionBatches.length ? Math.min(...revisionBatches.map((batch) => Date.parse(batch.createdAt))) : Date.now();
        const deadline = Math.min(firstAt + budget.totalTimeoutMs, ...revisionBatches.map((batch) => Date.parse(batch.deadlineAt)));
        if (Date.now() >= deadline) throw failure("budget-exhausted");
        const frozen = new Map<string, FrozenVariant>(), environment = new Map<string, Record<string, string>>(), resources = new Map<string, string>();
        for (const variant of input.variants) {
          const snapshot = await this.variants.read(experiment.id, variant.id, experiment.revision);
          if (snapshot.experimentId !== experiment.id || snapshot.revision !== experiment.revision || snapshot.id !== variant.id || snapshot.baselineFingerprint !== experiment.baseline.fingerprint) throw failure("variant-mismatch");
          frozen.set(variant.id, snapshot);
          resources.set(variant.id, await this.resourceFingerprint(variant.profile));
          const env: Record<string, string> = {};
          for (const key of variant.environmentKeys ?? []) {
            const value = await (this.deps.resolveEnvironment ? this.deps.resolveEnvironment(key) : process.env[key]);
            if (typeof value !== "string" || value.length > 65536) throw failure("environment-unavailable");
            env[key] = value;
          }
          environment.set(variant.id, env);
        }
        const createdAt = stamp(), trials: BatchTrial[] = [];
        // Rotate who gets the first slot on each case/repetition, not all rounds of A then B.
        for (let repetition = 1; repetition <= budget.repetitions; repetition++) for (const [caseIndex, definition] of input.cases.entries()) for (let offset = 0; offset < input.variants.length; offset++) {
          const index = (offset + repetition - 1 + caseIndex) % input.variants.length;
          const variant = input.variants[index];
          const id = `v${index + 1}-${variant.id.slice(0, 16).replace(/-+$/, "")}-c${caseIndex + 1}-${definition.id.slice(0, 16).replace(/-+$/, "")}-round-${repetition}`;
          semanticId(id);
          trials.push({ id, variantId: variant.id, caseId: definition.id, repetition, state: "queued", quality: "unknown", sequence: 1, createdAt, checks: [], metrics: [], logBytes: 0, logTruncated: false });
        }
        const record: BatchRecord = { version: 1, id: input.batchId, experimentId: experiment.id, revision: experiment.revision, definitionFingerprint: fingerprint, state: "queued", sequence: 1, createdAt, deadlineAt: new Date(deadline).toISOString(), owner: { generation: this.generation, ...(this.deps.ownerSessionId ? { sessionId: this.deps.ownerSessionId } : {}) }, mode: input.mode ?? "comparison", budget, variants: input.variants.map((variant) => ({ ...variant, fingerprint: frozen.get(variant.id)!.fingerprint, profileFingerprint: resources.get(variant.id)! })), cases: input.cases, metricDefinitions: experiment.metrics, trials };
        if (this.stopping) throw failure("session-ended");
        // Manifest is the reservation commit point. Incomplete directory creation does not run Pi.
        for (const trial of trials) await this.saveTrial(record, trial);
        await this.saveMeta(record);
        const run: Active = { record, lease, variants: frozen, environment, resources, running: new Map(), promise: Promise.resolve(record), writes: Promise.resolve() };
        this.active.set(this.key(record.experimentId, record.id), run); retained = true;
        const receipt = structuredClone(record);
        run.promise = Promise.resolve().then(() => this.execute(run)).finally(() => { this.release(lease); this.active.delete(this.key(record.experimentId, record.id)); });
        void run.promise.catch(() => undefined);
        this.notify(record);
        return receipt;
      } finally { if (!retained) this.release(lease); }
    });
  }
  private async query(exp: string, batch: string, detail: boolean): Promise<BatchRecord> {
    try {
      return await this.lock(exp, async () => {
        const local = this.active.get(this.key(exp, batch));
        if (local) return structuredClone(local.record);
        const record = await this.load(exp, batch, detail);
        if (!activeBatch(record)) return record;
        const lease = await this.lease(exp);
        if (!lease) return record; // Another live session owns this experiment.
        try { return await this.recover(record); } finally { this.release(lease); }
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw failure("batch-not-found");
      throw error;
    }
  }
  async get(exp: string, batch: string): Promise<BatchSummary> { return summarizeBatch(await this.query(exp, batch, false)); }
  async read(exp: string, batch: string): Promise<BatchRecord> { return this.query(exp, batch, true); }
  async list(exp: string, limit = 20, offset = 0): Promise<BatchSummary[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20 || !Number.isSafeInteger(offset) || offset < 0) throw failure("invalid-page");
    this.root = await realpath(this.root);
    const ids = await this.ids(exp);
    return Promise.all(ids.slice(offset, offset + limit).map((id) => this.get(exp, id)));
  }
  async wait(exp: string, batch: string): Promise<BatchRecord> {
    const local = this.active.get(this.key(exp, batch));
    if (local) return structuredClone(await local.promise);
    // Cross-owner waits observe persisted state, but never claim or restart work.
    for (;;) { const record = await this.read(exp, batch); if (!activeBatch(record)) return record; await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  private stop(run: Active, reason: string) {
    if (run.reason) return;
    run.reason = reason; run.record.cancelRequested = true;
    for (const trial of run.running.values()) { trial.reason = reason; trial.controller.abort(); trial.handle?.cancel(); }
  }
  async cancel(exp: string, batch: string): Promise<BatchSummary> {
    const record = await this.get(exp, batch);
    if (!activeBatch(record)) return record;
    const run = this.active.get(this.key(exp, batch));
    if (!run) {
      const latest = await this.get(exp, batch);
      if (!activeBatch(latest)) return latest;
      throw failure("batch-not-owned");
    }
    this.stop(run, "user-cancelled");
    await this.checkpoint(run);
    return summarizeBatch(run.record);
  }
  async cancelTrial(exp: string, batch: string, trialId: string): Promise<BatchSummary> {
    semanticId(trialId);
    const run = this.active.get(this.key(exp, batch));
    if (!run) {
      const latest = await this.get(exp, batch);
      if (!latest.trials.some((trial) => trial.id === trialId)) throw failure("trial-not-found");
      if (!activeBatch(latest)) return latest;
      throw failure("batch-not-owned");
    }
    const trial = run.record.trials.find((trial) => trial.id === trialId);
    if (!trial) throw failure("trial-not-found");
    if (trial.state === "queued") { Object.assign(trial, { state: "cancelled", reason: "user-cancelled", endedAt: stamp() }); await this.checkpoint(run, trial); }
    else if (activeTrial(trial)) { const active = run.running.get(trialId); if (active) { active.reason = "user-cancelled"; active.controller.abort(); active.handle?.cancel(); } }
    return summarizeBatch(run.record);
  }
  async respond(exp: string, batch: string, trialId: string, inputRequestId: string, response: { value?: string; confirmed?: boolean; cancelled?: boolean }): Promise<BatchSummary> {
    if (!response || typeof response !== "object" || Array.isArray(response) || Object.keys(response).some((key) => !["value", "confirmed", "cancelled"].includes(key)) || (response.confirmed !== undefined && typeof response.confirmed !== "boolean") || (response.cancelled !== undefined && typeof response.cancelled !== "boolean")) throw failure("invalid-input");
    const run = this.active.get(this.key(exp, batch)), trial = run?.record.trials.find((trial) => trial.id === semanticId(trialId));
    const active = run?.running.get(trialId);
    if (!run || !trial || !active?.handle || trial.state !== "waiting-input" || trial.inputRequest?.id !== inputRequestId) throw failure("input-not-pending");
    if (response.value !== undefined) { if (typeof response.value !== "string" || response.value.length > 65536) throw failure("invalid-input"); active.secrets.push(response.value); }
    active.handle.respond(inputRequestId, response);
    trial.manualInput = true; delete trial.inputRequest; trial.state = "running";
    await this.checkpoint(run, trial);
    return summarizeBatch(run.record);
  }
  async shutdown(): Promise<void> {
    this.stopping = true;
    for (const run of this.active.values()) this.stop(run, "session-ended");
    await Promise.allSettled([...this.active.values()].map((run) => run.promise));
  }
  private checkpoint(run: Active, trial?: BatchTrial): Promise<void> {
    run.record.sequence++;
    if (trial) trial.sequence++;
    const value = trial ? structuredClone(trial) : undefined, meta = this.metadata(run.record);
    const next = run.writes.catch(() => undefined).then(async () => {
      if (value) await this.saveTrial(run.record, value);
      await this.save(this.path(run.record.experimentId, run.record.id, "batch.json"), meta, META_LIMIT);
    });
    run.writes = next;
    return next.then(() => { this.notify(run.record); });
  }
  private redact<T>(value: T, secrets: string[]): T {
    const forms = [...new Set(secrets.filter(Boolean).flatMap((s) => [s, JSON.stringify(s).slice(1, -1)]))].sort((a, b) => b.length - a.length);
    const clean = (v: any): any => typeof v === "string" ? forms.reduce((text, s) => text.split(s).join("[REDACTED]"), v) : Array.isArray(v) ? v.map(clean) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([key, val]) => [clean(key), clean(val)])) : v;
    return clean(value);
  }
  private event(run: Active, trial: BatchTrial, active: RunningTrial, event: PiRunEvent) {
    if (!activeTrial(trial) || event.sequence <= active.lastSequence) return;
    active.lastSequence = event.sequence;
    const cleaned = this.redact(event, active.secrets);
    // Bound queued log work as well as file size; noisy late events cannot grow memory.
    const line = Buffer.from(JSON.stringify({ ...cleaned, trialId: trial.id }) + "\n");
    let keep = Math.max(0, Math.min(line.length, LOG_LIMIT - trial.logBytes));
    while (keep > 0 && keep < line.length && (line[keep] & 0xc0) === 0x80) keep--;
    if (keep < line.length) trial.logTruncated = true;
    trial.logBytes += keep; trial.lastOutputAt = event.at;
    if (event.type === "tool_execution_start") trial.recentTool = String(cleaned.data.toolName ?? "tool").slice(0, 200);
    if (event.type === "ready" && typeof cleaned.data.pid === "number") trial.pid = cleaned.data.pid;
    if (event.type === "waiting-input") {
      trial.state = "waiting-input";
      trial.inputRequest = { id: String(cleaned.data.id), method: String(cleaned.data.method), ...(typeof cleaned.data.title === "string" ? { title: cleaned.data.title.slice(0, 2000) } : {}), ...(Array.isArray(cleaned.data.options) ? { options: cleaned.data.options.slice(0, 100).map((v) => String(v).slice(0, 1000)) } : {}) };
    }
    if (keep) active.events = active.events.then(async () => {
      const path = this.trialPath(run.record, trial, "events.jsonl");
      await safeDirectory(this.root, dirname(path), false);
      const handle = await open(path, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try { if (!(await handle.stat()).isFile()) throw failure("unsafe-path"); await handle.writeFile(line.subarray(0, keep)); }
      finally { await handle.close(); }
    }).catch(() => { trial.logTruncated = true; });
    if (event.type === "waiting-input" || Date.now() - active.lastSaved >= 500) {
      active.lastSaved = Date.now();
      void active.events.then(() => this.checkpoint(run, trial)).catch(() => { trial.logTruncated = true; });
    }
  }
  async view(exp: string, batch: string, trialId: string): Promise<BatchLogView> {
    semanticId(trialId);
    const record = await this.query(exp, batch, true), trial = record.trials.find((item) => item.id === trialId);
    if (!trial) throw failure("trial-not-found");
    const logPath = this.path(exp, batch, "trials", trialId, "events.jsonl");
    const local = this.active.get(this.key(exp, batch));
    await local?.running.get(trialId)?.events;
    let logAvailable = true;
    try { await readRegular(this.root, logPath, LOG_LIMIT); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; logAvailable = false; }
    return { mode: "read-only-log", experimentId: exp, batchId: batch, trialId, logPath, logAvailable, logTruncated: trial.logTruncated,
      pid: trial.pid ?? trial.run?.pid, ownerState: !activeBatch(record) ? "not-active" : local ? "this-session" : "other-session",
      ...(trial.inputRequest ? { inputRequestId: trial.inputRequest.id } : {}),
      canRespond: Boolean(local && trial.state === "waiting-input" && trial.inputRequest),
      note: "这是同一真实 Pi 运行的只读事件日志，可用终端查看；不是 PTY attach，也不启动第二个 Pi。人工回复必须通过 batch_respond 绑定实际输入请求。",
    };
  }
  async logs(exp: string, batch: string, trialId: string, cursor = 0, limit = 16384): Promise<BatchLogPage> {
    semanticId(trialId);
    if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(limit) || limit < 4 || limit > 65536) throw failure("invalid-page");
    const record = await this.get(exp, batch), trial = record.trials.find((item) => item.id === trialId);
    if (!trial) throw failure("trial-not-found");
    const active = this.active.get(this.key(exp, batch))?.running.get(trialId);
    await active?.events;
    let bytes: Buffer;
    try { bytes = await readRegular(this.root, this.path(exp, batch, "trials", trialId, "events.jsonl"), LOG_LIMIT); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; bytes = Buffer.alloc(0); }
    if (cursor > bytes.length || (cursor < bytes.length && (bytes[cursor] & 0xc0) === 0x80)) throw failure("invalid-cursor");
    let end = Math.min(cursor + limit, bytes.length);
    while (end > cursor && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    return { trialId, cursor, nextCursor: end, text: bytes.subarray(cursor, end).toString("utf8"), truncated: trial.logTruncated, totalBytes: bytes.length };
  }
  private async verify(run: Active, trial: BatchTrial, definition: PiCase, workspace: string) {
    for (const check of definition.checks) {
      try {
        const bytes = await readRegular(workspace, join(workspace, check.path), 1024 * 1024);
        const passed = (check.expectedText === undefined || bytes.toString("utf8") === check.expectedText) && (check.sha256 === undefined || sha256(bytes) === check.sha256);
        trial.checks.push({ name: check.path, passed, ...(!passed ? { reason: "content-mismatch" } : {}) });
      } catch { trial.checks.push({ name: check.path, passed: false, reason: "file-unavailable" }); }
    }
    if (definition.expectedAnswer !== undefined) trial.checks.push({ name: "expected-answer", passed: trial.run?.answer === definition.expectedAnswer });
    trial.quality = trial.checks.length ? trial.checks.every((check) => check.passed) ? "pass" : "fail" : "unknown";
    let metrics: Record<string, unknown> = {};
    if (definition.metricsFile) {
      try {
        const bytes = await readRegular(workspace, join(workspace, definition.metricsFile), 1024 * 1024);
        await writeFile(this.trialPath(run.record, trial, "metrics.raw.json"), bytes, { flag: "wx", mode: 0o600 });
        const value = JSON.parse(bytes.toString("utf8"));
        if (value && typeof value === "object" && !Array.isArray(value)) metrics = value;
      } catch { /* Invalid or absent workload values remain unavailable, never runtime evidence. */ }
    }
    trial.metrics = run.record.metricDefinitions.map((metric) => {
      const value = metrics[metric.id];
      return { id: metric.id, value: typeof value === "number" && Number.isFinite(value) ? value : null, unit: metric.unit, source: typeof value === "number" && Number.isFinite(value) ? "workload-output" : "unavailable" };
    });
  }
  private async executeTrial(run: Active, trial: BatchTrial): Promise<void> {
    const active: RunningTrial = { controller: new AbortController(), events: Promise.resolve(), secrets: [], lastSequence: 0, lastSaved: 0 };
    run.running.set(trial.id, active);
    const start = performance.now();
    const timeout = setTimeout(() => { active.reason = "trial-timeout"; active.controller.abort(); active.handle?.cancel(); }, run.record.budget.trialTimeoutMs);
    try {
      if (run.reason) { active.reason = run.reason; active.controller.abort(); }
      trial.state = "preparing"; trial.startedAt = stamp();
      await this.checkpoint(run, trial);
      const workspace = this.trialPath(run.record, trial, "workspace");
      await this.variants.materialize(run.variants.get(trial.variantId)!, workspace, active.controller.signal);
      active.controller.signal.throwIfAborted();
      const variant = run.record.variants.find((v) => v.id === trial.variantId)!;
      if (await this.resourceFingerprint(variant.profile) !== run.resources.get(trial.variantId)) throw failure("profile-resource-changed");
      const definition = run.record.cases.find((c) => c.id === trial.caseId)!;
      await writeFile(this.trialPath(run.record, trial, "events.jsonl"), "", { flag: "wx", mode: 0o600 });
      trial.state = "running";
      await this.checkpoint(run, trial);
      const environment = run.environment.get(trial.variantId)!;
      active.secrets = Object.values(environment);
      active.handle = await startPiSession({ runtime: this.deps.runtime, profile: variant.profile, workspace, stateDirectory: this.trialPath(run.record, trial, "state"), prompt: definition.prompt, timeoutMs: run.record.budget.trialTimeoutMs, signal: active.controller.signal, environment, redactValues: active.secrets, onEvent: (event) => this.event(run, trial, active, event) });
      trial.pid = active.handle.pid;
      trial.run = this.redact(await active.handle.result, active.secrets);
      await active.events;
      await this.save(this.trialPath(run.record, trial, "run.json"), trial.run, TRIAL_LIMIT);
      if (active.controller.signal.aborted) throw failure(active.reason ?? "cancelled");
      if (trial.run.state === "completed") {
        trial.state = "verifying";
        await this.checkpoint(run, trial);
        await this.verify(run, trial, definition, workspace);
        active.controller.signal.throwIfAborted();
        trial.state = trial.quality === "fail" ? "failed" : "succeeded";
        if (trial.quality === "fail") trial.reason = "verification-failed";
      } else { trial.state = trial.run.state; trial.reason = trial.run.reason; }
    } catch (error) {
      if (active.handle) { active.handle.cancel(); await active.handle.result; }
      trial.state = active.reason?.includes("timeout") ? "timed-out" : active.controller.signal.aborted ? "cancelled" : "invalid";
      trial.quality = "unknown";
      trial.reason = active.reason ?? (error instanceof ExperimentError ? error.code : "trial-error");
    } finally {
      clearTimeout(timeout);
      await active.events;
      delete trial.inputRequest;
      trial.metrics = trial.metrics.filter((metric) => !["runtime-total-ms", "pi-session-ms"].includes(metric.id));
      trial.metrics.push({ id: "runtime-total-ms", value: performance.now() - start, unit: "ms", source: "runtime" });
      if (trial.run) trial.metrics.push({ id: "pi-session-ms", value: trial.run.totalMs, unit: "ms", source: "runtime" });
      trial.endedAt = stamp();
      run.running.delete(trial.id);
      await this.checkpoint(run, trial);
    }
  }
  private async execute(run: Active): Promise<BatchRecord> {
    const timer = setTimeout(() => this.stop(run, "budget-timeout"), Math.max(1, Date.parse(run.record.deadlineAt) - Date.now()));
    let fatal = false;
    try {
      run.record.state = "running"; await this.checkpoint(run);
      let index = 0;
      const worker = async () => {
        while (index < run.record.trials.length && !run.reason) {
          if (Date.now() >= Date.parse(run.record.deadlineAt)) { this.stop(run, "budget-timeout"); break; }
          const trial = run.record.trials[index++];
          if (trial.state !== "queued") continue;
          try { await this.executeTrial(run, trial); }
          catch { fatal = true; this.stop(run, "persistence-error"); }
        }
      };
      await Promise.all(Array.from({ length: run.record.budget.concurrency }, worker));
    } catch { fatal = true; this.stop(run, "persistence-error"); }
    finally {
      clearTimeout(timer);
      for (const trial of run.record.trials) if (activeTrial(trial)) {
        Object.assign(trial, { state: fatal ? "interrupted" : run.reason === "budget-timeout" ? "timed-out" : "cancelled", reason: run.reason, endedAt: stamp() });
        await this.checkpoint(run, trial).catch(() => { fatal = true; });
      }
      run.record.state = fatal ? "interrupted" : run.reason ? "cancelled" : "completed";
      run.record.endedAt = stamp();
      await this.checkpoint(run).catch(() => { fatal = true; });
      // If disk remains unwritable, the released kernel lease lets the next query
      // reconstruct interruption; no fabricated durable-success claim is returned.
    }
    if (fatal) throw failure("batch-persistence-error");
    return run.record;
  }
}
