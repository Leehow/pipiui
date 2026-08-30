// Offline tests for the browser_flow memory extension (v1 semantic flows). No network:
// the bridge fetch is stubbed, and the store lives in per-test temp project roots — the
// same project-isolation layout (`.pi/agent/browser-flows`) the extension uses in prod.
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const EXTENSION = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "../../../resources/runtime/extensions/pipiui-browser-memory.ts")).href;

// Crash-injection hook for the atomic-write test: renameSync is the commit point of the
// tmp+rename protocol, so failing exactly there simulates a process death between the two.
const fsState = vi.hoisted(() => ({ renameThrows: false }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      if (fsState.renameThrows) throw new Error("simulated crash between tmp write and rename");
      return actual.renameSync(...args);
    },
  };
});

type Tool = {
  name: string;
  execute: (id: string, params: Record<string, unknown>, signal?: AbortSignal, onUpdate?: unknown, ctx?: { cwd?: string }) => Promise<any>;
};

// The extension reads the bridge env at module load, so it must be set before each
// resetModules import. The port is never dialed — fetch is stubbed per test.
process.env.PIPIUI_BRIDGE_PORT = "1";
process.env.PIPIUI_SESSION_KEY = "browser-memory-test-session";
process.env.PIPIUI_SESSION_CAPABILITY = "browser-memory-test-cap";

const projects: string[] = [];
function newProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "pipiui-flow-"));
  projects.push(dir);
  return dir;
}

/** Loads the extension module namespace itself — the seam for the pure episode/candidate
 * contract functions (no tool registration, no bridge, no fs involved). */
async function loadExtensionModule(): Promise<Record<string, any>> {
  vi.resetModules();
  return (await import(EXTENSION)) as Record<string, any>;
}

async function loadFlowTool(): Promise<Tool> {
  vi.resetModules();
  let tool: Tool | undefined;
  const pi = {
    registerTool: vi.fn((definition: Tool) => {
      if (definition.name === "browser_flow") tool = definition;
    }),
    on: vi.fn(),
  };
  const extension = (await import(EXTENSION)).default;
  extension(pi as never);
  if (!tool) throw new Error("browser_flow was not registered");
  return tool;
}

/** Loads the extension with its Pi lifecycle seams captured: `hooks` maps event name →
 * handler so tests can fire session_start / tool_result / agent_settled exactly as the
 * runtime would, scoped to a cwd via ctx. `mod` is the same module instance the default
 * export closed over, so exported helpers (listSessionEpisodes) share its state. */
type Hook = (event: any, ctx: any) => any;

async function loadExtensionWithHooks(): Promise<{ tool: Tool; hooks: Record<string, Hook>; mod: Record<string, any> }> {
  vi.resetModules();
  const hooks: Record<string, Hook> = {};
  let tool: Tool | undefined;
  const pi = {
    registerTool: vi.fn((definition: Tool) => {
      if (definition.name === "browser_flow") tool = definition;
    }),
    on: vi.fn((event: string, handler: Hook) => {
      hooks[event] = handler;
    }),
  };
  const mod = (await import(EXTENSION)) as Record<string, any>;
  mod.default(pi as never);
  if (!tool) throw new Error("browser_flow was not registered");
  return { tool: tool!, hooks, mod };
}

/** A tool_result event shaped like the runtime's for the browser tool: single-call
 * success details mirror the bridge response; batch envelopes carry {batch, ok, results}. */
function browserResultEvent(input: unknown, opts: { isError?: boolean; details?: unknown; content?: unknown[]; usage?: unknown } = {}) {
  return { type: "tool_result", toolName: "browser", toolCallId: "browser-call", input, content: opts.content ?? [], isError: opts.isError ?? false, ...(opts.usage !== undefined ? { usage: opts.usage } : {}), details: opts.details };
}

const ctxIn = (cwd: string) => ({ cwd });

async function fireBrowserResult(hooks: Record<string, Hook>, cwd: string, input: unknown, opts?: { isError?: boolean; details?: unknown }) {
  await hooks.tool_result(browserResultEvent(input, opts), ctxIn(cwd));
}

async function fireSettle(hooks: Record<string, Hook>, cwd: string) {
  await hooks.agent_settled({ type: "agent_settled" }, ctxIn(cwd));
}

async function fireSessionStart(hooks: Record<string, Hook>, cwd: string) {
  await hooks.session_start({ type: "session_start", reason: "new" }, ctxIn(cwd));
}

/** Stubs the loopback bridge; `handler` maps a decoded event to the host envelope. */
function stubBridge(handler: (event: any) => any = (event) => ({ ok: true, ...(event.action === "navigate" ? { url: event.url } : {}) })) {
  const calls: Array<{ envelope: any; event: any }> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: { body?: string }) => {
    const envelope = JSON.parse(String(init?.body ?? "{}"));
    const event = envelope.event ?? {};
    calls.push({ envelope, event });
    return { json: async () => handler(event) };
  }));
  return { calls };
}

const LOGIN_STEPS = [
  { action: "navigate", url: "https://example.com/login", note: "open the login page" },
  { action: "click", locator: { role: "button", name: "Sign in" } },
  { action: "input", locator: { label: "Password" }, valueParam: "password", valueShape: "password" },
  { action: "wait" },
];

async function saveLoginFlow(tool: Tool, cwd: string, name = "Deploy Login") {
  return tool.execute("t", { action: "save", name, description: "Log into the deploy dashboard", trigger: { urlContains: "/login", domains: ["example.com"] }, steps: LOGIN_STEPS }, undefined, undefined, { cwd });
}

afterEach(() => {
  vi.unstubAllGlobals();
  fsState.renameThrows = false;
});

afterAll(() => {
  // Env stays set for the whole file (the module snapshots it at import time); the temp
  // project roots are removed only at the very end so lazy assertions cannot race.
  delete process.env.PIPIUI_BRIDGE_PORT;
  delete process.env.PIPIUI_SESSION_KEY;
  delete process.env.PIPIUI_SESSION_CAPABILITY;
  for (const dir of projects) rmSync(dir, { recursive: true, force: true });
});

describe("browser_flow storage round trip", () => {
  it("saves, lists, shows and deletes a flow end to end", async () => {
    const tool = await loadFlowTool();
    const cwd = newProject();
    stubBridge();

    const saved = await saveLoginFlow(tool, cwd);
    expect(saved.isError).toBeUndefined();
    const file = join(cwd, ".pi", "agent", "browser-flows", "deploy-login.json");
    expect(existsSync(file)).toBe(true);

    const raw = JSON.parse(readFileSync(file, "utf-8"));
    expect(raw.schemaVersion).toBe(1);
    expect(raw.name).toBe("Deploy Login");
    expect(raw.description).toBe("Log into the deploy dashboard");
    expect(raw.trigger).toEqual({ urlContains: "/login", domains: ["example.com"] });
    expect(raw.steps).toHaveLength(4);
    // Params are derived from the steps, never declared by hand.
    expect(raw.params).toEqual({ password: { shape: "password" } });
    expect(typeof raw.createdAt).toBe("string");
    expect(typeof raw.updatedAt).toBe("string");

    const listed = await tool.execute("t", { action: "list" }, undefined, undefined, { cwd });
    expect(listed.isError).toBeUndefined();
    expect(listed.content[0].text).toContain("[deploy-login] Deploy Login — Log into the deploy dashboard (4 steps, params: password)");
    expect(listed.details.flows[0]).toMatchObject({ slug: "deploy-login", steps: 4, params: ["password"] });

    // show resolves both by flow name and by slug.
    for (const key of ["Deploy Login", "deploy-login"]) {
      const shown = await tool.execute("t", { action: "show", name: key }, undefined, undefined, { cwd });
      expect(shown.isError).toBeUndefined();
      expect(JSON.parse(shown.content[0].text)).toMatchObject({ name: "Deploy Login", schemaVersion: 1 });
    }

    const deleted = await tool.execute("t", { action: "delete", name: "Deploy Login" }, undefined, undefined, { cwd });
    expect(deleted.details).toEqual({ slug: "deploy-login", deleted: true });
    expect(existsSync(file)).toBe(false);
    const listedAfter = await tool.execute("t", { action: "list" }, undefined, undefined, { cwd });
    expect(listedAfter.details.flows).toEqual([]);
    expect(listedAfter.content[0].text).toContain("No saved flows yet.");
  });

  it("supports unicode (Chinese) flow names as slugs", async () => {
    const tool = await loadFlowTool();
    const cwd = newProject();
    stubBridge();
    const saved = await tool.execute("t", { action: "save", name: "登录流程", steps: [{ action: "navigate", url: "https://example.com" }] }, undefined, undefined, { cwd });
    expect(saved.isError).toBeUndefined();
    expect(saved.details.slug).toBe("登录流程");
    const shown = await tool.execute("t", { action: "show", name: "登录流程" }, undefined, undefined, { cwd });
    expect(JSON.parse(shown.content[0].text).name).toBe("登录流程");
  });

  it("re-saving replaces the flow and keeps the original createdAt", async () => {
    const tool = await loadFlowTool();
    const cwd = newProject();
    stubBridge();
    await saveLoginFlow(tool, cwd);
    const first = JSON.parse(readFileSync(join(cwd, ".pi", "agent", "browser-flows", "deploy-login.json"), "utf-8"));
    const second = await tool.execute("t", { action: "save", name: "Deploy Login", steps: [{ action: "navigate", url: "https://example.com/v2" }] }, undefined, undefined, { cwd });
    expect(second.content[0].text).toContain("replaced previous version");
    const stored = JSON.parse(readFileSync(join(cwd, ".pi", "agent", "browser-flows", "deploy-login.json"), "utf-8"));
    expect(stored.steps).toEqual([{ action: "navigate", url: "https://example.com/v2" }]);
    expect(stored.createdAt).toBe(first.createdAt);
    expect(stored.updatedAt >= first.updatedAt).toBe(true);
  });

  it("atomic write: a crash between tmp write and rename leaves the previous complete version intact", async () => {
    const tool = await loadFlowTool();
    const cwd = newProject();
    stubBridge();
    await saveLoginFlow(tool, cwd);
    const file = join(cwd, ".pi", "agent", "browser-flows", "deploy-login.json");
    const before = readFileSync(file, "utf-8");

    fsState.renameThrows = true; // die exactly at the commit point of the tmp+rename protocol
    const crashed = await tool.execute("t", { action: "save", name: "Deploy Login", steps: [{ action: "navigate", url: "https://example.com/partial" }] }, undefined, undefined, { cwd });
    expect(crashed.isError).toBe(true);
    expect(crashed.content[0].text).toContain("failed to write flow file");

    // The flow file still holds the complete previous version — never a half-written JSON.
    expect(readFileSync(file, "utf-8")).toBe(before);
    // The orphaned tmp file is hidden (dot-prefixed) so list ignores it.
    const entries = readdirSync(join(cwd, ".pi", "agent", "browser-flows"));
    expect(entries).toContain("deploy-login.json");
    expect(entries.filter((name) => name.startsWith(".") && name.endsWith(".tmp"))).toHaveLength(1);
    const listed = await tool.execute("t", { action: "list" }, undefined, undefined, { cwd });
    expect(listed.details.flows.map((f: any) => f.slug)).toEqual(["deploy-login"]);
  });

  it("tolerates corrupt store files: list skips them, show reports them, other flows stay usable", async () => {
    const tool = await loadFlowTool();
    const cwd = newProject();
    stubBridge();
    await saveLoginFlow(tool, cwd);
    const dir = join(cwd, ".pi", "agent", "browser-flows");
    writeFileSync(join(dir, "broken.json"), "{ this is not json", "utf-8");
    mkdirSync(join(dir, "shaped-wrong.json")); // a directory where a flow file should be

    const listed = await tool.execute("t", { action: "list" }, undefined, undefined, { cwd });
    expect(listed.isError).toBeUndefined();
    expect(listed.content[0].text).toContain("Unreadable (corrupt) flow files skipped: broken, shaped-wrong");
    expect(listed.details.flows.map((f: any) => f.slug)).toEqual(["deploy-login"]);

    const shown = await tool.execute("t", { action: "show", name: "broken" }, undefined, undefined, { cwd });
    expect(shown.isError).toBe(true);
    expect(shown.content[0].text).toContain("corrupt");
  });
});

