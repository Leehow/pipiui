import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const EXTENSION = "../../../resources/runtime/extensions/pipiui-runtime-info.ts";

type Handler = (event: any, ctx: any) => unknown;

async function loadRuntimeInfo() {
  vi.resetModules();
  const handlers = new Map<string, Handler[]>();
  let tool: any;
  const pi = {
    getActiveTools: vi.fn(() => ["read", "pipiui_runtime_info"]),
    getAllTools: vi.fn(() => [
      { name: "read", description: "Read file contents", sourceInfo: { source: "builtin", scope: "temporary" } },
      { name: "pipiui_runtime_info", description: "Read runtime state", sourceInfo: { source: "pipiui-runtime-info", scope: "temporary" } },
    ]),
    getThinkingLevel: vi.fn(() => "xhigh"),
    getSessionName: vi.fn(() => "Current session"),
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    registerTool: vi.fn((definition: any) => { tool = definition; }),
  };
  const module = await import(EXTENSION);
  module.default(pi as never);
  return { pi, tool, handlers, runtimeDebugSidecarPath: module.runtimeDebugSidecarPath };
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    cwd: "/workspace/project",
    model: {
      provider: "xai",
      id: "grok-test",
      name: "Grok Test",
      reasoning: true,
      thinkingLevelMap: {
        off: null,
        minimal: "minimal",
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: null,
      },
    },
    thinkingLevel: "xhigh",
    sessionManager: {
      getSessionId: () => "session-1",
      getSessionName: () => "Current session",
      getSessionFile: () => undefined,
    },
    getContextUsage: () => ({ tokens: 1200, contextWindow: 10000, percent: 12 }),
    ...overrides,
  };
}

function parseResult(result: any) {
  return JSON.parse(result.content[0].text);
}

