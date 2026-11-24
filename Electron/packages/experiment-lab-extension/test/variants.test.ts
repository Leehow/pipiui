import { afterEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ExperimentService } from "../agent/service.js";
import { VariantStore } from "../agent/variants.js";
import { registerGitWorktreePlacementProviderV1, requestGitWorktreePlacementProviderV1 } from "../../../resources/runtime/extensions/git-capability/agent/worktree-service.ts";
import { resolveSubagentWorktree } from "../../../resources/runtime/extensions/git-capability/agent/worktree-placement.ts";

const exec = promisify(execFile);
const roots: string[] = [];
const experimentId = "prototype-comparison";
const variantId = "fast-path";
async function git(root: string, ...args: string[]) { return (await exec("git", ["-C", root, ...args], { env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } })).stdout; }
async function repo() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "experiment-variants-")));
  roots.push(root);
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.name", "Experiment fixture");
  await git(root, "config", "user.email", "fixture@example.invalid");
  await writeFile(join(root, ".gitignore"), ".pi/\nnode_modules/\n");
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src/logic.ts"), "baseline\n");
  await writeFile(join(root, "src/remove.ts"), "remove me\n");
  await writeFile(join(root, "src/check.ts"), "fixed validation\n");
  await writeFile(join(root, "outside.txt"), "outside\n");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "fixture baseline");
  return root;
}
function provider() { registerGitWorktreePlacementProviderV1(); return requestGitWorktreePlacementProviderV1()!; }
async function setup(root: string, scopes = ["."]) {
  const store = new ExperimentService(root);
  await store.create({ experimentId, question: "候选是否改善？", scopes, variants: [{ id: "baseline", hypothesis: "当前实现" }, { id: variantId, hypothesis: "缩短路径" }] });
  await store.freeze(experimentId);
  return { store, variants: new VariantStore(root, { store, placement: provider() }) };
}
const prepare = { experimentId, variantId, agentId: "prototype-fast" };
afterEach(async () => {
  vi.unstubAllEnvs();
  delete (globalThis as Record<PropertyKey, unknown>)[Symbol.for("pipiui.git-capability.worktree-placement-provider.v1")];
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("真实 Git 原型准备与不可变候选", () => {
  it("基于含dirty/未跟踪/删除的原冻结输入准备，不受后来HEAD或环境opt-out影响，主树/index不变", async () => {
    const root = await repo();
    await writeFile(join(root, "src/logic.ts"), "staged\n");
    await git(root, "add", "src/logic.ts");
    await writeFile(join(root, "src/logic.ts"), "frozen dirty\n");
    await writeFile(join(root, "src/extra.ts"), "untracked baseline\n");
    await rm(join(root, "src/remove.ts"));
    const store = new ExperimentService(root);
    await store.create({ experimentId, question: "原型测试", includeUntracked: ["src/extra.ts"], variants: [{ id: "baseline", hypothesis: "原实现" }, { id: variantId, hypothesis: "新实现" }] });
    const baseline = await store.freeze(experimentId);
    await git(root, "commit", "-m", "later HEAD");
    await writeFile(join(root, "src/later.ts"), "not in baseline\n");
    await git(root, "add", "src/later.ts");
    await git(root, "commit", "-m", "later added source");
    const head = await git(root, "rev-parse", "HEAD");
    const index = await readFile(join(root, ".git/index"));
    const status = await git(root, "status", "--porcelain=v1", "-z");
    vi.stubEnv("PIPIUI_WORKTREE", "0");
    const variants = new VariantStore(root, { store, placement: provider() });
    const workspace = await variants.prepare(prepare);
    expect(workspace).toMatchObject({ ...prepare, mergePolicy: "never", revision: 1 });
    expect(await git(workspace.path, "rev-parse", "--show-toplevel")).toBe(`${workspace.path}\n`);
    expect(await readFile(join(workspace.path, "src/logic.ts"), "utf8")).toBe("frozen dirty\n");
    expect(await readFile(join(workspace.path, "src/extra.ts"), "utf8")).toBe("untracked baseline\n");
    expect(await readdir(join(workspace.path, "src"))).not.toContain("remove.ts");
    expect(await readdir(join(workspace.path, "src"))).not.toContain("later.ts");
    expect(JSON.parse(await readFile(join(root, ".pi/worktree-policies/prototype-fast.json"), "utf8"))).toMatchObject({ mergePolicy: "never", agentId: prepare.agentId });
    expect((await variants.read(experimentId, "baseline")).fingerprint).toBe(baseline.baseline!.fingerprint);
    expect(await git(root, "rev-parse", "HEAD")).toBe(head);
    expect(await readFile(join(root, ".git/index"))).toEqual(index);
    expect(await git(root, "status", "--porcelain=v1", "-z")).toBe(status);
  });

  it("候选修改/新增/删除冻结可回读复制，后续工作树修改不污染输入，同修订幂等且可查差异", async () => {
    const root = await repo();
    const { variants } = await setup(root);
    const index = await readFile(join(root, ".git/index"));
    const workspace = await variants.prepare({ ...prepare, validationPaths: ["src/check.ts"] });
    await writeFile(join(workspace.path, "src/logic.ts"), "candidate\n");
    await writeFile(join(workspace.path, "src/new.ts"), "new\n");
    await rm(join(workspace.path, "src/remove.ts"));
    await expect(variants.freeze(experimentId, variantId)).rejects.toMatchObject({ code: "undeclared-input" });
    const frozen = await variants.freeze(experimentId, variantId, 1, ["src/new.ts"]);
    expect(frozen.files.map((file) => file.path)).toContain("src/new.ts");
    expect(frozen.files.map((file) => file.path)).not.toContain("src/remove.ts");
    const saved = JSON.parse(await readFile(join(root, ".pi/agent/experiments", experimentId, "variants/revision-1/fast-path.frozen.json"), "utf8"));
    expect(saved.changes).toEqual({ added: ["src/new.ts"], modified: ["src/logic.ts"], removed: ["src/remove.ts"] });
    await writeFile(join(workspace.path, "src/logic.ts"), "later edit\n");
    const reopened = new VariantStore(root);
    expect(await reopened.read(experimentId, variantId)).toEqual(frozen);
    expect(await reopened.freeze(experimentId, variantId)).toEqual(frozen);
    expect((await reopened.list(experimentId)).map((item) => item.id)).toEqual(["baseline", variantId]);
    const target = join(root, ".pi/agent/experiments", experimentId, "batches/sample/trials/first/workspace");
    await reopened.materialize(frozen, target);
    expect(await readFile(join(target, "src/logic.ts"), "utf8")).toBe("candidate\n");
    await writeFile(join(target, "src/logic.ts"), "trial mutation\n");
    expect(await readFile(join(frozen.snapshotPath, "src/logic.ts"), "utf8")).toBe("candidate\n");
    expect(await readFile(join(root, ".git/index"))).toEqual(index);
    await expect(reopened.materialize(frozen, target)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(join(target, "src/logic.ts"), "utf8")).toBe("trial mutation\n");
    const next = new AbortController(); next.abort();
    await expect(reopened.materialize(frozen, `${target}-cancelled`, next.signal)).rejects.toBeTruthy();
  });

  it("正常Worker的私有提交可冻结；不同起点的HEAD仍拒绝，主树不变", async () => {
    const root = await repo();
    const { variants } = await setup(root);
    const mainHead = await git(root, "rev-parse", "HEAD");
    const mainIndex = await readFile(join(root, ".git/index"));
    const workspace = await variants.prepare(prepare);
    await writeFile(join(workspace.path, "src/logic.ts"), "committed prototype\n");
    await git(workspace.path, "add", "src/logic.ts");
    await git(workspace.path, "commit", "-m", "private prototype checkpoint");
    expect(await variants.prepare(prepare)).toEqual(workspace);
    const frozen = await variants.freeze(experimentId, variantId);
    const target = join(root, ".pi/agent/experiments", experimentId, "batches/committed/trials/first/workspace");
    await variants.materialize(frozen, target);
    expect(await readFile(join(target, "src/logic.ts"), "utf8")).toBe("committed prototype\n");
    expect(await git(root, "rev-parse", "HEAD")).toBe(mainHead);
    expect(await readFile(join(root, ".git/index"))).toEqual(mainIndex);
    const tree = (await git(workspace.path, "rev-parse", "HEAD^{tree}")).trim();
    const unrelated = (await git(workspace.path, "commit-tree", tree, "-m", "unrelated root")).trim();
    await git(workspace.path, "reset", "--hard", unrelated);
    await expect(variants.prepare(prepare)).rejects.toMatchObject({ code: "workspace-mismatch" });
    expect(await variants.read(experimentId, variantId)).toEqual(frozen);
  });

  it("发布失败保留孤立快照但不阻塞重试，不覆盖无归属旧目录", async () => {
    const root = await repo();
    const { store, variants } = await setup(root);
    const workspace = await variants.prepare(prepare);
    const oldPath = join(root, ".pi/agent/experiments", experimentId, "variants/revision-1/fast-path.snapshot");
    await mkdir(oldPath);
    await writeFile(join(oldPath, "precious.txt"), "unregistered evidence\n");
    await writeFile(join(workspace.path, "src/logic.ts"), "first attempt\n");
    let unpublishedPath = "";
    const failing = new VariantStore(root, { store, beforeFrozenRecord: async (frozen) => { unpublishedPath = frozen.snapshotPath; throw new Error("injected publication failure"); } });
    await expect(failing.freeze(experimentId, variantId)).rejects.toThrow("injected publication failure");
    await expect(variants.read(experimentId, variantId)).rejects.toMatchObject({ code: "variant-not-frozen" });
    expect(await readFile(join(unpublishedPath, "src/logic.ts"), "utf8")).toBe("first attempt\n");
    await writeFile(join(workspace.path, "src/logic.ts"), "retry input\n");
    const frozen = await new VariantStore(root).freeze(experimentId, variantId);
    expect(frozen.snapshotPath).not.toBe(unpublishedPath);
    expect(frozen.snapshotPath).not.toBe(oldPath);
    expect(await readFile(join(frozen.snapshotPath, "src/logic.ts"), "utf8")).toBe("retry input\n");
    expect(await readFile(join(unpublishedPath, "src/logic.ts"), "utf8")).toBe("first attempt\n");
    expect(await readFile(join(oldPath, "precious.txt"), "utf8")).toBe("unregistered evidence\n");
    expect(await variants.read(experimentId, variantId)).toEqual(frozen);
  });

  it("显式验证源码不得改或删除；范围外修改/新增拒绝，普通实现仍可改", async () => {
    const root = await repo();
    const { variants } = await setup(root, ["src"]);
    const workspace = await variants.prepare({ ...prepare, validationPaths: ["src/check.ts"] });
    expect(await readdir(workspace.path)).toEqual([".git", "src"]);
    await writeFile(join(workspace.path, "src/check.ts"), "changed validation\n");
    await expect(variants.freeze(experimentId, variantId)).rejects.toMatchObject({ code: "validation-changed" });
    await rm(join(workspace.path, "src/check.ts"));
    await expect(variants.freeze(experimentId, variantId)).rejects.toMatchObject({ code: "validation-changed" });
    await writeFile(join(workspace.path, "src/check.ts"), "fixed validation\n");
    await writeFile(join(workspace.path, "outside.txt"), "out-of-scope\n");
    await expect(variants.freeze(experimentId, variantId)).rejects.toMatchObject({ code: "scope-conflict" });
    await rm(join(workspace.path, "outside.txt"));
    await writeFile(join(workspace.path, "src/logic.ts"), "candidate\n");
    await expect(variants.freeze(experimentId, variantId)).resolves.toMatchObject({ id: variantId });
  });

  it("缺失能力明确报错；baseline只读，agentId不截断，验证路径必须来自基线", async () => {
    const root = await repo();
    const { store } = await setup(root);
    delete (globalThis as Record<PropertyKey, unknown>)[Symbol.for("pipiui.git-capability.worktree-placement-provider.v1")];
    const variants = new VariantStore(root, { store });
    await expect(variants.prepare(prepare)).rejects.toMatchObject({ code: "capability-unavailable" });
    await expect(variants.prepare({ ...prepare, agentId: "candidate-identity-too-long-to-accept" })).rejects.toMatchObject({ code: "invalid-id" });
    await expect(variants.prepare({ ...prepare, variantId: "baseline" })).rejects.toMatchObject({ code: "baseline-read-only" });
    await expect(variants.prepare({ ...prepare, validationPaths: ["missing.ts"] })).rejects.toMatchObject({ code: "invalid-validation-path" });
  });

  it("真实provider拒绝plain/unborn项目，不自动init或提交", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "experiment-unborn-"))); roots.push(root);
    const placement = provider();
    expect(() => placement.resolveExperimentPlacement!({ projectRoot: root, agentId: "candidate-one" })).toThrow("existing HEAD");
    expect(await readdir(root)).toEqual([]);
    await git(root, "init", "-b", "main");
    await writeFile(join(root, "draft.txt"), "user draft\n");
    await git(root, "add", "draft.txt");
    const index = await readFile(join(root, ".git/index"));
    expect(() => placement.resolveExperimentPlacement!({ projectRoot: root, agentId: "candidate-one" })).toThrow("existing HEAD");
    expect(await readFile(join(root, ".git/index"))).toEqual(index);
    expect(await readdir(root)).toEqual([".git", "draft.txt"]);
  });

  it("不接管已有目录/分支/worker树，同归属prepare重试不会覆盖修改", async () => {
    const root = await repo();
    const { variants } = await setup(root);
    await mkdir(join(root, ".pi/worktrees/prototype-fast"), { recursive: true });
    await writeFile(join(root, ".pi/worktrees/prototype-fast/precious.txt"), "keep\n");
    await expect(variants.prepare(prepare)).rejects.toThrow("existing directory");
    expect(await readFile(join(root, ".pi/worktrees/prototype-fast/precious.txt"), "utf8")).toBe("keep\n");
    await git(root, "branch", "pipiui/branch-taken");
    await expect(variants.prepare({ ...prepare, agentId: "branch-taken" })).rejects.toThrow("existing branch");
    const other = resolveSubagentWorktree({ agentId: "other-worker", defaultCwd: root, readOnly: false, policy: { worktree: "isolated" } });
    await writeFile(join(other.cwd, "worker.txt"), "other work\n");
    await expect(variants.prepare({ ...prepare, agentId: "other-worker" })).rejects.toThrow("existing branch");
    expect(await readFile(join(other.cwd, "worker.txt"), "utf8")).toBe("other work\n");
    const owned = await variants.prepare({ ...prepare, agentId: "owned-prototype" });
    await writeFile(join(owned.path, "src/logic.ts"), "edited\n");
    expect(await variants.prepare({ ...prepare, agentId: "owned-prototype" })).toEqual(owned);
    expect(await readFile(join(owned.path, "src/logic.ts"), "utf8")).toBe("edited\n");
    await expect(variants.prepare({ ...prepare, agentId: "new-identity" })).rejects.toMatchObject({ code: "workspace-conflict" });
  });

  it("requireNew原子碰撞拒绝且不删既有空目录；并发prepare只有一个owner", async () => {
    const root = await repo();
    const { variants } = await setup(root);
    const attempts = await Promise.allSettled([variants.prepare(prepare), new VariantStore(root, { placement: provider() }).prepare(prepare)]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const empty = join(root, ".pi/worktrees/empty-reservation");
    await mkdir(empty);
    const result = resolveSubagentWorktree({ agentId: "empty-reservation", defaultCwd: root, readOnly: false, policy: { worktree: "isolated" }, requireNew: true });
    expect(result.worktreeError).toContain("already exists");
    expect(await readdir(empty)).toEqual([]);
  });

  it("两个真实进程争用requireNew时只有一个创建者，不复用或删除胜者树", async () => {
    const root = await repo();
    const module = new URL("../../../resources/runtime/extensions/git-capability/agent/worktree-placement.ts", import.meta.url).href;
    const script = `import { resolveSubagentWorktree } from ${JSON.stringify(module)}; console.log(JSON.stringify(resolveSubagentWorktree(${JSON.stringify({ agentId: "process-race", defaultCwd: root, readOnly: false, policy: { worktree: "isolated" }, requireNew: true })})));`;
    const results = await Promise.all([0, 1].map(async () => JSON.parse((await exec(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } })).stdout)));
    expect(results.filter((result) => result.worktreePath)).toHaveLength(1);
    expect(results.filter((result) => result.worktreeError)).toHaveLength(1);
    const path = join(root, ".pi/worktrees/process-race");
    expect(await readFile(join(path, "src/logic.ts"), "utf8")).toBe("baseline\n");
    expect((await git(root, "worktree", "list", "--porcelain")).split("branch refs/heads/pipiui/process-race")).toHaveLength(2);
  });

  it("跨项目记录/伪造快照/越界目标和symlink拒绝，损坏内容不能复制", async () => {
    const root = await repo();
    const other = await repo();
    const { variants } = await setup(root);
    const foreign = await setup(other);
    await expect(new VariantStore(other, { store: new ExperimentService(root), placement: provider() }).prepare(prepare)).rejects.toMatchObject({ code: "project-mismatch" });
    const workspace = await variants.prepare(prepare);
    await writeFile(join(workspace.path, "src/logic.ts"), "candidate\n");
    const frozen = await variants.freeze(experimentId, variantId);
    const target = join(root, ".pi/agent/experiments", experimentId, "batches/test/workspace");
    await expect(variants.materialize({ ...frozen, snapshotPath: other }, target)).rejects.toMatchObject({ code: "invalid-record" });
    await expect(variants.materialize(frozen, join(other, "outside"))).rejects.toMatchObject({ code: "unsafe-path" });
    await expect(variants.materialize(frozen, join(frozen.snapshotPath, "inside"))).rejects.toMatchObject({ code: "unsafe-path" });
    const link = join(root, ".pi/agent/experiments", experimentId, "link");
    await symlink(other, link);
    await expect(variants.materialize(frozen, join(link, "outside"))).rejects.toMatchObject({ code: "unsafe-path" });
    await cp(join(root, ".pi/agent/experiments", experimentId, "variants"), join(other, ".pi/agent/experiments", experimentId, "variants"), { recursive: true });
    await expect(foreign.variants.read(experimentId, variantId)).rejects.toMatchObject({ code: "invalid-record" });
    await chmod(join(frozen.snapshotPath, "src/logic.ts"), 0o600);
    await writeFile(join(frozen.snapshotPath, "src/logic.ts"), "corrupt\n");
    await expect(variants.materialize(frozen, target)).rejects.toMatchObject({ code: "snapshot-corrupt" });
  });

  it("旧修订可回读且新修订不能占用旧原型，冻结共同定义从主存储读取", async () => {
    const root = await repo();
    const { store, variants } = await setup(root);
    const workspace = await variants.prepare(prepare);
    await writeFile(join(workspace.path, "src/logic.ts"), "first candidate\n");
    const first = await variants.freeze(experimentId, variantId);
    await store.revise(experimentId);
    await store.update(experimentId, { question: "新的固定验证定义" });
    await store.freeze(experimentId);
    await expect(variants.prepare(prepare)).rejects.toThrow("existing branch");
    expect(await variants.read(experimentId, variantId, 1)).toEqual(first);
    await variants.prepare({ ...prepare, agentId: "prototype-next" });
    expect((await variants.freeze(experimentId, variantId)).revision).toBe(2);
    expect(await readFile(join(workspace.path, "src/logic.ts"), "utf8")).toBe("first candidate\n");
  });
});
