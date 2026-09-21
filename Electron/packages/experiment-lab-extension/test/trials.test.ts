import { afterEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExperimentService } from "../agent/service.js";
import { commandCases } from "../agent/cases.js";
import { TrialCoordinator } from "../agent/trials.js";
import type { SandboxDriver, SandboxRunRequest, SandboxRunResult } from "../agent/sandbox-contract.js";

const roots: string[] = [];
const coordinators: TrialCoordinator[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(coordinators.splice(0).map((value) => value.shutdown())); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const success = (): SandboxRunResult => ({ state: "exited", exitCode: 0, signal: null, stdout: "unit output", stderr: "", stdoutBytes: 11, stderrBytes: 0, stdoutTruncated: false, stderrTruncated: false, totalWallMs: 2, workloadWallMs: 1, sandbox: { applied: true, version: "unit-fake", platform: process.platform, warnings: [] } });
async function fixture(options: { checks?: boolean; maxTrials?: number; timeout?: number; totalTimeout?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), "experiment-trials-")); roots.push(root);
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  git("init", "-b", "main"); git("config", "user.email", "fixture@example.invalid"); git("config", "user.name", "Fixture");
  await writeFile(join(root, ".gitignore"), ".pi/\n"); await writeFile(join(root, "input.txt"), "frozen input\n"); git("add", "."); git("commit", "-m", "fixture");
  const store = new ExperimentService(root);
  await store.create({ experimentId: "command-check", question: "命令工作吗？", metrics: [{ id: "score", unit: "%", direction: "higher" }], budget: { maxTrials: options.maxTrials ?? 60, trialTimeoutMs: options.timeout ?? 5000, totalTimeoutMs: options.totalTimeout ?? 1800000 }, cases: commandCases([{ id: "smoke", command: { executable: "node", args: ["task.js"] }, checks: options.checks === false ? [] : [{ path: "result.txt", expectedText: "ok\n" }], metricsFile: "metrics.json" }]) });
  await store.freeze("command-check");
  const requests: SandboxRunRequest[] = [];
  const run = vi.fn(async (request: SandboxRunRequest) => { requests.push(request); await writeFile(join(request.workspaceRoot, "result.txt"), "ok\n"); await writeFile(join(request.workspaceRoot, "metrics.json"), '{"score":90}'); return success(); });
  const driver: SandboxDriver = { probe: async () => ({ available: true, version: "unit-fake", platform: process.platform, errors: [], warnings: [] }), run };
  const coordinator = new TrialCoordinator(root, { store, driver, availability: async () => ({ enabled: true }), availabilityPollMs: 10 }); coordinators.push(coordinator);
  return { root, store, driver, run, requests, coordinator };
}

it("冻结定义驱动单次运行，记录独立工作区、真实结果来源与固定检查", async () => {
  const f = await fixture();
  const started = await f.coordinator.start({ experimentId: "command-check", caseId: "smoke", requestId: "request-one" });
  expect(started.trial.state).toBe("queued");
  const result = await f.coordinator.wait("command-check", started.trial.id);
  expect(result).toMatchObject({ state: "succeeded", quality: "pass", caseId: "smoke", variantId: "baseline", checks: [{ path: "result.txt", passed: true }] });
  expect(result.metrics).toContainEqual({ id: "score", value: 90, unit: "%", source: "workload-output" });
  expect(result.metrics.some((metric) => metric.id === "workload-wall-ms" && metric.source === "runtime")).toBe(true);
  expect(f.requests[0].workspaceRoot).not.toBe(f.root);
  expect(f.requests[0].protectedReadRoots).toContain(await realpath(f.root));
  expect(f.requests[0].allowedDomains).toEqual([]);
  expect(await readFile(join(f.root, "input.txt"), "utf8")).toBe("frozen input\n");
  expect((await f.store.get("command-check")).state).toBe("frozen");
});

it("同一请求重放只返回旧trial，不重复执行或耗尽预算", async () => {
  const f = await fixture({ maxTrials: 1 });
  const input = { experimentId: "command-check", caseId: "smoke", requestId: "request-one" };
  const first = await f.coordinator.start(input); await f.coordinator.wait("command-check", first.trial.id);
  const second = await f.coordinator.start(input);
  expect(second.reused).toBe(true); expect(second.trial.id).toBe(first.trial.id); expect(f.run).toHaveBeenCalledTimes(1);
  await expect(f.coordinator.start({ ...input, requestId: "new-request" })).rejects.toMatchObject({ code: "budget-exhausted" });
});

it("无固定检查不把退出0冒充质量通过", async () => {
  const f = await fixture({ checks: false });
  const start = await f.coordinator.start({ experimentId: "command-check", caseId: "smoke", requestId: "one" });
  expect(await f.coordinator.wait("command-check", start.trial.id)).toMatchObject({ state: "succeeded", quality: "unknown" });
});

