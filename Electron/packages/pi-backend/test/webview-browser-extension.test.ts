import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { HostBridge } from "../src/bridge.js";
import { HostCapabilityBroker } from "../src/host-capability.js";
import { createExtensionLoader } from "../src/extension-loader.js";
import { createExtensionRegistry } from "../src/extension-registry.js";
import { assemblePiSpawn } from "../src/spawn-assembly.js";
import {
  configureWebviewBrowserHost,
  WEBVIEW_BROWSER_EXTENSION_ID,
  WEBVIEW_BROWSER_HOST_API,
} from "../../../resources/runtime/extensions/webview-browser-extension/agent/capability-bridge.ts";

/**
 * webview-browser-extension migration contract.
 *
 * The extension package `resources/runtime/extensions/webview-browser-extension`
 * owns the three frozen WebView browser tools (`browser` / `browser_search` /
 * `browser_fetch`); every WebContentsView/session call travels through the
 * versioned Host Capability API (a `HostCapabilityRequestV1` envelope over the
 * loopback `host_capability` bridge action). These tests pin, in order: the
 * manifest, the schema snapshot, the watch protocol, the redaction-adjacent
 * rules, the renderer-facing result shapes old sessions depend on, and — the
 * strongest form of the "unchanged" claims — behavioral equivalence of every
 * tool action when served through the pre-migration single-file mounts versus
 * through the extension + capability broker.
 */

const extensionDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../resources/runtime/extensions/webview-browser-extension",
);
const legacyWebviewPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../resources/runtime/extensions/pipiui-electron-webview.ts",
);
const legacySearchPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../resources/runtime/extensions/pipiui-browser-search.ts",
);

const PROJECT_ROOT = "/proj/webview";
const SESSION_ID = "session-webview-1";

