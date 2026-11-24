// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ExtensionHostAPI } from "@pipiui/extension-api";
import { createComponent } from "../app/panel.js";
import { boundedBatchResponse } from "../agent/batch-control.js";
import { boundedComparisonResponse } from "../agent/comparison-control.js";
import { buildComparisonReport } from "../agent/comparison.js";
import type { BatchRecord } from "../agent/batch-contract.js";

const Panel = createComponent(React);
const experiment = { version: 1, id: "search-contrast", projectRoot: "/project", revision: 1, sequence: 1, state: "frozen", kind: "pi", question: "比较两个检索方案", scopes: ["."], includeUntracked: [], metrics: [], variants: [], budget: { repetitions: 1, concurrency: 1, maxTrials: 4, trialTimeoutMs: 60000, totalTimeoutMs: 120000 }, updatedAt: "2026-01-01" };
const batch: BatchRecord = { version: 1, id: "first-comparison", experimentId: experiment.id, revision: 1, definitionFingerprint: "definition", state: "completed", sequence: 2, createdAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-01T00:00:01Z", deadlineAt: "2026-01-01T00:02:00Z", owner: { generation: "internal" }, mode: "comparison", budget: experiment.budget, metricDefinitions: [], variants: [{ id: "baseline", fingerprint: "frozen", profileFingerprint: "profile", profile: { id: "declared", provider: "fixture", model: "fixture", thinking: "off", tools: [] } }], cases: [{ id: "lookup", title: "定位", prompt: "fixture", checks: [] }], trials: [] };
function listReceipt(requestId?: string) { return boundedBatchResponse({ version: 1, action: "batch_list", requestId, batches: [batch] }); }
function reportReceipt(requestId?: string) { return boundedComparisonResponse({ version: 1, action: "batch_report", requestId, report: buildComparisonReport(batch), evidence: { batchPath: "batch.json", recordFingerprint: "record", frozenVariants: [] } }); }
function fixture() {
  const listeners = new Set<Parameters<ExtensionHostAPI["subscribeExt"]>[0]>();
  const invoke = vi.fn<NonNullable<ExtensionHostAPI["invoke"]>>(async (method, params) => {
    const { requestId } = params as { requestId: string };
    return { ok: true, data: method === "batch_list" ? listReceipt(requestId) : reportReceipt(requestId) };
  });
  const api: ExtensionHostAPI = {
    invoke,
    subscribeExt(callback) { listeners.add(callback); return () => { listeners.delete(callback); }; },
    data: {
      list: async () => [{ name: `${experiment.id}.json`, bytes: 1, mtime: 1 }, { name: "other-experiment.json", bytes: 1, mtime: 1 }],
      read: async (path) => ({ content: JSON.stringify(path.includes("other-experiment") ? { ...experiment, id: "other-experiment", question: "另一实验" } : experiment), bytes: 100, truncated: false }),
    },
  };
  const emit = (payload: unknown) => listeners.forEach((listener) => listener({ type: "result", payload } as Parameters<typeof listener>[0]));
  return { api, invoke, emit };
}
async function selectExperiment(id = experiment.id) {
  await screen.findByRole("article", { name: experiment.question });
  fireEvent.change(screen.getByRole("combobox", { name: "查看实验" }), { target: { value: id } });
}
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("只读查看器手动读取真实控制层摘要，不自动run/adopt或扩大配置表单", async () => {
  const f = fixture(); render(<Panel api={f.api} />);
  expect(screen.getByText(/请在主聊天说/)).toBeTruthy();
  await selectExperiment();
  expect(f.invoke).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /采用|合并|启动 Pi/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "读取已有 Pi 批次" }));
  fireEvent.click(await screen.findByRole("button", { name: `查看报告 ${batch.id}` }));
  const report = await screen.findByRole("region", { name: "批次报告摘要" });
  expect(report.textContent).toContain("计划 1 · 实际启动 0");
  expect(report.textContent).toContain("缺失记录 1");
  expect(report.textContent).toContain("unknown");
  expect(report.textContent).toContain("limitations");
  expect(f.invoke.mock.calls.map(([action]) => action)).toEqual(["batch_list", "batch_report"]);
  expect(f.invoke.mock.calls[1][1]).toMatchObject({ experimentId: experiment.id, batchId: batch.id, section: "summary" });
});