describe("browser_flow secret red lines", () => {
  it("never persists run values: the flow file contains no trace of them", async () => {
    const tool = await loadFlowTool();
    const cwd = newProject();
    stubBridge();
    await saveLoginFlow(tool, cwd);
    const run = await tool.execute("t", { action: "run", name: "Deploy Login", params: { password: "hunter2-super-secret" } }, undefined, undefined, { cwd });
    expect(run.isError).toBeUndefined();

    const file = join(cwd, ".pi", "agent", "browser-flows", "deploy-login.json");
    expect(readFileSync(file, "utf-8")).not.toContain("hunter2-super-secret");
    // show exposes exactly what is stored, so it cannot leak either.
    const shown = await tool.execute("t", { action: "show", name: "Deploy Login" }, undefined, undefined, { cwd });
    expect(shown.content[0].text).not.toContain("hunter2-super-secret");
  });

  it("never echoes run values in results: input steps report the valueParam name", async () => {
    const tool = await loadFlowTool();
    const cwd = newProject();
    stubBridge();
    await saveLoginFlow(tool, cwd);
    const run = await tool.execute("t", { action: "run", name: "Deploy Login", params: { password: "hunter2-super-secret" } }, undefined, undefined, { cwd });
    expect(JSON.stringify(run)).not.toContain("hunter2-super-secret");
    const inputLine = run.content[0].text.split("\n").find((line: string) => line.includes("input"));
    expect(inputLine).toContain("(value: password)");
  });

  it("scrubs a host error that echoes the secret, and reports a structured failedStep + hint", async () => {
    const tool = await loadFlowTool();
    const cwd = newProject();
    stubBridge((event) =>
      event.action === "input"
        ? { ok: false, error: "typed hunter2-super-secret into a field that vanished" }
        : { ok: true, ...(event.action === "navigate" ? { url: event.url } : {}) },
    );
    await saveLoginFlow(tool, cwd);
    const run = await tool.execute("t", { action: "run", name: "Deploy Login", params: { password: "hunter2-super-secret" } }, undefined, undefined, { cwd });
    expect(run.isError).toBe(true);
    expect(JSON.stringify(run)).not.toContain("hunter2-super-secret");
    expect(run.content[0].text).toContain("‹redacted:password›");
    expect(run.details.failedStep).toEqual({ index: 2, action: "input", locator: { label: "Password" } });
    expect(run.details.completed).toBe(2);
    expect(run.content[0].text).toContain("Hint: The page may have changed");
  });

  it("sanitizes bridge redirect URLs in nested successful results and returned or thrown failures", async () => {
    const tool = await loadFlowTool();
    const cwd = newProject();
    const redirect = "https://user:pass@example.com/callback?token=hunter2#otp";
    await tool.execute("t", { action: "save", name: "Redirect", steps: [{ action: "navigate", url: "https://example.com/start" }] }, undefined, undefined, { cwd });

    const cyclic: any = { redirect };
    cyclic.self = cyclic;
    stubBridge(() => ({ ok: true, url: redirect, result: { redirects: [redirect, cyclic] } }));
    const success = await tool.execute("t", { action: "run", name: "Redirect" }, undefined, undefined, { cwd });
    expect(success.isError).toBeUndefined();
    expect(success.content[0].text).toContain("https://example.com/callback");
    expect(success.details.steps[0].url).toBe("https://example.com/callback");

    stubBridge(() => ({ ok: false, error: `redirect denied: ${redirect}` }));
    const returnedFailure = await tool.execute("t", { action: "run", name: "Redirect" }, undefined, undefined, { cwd });
    expect(returnedFailure.isError).toBe(true);
    expect(returnedFailure.content[0].text).toContain("redirect denied");
    expect(returnedFailure.content[0].text).toContain("https://example.com/callback");

    stubBridge(() => {
      throw new Error(`redirect exploded: ${redirect}`);
    });
    const thrownFailure = await tool.execute("t", { action: "run", name: "Redirect" }, undefined, undefined, { cwd });
    expect(thrownFailure.isError).toBe(true);
    expect(thrownFailure.content[0].text).toContain("redirect exploded");
    expect(thrownFailure.content[0].text).toContain("https://example.com/callback");

    for (const result of [success, returnedFailure, thrownFailure]) {
      const output = JSON.stringify(result);
      for (const forbidden of ["hunter2", "user:pass@", "?token", "#otp"]) expect(output).not.toContain(forbidden);
    }
  });

  it("scrubs URLs with apostrophes, backticks, and wrapping punctuation across run outputs", async () => {
    const tool = await loadFlowTool();
    const cwd = newProject();
    const apostropheRedirect = "https://user:pass@example.com/call'back?token=hunter2#otp";
    const backtickRedirect = "https://user:pass@example.com/call`back?token=hunter2#otp";
    const wrappedRedirect = `(https://user:pass@example.com/call\`back?token=hunter2#otp)`;
    await tool.execute("t", { action: "save", name: "Redirect", steps: [{ action: "navigate", url: "https://example.com/start" }] }, undefined, undefined, { cwd });

    stubBridge(() => ({ ok: true, url: apostropheRedirect }));
    const success = await tool.execute("t", { action: "run", name: "Redirect" }, undefined, undefined, { cwd });
    expect(success.isError).toBeUndefined();
    expect(success.details.steps[0].url).toBe("https://example.com/call'back");

    stubBridge(() => ({ ok: false, error: `redirect denied: ${backtickRedirect}` }));
    const returnedFailure = await tool.execute("t", { action: "run", name: "Redirect" }, undefined, undefined, { cwd });
    expect(returnedFailure.isError).toBe(true);
    expect(returnedFailure.content[0].text).toContain("redirect denied");
    expect(returnedFailure.content[0].text).toContain("https://example.com/call%60back");

    stubBridge(() => {
      throw new Error(`redirect exploded: ${wrappedRedirect}`);
    });
    const thrownFailure = await tool.execute("t", { action: "run", name: "Redirect" }, undefined, undefined, { cwd });
    expect(thrownFailure.isError).toBe(true);
    expect(thrownFailure.content[0].text).toContain("redirect exploded");
    expect(thrownFailure.content[0].text).toContain("https://example.com/call%60back");

    for (const result of [success, returnedFailure, thrownFailure]) {
      const output = JSON.stringify(result);
      for (const forbidden of ["hunter2", "user:pass@", "?token", "#otp"]) expect(output).not.toContain(forbidden);
    }
  });

  it("rejects a literal value sneaking into a step and rejects params passed to save", async () => {
    const tool = await loadFlowTool();
    const cwd = newProject();
    stubBridge();
    const withLiteral = await tool.execute("t", { action: "save", name: "Bad", steps: [{ action: "input", locator: { css: "#q" }, value: "hunter2-super-secret" }] }, undefined, undefined, { cwd });
    expect(withLiteral.isError).toBe(true);
    expect(withLiteral.content[0].text).toContain('unknown key "value"');
    expect(withLiteral.content[0].text).toContain("valueParam");

    const withParams = await tool.execute("t", { action: "save", name: "Bad", params: { password: "hunter2-super-secret" }, steps: [{ action: "navigate", url: "https://example.com" }] }, undefined, undefined, { cwd });
    expect(withParams.isError).toBe(true);
    expect(withParams.content[0].text).toContain("params must not be passed to save");
    expect(withParams.content[0].text).not.toContain("hunter2-super-secret");

    // Nothing was persisted by either rejected save.
    const listed = await tool.execute("t", { action: "list" }, undefined, undefined, { cwd });
    expect(listed.details.flows).toEqual([]);
  });
});

