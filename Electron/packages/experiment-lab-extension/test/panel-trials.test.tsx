// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ExtensionHostAPI } from "@pipiui/extension-api";
import type { CommandCase, ExperimentSummary, TrialRecord, TrialRequest } from "../contracts.js";
import { createComponent } from "../app/panel.js";

const Panel = createComponent(React);
const DATA = ".pi/agent/experiments";
const definition: CommandCase = { id: "smoke", title: "验证命令结果", command: { executable: "node", args: ["test.js"], shell: false }, prepare: { executable: "node", args: ["prepare.js"], shell: false }, expectedExitCode: 0, checks: [{ path: "result.txt", expectedText: "ready" }], metricsFile: "metrics.json", allowedDomains: ["example.invalid"] };
const record: ExperimentSummary = {
  version: 1, id: "command-check", projectRoot: "/project/local", revision: 2, sequence: 4, question: "受限命令验证", kind: "command", state: "frozen", scopes: ["."], includeUntracked: [], variants: [], metrics: [],
  budget: { repetitions: 1, concurrency: 1, maxTrials: 10, trialTimeoutMs: 60000, totalTimeoutMs: 600000 }, createdAt: "2026-01-01", updatedAt: "2026-01-01", isSummary: true, recordDigest: "digest", previewTruncated: false,
  inventory: { files: { count: 0, pages: 0 }, dirtyPaths: { count: 0, pages: 0 }, removedPaths: { count: 0, pages: 0 }, omittedUntracked: { count: 0, pages: 0 }, excluded: { count: 0, pages: 0 }, scopes: { count: 1, pages: 1 }, includeUntracked: { count: 0, pages: 0 } },
  caseCatalog: [{ id: definition.id, title: definition.title, titleTruncated: false, fingerprint: "definition", command: "node", networkDomains: 1 }],
};
function trial(patch: Partial<TrialRecord> = {}): TrialRecord {
  return { version: 1, id: "smoke-trial-1", experimentId: record.id, revision: 2, variantId: "baseline", caseId: "smoke", sequence: 1, requestDigest: "request", definitionFingerprint: "definition", baselineFingerprint: "baseline", state: "running", phase: "workload", quality: "unknown", owner: { pid: 42, generation: "private-owner-token", sessionId: "owner-session" }, runtime: { coordinatorNode: "v22", platform: "darwin", arch: "arm64" }, createdAt: "2026-01-01", checks: [], metrics: [], artifacts: [], ...patch };
}
const runPath = (value: TrialRecord) => `${DATA}/${record.id}/runs/${value.id}.json`;
const casePath = `${DATA}/${record.id}/cases/${record.sequence}/${definition.id}.json`;
function fixture(summary = record) {
  const files: Record<string, string> = { [`${DATA}/${summary.id}.json`]: JSON.stringify(summary), [casePath]: JSON.stringify(definition) };
  type Listener = Parameters<ExtensionHostAPI["subscribeExt"]>[0];
  const listeners = new Set<Listener>();
  const invoke = vi.fn<NonNullable<ExtensionHostAPI["invoke"]>>(async () => ({ ok: true, data: { accepted: true } }));
  const read = vi.fn<NonNullable<ExtensionHostAPI["data"]>["read"]>(async (path, options) => {
    if (!(path in files)) throw new Error("data file is unavailable");
    const bytes = Buffer.from(files[path]);
    const cap = Math.min(Math.max(1024, options?.tailBytes ?? 128 * 1024), 512 * 1024);
    const truncated = bytes.length > cap;
    let content = bytes.subarray(Math.max(0, bytes.length - cap)).toString("utf8");
    if (truncated && content.includes("\n")) content = content.slice(content.indexOf("\n") + 1);
    return { content, bytes: bytes.length, truncated };
  });
  const list = vi.fn(async (directory: string) => Object.keys(files).filter((path) => path.startsWith(`${directory}/`) && !path.slice(directory.length + 1).includes("/")).map((path) => ({ name: path.slice(directory.length + 1), bytes: Buffer.byteLength(files[path]), mtime: 1 })));
  const api: ExtensionHostAPI = { subscribeExt: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, invoke, data: { read, list } };
  const emit = (type: string, payload: unknown) => act(() => { for (const listener of listeners) listener({ type, payload } as Parameters<Listener>[0]); });
  const persist = (value: TrialRecord) => { files[runPath(value)] = JSON.stringify(value); };
  return { api, files, invoke, read, list, emit, persist, listeners };
}
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("读取完整测例后手动运行，ack不等于受理，受理后从持久记录轮询至终态", async () => {
  const f = fixture();
  const mounted = render(<Panel api={f.api} />);
  await screen.findByRole("article", { name: record.question });
  const run = screen.getByRole("button", { name: "单次运行" });
  expect(run.hasAttribute("disabled")).toBe(true);
  expect(f.invoke).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("combobox", { name: "测例" }), { target: { value: "smoke" } });
  await screen.findByText('直接执行："node" "test.js"');
  expect(screen.getByText('准备命令：直接执行："node" "prepare.js"')).toBeTruthy();
  expect(screen.getByText("联网域：example.invalid")).toBeTruthy();
  expect(screen.getByText('result.txt · 预期文本 "ready"')).toBeTruthy();
  expect(screen.getByText("工作负载指标文件：metrics.json")).toBeTruthy();
  expect(f.read).toHaveBeenCalledWith(casePath);
  fireEvent.click(run);
  await waitFor(() => expect(f.invoke).toHaveBeenCalledTimes(1));
  const request = f.invoke.mock.calls[0][1] as TrialRequest;
  expect(request).toMatchObject({ action: "run", experimentId: record.id, caseId: "smoke", revision: 2 });
  expect(request.requestId).toBeTruthy();
  expect(screen.getByText("等待操作受理…")).toBeTruthy();
  expect(screen.queryByText(/运行已受理/)).toBeNull();
  f.persist(trial({ state: "queued", phase: "queued" }));
  f.emit("result", { version: 1, action: "run", requestId: request.requestId, trial: { id: "not-trusted-event-record" } });
  await screen.findByText("执行状态：排队中（queued）");
  expect(screen.getByText(/运行已受理/)).toBeTruthy();
  expect(screen.queryByText(/not-trusted-event-record/)).toBeNull();
  vi.useFakeTimers();
  // A trial event only invalidates local storage; a foreign payload is never rendered.
  f.persist(trial());
  f.emit("trial", { trial: trial({ id: "foreign-trial", experimentId: "foreign-project", state: "succeeded" }) });
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText("执行状态：运行中（running）")).toBeTruthy();
  expect(screen.queryByText(/foreign-trial/)).toBeNull();
  f.persist(trial({ state: "succeeded", phase: "terminal", quality: "unknown", metrics: [{ id: "elapsed", value: 23, unit: "ms", source: "runtime" }, { id: "accuracy", value: null, unit: "%", source: "unavailable" }, { id: "count", value: 7, unit: "items", source: "workload-output" }] }));
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(screen.getByText("执行状态：执行成功（succeeded）")).toBeTruthy();
  expect(screen.getByText("质量：未知（unknown）")).toBeTruthy();
  expect(screen.getByText("elapsed：23 ms · 来源：运行时测量")).toBeTruthy();
  expect(screen.getByText("accuracy：未测 % · 来源：不可用")).toBeTruthy();
  expect(screen.getByText("count：7 items · 来源：工作负载输出")).toBeTruthy();
  expect(screen.queryByText(/质量：通过/)).toBeNull();
  const reads = f.list.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(f.list).toHaveBeenCalledTimes(reads);
  expect(screen.getByRole("button", { name: "清理工作副本" })).toBeTruthy();
  mounted.unmount();
  expect(f.listeners.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("取消路由owner会话；旧owner关闭后，显式清理使用当前项目会话", async () => {
  const f = fixture();
  f.persist(trial());
  let ownerAvailable = true;
  f.invoke.mockImplementation(async (method, params, options) => {
    if (!ownerAvailable && options?.sessionId === "owner-session") return { ok: false, error: { code: "no_session", message: "原会话已关闭" } };
    const request = params as TrialRequest;
    f.persist(trial({ state: "cancelled", phase: "terminal", workspaceCleaned: method === "cleanup" }));
    return { ok: true, data: { version: 1, action: method, requestId: request.requestId } };
  });
  render(<Panel api={f.api} />);
  const cancel = await screen.findByRole("button", { name: "取消运行" });
  expect(document.body.textContent).not.toContain("private-owner-token");
  expect(document.body.textContent).not.toContain("owner-session");
  expect(screen.queryByRole("button", { name: "清理工作副本" })).toBeNull();
  fireEvent.click(cancel);
  await screen.findByText("执行状态：已取消（cancelled）");
  expect(f.invoke.mock.calls[0]).toEqual(["cancel", expect.objectContaining({ trialId: "smoke-trial-1", experimentId: record.id, revision: 2 }), { sessionId: "owner-session" }]);
  ownerAvailable = false;
  // Cleanup remains an explicit user action, even after the original owner exits.
  expect(f.invoke).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "清理工作副本" }));
  const cleaned = await screen.findByRole("button", { name: "工作副本已清理" });
  expect(cleaned.hasAttribute("disabled")).toBe(true);
  expect(f.invoke.mock.calls[1]).toEqual(["cleanup", expect.objectContaining({ action: "cleanup", trialId: "smoke-trial-1" }), undefined]);
});

