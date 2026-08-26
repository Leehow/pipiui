// Offline tests for the browser_flow memory extension (v1 semantic flows). No network:
// the bridge fetch is stubbed, and the store lives in per-test temp project roots — the
// same project-isolation layout (`.pi/agent/browser-flows`) the extension uses in prod.
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EXTENSION = "../../../resources/runtime/extensions/pipiui-browser-memory.ts";

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

async function loadFlowTool(): Promise<Tool> {
  vi.resetModules();
  let tool: Tool | undefined;
  const pi = {
    registerTool: vi.fn((definition: Tool) => {
      if (definition.name === "browser_flow") tool = definition;
    }),
  };
  const extension = (await import(EXTENSION)).default;
  extension(pi as never);
  if (!tool) throw new Error("browser_flow was not registered");
  return tool;
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