type CapturedTool = {
  name: string;
  label?: string;
  description?: string;
  parameters?: unknown;
  execute?: (callId: string, params: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
};

type ToolResult = { content: Array<{ type: string; text?: string }>; details?: unknown; isError?: boolean };

const resultText = (result: ToolResult) => result.content.map((chunk) => chunk.text ?? "").join("\n");

/** Minimal ExtensionAPI capture harness: records mounts, no-ops session side effects. */
function capturePi() {
  const tools: CapturedTool[] = [];
  const pi = {
    registerTool: (tool: CapturedTool) => { tools.push(tool); },
    registerCommand: () => {},
    registerShortcut: () => {},
    appendEntry: () => {},
    sendMessage: () => {},
    exec: async () => {
      throw new Error("pi.exec is not expected in webview-browser extension tests");
    },
    on: () => ({ unsubscribe() {} }),
  };
  return { pi, tools };
}

/* ---------------------------------------------------------------------------
 * Scripted browser host: one deterministic handler shared by both transports.
 * The legacy single-file extensions reach it over raw browser_action /
 * browser_watch RPCs; the extension reaches it through the capability broker.
 * ------------------------------------------------------------------------- */

type ScriptedHost = {
  state: { lastNavigateUrl: string; cancelRequests: string[]; subscribes: unknown[] };
  handleAction: (event: Record<string, any>) => Record<string, any>;
  handleWatch: (event: Record<string, any>) => Record<string, any>;
};

const OBSERVATION = {
  ok: true,
  url: "https://example.com/",
  title: "Example",
  snapshotID: "snap-1",
  loading: false,
  viewport: { width: 1280, height: 800 },
  scroll: { pixelsAbove: 0, pixelsBelow: 1200, positionPercent: 10 },
  regions: [
    {
      id: "r1",
      name: "main",
      role: "region",
      count: 3,
      more: 2,
      expanded: false,
      preview: [{ index: 0, role: "link", name: "More information" }],
    },
  ],
  elements: [
    { index: 0, role: "link", name: "More information", token: "t1" },
    { index: 1, role: "textbox", name: "Search", token: "t2" },
  ],
  truncated: false,
};

function makeScriptedHost(): ScriptedHost {
  const state = { lastNavigateUrl: "", cancelRequests: [] as string[], subscribes: [] as unknown[] };
  const handleAction = (event: Record<string, any>): Record<string, any> => {
    if (event.action === "browser_cancel") {
      state.cancelRequests.push(event.requestID);
      return { ok: true, cancelled: event.requestID };
    }
    if (event.action === "navigate" || event.action === "back" || event.action === "forward" || event.action === "reload") {
      if (event.action === "navigate" && !event.url) return { ok: false, error: "navigate requires url", code: "missing_url" };
      state.lastNavigateUrl = String(event.url ?? OBSERVATION.url);
      return { ...OBSERVATION, url: String(event.url ?? OBSERVATION.url) };
    }
    if (event.action === "observe" || event.action === "wait") return { ...OBSERVATION };
    if (event.action === "click") {
      if (!event.snapshot_id && !event.locator) return { ok: false, error: "click requires a target", code: "missing_element" };
      return {
        ok: true,
        url: OBSERVATION.url,
        title: OBSERVATION.title,
        snapshotID: "snap-2",
        action: { kind: "click", target: event.element_token ?? event.locator ?? event.element_index },
        mutation: { added: 1, removed: 0, attributes: 2 },
        elements: OBSERVATION.elements,
      };
    }
    if (event.action === "input") {
      return {
        ok: true,
        url: OBSERVATION.url,
        title: OBSERVATION.title,
        snapshotID: "snap-2",
        action: { kind: "input", target: event.element_token },
        mutation: { added: 0, removed: 0, attributes: 1 },
      };
    }
    if (event.action === "fill_form") {
      return {
        ok: true,
        url: OBSERVATION.url,
        title: OBSERVATION.title,
        snapshotID: "snap-2",
        filled: 1,
        failed: 1,
        results: [
          { index: 0, ok: true },
          { index: 1, ok: false, error: "user_handoff_required" },
        ],
        mutation: { added: 0, removed: 0, attributes: 3 },
        note: "Password, OTP, and payment fields require user handoff in the panel.",
      };
    }
    if (event.action === "scroll") {
      return { ok: true, url: OBSERVATION.url, snapshotID: "snap-2", action: { kind: "scroll", direction: event.direction } };
    }
    if (event.action === "content") {
      return { ok: true, content: "Example page body text", truncated: true };
    }
    if (event.action === "eval") {
      return { ok: true, result: { picked: "value" } };
    }
    if (event.action === "script") {
      return { ok: true, result: "done", steps: ["step-1"] };
    }
    if (event.action === "console") {
      return { ok: true, logs: ["[log] hello", "[error] boom"] };
    }
    if (event.action === "screenshot") {
      if (event.target === "both") {
        return {
          ok: true,
          target: "both",
          images: [
            { viewport: "desktop", url: "https://desktop.example/", tabId: "tab-1", base64: "ZGVza3RvcA==", mimeType: "image/png", width: 1280, height: 800 },
            { viewport: "mobile", url: "https://mobile.example/", tabId: "tab-1", base64: "bW9iaWxl", mimeType: "image/png", width: 390, height: 844 },
          ],
        };
      }
      return { ok: true, base64: "c2hvdA==", mimeType: "image/png", viewport: "desktop", url: "https://actual.example/", tabId: "tab-1", width: 1280, height: 800 };
    }
    return { ok: false, error: `unknown host action ${event.action}`, code: "unknown_action" };
  };
  const handleWatch = (event: Record<string, any>): Record<string, any> => {
    const op = event.op ?? event.action;
    if (op === "subscribe") {
      state.subscribes.push({ port: event.callbackPort, secret: event.callbackSecret });
      return { ok: true, subscribed: true };
    }
    if (op === "unwatch") return { ok: true };
    if (op === "list" || op === "watches") {
      return {
        ok: true,
        watches: [
          { watchId: "w-fixed", condition: { type: "url_matches", pattern: "example" }, conditionSummary: "url_matches=/example/", status: "active" },
        ],
      };
    }
    if (op === "register") {
      if (typeof event.timeoutSecs !== "number") return { ok: false, error: "watch requires timeoutSecs (1..1800)" };
      return {
        ok: true,
        watchId: "w-fixed",
        condition: { type: "timer" },
        conditionSummary: "timer",
        intervalMs: event.intervalMs ?? 2000,
        watch: { createdAt: 2_000, timeoutAt: 5_000 },
      };
    }
    return { ok: false, error: `unsupported watch op ${op}`, code: "unknown_op" };
  };
  return { state, handleAction, handleWatch };
}

/** Search-engine scripted host: routes eval responses by last navigate URL. */
function makeSearchHost(mode: "ok" | "challenge-first" | "all-challenge" | "fetch-page" | "fetch-empty"): ScriptedHost {
  const base = makeScriptedHost();
  const originalAction = base.handleAction;
  base.handleAction = (event) => {
    if (event.action === "navigate") {
      base.state.lastNavigateUrl = String(event.url);
      return { ok: true, url: String(event.url), title: "Search" };
    }
    if (event.action === "eval") {
      const onPrimaryEngine = base.state.lastNavigateUrl.includes("html.duckduckgo.com");
      const challenge = mode === "all-challenge" || (mode === "challenge-first" && onPrimaryEngine);
      const results = challenge ? [] : [
        { title: "Example Result", url: "https://example.com/", snippet: "A result snippet" },
        { title: "Second Result", url: "https://example.org/", snippet: "" },
      ];
      return { ok: true, result: JSON.stringify({ results, challenge }) };
    }
    if (event.action === "content") {
      return mode === "fetch-empty"
        ? { ok: true, content: "   " }
        : { ok: true, content: "article body ".repeat(1000), truncated: false };
    }
    return originalAction(event);
  };
  return base;
}

/* ---------------------------------------------------------------------------
 * Transports: legacy loopback server + capability broker over a real HostBridge.
 * ------------------------------------------------------------------------- */

let legacyServer: Server | undefined;
let legacyPort = 0;
let previousBridgePort: string | undefined;
let previousSessionCapability: string | undefined;
let hostBridge: HostBridge | undefined;
let hostBridgePort = 0;
let broker: HostCapabilityBroker | undefined;
let brokerCalls: Array<{ op: string; sessionId: string; params: Record<string, unknown> }> = [];
let lastEnvelope: Record<string, any> | undefined;

const ALLOWING_POLICY = {
  declaredPermissions: (extensionId: string) => (extensionId === WEBVIEW_BROWSER_EXTENSION_ID ? ["browser.session"] : []),
  projectAllows: (extensionId: string, projectRoot: string, permission: string) =>
    extensionId === WEBVIEW_BROWSER_EXTENSION_ID && projectRoot === PROJECT_ROOT && permission === "browser.session",
};

function startLegacyServer(): Promise<void> {
  return new Promise((resolve) => {
    legacyServer = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const parsed = JSON.parse(body) as { action: string; event: Record<string, any> };
        const result = parsed.action === "browser_watch"
          ? scripted.handleWatch(parsed.event)
          : scripted.handleAction(parsed.event);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(result));
      });
    });
    legacyServer.listen(0, "127.0.0.1", () => {
      legacyPort = (legacyServer!.address() as { port: number }).port;
      resolve();
    });
  });
}

function mintToken(): string {
  return broker!.issueToken({
    extensionId: WEBVIEW_BROWSER_EXTENSION_ID,
    projectRoot: PROJECT_ROOT,
    permission: "browser.session",
  }).token;
}