it("坏JSON及跨实验运行不隐藏其他结果，错误可关闭", async () => {
  const f = fixture();
  f.files[`${DATA}/${record.id}/runs/broken.json`] = "{";
  f.files[`${DATA}/${record.id}/runs/invalid.json`] = JSON.stringify({ id: "invalid", version: 1 });
  f.files[`${DATA}/${record.id}/runs/foreign.json`] = JSON.stringify(trial({ id: "foreign", experimentId: "elsewhere" }));
  f.persist(trial({ state: "failed", quality: "fail" }));
  render(<Panel api={f.api} />);
  await screen.findByText("执行状态：执行失败（failed）");
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("broken.json");
  expect(alert.textContent).toContain("invalid.json");
  expect(alert.textContent).toContain("foreign.json");
  fireEvent.click(screen.getByRole("button", { name: "关闭运行错误" }));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("质量：不通过（fail）")).toBeTruthy();
});

it("日志只读取自身artifact且限制64KiB，截断提示与日志错误均可关闭", async () => {
  const f = fixture();
  const path = `${DATA}/${record.id}/runs/smoke-trial-1/artifacts/workload.stdout.txt`;
  const foreignPath = `${DATA}/elsewhere/runs/other/artifacts/workload.stderr.txt`;
  f.persist(trial({ state: "succeeded", artifacts: [{ path, phase: "workload", kind: "stdout", bytes: 80 * 1024, truncated: false }, { path: foreignPath, phase: "workload", kind: "stderr", bytes: 10, truncated: false }] }));
  f.files[path] = `${"x".repeat(80 * 1024)}\nretained-log-line`;
  render(<Panel api={f.api} />);
  const stdout = await screen.findByRole("button", { name: "查看 workload/stdout 日志" });
  expect(f.read.mock.calls.some(([value]) => value === path)).toBe(false);
  fireEvent.click(stdout);
  await screen.findByText("retained-log-line");
  expect(f.read).toHaveBeenCalledWith(path, { tailBytes: 64 * 1024 });
  expect(screen.getByText(/日志已截断/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "关闭日志" }));
  expect(screen.queryByRole("region", { name: "运行日志" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "查看 workload/stderr 日志" }));
  expect((await screen.findByRole("alert")).textContent).toContain("日志路径不属于本次运行");
  expect(f.read.mock.calls.some(([value]) => value === foreignPath)).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "关闭日志错误" }));
  expect(screen.queryByRole("alert")).toBeNull();
});

