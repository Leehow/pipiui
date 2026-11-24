import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { ExperimentRecord, SnapshotFile } from "../contracts.js";
import type { FrozenVariant } from "./batch-contract.js";
import { contained, exclusion, ExperimentError, immutableJson, readRegular, relativePath, safeDirectory, semanticId } from "./paths.js";
import { DATA_DIRECTORY, ExperimentService } from "./service.js";
import { captureSnapshot, sha256 } from "./snapshot.js";

export type VariantWorkspace = NonNullable<FrozenVariant["workspace"]>;
export type PreparedVariant = VariantWorkspace & { experimentId: string; variantId: string; revision: number; baselineFingerprint: string; validationPaths: string[] };
export type ExperimentPlacementProvider = {
  resolveExperimentPlacement?: (input: { projectRoot: string; agentId: string }) => {
    cwd: string; worktreePath?: string; worktreeBranch?: string; worktreeError?: string; created: true; mergePolicy: "never";
  };
};
type Preparation = { version: 1; projectRoot: string; definitionFingerprint: string; workspaceHead: string; prepared: PreparedVariant };
type FrozenRecord = { version: 1; projectRoot: string; definitionFingerprint: string; frozen: FrozenVariant; source: unknown; changes: { added: string[]; modified: string[]; removed: string[] } };
const exec = promisify(execFile);
const MAX_RECORD = 8 * 1024 * 1024;
const selected = (file: string, scopes: string[]) => scopes.some((scope) => scope === "." || file === scope || file.startsWith(`${scope}/`));
const fingerprint = (baselineFingerprint: string, files: SnapshotFile[]) => sha256(JSON.stringify({ baselineFingerprint, files }));
const definitionFingerprint = (record: ExperimentRecord) => sha256(JSON.stringify(record));
function agentSlug(value: string): string {
  semanticId(value);
  if (value.length < 2 || value.length > 24) throw new ExperimentError("invalid-id", "原型 agentId 必须为2至24字符的语义 slug，不会截断身份。");
  return value;
}
async function git(root: string, ...args: string[]): Promise<string> {
  try { return (await exec("git", ["-c", "core.fsmonitor=false", "-C", root, ...args], { env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" }, timeout: 10000, maxBuffer: MAX_RECORD })).stdout; }
  catch { throw new ExperimentError("git-unavailable", "无法验证实验工作树的 Git 归属。"); }
}

/** Project-local candidate ownership and immutable inputs; never merges or commits. */
export class VariantStore {
  private root: string;
  private readonly store: ExperimentService;
  constructor(projectRoot: string, private readonly options: { store?: ExperimentService; placement?: ExperimentPlacementProvider; beforeFrozenRecord?: (frozen: FrozenVariant) => Promise<void> } = {}) {
    this.root = resolve(projectRoot);
    this.store = options.store ?? new ExperimentService(projectRoot);
  }
  private base(record: ExperimentRecord): string { return join(this.root, DATA_DIRECTORY, record.id, "variants", `revision-${record.revision}`); }
  private preparedPath(record: ExperimentRecord, id: string): string { return join(this.base(record), `${id}.workspace.json`); }
  private frozenPath(record: ExperimentRecord, id: string): string { return join(this.base(record), `${id}.frozen.json`); }
  private snapshotPath(record: ExperimentRecord, id: string, generation?: string): string { return join(this.base(record), `${id}.snapshot${generation ? `-${generation}` : ""}`); }
  private isSnapshotPath(record: ExperimentRecord, id: string, path: string): boolean {
    return typeof path === "string" && dirname(path) === this.base(record) && (path === this.snapshotPath(record, id) || new RegExp(`^${id}\\.snapshot-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$`).test(basename(path)));
  }
  private async record(experimentId: string, revision?: number): Promise<ExperimentRecord> {
    this.root = await realpath(this.root);
    const record = await this.store.get(semanticId(experimentId), revision);
    if (record.projectRoot !== this.root) throw new ExperimentError("project-mismatch", "实验不属于当前项目。");
    if (record.state !== "frozen" || !record.baseline) throw new ExperimentError("experiment-not-frozen", "请先冻结实验基线。");
    return record;
  }
  private variant(record: ExperimentRecord, id: string) {
    const variant = record.variants.find((item) => item.id === semanticId(id));
    if (!variant) throw new ExperimentError("variant-not-found", "该冻结修订没有此方案。");
    return variant;
  }
  private async json<T>(path: string): Promise<T | undefined> {
    try { return JSON.parse((await readRegular(this.root, path, MAX_RECORD)).toString("utf8")) as T; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }
  private async preparation(record: ExperimentRecord, id: string): Promise<Preparation | undefined> {
    const value = await this.json<Preparation>(this.preparedPath(record, id));
    if (!value) return undefined;
    const p = value.prepared;
    if (value.version !== 1 || value.projectRoot !== this.root || value.definitionFingerprint !== definitionFingerprint(record) || !p || p.experimentId !== record.id || p.revision !== record.revision || p.variantId !== id || p.baselineFingerprint !== record.baseline!.fingerprint || p.mergePolicy !== "never" || p.path !== join(this.root, ".pi/worktrees", agentSlug(p.agentId)) || p.branch !== `pipiui/${p.agentId}` || !Array.isArray(p.validationPaths)) {
      throw new ExperimentError("invalid-record", "原型工作区身份、定义或项目不匹配。");
    }
    this.validationPaths(record, p.validationPaths);
    return value;
  }
  private validationPaths(record: ExperimentRecord, paths: string[]): string[] {
    if (!Array.isArray(paths) || paths.length > 100) throw new ExperimentError("invalid-path", "验证路径最多100项。");
    return [...new Set(paths.map((path) => {
      relativePath(path);
      if (!record.baseline!.files.some((file) => file.path === path)) throw new ExperimentError("invalid-validation-path", "验证输入必须是基线中的普通文件。");
      return path;
    }))].sort();
  }
  private async verifyWorkspace(preparation: Preparation): Promise<void> {
    const p = preparation.prepared;
    await safeDirectory(this.root, p.path, false);
    const [top, branch, head, common, mainCommon] = await Promise.all([
      git(p.path, "rev-parse", "--show-toplevel"), git(p.path, "symbolic-ref", "--short", "HEAD"), git(p.path, "rev-parse", "HEAD"),
      git(p.path, "rev-parse", "--path-format=absolute", "--git-common-dir"), git(this.root, "rev-parse", "--path-format=absolute", "--git-common-dir"),
    ]);
    if (await realpath(top.trim()) !== p.path || branch.trim() !== p.branch || await realpath(common.trim()) !== await realpath(mainCommon.trim())) {
      throw new ExperimentError("workspace-mismatch", "工作树归属已改变，拒绝接管。");
    }
    // A normal worker may create private checkpoints. The never-merge policy,
    // not an artificially dirty tree, keeps these commits out of the main tree.
    try { await git(p.path, "merge-base", "--is-ancestor", preparation.workspaceHead, head.trim()); }
    catch { throw new ExperimentError("workspace-mismatch", "工作树 HEAD 已回退或不属于原型起点的后代。"); }
  }
  async prepare(input: { experimentId: string; variantId: string; agentId: string; revision?: number; validationPaths?: string[] }): Promise<PreparedVariant> {
    const agentId = agentSlug(input.agentId);
    return this.store.withExperimentLock(input.experimentId, async () => {
      const record = await this.record(input.experimentId, input.revision);
      this.variant(record, input.variantId);
      if (input.variantId === "baseline") throw new ExperimentError("baseline-read-only", "baseline 直接使用原冻结基线，不创建原型工作树。");
      const validationPaths = this.validationPaths(record, input.validationPaths ?? []);
      const existing = await this.preparation(record, input.variantId);
      if (existing) {
        if (existing.prepared.agentId !== agentId || JSON.stringify(existing.prepared.validationPaths) !== JSON.stringify(validationPaths)) throw new ExperimentError("workspace-conflict", "本方案已登记不同的工作区或验证输入。");
        await this.verifyWorkspace(existing);
        return existing.prepared;
      }
      const baseline = await this.read(record.id, "baseline", record.revision);
      const contents = await this.contents(baseline);
      const placement = this.options.placement ?? (globalThis as Record<PropertyKey, unknown>)[Symbol.for("pipiui.git-capability.worktree-placement-provider.v1")] as ExperimentPlacementProvider | undefined;
      if (!placement?.resolveExperimentPlacement) throw new ExperimentError("capability-unavailable", "Git 实验 worktree placement provider 未挂载。");
      const placed = placement.resolveExperimentPlacement({ projectRoot: this.root, agentId });
      const expected = join(this.root, ".pi/worktrees", agentId);
      if (placed.worktreeError || placed.created !== true || placed.mergePolicy !== "never" || placed.cwd !== expected || placed.worktreePath !== expected || placed.worktreeBranch !== `pipiui/${agentId}`) throw new ExperimentError("workspace-mismatch", "provider 未返回本调用新创建的隔离工作树。");
      const prepared: PreparedVariant = { experimentId: record.id, variantId: input.variantId, revision: record.revision, baselineFingerprint: baseline.fingerprint, agentId, path: expected, branch: placed.worktreeBranch, mergePolicy: "never", validationPaths };
      const registration: Preparation = { version: 1, projectRoot: this.root, definitionFingerprint: definitionFingerprint(record), workspaceHead: (await git(expected, "rev-parse", "HEAD")).trim(), prepared };
      await this.verifyWorkspace(registration);
      if ((await git(expected, "status", "--porcelain=v1", "--untracked-files=all")).trim()) throw new ExperimentError("workspace-busy", "新工作树已被修改，拒绝覆盖。");
      // Only this newly-created checkout is initialized. Never reset the user's
      // HEAD/index, and never assume the current HEAD still equals the baseline.
      for (const entry of await readdir(expected)) if (entry !== ".git") await rm(join(expected, entry), { recursive: true, force: false });
      await this.writeContents(expected, baseline.files, contents, false);
      await immutableJson(this.root, this.preparedPath(record, input.variantId), registration, MAX_RECORD);
      return prepared;
    });
  }
  private async contents(frozen: FrozenVariant, signal?: AbortSignal): Promise<Map<string, Buffer>> {
    await safeDirectory(this.root, frozen.snapshotPath, false);
    const contents = new Map<string, Buffer>();
    let total = 0;
    if (!Array.isArray(frozen.files) || frozen.files.length > 20000) throw new ExperimentError("invalid-record", "快照清单无效。");
    for (const file of frozen.files) {
      relativePath(file.path);
      if (exclusion(file.path) || contents.has(file.path)) throw new ExperimentError("invalid-record", "快照包含排除路径或重复路径。");
      const data = await readRegular(this.root, join(frozen.snapshotPath, file.path), 16 * 1024 * 1024, signal);
      const stat = await lstat(join(frozen.snapshotPath, file.path));
      if (data.length !== file.bytes || sha256(data) !== file.sha256 || Boolean(stat.mode & 0o111) !== file.executable) throw new ExperimentError("snapshot-corrupt", "冻结快照内容校验失败。");
      total += data.length;
      if (total > 256 * 1024 * 1024) throw new ExperimentError("snapshot-limit", "快照超过复制预算。");
      contents.set(file.path, data);
    }
    return contents;
  }
  private async writeContents(target: string, files: SnapshotFile[], contents: Map<string, Buffer>, immutable: boolean, signal?: AbortSignal): Promise<void> {
    for (const file of files) {
      signal?.throwIfAborted();
      const path = join(target, file.path);
      await safeDirectory(target, dirname(path));
      await writeFile(path, contents.get(file.path)!, { flag: "wx", mode: 0o600, signal });
      await chmod(path, immutable ? (file.executable ? 0o555 : 0o444) : (file.executable ? 0o700 : 0o600));
    }
  }
  async freeze(experimentId: string, variantId: string, revision?: number, includeUntracked: string[] = []): Promise<FrozenVariant> {
    return this.store.withExperimentLock(experimentId, async () => {
      const record = await this.record(experimentId, revision);
      this.variant(record, variantId);
      if (variantId === "baseline") return this.read(experimentId, variantId, record.revision);
      if (await this.json(this.frozenPath(record, variantId))) return this.read(experimentId, variantId, record.revision);
      const registration = await this.preparation(record, variantId);
      if (!registration) throw new ExperimentError("variant-not-prepared", "请先准备本方案的实验工作树。");
      await this.verifyWorkspace(registration);
      const baseline = await this.read(experimentId, "baseline", record.revision);
      if (!Array.isArray(includeUntracked) || includeUntracked.length > 100) throw new ExperimentError("invalid-path", "显式未跟踪输入最多100项。");
      for (const path of includeUntracked) { relativePath(path); if (exclusion(path) || !selected(path, record.scopes)) throw new ExperimentError("scope-conflict", "候选输入超出声明范围。"); }
      const capture = async () => {
        const untracked = (await git(registration.prepared.path, "ls-files", "--others", "--exclude-standard", "-z")).split("\0").filter(Boolean);
        const allowed = untracked.filter((path) => baseline.files.some((file) => file.path === path) || selected(path, includeUntracked));
        for (const path of includeUntracked) if (!untracked.some((file) => selected(file, [path]))) throw new ExperimentError("input-not-found", `未找到声明的未跟踪输入：${path}`);
        const captured = await captureSnapshot(registration.prepared.path, { ...record, scopes: ["."], includeUntracked: allowed }, {});
        for (const file of captured.files) if (!selected(file.path, record.scopes)) throw new ExperimentError("scope-conflict", `候选修改超出基线范围：${file.path}`);
        if (captured.omittedUntracked.length) throw new ExperimentError("undeclared-input", `请显式声明候选新增文件：${captured.omittedUntracked[0]}`);
        for (const path of registration.prepared.validationPaths) {
          const original = baseline.files.find((file) => file.path === path)!;
          const current = captured.files.find((file) => file.path === path);
          if (!current || current.sha256 !== original.sha256 || current.executable !== original.executable) throw new ExperimentError("validation-changed", `候选改变了共同验证输入：${path}`);
        }
        return captured;
      };
      const captured = await capture();
      const generation = randomUUID();
      const temporary = join(this.base(record), `.freeze-${generation}`);
      await safeDirectory(this.root, this.base(record));
      await mkdir(temporary, { mode: 0o700 });
      try {
        await this.writeContents(temporary, captured.files, captured.contents, true);
        if ((await capture()).fingerprint !== captured.fingerprint) throw new ExperimentError("variant-changed", "冻结期间候选发生变化，请重试。");
        await this.verifyWorkspace(registration);
        // Every attempt owns a distinct internal snapshot. If publication fails,
        // retain that evidence; a retry never reuses or replaces an orphan.
        // The immutable .frozen.json is the sole publication/commit point.
        const snapshotPath = this.snapshotPath(record, variantId, generation);
        await mkdir(snapshotPath, { mode: 0o700 });
        await rename(temporary, snapshotPath);
        const p = registration.prepared;
        const frozen: FrozenVariant = { version: 1, experimentId, revision: record.revision, id: variantId, hypothesis: this.variant(record, variantId).hypothesis, fingerprint: fingerprint(baseline.fingerprint, captured.files), baselineFingerprint: baseline.fingerprint, files: captured.files, frozenAt: new Date().toISOString(), snapshotPath, workspace: { agentId: p.agentId, path: p.path, branch: p.branch, mergePolicy: "never" } };
        const prior = new Map(baseline.files.map((file) => [file.path, file]));
        const { contents: _contents, ...source } = captured;
        const changes = { added: captured.files.filter((file) => !prior.has(file.path)).map((file) => file.path), modified: captured.files.filter((file) => prior.has(file.path) && (prior.get(file.path)!.sha256 !== file.sha256 || prior.get(file.path)!.executable !== file.executable)).map((file) => file.path), removed: baseline.files.filter((file) => !captured.contents.has(file.path)).map((file) => file.path) };
        await this.options.beforeFrozenRecord?.(frozen);
        await immutableJson(this.root, this.frozenPath(record, variantId), { version: 1, projectRoot: this.root, definitionFingerprint: definitionFingerprint(record), frozen, source, changes } satisfies FrozenRecord, MAX_RECORD);
        return frozen;
      } finally { await rm(temporary, { recursive: true, force: true }); }
    });
  }
  async read(experimentId: string, variantId: string, revision?: number): Promise<FrozenVariant> {
    const record = await this.record(experimentId, revision);
    const variant = this.variant(record, variantId);
    let frozen: FrozenVariant;
    if (variantId === "baseline") {
      const b = record.baseline!;
      frozen = { version: 1, experimentId: record.id, revision: record.revision, id: variantId, hypothesis: variant.hypothesis, fingerprint: b.fingerprint, baselineFingerprint: b.fingerprint, files: b.files, frozenAt: b.frozenAt, snapshotPath: this.store.snapshotPath(record.id, record.revision) };
    } else {
      const saved = await this.json<FrozenRecord>(this.frozenPath(record, variantId));
      if (!saved) throw new ExperimentError("variant-not-frozen", "此候选尚未冻结。");
      frozen = saved.frozen;
      const preparation = await this.preparation(record, variantId);
      const p = preparation?.prepared;
      if (saved.version !== 1 || saved.projectRoot !== this.root || saved.definitionFingerprint !== definitionFingerprint(record) || !frozen || frozen.version !== 1 || frozen.experimentId !== record.id || frozen.revision !== record.revision || frozen.id !== variantId || frozen.hypothesis !== variant.hypothesis || frozen.baselineFingerprint !== record.baseline!.fingerprint || !this.isSnapshotPath(record, variantId, frozen.snapshotPath) || frozen.fingerprint !== fingerprint(record.baseline!.fingerprint, frozen.files) || !p || JSON.stringify(frozen.workspace) !== JSON.stringify({ agentId: p.agentId, path: p.path, branch: p.branch, mergePolicy: "never" })) throw new ExperimentError("invalid-record", "候选冻结记录身份、定义或指纹不匹配。");
    }
    await this.contents(frozen);
    return frozen;
  }
  async list(experimentId: string, revision?: number): Promise<FrozenVariant[]> {
    const record = await this.record(experimentId, revision);
    const result: FrozenVariant[] = [];
    for (const variant of record.variants) {
      if (variant.id === "baseline" || await this.json(this.frozenPath(record, variant.id))) result.push(await this.read(record.id, variant.id, record.revision));
    }
    return result;
  }
  async materialize(frozen: FrozenVariant, target: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const authoritative = await this.read(frozen.experimentId, frozen.id, frozen.revision);
    if (JSON.stringify(authoritative) !== JSON.stringify(frozen)) throw new ExperimentError("invalid-record", "只能复制本项目登记的精确冻结候选。");
    const root = join(this.root, DATA_DIRECTORY, frozen.experimentId);
    target = resolve(target);
    if (target === root || !contained(root, target) || ["variants", "snapshots", "events", "inventory", "cases"].some((name) => contained(join(root, name), target))) throw new ExperimentError("unsafe-path", "复制目标必须是本实验内的新运行目录，不能覆盖记录或快照。");
    const contents = await this.contents(authoritative, signal);
    await safeDirectory(this.root, dirname(target));
    signal?.throwIfAborted();
    await mkdir(target, { mode: 0o700 }); // EEXIST is a conflict, including empty directories.
    try { await this.writeContents(target, authoritative.files, contents, false, signal); }
    catch (error) { await rm(target, { recursive: true, force: true }); throw error; }
  }
}