it("transport ack等待同requestId的result；无关或切换实验前的结果不污染当前视图", async () => {
  const f = fixture(); f.invoke.mockResolvedValue({ ok: true, data: { accepted: true } });
  render(<Panel api={f.api} />); await selectExperiment();
  fireEvent.click(screen.getByRole("button", { name: "读取已有 Pi 批次" }));
  await waitFor(() => expect(f.invoke).toHaveBeenCalledTimes(1));
  const requestId = (f.invoke.mock.calls[0][1] as { requestId: string }).requestId;
  React.act(() => f.emit(listReceipt("unrelated")));
  expect(screen.queryByRole("button", { name: `查看报告 ${batch.id}` })).toBeNull();
  React.act(() => f.emit(listReceipt(requestId)));
  fireEvent.click(await screen.findByRole("button", { name: `查看报告 ${batch.id}` }));
  const reportId = (f.invoke.mock.calls[1][1] as { requestId: string }).requestId;
  await selectExperiment("other-experiment");
  React.act(() => f.emit(reportReceipt(reportId)));
  expect(screen.queryByRole("region", { name: "批次报告摘要" })).toBeNull();
  expect(f.invoke).toHaveBeenCalledTimes(2);
});

it("result报告与直接报告使用相同的只读摘要合同", async () => {
  const f = fixture(); render(<Panel api={f.api} />); await selectExperiment();
  fireEvent.click(screen.getByRole("button", { name: "读取已有 Pi 批次" }));
  const button = await screen.findByRole("button", { name: `查看报告 ${batch.id}` });
  f.invoke.mockResolvedValue({ ok: true, data: { accepted: true } });
  fireEvent.click(button);
  const requestId = (f.invoke.mock.calls[1][1] as { requestId: string }).requestId;
  React.act(() => f.emit(reportReceipt(requestId)));
  expect(await screen.findByRole("region", { name: "批次报告摘要" })).toBeTruthy();
});

it("无会话错误可关闭，重试只读取列表", async () => {
  const f = fixture(); f.invoke.mockResolvedValueOnce({ ok: false, error: { code: "no_session", message: "请打开项目会话" } });
  render(<Panel api={f.api} />); await selectExperiment();
  fireEvent.click(screen.getByRole("button", { name: "读取已有 Pi 批次" }));
  expect((await screen.findByRole("alert")).textContent).toContain("请打开项目会话");
  fireEvent.click(screen.getByRole("button", { name: "关闭批次错误" }));
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "读取已有 Pi 批次" }));
  await screen.findByRole("button", { name: `查看报告 ${batch.id}` });
  expect(f.invoke.mock.calls.every(([action]) => action === "batch_list")).toBe(true);
});

it("拒绝跨实验列表和跨批次报告，错误可关闭", async () => {
  const f = fixture(); f.invoke.mockImplementationOnce(async () => ({ ok: true, data: { ...listReceipt(), batches: [{ ...listReceipt().batches![0], experimentId: "foreign" }] } }));
  render(<Panel api={f.api} />); await selectExperiment();
  fireEvent.click(screen.getByRole("button", { name: "读取已有 Pi 批次" }));
  expect((await screen.findByRole("alert")).textContent).toContain("身份不匹配");
  fireEvent.click(screen.getByRole("button", { name: "关闭批次错误" }));
  fireEvent.click(screen.getByRole("button", { name: "读取已有 Pi 批次" }));
  const button = await screen.findByRole("button", { name: `查看报告 ${batch.id}` });
  f.invoke.mockImplementationOnce(async () => ({ ok: true, data: { ...reportReceipt(), report: { ...reportReceipt().report, batchId: "foreign-batch" } } }));
  fireEvent.click(button);
  expect((await screen.findByRole("alert")).textContent).toContain("身份不匹配");
  expect(screen.queryByRole("region", { name: "批次报告摘要" })).toBeNull();
});

it("结果事件错误可关闭，超时不自动再次调用", async () => {
  const f = fixture(); f.invoke.mockResolvedValue({ ok: true, data: { accepted: true } });
  render(<Panel api={f.api} />); await selectExperiment();
  fireEvent.click(screen.getByRole("button", { name: "读取已有 Pi 批次" }));
  const requestId = (f.invoke.mock.calls[0][1] as { requestId: string }).requestId;
  React.act(() => f.emit({ version: 1, requestId, error: { message: "离线读取失败" } }));
  expect((await screen.findByRole("alert")).textContent).toContain("离线读取失败");
  fireEvent.click(screen.getByRole("button", { name: "关闭批次错误" }));
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "读取已有 Pi 批次" }));
  await React.act(async () => { await vi.advanceTimersByTimeAsync(30001); });
  expect(screen.getByRole("alert").textContent).toContain("读取批次结果超时");
  expect(f.invoke).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "关闭批次错误" }));
  expect(screen.queryByRole("alert")).toBeNull();
});