function startCapabilityPath(): Promise<void> {
  return new Promise((resolve) => {
    broker = new HostCapabilityBroker({
      drivers: {
        browser: {
          toolAction: (sessionId, params) => {
            brokerCalls.push({ op: "browser.action", sessionId, params });
            return Promise.resolve(scripted.handleAction(params));
          },
          watchAction: (sessionId, params) => {
            brokerCalls.push({ op: "browser.watch", sessionId, params });
            return Promise.resolve(scripted.handleWatch(params));
          },
          disposeSession: async () => {},
        },
      },
      policy: ALLOWING_POLICY,
    });
    hostBridge = new HostBridge({
      onAgentEvent: () => {},
      onHostCapability: (event, sessionId) => {
        lastEnvelope = event as Record<string, any>;
        return broker!.dispatch(event, sessionId);
      },
      // Mirrors the landed Electron wiring: the host binds both the dispatch
      // and the `host_capability_token` mint op to the same broker.
      onHostCapabilityMint: (event) => broker!.mint(event),
    });
    void hostBridge.listen().then((port) => {
      hostBridgePort = port;
      resolve();
    });
  });
}

function configureDefaultCapabilityClient() {
  configureWebviewBrowserHost({
    port: hostBridgePort,
    sessionCapability: hostBridge!.register(SESSION_ID),
    projectRoot: PROJECT_ROOT,
    tokenProvider: mintToken,
  });
}

/* ---------------------------------------------------------------------------
 * Mounted tool sets: legacy single-file mounts vs the extension agent half.
 * ------------------------------------------------------------------------- */

type Mounted = { byName: Map<string, CapturedTool>; tools: CapturedTool[] };

let legacyWebview: { default: (pi: object) => void; executeBrowserTool: (params: any, signal?: AbortSignal) => Promise<unknown> };
let legacySearch: { default: (pi: object) => void };
let extensionWebviewModule: { default: (pi: object) => void; executeBrowserTool: (params: any, signal?: AbortSignal) => Promise<unknown>; BROWSER_TOOL_DECLARED_ACTIONS: readonly string[] };
let extensionSearchModule: { default: (pi: object) => void };

function mount(module: { default: (pi: object) => void }): Mounted {
  const { pi, tools } = capturePi();
  module.default(pi);
  return { tools, byName: new Map(tools.map((tool) => [tool.name, tool])) };
}

const FROZEN_TOOLS = ["browser", "browser_search", "browser_fetch"] as const;

let legacyWebviewTools: Mounted;
let legacySearchTools: Mounted;
let extensionWebviewTools: Mounted;
let extensionSearchTools: Mounted;

let scripted: ScriptedHost = makeScriptedHost();

// The optional intent feature extends only this documented surface. Keep all
// legacy behavior comparisons, removing exactly the new documentation (not errors
// or result fields); current intent behavior has its own real-DOM contract suite.
const INTENT_DESCRIPTION = 'For a complex page, observe intent names the current lookup goal and prioritizes bounded candidates; omit it for ordinary paging, and never combine it with cursor. Known locators/flows need no scoring. ';
const INTENT_HELP = [
  'observe {scope?,target?,region?,role?,name?,cursor?,intent?}',
  '                        intent: current lookup goal (1–512 characters); ranks bounded candidates',
  '                        before display. Local without Jev; cannot combine with cursor. Omit',
  '                        intent for ordinary paging. target=both stays local. Known locators',
  '                        and saved flows need no extra observation or scoring step.',
].join('\n');
const GOAL_DESCRIPTION = "goal runs the Browser Use jev-ultrafast controller using the saved Jev key; standalone only, single viewport. When the task names a website, pass url to open it before control begins. TYPE_TEXT reuses the current model. DONE requires independent outcome verification. ";
const GOAL_HELP = [
  'goal {goal, url?, max_steps?, timeoutSecs?, target?}',
  '                        Standalone bounded Jev Choice control loop (not actions[]). Requires the',
  '                        enabled Jev extension, its saved key and browser-cloud permission.',
  '                        Jev chooses operation + observed target in one request; TYPE_TEXT uses',
  '                        the current session model/auth. Default 12 decisions/30s; caps 30/60s.',
  '                        Single viewport only. Stale targets are reobserved, never relocated.',
  '                        DONE returns needs_verification, NOT verified task success. Check the',
  '                        actual outcome independently. Consequential submissions hand back control.',
  '',
].join('\n');
function legacyDocumentation(result: ToolResult): ToolResult {
  return { ...result, content: result.content.map(part => part.type === 'text' && part.text
    ? { ...part, text: part.text.replace(INTENT_HELP, 'observe {scope?,target?,region?,role?,name?,cursor?}').replace(GOAL_HELP, '') }
    : part) };
}

/** Runs one browser-tool case through both transports and returns both results. */
async function runBoth(
  params: Record<string, unknown>,
  host: ScriptedHost = makeScriptedHost(),
): Promise<{ legacy: ToolResult; extension: ToolResult }> {
  scripted = host;
  brokerCalls = [];
  lastEnvelope = undefined;
  const legacy = (await legacyWebview.executeBrowserTool(structuredClone(params))) as ToolResult;
  const extension = (await extensionWebviewTools.byName.get("browser")!.execute!("probe", structuredClone(params))) as ToolResult;
  return { legacy, extension: legacyDocumentation(extension) };
}

async function runSearchBoth(
  toolName: "browser_search" | "browser_fetch",
  params: Record<string, unknown>,
  host: ScriptedHost = makeScriptedHost(),
): Promise<{ legacy: ToolResult; extension: ToolResult }> {
  scripted = host;
  brokerCalls = [];
  const legacy = (await legacySearchTools.byName.get(toolName)!.execute!("probe", structuredClone(params))) as ToolResult;
  const extension = (await extensionSearchTools.byName.get(toolName)!.execute!("probe", structuredClone(params))) as ToolResult;
  return { legacy, extension };
}