it.each(["{", JSON.stringify({ ...definition, id: "different-case" }), "x".repeat(130 * 1024)])("测例未完整验证时不能运行 %#", async (content) => {
  const f = fixture();
  f.files[casePath] = content;
  render(<Panel api={f.api} />);
  await screen.findByRole("combobox", { name: "测例" });
  fireEvent.change(screen.getByRole("combobox", { name: "测例" }), { target: { value: "smoke" } });
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "单次运行" }).hasAttribute("disabled")).toBe(true);
  expect(f.invoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "关闭运行错误" }));
  expect(screen.queryByRole("alert")).toBeNull();
});

it("草稿可保存可选测例JSON，但不会自动执行或提供单次运行按钮", async () => {
  const f = fixture({ ...record, state: "draft" });
  render(<Panel api={f.api} />);
  await screen.findByRole("article", { name: record.question });
  expect(screen.queryByRole("button", { name: "单次运行" })).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "要验证的问题" }), { target: { value: "新命令实验" } });
  const json = screen.getByLabelText("命令测例 JSON");
  fireEvent.change(json, { target: { value: "{" } });
  fireEvent.click(screen.getByRole("button", { name: "创建实验草稿" }));
  await screen.findByRole("alert");
  expect(f.invoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "关闭错误" }));
  fireEvent.change(json, { target: { value: JSON.stringify([definition]) } });
  fireEvent.click(screen.getByRole("button", { name: "创建实验草稿" }));
  await waitFor(() => expect(f.invoke).toHaveBeenCalledTimes(1));
  expect(f.invoke.mock.calls[0][0]).toBe("create");
  expect(f.invoke.mock.calls[0][1]).toMatchObject({ cases: [definition] });
});