describe("pipiui_runtime_info extension", () => {
  it("reports live Pi state and authoritative supported thinking levels", async () => {
    const { tool } = await loadRuntimeInfo();
    const ctx = context();
    const first = parseResult(await tool.execute("call-1", {}, undefined, undefined, ctx));
    expect(first).toMatchObject({
      provider: "xai",
      model: { id: "grok-test", name: "Grok Test" },
      thinking: { current: "xhigh", supported: ["minimal", "low", "medium", "high", "xhigh"] },
      session: { id: "session-1", name: "Current session" },
      cwd: "/workspace/project",
      activeTools: ["read", "pipiui_runtime_info"],
      contextUsage: { tokens: 1200, contextWindow: 10000, percent: 12 },
      lastProviderRequest: { status: "not_observed" },
    });

    ctx.cwd = "/workspace/changed";
    ctx.sessionManager.getSessionId = () => "session-2";
    ctx.getContextUsage = () => ({ tokens: 2500, contextWindow: 10000, percent: 25 });
    const second = parseResult(await tool.execute("call-2", {}, undefined, undefined, ctx));
    expect(second).toMatchObject({
      cwd: "/workspace/changed",
      session: { id: "session-2" },
      contextUsage: { tokens: 2500, percent: 25 },
    });
  });

  it("observes only whitelisted fields from the final provider payload", async () => {
    const { handlers, tool } = await loadRuntimeInfo();
    const ctx = context();
    const beforeRequest = handlers.get("before_provider_request")?.[0];
    expect(beforeRequest).toBeTypeOf("function");
    await beforeRequest?.({
      type: "before_provider_request",
      payload: {
        reasoning_effort: "xhigh",
        messages: [{ role: "system", content: "SECRET SYSTEM PROMPT" }],
        tools: [{ name: "secret_tool" }],
        headers: { authorization: "Bearer SECRET" },
        apiKey: "SECRET KEY",
        baseUrl: "https://secret.invalid",
      },
    }, ctx);

    const result = await tool.execute("call", {}, undefined, undefined, ctx);
    const info = parseResult(result);
    expect(info.lastProviderRequest).toMatchObject({
      status: "observed",
      provider: "xai",
      model: "grok-test",
      thinkingLevel: "xhigh",
      serializedReasoning: { reasoning_effort: "xhigh" },
    });
    expect(info.lastProviderRequest.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.content[0].text).not.toMatch(/SECRET|messages|headers|apiKey|baseUrl|system prompt/i);
  });

  it("does not guess reasoning fields and clears evidence on every session start", async () => {
    const { handlers, tool } = await loadRuntimeInfo();
    const ctx = context();
    const beforeRequest = handlers.get("before_provider_request")?.[0];
    const sessionStart = handlers.get("session_start")?.[0];
    await beforeRequest?.({ type: "before_provider_request", payload: { temperature: 0.2 } }, ctx);
    expect(parseResult(await tool.execute("call", {}, undefined, undefined, ctx)).lastProviderRequest)
      .toMatchObject({ status: "observed", serializedReasoning: { status: "not_observed" } });

    for (const reason of ["startup", "reload", "new", "resume", "fork"]) {
      await sessionStart?.({ type: "session_start", reason }, ctx);
      expect(parseResult(await tool.execute("call", {}, undefined, undefined, ctx)).lastProviderRequest)
        .toEqual({ status: "not_observed" });
      await beforeRequest?.({ type: "before_provider_request", payload: { reasoning: { effort: "high" } } }, ctx);
    }
  });

  it("never exposes request evidence captured for a different live session", async () => {
    const { handlers, tool } = await loadRuntimeInfo();
    const firstSession = context();
    await handlers.get("before_provider_request")?.[0]?.(
      { type: "before_provider_request", payload: { reasoning_effort: "xhigh" } },
      firstSession,
    );
    const secondSession = context({
      sessionManager: {
        getSessionId: () => "session-2",
        getSessionName: () => "Other session",
      },
    });
    expect(parseResult(await tool.execute("call", {}, undefined, undefined, secondSession)).lastProviderRequest)
      .toEqual({ status: "not_observed" });
  });

  it("writes a safe tool and Skill snapshot beside the live session file", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipi-runtime-debug-"));
    const skillRoot = join(root, "skills");
    const skillDir = join(skillRoot, "tdd");
    const sessionFile = join(root, "session.jsonl");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: tdd\ndescription: Test driven development\n---\nbody\n");
    const envKeys = [
      "PIPIUI_BUILT_IN_SKILL_ROOT",
      "PIPIUI_AGENTS_DIR",
      "PIPIUI_SUBAGENT_EXT",
      "PIPIUI_CODING_TOOLS_EXT",
      "PIPIUI_SKILLLOADER_EXT",
      "PIPIUI_MEMORY_BROKER_MODE",
    ] as const;
    const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
    process.env.PIPIUI_BUILT_IN_SKILL_ROOT = skillRoot;
    process.env.PIPIUI_AGENTS_DIR = join(process.cwd(), "resources/runtime/pi-ext/agents");
    process.env.PIPIUI_SUBAGENT_EXT = join(process.cwd(), "resources/runtime/pi-ext/subagent");
    process.env.PIPIUI_CODING_TOOLS_EXT = join(process.cwd(), "resources/runtime/extensions/pipiui-coding-tools.ts");
    process.env.PIPIUI_SKILLLOADER_EXT = join(process.cwd(), "resources/runtime/extensions/pipiui-skillloader.ts");
    process.env.PIPIUI_MEMORY_BROKER_MODE = "main";
    try {
      const { handlers, runtimeDebugSidecarPath } = await loadRuntimeInfo();
      const ctx = context({
        sessionManager: {
          getSessionId: () => "session-1",
          getSessionName: () => "Current session",
          getSessionFile: () => sessionFile,
        },
      });
      await handlers.get("session_start")?.[0]?.({ type: "session_start", reason: "startup" }, ctx);
      const snapshot = JSON.parse(await readFile(runtimeDebugSidecarPath(sessionFile), "utf8"));
      expect(snapshot).toMatchObject({
        version: 1,
        sessionId: "session-1",
        activeTools: ["read", "pipiui_runtime_info"],
      });
      expect(snapshot.tools).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "read", description: "Read file contents", source: "builtin" }),
      ]));
      expect(snapshot.skills).toEqual(expect.arrayContaining([
        { name: "tdd", description: "Test driven development", userInvoked: false },
      ]));
      expect(snapshot.subagents).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "explore", toolPolicy: "allowlist", tools: expect.arrayContaining(["read", "grep", "skill_load"]) }),
        expect.objectContaining({ name: "general-purpose", toolPolicy: "allowlist", tools: expect.arrayContaining(["edit", "write", "skill_load"]) }),
      ]));
      expect(JSON.stringify(snapshot)).not.toContain("SKILL.md");
    } finally {
      for (const key of envKeys) {
        const value = previous[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite a symlinked Debug sidecar", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipi-runtime-debug-symlink-"));
    const sessionFile = join(root, "session.jsonl");
    const target = join(root, "target.txt");
    await writeFile(target, "do not overwrite");
    try {
      const { handlers, runtimeDebugSidecarPath } = await loadRuntimeInfo();
      await symlink(target, runtimeDebugSidecarPath(sessionFile));
      const ctx = context({
        sessionManager: {
          getSessionId: () => "session-1",
          getSessionName: () => "Current session",
          getSessionFile: () => sessionFile,
        },
      });
      await handlers.get("session_start")?.[0]?.({ type: "session_start", reason: "startup" }, ctx);
      expect(await readFile(target, "utf8")).toBe("do not overwrite");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite a multiply-linked Debug sidecar", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipi-runtime-debug-hardlink-"));
    const sessionFile = join(root, "session.jsonl");
    const target = join(root, "target.txt");
    await writeFile(target, "do not overwrite");
    try {
      const { handlers, runtimeDebugSidecarPath } = await loadRuntimeInfo();
      await link(target, runtimeDebugSidecarPath(sessionFile));
      const ctx = context({
        sessionManager: {
          getSessionId: () => "session-1",
          getSessionName: () => "Current session",
          getSessionFile: () => sessionFile,
        },
      });
      await handlers.get("session_start")?.[0]?.({ type: "session_start", reason: "startup" }, ctx);
      expect(await readFile(target, "utf8")).toBe("do not overwrite");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("instructs the model to verify runtime questions with the tool first", async () => {
    const { tool } = await loadRuntimeInfo();
    expect(tool.parameters).toBeDefined();
    expect(JSON.stringify(tool.parameters)).not.toMatch(/provider|model|session|path/i);
    expect(`${tool.description}\n${tool.promptGuidelines.join("\n")}`).toMatch(/call.*first/i);
    expect(tool.promptGuidelines.join("\n")).toMatch(/history|system prompt|PI_/i);
  });
});