beforeAll(async () => {
  // Neutralize ambient PipiUI runtime env: the legacy extensions capture these
  // at import, and a stray session capability would open real callback servers.
  previousBridgePort = process.env.PIPIUI_BRIDGE_PORT;
  previousSessionCapability = process.env.PIPIUI_SESSION_CAPABILITY;
  delete process.env.PIPIUI_SESSION_CAPABILITY;
  delete process.env.PIPIUI_HOST_CAPABILITY_TOKEN;

  await startLegacyServer();
  process.env.PIPIUI_BRIDGE_PORT = String(legacyPort);
  process.env.PIPIUI_SESSION_KEY = "test-session-key";

  await startCapabilityPath();
  configureDefaultCapabilityClient();

  legacyWebview = await import(pathToFileURL(legacyWebviewPath).href);
  legacySearch = await import(pathToFileURL(legacySearchPath).href);
  extensionWebviewModule = await import(pathToFileURL(join(extensionDir, "agent", "browser-tool.ts")).href);
  extensionSearchModule = await import(pathToFileURL(join(extensionDir, "agent", "browser-search-tools.ts")).href);

  legacyWebviewTools = mount(legacyWebview);
  legacySearchTools = mount(legacySearch);
  extensionWebviewTools = mount(extensionWebviewModule);
  extensionSearchTools = mount(extensionSearchModule);
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => legacyServer?.close(() => resolve()));
  await hostBridge?.close();
  if (previousBridgePort === undefined) delete process.env.PIPIUI_BRIDGE_PORT;
  else process.env.PIPIUI_BRIDGE_PORT = previousBridgePort;
  if (previousSessionCapability === undefined) delete process.env.PIPIUI_SESSION_CAPABILITY;
  else process.env.PIPIUI_SESSION_CAPABILITY = previousSessionCapability;
  delete process.env.PIPIUI_SESSION_KEY;
});

describe("webview-browser-extension manifest", () => {
  it("pins the frozen core-capability contract and declares the agent half", () => {
    const manifest = JSON.parse(readFileSync(join(extensionDir, "pipiui-extension.json"), "utf8"));
    expect(manifest.id).toBe("webview-browser-extension");
    expect(manifest.name).toBe("PipiUI WebView Browser");
    expect(manifest.agent).toEqual({ extension: "agent/index.ts" });
    expect(manifest.hostApi).toBe(">=1.0.0 <2.0.0");
    expect(manifest.permissions).toEqual(["browser.session"]);
    expect(manifest.update).toEqual({ channel: "stable", signature: "ed25519" });
    expect(existsSync(join(extensionDir, manifest.agent.extension))).toBe(true);
    expect(WEBVIEW_BROWSER_HOST_API).toBe(manifest.hostApi);
  });
});

describe("schema: names, labels, descriptions, parameters", () => {
  it("retains legacy schema fields and adds only explicit intent/goal surfaces", () => {
    expect(extensionWebviewTools.tools.map((tool) => tool.name)).toEqual(["browser"]);
    expect(extensionSearchTools.tools.map((tool) => tool.name).sort()).toEqual(["browser_fetch", "browser_search"]);
    for (const name of FROZEN_TOOLS) {
      const legacyTool = name === "browser" ? legacyWebviewTools.byName.get(name) : legacySearchTools.byName.get(name);
      const extensionTool = name === "browser" ? extensionWebviewTools.byName.get(name) : extensionSearchTools.byName.get(name);
      expect(extensionTool, `tool ${name} mounted`).toBeDefined();
      expect(extensionTool!.label).toBe(legacyTool!.label);
      expect(extensionTool!.description?.replace(INTENT_DESCRIPTION, '').replace(GOAL_DESCRIPTION, '').replace('observe, goal, wait', 'observe, wait')).toBe(legacyTool!.description);
      const parameters = JSON.parse(JSON.stringify(extensionTool!.parameters));
      if (name === 'browser') {
        expect(extensionTool!.description).toContain(INTENT_DESCRIPTION);
        expect(parameters.properties.intent).toMatchObject({ type: 'string', minLength: 1, maxLength: 512 });
        expect(parameters.properties.actions.items.properties.intent).toEqual(parameters.properties.intent);
        expect(extensionTool!.description).toContain(GOAL_DESCRIPTION);
        expect(parameters.properties.goal).toMatchObject({ type: 'string', minLength: 1, maxLength: 512 });
        expect(parameters.properties.max_steps).toMatchObject({ type: 'integer', minimum: 1, maximum: 30 });
        expect(parameters.properties.action.description).toContain('observe | goal | wait');
        parameters.properties.action.description = parameters.properties.action.description.replace('observe | goal | wait', 'observe | wait');
        delete parameters.properties.goal;
        delete parameters.properties.max_steps;
        delete parameters.properties.intent;
        delete parameters.properties.actions.items.properties.intent;
      }
      expect(parameters).toEqual(JSON.parse(JSON.stringify(legacyTool!.parameters)));
    }
  });

  it("browser schema keeps the frozen action surface the renderer and HELP pin", () => {
    const parameters = extensionWebviewTools.byName.get("browser")!.parameters as { properties: Record<string, any> };
    expect([...extensionWebviewModule.BROWSER_TOOL_DECLARED_ACTIONS]).toEqual([
      "navigate", "observe", "wait", "click", "input", "type", "select", "fill_form", "scroll",
      "content", "eval", "script", "console", "screenshot", "back", "forward", "reload", "help",
    ]);
    // The transcript renderer leads folded cards with args.action (+ url/js/mode);
    // those arg names are the old-session rendering contract.
    for (const key of ["action", "actions", "url", "js", "mode", "target", "snapshot_id", "element_token", "element_index", "locator", "fields", "timeoutSecs", "watchId"]) {
      expect(parameters.properties[key], `schema property ${key}`).toBeDefined();
    }
    const actions = parameters.properties.actions as { items: { properties: Record<string, any> } };
    expect(actions).toBeDefined();
    for (const key of ["action", "url", "selector", "timeoutSecs", "watchId", "target"]) {
      expect(actions.items.properties[key], `batch item property ${key}`).toBeDefined();
    }
  });

  it("screenshot description keeps the explicit no-pixel-redaction warning", () => {
    const description = extensionWebviewTools.byName.get("browser")!.description ?? "";
    expect(description).toContain("pixels are not redacted");
    expect(description).toContain("auth/checkout");
  });
});

