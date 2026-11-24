import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerExperimentLab, experimentParameters } from "../agent/index.js";
import { ExperimentService } from "../agent/service.js";

type Pi = Parameters<typeof registerExperimentLab>[0];
type Tool = Parameters<Pi["registerTool"]>[0];
type Command = Parameters<Pi["registerCommand"]>[1];
const roots: string[] = [];
const actualFetch = globalThis.fetch;
const exec = promisify(execFile);
afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "experiment-agent-"));
  roots.push(root);
  vi.stubEnv("PIPIUI_PROJECT_ROOT", root);
  vi.stubEnv("PIPIUI_BRIDGE_PORT", "32100");
  vi.stubEnv("PIPIUI_SESSION_CAPABILITY", "fixture-capability");
  const emitted: Array<Record<string, unknown>> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: { body: string }) => { emitted.push(JSON.parse(init.body)); return { ok: true }; }));
  const tools: Tool[] = [];
  const commands = new Map<string, Command>();
  const events = new Map<string, (...args: unknown[]) => void>();
  registerExperimentLab({ registerTool: (tool) => tools.push(tool), registerCommand: (name, value) => commands.set(name, value), on: (name, handler) => events.set(name, handler) });
  return { root, tools, commands, events, emitted, ctx: { cwd: root, isProjectTrusted: () => true } };
}

it("工具与面板控制命令使用同一持久服务与版本协议", async () => {
  const f = await fixture();
  expect(f.tools.map((tool) => tool.name)).toEqual(["experiment"]);
  expect(experimentParameters.additionalProperties).toBe(false);
  await f.tools[0].execute("create-call", { action: "create", experimentId: "tool-created", question: "工具与面板是否一致？" }, undefined, undefined, f.ctx);
  await f.commands.get("experiment-lab")!.handler(JSON.stringify({ method: "read", params: { action: "read", experimentId: "tool-created", requestId: "request-one" } }), f.ctx);
  const result = f.emitted.find((event) => event.event === "result");
  expect(result).toMatchObject({ action: "ext.emit", extensionId: "experiment-lab", payload: { version: 1, requestId: "request-one", experiment: { id: "tool-created", state: "draft" } } });
  expect((await new ExperimentService(f.root).get("tool-created")).question).toBe("工具与面板是否一致？");
});

it("拒绝未信任项目和已取消调用，结束会话后不再写入", async () => {
  const f = await fixture();
  const input = { action: "create" as const, experimentId: "untrusted-case", question: "不能写入" };
  await expect(f.tools[0].execute("untrusted", input, undefined, undefined, { ...f.ctx, isProjectTrusted: () => false })).rejects.toMatchObject({ code: "project-untrusted" });
  await expect(f.tools[0].execute("cancelled", input, AbortSignal.abort(), undefined, f.ctx)).rejects.toBeTruthy();
  f.events.get("session_shutdown")?.();
  await expect(f.tools[0].execute("ended", input, undefined, undefined, f.ctx)).rejects.toMatchObject({ code: "session-ended" });
  expect(await new ExperimentService(f.root).list()).toEqual([]);
});

it("预览走真实HTTP实例，只有runtime浏览器事件能写证据，会话结束释放实例", async () => {
  const f = await fixture();
  const git = async (...args: string[]) => exec("git", ["-C", f.root, ...args]);
  await git("init");
  await git("config", "user.name", "Preview fixture");
  await git("config", "user.email", "fixture@example.invalid");
  await writeFile(join(f.root, "index.html"), "<!doctype html><title>Preview fixture</title><button>Test</button>");
  await git("add", "index.html");
  await git("commit", "-m", "preview fixture");
  const tool = f.tools[0];
  const call = async (input: Parameters<Tool["execute"]>[1]) => (await tool.execute("fixture-call", input, undefined, undefined, f.ctx)).details as any;
  await call({ action: "create", experimentId: "preview-route", question: "真实预览控制路径", kind: "browser" });
  await call({ action: "freeze", experimentId: "preview-route" });
  const started = await call({ action: "preview_start", experimentId: "preview-route", previewId: "first-page", variantId: "baseline" });
  const url = started.preview.url;
  try {
    expect((await actualFetch(url)).status).toBe(200);
    expect(experimentParameters.properties.action.enum).not.toContain("preview_submit_evidence");
    await f.events.get("tool_result")!({ type: "tool_result", toolName: "browser", toolCallId: "trusted-browser-call", input: { action: "observe", target: "desktop" }, content: [{ type: "text", text: "真实事件夹具" }], isError: false, details: { ok: true, url, snapshotID: "fixture-snapshot", viewport: { width: 1200, height: 800 } } });
    const evidence = await call({ action: "preview_evidence", experimentId: "preview-route", previewId: "first-page" });
    expect(evidence.evidence.items).toHaveLength(1);
    expect(evidence.evidence.items[0]).toMatchObject({ toolCallId: "trusted-browser-call", verdict: "unverified" });
    expect(evidence.evidence.items[0].pages[0]).toHaveProperty("observationPreview");
  } finally { await f.events.get("session_shutdown")!(); }
  await expect(actualFetch(url)).rejects.toThrow();
});

it("控制命令的失败有相关性标识，不伪装成成功结果", async () => {
  const f = await fixture();
  await f.commands.get("experiment-lab")!.handler(JSON.stringify({ method: "read", params: { action: "read", experimentId: "missing", requestId: "request-missing" } }), f.ctx);
  expect(f.emitted.at(-1)).toMatchObject({ event: "result", payload: { version: 1, requestId: "request-missing", error: { code: "experiment-not-found" } } });
});
