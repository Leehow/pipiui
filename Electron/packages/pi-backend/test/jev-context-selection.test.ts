import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fauxProvider, fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import { registerContextSelector } from "../../../resources/runtime/extensions/jev-optimizer/agent/context-selector.ts";
import { buildContextDecision, executeContextDecision, parseContextDecision } from "../../../resources/runtime/extensions/jev-optimizer/agent/context-decision.ts";
import { contextCatalog, expandSelection, materializeLayer, SNAPSHOT_ENTRY } from "../../../resources/runtime/extensions/jev-optimizer/agent/context-catalog.ts";
import { assemblePiSpawn } from "../src/spawn-assembly.js";

const key = "test-context-key";
const env = { PIPIUI_EXT_SETTINGS_JEV_OPTIMIZER: JSON.stringify({ "ext.jev-optimizer.contextEnabled": true }),
  EXT_JEV_OPTIMIZER_APIKEY: key, PIPIUI_JEV_STATE_FILE: "test-state", PIPIUI_JEV_GENERATION: "test-generation" };
const host = { schemaVersion: 1, enabled: true, hasKey: true, generation: "test-generation", contextEnabled: true };
const gate = () => ({ withdrawn: () => false, signal: new AbortController().signal });
let root: string;
let philosophy: any;
const sessions: any[] = [];
const errors: unknown[] = [];

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pipiui-jev-context-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", join(root, ".pi/agent"));
  vi.stubEnv("PIPI_PHILOSOPHY_ROLE", "main");
  vi.stubEnv("PIPI_PHILOSOPHY_LAYER_DIRS", "");
  philosophy = (await import("../../../resources/runtime/pi-philosophy/philosophy.ts")).default;
});
afterEach(async () => { for (const session of sessions.splice(0)) session.dispose(); errors.length = 0; });
afterAll(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

async function fixture(options: { selected?: string[]; fail?: boolean; manager?: any; disabled?: string[] } = {}) {
  const requests: any[] = [];
  const providerContexts: any[] = [];
  const state = { ...host };
  const chosen = new Set(options.selected ?? []);
  const deps = { env, deadlineMs: 100, pollMs: 5, readState: async () => JSON.stringify(state),
    fetch: async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string); requests.push(body);
      if (options.fail) return new Response("unavailable", { status: 503 });
      return new Response(JSON.stringify({ answers: Object.fromEntries(Object.keys(body.questions).map(id =>
        [id, { type: "noul", noul: chosen.has(id) ? .99 : .01 }])) }));
    } };
  const faux = fauxProvider({ provider: "context-test", models: [{ id: "test", contextWindow: 200000, maxTokens: 1000 }] });
  const modelRuntime = await ModelRuntime.create({ authPath: join(root, "auth.json"), modelsPath: null, refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new DefaultResourceLoader({ cwd: root, agentDir: join(root, ".pi/agent"), settingsManager: settings,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    appendSystemPrompt: ["<!-- pipiui-system-base -->\nLocked base invariant."],
    extensionFactories: [philosophy, (pi: any) => registerContextSelector(pi, deps, gate())] });
  await loader.reload();
  const tool = (name: string, description: string) => ({ name, label: name, description,
    promptGuidelines: [`Only use ${name} for its documented purpose.`], parameters: Type.Object({}),
    execute: async () => ({ content: [{ type: "text" as const, text: `${name} result` }], details: {} }) });
  const manager = options.manager ?? SessionManager.inMemory(root);
  const { session } = await createAgentSession({ cwd: root, agentDir: join(root, ".pi/agent"), modelRuntime,
    model: faux.getModel(), settingsManager: settings, resourceLoader: loader, sessionManager: manager,
    excludeTools: options.disabled,
    customTools: [tool("browser", "Browse websites and inspect pages"), tool("image_gen", "Generate images"),
      tool("code_search", "Search source code for implementations")] });
  sessions.push(session);
  await session.bindExtensions({ onError: (error: unknown) => errors.push(error) });
  const respond = (content: any = "done") => faux.appendResponses([(context: any) => {
    const transcript = JSON.parse(JSON.stringify(context));
    providerContexts.push({ ...transcript, systemPrompt: getCurrentSystemPrompt(transcript.messages),
      tools: getCurrentTools(transcript.messages) });
    return fauxAssistantMessage(content);
  }]);
  const ask = async (text: string) => { respond(); await session.prompt(text); expect(errors).toEqual([]);
    expect(session.messages.filter((m: any) => m.role === "assistant" && m.stopReason === "error").map((m: any) => m.errorMessage)).toEqual([]); };
  const snapshot = () => [...manager.getBranch()].reverse().find((e: any) => e.customType === SNAPSHOT_ENTRY)?.data;
  return { session, ask, respond, faux, chosen, state, requests, providerContexts, manager, snapshot };
}

describe("Jev context selection through real Pi assembly and provider boundary", () => {
  it("shrinks tools and philosophy, then freezes the system prompt and only adds", async () => {
    const f = await fixture();
    await f.ask("解释一下什么是递归");
    const initial = f.providerContexts[0];
    expect(initial.tools.map((t: any) => t.name)).toContain("context_tools");
    expect(initial.tools.map((t: any) => t.name)).not.toContain("browser");
    expect(initial.systemPrompt).toContain("Locked base invariant");
    expect(initial.systemPrompt).not.toContain("# Planning");
    expect(initial.systemPrompt).not.toContain("Only use browser");
    expect(f.requests[0].questions["layer:planning"].type).toBe("noul");
    expect(JSON.stringify(f.requests)).not.toContain(key);
    expect(f.snapshot().active.length).toBeLessThan(f.snapshot().authority.length);

    f.chosen.add("tools:browser"); f.chosen.add("layer:research");
    await f.ask("现在查一下网站里的相关资料");
    const added = f.providerContexts[1];
    expect(added.systemPrompt).toBe(initial.systemPrompt);
    expect(added.tools.map((t: any) => t.name)).toContain("browser");
    expect(JSON.stringify(added.messages)).toContain("Only use browser");
    expect(f.snapshot().supplements).toHaveLength(1);
    f.chosen.clear();
    await f.ask("继续解释");
    expect(f.providerContexts[2].tools).toEqual(added.tools);
    expect(f.providerContexts[2].systemPrompt).toBe(initial.systemPrompt);
    expect(f.requests[2].questions).not.toHaveProperty("tools:browser");
    expect(f.requests[2].state.recent).toContain("递归");
  });

  it("loads missing capabilities inside a tool loop without another Jev request", async () => {
    const f = await fixture();
    f.respond(fauxToolCall("context_tools", { load: ["tools:browser"] }, { id: "load-browser" }));
    f.respond(fauxToolCall("browser", {}, { id: "use-browser" }));
    f.respond();
    await f.session.prompt("做一个需要网页的任务");
    expect(errors).toEqual([]);
    expect(f.requests).toHaveLength(1);
    expect(f.providerContexts).toHaveLength(3);
    expect(f.providerContexts[1].tools.map((t: any) => t.name)).toContain("browser");
    expect(f.providerContexts[2].messages.some((m: any) => m.role === "toolResult" && m.toolName === "browser")).toBe(true);
    expect(f.providerContexts[1].systemPrompt).toBe(f.providerContexts[0].systemPrompt);
  });

  it("resumes frozen selection and supplements from the same session branch", async () => {
    const first = await fixture({ selected: ["tools:browser"] });
    await first.ask("查一个网站");
    const oldPrompt = first.providerContexts[0].systemPrompt;
    first.session.dispose(); sessions.splice(sessions.indexOf(first.session), 1);
    const resumed = await fixture({ manager: first.manager });
    await resumed.ask("继续");
    expect(resumed.providerContexts[0].systemPrompt).toBe(oldPrompt);
    expect(resumed.providerContexts[0].tools.map((t: any) => t.name)).toContain("browser");
    expect(resumed.requests[0].questions).not.toHaveProperty("tools:browser");
  });

  it("first failure preserves the full baseline for the entire session", async () => {
    const f = await fixture({ fail: true });
    await f.ask("hello"); await f.ask("hello again");
    expect(f.requests).toHaveLength(1);
    expect(f.providerContexts[0].tools.map((t: any) => t.name)).toContain("image_gen");
    expect(f.providerContexts[0].systemPrompt).toContain("# Planning");
    expect(f.snapshot().bypassed).toBe(true);
  });

  it("explicit tool names are kept even if the semantic selector omits them", async () => {
    const f = await fixture();
    await f.ask("Use browser to inspect the page");
    expect(f.requests[0].questions).not.toHaveProperty("tools:browser");
    expect(f.providerContexts[0].tools.map((t: any) => t.name)).toContain("browser");
  });

  it("persists added guidance across restart without duplicating it", async () => {
    const first = await fixture(); await first.ask("hello");
    first.chosen.add("layer:planning"); await first.ask("制定一个计划");
    const old = first.providerContexts[1];
    first.session.dispose(); sessions.splice(sessions.indexOf(first.session), 1);
    const resumed = await fixture({ manager: first.manager }); await resumed.ask("继续");
    const current = resumed.providerContexts[0];
    expect(current.systemPrompt).toBe(old.systemPrompt);
    expect(JSON.stringify(current.messages).split("# Planning")).toHaveLength(2);
    expect(resumed.requests[0].questions).not.toHaveProperty("layer:planning");
  });

  it("rebases retained guidance at compaction and still delivers later additions", async () => {
    const f = await fixture(); await f.ask("hello");
    f.chosen.add("layer:planning"); await f.ask("制定计划");
    const previousEpoch = f.snapshot().epoch;
    await (f.session as any)._extensionRunner.emit({ type: "session_compact" });
    await f.ask("继续这个计划");
    expect(f.snapshot().epoch).not.toBe(previousEpoch);
    expect(f.providerContexts[2].systemPrompt).toContain("# Planning");
    f.chosen.add("tools:browser"); await f.ask("现在查看网页");
    expect(f.providerContexts[3].systemPrompt).toBe(f.providerContexts[2].systemPrompt);
    expect(JSON.stringify(f.providerContexts[3].messages)).toContain("Only use browser");
  });

  it("never activates an excluded tool, and disabling selection stops cloud calls", async () => {
    const f = await fixture({ selected: ["tools:images"], disabled: ["image_gen"] });
    await f.ask("画一个图");
    expect(f.requests[0].questions).not.toHaveProperty("tools:images");
    expect(f.providerContexts[0].tools.map((t: any) => t.name)).not.toContain("image_gen");
    f.state.contextEnabled = false;
    await f.ask("继续");
    expect(f.requests).toHaveLength(1);
    expect(f.providerContexts[1].tools.map((t: any) => t.name)).not.toContain("image_gen");
    expect(f.providerContexts[1].tools.map((t: any) => t.name)).toContain("browser");
  });
});

describe("bounded typed decisions", () => {
  it("keeps uncertainty, rejects incomplete and malformed answers, and bounds full task bytes", () => {
    expect(parseContextDecision({ answers: { a: { type: "noul", noul: .5 }, b: { type: "noul", noul: .01 } } }, ["a", "b"]))
      .toEqual({ status: "applied", selected: ["a"] });
    for (const answers of [{}, { a: { type: "score", score: 1 } }, { a: { type: "noul", noul: 2 } },
      { a: { type: "noul", noul: NaN } }, { a: { type: "noul", noul: .3 }, other: {} }]) {
      expect(parseContextDecision({ answers }, ["a"]).status).toBe("fallback");
    }
    expect(buildContextDecision({ task: "界".repeat(30000), recent: "", loaded: [], candidates: [{ id: "a", summary: "A" }] }, key).status).toBe("skipped");
  });

  it("bounds hung transport and rejects revoked, duplicate or late responses", async () => {
    const keepAlive = setInterval(() => {}, 1000);
    try {
      const input = { task: "hello", recent: "", loaded: [], candidates: [{ id: "a", summary: "A" }] };
      const deps = { env, deadlineMs: 25, pollMs: 5, readState: async () => JSON.stringify(host) };
      expect(await executeContextDecision(input, { ...deps, fetch: () => new Promise(() => {}) }, gate()))
        .toMatchObject({ status: "fallback", reason: "timeout" });
      expect(await executeContextDecision(input, { ...deps, fetch: async () => new Response('{"answers":{"a":{"type":"noul","noul":1},"a":{"type":"noul","noul":0}}}') }, gate()))
        .toMatchObject({ status: "fallback", reason: "invalid-response" });
      let enabled = true;
      expect((await executeContextDecision(input, { ...deps, readState: async () => JSON.stringify({ ...host, contextEnabled: enabled }),
        fetch: async () => { enabled = false; return new Response('{"answers":{"a":{"type":"noul","noul":1}}}'); } }, gate())).status).not.toBe("applied");
    } finally { clearInterval(keepAlive); }
  });

  it("resolves layer/tool dependencies and preserves required rules", () => {
    const layers = [{ id: "foundation", summary: "rules", body: "always", tools: [], requires: [], pinned: true },
      { id: "research", summary: "research", body: "research", tools: ["browser"], requires: ["foundation"], pinned: false }];
    const catalog = contextCatalog([{ name: "browser", description: "web" }], layers);
    expect(expandSelection(["layer:research"], catalog, layers).map(b => b.id))
      .toEqual(["tools:browser", "layer:foundation", "layer:research"]);
  });

  it("does not advertise hidden tools through optional references in pinned guidance", () => {
    const layer = { id: "toolcall", summary: "usage", body: "Use browser", template: "Use {{browser}}",
      bindings: { browser: { tool: "browser", absent: "available browsing capabilities" } },
      tools: [], requires: [], pinned: true };
    expect(materializeLayer(layer, [])).toBe("Use available browsing capabilities");
    expect(materializeLayer(layer, ["browser"])).toBe("Use browser");
  });

  it("mounts the selector after other contributors regardless of catalog order", () => {
    const { args } = assemblePiSpawn({ cwd: "/project", paths: { runtimeInfo: "/runtime-info.ts" }, registeredExtensions: [
      { id: "jev-optimizer", enabled: true, extensionPath: "/jev/index.js" },
      { id: "coding-method", enabled: true, extensionPath: "/philosophy/index.js" },
    ] as any });
    expect(args.indexOf("/jev/index.js")).toBeGreaterThan(args.indexOf("/philosophy/index.js"));
    expect(args.indexOf("/runtime-info.ts")).toBeGreaterThan(args.indexOf("/jev/index.js"));
  });
});