describe("behavioral equivalence through both transports", () => {
  const singleCases: Array<{ name: string; params: Record<string, unknown> }> = [
    { name: "navigate ok renders a full observation", params: { action: "navigate", url: "https://example.com/" } },
    { name: "navigate without url is a local usage error", params: { action: "navigate" } },
    { name: "observe renders regions and elements", params: { action: "observe" } },
    { name: "observe with region/role/cursor params", params: { action: "observe", scope: "page", region: "r1", role: "link", cursor: 2 } },
    { name: "wait idle mode", params: { action: "wait", timeout: 3 } },
    { name: "wait selector mode requires a target", params: { action: "wait", mode: "selector" } },
    { name: "click via snapshot token", params: { action: "click", snapshot_id: "snap-1", element_token: "t1" } },
    { name: "click via locator", params: { action: "click", locator: { role: "link", name: "More information" } } },
    { name: "click without target is a usage error", params: { action: "click" } },
    { name: "click targeting both viewports is rejected locally", params: { action: "click", snapshot_id: "snap-1", element_token: "t1", target: "both" } },
    { name: "input requires text", params: { action: "input", snapshot_id: "snap-1", element_token: "t2" } },
    { name: "input ok", params: { action: "input", snapshot_id: "snap-1", element_token: "t2", text: "hello" } },
    { name: "select requires option", params: { action: "select", snapshot_id: "snap-1", element_token: "t1" } },
    { name: "fill_form renders fill summary with handoff fields", params: { action: "fill_form", fields: [{ locator: { css: "#a" }, value: "x" }, { locator: { css: "#pw" }, value: "y", type: "password" }] } },
    { name: "fill_form requires a non-empty fields array", params: { action: "fill_form", fields: [] } },
    { name: "scroll with direction/amount", params: { action: "scroll", direction: "down", amount: 2 } },
    { name: "content with truncation suffix", params: { action: "content" } },
    { name: "content html mode", params: { action: "content", mode: "html" } },
    { name: "eval returns sanitized page value", params: { action: "eval", js: "document.title" } },
    { name: "eval rejects trivial literals locally", params: { action: "eval", js: "'just a literal'" } },
    { name: "script returns full JSON envelope", params: { action: "script", js: "step('x')" } },
    { name: "console renders logs", params: { action: "console" } },
    { name: "console with clear/since_seq/level/limit", params: { action: "console", clear: true, since_seq: 3, level: "error", limit: 10 } },
    { name: "screenshot single viewport", params: { action: "screenshot" } },
    { name: "screenshot both viewports", params: { action: "screenshot", target: "both" } },
    { name: "back renders an observation", params: { action: "back" } },
    { name: "unknown action lists the manual", params: { action: "teleport" } },
    { name: "missing both action and actions explains the contract", params: {} },
    { name: "help renders the full manual", params: { action: "help" } },
  ];

  for (const testCase of singleCases) {
    it(`${testCase.name}`, async () => {
      const { legacy, extension } = await runBoth(testCase.params);
      expect(extension).toEqual(legacy);
      expect(extension.content.length).toBeGreaterThan(0);
    });
  }

  it("screenshot results keep labeled image parts (old transcript image contract)", async () => {
    const { extension } = await runBoth({ action: "screenshot", target: "both" });
    expect(extension.content.filter((part) => part.type === "image")).toHaveLength(2);
    expect(resultText(extension)).toContain("desktop");
    expect(resultText(extension)).toContain("mobile");
    expect(extension.details).toMatchObject({ images: [
      { viewport: "desktop", url: "https://desktop.example/", tabId: "tab-1" },
      { viewport: "mobile", url: "https://mobile.example/", tabId: "tab-1" },
    ] });
  });

  it("single screenshot preserves host provenance without duplicating image bytes", async () => {
    const { extension } = await runBoth({ action: "screenshot", url: "https://not-the-source.example/" });
    expect(extension.details).toEqual({ viewport: "desktop", image: {
      viewport: "desktop", url: "https://actual.example/", tabId: "tab-1", width: 1280, height: 800, mimeType: "image/png",
    } });
    expect(extension.content.filter(part => part.type === "image")).toHaveLength(1);
  });

  const batchCases: Array<{ name: string; params: Record<string, unknown> }> = [
    {
      name: "batch executes all items and labels images per index",
      params: {
        actions: [
          { action: "click", snapshot_id: "snap-1", element_token: "t1" },
          { action: "screenshot", target: "both" },
          { action: "observe" },
        ],
      },
    },
    {
      name: "batch stops at the first failed item and reports skipped indexes",
      params: {
        actions: [
          { action: "click", snapshot_id: "snap-1", element_token: "t1" },
          { action: "navigate" },
          { action: "observe" },
        ],
      },
    },
    { name: "batch requires 1..8 items", params: { actions: [] } },
    { name: "batch items require an action", params: { actions: [{ url: "https://example.com" }] } },
  ];

  for (const testCase of batchCases) {
    it(`${testCase.name}`, async () => {
      const { legacy, extension } = await runBoth(testCase.params);
      expect(extension).toEqual(legacy);
      const details = extension.details as { batch?: boolean; results?: unknown[] };
      if (Array.isArray(testCase.params.actions) && testCase.params.actions.length > 0) {
        expect(details.batch).toBe(true);
        expect(Array.isArray(details.results)).toBe(true);
      }
    });
  }

  it("batch details keep only renderer-safe compacted fields for intermediate observations", async () => {
    const { extension } = await runBoth({
      actions: [
        { action: "navigate", url: "https://example.com/" },
        { action: "click", snapshot_id: "snap-1", element_token: "t1" },
        { action: "observe" },
      ],
    });
    const details = extension.details as { results: Array<{ index: number; details?: Record<string, unknown> }> };
    const intermediate = details.results![1]!;
    expect(intermediate.details).toBeDefined();
    const keep = new Set([
      "error", "code", "requiresObservation", "requiresUserInput", "candidates",
      "ok", "action", "mutation", "relocated", "url", "title", "snapshotID",
      "loading", "viewport", "scroll", "note", "truncated", "deferObservation",
      "filled", "failed", "target", "nextCursor", "retryable", "limitations",
      "elementCount", "regionCount", "regions", "summarized", "observation", "imageCount", "results",
    ]);
    expect(Object.keys(intermediate.details!).every((key) => keep.has(key))).toBe(true);
  });
});

