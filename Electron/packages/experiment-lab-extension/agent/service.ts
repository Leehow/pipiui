import { randomUUID } from "node:crypto";
import { chmod, lstat, readdir, realpath, rename, rm, unlink, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, resolve } from "node:path";
import type { CreateExperiment, DraftPatch, ExperimentBudget, ExperimentRecord, ExperimentRequest, ExperimentResponse, ExperimentSummary, InventoryKind, InventoryPage, MetricDefinition, VariantDraft } from "../contracts.js";
import { atomicJson, exclusion, ExperimentError, readRegular, relativePath, safeDirectory, semanticId } from "./paths.js";
import { captureSnapshot, sha256, type SnapshotOptions } from "./snapshot.js";
import { INVENTORY_KINDS, inventoryPages, summarizeRecord } from "./summary.js";
import { commandCases } from "./cases.js";

export const DEFAULT_BUDGET: Readonly<ExperimentBudget> = Object.freeze({ repetitions: 1, concurrency: 1, maxTrials: 60, trialTimeoutMs: 300000, totalTimeoutMs: 1800000 });
export const DATA_DIRECTORY = ".pi/agent/experiments";
const MAX_RECORD_BYTES = 8 * 1024 * 1024;
export type ServiceOptions = SnapshotOptions & {
  afterSnapshotRead?: () => Promise<void>;
  beforeCommit?: (target: string) => Promise<void>;
  afterLockAcquired?: () => Promise<void>;
  now?: () => string;
};