describe("browser_flow run", () => {
  const FLOW_STEPS = [
    { action: "navigate", url: "https://example.com/login" },
    { action: "click", locator: { role: "button", name: "Sign in" } },
    { action: "input", locator: { label: "Password" }, valueParam: "password", valueShape: "password" },
    { action: "select", locator: { css: "select#country" }, valueParam: "country" },
    { action: "fill_form", fields: [
      { locator: { label: "Full name" }, valueParam: "full_name" },
      { locator: { css: "input#email" }, valueParam: "email", valueShape: "email" },
    ] },
    { action: "wait" },
  ];
  const RUN_PARAMS = { password: "pw-1", country: "JP", full_name: "Ada Lovelace", email: "ada@example.com" };

  it("replays steps in order with the exact bridge envelope, locator passthrough and param substitution", async () => {
    const tool = await loadFlowTool();
    const cwd = newProject();
    const { calls } = stubBridge();
    const saved = await tool.execute("t", { action: "save", name: "Full Flow", steps: FLOW_STEPS }, undefined, undefined, { cwd });
    expect(saved.isError).toBeUndefined();
    expect(saved.details.params).toEqual(["password", "country", "full_name", "email"]);

    const run = await tool.execute("t", { action: "run", name: "Full Flow", params: RUN_PARAMS }, undefined, undefined, { cwd });
    expect(run.isError).toBeUndefined();
    expect(run.content[0].text).toContain("Flow completed: 6/6 steps.");

    expect(calls.map((c) => c.event.action)).toEqual(["navigate", "click", "input", "select", "fill_form", "wait"]);
    for (const { envelope } of calls) {
      expect(envelope.schemaVersion).toBe(1);
      expect(envelope.sessionCapability).toBe("browser-memory-test-cap");
      expect(envelope.action).toBe("browser_action");
      expect(typeof envelope.event.requestID).toBe("string");
      expect(envelope.event.scope).toBe("viewport");
    }
    // Locators pass through verbatim; values are substituted from run params.
    expect(calls[0].event.url).toBe("https://example.com/login");
    expect(calls[0].envelope.url).toBeUndefined(); // url travels inside event, not the envelope
    expect(calls[1].event.locator).toEqual({ role: "button", name: "Sign in" });
    expect(calls[2].event).toMatchObject({ locator: { label: "Password" }, text: "pw-1" });
    expect(calls[3].event).toMatchObject({ locator: { css: "select#country" }, option: "JP" });
    expect(calls[4].event.fields).toEqual([
      { locator: { label: "Full name" }, value: "Ada Lovelace" },
      { locator: { css: "input#email" }, value: "ada@example.com" },
    ]);
    expect(calls[5].event.mode).toBe("idle");

    // No value ever appears in the run result.
    expect(JSON.stringify(run)).not.toContain("pw-1");
    expect(run.details.steps[2]).toMatchObject({ index: 2, action: "input", valueParam: "password" });
  });

  it("fails fast on missing params, listing names only, without touching the bridge", async () => {
    const tool = await loadFlowTool();
    const cwd = newProject();
    const { calls } = stubBridge();
    await tool.execute("t", { action: "save", name: "Full Flow", steps: FLOW_STEPS }, undefined, undefined, { cwd });
    const run = await tool.execute("t", { action: "run", name: "Full Flow", params: { password: "pw-1" } }, undefined, undefined, { cwd });
    expect(run.isError).toBe(true);
    expect(run.content[0].text).toContain("could not start");
    expect(run.content[0].text).toContain("country, full_name, email");
    // The one provided value is never echoed — not even its param name with a value.
    expect(run.content[0].text).not.toContain("pw-1");
    expect(calls).toHaveLength(0);
    expect(run.details).toMatchObject({ ok: false, completed: 0, total: 6 });
  });

  it("stops at the first failing step with a structured failedStep and takeover hint", async () => {
    const tool = await loadFlowTool();
    const cwd = newProject();
    const { calls } = stubBridge((event) =>
      event.action === "select"
        ? { ok: false, error: "browser select failed: option not found" }
        : { ok: true, ...(event.action === "navigate" ? { url: event.url } : {}) },
    );
    await tool.execute("t", { action: "save", name: "Full Flow", steps: FLOW_STEPS }, undefined, undefined, { cwd });
    const run = await tool.execute("t", { action: "run", name: "Full Flow", params: RUN_PARAMS }, undefined, undefined, { cwd });
    expect(run.isError).toBe(true);
    expect(run.details.failedStep).toEqual({ index: 3, action: "select", locator: { css: "select#country" } });
    expect(run.details.error).toBe("browser select failed: option not found");
    expect(run.details.completed).toBe(3);
    expect(run.details.total).toBe(6);
    expect(run.content[0].text).toContain("failed at [4/6] select");
    expect(run.content[0].text).toContain("Hint: The page may have changed");
    // Replay stopped at the failure: no fill_form/wait calls were made.
    expect(calls.map((c) => c.event.action)).toEqual(["navigate", "click", "input", "select"]);
  });

  it("stops at a fill_form step whose fields partially failed even though the bridge replied ok:true", async () => {
    const tool = await loadFlowTool();
    const cwd = newProject();
    // Real host contract: fill_form stays ok:true and reports per-field outcomes
    // (controller.js fillForm → {ok:true, filled, failed, results}).
    const { calls } = stubBridge((event) =>
      event.action === "fill_form"
        ? {
            ok: true,
            filled: 1,
            failed: 1,
            results: [
              { index: 0, ok: true },
              { index: 1, ok: false, error: "browser_locator_not_found", message: "locator matched 0 elements. Candidates: []" },
            ],
          }
        : { ok: true, ...(event.action === "navigate" ? { url: event.url } : {}) },
    );
    const steps = [
      { action: "navigate", url: "https://example.com/signup" },
      { action: "fill_form", fields: [
        { locator: { label: "Full name" }, valueParam: "full_name" },
        { locator: { css: "input#email" }, valueParam: "email", valueShape: "email" },
      ] },
      { action: "click", locator: { role: "button", name: "Create account" } },
    ];
    await tool.execute("t", { action: "save", name: "Signup", steps }, undefined, undefined, { cwd });
    const run = await tool.execute("t", { action: "run", name: "Signup", params: { full_name: "Ada Lovelace", email: "ada@example.com" } }, undefined, undefined, { cwd });
    expect(run.isError).toBe(true);
    // The run stops AT the fill_form step: the submit click must never fire against a half-filled form.
    expect(calls.map((c) => c.event.action)).toEqual(["navigate", "fill_form"]);
    expect(run.details.completed).toBe(1);
    expect(run.details.total).toBe(3);
    expect(run.details.failedStep).toMatchObject({ index: 1, action: "fill_form" });
    expect(run.details.failedStep.failedFields).toEqual([
      { field: 1, locator: { css: "input#email" }, valueParam: "email", error: "browser_locator_not_found — locator matched 0 elements. Candidates: []" },
    ]);
    expect(run.content[0].text).toContain("failed at [2/3] fill_form");
    expect(run.content[0].text).toContain("1 field(s) but 1 failed");
    expect(run.content[0].text).toContain("field #2 (email): browser_locator_not_found");
    expect(run.content[0].text).toContain("Hint: The page may have changed");
    // Field failures never echo the attempted values.
    expect(JSON.stringify(run)).not.toContain("Ada Lovelace");
    expect(JSON.stringify(run)).not.toContain("ada@example.com");
  });

  it("scrubs a fill_form field error that echoes the attempted value", async () => {
    const tool = await loadFlowTool();
    const cwd = newProject();
    const { calls } = stubBridge((event) =>
      event.action === "fill_form"
        ? { ok: true, filled: 0, failed: 1, results: [{ index: 0, ok: false, error: "stale_browser_snapshot", message: "could not write ada@example.com before navigation" }] }
        : { ok: true, ...(event.action === "navigate" ? { url: event.url } : {}) },
    );
    const steps = [
      { action: "navigate", url: "https://example.com/signup" },
      { action: "fill_form", fields: [{ locator: { css: "input#email" }, valueParam: "email" }] },
    ];
    await tool.execute("t", { action: "save", name: "Signup", steps }, undefined, undefined, { cwd });
    const run = await tool.execute("t", { action: "run", name: "Signup", params: { email: "ada@example.com" } }, undefined, undefined, { cwd });
    expect(run.isError).toBe(true);
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(run)).not.toContain("ada@example.com");
    expect(run.content[0].text).toContain("‹redacted:email›");
    expect(run.details.failedStep.failedFields).toEqual([
      { field: 0, locator: { css: "input#email" }, valueParam: "email", error: "stale_browser_snapshot — could not write ‹redacted:email› before navigation" },
    ]);
  });

  it("passes a fill_form step when the host reports every field written (failed: 0)", async () => {
    const tool = await loadFlowTool();
    const cwd = newProject();
    const { calls } = stubBridge((event) =>
      event.action === "fill_form"
        ? { ok: true, filled: 2, failed: 0, results: [{ index: 0, ok: true }, { index: 1, ok: true }] }
        : { ok: true, ...(event.action === "navigate" ? { url: event.url } : {}) },
    );
    const steps = [
      { action: "navigate", url: "https://example.com/signup" },
      { action: "fill_form", fields: [
        { locator: { label: "Full name" }, valueParam: "full_name" },
        { locator: { css: "input#email" }, valueParam: "email" },
      ] },
      { action: "click", locator: { role: "button", name: "Create account" } },
    ];
    await tool.execute("t", { action: "save", name: "Signup", steps }, undefined, undefined, { cwd });
    const run = await tool.execute("t", { action: "run", name: "Signup", params: { full_name: "Ada", email: "ada@example.com" } }, undefined, undefined, { cwd });
    expect(run.isError).toBeUndefined();
    expect(calls.map((c) => c.event.action)).toEqual(["navigate", "fill_form", "click"]);
    expect(run.content[0].text).toContain("Flow completed: 3/3 steps.");
  });
});

describe("browser_flow save validation", () => {
  it("rejects actions outside the whitelist and lists the allowed set", async () => {
    const tool = await loadFlowTool();
    const cwd = newProject();
    stubBridge();
    const result = await tool.execute("t", { action: "save", name: "Bad", steps: [
      { action: "observe" },
      { action: "eval", js: "fetch('https://evil')" },
    ] }, undefined, undefined, { cwd });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('action "observe" is not allowed');
    expect(result.content[0].text).toContain('action "eval" is not allowed');
    expect(result.content[0].text).toContain("navigate, wait, click, input, select, scroll, fill_form, back, forward, reload");
    const listed = await tool.execute("t", { action: "list" }, undefined, undefined, { cwd });
    expect(listed.details.flows).toEqual([]);
  });

  it("rejects invalid locator forms, missing valueShape, and literal select options", async () => {
    const tool = await loadFlowTool();
    const cwd = newProject();
    stubBridge();
    const cases: Array<{ steps: unknown[]; mustMention: string }> = [
      { steps: [{ action: "click", locator: { role: "button" } }], mustMention: "requires both role and name" },
      { steps: [{ action: "click", locator: { css: "#a", text: "Go" } }], mustMention: "exactly one of" },
      { steps: [{ action: "click", locator: { snapshot_id: "snap-1" } }], mustMention: 'unknown locator key "snapshot_id"' },
      { steps: [{ action: "input", locator: { css: "#q" }, valueParam: "q" }], mustMention: "valueShape must be a short non-empty string" },
      { steps: [{ action: "select", locator: { css: "#c" }, option: "JP" }], mustMention: 'unknown key "option"' },
      { steps: [{ action: "navigate", locator: { css: "#x" }, url: "https://example.com" }], mustMention: "not allowed on navigate steps" },
      { steps: [], mustMention: "steps must be a non-empty array" },
    ];
    for (const { steps, mustMention } of cases) {
      const result = await tool.execute("t", { action: "save", name: "Invalid", steps }, undefined, undefined, { cwd });
      expect(result.isError, `expected rejection for ${JSON.stringify(steps)}`).toBe(true);
      expect(result.content[0].text, `expected "${mustMention}" for ${JSON.stringify(steps)}`).toContain(mustMention);
    }
  });
});