describe("watch protocol", () => {
  it("register rides the browser.watch capability op with register params", async () => {
    const { legacy, extension } = await runBoth({ action: "watch", timeoutSecs: 30, intervalMs: 2000 });
    expect(extension).toEqual(legacy);
    const watchCall = brokerCalls.find((call) => call.op === "browser.watch" && call.params.op === "register");
    expect(watchCall).toBeDefined();
    expect(watchCall!.sessionId).toBe(SESSION_ID);
    expect(watchCall!.params.timeoutSecs).toBe(30);
    expect(watchCall!.params.intervalMs).toBe(2000);
  });

  it("register without timeoutSecs is a local usage error on both transports", async () => {
    const { legacy, extension } = await runBoth({ action: "watch" });
    expect(extension).toEqual(legacy);
    expect(extension.isError).toBe(true);
  });

  it("register timeoutSecs bounds match the frozen 1..1800 contract", async () => {
    const under = await runBoth({ action: "watch", timeoutSecs: 0.5 });
    expect(under.extension).toEqual(under.legacy);
    expect(under.extension.isError).toBe(true);
    const over = await runBoth({ action: "watch", timeoutSecs: 1801 });
    expect(over.extension).toEqual(over.legacy);
    expect(over.extension.isError).toBe(true);
  });

  it("unwatch requires watchId and forwards unwatch ops", async () => {
    const missing = await runBoth({ action: "unwatch" });
    expect(missing.extension).toEqual(missing.legacy);
    expect(missing.extension.isError).toBe(true);

    const ok = await runBoth({ action: "unwatch", watchId: "w-fixed" });
    expect(ok.extension).toEqual(ok.legacy);
    expect(resultText(ok.extension)).toBe("ok");
    const call = brokerCalls.find((entry) => entry.op === "browser.watch" && entry.params.op === "unwatch");
    expect(call?.params.watchId).toBe("w-fixed");
  });

  it("watches lists session watch-registry state with frozen rendering", async () => {
    const { legacy, extension } = await runBoth({ action: "watches" });
    expect(extension).toEqual(legacy);
    expect(resultText(extension)).toContain("w-fixed url_matches=/example/ status=active");
  });

  it("subscribe travels as a browser.watch op carrying the callback target", async () => {
    const host = makeScriptedHost();
    scripted = host;
    brokerCalls = [];
    lastEnvelope = undefined;
    const { capabilityCall } = await import(pathToFileURL(join(extensionDir, "agent", "capability-bridge.ts")).href);
    const result = await capabilityCall("browser.watch", {
      action: "subscribe",
      op: "subscribe",
      callbackPort: 45678,
      callbackSecret: "callback-secret",
    });
    expect(result).toEqual({ ok: true, subscribed: true });
    const call = brokerCalls.find((entry) => entry.params.op === "subscribe");
    expect(call).toBeDefined();
    expect(call!.params.callbackPort).toBe(45678);
    expect(call!.params.callbackSecret).toBe("callback-secret");
    expect(host.state.subscribes).toEqual([{ port: 45678, secret: "callback-secret" }]);
  });

  it("a pre-cancelled action sends the disconnect cancel as a browser.action browser_cancel", async () => {
    const host = makeScriptedHost();
    scripted = host;
    brokerCalls = [];
    const controller = new AbortController();
    controller.abort();
    await expect(
      extensionWebviewTools.byName.get("browser")!.execute!("probe", { action: "navigate", url: "https://example.com/" }, controller.signal),
    ).rejects.toThrow("browser request timed out or was cancelled");
    const cancel = brokerCalls.find((entry) => entry.params.action === "browser_cancel");
    expect(cancel).toBeDefined();
    expect(typeof cancel!.params.requestID).toBe("string");
  });
});

describe("redaction rules at the extension boundary", () => {
  it("rejects trivial evals before any host call (no page-touch, no exceptions)", async () => {
    const { legacy, extension } = await runBoth({ action: "eval", js: "'just a literal'" });
    expect(extension).toEqual(legacy);
    expect(extension.isError).toBe(true);
    expect(resultText(extension)).toContain("eval rejected");
    expect(brokerCalls.filter((call) => call.params.action === "eval")).toHaveLength(0);
  });

  it("passes the host redaction fail-closed code through as a structured error", async () => {
    const host = makeScriptedHost();
    host.handleAction = () => ({
      ok: false,
      error: "browser redaction capacity exceeded; reload the document before continuing",
      code: "browser_redaction_capacity_exceeded",
    });
    const { legacy, extension } = await runBoth({ action: "observe" }, host);
    expect(extension).toEqual(legacy);
    expect(extension.isError).toBe(true);
    expect((extension.details as any).code).toBe("browser_redaction_capacity_exceeded");
    expect(resultText(extension)).toContain("redaction capacity exceeded");
  });

  it("renders sensitive-field handoff (requiresUserInput) in failure summaries", async () => {
    const host = makeScriptedHost();
    host.handleAction = () => ({
      ok: false,
      error: "user_handoff_required",
      requiresUserInput: true,
      observation: "password field",
    });
    const { legacy, extension } = await runBoth({ action: "click", snapshot_id: "snap-1", element_token: "t1" }, host);
    expect(extension).toEqual(legacy);
    expect(extension.isError).toBe(true);
    expect(resultText(extension)).toContain("user_handoff_required");
    expect((extension.details as any).requiresUserInput).toBe(true);
  });

  it("fill_form keeps per-field user_handoff_required results in the observation", async () => {
    const { extension } = await runBoth({
      action: "fill_form",
      fields: [{ locator: { css: "#a" }, value: "x" }, { locator: { css: "#pw" }, value: "y", type: "password" }],
    });
    expect(resultText(extension)).toContain("user_handoff_required");
    expect(resultText(extension)).toContain("filled=1 failed=1");
  });
});