function question(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 2000) throw new ExperimentError("invalid-question", "请提供不超过2000字符的实验问题。");
  return value.trim();
}
function paths(value: unknown, defaults: string[], rootAllowed = false): string[] {
  if (value === undefined) return defaults;
  if (!Array.isArray(value) || value.length > 100) throw new ExperimentError("invalid-path", "路径清单最多100项。");
  const result = [...new Set(value.map((entry) => relativePath(entry, rootAllowed)))];
  for (const path of result) if (exclusion(path)) throw new ExperimentError("excluded-path", `该路径不能作为源码输入：${path}`);
  if (rootAllowed && result.length === 0) throw new ExperimentError("invalid-path", "基线范围不能为空。");
  return result;
}
function budget(value: Partial<ExperimentBudget> | undefined, previous = DEFAULT_BUDGET): ExperimentBudget {
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) throw new ExperimentError("invalid-budget", "预算必须是对象。");
  const result = { ...previous, ...value };
  const limits: Record<keyof ExperimentBudget, number> = { repetitions: 100, concurrency: 8, maxTrials: 10000, trialTimeoutMs: 86400000, totalTimeoutMs: 604800000 };
  for (const [key, val] of Object.entries(result)) {
    if (!(key in limits) || !Number.isSafeInteger(val) || val < 1 || val > limits[key as keyof ExperimentBudget]) throw new ExperimentError("invalid-budget", `预算字段不合法：${key}`);
  }
  return result;
}
function metrics(value: unknown): MetricDefinition[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32) throw new ExperimentError("invalid-metric", "指标清单最多32项。");
  const ids = new Set<string>();
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") throw new ExperimentError("invalid-metric", "指标必须是对象。");
    const id = semanticId(entry.id);
    if (["runtime-total-ms", "workload-wall-ms"].includes(id)) throw new ExperimentError("invalid-metric", "该指标由运行时计量，不能用被测程序覆盖。");
    if (ids.has(id) || typeof entry.unit !== "string" || !entry.unit || entry.unit.length > 32 || !["lower", "higher", "neutral"].includes(entry.direction)) throw new ExperimentError("invalid-metric", "指标需要唯一身份、单位与方向。");
    ids.add(id);
    return { id, unit: entry.unit, direction: entry.direction };
  });
}
function variants(value: unknown): VariantDraft[] {
  if (value === undefined) return [{ id: "baseline", hypothesis: "当前实现，作为对照基线。" }];
  if (!Array.isArray(value) || !value.length || value.length > 4) throw new ExperimentError("invalid-variant", "方案草稿应有1至4项，包含 baseline。");
  const ids = new Set<string>();
  const result = value.map((entry) => {
    if (!entry || typeof entry !== "object") throw new ExperimentError("invalid-variant", "方案草稿必须是对象。");
    const id = semanticId(entry.id);
    if (ids.has(id)) throw new ExperimentError("invalid-variant", "方案身份不能重复。");
    ids.add(id);
    return { id, hypothesis: question(entry.hypothesis) };
  });
  if (!ids.has("baseline")) throw new ExperimentError("invalid-variant", "请保留 baseline 对照方案。");
  return result;
}
export class ExperimentService {
  private root: string;
  private initialized?: Promise<void>;
  constructor(projectRoot: string, private readonly options: ServiceOptions = {}) { this.root = resolve(projectRoot); }
  private stamp(): string { return this.options.now?.() ?? new Date().toISOString(); }
  private data(...parts: string[]): string { return join(this.root, DATA_DIRECTORY, ...parts); }
  private eventPath(id: string, sequence: number): string { return this.data(id, "events", `${String(sequence).padStart(8, "0")}.json`); }
  snapshotPath(experimentId: string, revision: number): string {
    semanticId(experimentId);
    if (!Number.isSafeInteger(revision) || revision < 1) throw new ExperimentError("invalid-revision", "修订号必须为正整数。");
    return this.data(experimentId, "snapshots", `revision-${revision}`);
  }
  private async initialize(): Promise<void> {
    this.initialized ??= (async () => { this.root = await realpath(this.root); await safeDirectory(this.root, this.data()); })();
    await this.initialized;
  }
  private async json(file: string, maxBytes = MAX_RECORD_BYTES): Promise<any> {
    let data: Buffer;
    try { data = await readRegular(this.root, file, maxBytes); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ExperimentError("experiment-not-found", "本项目没有该实验或修订。");
      throw error;
    }
    try { return JSON.parse(data.toString("utf8")); } catch { throw new ExperimentError("invalid-record", "实验记录不是有效 JSON。"); }
  }
  private validateRecord(value: unknown, id: string): ExperimentRecord {
    const record = value as ExperimentRecord | undefined;
    if (!record || record.version !== 1 || record.id !== id || record.projectRoot !== this.root || !Number.isSafeInteger(record.sequence) || record.sequence < 1 || !Number.isSafeInteger(record.revision) || record.revision < 1 || !["draft", "frozen"].includes(record.state) || !Array.isArray(record.variants)) {
      throw new ExperimentError("invalid-record", "实验记录版本、身份或项目不匹配。");
    }
    return record;
  }
  async summary(experimentId: string): Promise<ExperimentSummary> {
    const id = semanticId(experimentId);
    await this.initialize();
    const value = await this.json(this.data(`${id}.json`), 64 * 1024);
    this.validateRecord(value, id);
    if (value.isSummary !== true || typeof value.recordDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.recordDigest)) throw new ExperimentError("invalid-record", "实验 checkpoint 缺少权威记录指纹。");
    return value as ExperimentSummary;
  }
  async get(experimentId: string, revision?: number): Promise<ExperimentRecord> {
    const id = semanticId(experimentId);
    if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)) throw new ExperimentError("invalid-revision", "修订号必须为正整数。");
    const current = await this.summary(id);
    const latest = this.validateRecord((await this.json(this.eventPath(id, current.sequence))).record, id);
    if (latest.sequence !== current.sequence || sha256(JSON.stringify(latest)) !== current.recordDigest) throw new ExperimentError("invalid-record", "实验 checkpoint 与权威事件不一致。");
    if (revision === undefined || revision === latest.revision) return latest;
    const history = this.data(id, "events");
    const entries = (await readdir(history)).filter((name) => /^\d{8}\.json$/.test(name) && Number(name.slice(0, -5)) < current.sequence).sort().reverse();
    for (const entry of entries) {
      const record = this.validateRecord((await this.json(join(history, entry))).record, id);
      if (record.revision === revision) return record;
    }
    throw new ExperimentError("experiment-not-found", "本项目没有该已提交修订。");
  }
  async list(limit = 20, offset = 0): Promise<ExperimentSummary[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 20 || !Number.isInteger(offset) || offset < 0) throw new ExperimentError("invalid-page", "列表每页1至20项，offset为非负整数。");
    await this.initialize();
    const files = (await readdir(this.data())).filter((name) => /^[a-z][a-z0-9-]*\.json$/.test(name)).sort();
    return Promise.all(files.slice(offset, offset + limit).map((file) => this.summary(file.slice(0, -5))));
  }
  private async locked<T>(id: string, action: () => Promise<T>, domain: "definition" | "trials" = "definition"): Promise<T> {
    await this.initialize();
    await safeDirectory(this.root, this.data(".locks"));
    const path = this.data(".locks", `${id}${domain === "trials" ? ".trials" : ""}.sqlite`);
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new ExperimentError("unsafe-path", "锁文件必须是普通文件。");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    // SQLite's OS lock survives awaits and is released by the kernel on process
    // death. Never unlink a lock: stale-owner takeover cannot delete a new owner.
    const db = new DatabaseSync(path);
    let acquired = false;
    try {
      try { db.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE"); acquired = true; }
      catch (error) {
        if (/locked|busy/i.test(String(error))) throw new ExperimentError("experiment-busy", "另一操作正在修改该实验，请稍后重试。");
        throw error;
      }
      await chmod(path, 0o600);
      await this.options.afterLockAcquired?.();
      return await action();
    } finally {
      try { if (acquired) db.exec("ROLLBACK"); } finally { db.close(); }
    }
  }
  /** Trusted same-project coordinators share this mutex; never exposed as a tool callback. */
  async withExperimentLock<T>(experimentId: string, action: () => Promise<T>, domain: "definition" | "trials" = "definition"): Promise<T> {
    return this.locked(semanticId(experimentId), action, domain);
  }
  private async persist(record: ExperimentRecord, event: string, signal?: AbortSignal): Promise<ExperimentRecord> {
    if (Buffer.byteLength(JSON.stringify({ version: 1, event, record })) > MAX_RECORD_BYTES) throw new ExperimentError("record-limit", "实验记录超过可安全读取的上限。");
    signal?.throwIfAborted();
    for (const kind of INVENTORY_KINDS) {
      for (const page of inventoryPages(record, kind)) {
        signal?.throwIfAborted();
        await atomicJson(this.root, this.data(record.id, "inventory", String(record.sequence), `${kind}-${page.page}.json`), page);
      }
    }
    for (const item of record.cases ?? []) {
      signal?.throwIfAborted();
      await atomicJson(this.root, this.data(record.id, "cases", String(record.sequence), `${item.id}.json`), item);
    }
    await atomicJson(this.root, this.eventPath(record.id, record.sequence), { version: 1, event, record });
    signal?.throwIfAborted();
    // This small atomic pointer is the sole commit point. Larger data is immutable
    // and is not observable as committed until this pointer references its digest.
    await atomicJson(this.root, this.data(`${record.id}.json`), summarizeRecord(record), { signal, beforeCommit: this.options.beforeCommit });
    return record;
  }
  async create(input: CreateExperiment): Promise<ExperimentRecord> {
    const id = semanticId(input.experimentId);
    const q = question(input.question);
    const scopes = paths(input.scopes, ["."], true);
    const includeUntracked = paths(input.includeUntracked, []);
    const kind = input.kind ?? "command";
    if (!["command", "pi", "browser"].includes(kind)) throw new ExperimentError("invalid-kind", "不支持的实验类型。");
    const checkedBudget = budget(input.budget);
    const checkedMetrics = metrics(input.metrics);
    const checkedVariants = variants(input.variants);
    const checkedCases = commandCases(input.cases);
    return this.locked(id, async () => {
      try { await lstat(this.data(`${id}.json`)); throw new ExperimentError("experiment-exists", "同名实验已存在，请读取或建立新修订。"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      const now = this.stamp();
      return this.persist({ version: 1, id, projectRoot: this.root, revision: 1, sequence: 1, question: q, kind, state: "draft", scopes, includeUntracked, metrics: checkedMetrics, variants: checkedVariants, cases: checkedCases, budget: checkedBudget, createdAt: now, updatedAt: now }, "created");
    });
  }
  async update(experimentId: string, patch: DraftPatch): Promise<ExperimentRecord> {
    const id = semanticId(experimentId);
    return this.locked(id, async () => {
      const record = await this.get(id);
      if (record.state !== "draft") throw new ExperimentError("experiment-frozen", "已冻结实验需创建新修订，不能就地修改。");
      await this.recoverSnapshot(record);
      return this.persist({ ...record,
        question: patch.question === undefined ? record.question : question(patch.question), scopes: paths(patch.scopes, record.scopes, true), includeUntracked: paths(patch.includeUntracked, record.includeUntracked),
        metrics: patch.metrics === undefined ? record.metrics : metrics(patch.metrics), variants: patch.variants === undefined ? record.variants : variants(patch.variants), cases: patch.cases === undefined ? (record.cases ?? []) : commandCases(patch.cases), budget: budget(patch.budget, record.budget), sequence: record.sequence + 1, updatedAt: this.stamp(),
      }, "updated");
    });
  }
  async revise(experimentId: string): Promise<ExperimentRecord> {
    const id = semanticId(experimentId);
    return this.locked(id, async () => {
      const record = await this.get(id);
      if (record.state !== "frozen") throw new ExperimentError("experiment-not-frozen", "草稿可直接修改，无需新修订。");
      const { baseline: _baseline, ...rest } = record;
      return this.persist({ ...rest, revision: record.revision + 1, sequence: record.sequence + 1, state: "draft", updatedAt: this.stamp() }, "revised");
    });
  }
  private async recoverSnapshot(record: ExperimentRecord): Promise<void> {
    const target = this.snapshotPath(record.id, record.revision);
    const journal = `${target}.transaction.json`;
    let transaction;
    try { transaction = await this.json(journal, 8192); } catch (error) {
      if (!(error instanceof ExperimentError) || error.code !== "experiment-not-found") throw error;
      return;
    }
    if (transaction.version !== 1 || transaction.experimentId !== record.id || transaction.revision !== record.revision || transaction.sequence !== record.sequence + 1 || !/^\.freeze-[a-f0-9-]{36}$/.test(transaction.temporaryBasename)) {
      throw new ExperimentError("recovery-required", "快照事务身份不匹配，已保留原文件。");
    }
    // The live-owner lock is held. Keep interrupted bytes, rather than deleting
    // unique data or trusting a stale snapshot after the source may have changed.
    for (const path of [target, join(dirname(target), transaction.temporaryBasename)]) {
      try {
        await safeDirectory(this.root, path, false);
        await rename(path, join(dirname(target), `.interrupted-${randomUUID()}`));
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    await unlink(journal);
  }
  async freeze(experimentId: string, signal?: AbortSignal): Promise<ExperimentRecord> {
    const id = semanticId(experimentId);
    return this.locked(id, async () => {
      signal?.throwIfAborted();
      const record = await this.get(id);
      if (record.state === "frozen") return record;
      await this.recoverSnapshot(record);
      const target = this.snapshotPath(id, record.revision);
      const journal = `${target}.transaction.json`;
      const temporaryBasename = `.freeze-${randomUUID()}`;
      const temporary = join(dirname(target), temporaryBasename);
      await safeDirectory(this.root, temporary);
      let published = false;
      try {
        const captured = await captureSnapshot(this.root, record, this.options, signal);
        for (const file of captured.files) {
          signal?.throwIfAborted();
          const output = join(temporary, file.path);
          await safeDirectory(temporary, dirname(output));
          await writeFile(output, captured.contents.get(file.path)!, { flag: "wx", mode: 0o600, signal });
          await chmod(output, file.executable ? 0o555 : 0o444);
        }
        await this.options.afterSnapshotRead?.();
        const after = await captureSnapshot(this.root, record, this.options, signal);
        if (captured.fingerprint !== after.fingerprint) throw new ExperimentError("baseline-changed", "冻结期间项目内容已变化，请重试。");
        signal?.throwIfAborted();
        try { await lstat(target); throw new ExperimentError("snapshot-exists", "本修订已有未登记的快照，拒绝覆盖。"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        await atomicJson(this.root, journal, { version: 1, experimentId: id, revision: record.revision, sequence: record.sequence + 1, temporaryBasename, fingerprint: captured.fingerprint });
        signal?.throwIfAborted();
        await rename(temporary, target);
        published = true;
        const { contents: _contents, ...baseline } = captured;
        const result = await this.persist({ ...record, state: "frozen", sequence: record.sequence + 1, updatedAt: this.stamp(), baseline: { ...baseline, frozenAt: this.stamp() } }, "frozen", signal);
        await rm(journal, { force: true }).catch(() => undefined);
        return result;
      } catch (error) {
        if (published) await rm(target, { recursive: true, force: true });
        await rm(journal, { force: true }).catch(() => undefined);
        throw error;
      } finally { await rm(temporary, { recursive: true, force: true }); }
    });
  }
  async inventory(experimentId: string, kind: InventoryKind, page: number, revision?: number): Promise<InventoryPage> {
    if (!INVENTORY_KINDS.includes(kind) || !Number.isSafeInteger(page) || page < 1) throw new ExperimentError("invalid-page", "清单种类或页码不合法。");
    const record = await this.get(experimentId, revision);
    const expected = inventoryPages(record, kind);
    if (page > expected.length) throw new ExperimentError("invalid-page", "清单没有该页。");
    const value = await this.json(this.data(record.id, "inventory", String(record.sequence), `${kind}-${page}.json`), 32 * 1024);
    if (JSON.stringify(value) !== JSON.stringify(expected[page - 1])) throw new ExperimentError("invalid-record", "清单页与权威记录不一致。");
    return value as InventoryPage;
  }
  async execute(request: ExperimentRequest, signal?: AbortSignal): Promise<ExperimentResponse> {
    if (!request || (request.version !== undefined && request.version !== 1)) throw new ExperimentError("invalid-version", "只支持实验契约版本1。");
    signal?.throwIfAborted();
    const response: ExperimentResponse = { version: 1, action: request.action, ...(request.requestId ? { requestId: request.requestId } : {}) };
    switch (request.action) {
      case "create": response.experiment = await this.create(request as CreateExperiment); break;
      case "list": response.experiments = await this.list(request.limit, request.offset); break;
      case "read": response.experiment = await this.get(semanticId(request.experimentId), request.revision); break;
      case "update": response.experiment = await this.update(semanticId(request.experimentId), request as DraftPatch); break;
      case "freeze": response.experiment = await this.freeze(semanticId(request.experimentId), signal); break;
      case "revise": response.experiment = await this.revise(semanticId(request.experimentId)); break;
      case "inventory": response.inventory = await this.inventory(semanticId(request.experimentId), request.inventoryKind!, request.page ?? 1, request.revision); break;
      case "case": {
        const record = await this.get(semanticId(request.experimentId), request.revision);
        const caseId = semanticId(request.caseId);
        response.definition = record.cases?.find((item) => item.id === caseId);
        if (!response.definition) throw new ExperimentError("case-not-found", "该修订没有此测例，请在草稿中定义后再冻结。");
        break;
      }
      default: throw new ExperimentError("unsupported-action", "此版本仅管理实验基线，不会启动被测命令。");
    }
    return response;
  }
}
