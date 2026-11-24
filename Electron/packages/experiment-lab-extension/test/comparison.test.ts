import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildComparisonReport, buildImplementationHandoff, createTrustedUserMessageSource, rebuildComparisonReport, type TrustedUserMessageSource } from "../agent/comparison.js";
import type { BatchRecord, BatchTrial, FrozenVariant } from "../agent/batch-contract.js";
import { BatchCoordinator } from "../agent/batches.js";

const at = (ms: number) => new Date(Date.UTC(2026, 0, 1) + ms).toISOString();
function fixture(repetitions = 2) {
  const profile = { id: "scripted", provider: "lab-scripted", model: "fixture", thinking: "off" as const, tools: ["write"] };
  const runtime = { nodePath: "/fixture/node", cliPath: "/fixture/pi.js", version: "0.84.2", cliFingerprint: "pi-fingerprint" };
  const batch: BatchRecord = {
    version: 1, experimentId: "compare-fixture", id: "fair-run", revision: 2, definitionFingerprint: "definition", state: "completed", sequence: 4, createdAt: at(0), endedAt: at(1000), deadlineAt: at(10000), owner: { generation: "fixture-owner" }, mode: "comparison",
    budget: { repetitions, concurrency: 2, maxTrials: 32, trialTimeoutMs: 2000, totalTimeoutMs: 10000 },
    variants: ["slow", "fast"].map((id) => ({ id, profile: { ...profile }, fingerprint: `${id}-fingerprint`, profileFingerprint: "declared-profile" })),
    cases: [{ id: "write-output", title: "固定输出", prompt: "write file", checks: [{ path: "result.txt", expectedText: "ok" }], metricsFile: "metrics.json" }],
    metricDefinitions: [{ id: "work-ms", unit: "ms", direction: "lower" }], trials: [],
  };
  for (const v of batch.variants) for (let repetition = 1; repetition <= repetitions; repetition++) {
    const duration = (v.id === "slow" ? 100 : 40) + (repetition - 1) * 20;
    batch.trials.push({
      id: `${v.id}-write-round-${repetition}`, variantId: v.id, caseId: "write-output", repetition, state: "succeeded", quality: "pass", sequence: repetition, createdAt: at(0), startedAt: at(10), endedAt: at(10 + duration + 30), pid: 100 + batch.trials.length, checks: [{ name: "result.txt", passed: true }], logBytes: 10, logTruncated: false,
      metrics: [{ id: "work-ms", unit: "ms", source: "workload-output", value: duration / 2 }, { id: "runtime-total-ms", unit: "ms", source: "runtime", value: duration + 30 }, { id: "pi-session-ms", unit: "ms", source: "runtime", value: duration }],
      run: { state: "completed", pid: 100 + batch.trials.length, runtime, profile, profileFingerprint: "actual-profile", effectiveSystemPromptFingerprint: "effective-prompt", sessionId: `${v.id}-${repetition}`, startedAt: at(20), endedAt: at(20 + duration), totalMs: duration, answer: "done", usage: { input: 11, output: 7, cacheRead: 0, cacheWrite: 0, total: 18, cost: 0.125, source: "pi-session" }, toolCalls: 1, stderr: "", outputTruncated: false, transportExit: { code: 0, signal: null } },
    });
  }
  const frozenVariants: FrozenVariant[] = batch.variants.map((v) => ({ version: 1, experimentId: batch.experimentId, revision: batch.revision, id: v.id, fingerprint: v.fingerprint, hypothesis: v.id, baselineFingerprint: "same-baseline", frozenAt: at(0), snapshotPath: `/fixture/${v.id}`, files: [] }));
  return { batch, evidence: { frozenVariants }, runtime };
}
const series = (report: ReturnType<typeof buildComparisonReport>, variant = 0, id = "completed-pi-session-ms") => report.perVariant[variant].cases[0].series.find((s) => s.metricId === id)!;
const pair = (report: ReturnType<typeof buildComparisonReport>, id = "completed-pi-session-ms") => report.pairs[0].series.find((s) => s.metricId === id)!;
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