describe("old-session rendering compatibility (renderer-facing shapes)", () => {
  it("single-action results keep the raw observation details the folded card reads", async () => {
    const { extension } = await runBoth({ action: "navigate", url: "https://example.com/" });
    const details = extension.details as Record<string, unknown>;
    for (const key of ["ok", "url", "title", "snapshotID", "loading", "viewport", "scroll", "regions", "elements"]) {
      expect(details[key], `details.${key}`).toBeDefined();
    }
    expect(resultText(extension)).toContain("URL: https://example.com/");
    expect(resultText(extension)).toContain("Snapshot: snap-1");
  });

  it("failure summaries keep the frozen JSON shape the error card parses", async () => {
    const host = makeScriptedHost();
    host.handleAction = () => ({ ok: false, error: "stale snapshot element", code: "missing_element" });
    const { extension } = await runBoth({ action: "click", snapshot_id: "snap-1", element_token: "gone" }, host);
    expect(extension.isError).toBe(true);
    expect(resultText(extension)).toContain("missing_element");
    const details = extension.details as Record<string, unknown>;
    expect(details.error).toBe("stale snapshot element");
    expect(details.code).toBe("missing_element");
  });

  it("browser_search results keep the legacy Search/Source listing and details", async () => {
    const { legacy, extension } = await runSearchBoth("browser_search", { query: "electron packaging", count: 3 }, makeSearchHost("ok"));
    expect(extension).toEqual(legacy);
    const text = resultText(extension);
    expect(text).toContain("Search: electron packaging");
    expect(text).toContain("Source: https://html.duckduckgo.com/html/?q=electron%20packaging");
    expect(text).toContain("[1] Example Result");
    expect(extension.details).toEqual({ url: "https://html.duckduckgo.com/html/?q=electron%20packaging", engine: "duckduckgo-html", count: 2 });
  });

  it("browser_search keeps the fallback note when the first engine bot-checks", async () => {
    const { legacy, extension } = await runSearchBoth("browser_search", { query: "fallback probe" }, makeSearchHost("challenge-first"));
    expect(extension).toEqual(legacy);
    const text = resultText(extension);
    expect(text).toContain("Note: fell back to duckduckgo-lite after: duckduckgo-html");
    expect((extension.details as any).fallbackFrom).toEqual(["duckduckgo-html"]);
  });

  it("browser_search renders the all-engines-failed report with per-engine reasons", async () => {
    const { legacy, extension } = await runSearchBoth("browser_search", { query: "doomed query" }, makeSearchHost("all-challenge"));
    expect(extension).toEqual(legacy);
    expect(extension.isError).toBe(true);
    const text = resultText(extension);
    expect(text).toContain("all 3 engines failed");
    expect(text).toContain("bot-check");
    expect(text).toContain("web_search");
  });

  it("browser_fetch keeps the rendered-text result with url details", async () => {
    const { legacy, extension } = await runSearchBoth("browser_fetch", { url: "https://example.com/article" }, makeSearchHost("fetch-page"));
    expect(extension).toEqual(legacy);
    expect((extension.details as any).url).toBe("https://example.com/article");
    expect((extension.details as any).truncated).toBe(false);
    expect(resultText(extension).length).toBeGreaterThan(0);
  });

  it("browser_fetch reports a loaded-but-empty page", async () => {
    const { legacy, extension } = await runSearchBoth("browser_fetch", { url: "https://example.com/empty" }, makeSearchHost("fetch-empty"));
    expect(extension).toEqual(legacy);
    expect(resultText(extension)).toContain("no content");
  });

  it("browser_fetch requires a non-empty url", async () => {
    const { legacy, extension } = await runSearchBoth("browser_fetch", { url: "  " });
    expect(extension).toEqual(legacy);
  });
});