describe("browser_flow action × locator contract (mirrors the host bridge)", () => {
  it("rejects \"type\" entirely with an actionable pointer to input — the bridge cannot replay it", async () => {
    const tool = await loadFlowTool();
    const cwd = newProject();
    stubBridge();
    // Both flavors are rejected: type+locator is not a locator-targeted action on the
    // host (only CSS-selector append exists), and bare type has no focused-element
    // keyboard path through the bridge either (the host renames it to input, which
    // then fails target resolution). Saving either would recreate "taught but
    // unreplayable" flows, so save refuses both with the same actionable error.
    const withLocator = await tool.execute("t", { action: "save", name: "Typed", steps: [
      { action: "type", locator: { text: "Search" }, valueParam: "query", valueShape: "text" },
    ] }, undefined, undefined, { cwd });
    expect(withLocator.isError).toBe(true);
    expect(withLocator.content[0].text).toContain('action "type" cannot be replayed');
    expect(withLocator.content[0].text).toContain('use "input" with a locator');

    const bare = await tool.execute("t", { action: "save", name: "Typed", steps: [
      { action: "type", valueParam: "query", valueShape: "text" },
    ] }, undefined, undefined, { cwd });
    expect(bare.isError).toBe(true);
    expect(bare.content[0].text).toContain('action "type" cannot be replayed');

    const listed = await tool.execute("t", { action: "list" }, undefined, undefined, { cwd });
    expect(listed.details.flows).toEqual([]);
  });

  it("accepts exactly the locator-targeted actions the host bridge supports (click/input/select/scroll), and accepts targetless scroll/wait/navigation", async () => {
    const tool = await loadFlowTool();
    const cwd = newProject();
    stubBridge();
    const locator = { css: "#target" };
    const accepted: Array<{ name: string; steps: unknown[] }> = [
      { name: "Click Flow", steps: [{ action: "click", locator }] },
      { name: "Input Flow", steps: [{ action: "input", locator, valueParam: "q", valueShape: "text" }] },
      { name: "Select Flow", steps: [{ action: "select", locator, valueParam: "opt" }] },
      { name: "Scroll To Element Flow", steps: [{ action: "scroll", locator }] },
      { name: "Page Scroll Flow", steps: [{ action: "scroll" }] },
      { name: "Wait Flow", steps: [{ action: "wait" }] },
      { name: "Navigate Flow", steps: [{ action: "navigate", url: "https://example.com" }] },
      { name: "Back Flow", steps: [{ action: "back" }] },
    ];
    for (const { name, steps } of accepted) {
      const result = await tool.execute("t", { action: "save", name, steps }, undefined, undefined, { cwd });
      expect(result.isError, `expected acceptance for ${JSON.stringify(steps)}`).toBeUndefined();
    }
  });

  it("rejects locators and payload keys on actions the host bridge does not target with them", async () => {
    const tool = await loadFlowTool();
    const cwd = newProject();
    stubBridge();
    const locator = { css: "#target" };
    const cases: Array<{ steps: unknown[]; mustMention: string }> = [
      // wait/back/forward/reload/navigate carry no target: the bridge would silently
      // ignore the locator, so save refuses to store the misleading step.
      { steps: [{ action: "wait", locator }], mustMention: "locator is not allowed on wait steps" },
      { steps: [{ action: "back", locator }], mustMention: "locator is not allowed on back steps" },
      { steps: [{ action: "forward", locator }], mustMention: "locator is not allowed on forward steps" },
      { steps: [{ action: "reload", locator }], mustMention: "locator is not allowed on reload steps" },
      { steps: [{ action: "navigate", locator, url: "https://example.com" }], mustMention: "locator is not allowed on navigate steps" },
      // fields belongs to fill_form only; step-level valueParam on fill_form would be
      // silently dropped by the validator, so it is refused explicitly.
      { steps: [{ action: "click", locator, fields: [{ locator, valueParam: "x" }] }], mustMention: "fields is only allowed on fill_form steps" },
      { steps: [{ action: "fill_form", valueParam: "x", fields: [{ locator, valueParam: "y" }] }], mustMention: "valueParam is only allowed on input/select steps" },
      { steps: [{ action: "scroll", valueParam: "x" }], mustMention: "valueParam is only allowed on input/select steps" },
    ];
    for (const { steps, mustMention } of cases) {
      const result = await tool.execute("t", { action: "save", name: "Invalid", steps }, undefined, undefined, { cwd });
      expect(result.isError, `expected rejection for ${JSON.stringify(steps)}`).toBe(true);
      expect(result.content[0].text, `expected "${mustMention}" for ${JSON.stringify(steps)}`).toContain(mustMention);
    }
    const listed = await tool.execute("t", { action: "list" }, undefined, undefined, { cwd });
    expect(listed.details.flows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Episode / candidate contract (pure functions, no hooks): normalize one
// successful browser call into replayable FlowSteps, and match/rank URL
// triggers for candidates. Literals must never survive normalization.
// ---------------------------------------------------------------------------

describe("browser episode contract: normalizeBrowserCall", () => {
  it("normalizes a single locator-targeted action into one FlowStep", async () => {
    const mod = await loadExtensionModule();
    expect(mod.normalizeBrowserCall({ action: "click", locator: { role: "button", name: "Sign in" } })).toEqual({
      ok: true,
      steps: [{ action: "click", locator: { role: "button", name: "Sign in" } }],
    });
    expect(mod.normalizeBrowserCall({ action: "navigate", url: "https://example.com" })).toEqual({
      ok: true,
      steps: [{ action: "navigate", url: "https://example.com" }],
    });
  });

  it("normalizes an actions[] batch in order, dropping host-only params (scope, timeouts, snapshot context)", async () => {
    const mod = await loadExtensionModule();
    const result = mod.normalizeBrowserCall({
      actions: [
        { action: "navigate", url: "https://example.com/signup", scope: "page" },
        { action: "fill_form", snapshot_id: "snap-leaked-token", fields: [
          { locator: { label: "Full name" }, value: "Ada Lovelace" },
          { locator: { css: "input#email" }, value: "ada@example.com" },
        ] },
        { action: "click", locator: { role: "button", name: "Create account" }, scope: "page" },
        { action: "wait", timeout: 5, idle_ms: 800 },
        { action: "scroll", selector: ".toc" },
        { action: "back" },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.steps).toEqual([
      { action: "navigate", url: "https://example.com/signup" },
      { action: "fill_form", fields: [
        { locator: { label: "Full name" }, valueParam: "full_name", valueShape: "text" },
        { locator: { css: "input#email" }, valueParam: "email", valueShape: "text" },
      ] },
      { action: "click", locator: { role: "button", name: "Create account" } },
      { action: "wait" },
      { action: "scroll", locator: { css: ".toc" } },
      { action: "back" },
    ]);
    const flat = JSON.stringify(result);
    expect(flat).not.toContain("snap-leaked-token");
    expect(flat).not.toContain("Ada Lovelace");
    expect(flat).not.toContain("ada@example.com");
  });

  it("parameterizes input/select literals into deterministic valueParam/valueShape and never echoes them", async () => {
    const mod = await loadExtensionModule();
    const call = {
      actions: [
        { action: "input", locator: { label: "Password" }, text: "hunter2-super-secret" },
        { action: "select", locator: { css: "select#country" }, option: "Japan" },
      ],
    };
    const result = mod.normalizeBrowserCall(call);
    expect(result.ok).toBe(true);
    expect(result.steps).toEqual([
      { action: "input", locator: { label: "Password" }, valueParam: "password", valueShape: "text" },
      { action: "select", locator: { css: "select#country" }, valueParam: "country", valueShape: "option" },
    ]);
    const flat = JSON.stringify(result);
    expect(flat).not.toContain("hunter2-super-secret");
    expect(flat).not.toContain("Japan");
    // Deterministic: the same call normalizes to the exact same steps.
    expect(mod.normalizeBrowserCall(call)).toEqual(result);
  });

  it("derives param names from locator semantics with readable ordinals on conflicts, all matching the valueParam pattern", async () => {
    const mod = await loadExtensionModule();
    const result = mod.normalizeBrowserCall({
      actions: [
        { action: "fill_form", fields: [
          { locator: { label: "Email" }, value: "a@x.com" },
          { locator: { label: "Email" }, value: "b@x.com" },
          { locator: { label: "Email" }, value: "c@x.com" },
        ] },
        { action: "input", locator: { css: "input#login-email" }, text: "d@x.com" },
        { action: "input", locator: { css: ".password-field" }, text: "pw" },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.steps[0].fields.map((f: any) => f.valueParam)).toEqual(["email", "email_2", "email_3"]);
    expect(result.steps[1].valueParam).toBe("login_email");
    expect(result.steps[2].valueParam).toBe("password_field");
    const pattern = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
    for (const name of mod.requiredParams(result.steps)) expect(name).toMatch(pattern);
  });

  it("falls back deterministically when locator semantics are not ASCII identifier material", async () => {
    const mod = await loadExtensionModule();
    const result = mod.normalizeBrowserCall({
      actions: [
        { action: "input", locator: { label: "用户名" }, text: "ada- identifier" },
        { action: "input", locator: { label: "密码" }, text: "pw- identifier" },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.steps.map((s: any) => s.valueParam)).toEqual(["value", "value_2"]);
    const flat = JSON.stringify(result);
    expect(flat).not.toContain("ada- identifier");
  });

  it("rejects side-effect actions by name; filters read-only batch items and still names a bad item's index", async () => {
    const mod = await loadExtensionModule();
    for (const action of ["observe", "eval", "script", "screenshot", "content", "watch", "unwatch", "watches", "console", "help"]) {
      const result = mod.normalizeBrowserCall({ action });
      expect(result.ok, action).toBe(false);
      expect(result.error, action).toContain(`"${action}"`);
    }
    const typed = mod.normalizeBrowserCall({ action: "type", text: "x" });
    expect(typed.ok).toBe(false);
    expect(typed.error).toContain('"type" cannot be replayed');
    expect(typed.error).toContain('use "input" with a locator');

    // Read-only items in a batch are filtered, not fatal: the host recommends a trailing
    // observe/screenshot, and the replayable prefix survives it verbatim.
    const mixed = mod.normalizeBrowserCall({
      actions: [
        { action: "click", locator: { role: "button", name: "Sign in" } },
        { action: "wait" },
        { action: "observe" },
        { action: "screenshot" },
      ],
    });
    expect(mixed).toEqual({ ok: true, steps: [
      { action: "click", locator: { role: "button", name: "Sign in" } },
      { action: "wait" },
    ] });
    // An all-read-only batch contributes no steps at all (the pipeline ignores it outright).
    expect(mod.normalizeBrowserCall({ actions: [{ action: "observe" }, { action: "screenshot" }] })).toEqual({ ok: true, steps: [] });
    // A genuinely non-replayable item still rejects the whole call, naming its index.
    const bad = mod.normalizeBrowserCall({ actions: [{ action: "navigate", url: "https://example.com" }, { action: "click", snapshot_id: "snap-LEAK" }] });
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("actions[1]");
    expect(JSON.stringify(bad)).not.toContain("https://example.com");
    expect(JSON.stringify(bad)).not.toContain("snap-LEAK");
  });

  it("rejects snapshot/index/token targeting and positional nth, without echoing any token", async () => {
    const mod = await loadExtensionModule();
    const cases = [
      { action: "click", snapshot_id: "snap-LEAK", element_index: 3 },
      { action: "input", element_token: "tok-LEAK", text: "hunter2-super-secret" },
      { action: "select", locator: { role: "combobox", name: "Country", nth: 1 }, option: "Japan" },
      { action: "click", locator: { snapshot_id: "snap-LEAK" } },
      { action: "fill_form", fields: [{ element_token: "tok-LEAK", value: "hunter2-super-secret" }] },
      { action: "wait", snapshot_id: "snap-LEAK", mode: "idle" },
    ];
    for (const [i, input] of cases.entries()) {
      const result = mod.normalizeBrowserCall(input);
      expect(result.ok, `case ${i}: ${JSON.stringify(Object.keys(input))}`).toBe(false);
      const flat = JSON.stringify(result);
      expect(flat, `case ${i}`).not.toContain("LEAK");
      expect(flat, `case ${i}`).not.toContain("hunter2-super-secret");
    }
    expect(mod.normalizeBrowserCall(cases[0]).error).toContain("snapshot_id");
    expect(mod.normalizeBrowserCall(cases[2]).error).toContain("nth");
  });

  it("captures only idle waits and bare/locator-scoped scrolls; selector waits and direction/amount scrolls are rejected", async () => {
    const mod = await loadExtensionModule();
    expect(mod.normalizeBrowserCall({ action: "wait" })).toEqual({ ok: true, steps: [{ action: "wait" }] });
    expect(mod.normalizeBrowserCall({ action: "wait", mode: "idle" })).toEqual({ ok: true, steps: [{ action: "wait" }] });
    expect(mod.normalizeBrowserCall({ action: "wait", mode: "selector", selector: ".x" }).ok).toBe(false);
    expect(mod.normalizeBrowserCall({ action: "scroll" })).toEqual({ ok: true, steps: [{ action: "scroll" }] });
    expect(mod.normalizeBrowserCall({ action: "scroll", locator: { css: ".toc" } }).steps[0].locator).toEqual({ css: ".toc" });
    expect(mod.normalizeBrowserCall({ action: "scroll", direction: "up" }).ok).toBe(false);
    expect(mod.normalizeBrowserCall({ action: "scroll", amount: 2 }).ok).toBe(false);
  });

  it("requires exactly one of action or actions, with 1..8 batch items", async () => {
    const mod = await loadExtensionModule();
    expect(mod.normalizeBrowserCall({}).ok).toBe(false);
    expect(mod.normalizeBrowserCall({ action: "wait", actions: [{ action: "wait" }] }).ok).toBe(false);
    expect(mod.normalizeBrowserCall({ actions: [] }).ok).toBe(false);
    expect(mod.normalizeBrowserCall({ actions: Array.from({ length: 9 }, () => ({ action: "wait" })) }).ok).toBe(false);
    expect(mod.normalizeBrowserCall({ actions: Array.from({ length: 8 }, () => ({ action: "wait" })) }).ok).toBe(true);
    expect(mod.normalizeBrowserCall("navigate").ok).toBe(false);
  });

  it("normalized steps round-trip through validateFlowInput unchanged", async () => {
    const mod = await loadExtensionModule();
    const result = mod.normalizeBrowserCall({
      actions: [
        { action: "navigate", url: "https://example.com/signup" },
        { action: "input", locator: { label: "Password" }, text: "hunter2-super-secret" },
        { action: "select", locator: { css: "select#country" }, option: "Japan" },
        { action: "fill_form", fields: [{ locator: { label: "Full name" }, value: "Ada Lovelace" }] },
        { action: "click", locator: { role: "button", name: "Create account" } },
        { action: "wait" },
        { action: "scroll" },
        { action: "reload" },
      ],
    });
    expect(result.ok).toBe(true);
    const validated = mod.validateFlowInput({ name: "From Episode", description: "", trigger: {}, steps: result.steps });
    expect(validated.ok).toBe(true);
    expect(validated.flow.steps).toEqual(result.steps);
    expect(validated.flow.params).toEqual({
      password: { shape: "text" },
      country: { shape: "option" },
      full_name: { shape: "text" },
    });
  });
});

describe("browser candidate contract: trigger match + ranking", () => {
  it("matchFlowTrigger: domain, urlContains, precedence, empty-trigger fallback, no match", async () => {
    const mod = await loadExtensionModule();
    const url = "https://example.com/login?next=/dash";
    expect(mod.matchFlowTrigger({ domains: ["example.com"] }, url)).toBe("domain");
    expect(mod.matchFlowTrigger({ domains: ["other.com"] }, url)).toBeUndefined();
    // Exact host match only: a subdomain of a listed domain is a different page class.
    expect(mod.matchFlowTrigger({ domains: ["example.com"] }, "https://www.example.com/login")).toBeUndefined();
    expect(mod.matchFlowTrigger({ urlContains: "/login" }, url)).toBe("urlContains");
    // When both clauses are declared they are conjunctive: each independently matching
    // clause is insufficient, while the exact host + path remains the pinned match.
    const both = { urlContains: "/login", domains: ["example.com"] };
    expect(mod.matchFlowTrigger(both, "https://example.com/login")).toBe("urlContains");
    expect(mod.matchFlowTrigger(both, "https://evil.example/login")).toBeUndefined();
    expect(mod.matchFlowTrigger(both, "https://example.com/other")).toBeUndefined();
    expect(mod.matchFlowTrigger(both, "https://evil.example/other")).toBeUndefined();
    // Empty trigger falls back to the flow/episode's first navigate host.
    expect(mod.matchFlowTrigger({}, url, "https://example.com/other")).toBe("firstNavigate");
    expect(mod.matchFlowTrigger({}, url, "https://other.com/x")).toBeUndefined();
    expect(mod.matchFlowTrigger({}, url)).toBeUndefined();
    // A non-empty trigger that misses does NOT fall back.
    expect(mod.matchFlowTrigger({ domains: ["other.com"] }, url, "https://example.com/x")).toBeUndefined();
  });

  it("rankCandidates: urlContains above domain above firstNavigate, episodes before flows on equal match, non-matching dropped", async () => {
    const mod = await loadExtensionModule();
    const candidates = [
      {
        id: "deploy-login", name: "Deploy Login", source: "flow",
        trigger: { urlContains: "/login", domains: ["example.com"] },
        steps: [
          { action: "navigate", url: "https://example.com/login" },
          { action: "input", locator: { label: "Password" }, valueParam: "password", valueShape: "password" },
        ],
      },
      { id: "dashboard-daily", name: "Dashboard Daily", source: "flow", trigger: { domains: ["example.com"] }, steps: [{ action: "navigate", url: "https://example.com/dash" }] },
      { id: "unrelated", name: "Unrelated", source: "flow", trigger: { domains: ["other.com"] }, steps: [] },
      { id: "login-episode", name: "Login Episode", source: "episode", trigger: {}, steps: [{ action: "navigate", url: "https://example.com/login" }, { action: "wait" }] },
    ];
    const ranked = mod.rankCandidates("https://example.com/login", candidates);
    expect(ranked.map((c: any) => [c.id, c.match])).toEqual([
      ["deploy-login", "urlContains"],
      ["dashboard-daily", "domain"],
      ["login-episode", "firstNavigate"],
    ]);
    // Surfaced candidate: slug id passthrough, params derived from steps, no trigger echo.
    expect(ranked[0]).toEqual({
      id: "deploy-login", name: "Deploy Login", source: "flow",
      steps: candidates[0].steps, params: ["password"], match: "urlContains",
    });

    // Equal match kind: the session episode precedes the saved flow.
    const tied = mod.rankCandidates("https://example.com/other", [
      { id: "flow-a", name: "A", source: "flow", trigger: { domains: ["example.com"] }, steps: [] },
      { id: "episode-a", name: "E", source: "episode", trigger: { domains: ["example.com"] }, steps: [] },
    ]);
    expect(tied.map((c: any) => c.id)).toEqual(["episode-a", "flow-a"]);
  });

  it("uniqueSlug: semantic slug base with readable ordinals on conflict", async () => {
    const mod = await loadExtensionModule();
    expect(mod.uniqueSlug("Deploy Login", [])).toBe("deploy-login");
    expect(mod.uniqueSlug("Deploy Login", ["deploy-login"])).toBe("deploy-login_2");
    expect(mod.uniqueSlug("Deploy Login", ["deploy-login", "deploy-login_2"])).toBe("deploy-login_3");
    expect(mod.uniqueSlug("!!？", [])).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Auto-capture loop (episode slice): tool_result feeds a per-run trace of
// replayable steps from successful `browser` calls; agent_settled seals it as a
// same-session episode (≥2 steps, never invalidated). The capture harness fires
// the real Pi lifecycle seams against a temp cwd; nothing here touches fs or the
// bridge — episodes are memory-only and values never survive normalization.
// ---------------------------------------------------------------------------

const NAV_LOGIN = { details: { ok: true, url: "https://example.com/login" } };

async function runLoginTrace(hooks: Record<string, Hook>, cwd: string, opts: { sideEffect?: string } = {}) {
  await fireBrowserResult(hooks, cwd, { action: "navigate", url: "https://example.com/login" }, NAV_LOGIN);
  await fireBrowserResult(hooks, cwd, { action: "click", locator: { role: "button", name: "Sign in" } }, { details: { ok: true } });
  if (opts.sideEffect !== undefined) {
    await fireBrowserResult(
      hooks,
      cwd,
      opts.sideEffect === "type" ? { action: "type", selector: "#pw", text: "hunter2-super-secret" } : { action: opts.sideEffect, js: "1+1" },
      { details: { ok: true } },
    );
  }
}

describe("browser auto-capture: lifecycle harness", () => {
  it("registers session_start / tool_result / agent_settled handlers alongside browser_flow", async () => {
    const { tool, hooks } = await loadExtensionWithHooks();
    expect(typeof tool.execute).toBe("function");
    expect(typeof hooks.session_start).toBe("function");
    expect(typeof hooks.tool_result).toBe("function");
    expect(typeof hooks.agent_settled).toBe("function");
  });
});

describe("browser candidate routing", () => {
  it("patches a successful navigate with saved candidates while preserving original result fields and exposing no flow internals", async () => {
    const { tool, hooks } = await loadExtensionWithHooks();
    const cwd = newProject();
    await saveLoginFlow(tool, cwd);
    const image = { type: "image", data: "unchanged-image" };
    const originalDetails = { ok: true, url: "https://example.com/login", snapshotID: "snap-original", nested: { token: "tok-original" } };
    const event = browserResultEvent({ action: "navigate", url: "https://example.com/login" }, { content: [image], usage: { inputTokens: 7 }, details: originalDetails });
    const patch = await hooks.tool_result(event, ctxIn(cwd));

    expect(patch.content[0]).toEqual(image);
    expect(patch.details).toMatchObject(originalDetails);
    expect(patch.content).toHaveLength(2);
    expect(patch.content[1].text).toContain('name:"deploy-login"');
    expect(patch).not.toHaveProperty("isError");
    expect(patch).not.toHaveProperty("usage");
    expect(patch.details.browserFlowCandidates).toEqual([{
      id: "deploy-login", name: "Deploy Login", source: "flow", match: "urlContains", steps: 4, paramNames: ["password"],
    }]);
    expect(patch.details.recommendedBrowserFlow).toEqual({ action: "run", name: "deploy-login", missingParams: ["password"] });
    const surfaced = JSON.stringify(patch.details.browserFlowCandidates);
    for (const forbidden of ["trigger", "locator", "snapshot", "token", "hunter2", "Sign in"]) expect(surfaced).not.toContain(forbidden);
  });

  it("uses the last navigate/observe URL in a batch, limits ranked candidates to three, and gives tied episodes precedence", async () => {
    const { tool, hooks } = await loadExtensionWithHooks();
    const cwd = newProject();
    await fireSessionStart(hooks, cwd);
    await runLoginTrace(hooks, cwd);
    await fireSettle(hooks, cwd);
    for (const name of ["One", "Two", "Three", "Four"]) {
      await tool.execute("t", { action: "save", name, trigger: {}, steps: [{ action: "navigate", url: "https://example.com/start" }, { action: "wait" }] }, undefined, undefined, { cwd });
    }
    const patch = await hooks.tool_result(
      browserResultEvent(
        { actions: [{ action: "click", locator: { css: "#go" } }, { action: "navigate", url: "https://example.com/other" }, { action: "observe" }] },
        { details: { batch: true, ok: true, url: "https://wrong.example", results: [
          { index: 0, action: "click", status: "ok" },
          { index: 1, action: "navigate", status: "ok", details: { url: "https://example.com/other" } },
          { index: 2, action: "observe", status: "ok", details: { url: "https://example.com/login" } },
        ] } },
      ),
      ctxIn(cwd),
    );
    expect(patch.details.browserFlowCandidates).toHaveLength(3);
    expect(patch.details.browserFlowCandidates.map((candidate: any) => candidate.id)).toEqual([
      "example-com-login-click-sign-in", "four", "one",
    ]);
    expect(patch.details.browserFlowCandidates[0]).toMatchObject({ source: "episode", match: "firstNavigate" });
  });

  it("does not patch failed, URL-less, or unrelated successful browser results", async () => {
    const { tool, hooks } = await loadExtensionWithHooks();
    const cwd = newProject();
    await saveLoginFlow(tool, cwd);
    for (const event of [
      browserResultEvent({ action: "navigate", url: "https://example.com/login" }, { isError: true, details: { ok: false, url: "https://example.com/login" } }),
      browserResultEvent({ action: "observe" }, { details: { ok: true } }),
      browserResultEvent({ action: "click", locator: { css: "#go" } }, { details: { ok: true, url: "https://example.com/login" } }),
    ]) expect(await hooks.tool_result(event, ctxIn(cwd))).toBeUndefined();
  });

  it("runs a sealed episode directly and prefers it over a saved flow with the same id", async () => {
    const { tool, hooks } = await loadExtensionWithHooks();
    const cwd = newProject();
    await fireSessionStart(hooks, cwd);
    await runLoginTrace(hooks, cwd);
    await fireSettle(hooks, cwd);
    await tool.execute("t", { action: "save", name: "example com login click sign in", steps: [{ action: "navigate", url: "https://saved.example/should-not-run" }] }, undefined, undefined, { cwd });
    const bridge = stubBridge();
    const result = await tool.execute("t", { action: "run", name: "example-com-login-click-sign-in" }, undefined, undefined, { cwd });
    expect(result.isError).toBeUndefined();
    expect(result.details).toMatchObject({ slug: "example-com-login-click-sign-in", source: "episode" });
    expect(bridge.calls.map((call) => call.event.action)).toEqual(["navigate", "click"]);
    expect(bridge.calls[0].event.url).toBe("https://example.com/login");
    expect(JSON.stringify(result)).not.toContain("should-not-run");
  });

  it("uses source-qualified candidate references so a recommended saved-flow collision cannot run the episode", async () => {
    const { tool, hooks } = await loadExtensionWithHooks();
    const cwd = newProject();
    await fireSessionStart(hooks, cwd);
    await runLoginTrace(hooks, cwd);
    await fireSettle(hooks, cwd);
    await tool.execute("t", {
      action: "save",
      name: "example com login click sign in",
      trigger: { domains: ["example.com"], urlContains: "/login" },
      steps: [{ action: "navigate", url: "https://saved.example/flow" }, { action: "wait" }],
    }, undefined, undefined, { cwd });

    const patch = await hooks.tool_result(
      browserResultEvent({ action: "navigate", url: "https://example.com/login" }, { details: { ok: true, url: "https://example.com/login" } }),
      ctxIn(cwd),
    );
    expect(patch.details.recommendedBrowserFlow).toMatchObject({ action: "run", name: "saved:example-com-login-click-sign-in" });
    expect(patch.details.browserFlowCandidates).toContainEqual(expect.objectContaining({ id: "saved:example-com-login-click-sign-in", source: "flow" }));

    const bridge = stubBridge();
    const result = await tool.execute("t", { action: "run", name: patch.details.recommendedBrowserFlow.name }, undefined, undefined, { cwd });
    expect(result.details).toMatchObject({ source: "flow", slug: "example-com-login-click-sign-in" });
    expect(bridge.calls.map((call) => call.event.action)).toEqual(["navigate", "wait"]);
    expect(bridge.calls[0].event.url).toBe("https://saved.example/flow");
  });

  it("guides direct execution of recommended candidates without list/show", async () => {
    const tool = await loadFlowTool();
    expect((tool as any).description).toContain("recommendedBrowserFlow");
    expect((tool as any).description).not.toContain('Before replaying, action:"list"');
    expect((tool as any).promptGuidelines.join(" ")).toContain("do not call list or show");
  });
});

describe("browser replay promotion", () => {
  it("promotes an episode after its second successful direct replay with a sanitized path trigger", async () => {
    const { tool, hooks, mod } = await loadExtensionWithHooks();
    const cwd = newProject();
    await fireSessionStart(hooks, cwd);
    await runLoginTrace(hooks, cwd);
    await fireSettle(hooks, cwd);
    expect(mod.listSessionEpisodes(cwd)[0].stats).toMatchObject({ successes: 1, failures: 0, consecutiveFailures: 0 });

    const bridge = stubBridge();
    const result = await tool.execute("t", { action: "run", name: "example-com-login-click-sign-in" }, undefined, undefined, { cwd });
    expect(result.isError).toBeUndefined();
    expect(bridge.calls.map((call) => call.event.action)).toEqual(["navigate", "click"]);
    expect(mod.listSessionEpisodes(cwd)[0]).toMatchObject({
      promotedSlug: "example-com-login-click-sign-in",
      stats: { successes: 2, failures: 0, consecutiveFailures: 0 },
    });

    const promoted = JSON.parse(readFileSync(join(cwd, ".pi", "agent", "browser-flows", "example-com-login-click-sign-in.json"), "utf-8"));
    expect(promoted.trigger).toEqual({ domains: ["example.com"], urlContains: "/login" });
    expect(promoted.stats).toMatchObject({ successes: 2, failures: 0, consecutiveFailures: 0 });
    for (const forbidden of ["hunter2", "snapshot", "token", "element_index", "?", "#"]) expect(JSON.stringify(promoted)).not.toContain(forbidden);
  });

  it("strips navigate query and fragment secrets before automatic promotion or replay output", async () => {
    const { tool, hooks } = await loadExtensionWithHooks();
    const cwd = newProject();
    const rawUrl = "https://example.com/login?token=hunter2#otp";
    await fireSessionStart(hooks, cwd);
    await fireBrowserResult(hooks, cwd, { action: "navigate", url: rawUrl }, { details: { ok: true, url: rawUrl } });
    await fireBrowserResult(hooks, cwd, { action: "click", locator: { role: "button", name: "Sign in" } }, { details: { ok: true } });
    await fireSettle(hooks, cwd);

    const bridge = stubBridge();
    const result = await tool.execute("t", { action: "run", name: "example-com-login-click-sign-in" }, undefined, undefined, { cwd });
    const stored = readFileSync(join(cwd, ".pi", "agent", "browser-flows", "example-com-login-click-sign-in.json"), "utf-8");
    expect(bridge.calls[0].event.url).toBe("https://example.com/login");
    for (const forbidden of ["hunter2", "?token", "#otp", "?", "#"]) {
      expect(stored).not.toContain(forbidden);
      expect(JSON.stringify(result)).not.toContain(forbidden);
    }
  });

  it("promotes a repeated human trace, but never promotes an episode without a navigate step", async () => {
    const { hooks, mod } = await loadExtensionWithHooks();
    const cwd = newProject();
    await fireSessionStart(hooks, cwd);
    await runLoginTrace(hooks, cwd);
    await fireSettle(hooks, cwd);
    await runLoginTrace(hooks, cwd);
    await fireSettle(hooks, cwd);
    expect(mod.listSessionEpisodes(cwd)[0]).toMatchObject({ stats: { successes: 2 }, promotedSlug: "example-com-login-click-sign-in" });
    expect(existsSync(join(cwd, ".pi", "agent", "browser-flows", "example-com-login-click-sign-in.json"))).toBe(true);

    const noNavigate = newProject();
    await fireSessionStart(hooks, noNavigate);
    for (let attempt = 0; attempt < 2; attempt++) {
      await fireBrowserResult(hooks, noNavigate, { action: "click", locator: { role: "button", name: "Sign in" } }, { details: { ok: true } });
      await fireBrowserResult(hooks, noNavigate, { action: "wait" }, { details: { ok: true } });
      await fireSettle(hooks, noNavigate);
    }
    expect(mod.listSessionEpisodes(noNavigate)[0].stats).toMatchObject({ successes: 2 });
    expect(existsSync(join(noNavigate, ".pi", "agent", "browser-flows"))).toBe(false);
  });

  it("never overwrites an existing user flow when promotion needs the episode slug", async () => {
    const { tool, hooks } = await loadExtensionWithHooks();
    const cwd = newProject();
    await tool.execute("t", { action: "save", name: "example com login click sign in", description: "user-authored", steps: [{ action: "navigate", url: "https://user.example/keep" }, { action: "wait" }] }, undefined, undefined, { cwd });
    await fireSessionStart(hooks, cwd);
    await runLoginTrace(hooks, cwd);
    await fireSettle(hooks, cwd);
    await runLoginTrace(hooks, cwd);
    await fireSettle(hooks, cwd);

    const original = JSON.parse(readFileSync(join(cwd, ".pi", "agent", "browser-flows", "example-com-login-click-sign-in.json"), "utf-8"));
    expect(original).toMatchObject({ name: "example com login click sign in", description: "user-authored", steps: [{ action: "navigate", url: "https://user.example/keep" }, { action: "wait" }] });
    expect(existsSync(join(cwd, ".pi", "agent", "browser-flows", "example-com-login-click-sign-in_2.json"))).toBe(true);
  });

  it("persists saved and episode success/failure stats, resetting the consecutive failure count on success", async () => {
    const { tool, hooks, mod } = await loadExtensionWithHooks();
    const cwd = newProject();
    await tool.execute("t", { action: "save", name: "Saved Stats", steps: [{ action: "navigate", url: "https://example.com/stats" }, { action: "wait" }] }, undefined, undefined, { cwd });
    stubBridge((event) => event.action === "wait" ? { ok: false, error: "wait failed" } : { ok: true, url: event.url });
    expect((await tool.execute("t", { action: "run", name: "saved-stats" }, undefined, undefined, { cwd })).isError).toBe(true);
    expect(JSON.parse(readFileSync(join(cwd, ".pi", "agent", "browser-flows", "saved-stats.json"), "utf-8")).stats).toMatchObject({ successes: 0, failures: 1, consecutiveFailures: 1, lastRunAt: expect.any(String), lastFailureAt: expect.any(String) });
    stubBridge();
    expect((await tool.execute("t", { action: "run", name: "saved-stats" }, undefined, undefined, { cwd })).isError).toBeUndefined();
    expect(JSON.parse(readFileSync(join(cwd, ".pi", "agent", "browser-flows", "saved-stats.json"), "utf-8")).stats).toMatchObject({ successes: 1, failures: 1, consecutiveFailures: 0 });

    await fireSessionStart(hooks, cwd);
    await runLoginTrace(hooks, cwd);
    await fireSettle(hooks, cwd);
    stubBridge((event) => event.action === "click" ? { ok: false, error: "click failed" } : { ok: true, url: event.url });
    await tool.execute("t", { action: "run", name: "example-com-login-click-sign-in" }, undefined, undefined, { cwd });
    expect(mod.listSessionEpisodes(cwd)[0].stats).toMatchObject({ successes: 1, failures: 1, consecutiveFailures: 1 });
    stubBridge();
    await tool.execute("t", { action: "run", name: "example-com-login-click-sign-in" }, undefined, undefined, { cwd });
    expect(mod.listSessionEpisodes(cwd)[0].stats).toMatchObject({ successes: 2, failures: 1, consecutiveFailures: 0 });
  });

  it("serializes same-project stats updates and keeps a concurrent save's latest flow definition", async () => {
    const tool = await loadFlowTool();
    const cwd = newProject();
    await tool.execute("t", { action: "save", name: "Concurrent Stats", steps: [{ action: "navigate", url: "https://old.example/flow" }] }, undefined, undefined, { cwd });

    const pending: Array<() => void> = [];
    let reachedBoth!: () => void;
    const bothReached = new Promise<void>((resolve) => { reachedBoth = resolve; });
    stubBridge((event) => new Promise((resolve) => {
      pending.push(() => resolve({ ok: true, url: event.url }));
      if (pending.length === 2) reachedBoth();
    }));
    const first = tool.execute("t", { action: "run", name: "concurrent-stats" }, undefined, undefined, { cwd });
    const second = tool.execute("t", { action: "run", name: "concurrent-stats" }, undefined, undefined, { cwd });
    await bothReached;
    pending.splice(0).forEach((release) => release());
    await Promise.all([first, second]);
    expect(JSON.parse(readFileSync(join(cwd, ".pi", "agent", "browser-flows", "concurrent-stats.json"), "utf-8")).stats).toMatchObject({ successes: 2, failures: 0, consecutiveFailures: 0 });

    await tool.execute("t", { action: "save", name: "Save Race", trigger: { domains: ["old.example"] }, steps: [{ action: "navigate", url: "https://old.example/flow" }] }, undefined, undefined, { cwd });
    let releaseRun!: () => void;
    let runReached!: () => void;
    const runWaiting = new Promise<void>((resolve) => { runReached = resolve; });
    stubBridge((event) => new Promise((resolve) => {
      releaseRun = () => resolve({ ok: true, url: event.url });
      runReached();
    }));
    const running = tool.execute("t", { action: "run", name: "save-race" }, undefined, undefined, { cwd });
    await runWaiting;
    await tool.execute("t", { action: "save", name: "Save Race", trigger: { domains: ["new.example"] }, steps: [{ action: "navigate", url: "https://new.example/replaced" }, { action: "wait" }] }, undefined, undefined, { cwd });
    releaseRun();
    await running;
    const raced = JSON.parse(readFileSync(join(cwd, ".pi", "agent", "browser-flows", "save-race.json"), "utf-8"));
    expect(raced).toMatchObject({ trigger: { domains: ["new.example"] }, steps: [{ action: "navigate", url: "https://new.example/replaced" }, { action: "wait" }], stats: { successes: 1, failures: 0, consecutiveFailures: 0 } });
  });

  it("suppresses an episode from automatic candidates after two consecutive replay failures", async () => {
    const { tool, hooks } = await loadExtensionWithHooks();
    const cwd = newProject();
    await fireSessionStart(hooks, cwd);
    await runLoginTrace(hooks, cwd);
    await fireSettle(hooks, cwd);
    stubBridge((event) => event.action === "click" ? { ok: false, error: "click failed" } : { ok: true, url: event.url });
    await tool.execute("t", { action: "run", name: "example-com-login-click-sign-in" }, undefined, undefined, { cwd });
    await tool.execute("t", { action: "run", name: "example-com-login-click-sign-in" }, undefined, undefined, { cwd });
    const patch = await hooks.tool_result(browserResultEvent({ action: "navigate", url: "https://example.com/login" }, { details: { ok: true, url: "https://example.com/login" } }), ctxIn(cwd));
    expect(patch).toBeUndefined();
  });

  it("guards triggered non-navigate flows before their side effects, while navigate-first flows do not observe", async () => {
    const { tool } = await loadExtensionWithHooks();
    const cwd = newProject();
    await tool.execute("t", { action: "save", name: "Guarded", trigger: { domains: ["example.com"] }, steps: [{ action: "click", locator: { role: "button", name: "Continue" } }, { action: "wait" }] }, undefined, undefined, { cwd });
    const mismatch = stubBridge(() => ({ ok: true, url: "https://other.example/path" }));
    const guarded = await tool.execute("t", { action: "run", name: "guarded" }, undefined, undefined, { cwd });
    expect(guarded).toMatchObject({ isError: true, details: { source: "flow", guard: { reason: "triggerMismatch" } } });
    expect(mismatch.calls.map((call) => call.event.action)).toEqual(["observe"]);

    await tool.execute("t", { action: "save", name: "Guarded Both", trigger: { domains: ["example.com"], urlContains: "/login" }, steps: [{ action: "click", locator: { role: "button", name: "Continue" } }, { action: "wait" }] }, undefined, undefined, { cwd });
    const wrongDomainSamePath = stubBridge(() => ({ ok: true, url: "https://evil.example/login" }));
    const bothGuarded = await tool.execute("t", { action: "run", name: "guarded-both" }, undefined, undefined, { cwd });
    expect(bothGuarded).toMatchObject({ isError: true, details: { guard: { reason: "triggerMismatch" } } });
    expect(wrongDomainSamePath.calls.map((call) => call.event.action)).toEqual(["observe"]);

    await tool.execute("t", { action: "save", name: "Navigate First", trigger: { domains: ["example.com"] }, steps: [{ action: "navigate", url: "https://example.com/start" }, { action: "wait" }] }, undefined, undefined, { cwd });
    const replay = stubBridge();
    const result = await tool.execute("t", { action: "run", name: "navigate-first" }, undefined, undefined, { cwd });
    expect(result.isError).toBeUndefined();
    expect(replay.calls.map((call) => call.event.action)).toEqual(["navigate", "wait"]);
  });

  it("deduplicates a promoted saved flow behind its same-session episode candidate", async () => {
    const { hooks } = await loadExtensionWithHooks();
    const cwd = newProject();
    await fireSessionStart(hooks, cwd);
    await runLoginTrace(hooks, cwd);
    await fireSettle(hooks, cwd);
    await runLoginTrace(hooks, cwd);
    await fireSettle(hooks, cwd);
    const patch = await hooks.tool_result(browserResultEvent({ action: "navigate", url: "https://example.com/login" }, { details: { ok: true, url: "https://example.com/login" } }), ctxIn(cwd));
    expect(patch.details.browserFlowCandidates).toHaveLength(1);
    expect(patch.details.browserFlowCandidates[0]).toMatchObject({ id: "example-com-login-click-sign-in", source: "episode" });
  });
});

describe("browser auto-capture: session episodes", () => {
  it("seals a settled trace of ≥2 successful replayable single actions into one episode with a semantic slug", async () => {
    const { hooks, mod } = await loadExtensionWithHooks();
    const cwd = newProject();
    await fireSessionStart(hooks, cwd);
    await runLoginTrace(hooks, cwd);
    await fireSettle(hooks, cwd);
    const episodes = mod.listSessionEpisodes(cwd);
    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toEqual({
      schemaVersion: 1,
      id: "example-com-login-click-sign-in",
      title: "example.com/login — click Sign in",
      url: "https://example.com/login",
      steps: [
        { action: "navigate", url: "https://example.com/login" },
        { action: "click", locator: { role: "button", name: "Sign in" } },
      ],
      sealedAt: expect.any(String),
      stats: {
        successes: 1,
        failures: 0,
        consecutiveFailures: 0,
        lastRunAt: expect.any(String),
      },
    });
    expect(Number.isNaN(Date.parse(episodes[0].sealedAt))).toBe(false);
  });

  it("captures an actions[] batch as multiple steps in order and stores no literals, snapshots, tokens or indexes", async () => {
    const { hooks, mod } = await loadExtensionWithHooks();
    const cwd = newProject();
    await fireSessionStart(hooks, cwd);
    await fireBrowserResult(
      hooks,
      cwd,
      {
        actions: [
          { action: "navigate", url: "https://example.com/signup" },
          { action: "fill_form", fields: [
            { locator: { label: "Full name" }, value: "Ada Lovelace" },
            { locator: { css: "input#email" }, value: "ada@example.com" },
          ] },
          { action: "input", locator: { label: "Password" }, text: "hunter2-super-secret" },
          { action: "select", locator: { css: "select#country" }, option: "Japan" },
          { action: "click", locator: { role: "button", name: "Create account" } },
          { action: "wait" },
        ],
      },
      {
        details: {
          batch: true,
          ok: true,
          failedIndex: null,
          skipped: [],
          results: [
            { index: 0, action: "navigate", status: "ok" },
            { index: 1, action: "fill_form", status: "ok", details: { filled: 2, failed: 0, results: [{ index: 0, ok: true }, { index: 1, ok: true }] } },
            { index: 2, action: "input", status: "ok" },
            { index: 3, action: "select", status: "ok" },
            { index: 4, action: "click", status: "ok" },
            { index: 5, action: "wait", status: "ok" },
          ],
        },
      },
    );
    await fireSettle(hooks, cwd);
    const episodes = mod.listSessionEpisodes(cwd);
    expect(episodes).toHaveLength(1);
    expect(episodes[0].id).toBe("example-com-signup-wait");
    expect(episodes[0].steps).toEqual([
      { action: "navigate", url: "https://example.com/signup" },
      { action: "fill_form", fields: [
        { locator: { label: "Full name" }, valueParam: "full_name", valueShape: "text" },
        { locator: { css: "input#email" }, valueParam: "email", valueShape: "text" },
      ] },
      { action: "input", locator: { label: "Password" }, valueParam: "password", valueShape: "text" },
      { action: "select", locator: { css: "select#country" }, valueParam: "country", valueShape: "option" },
      { action: "click", locator: { role: "button", name: "Create account" } },
      { action: "wait" },
    ]);
    const flat = JSON.stringify(episodes);
    for (const leaked of ["Ada Lovelace", "ada@example.com", "hunter2-super-secret", "Japan", "snapshot_id", "element_index", "element_token"]) {
      expect(flat).not.toContain(leaked);
    }
  });

  it("ignores read-only actions entirely: successful ones append nothing, failed ones break nothing", async () => {
    const { hooks, mod } = await loadExtensionWithHooks();
    const cwd = newProject();
    await fireSessionStart(hooks, cwd);
    await fireBrowserResult(hooks, cwd, { action: "navigate", url: "https://example.com/login" }, NAV_LOGIN);
    // A rich successful observe between steps: not captured, trace untouched.
    await fireBrowserResult(hooks, cwd, { action: "observe" }, { details: { ok: true, snapshotID: "snap-LEAK", url: "https://example.com/login", elements: [{ token: "tok-LEAK", index: 0 }] } });
    for (const action of ["screenshot", "content", "console", "watches", "help"]) {
      await fireBrowserResult(hooks, cwd, { action }, { details: { ok: true } });
    }
    await fireBrowserResult(hooks, cwd, { action: "click", locator: { role: "button", name: "Sign in" } }, { details: { ok: true } });
    // An all-read-only batch is ignored whole: nothing appended, trace untouched.
    await fireBrowserResult(
      hooks,
      cwd,
      { actions: [{ action: "observe" }, { action: "screenshot" }] },
      { details: { batch: true, ok: true, failedIndex: null, skipped: [], results: [{ index: 0, action: "observe", status: "ok" }, { index: 1, action: "screenshot", status: "ok" }] } },
    );
    // A FAILED observe after the click: an observation failure is not a flow failure.
    await fireBrowserResult(hooks, cwd, { action: "observe" }, { isError: true, details: { error: "observation failed" } });
    await fireSettle(hooks, cwd);
    const episodes = mod.listSessionEpisodes(cwd);
    expect(episodes).toHaveLength(1);
    expect(episodes[0].steps.map((s: any) => s.action)).toEqual(["navigate", "click"]);
    expect(JSON.stringify(episodes)).not.toContain("LEAK");
  });

  it("invalidates the trace on a successful eval/script/type and never seals it at settle", async () => {
    for (const sideEffect of ["eval", "script", "type"]) {
      const { hooks, mod } = await loadExtensionWithHooks();
      const cwd = newProject();
      await fireSessionStart(hooks, cwd);
      await runLoginTrace(hooks, cwd, { sideEffect });
      await fireBrowserResult(hooks, cwd, { action: "input", locator: { label: "Password" }, text: "hunter2-super-secret" }, { details: { ok: true } });
      await fireSettle(hooks, cwd);
      expect(mod.listSessionEpisodes(cwd), sideEffect).toEqual([]);
    }
  });

  it("invalidates on isError and on details.ok === false for state-changing actions", async () => {
    for (const opts of [
      { isError: true, details: { ok: false, error: "locator matched 0 elements" } },
      { isError: false, details: { ok: false, error: "reported not-ok without isError" } },
    ]) {
      const { hooks, mod } = await loadExtensionWithHooks();
      const cwd = newProject();
      await fireSessionStart(hooks, cwd);
      await fireBrowserResult(hooks, cwd, { action: "navigate", url: "https://example.com/login" }, NAV_LOGIN);
      await fireBrowserResult(hooks, cwd, { action: "click", locator: { css: "#gone" } }, opts);
      await fireSettle(hooks, cwd);
      expect(mod.listSessionEpisodes(cwd), JSON.stringify(opts)).toEqual([]);
    }
  });

  it("invalidates on a single fill_form whose host reply stayed ok:true but reported failed > 0", async () => {
    const { hooks, mod } = await loadExtensionWithHooks();
    const cwd = newProject();
    await fireSessionStart(hooks, cwd);
    await fireBrowserResult(hooks, cwd, { action: "navigate", url: "https://example.com/signup" }, { details: { ok: true, url: "https://example.com/signup" } });
    await fireBrowserResult(
      hooks,
      cwd,
      { action: "fill_form", fields: [{ locator: { label: "Full name" }, value: "Ada Lovelace" }] },
      { details: { ok: true, filled: 0, failed: 1, results: [{ index: 0, ok: false, error: "browser_locator_not_found", message: "locator matched 0 elements" }] } },
    );
    await fireSettle(hooks, cwd);
    expect(mod.listSessionEpisodes(cwd)).toEqual([]);
  });

  it("invalidates when any batch entry is failed/skipped or its fill_form entry reports failed > 0", async () => {
    for (const [label, results] of [
      ["failed entry stops the batch", [
        { index: 0, action: "navigate", status: "ok" },
        { index: 1, action: "click", status: "failed" },
        { index: 2, action: "wait", status: "skipped", reason: "previous item failed" },
      ]],
      ["ok-status fill_form entry with failed > 0", [
        { index: 0, action: "navigate", status: "ok" },
        { index: 1, action: "fill_form", status: "ok", details: { filled: 1, failed: 1, results: [{ index: 0, ok: true }, { index: 1, ok: false }] } },
      ]],
    ] as const) {
      const { hooks, mod } = await loadExtensionWithHooks();
      const cwd = newProject();
      await fireSessionStart(hooks, cwd);
      await fireBrowserResult(
        hooks,
        cwd,
        { actions: [
          { action: "navigate", url: "https://example.com/login" },
          { action: "click", locator: { role: "button", name: "Sign in" } },
          { action: "wait" },
        ] },
        { isError: true, details: { batch: true, ok: false, failedIndex: 1, skipped: [2], results } },
      );
      await fireSettle(hooks, cwd);
      expect(mod.listSessionEpisodes(cwd), label).toEqual([]);
    }
  });

  it("a successful mixed batch captures its replayable steps and ignores its read-only ones", async () => {
    const { hooks, mod } = await loadExtensionWithHooks();
    const cwd = newProject();
    await fireSessionStart(hooks, cwd);
    await fireBrowserResult(hooks, cwd, { action: "navigate", url: "https://example.com/login" }, NAV_LOGIN);
    await fireBrowserResult(
      hooks,
      cwd,
      { actions: [
        { action: "click", locator: { role: "button", name: "Sign in" } },
        { action: "wait" },
        { action: "observe" },
        { action: "screenshot" },
      ] },
      { details: { batch: true, ok: true, failedIndex: null, skipped: [], results: [
        { index: 0, action: "click", status: "ok" },
        { index: 1, action: "wait", status: "ok" },
        { index: 2, action: "observe", status: "ok", details: { snapshotID: "snap-LEAK", elements: [{ token: "tok-LEAK", index: 0 }] } },
        { index: 3, action: "screenshot", status: "ok" },
      ] } },
    );
    await fireSettle(hooks, cwd);
    const episodes = mod.listSessionEpisodes(cwd);
    expect(episodes).toHaveLength(1);
    expect(episodes[0].steps.map((s: any) => s.action)).toEqual(["navigate", "click", "wait"]);
    expect(JSON.stringify(episodes)).not.toContain("LEAK");
  });

  it("never seals below two replayable steps and tolerates settles with no browser activity", async () => {
    const { hooks, mod } = await loadExtensionWithHooks();
    const cwd = newProject();
    await fireSessionStart(hooks, cwd);
    await fireBrowserResult(hooks, cwd, { action: "navigate", url: "https://example.com/login" }, NAV_LOGIN);
    await fireSettle(hooks, cwd);
    await fireSettle(hooks, cwd); // no browser activity in this run at all
    expect(mod.listSessionEpisodes(cwd)).toEqual([]);
  });

  it("invalidation does not outlive the settle: the next clean run seals normally", async () => {
    const { hooks, mod } = await loadExtensionWithHooks();
    const cwd = newProject();
    await fireSessionStart(hooks, cwd);
    await runLoginTrace(hooks, cwd, { sideEffect: "eval" });
    await fireSettle(hooks, cwd);
    expect(mod.listSessionEpisodes(cwd)).toEqual([]);
    await runLoginTrace(hooks, cwd);
    await fireSettle(hooks, cwd);
    expect(mod.listSessionEpisodes(cwd).map((e: any) => e.id)).toEqual(["example-com-login-click-sign-in"]);
  });

  it("clears the trace after sealing: a second settle is a no-op and the next run starts fresh", async () => {
    const { hooks, mod } = await loadExtensionWithHooks();
    const cwd = newProject();
    await fireSessionStart(hooks, cwd);
    await runLoginTrace(hooks, cwd);
    await fireSettle(hooks, cwd);
    await fireSettle(hooks, cwd); // trace already sealed: nothing to re-seal
    await fireBrowserResult(hooks, cwd, { action: "click", locator: { role: "button", name: "Next" } }, { details: { ok: true } });
    await fireSettle(hooks, cwd); // 1 step in the new run: below the seal threshold
    const episodes = mod.listSessionEpisodes(cwd);
    expect(episodes).toHaveLength(1);
    expect(episodes[0].id).toBe("example-com-login-click-sign-in");
    expect(episodes[0].steps).toHaveLength(2);
  });

  it("updates the existing episode when the same normalized steps recur, moving it to most-recent", async () => {
    const { hooks, mod } = await loadExtensionWithHooks();
    const cwd = newProject();
    await fireSessionStart(hooks, cwd);
    await runLoginTrace(hooks, cwd);
    await fireSettle(hooks, cwd);
    const firstSealedAt = mod.listSessionEpisodes(cwd)[0].sealedAt;
    // A different trace in between: the store now holds [login-click, login-click-wait].
    await fireBrowserResult(hooks, cwd, { action: "navigate", url: "https://example.com/login" }, NAV_LOGIN);
    await fireBrowserResult(hooks, cwd, { action: "click", locator: { role: "button", name: "Sign in" } }, { details: { ok: true } });
    await fireBrowserResult(hooks, cwd, { action: "wait" }, { details: { ok: true } });
    await fireSettle(hooks, cwd);
    // The first trace again, byte-identical after normalization: update, don't stack.
    await runLoginTrace(hooks, cwd);
    await fireSettle(hooks, cwd);
    const episodes = mod.listSessionEpisodes(cwd);
    expect(episodes).toHaveLength(2);
    expect(episodes.map((e: any) => e.id)).toEqual(["example-com-login-wait", "example-com-login-click-sign-in"]);
    expect(Date.parse(episodes[1].sealedAt)).toBeGreaterThanOrEqual(Date.parse(firstSealedAt));
    expect(episodes[1].steps).toHaveLength(2);
  });

  it("disambiguates a recurring name base with a readable _N ordinal instead of colliding", async () => {
    const { hooks, mod } = await loadExtensionWithHooks();
    const cwd = newProject();
    await fireSessionStart(hooks, cwd);
    await runLoginTrace(hooks, cwd);
    await fireSettle(hooks, cwd);
    // Same first navigate, same last locator, different middle: same base, new episode.
    await fireBrowserResult(hooks, cwd, { action: "navigate", url: "https://example.com/login" }, NAV_LOGIN);
    await fireBrowserResult(hooks, cwd, { action: "input", locator: { label: "Password" }, text: "hunter2-super-secret" }, { details: { ok: true } });
    await fireBrowserResult(hooks, cwd, { action: "click", locator: { role: "button", name: "Sign in" } }, { details: { ok: true } });
    await fireSettle(hooks, cwd);
    expect(mod.listSessionEpisodes(cwd).map((e: any) => e.id)).toEqual([
      "example-com-login-click-sign-in",
      "example-com-login-click-sign-in_2",
    ]);
  });

  it("renames valueParams that collide across one episode's calls into readable _N ordinals (input/select/fill_form)", async () => {
    const { hooks, mod } = await loadExtensionWithHooks();
    const cwd = newProject();
    await fireSessionStart(hooks, cwd);
    // Per-call normalization is untouched: alone, the later call still derives "username".
    expect(
      mod.normalizeBrowserCall({ action: "fill_form", fields: [{ locator: { label: "Username" }, value: "x" }] }).steps[0].fields[0].valueParam,
    ).toBe("username");
    await fireBrowserResult(hooks, cwd, { action: "navigate", url: "https://example.com/profile" }, { details: { ok: true, url: "https://example.com/profile" } });
    await fireBrowserResult(hooks, cwd, { action: "input", locator: { label: "Username" }, text: "alice-LEAK" }, { details: { ok: true } });
    await fireBrowserResult(
      hooks,
      cwd,
      { action: "fill_form", fields: [
        { locator: { label: "Username" }, value: "alice-LEAK" },
        { locator: { label: "Password" }, value: "hunter2-LEAK" },
      ] },
      { details: { ok: true, filled: 2, failed: 0 } },
    );
    await fireBrowserResult(hooks, cwd, { action: "select", locator: { label: "Username" }, option: "Japan-LEAK" }, { details: { ok: true } });
    await fireSettle(hooks, cwd);
    const episodes = mod.listSessionEpisodes(cwd);
    expect(episodes).toHaveLength(1);
    const [, input, form, select] = episodes[0].steps;
    expect(input.valueParam).toBe("username");
    expect(form.fields.map((f: any) => f.valueParam)).toEqual(["username_2", "password"]);
    expect(select.valueParam).toBe("username_3");
    // Every param stays independently addressable: no cross-call duplicate survives.
    const params = mod.requiredParams(episodes[0].steps);
    expect(new Set(params).size).toBe(params.length);
    // Only param NAMES travel — the literal values of all three calls are gone.
    const flat = JSON.stringify(episodes);
    for (const leaked of ["alice-LEAK", "hunter2-LEAK", "Japan-LEAK"]) expect(flat).not.toContain(leaked);
  });

  it("derives the id/title only from the first navigate host/path and the last readable action/locator", async () => {
    const { hooks, mod } = await loadExtensionWithHooks();
    const cwd = newProject();
    await fireSessionStart(hooks, cwd);
    // Query strings and later navigates are not name material: the FIRST navigate anchors host/path.
    await fireBrowserResult(hooks, cwd, { action: "navigate", url: "https://example.com/login?next=/secret-redirect" }, { details: { ok: true } });
    await fireBrowserResult(hooks, cwd, { action: "navigate", url: "https://example.com/other" }, { details: { ok: true } });
    await fireBrowserResult(hooks, cwd, { action: "click", locator: { css: "#submit-btn" } }, { details: { ok: true } });
    await fireSettle(hooks, cwd);
    const withNav = mod.listSessionEpisodes(cwd)[0];
    expect(withNav.id).toBe("example-com-login-click-submit-btn");
    expect(withNav.title).toBe("example.com/login — click #submit-btn");
    expect(withNav.id).not.toContain("secret");
    expect(withNav.id).not.toContain("other");
    expect(withNav.url).toBe("https://example.com/other"); // most recent navigate, not the first

    // A trace with no navigate at all is named from its LAST readable action/locator alone.
    await fireBrowserResult(hooks, cwd, { action: "click", locator: { role: "button", name: "Sign in" } }, { details: { ok: true } });
    await fireBrowserResult(hooks, cwd, { action: "input", locator: { label: "Password" }, text: "hunter2-super-secret" }, { details: { ok: true } });
    await fireSettle(hooks, cwd);
    const noNav = mod.listSessionEpisodes(cwd)[1];
    expect(noNav.id).toBe("input-password");
    expect(noNav.title).toBe("input Password");
    expect(noNav.url).toBeUndefined();
  });

  it("ignores tool_result events from other tools even when they carry browser-shaped input", async () => {
    const { hooks, mod } = await loadExtensionWithHooks();
    const cwd = newProject();
    await fireSessionStart(hooks, cwd);
    for (const toolName of ["read", "bash"]) {
      await hooks.tool_result({ type: "tool_result", toolName, toolCallId: "x", input: { action: "click", locator: { css: "#x" } }, content: [], isError: false, details: { ok: true } }, ctxIn(cwd));
    }
    await fireSettle(hooks, cwd);
    expect(mod.listSessionEpisodes(cwd)).toEqual([]);
  });

  it("isolates episodes by cwd within the same session", async () => {
    const { hooks, mod } = await loadExtensionWithHooks();
    const cwdA = newProject();
    const cwdB = newProject();
    await fireSessionStart(hooks, cwdA);
    await runLoginTrace(hooks, cwdA);
    await fireSettle(hooks, cwdA);
    await fireBrowserResult(hooks, cwdB, { action: "navigate", url: "https://other.com/dash" }, { details: { ok: true, url: "https://other.com/dash" } });
    await fireBrowserResult(hooks, cwdB, { action: "wait" }, { details: { ok: true } });
    await fireSettle(hooks, cwdB);
    expect(mod.listSessionEpisodes(cwdA).map((e: any) => e.id)).toEqual(["example-com-login-click-sign-in"]);
    expect(mod.listSessionEpisodes(cwdB).map((e: any) => e.id)).toEqual(["other-com-dash-wait"]);
  });

  it("keeps at most the 12 most recent episodes per cwd", async () => {
    const { hooks, mod } = await loadExtensionWithHooks();
    const cwd = newProject();
    await fireSessionStart(hooks, cwd);
    for (let page = 1; page <= 13; page++) {
      await fireBrowserResult(hooks, cwd, { action: "navigate", url: `https://example.com/page-${page}` }, { details: { ok: true } });
      await fireBrowserResult(hooks, cwd, { action: "click", locator: { role: "button", name: `P${page}` } }, { details: { ok: true } });
      await fireSettle(hooks, cwd);
    }
    const episodes = mod.listSessionEpisodes(cwd);
    expect(episodes).toHaveLength(12);
    expect(episodes[0].id).toBe("example-com-page-2-click-p2");
    expect(episodes[11].id).toBe("example-com-page-13-click-p13");
  });

  it("returns defensive copies: mutating the listed episodes cannot pollute the store", async () => {
    const { hooks, mod } = await loadExtensionWithHooks();
    const cwd = newProject();
    await fireSessionStart(hooks, cwd);
    await runLoginTrace(hooks, cwd);
    await fireSettle(hooks, cwd);
    const original = mod.listSessionEpisodes(cwd);
    const listed = mod.listSessionEpisodes(cwd);
    listed[0].title = "hacked";
    listed[0].id = "hacked";
    listed[0].url = "https://evil.example.com";
    listed[0].steps.push({ action: "eval" });
    listed[0].steps[0].url = "https://evil.example.com";
    (listed[0].steps[1] as any).locator.name = "hacked";
    const again = mod.listSessionEpisodes(cwd);
    expect(again).toEqual(original);
    expect(again[0].id).toBe("example-com-login-click-sign-in");
    expect(again[0].steps[1].locator).toEqual({ role: "button", name: "Sign in" });
  });

  it("session_start clears old session state: sealed episodes and any pending trace", async () => {
    const { hooks, mod } = await loadExtensionWithHooks();
    const cwd = newProject();
    await fireSessionStart(hooks, cwd);
    await runLoginTrace(hooks, cwd);
    await fireSettle(hooks, cwd);
    expect(mod.listSessionEpisodes(cwd)).toHaveLength(1);
    await fireBrowserResult(hooks, cwd, { action: "navigate", url: "https://example.com/login" }, NAV_LOGIN); // pending trace
    await fireSessionStart(hooks, cwd);
    expect(mod.listSessionEpisodes(cwd)).toEqual([]);
    await fireSettle(hooks, cwd); // the pending trace was dropped with the old session
    expect(mod.listSessionEpisodes(cwd)).toEqual([]);
    await runLoginTrace(hooks, cwd);
    await fireSettle(hooks, cwd);
    expect(mod.listSessionEpisodes(cwd).map((e: any) => e.id)).toEqual(["example-com-login-click-sign-in"]);
  });
});
