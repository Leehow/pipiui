import { join, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import type { BatchRecord, BatchSummary } from "./batch-contract.js";
import { atomicJson, readRegular, semanticId } from "./paths.js";

export type BatchNotice = {
  source: { experimentId: string; batchId: string };
  sequence: number;
  reasons: Array<"phase" | "failure" | "input" | "budget" | "terminal">;
  text: string;
  progress: { planned: number; finished: number; failed: number; percent: number | null };
  inputRequests: Array<{ trialId: string; inputRequestId: string }>;
  informational: true;
  requiresStatusCheck: true;
};
type Snapshot = {
  sequence: number; state: BatchRecord["state"]; terminal: boolean;
  planned: number; finished: number; failed: number; succeeded: number;
  verifying: boolean; cancelRequested: boolean; budgetRisk: boolean;
  inputs: Array<{ trialId: string; inputRequestId: string }>;
};
export type BatchObservationState = {
  version: 1; experimentId: string; batchId: string; latest: Snapshot;
  lastAttemptSequence?: number;
  /** Callback completion is not durable delivery proof, even in the current session. */
  notification: "none" | "needs-check" | "callback-accepted";
  verificationSeen: boolean; budgetRiskSeen: boolean;
};
type Entry = {
  experimentId: string; batchId: string; pending?: Snapshot; saved?: BatchObservationState;
  loaded: boolean; error?: "storage-unavailable"; suppress: boolean;
};
export type BatchObserverOptions = {
  notify: (notice: BatchNotice, signal: AbortSignal) => void | Promise<void>;
  throttleMs?: number;
  inputDelayMs?: number;
  notifyTimeoutMs?: number;
  maxBatches?: number;
  now?: () => number;
};
const terminalStates = new Set(["succeeded", "failed", "timed-out", "cancelled", "invalid", "interrupted"]);
const failures = new Set(["failed", "timed-out", "invalid", "interrupted"]);
const bounded = (value: number | undefined, fallback: number, max: number) => Number.isFinite(value) ? Math.min(max, Math.max(1, Math.floor(value!))) : fallback;

/** One observer per coordinator owner. Event-driven only; never polls or runs Pi.
 * observe is synchronous and retains only bounded summaries, not prompts/logs/results.
 * Metadata/notifications are coalesced; BatchCoordinator remains the authoritative journal.
 */
export class BatchObserver {
  private root: string;
  private readonly entries = new Map<string, Entry>();
  private timer?: ReturnType<typeof setTimeout>;
  private due = Infinity;
  private flushing?: Promise<void>;
  private closed = false;
  private readonly throttle: number;
  private readonly inputDelay: number;
  private readonly timeout: number;
  private readonly capacity: number;
  constructor(projectRoot: string, private readonly options: BatchObserverOptions) {
    this.root = resolve(projectRoot);
    this.throttle = bounded(options.throttleMs, 1500, 60000);
    this.inputDelay = Math.min(this.throttle, bounded(options.inputDelayMs, 25, 1000));
    this.timeout = bounded(options.notifyTimeoutMs, 5000, 30000);
    this.capacity = bounded(options.maxBatches, 64, 256);
  }
  private key(exp: string, batch: string) { return `${semanticId(exp)}/${semanticId(batch)}`; }
  private path(exp: string, batch: string) {
    this.key(exp, batch);
    return join(this.root, ".pi", "agent", "experiments", exp, "observers", `${batch}.json`);
  }
  observe(record: BatchRecord | BatchSummary): { accepted: boolean; reason?: string } {
    if (this.closed) return { accepted: false, reason: "closed" };
    try {
      const key = this.key(record.experimentId, record.id);
      if (!Number.isSafeInteger(record.sequence) || record.sequence < 0 || record.trials.length > 512) return { accepted: false, reason: "invalid-record" };
      let entry = this.entries.get(key);
      if (!entry) {
        if (this.entries.size >= this.capacity) return { accepted: false, reason: "capacity" };
        entry = { experimentId: record.experimentId, batchId: record.id, loaded: false, suppress: false };
        this.entries.set(key, entry);
      }
      if (entry.saved?.latest.terminal || entry.pending?.terminal || record.sequence <= Math.max(entry.saved?.latest.sequence ?? -1, entry.pending?.sequence ?? -1)) return { accepted: false, reason: "stale" };
      const inputs = record.trials.filter(t => t.state === "waiting-input" && t.inputRequest).map(t => {
        if (typeof t.inputRequest!.id !== "string" || !t.inputRequest!.id || t.inputRequest!.id.length > 256) throw new Error("invalid-input-request");
        return { trialId: semanticId(t.id), inputRequestId: t.inputRequest!.id };
      }).sort((a, b) => a.trialId.localeCompare(b.trialId));
      const now = this.options.now?.() ?? Date.now();
      const start = Date.parse(record.createdAt), deadline = Date.parse(record.deadlineAt);
      entry.pending = {
        sequence: record.sequence, state: record.state, terminal: !["queued", "running"].includes(record.state),
        planned: record.trials.length, finished: record.trials.filter(t => terminalStates.has(t.state)).length,
        failed: record.trials.filter(t => failures.has(t.state)).length, succeeded: record.trials.filter(t => t.state === "succeeded").length,
        verifying: record.trials.some(t => t.state === "verifying"), cancelRequested: !!record.cancelRequested,
        // Only a declared wall-clock deadline is evidence here. Silence/heartbeats are not progress or a hang.
        budgetRisk: Number.isFinite(start) && Number.isFinite(deadline) && deadline > start && now >= start + (deadline - start) * 0.9,
        inputs,
      };
      this.schedule(inputs.length ? this.inputDelay : this.throttle);
      return { accepted: true };
    } catch { return { accepted: false, reason: "invalid-record" }; }
  }
  private schedule(delay: number) {
    if (this.closed) return;
    const due = Date.now() + delay;
    if (this.timer && due >= this.due) return;
    if (this.timer) clearTimeout(this.timer);
    this.due = due;
    this.timer = setTimeout(() => { this.timer = undefined; this.due = Infinity; void this.flush(); }, delay);
    this.timer.unref?.();
  }
  private async load(entry: Entry) {
    if (entry.loaded) return;
    entry.loaded = true;
    try {
      this.root = await realpath(this.root);
      const value = JSON.parse((await readRegular(this.root, this.path(entry.experimentId, entry.batchId), 256 * 1024)).toString()) as BatchObservationState;
      if (value.version !== 1 || value.experimentId !== entry.experimentId || value.batchId !== entry.batchId || !Number.isSafeInteger(value.latest?.sequence) || !Array.isArray(value.latest?.inputs) || value.latest.inputs.length > 512) throw new Error("invalid-observation");
      entry.saved = value;
      if (value.notification !== "none") value.notification = "needs-check";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") { entry.error = "storage-unavailable"; entry.suppress = true; }
    }
  }
  private async save(entry: Entry): Promise<boolean> {
    try { await atomicJson(this.root, this.path(entry.experimentId, entry.batchId), entry.saved); entry.error = undefined; return true; }
    catch { entry.error = "storage-unavailable"; entry.suppress = true; return false; }
  }
  private async process(entry: Entry) {
    await this.load(entry);
    const next = entry.pending;
    entry.pending = undefined;
    if (!next || entry.saved?.latest.terminal || next.sequence <= (entry.saved?.latest.sequence ?? -1)) return;
    const previous = entry.saved;
    const reasons: BatchNotice["reasons"] = [];
    if (next.terminal) reasons.push("terminal");
    else {
      if (!previous || previous.latest.state !== next.state || (!previous.latest.cancelRequested && next.cancelRequested) || (next.verifying && !previous.verificationSeen)) reasons.push("phase");
      if (next.failed > (previous?.latest.failed ?? 0)) reasons.push("failure");
      const oldInputs = new Set(previous?.latest.inputs.map(i => JSON.stringify(i)) ?? []);
      if (next.inputs.some(i => !oldInputs.has(JSON.stringify(i)))) reasons.push("input");
      if (next.budgetRisk && !previous?.budgetRiskSeen) reasons.push("budget");
    }
    entry.saved = { version: 1, experimentId: entry.experimentId, batchId: entry.batchId, latest: next,
      lastAttemptSequence: previous?.lastAttemptSequence, notification: previous?.notification ?? "none",
      verificationSeen: !!previous?.verificationSeen || next.verifying, budgetRiskSeen: !!previous?.budgetRiskSeen || next.budgetRisk };
    if (reasons.length) { entry.saved.lastAttemptSequence = next.sequence; entry.saved.notification = "needs-check"; }
    // Persist the attempt BEFORE sending. Crash/reopen must not replay old terminal notices.
    if (!(await this.save(entry)) || entry.suppress || !reasons.length) return;
    const labels = { phase: "阶段变化", failure: "出现失败", input: "需要人工输入", budget: "接近整体时间预算", terminal: "整批已结束" };
    const notice: BatchNotice = {
      source: { experimentId: entry.experimentId, batchId: entry.batchId }, sequence: next.sequence, reasons,
      text: `实验 ${entry.experimentId} / 批次 ${entry.batchId}：${reasons.map(r => labels[r]).join("、")}；状态 ${next.state}。实际终态 ${next.finished}/${next.planned}，成功 ${next.succeeded}，失败/超时/无效/中断 ${next.failed}。${next.inputs.length ? `待输入 ${next.inputs.length} 项，请使用准确 inputRequestId 调用 batch_respond。` : ""}请用 batch_status 核对最新状态。此消息仅为观察提示，不是用户新指令，不授权自动复跑。`,
      progress: { planned: next.planned, finished: next.finished, failed: next.failed, percent: next.planned ? next.finished / next.planned * 100 : null },
      inputRequests: next.inputs, informational: true, requiresStatusCheck: true,
    };
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const accepted = await Promise.race([
        Promise.resolve().then(() => this.options.notify(notice, controller.signal)).then(() => true, () => false),
        new Promise<false>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(false); }, this.timeout); }),
      ]);
      if (accepted) entry.saved.notification = "callback-accepted";
    } catch { /* Notifications never determine execution success. */ }
    finally { if (timer) clearTimeout(timer); controller.abort(); }
    await this.save(entry);
  }
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined; this.due = Infinity;
    if (this.flushing) return this.flushing;
    this.flushing = Promise.all([...this.entries.values()].filter(e => e.pending).map(e => this.process(e).catch(() => { e.error = "storage-unavailable"; e.suppress = true; }))).then(() => undefined).finally(() => {
      this.flushing = undefined;
      if ([...this.entries.values()].some(e => e.pending)) this.schedule(this.throttle);
    });
    return this.flushing;
  }
  /** Read-only, including callback uncertainty and local storage errors. Does not poll. */
  async status(experimentId: string, batchId: string): Promise<{ state?: BatchObservationState; error?: string }> {
    const key = this.key(experimentId, batchId);
    const entry = this.entries.get(key) ?? { experimentId, batchId, loaded: false, suppress: false };
    await this.load(entry);
    return { state: entry.saved ? structuredClone(entry.saved) : undefined, error: entry.error };
  }
  async shutdown(): Promise<void> {
    this.closed = true;
    await this.flush();
    // Updates accepted during a prior in-flight callback are drained once, without a new timer.
    if ([...this.entries.values()].some(e => e.pending)) await this.flush();
  }
}