it("快慢固定fixture：保留所有原始点、每case重复统计与右减左配对，不把耗时总和当墙钟", () => {
  const { batch, evidence } = fixture();
  const before = structuredClone(batch), report = buildComparisonReport(batch, evidence);
  expect(batch).toEqual(before);
  expect(report.totals).toMatchObject({ planned: 4, started: 4, distinctCases: 1, repetitions: 2 });
  expect(report.points.map((p) => p.repetition)).toEqual([1, 2, 1, 2]);
  expect(series(report).statistics).toEqual({ n: 2, missing: 0, median: 110, min: 100, max: 120 });
  expect(series(report, 1).statistics.median).toBe(50);
  expect(pair(report).differences.map((d) => d.value)).toEqual([-60, -60]);
  expect(pair(report).statistics.n).toBe(2);
  expect(report.timing).toEqual({ batchWallClockMs: 1000, sumObservedTrialMs: 440, observedTrialCount: 4, missingTrialCount: 0 });
  expect(report.points[0].timing).toMatchObject({ workloadMs: null, preparationMs: null, verificationMs: null, queueMs: 10, totalTrialMs: 130, piSessionMs: 100 });
  expect(report.points[0].metrics[0]).toMatchObject({ source: "workload-output", direction: "lower" });
  expect(report.points[0].verification.source).toBe("coordinator-checks");
  expect(report.points[0].evidence).toMatchObject({ actualProfileFingerprint: "actual-profile", effectiveSystemPromptFingerprint: "effective-prompt" });
  expect(report).not.toHaveProperty("winner"); expect(report).not.toHaveProperty("score");
  expect(report.variants[0]).toMatchObject({ label: "A", revision: 2, fingerprint: "slow-fingerprint", baselineFingerprint: "same-baseline" });
});

it("质量失败、超时、取消、无效、中断与未启动全部计入计划/终态，超时不是完整耗时", () => {
  const { batch, evidence } = fixture(4);
  const changes: Partial<BatchTrial>[] = [
    { state: "failed", quality: "fail", checks: [{ name: "result.txt", passed: false }] },
    { state: "timed-out", quality: "unknown", checks: [] },
    { state: "cancelled", quality: "unknown", checks: [] },
    { state: "invalid", quality: "unknown", run: undefined, pid: undefined, startedAt: undefined, metrics: [], checks: [] },
    { state: "interrupted", quality: "unknown", checks: [] },
  ];
  changes.forEach((change, i) => Object.assign(batch.trials[i], change));
  batch.trials[1].run!.state = "timed-out";
  batch.trials[2].run!.state = "cancelled";
  const report = buildComparisonReport(batch, evidence);
  expect(report.points).toHaveLength(8);
  expect(report.perVariant[0].states).toMatchObject({ failed: 1, "timed-out": 1, cancelled: 1, invalid: 1 });
  expect(report.perVariant[0].qualityRate).toEqual({ passed: 0, actualStarted: 3, allPlanned: 4, perStarted: 0, perPlanned: 0 });
  expect(report.perVariant[0].notStarted).toBe(1);
  expect(report.perVariant[1].states.interrupted).toBe(1);
  expect(report.points[1].timing).toMatchObject({ piSessionMs: 120, completedPiSessionMs: null, censored: true });
  expect(report.points[0].timing.censored).toBe(false); // correctness failure after a completed task
  expect(series(report).statistics.n).toBe(0);
  expect(pair(report).excludedRepetitions).toEqual([1, 2, 3, 4]);
});

it("人工输入与无固定检查不能混入性能子集，usage仍完整保留，不把它们归因候选退化", () => {
  const { batch, evidence } = fixture();
  batch.trials[0].manualInput = true;
  batch.trials[1].quality = "unknown"; batch.trials[1].checks = [];
  batch.trials[0].reason = "provider-rate-limited";
  const report = buildComparisonReport(batch, evidence);
  expect(report.perVariant[0].qualityRate.passed).toBe(1);
  expect(series(report).statistics.n).toBe(0);
  expect(series(report, 0, "tokens-total").statistics.n).toBe(2);
  expect(pair(report).differences).toEqual([]);
  expect(report.points[0]).toMatchObject({ manualInput: true, reason: "provider-rate-limited" });
  expect(report.conditions).toMatchObject({ rateLimiting: "unknown", resourceContention: "possible" });
});