it.each([
  { id: "smoke", command: { executable: "node", args: ["-e", "console.log('ready')"] } },
  { id: "smoke", command: { executable: "node" } },
])("最小命令测例输入原样提交，默认值由host补齐 %#", async (input) => {
  const f = fixture();
  render(<Panel api={f.api} />);
  fireEvent.change(screen.getByRole("textbox", { name: "要验证的问题" }), { target: { value: "最小测例" } });
  fireEvent.change(screen.getByLabelText("命令测例 JSON"), { target: { value: JSON.stringify([input]) } });
  fireEvent.click(screen.getByRole("button", { name: "创建实验草稿" }));
  await waitFor(() => expect(f.invoke).toHaveBeenCalledTimes(1));
  expect(f.invoke.mock.calls[0][0]).toBe("create");
  expect((f.invoke.mock.calls[0][1] as { cases: unknown }).cases).toEqual([input]);
  expect(screen.queryByRole("alert")).toBeNull();
});

it.each([
  { id: "smoke" },
  { id: "smoke", command: { executable: "node", shell: "false" } },
  { id: "smoke", command: { executable: "node" }, checks: [{ path: 3 }] },
])("缺少command或可选字段形状非法时拒绝提交 %#", async (input) => {
  const f = fixture();
  render(<Panel api={f.api} />);
  fireEvent.change(screen.getByRole("textbox", { name: "要验证的问题" }), { target: { value: "非法测例" } });
  fireEvent.change(screen.getByLabelText("命令测例 JSON"), { target: { value: JSON.stringify([input]) } });
  fireEvent.click(screen.getByRole("button", { name: "创建实验草稿" }));
  expect((await screen.findByRole("alert")).textContent).toContain("有效的命令测例数组");
  expect(f.invoke).not.toHaveBeenCalled();
});

it.each(["pi", "browser"] as const)("%s卡片只说明后续适配，不能显示命令运行入口", async (kind) => {
  const f = fixture({ ...record, kind });
  render(<Panel api={f.api} />);
  const card = await screen.findByRole("article", { name: record.question });
  expect(within(card).getByText(/适配将在后续阶段提供；当前未执行此类实验。/)).toBeTruthy();
  expect(within(card).queryByRole("region", { name: "单次受限运行" })).toBeNull();
  expect(within(card).queryByRole("button", { name: "单次运行" })).toBeNull();
  expect(within(card).queryByRole("combobox", { name: "测例" })).toBeNull();
  expect(f.list.mock.calls.some(([path]) => path.endsWith("/runs"))).toBe(false);
  expect(f.invoke).not.toHaveBeenCalled();
});

it("仅active运行轮询，卸载时撤销下一次读取与订阅", async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.persist(trial());
  const mounted = render(<Panel api={f.api} />);
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText("执行状态：运行中（running）")).toBeTruthy();
  expect(vi.getTimerCount()).toBe(1);
  const calls = f.list.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(f.list.mock.calls.length).toBeGreaterThan(calls);
  mounted.unmount();
  const afterUnmount = f.list.mock.calls.length;
  expect(f.listeners.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
  expect(f.list).toHaveBeenCalledTimes(afterUnmount);
});