it("缺失指标和错误输出保留失败记录，不从分母删除", async () => {
  const f = await fixture();
  f.run.mockImplementationOnce(async () => success());
  const start = await f.coordinator.start({ experimentId: "command-check", caseId: "smoke", requestId: "bad-output" });
  const result = await f.coordinator.wait("command-check", start.trial.id);
  expect(result.state).toBe("failed"); expect(result.quality).toBe("fail");
  expect((await f.coordinator.list("command-check"))).toHaveLength(1);
});

it("禁用时不调driver；运行中撤销会取消，而不是继续排工作", async () => {
  const f = await fixture(); let enabled = false;
  const coordinator = new TrialCoordinator(f.root, { store: f.store, driver: f.driver, availability: async () => ({ enabled, reason: "extension-disabled" }), availabilityPollMs: 5 }); coordinators.push(coordinator);
  await expect(coordinator.start({ experimentId: "command-check", caseId: "smoke", requestId: "disabled" })).rejects.toMatchObject({ code: "extension-disabled" });
  expect(f.run).not.toHaveBeenCalled();
  enabled = true;
  f.driver.run = async (_request, options) => new Promise((resolve) => {
    options?.onProgress?.({ phase: "running", elapsedMs: 0, stdoutBytes: 0, stderrBytes: 0 });
    options?.signal?.addEventListener("abort", () => resolve({ ...success(), state: "cancelled", exitCode: null }), { once: true });
    enabled = false;
  });
  const start = await coordinator.start({ experimentId: "command-check", caseId: "smoke", requestId: "revoke" });
  expect(await coordinator.wait("command-check", start.trial.id)).toMatchObject({ state: "cancelled", reason: "extension-disabled" });
});

it("两个实验可使用同名trial，取消不会串到另一个实验", async () => {
  const f = await fixture();
  const original = await f.store.get("command-check");
  await f.store.create({ experimentId: "other-check", question: "另一个实验", cases: original.cases });
  await f.store.freeze("other-check");
  f.driver.run = async (_request, options) => new Promise((resolve) => {
    if (options?.signal?.aborted) resolve({ ...success(), state: "cancelled", exitCode: null });
    else options?.signal?.addEventListener("abort", () => resolve({ ...success(), state: "cancelled", exitCode: null }), { once: true });
  });
  const a = await f.coordinator.start({ experimentId: "command-check", caseId: "smoke", requestId: "a" });
  const b = await f.coordinator.start({ experimentId: "other-check", caseId: "smoke", requestId: "b" });
  expect(a.trial.id).toBe(b.trial.id);
  await f.coordinator.cancel("command-check", a.trial.id);
  expect((await f.coordinator.wait("command-check", a.trial.id)).state).toBe("cancelled");
  expect(["queued", "preparing", "running"]).toContain((await f.coordinator.status("other-check", b.trial.id)).state);
  await f.coordinator.cancel("other-check", b.trial.id);
  expect((await f.coordinator.wait("other-check", b.trial.id)).state).toBe("cancelled");
});

it("无applied证据不接受退出0；开始前取消不创建运行", async () => {
  const f = await fixture();
  await expect(f.coordinator.start({ experimentId: "command-check", caseId: "smoke", requestId: "aborted" }, AbortSignal.abort())).rejects.toBeTruthy();
  expect(await f.coordinator.list("command-check")).toEqual([]);
  f.driver.run = async () => ({ ...success(), sandbox: { ...success().sandbox, applied: false } });
  const start = await f.coordinator.start({ experimentId: "command-check", caseId: "smoke", requestId: "no-proof" });
  expect(await f.coordinator.wait("command-check", start.trial.id)).toMatchObject({ state: "invalid", quality: "unknown", reason: "sandbox-not-applied" });
});

it("验证器不跟随被测输出的symlink读取正式树", async () => {
  const f = await fixture();
  await writeFile(join(f.root, "private-metric.json"), '{"score":123456789}');
  f.driver.run = async (request) => {
    await writeFile(join(request.workspaceRoot, "result.txt"), "ok\n");
    await symlink(join(f.root, "private-metric.json"), join(request.workspaceRoot, "metrics.json"));
    return success();
  };
  const start = await f.coordinator.start({ experimentId: "command-check", caseId: "smoke", requestId: "symlink" });
  const result = await f.coordinator.wait("command-check", start.trial.id);
  expect(result).toMatchObject({ state: "failed", reason: "metrics-invalid-or-missing" });
  expect(result.metrics.find((metric) => metric.id === "score")?.value).toBeNull();
});