it("缺usage、NaN/Infinity和负费用不补0，报告全体数字保持有限且序列化可重建", () => {
  const { batch, evidence } = fixture();
  batch.trials[0].run!.usage = null;
  batch.trials[1].run!.usage!.total = Infinity;
  batch.trials[1].run!.usage!.input = NaN;
  batch.trials[1].run!.usage!.cost = -1;
  batch.trials[1].run!.totalMs = Infinity;
  batch.trials[1].metrics[0].value = NaN;
  const report = buildComparisonReport(batch, evidence);
  expect(report.points[0].usage.total).toBeNull();
  expect(report.points[1].usage).toMatchObject({ input: null, total: null, cost: { reportedValue: null, source: "unknown" } });
  expect(series(report, 0, "tokens-total").statistics).toEqual({ n: 0, missing: 2, median: null, min: null, max: null });
  expect(report.points[2].usage.cost).toEqual({ reportedValue: 0.125, source: "unknown", currency: "unknown", actualBill: false });
  expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  expect(buildComparisonReport(JSON.parse(JSON.stringify(batch)), evidence)).toEqual(report);
});

it("没有基线证据或冻结证据版本不匹配时仅给描述统计，不产生比较差值", () => {
  const { batch, evidence } = fixture();
  const missing = buildComparisonReport(batch);
  expect(missing.conditions.baseline).toBe("unknown");
  expect(missing.pairs[0].reasons).toContain("baseline-evidence-unknown");
  expect(pair(missing).differences).toEqual([]);
  evidence.frozenVariants[0].revision++;
  expect(buildComparisonReport(batch, evidence).variants[0].baselineFingerprint).toBeNull();
  evidence.frozenVariants[0].revision--;
  evidence.frozenVariants[0].baselineFingerprint = "other-baseline";
  expect(buildComparisonReport(batch, evidence).pairs[0].reasons).toContain("baseline-mismatch");
});

it("不配对/缺记录保持unknown，不能跨测例或轮次凑样本；吞吐批次不给公平差值", () => {
  const { batch, evidence } = fixture();
  batch.trials.pop();
  const report = buildComparisonReport(batch, evidence);
  expect(report.totals).toMatchObject({ planned: 4, recorded: 3, missingRecords: 1, startUnknown: 1 });
  expect(report.points[3]).toMatchObject({ trialId: null, state: "missing-record", started: "unknown", quality: "unknown" });
  expect(pair(report).differences).toHaveLength(1);
  expect(pair(report).excludedRepetitions).toEqual([2]);
  batch.mode = "throughput";
  expect(pair(buildComparisonReport(batch, evidence)).differences).toEqual([]);
  batch.mode = "comparison";
  batch.trials[2].caseId = "another-case";
  const extra = buildComparisonReport(batch, evidence);
  expect(extra.points).toHaveLength(5);
  expect(extra.points[4].planned).toBe(false);
  expect(pair(extra).differences).toEqual([]);
});

it("声明profile差异是显式变量，运行时不一致/缺少实际运行记录则不配对", () => {
  const { batch, evidence } = fixture();
  batch.variants[1].profile = { ...batch.variants[1].profile, model: "alternate" };
  batch.variants[1].profileFingerprint = "other-declared-profile";
  let report = buildComparisonReport(batch, evidence);
  expect(report.conditions.configurationVariables.map((v) => v.field)).toEqual(["profile", "profileFingerprint"]);
  expect(pair(report).statistics.n).toBe(2);
  batch.trials[2].run!.runtime = { ...batch.trials[2].run!.runtime, version: "other" };
  delete batch.trials[3].run;
  report = buildComparisonReport(batch, evidence);
  expect(pair(report).differences).toEqual([]);
});

it("多个case不混合中位数，重复矩阵或超大矩阵明确拒绝", () => {
  const { batch, evidence } = fixture();
  batch.cases.push({ ...batch.cases[0], id: "other-case" });
  const report = buildComparisonReport(batch, evidence);
  expect(report.perVariant[0].cases).toHaveLength(2);
  expect(report.totals.distinctCases).toBe(2);
  expect(series(report).statistics.n).toBe(2);
  batch.trials.push(structuredClone(batch.trials[0]));
  expect(() => buildComparisonReport(batch)).toThrow("duplicate-comparison-trial");
  batch.budget.repetitions = 513;
  expect(() => buildComparisonReport(batch)).toThrow("invalid-comparison-matrix");
});

