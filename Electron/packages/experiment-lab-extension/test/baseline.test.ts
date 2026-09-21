import { afterEach, describe, expect, it } from "vitest";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ExperimentService } from "../agent/service.js";

const exec = promisify(execFile);
const roots: string[] = [];
async function git(root: string, ...args: string[]): Promise<string> {
  return (await exec("git", ["-C", root, ...args])).stdout;
}
async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "experiment-baseline-"));
  roots.push(root);
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.email", "fixture@example.invalid");
  await git(root, "config", "user.name", "Experiment fixture");
  await writeFile(join(root, ".gitignore"), ".pi/\nnode_modules/\n");
  await writeFile(join(root, "logic.ts"), "export const value = 1;\n");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "fixture baseline");
  return root;
}
const draft = { experimentId: "search-contrast", question: "宽召回是否改善定位？", kind: "command" as const };
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("实验基线行为", () => {
  it("持久化草稿，重开仍可读取；不启动被测命令", async () => {
    const root = await repository();
    const created = await new ExperimentService(root).create(draft);
    expect(created).toMatchObject({ version: 1, id: draft.experimentId, revision: 1, state: "draft", question: draft.question });
    expect(created.budget).toMatchObject({ repetitions: 1, concurrency: 1, maxTrials: 60, trialTimeoutMs: 300000, totalTimeoutMs: 1800000 });
    expect(await new ExperimentService(root).get(draft.experimentId)).toEqual(created);
    expect((await new ExperimentService(root).list()).map((entry) => entry.id)).toEqual([draft.experimentId]);
    await expect(new ExperimentService(root).create(draft)).rejects.toMatchObject({ code: "experiment-exists" });
  });

  it("冻结当前已跟踪修改及显式未跟踪源码，保护 index 与工作区", async () => {
    const root = await repository();
    await writeFile(join(root, "logic.ts"), "export const value = 2;\n");
    await git(root, "add", "logic.ts");
    await writeFile(join(root, "logic.ts"), "export const value = 3;\n");
    await writeFile(join(root, "candidate.ts"), "export const extra = true;\n");
    await writeFile(join(root, "unrelated.txt"), "unrelated user work\n");
    await writeFile(join(root, ".env"), "DO_NOT_COPY=secret\n");
    const before = await git(root, "status", "--porcelain=v1", "-z");
    const index = await readFile(join(root, ".git", "index"));
    const service = new ExperimentService(root);
    await service.create({ ...draft, includeUntracked: ["candidate.ts"] });
    const frozen = await service.freeze(draft.experimentId);
    expect(frozen.state).toBe("frozen");
    expect(frozen.baseline?.files.map((file) => file.path)).toContain("candidate.ts");
    expect(frozen.baseline?.files.map((file) => file.path)).not.toContain("unrelated.txt");
    expect(frozen.baseline?.files.map((file) => file.path)).not.toContain(".env");
    expect(frozen.baseline?.omittedUntracked).toContain("unrelated.txt");
    expect(frozen.baseline?.dirtyPaths).toContain("logic.ts");
    const snapshot = service.snapshotPath(draft.experimentId, frozen.revision);
    expect(await readFile(join(snapshot, "logic.ts"), "utf8")).toBe("export const value = 3;\n");
    expect(await readFile(join(root, ".git", "index"))).toEqual(index);
    expect(await git(root, "status", "--porcelain=v1", "-z")).toBe(before);
    await writeFile(join(root, "logic.ts"), "export const value = 4;\n");
    expect(await readFile(join(snapshot, "logic.ts"), "utf8")).toBe("export const value = 3;\n");
    expect(await service.freeze(draft.experimentId)).toEqual(frozen);
  });

  it("冻结后修改产生新修订，原快照与历史不可覆盖", async () => {
    const root = await repository();
    const service = new ExperimentService(root);
    await service.create(draft);
    const first = await service.freeze(draft.experimentId);
    await expect(service.update(draft.experimentId, { question: "不能就地改" })).rejects.toMatchObject({ code: "experiment-frozen" });
    const revised = await service.revise(draft.experimentId);
    expect(revised).toMatchObject({ revision: 2, state: "draft" });
    expect(revised.baseline).toBeUndefined();
    expect(await service.get(draft.experimentId, 1)).toEqual(first);
    await service.update(draft.experimentId, { question: "新的可检验问题" });
    const second = await service.freeze(draft.experimentId);
    expect(second.question).toBe("新的可检验问题");
    expect(second.baseline?.fingerprint).toBe(first.baseline?.fingerprint);
  });

  it("并发源文件改变时拒绝冻结并清理本次不完整快照", async () => {
    const root = await repository();
    const service = new ExperimentService(root, {
      afterSnapshotRead: async () => { await writeFile(join(root, "logic.ts"), "changed during freeze\n"); },
    });
    await service.create(draft);
    await expect(service.freeze(draft.experimentId)).rejects.toMatchObject({ code: "baseline-changed" });
    expect((await service.get(draft.experimentId)).state).toBe("draft");
    await expect(readdir(service.snapshotPath(draft.experimentId, 1))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("拒绝不安全身份、越界路径、敏感输入和项目外 symlink", async () => {
    const root = await repository();
    const service = new ExperimentService(root);
    await expect(service.create({ ...draft, experimentId: "../escape" })).rejects.toMatchObject({ code: "invalid-id" });
    await expect(service.create({ ...draft, includeUntracked: ["../secret"] })).rejects.toMatchObject({ code: "invalid-path" });
    await expect(service.create({ ...draft, includeUntracked: [".env"] })).rejects.toMatchObject({ code: "excluded-path" });
    await symlink(tmpdir(), join(root, "external"));
    await service.create({ ...draft, includeUntracked: ["external"] });
    await expect(service.freeze(draft.experimentId)).rejects.toMatchObject({ code: "unsafe-path" });
  });

  it("拒绝 .pi 数据根的 symlink，不能跨项目读写", async () => {
    const root = await repository();
    const other = await repository();
    await mkdir(join(other, ".pi"));
    await symlink(join(other, ".pi"), join(root, ".pi"));
    await expect(new ExperimentService(root).create(draft)).rejects.toMatchObject({ code: "unsafe-path" });
    expect(await readdir(join(other, ".pi"))).toEqual([]);
  });

  it("显示排除项与删除文件，不把超预算内容静默截成完整基线", async () => {
    const root = await repository();
    await writeFile(join(root, ".env"), "secret\n");
    await git(root, "add", ".env");
    await rm(join(root, "logic.ts"));
    const service = new ExperimentService(root);
    await service.create(draft);
    const frozen = await service.freeze(draft.experimentId);
    expect(frozen.baseline?.removedPaths).toContain("logic.ts");
    expect(frozen.baseline?.excluded).toContainEqual({ path: ".env", reason: "sensitive" });
    const limited = new ExperimentService(root, { maxSnapshotBytes: 1 });
    await limited.create({ ...draft, experimentId: "tiny-budget" });
    await expect(limited.freeze("tiny-budget")).rejects.toMatchObject({ code: "snapshot-limit" });
    expect((await limited.get("tiny-budget")).state).toBe("draft");
  });

  it("合法身份 locks/events/snapshots 不与内部目录冲突", async () => {
    const root = await repository();
    const service = new ExperimentService(root);
    for (const experimentId of ["locks", "events", "snapshots"]) {
      await service.create({ ...draft, experimentId });
      expect((await service.freeze(experimentId)).state).toBe("frozen");
    }
    expect(await service.list()).toHaveLength(3);
  });

  it("显式未跟踪输入在 scope 外时明确拒绝，不静默遗漏", async () => {
    const root = await repository();
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "main.ts"), "export {};\n");
    await git(root, "add", "src/main.ts");
    await writeFile(join(root, "fixture.ts"), "export {};\n");
    const service = new ExperimentService(root);
    await service.create({ ...draft, scopes: ["src"], includeUntracked: ["fixture.ts"] });
    await expect(service.freeze(draft.experimentId)).rejects.toMatchObject({ code: "scope-conflict" });
    expect((await service.get(draft.experimentId)).state).toBe("draft");
  });

  it("冻结中取消不会发布 checkpoint 或残留本次快照", async () => {
    const root = await repository();
    const abort = new AbortController();
    const service = new ExperimentService(root, { afterSnapshotRead: async () => abort.abort() });
    await service.create(draft);
    await expect(service.freeze(draft.experimentId, abort.signal)).rejects.toBeTruthy();
    expect((await service.get(draft.experimentId)).state).toBe("draft");
    await expect(readdir(service.snapshotPath(draft.experimentId, 1))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("内核锁保护活跃 owner；进程退出后并发接管仍只允许一个写者", async () => {
    const root = await repository();
    const service = new ExperimentService(root);
    await service.create(draft);
    const lock = join(root, ".pi/agent/experiments/.locks", `${draft.experimentId}.sqlite`);
    const child = spawn(process.execPath, ["--input-type=module", "-e", `import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(${JSON.stringify(lock)}); db.exec('BEGIN IMMEDIATE'); console.log('locked'); setInterval(() => {}, 1000);`], { stdio: ["ignore", "pipe", "pipe"] });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("lock owner did not start")), 5000);
        child.once("error", (error) => { clearTimeout(timer); reject(error); });
        child.stdout.once("data", () => { clearTimeout(timer); resolve(); });
        child.once("exit", () => { clearTimeout(timer); reject(new Error("lock owner exited early")); });
      });
      await expect(service.freeze(draft.experimentId)).rejects.toMatchObject({ code: "experiment-busy" });
      expect(child.exitCode).toBeNull();
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
        child.kill("SIGTERM"); // Only this test-owned Node process.
        await exited;
      }
    }
    let entered!: () => void;
    let release!: () => void;
    const acquired = new Promise<void>((resolve) => { entered = resolve; });
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    let active = 0;
    let maxActive = 0;
    const first = new ExperimentService(root, { afterLockAcquired: async () => { active++; maxActive = Math.max(maxActive, active); entered(); await barrier; } });
    const second = new ExperimentService(root, { afterLockAcquired: async () => { active++; maxActive = Math.max(maxActive, active); } });
    const writing = first.update(draft.experimentId, { question: "恢复后的第一个写者" });
    await acquired;
    try { await expect(second.update(draft.experimentId, { question: "不能并发覆盖" })).rejects.toMatchObject({ code: "experiment-busy" }); }
    finally { release(); }
    await writing;
    active--;
    expect(maxActive).toBe(1);
    expect((await service.get(draft.experimentId)).question).toBe("恢复后的第一个写者");
    expect((await service.update(draft.experimentId, { question: "之后可正常修改" })).sequence).toBe(3);
  });

  it.each([false, true])("重开协调已发布但未提交的快照（先编辑草稿=%s）", async (editDraft) => {
    const root = await repository();
    const service = new ExperimentService(root);
    await service.create(draft);
    const target = service.snapshotPath(draft.experimentId, 1);
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "interrupted.txt"), "保留这份中断证据");
    await writeFile(`${target}.transaction.json`, JSON.stringify({ version: 1, experimentId: draft.experimentId, revision: 1, sequence: 2, temporaryBasename: ".freeze-00000000-0000-0000-0000-000000000000", fingerprint: "interrupted" }));
    if (editDraft) await new ExperimentService(root).update(draft.experimentId, { question: "中断后先编辑" });
    const frozen = await new ExperimentService(root).freeze(draft.experimentId);
    expect(frozen.state).toBe("frozen");
    expect(frozen.question).toBe(editDraft ? "中断后先编辑" : draft.question);
    expect(await readFile(join(target, "logic.ts"), "utf8")).toContain("value = 1");
    const parent = join(root, ".pi/agent/experiments", draft.experimentId, "snapshots");
    const retained = (await readdir(parent)).find((name) => name.startsWith(".interrupted-"));
    expect(retained).toBeTruthy();
    expect(await readFile(join(parent, retained!, "interrupted.txt"), "utf8")).toBe("保留这份中断证据");
  });

  it("checkpoint 临时文件已写但未 rename 时取消，仍不提交冻结", async () => {
    const root = await repository();
    const abort = new AbortController();
    let armed = false;
    const service = new ExperimentService(root, { beforeCommit: async () => { if (armed) abort.abort(); } });
    await service.create(draft);
    armed = true;
    await expect(service.freeze(draft.experimentId, abort.signal)).rejects.toBeTruthy();
    expect((await new ExperimentService(root).get(draft.experimentId)).state).toBe("draft");
    await expect(readdir(service.snapshotPath(draft.experimentId, 1))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readdir(join(root, ".pi/agent/experiments"))).some((name) => name.startsWith(".write-"))).toBe(false);
  });

  it("大 inventory 的 checkpoint 小于48KiB且完整清单可分页追溯", async () => {
    const root = await repository();
    await mkdir(join(root, "src"));
    for (let start = 0; start < 1200; start += 100) {
      await Promise.all(Array.from({ length: 100 }, (_, n) => writeFile(join(root, "src", `fragment-${start + n}.ts`), `export const value = ${start + n};\n`)));
    }
    await git(root, "add", "src");
    const service = new ExperimentService(root);
    await service.create({ ...draft, variants: [{ id: "baseline", hypothesis: "当前实现" }, { id: "wide-recall", hypothesis: "扩大召回提高覆盖" }], metrics: [{ id: "recall", unit: "%", direction: "higher" }] });
    const frozen = await service.freeze(draft.experimentId);
    expect(frozen.baseline?.files).toHaveLength(1202);
    const raw = await readFile(join(root, ".pi/agent/experiments", `${draft.experimentId}.json`));
    expect(raw.length).toBeLessThanOrEqual(48 * 1024);
    const summary = JSON.parse(raw.toString());
    expect(summary.inventory.files.count).toBe(1202);
    expect(summary.previewTruncated).toBe(true);
    expect((await new ExperimentService(root).get(draft.experimentId)).baseline?.files).toHaveLength(1202);
    const items: unknown[] = [];
    for (let page = 1; page <= summary.inventory.files.pages; page++) items.push(...(await service.inventory(draft.experimentId, "files", page)).items);
    expect(items).toEqual(frozen.baseline?.files);
  }, 20000);

  it("同名实验在不同项目互不可见", async () => {
    const one = await repository();
    const two = await repository();
    await new ExperimentService(one).create(draft);
    expect(await new ExperimentService(two).list()).toEqual([]);
    await expect(new ExperimentService(two).get(draft.experimentId)).rejects.toMatchObject({ code: "experiment-not-found" });
  });
});
