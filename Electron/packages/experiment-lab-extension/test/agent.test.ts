import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerExperimentLab, experimentParameters } from "../agent/index.js";
import { ExperimentService } from "../agent/service.js";

type Pi = Parameters<typeof registerExperimentLab>[0];
type Tool = Parameters<Pi["registerTool"]>[0];
type Command = Parameters<Pi["registerCommand"]>[1];
const roots: string[] = [];
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

it("控制命令的失败有相关性标识，不伪装成成功结果", async () => {
  const f = await fixture();
  await f.commands.get("experiment-lab")!.handler(JSON.stringify({ method: "read", params: { action: "read", experimentId: "missing", requestId: "request-missing" } }), f.ctx);
  expect(f.emitted.at(-1)).toMatchObject({ event: "result", payload: { version: 1, requestId: "request-missing", error: { code: "experiment-not-found" } } });
});