it("离线从真实BatchCoordinator分文件持久形状read重建，不启动Pi或读全局状态", async () => {
  const { batch, evidence, runtime } = fixture();
  const root = await realpath(await mkdtemp(join(tmpdir(), "lab-comparison-"))); roots.push(root);
  const directory = join(root, ".pi/agent/experiments", batch.experimentId, "batches", batch.id);
  await mkdir(directory, { recursive: true });
  const { trials, ...meta } = batch;
  await writeFile(join(directory, "batch.json"), JSON.stringify({ ...meta, trialIds: trials.map((t) => t.id) }));
  for (const trial of trials) {
    const path = join(directory, "trials", trial.id); await mkdir(path, { recursive: true });
    const { run, ...record } = trial;
    await writeFile(join(path, "trial.json"), JSON.stringify({ ...record, run: { state: run!.state, totalMs: run!.totalMs, usage: run!.usage, toolCalls: run!.toolCalls } }));
    await writeFile(join(path, "run.json"), JSON.stringify(run));
  }
  const coordinator = new BatchCoordinator(root, { runtime });
  try {
    const rebuilt = await rebuildComparisonReport(coordinator, batch.experimentId, batch.id, evidence);
    expect(rebuilt).toEqual(buildComparisonReport(batch, evidence));
    expect(rebuilt.points[0].evidence.actualProfileFingerprint).toBe("actual-profile");
  } finally { await coordinator.shutdown(); }
});

it.each(["按 A 正式实现", "采用fast实现", "请采用 fast 正式实现！"])("可信Pi用户消息选择产生精确版本交接：%s", async (text) => {
  const { batch, evidence } = fixture(), report = buildComparisonReport(batch, evidence);
  const source = createTrustedUserMessageSource(async (entryId) => ({ role: "user", text, entryId, sessionId: "host-session", reportFingerprint: report.fingerprint }));
  const result = await buildImplementationHandoff(report, { reportFingerprint: report.fingerprint, userEntryId: "user-choice" }, source);
  expect(result.status).toBe("implementation-handoff");
  expect(result.selection).toMatchObject({ variantId: text.includes("A") ? "slow" : "fast", revision: 2, fingerprint: text.includes("A") ? "slow-fingerprint" : "fast-fingerprint" });
  expect(result).toMatchObject({ reportFingerprint: report.fingerprint, mergePolicy: "never", automaticImplementation: false, userEvidence: { entryId: "user-choice", sessionId: "host-session" } });
  expect(result.requirements.join(" ")).toContain("mock/stub");
  expect(result.unverified.join(" ")).toContain("主树");
});

it.each(["继续", "可以", "实现功能", "建议按A正式实现", "不要按A正式实现", "引用：按A正式实现", "按A或B正式实现", "按A正式实现吗", "按A正式实现，然后删除项目"])("泛泛/否定/引用/歧义消息不是采纳：%s", async (text) => {
  const { batch } = fixture(), report = buildComparisonReport(batch);
  const source = createTrustedUserMessageSource(async (entryId) => ({ role: "user", text, entryId, sessionId: "host", reportFingerprint: report.fingerprint }));
  expect((await buildImplementationHandoff(report, { reportFingerprint: report.fingerprint, userEntryId: "choice" }, source)).status).toBe("suggestion-draft");
});

it("模型来源字符串/伪造user对象不可信；绑定旧report或篡改报告不能采纳", async () => {
  const { batch } = fixture(), report = buildComparisonReport(batch);
  const forged = { source: "user", role: "user", text: "按A正式实现" } as unknown as TrustedUserMessageSource;
  expect((await buildImplementationHandoff(report, { reportFingerprint: report.fingerprint, userEntryId: "choice", suggestedVariantId: "fast" }, forged))).toMatchObject({ status: "suggestion-draft", userEvidence: null, selection: { variantId: "fast" } });
  const source = createTrustedUserMessageSource(async (entryId) => ({ entryId, sessionId: "host", role: "user", text: "按A正式实现", reportFingerprint: "old-report" }));
  expect((await buildImplementationHandoff(report, { reportFingerprint: report.fingerprint, userEntryId: "choice" }, source)).reason).toBe("user-entry-or-report-binding-mismatch");
  expect((await buildImplementationHandoff(report, { reportFingerprint: "old-report", userEntryId: "choice" }, source)).reason).toBe("report-fingerprint-mismatch");
  report.variants[0].fingerprint = "modified";
  await expect(buildImplementationHandoff(report, { reportFingerprint: report.fingerprint })).rejects.toThrow("comparison-report-tampered");
});