describe("host capability gates (the extension cannot bypass the broker)", () => {
  it("surfaces a denied project grant as a structured permission_denied failure", async () => {
    configureWebviewBrowserHost({
      port: hostBridgePort,
      sessionCapability: hostBridge!.register("session-denied"),
      projectRoot: "/proj/other",
      tokenProvider: mintToken,
    });
    const host = makeScriptedHost();
    scripted = host;
    brokerCalls = [];
    const result = (await extensionWebviewTools.byName.get("browser")!.execute!("probe", { action: "navigate", url: "https://example.com/" })) as ToolResult;
    expect(result.isError).toBe(true);
    expect((result.details as any).code).toBe("permission_denied");
    expect(resultText(result)).toContain("permission_denied");
    expect(brokerCalls).toHaveLength(0);
  });

  it("surfaces a missing one-time token as token_required (fail closed)", async () => {
    configureWebviewBrowserHost({
      port: hostBridgePort,
      sessionCapability: hostBridge!.register(SESSION_ID),
      projectRoot: PROJECT_ROOT,
      tokenProvider: () => undefined,
    });
    const host = makeScriptedHost();
    scripted = host;
    brokerCalls = [];
    const result = (await extensionWebviewTools.byName.get("browser")!.execute!("probe", { action: "navigate", url: "https://example.com/" })) as ToolResult;
    expect(result.isError).toBe(true);
    expect((result.details as any).code).toBe("token_required");
    expect(brokerCalls).toHaveLength(0);
  });

  it("carries the extension id, hostApi range, permission, and project in every envelope", async () => {
    configureDefaultCapabilityClient();
    const host = makeScriptedHost();
    scripted = host;
    brokerCalls = [];
    lastEnvelope = undefined;
    const result = (await extensionWebviewTools.byName.get("browser")!.execute!("probe", { action: "navigate", url: "https://example.com/" })) as ToolResult;
    expect(result.isError).toBeFalsy();
    expect(lastEnvelope).toMatchObject({
      schemaVersion: 1,
      extensionId: "webview-browser-extension",
      hostApi: WEBVIEW_BROWSER_HOST_API,
      permission: "browser.session",
      projectRoot: PROJECT_ROOT,
      op: "browser.action",
    });
    expect(typeof lastEnvelope!.token).toBe("string");
    expect(lastEnvelope!.token.length).toBeGreaterThan(0);
    expect(brokerCalls.length).toBeGreaterThan(0);
    expect(broker!.handshake({ hostApi: WEBVIEW_BROWSER_HOST_API }).ok).toBe(true);
  });

  it("mints a fresh one-time token per call over the host_capability_token wire (default path)", async () => {
    // No tokenProvider: the bridge's default token source (the loopback mint
    // op) must supply the token the broker then consumes.
    configureWebviewBrowserHost({
      port: hostBridgePort,
      sessionCapability: hostBridge!.register(SESSION_ID),
      projectRoot: PROJECT_ROOT,
    });
    const host = makeScriptedHost();
    scripted = host;
    brokerCalls = [];
    lastEnvelope = undefined;
    const first = (await extensionWebviewTools.byName.get("browser")!.execute!("probe", { action: "navigate", url: "https://example.com/" })) as ToolResult;
    expect(first.isError).toBeFalsy();
    const firstToken = lastEnvelope!.token;
    expect(typeof firstToken).toBe("string");
    expect(firstToken.length).toBeGreaterThan(0);
    lastEnvelope = undefined;
    const second = (await extensionWebviewTools.byName.get("browser")!.execute!("probe", { action: "observe" })) as ToolResult;
    expect(second.isError).toBeFalsy();
    // One-time tokens: every call mints its own. A cached session-level token
    // would answer token_consumed on this second dispatch.
    expect(lastEnvelope!.token).toBeTruthy();
    expect(lastEnvelope!.token).not.toBe(firstToken);
    expect(brokerCalls.length).toBe(2);
    configureDefaultCapabilityClient();
  });

  it("passes a mint deny through fail-closed without reaching the driver", async () => {
    configureWebviewBrowserHost({
      port: hostBridgePort,
      sessionCapability: hostBridge!.register(SESSION_ID),
      projectRoot: "/proj/not-granted",
    });
    const host = makeScriptedHost();
    scripted = host;
    brokerCalls = [];
    const result = (await extensionWebviewTools.byName.get("browser")!.execute!("probe", { action: "navigate", url: "https://example.com/" })) as ToolResult;
    expect(result.isError).toBe(true);
    expect((result.details as any).code).toBe("permission_denied");
    expect(resultText(result)).toContain("permission_denied");
    expect(brokerCalls).toHaveLength(0);
    configureDefaultCapabilityClient();
  });

  it("fails closed when the host has no token mint route bound", async () => {
    const bareBridge = new HostBridge({});
    const port = await bareBridge.listen();
    try {
      configureWebviewBrowserHost({
        port,
        sessionCapability: bareBridge.register(SESSION_ID),
        projectRoot: PROJECT_ROOT,
      });
      const host = makeScriptedHost();
      scripted = host;
      brokerCalls = [];
      const result = (await extensionWebviewTools.byName.get("browser")!.execute!("probe", { action: "navigate", url: "https://example.com/" })) as ToolResult;
      expect(result.isError).toBe(true);
      expect((result.details as any).code).toBe("host_unavailable");
      expect(brokerCalls).toHaveLength(0);
    } finally {
      await bareBridge.close();
      configureDefaultCapabilityClient();
    }
  });

  // The token mint is a host round trip of its own. It used to run before the call's
  // AbortController existed, so a host that accepted the connection and never answered
  // parked the tool call outside every deadline — including the user's Stop button.
  it("bounds the token mint so a host that accepts but never answers cannot hang the call", async () => {
    const sockets: Array<{ destroy(): void }> = [];
    const silent = createServer(() => {
      // Accept the request and never write a response.
    });
    silent.on("connection", (socket) => sockets.push(socket));
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    const port = (silent.address() as { port: number }).port;
    try {
      configureWebviewBrowserHost({ port, sessionCapability: "silent-capability", projectRoot: PROJECT_ROOT });
      const { capabilityCall } = await import(pathToFileURL(join(extensionDir, "agent", "capability-bridge.ts")).href);
      const startedAt = Date.now();
      await expect(capabilityCall("browser.action", { action: "navigate", url: "https://example.com/" }, undefined, 250))
        .rejects.toThrow("browser request timed out or was cancelled");
      // 250ms call budget + the bounded best-effort cancel; the point is that it returns at all.
      expect(Date.now() - startedAt).toBeLessThan(10_000);
    } finally {
      sockets.forEach((socket) => socket.destroy());
      await new Promise<void>((resolve) => silent.close(() => resolve()));
      configureDefaultCapabilityClient();
    }
  }, 20_000);
});

describe("registration path (manifest → loader → spawn -e)", () => {
  it("builtin discovery loads the package and mounts the agent half into a session spawn", () => {
    const root = mkdtempSync(join(tmpdir(), "webview-browser-ext-load-"));
    try {
      const builtinRoot = join(root, "extensions");
      cpSync(extensionDir, join(builtinRoot, "webview-browser-extension"), { recursive: true });
      const registry = createExtensionRegistry([]);
      const loader = createExtensionLoader({ registry, builtinRoot, appRoot: join(root, "app-extensions") });
      loader.scan();
      expect(registry.get("webview-browser-extension")?.state).toBe("enabled");
      const mounted = loader.spawnPackages().find((pkg) => pkg.id === "webview-browser-extension");
      expect(mounted?.enabled).toBe(true);
      const expectedEntry = join(realpathSync(builtinRoot), "webview-browser-extension", "agent", "index.ts");
      expect(mounted?.extensionPath).toBe(expectedEntry);
      const output = assemblePiSpawn({ cwd: root, paths: {}, registeredExtensions: loader.spawnPackages() });
      expect(output.args).toContain("-e");
      expect(output.args).toContain(expectedEntry);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stays dormant unless both bridge env vars are present (entry guard)", () => {
    const source = readFileSync(join(extensionDir, "agent", "index.ts"), "utf8");
    expect(source).toContain("PIPIUI_BRIDGE_PORT");
    expect(source).toContain("PIPIUI_SESSION_KEY");
    expect(source).toMatch(/if \(!port \|\| !key\) return;/);
  });
});
