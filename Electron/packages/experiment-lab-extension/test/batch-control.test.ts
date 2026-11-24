import { describe, expect, it, vi } from "vitest";
import type { BatchRecord, BatchTrial } from "../agent/batch-contract.js";
import { boundedBatchResponse, executeBatchRequest, summarizeBatch, type BatchControlPort } from "../agent/batch-control.js";

function record(): BatchRecord {
  const trial: BatchTrial = { id: "first", variantId: "baseline", caseId: "write-file", repetition: 1, state: "succeeded", quality: "pass", sequence: 2, createdAt: "2026-01-01T00:00:00Z", checks: [], metrics: [], logBytes: 0, logTruncated: false };
  return { version: 1, id: "first-batch", experimentId: "compare-search", revision: 1, definitionFingerprint: "definition", state: "running", sequence: 1, createdAt: trial.createdAt, deadlineAt: "2026-01-01T00:30:00Z", owner: { generation: "private-owner" }, mode: "comparison", budget: { repetitions: 1, concurrency: 2, maxTrials: 60, totalTimeoutMs: 1800000, trialTimeoutMs: 300000 }, metricDefinitions: [],
    cases: [{ id: "write-file", title: "固定任务", prompt: "A long private task body", checks: [] }],
    variants: [{ id: "baseline", fingerprint: "source", profileFingerprint: "config", environmentKeys: ["PROVIDER_API_KEY"], profile: { id: "current", provider: "scripted", model: "fixture", thinking: "off", tools: ["write"], systemPrompt: "Long system prompt", extensions: ["/trusted/provider.ts"] } }],
    trials: Array.from({ length: 30 }, (_, index) => ({ ...trial, id: `round-${index + 1}`, state: index === 0 ? "queued" : index === 1 ? "waiting-input" : "succeeded" })),
  };
}
function port() {
  const start = vi.fn().mockResolvedValue(record()), get = vi.fn().mockResolvedValue(record()), list = vi.fn().mockResolvedValue([record()]);
  const cancel = vi.fn().mockResolvedValue(record()), respond = vi.fn().mockResolvedValue(undefined), logs = vi.fn().mockResolvedValue({ trialId: "round-one", cursor: 0, nextCursor: 5, totalBytes: 5, text: "hello", truncated: false });
  const cancelTrial = vi.fn().mockResolvedValue(record());
  const view = vi.fn().mockResolvedValue({ mode: "read-only-log", logAvailable: true, ownerState: "this-session", canRespond: false });
  return { start, get, list, cancel, cancelTrial, respond, logs, view } satisfies BatchControlPort;
}

describe("Pi批次控制入口", () => {
  it("从计划项计算真实状态数，分页且不展开任务、长提示或owner", () => {
    const summary = summarizeBatch(record());
    expect(summary.progress).toMatchObject({ total: 30, queued: 1, active: 1, finished: 28 });
    expect(summary.trials).toHaveLength(20);
    expect(summary).not.toHaveProperty("owner");
    expect(summary).not.toHaveProperty("cases");
    expect(summary.variants[0].profile).not.toHaveProperty("systemPrompt");
    expect(summary.variants[0].profile.extensionCount).toBe(1);
    expect(summarizeBatch(record(), "round-30").trials.map((trial) => trial.id)).toEqual(["round-30"]);
    expect(() => summarizeBatch(record(), "missing")).toThrow("trial-not-found");
    expect((boundedBatchResponse({ version: 1, action: "batch_list", batches: [record()] }).batches![0]).trials).toEqual([]);
  });
  it("运行请求映射固定profiles/piCases，分页无效时不启动", async () => {
    const p = port(), saved = record();
    const input = { action: "batch_run" as const, experimentId: saved.experimentId, batchId: saved.id, revision: 1, profiles: saved.variants, piCases: saved.cases, budget: saved.budget, mode: "comparison" as const };
    await expect(executeBatchRequest(p, { ...input, limit: 21 })).rejects.toThrow("invalid-page");
    expect(p.start).not.toHaveBeenCalled();
    await executeBatchRequest(p, input);
    expect(p.start).toHaveBeenCalledWith({ experimentId: saved.experimentId, batchId: saved.id, revision: 1, variants: saved.variants, cases: saved.cases, budget: saved.budget, mode: "comparison" });
  });
  it("日志字节上限和状态页长分开，输入回复绑定准确轮次和请求", async () => {
    const p = port();
    const target = { experimentId: "compare-search", batchId: "first-batch", trialId: "round-one" };
    await executeBatchRequest(p, { ...target, action: "batch_logs", cursor: 10, logLimit: 4096 });
    expect(p.logs).toHaveBeenCalledWith(target.experimentId, target.batchId, target.trialId, 10, 4096);
    expect((await executeBatchRequest(p, { ...target, action: "batch_view" })).view).toMatchObject({ mode: "read-only-log" });
    expect(p.view).toHaveBeenCalledWith(target.experimentId, target.batchId, target.trialId);
    const response = await executeBatchRequest(p, { ...target, action: "batch_respond", inputRequestId: "opaque-request", response: { value: "user input" } });
    expect(p.respond).toHaveBeenCalledWith(target.experimentId, target.batchId, target.trialId, "opaque-request", { value: "user input" });
    expect(response).toEqual({ version: 1, action: "batch_respond", responded: true });
  });
  it("单轮停止精确路由，不把该意图变成整批停止", async () => {
    const p = port();
    await executeBatchRequest(p, { action: "batch_cancel", experimentId: "compare-search", batchId: "first-batch", trialId: "round-one" });
    expect(p.cancelTrial).toHaveBeenCalledWith("compare-search", "first-batch", "round-one");
    expect(p.cancel).not.toHaveBeenCalled();
    await executeBatchRequest(p, { action: "batch_cancel", experimentId: "compare-search", batchId: "first-batch" });
    expect(p.cancel).toHaveBeenCalledOnce();
  });
});