it("状态查询协调已退出owner的中断记录，不自动重跑或盲目清理", async () => {
  const f = await fixture();
  const start = await f.coordinator.start({ experimentId: "command-check", caseId: "smoke", requestId: "recover" });
  const finished = await f.coordinator.wait("command-check", start.trial.id);
  // Model a crash during verification; the old PID is now a live unrelated owner.
  // The per-trial kernel lease has been released and cannot be revived by that PID.
  const orphan = { ...finished, state: "verifying", phase: "verifying", quality: "unknown", endedAt: undefined, owner: { ...finished.owner, pid: process.pid } };
  await writeFile(join(f.root, `.pi/agent/experiments/command-check/runs/${finished.id}/events/${String(finished.sequence).padStart(8, "0")}.json`), JSON.stringify(orphan) + "\n");
  await writeFile(join(f.root, `.pi/agent/experiments/command-check/runs/${finished.id}.json`), JSON.stringify(orphan) + "\n");
  const reopened = new TrialCoordinator(f.root, { store: f.store, driver: f.driver, availability: async () => ({ enabled: true }) }); coordinators.push(reopened);
  expect(await reopened.status("command-check", finished.id)).toMatchObject({ state: "interrupted", quality: "unknown", reason: "owner-not-active" });
  const repeated = await reopened.start({ experimentId: "command-check", caseId: "smoke", requestId: "recover" });
  expect(repeated).toMatchObject({ reused: true, trial: { state: "interrupted" } });
  expect(f.run).toHaveBeenCalledTimes(1);
  await expect(reopened.cleanup("command-check", finished.id)).rejects.toMatchObject({ code: "cleanup-unconfirmed" });
});

it("整体预算由首次运行固定，后续启动和重放不会补满", async () => {
  const f = await fixture({ totalTimeout: 10000 });
  const input = { experimentId: "command-check", caseId: "smoke", requestId: "first" };
  const start = await f.coordinator.start(input);
  const result = await f.coordinator.wait("command-check", start.trial.id);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(result.budgetDeadlineAt!) + 1);
  await expect(f.coordinator.start({ ...input, requestId: "second" })).rejects.toMatchObject({ code: "budget-exhausted" });
  const replay = await f.coordinator.start(input);
  expect(replay).toMatchObject({ reused: true, trial: { budgetDeadlineAt: result.budgetDeadlineAt } });
  expect(f.run).toHaveBeenCalledTimes(1);
});

it("终态事件领先快照时恢复该事件，不能改写为interrupted", async () => {
  const f = await fixture();
  const start = await f.coordinator.start({ experimentId: "command-check", caseId: "smoke", requestId: "terminal-event" });
  const final = await f.coordinator.wait("command-check", start.trial.id);
  const directory = join(f.root, `.pi/agent/experiments/command-check/runs/${final.id}`);
  const terminalPath = join(directory, `events/${String(final.sequence).padStart(8, "0")}.json`);
  const terminal = await readFile(terminalPath, "utf8");
  const before = await readFile(join(directory, `events/${String(final.sequence - 1).padStart(8, "0")}.json`), "utf8");
  const snapshot = join(f.root, `.pi/agent/experiments/command-check/runs/${final.id}.json`);
  await writeFile(snapshot, before);
  const reopened = new TrialCoordinator(f.root, { store: f.store, driver: f.driver, availability: async () => ({ enabled: true }) }); coordinators.push(reopened);
  expect(await reopened.status("command-check", final.id)).toEqual(final);
  expect(await readFile(terminalPath, "utf8")).toBe(terminal);
  expect(JSON.parse(await readFile(snapshot, "utf8"))).toEqual(final);
});

it.each([true, false])("清理后仍保留原始指标与指纹（JSON合法=%s）", async (valid) => {
  const f = await fixture();
  f.driver.run = async (request) => {
    await writeFile(join(request.workspaceRoot, "result.txt"), "ok\n");
    await writeFile(join(request.workspaceRoot, "metrics.json"), valid ? '{"score":90}' : 'not-json');
    return success();
  };
  const start = await f.coordinator.start({ experimentId: "command-check", caseId: "smoke", requestId: "metric-proof" });
  const result = await f.coordinator.wait("command-check", start.trial.id);
  expect(result.metricEvidence?.validation).toBe(valid ? "valid" : "invalid");
  expect(result.metricEvidence?.sha256).toMatch(/^[a-f0-9]{64}$/);
  await f.coordinator.cleanup("command-check", result.id);
  expect(await readFile(join(f.root, result.metricEvidence!.path), "utf8")).toBe(valid ? '{"score":90}' : 'not-json');
});

it("超时与主动取消分类正确，清理只允许已终止的副本", async () => {
  const f = await fixture({ timeout: 80 });
  f.driver.run = async (_request, options) => new Promise((resolve) => options?.signal?.addEventListener("abort", () => resolve({ ...success(), state: "cancelled", exitCode: null }), { once: true }));
  const start = await f.coordinator.start({ experimentId: "command-check", caseId: "smoke", requestId: "timeout" });
  await expect(f.coordinator.cleanup("command-check", start.trial.id)).rejects.toMatchObject({ code: "trial-active" });
  const result = await f.coordinator.wait("command-check", start.trial.id);
  expect(result.state).toBe("timed-out"); expect(result.quality).toBe("unknown");
  expect((await f.coordinator.cleanup("command-check", start.trial.id)).workspaceCleaned).toBe(true);
  expect((await f.store.get("command-check")).baseline).toBeTruthy();
});
