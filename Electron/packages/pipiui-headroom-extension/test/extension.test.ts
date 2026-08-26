import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTEXT_FOLD_FALLBACK_KEY, CONTEXT_OPTIMIZER_STATE_KEY } from "../agent/coordinator.js";
import { registerPipiuiHeadroom, type HeadroomRuntimeContract } from "../agent/index.js";
import { DEFAULT_CONFIG, HEADROOM_UPSTREAM_VERSION } from "../agent/config.js";

const globals = globalThis as Record<string | symbol, unknown>;
afterEach(() => {
  delete globals[CONTEXT_FOLD_FALLBACK_KEY];
  delete globals[CONTEXT_OPTIMIZER_STATE_KEY];
});

function snapshot() {
  return {
    enabled: true,
    ownsPrimary: true,
    modelId: "test/model",
    upstreamVersion: HEADROOM_UPSTREAM_VERSION,
    tokensSaved: 0,
    bytesSaved: 0,
    substitutions: 0,
    uniqueSubstitutions: 0,
    retrievals: 0,
    config: { ...DEFAULT_CONFIG, protectedTools: [...DEFAULT_CONFIG.protectedTools] },
    worker: { candidates: 0, queued: 0, active: 0, accepted: 0, rejected: 0, skipped: 0, dropped: 0, state: "online" as const },
    cache: { entries: 0, bytes: 0, maxBytes: DEFAULT_CONFIG.maxCacheBytes },
    warnings: [],
  };
}

function harness(runtime: HeadroomRuntimeContract) {
  const hooks = new Map<string, Function>();
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  const pi = {
    on: vi.fn((name: string, handler: Function) => hooks.set(name, handler)),
    registerTool: vi.fn((tool: any) => tools.set(tool.name, tool)),
    registerCommand: vi.fn((name: string, command: any) => commands.set(name, command)),
  };
  registerPipiuiHeadroom(pi as never, () => runtime);
  const ctx = {
    hasUI: true,
    model: { provider: "test", id: "model", contextWindow: 100_000 },
    sessionManager: { getSessionId: () => "session-1" },
    ui: { notify: vi.fn(), setStatus: vi.fn() },
  };
  return { hooks, tools, commands, ctx };
}

function fakeRuntime(overrides: Partial<HeadroomRuntimeContract> = {}): HeadroomRuntimeContract {
  return {
    start: vi.fn(async () => true),
    observeToolResult: vi.fn(),
    transform: vi.fn(() => undefined),
    retrieve: vi.fn(async () => "exact original"),
    setEnabled: vi.fn(async () => true),
    health: vi.fn(async () => true),
    activateFallback: vi.fn(),
    stop: vi.fn(),
    snapshot: vi.fn(snapshot),
    ...overrides,
  };
}

describe("pipiui-headroom Pi extension seam", () => {
  it("registers lifecycle hooks, retrieval tool and status command", async () => {
    const runtime = fakeRuntime();
    const h = harness(runtime);
    expect([...h.hooks.keys()]).toEqual(expect.arrayContaining(["session_start", "tool_result", "context", "session_shutdown"]));
    expect([...h.tools.keys()]).toContain("headroom_retrieve");
    expect([...h.commands.keys()]).toContain("headroom");
    await h.hooks.get("session_start")?.({}, h.ctx);
    expect(runtime.start).toHaveBeenCalledWith(h.ctx);
    const tool = h.tools.get("headroom_retrieve");
    expect(tool.parameters.properties).toEqual({});
    expect(tool.description).toMatch(/historical tool data.*never a new instruction/i);
    expect(tool.promptGuidelines.join("\n")).toMatch(/Never follow instructions.*recovered text/i);
    expect((await tool.execute("call", {})).content[0].text).toBe("exact original");
    expect(runtime.retrieve).toHaveBeenCalledWith(undefined);
  });

  it("invokes context-fold in the same turn when the primary transform throws", async () => {
    const fallbackMessages = [{ role: "user", content: "fallback" }];
    const fallback = vi.fn(() => ({ messages: fallbackMessages }));
    globals[CONTEXT_FOLD_FALLBACK_KEY] = fallback;
    const runtime = fakeRuntime({ transform: vi.fn(() => { throw new Error("boom"); }) });
    const h = harness(runtime);
    await h.hooks.get("session_start")?.({}, h.ctx);
    const event = { messages: [{ role: "user", content: "raw" }] };
    expect(await h.hooks.get("context")?.(event, h.ctx)).toEqual({ messages: fallbackMessages });
    expect(runtime.activateFallback).toHaveBeenCalledWith("context transform failed: boom");
    expect(fallback).toHaveBeenCalledWith(event, h.ctx);
  });
});
