import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { HostCapabilityBroker } from "../src/host-capability.js";
import { createExtensionLoader } from "../src/extension-loader.js";
import { createExtensionRegistry } from "../src/extension-registry.js";
import { assemblePiSpawn } from "../src/spawn-assembly.js";
import { createNativeCuaClient, type NativeCuaClient } from "../../../resources/runtime/extensions/cua-extension/agent/host-capability-client.js";
// (No `@pipi/host-api` import: this worktree's tsc resolves workspace deps to the
// primary checkout's stale dist — a pre-existing cherry-pick-base condition that
// hits src/host-capability.ts equally; vitest's alias resolves source. The wire
// version itself is pinned by host-capability-api.test.ts.)

/**
 * cua-extension migration contract.
 *
 * The extension package `resources/runtime/extensions/cua-extension` owns the
 * mounting of the two frozen CUA tools (`computer` / `open_application`); the
 * tool layer is migrated byte-identical from the built-in
 * `pipiui-computer-use.ts` strategy, with the driver transport swapped to the
 * versioned Host Capability API broker (`host_capability` wire action,
 * `native.cua` op, one-time capability token; the desktop-grant capability
 * still rides inside params). These tests pin, in order: the schema contract
 * against the legacy twin, the registration path (manifest → loader → spawn
 * `-e`), the broker authorization semantics (deny codes surfaced, driver
 * untouched), and the driver transport/cleanup path (cancel op with the same
 * requestID, legacy error phrasing).
 */

const extensionDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../resources/runtime/extensions/cua-extension",
);
const legacyStrategyPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../resources/runtime/extensions/pipiui-computer-use.ts",
);

type CapturedTool = {
  name: string;
  label?: string;
  description?: string;
  parameters?: unknown;
  execute?: (callId: string, params: Record<string, unknown>, signal?: AbortSignal, onUpdate?: unknown, ctx?: unknown) => Promise<unknown>;
};

type ToolResult = { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; details?: unknown };

/** Minimal ExtensionAPI capture harness: records mounts, no-ops session side effects. */
function capturePi() {
  const tools: CapturedTool[] = [];
  const pi = {
    registerTool: (tool: CapturedTool) => { tools.push(tool); },
    registerCommand: () => {},
    registerShortcut: () => {},
    appendEntry: () => {},
    sendMessage: () => {},
    on: (eventName: string, handler: (event: any, ctx?: any) => any) => {
      if (eventName === "tool_call") toolCallHandlers.push(handler);
      return { unsubscribe() {} };
    },
    exec: async () => { throw new Error("pi.exec is not expected in cua-extension tests"); },
  };
  const toolCallHandlers: Array<(event: any) => any> = [];
  return { pi, tools, toolCallHandlers };
}

// ---------------------------------------------------------------------------
// Stub loopback bridge: mirrors the pinned HostBridge semantics (session
// capability auth, 403 deny shape) and adds the `host_capability_token` mint op
// the extension's default token provider calls (land-phase contract; see the
// extension README). The broker itself is the real cherry-picked one.
// ---------------------------------------------------------------------------

type StubBridge = {
  port: number;
  capability: string;
  close(): Promise<void>;
};

function startStubBridge(broker: HostCapabilityBroker, sessionId: string): Promise<StubBridge> {
  const sessions = new Map<string, string>();
  const capability = `stub-session-capability-${Math.random().toString(36).slice(2)}`;
  sessions.set(capability, sessionId);
  const sessionFor = (value: unknown): string | undefined => {
    if (typeof value !== "string" || !value) return undefined;
    return sessions.get(value);
  };
  const reply = (response: ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("error", () => reply(response, 400, { ok: false, error: "request aborted" }));
    request.on("end", async () => {
      let body: any;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {
        return reply(response, 400, { ok: false, error: "invalid JSON body" });
      }
      const sessionIdResolved = sessionFor(body?.sessionCapability);
      if (!sessionIdResolved || body.schemaVersion !== 1) {
        return reply(response, 403, { ok: false, error: "unauthorized bridge capability" });
      }
      if (body.action === "host_capability") {
        return reply(response, 200, await broker.dispatch(body.event, sessionIdResolved));
      }
      if (body.action === "host_capability_token") {
        try {
          const minted = broker.issueToken({
            extensionId: body.event.extensionId,
            projectRoot: body.event.projectRoot,
            permission: body.event.permission,
          });
          return reply(response, 200, { ok: true, token: minted.token, expiresAt: minted.expiresAt });
        } catch (error) {
          return reply(response, 200, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
      return reply(response, 200, { ok: false, error: "unknown action" });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        port,
        capability,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Fake native driver: records every CuaDriverHost.handle request; computer_batch
// can be gated so tests can abort mid-flight and observe the cancel op.
// ---------------------------------------------------------------------------

const PNG_BASE64 = Buffer.from("png-bytes").toString("base64");

function makeFakeDriver() {
  const calls: Array<Record<string, any>> = [];
  let batchGate: { promise: Promise<void>; resolve: () => void } | undefined;
  const handle = async (params: Record<string, any>) => {
    calls.push(params);
    if (params.action === "computer_runtime_capabilities") {
      return {
        ok: true,
        protocol: { name: "pipiui-computer-runtime", version: 1 },
        operations: ["computer_runtime_capabilities", "computer_batch", "computer_open_application", "computer_cancel"],
        display: { id: 7, width: 1440, height: 900 },
        permissions: {},
      };
    }
    if (params.action === "computer_open_application") {
      return {
        ok: true,
        openedApplication: true,
        pid: 42,
        target: { pid: 42, window_id: 7, session: String(params.sessionKey ?? "") },
        foregroundApp: "TextEdit",
        windowTitle: "Untitled",
        screenshotId: "shot-open",
        base64: PNG_BASE64,
        mimeType: "image/png",
        displayID: 7,
        width: 1440,
        height: 900,
        accessibility: { elements: [{ role: "AXButton", element_token: "tok-1" }], elementCount: 1 },
      };
    }
    if (params.action === "computer_batch") {
      if (batchGate) await batchGate.promise;
      return {
        ok: true,
        batchOK: true,
        outcomes: [],
        screenshotId: "shot-batch",
        base64: PNG_BASE64,
        mimeType: "image/png",
        displayID: 7,
        width: 1440,
        height: 900,
      };
    }
    if (params.action === "computer_cancel") {
      batchGate?.resolve();
      return { ok: true, cancelled: true };
    }
    return { ok: false, error: `unexpected driver op ${String(params.action)}` };
  };
  return {
    calls,
    gateBatch: () => {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => { resolve = done; });
      batchGate = { promise, resolve };
    },
    driver: { handle, usable: () => true },
  };
}

function makeBroker(options: {
  driver: { handle(params: Record<string, unknown>): Promise<Record<string, unknown>>; usable(): boolean };
  projectAllows?(extensionId: string, projectRoot: string, permission: string): boolean;
  declared?: readonly string[];
  hostApiVersion?: string;
  now?: () => number;
  tokenTtlMs?: number;
}): HostCapabilityBroker {
  return new HostCapabilityBroker({
    ...(options.hostApiVersion ? { hostApiVersion: options.hostApiVersion } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.tokenTtlMs !== undefined ? { tokenTtlMs: options.tokenTtlMs } : {}),
    drivers: { native: options.driver },
    policy: {
      declaredPermissions: () => options.declared ?? ["native.exec"],
      projectAllows: options.projectAllows ?? (() => true),
      // Mirrors the landed Electron wiring (host_capability_token mint +
      // desktop-grant verifier): the bridge session owns exactly the desktop
      // grant published via PIPIUI_COMPUTER_CAPABILITY for session-1.
      verifyDesktopGrant: ({ sessionId, computerCapability }) =>
        sessionId === "session-1" && computerCapability === "test-computer-grant",
    },
  });
}

// ---------------------------------------------------------------------------
// Module loading: env must be set before the extension entry is imported
// (module-level env gate, same as the legacy strategy).
// ---------------------------------------------------------------------------

let stub: StubBridge | undefined;
let fake: ReturnType<typeof makeFakeDriver>;
let extensionEntry: { default: (pi: object) => void };
let legacyEntry: { default: (pi: object) => void };
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  fake = makeFakeDriver();
  const broker = makeBroker({ driver: fake.driver });
  stub = await startStubBridge(broker, "session-1");
  const env: Record<string, string> = {
    PIPIUI_BRIDGE_PORT: String(stub.port),
    PIPIUI_SESSION_CAPABILITY: stub.capability,
    PIPIUI_SESSION_KEY: "session-1",
    PIPIUI_COMPUTER_CAPABILITY: "test-computer-grant",
    PIPIUI_COMPUTER_DISPLAY_ID: "7",
    PIPIUI_COMPUTER_WIDTH: "1440",
    PIPIUI_COMPUTER_HEIGHT: "900",
  };
  for (const [key, value] of Object.entries(env)) {
    savedEnv[key] = process.env[key];
    process.env[key] = value;
  }
  extensionEntry = await import(pathToFileURL(join(extensionDir, "agent", "index.ts")).href);
  legacyEntry = await import(pathToFileURL(legacyStrategyPath).href);
});

afterAll(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await stub?.close();
  stub = undefined;
});

function mountModule(entry: { default: (pi: object) => void }) {
  const captured = capturePi();
  entry.default(captured.pi);
  const byName = new Map(captured.tools.map((tool) => [tool.name, tool]));
  return { ...captured, byName };
}

// ---------------------------------------------------------------------------
// 1. Frozen tool schema contract (twin = legacy pipiui-computer-use.ts).
// ---------------------------------------------------------------------------

describe("cua-extension frozen tool schema contract", () => {
  it("mounts exactly the two frozen tools through the extension agent half", () => {
    const { tools } = mountModule(extensionEntry);
    expect(tools.map((tool) => tool.name).sort()).toEqual(["computer", "open_application"]);
  });

  it("extension-mounted schemas, labels and descriptions are identical to the legacy strategy", () => {
    const extension = mountModule(extensionEntry);
    const legacy = mountModule(legacyEntry);
    for (const name of ["computer", "open_application"] as const) {
      const tool = extension.byName.get(name)!;
      const twin = legacy.byName.get(name)!;
      expect(twin, `legacy twin for ${name}`).toBeDefined();
      expect(tool.parameters).toEqual(twin.parameters);
      expect(tool.label).toBe(twin.label);
      expect(tool.description).toBe(twin.description);
      expect(JSON.parse(JSON.stringify(tool.parameters))).toMatchSnapshot(`${name} schema`);
    }
  });

  it("provider adaptation helpers behave identically to the legacy strategy", async () => {
    const extension = await import(pathToFileURL(join(extensionDir, "agent", "index.ts")).href);
    const legacy = await import(pathToFileURL(legacyStrategyPath).href);
    // Anthropic typed-tool replacement.
    expect(extension.replaceComputerTool([{ name: "computer", type: "function" }, { name: "bash" }]))
      .toEqual(legacy.replaceComputerTool([{ name: "computer", type: "function" }, { name: "bash" }]));
    expect(extension.isAnthropicComputer20251124Model({ api: "anthropic-messages", provider: "anthropic", id: "claude-opus-4-6" }))
      .toBe(legacy.isAnthropicComputer20251124Model({ api: "anthropic-messages", provider: "anthropic", id: "claude-opus-4-6" }));
    expect(extension.mergeBeta("computer-use-2025-11-24", "computer-use-2025-11-24"))
      .toBe(legacy.mergeBeta("computer-use-2025-11-24", "computer-use-2025-11-24"));
    // Legacy single-action normalization.
    const single = { action: "screenshot" };
    expect(extension.normalizeActions(single)).toEqual(legacy.normalizeActions(single));
    const batch = { actions: [{ type: "click" }] };
    expect(extension.normalizeActions(batch)).toEqual(legacy.normalizeActions(batch));
    // Shell open interception (direct + nested-shell cases).
    for (const command of ["open -a Safari", "env -i /usr/bin/open -a Safari", "bash -c 'open -a Safari'", "echo /usr/bin/open", "git --open x"]) {
      const input = { command };
      expect(extension.lifecycleShellBlockReason("bash", input))
        .toEqual(legacy.lifecycleShellBlockReason("bash", input));
    }
    // AX compaction keeps interactive elements and the pre-trim count.
    const ax = { elements: [{ role: "AXButton", element_token: "t" }, { role: "AXStaticText" }, { role: "AXWindow" }], elementCount: 3 };
    expect(extension.compactAccessibility(ax)).toEqual(legacy.compactAccessibility(ax));
    expect(extension.elementIsInteractive({ role: "button" })).toBe(legacy.elementIsInteractive({ role: "button" }));
  });
});

// ---------------------------------------------------------------------------
// 2. Registration path: manifest → loader → spawn `-e`.
// ---------------------------------------------------------------------------

describe("cua-extension registration path", () => {
  it("manifest pins the frozen core-capability contract and declares the agent half", () => {
    const manifest = JSON.parse(readFileSync(join(extensionDir, "pipiui-extension.json"), "utf8"));
    expect(manifest.id).toBe("cua-extension");
    expect(manifest.name).toBe("PipiUI CUA");
    expect(manifest.agent).toEqual({ extension: "agent/index.ts" });
    expect(manifest.hostApi).toBe(">=1.0.0 <2.0.0");
    expect(manifest.permissions).toEqual(["native.exec"]);
    expect(manifest.nativeResources).toEqual([
      { id: "cua-driver", entry: "native/cua-driver", platforms: ["darwin-arm64", "darwin-x64"] },
    ]);
    expect(manifest.update).toEqual({ channel: "stable", signature: "ed25519" });
    expect(existsSync(join(extensionDir, manifest.agent.extension))).toBe(true);
  });

  it("builtin discovery loads the package and mounts the agent half into a session spawn (-e)", () => {
    const root = mkdtempSync(join(tmpdir(), "cua-ext-load-"));
    try {
      const builtinRoot = join(root, "extensions");
      cpSync(extensionDir, join(builtinRoot, "cua-extension"), { recursive: true });
      const registry = createExtensionRegistry([]);
      const loader = createExtensionLoader({ registry, builtinRoot, appRoot: join(root, "app-extensions") });
      loader.scan();
      expect(registry.get("cua-extension")?.state).toBe("enabled");
      const mounted = loader.spawnPackages().find((pkg) => pkg.id === "cua-extension");
      expect(mounted?.enabled).toBe(true);
      const expectedEntry = join(realpathSync(builtinRoot), "cua-extension", "agent", "index.ts");
      expect(mounted?.extensionPath).toBe(expectedEntry);
      const output = assemblePiSpawn({ cwd: root, paths: {}, registeredExtensions: loader.spawnPackages() });
      expect(output.args).toContain("-e");
      expect(output.args).toContain(expectedEntry);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Broker authorization semantics (real broker; driver untouched on denies).
// ---------------------------------------------------------------------------

describe("cua-extension broker authorization semantics", () => {
  const callParams = { action: "computer_batch", protocolVersion: 1, actions: [{ type: "screenshot" }] };

  it("surfaces permission_denied and never touches the driver when the project has not granted", async () => {
    fake.calls.length = 0;
    const broker = makeBroker({
      driver: fake.driver,
      projectAllows: (_extensionId, projectRoot) => projectRoot === "/proj/granted",
    });
    const stub2 = await startStubBridge(broker, "session-1");
    try {
      const client = createDirectClient(stub2, { projectRoot: "/proj/locked" });
      await expect(client.call(callParams)).rejects.toMatchObject({ code: "permission_denied" });
      expect(fake.calls).toEqual([]);
    } finally {
      await stub2.close();
    }
  });

  it("surfaces permission_denied when the manifest does not declare native.exec", async () => {
    fake.calls.length = 0;
    const broker = makeBroker({ driver: fake.driver, declared: [] });
    const stub2 = await startStubBridge(broker, "session-1");
    try {
      const client = createDirectClient(stub2);
      await expect(client.call(callParams)).rejects.toMatchObject({ code: "permission_denied" });
      expect(fake.calls).toEqual([]);
    } finally {
      await stub2.close();
    }
  });

  it("surfaces host_api_mismatch for a stale host and never touches the driver", async () => {
    fake.calls.length = 0;
    const broker = makeBroker({ driver: fake.driver, hostApiVersion: "2.0.0" });
    const stub2 = await startStubBridge(broker, "session-1");
    try {
      const client = createDirectClient(stub2);
      await expect(client.call(callParams)).rejects.toMatchObject({ code: "host_api_mismatch" });
      expect(fake.calls).toEqual([]);
    } finally {
      await stub2.close();
    }
  });

  it("consumes the one-time token once and answers replay with token_consumed", async () => {
    fake.calls.length = 0;
    const broker = makeBroker({ driver: fake.driver });
    const stub2 = await startStubBridge(broker, "session-1");
    try {
      const { token } = broker.issueToken({
        extensionId: "cua-extension",
        projectRoot: process.cwd(),
        permission: "native.exec",
      });
      const client = createDirectClient(stub2, { tokenProvider: () => token });
      await client.call(callParams);
      expect(fake.calls).toHaveLength(1);
      await expect(client.call(callParams)).rejects.toMatchObject({ code: "token_consumed" });
      expect(fake.calls).toHaveLength(1);
    } finally {
      await stub2.close();
    }
  });

  it("surfaces token_expired past the TTL", async () => {
    let now = 1_000_000;
    const broker = makeBroker({ driver: fake.driver, now: () => now, tokenTtlMs: 1_000 });
    const stub2 = await startStubBridge(broker, "session-1");
    try {
      const { token } = broker.issueToken({
        extensionId: "cua-extension",
        projectRoot: process.cwd(),
        permission: "native.exec",
        ttlMs: 1_000,
      });
      now += 1_001;
      const client = createDirectClient(stub2, { tokenProvider: () => token });
      await expect(client.call(callParams)).rejects.toMatchObject({ code: "token_expired" });
      expect(fake.calls).toEqual([]);
    } finally {
      await stub2.close();
    }
  });

  it("answers a forged session capability with the stable 403 deny and never touches the driver", async () => {
    fake.calls.length = 0;
    const broker = makeBroker({ driver: fake.driver });
    const stub2 = await startStubBridge(broker, "session-1");
    try {
      const client = createDirectClient(stub2, { sessionCapability: "forged-capability" });
      await expect(client.call(callParams)).rejects.toThrow("unauthorized bridge capability");
      expect(fake.calls).toEqual([]);
    } finally {
      await stub2.close();
    }
  });

  it("fails closed when the host cannot mint a token", async () => {
    const broker = makeBroker({ driver: fake.driver });
    const stub2 = await startStubBridge(broker, "session-1");
    try {
      const client = createDirectClient(stub2, {
        sessionCapability: "wrong-capability",
        tokenProvider: undefined,
      });
      await expect(client.call(callParams)).rejects.toThrow(/host capability token mint failed/);
      expect(fake.calls).toEqual([]);
    } finally {
      await stub2.close();
    }
  });

  /** Direct client against an isolated stub; env-independent (projectRoot explicit). */
  function createDirectClient(
    bridge: StubBridge,
    overrides: {
      projectRoot?: string;
      sessionCapability?: string;
      tokenProvider?: () => string | Promise<string>;
    } = {},
  ): NativeCuaClient {
    return createNativeCuaClient({
      bridgePort: String(bridge.port),
      sessionCapability: overrides.sessionCapability ?? bridge.capability,
      sessionKey: "session-1",
      computerCapability: "test-computer-grant",
      projectRoot: overrides.projectRoot ?? process.cwd(),
      ...(overrides.tokenProvider ? { tokenProvider: overrides.tokenProvider } : {}),
    });
  }
});

// ---------------------------------------------------------------------------
// 4. Driver transport + cleanup path (extension module, full stack).
// ---------------------------------------------------------------------------

describe("cua-extension driver transport and cleanup", () => {
  it("open_application rides the broker with unchanged driver fields and renders the frozen result shape", async () => {
    fake.calls.length = 0;
    const { byName } = mountModule(extensionEntry);
    const result = (await byName.get("open_application")!.execute!("probe", {
      bundle_identifier: "com.apple.TextEdit",
    })) as ToolResult;
    const op = fake.calls.find((call) => call.action === "computer_open_application");
    expect(op).toBeDefined();
    expect(op!.sessionKey).toBe("session-1");
    expect(op!.computerCapability).toBe("test-computer-grant");
    expect(op!.bundle_identifier).toBe("com.apple.TextEdit");
    expect(op!.displayID).toBe(7);
    expect(op!.requestID).toEqual(expect.any(String));
    // Frozen result shape: metadata text + opaque marker + inline image.
    const text = result.content[0]?.text ?? "";
    expect(text).toContain('"openedApplication": true');
    expect(text).toContain("[PIPIUI_COMPUTER_SCREENSHOT:shot-open]");
    expect(result.content[1]).toMatchObject({ type: "image", data: PNG_BASE64, mimeType: "image/png" });
    expect((result.details as any).accessibility).toEqual({ elementCount: 1 });
  });

  it("computer batches ride the broker and normalize Anthropic single actions", async () => {
    fake.calls.length = 0;
    const { byName } = mountModule(extensionEntry);
    const result = (await byName.get("computer")!.execute!("probe", {
      action: "screenshot",
    })) as ToolResult;
    const op = fake.calls.find((call) => call.action === "computer_batch");
    expect(op).toBeDefined();
    // Anthropic single-action normalization keeps the legacy shape (action + type).
    expect(op!.actions).toEqual([{ action: "screenshot", type: "screenshot" }]);
    expect(op!.sessionKey).toBe("session-1");
    expect(op!.computerCapability).toBe("test-computer-grant");
    const text = result.content[0]?.text ?? "";
    expect(text).toContain('"batchOK": true');
    expect(text).toContain("[PIPIUI_COMPUTER_SCREENSHOT:shot-batch]");
    expect(result.content[1]).toMatchObject({ type: "image", data: PNG_BASE64 });
  });

  it("aborts send the computer_cancel cleanup op with the same requestID and keep legacy error phrasing", async () => {
    fake.calls.length = 0;
    fake.gateBatch();
    const { byName } = mountModule(extensionEntry);
    const controller = new AbortController();
    const pending = byName.get("computer")!.execute!("probe", { actions: [{ type: "screenshot" }] }, controller.signal);
    await vi.waitFor(() => {
      expect(fake.calls.some((call) => call.action === "computer_batch")).toBe(true);
    });
    controller.abort();
    await expect(pending).rejects.toThrow("computer request timed out and was cancelled");
    await vi.waitFor(() => {
      expect(fake.calls.some((call) => call.action === "computer_cancel")).toBe(true);
    });
    const batch = fake.calls.find((call) => call.action === "computer_batch");
    const cancel = fake.calls.find((call) => call.action === "computer_cancel");
    expect(cancel.requestID).toBe(batch.requestID);
    expect(cancel.sessionKey).toBe("session-1");
    expect(cancel.computerCapability).toBe("test-computer-grant");
  });

  it("keeps the legacy param-validation errors", async () => {
    const { byName } = mountModule(extensionEntry);
    await expect(byName.get("computer")!.execute!("probe", {})).rejects.toThrow(
      "computer requires a non-empty actions batch or Anthropic action",
    );
    await expect(byName.get("open_application")!.execute!("probe", {})).rejects.toThrow(
      "open_application requires bundle_identifier or application_name",
    );
  });

  it("passes driver-level failure bodies through so the strategy layer keeps legacy phrasing", async () => {
    fake.calls.length = 0;
    // The client returns the raw driver body; the strategy's
    // runtimeFailureMessage check turns {ok:false} into a thrown Error (pinned
    // against the extension module by the schema/transport tests above).
    const client = createTransportClient();
    const driverBody = await client.call({ action: "computer_unexpected" });
    expect(driverBody).toMatchObject({ ok: false, error: "unexpected driver op computer_unexpected" });
  });

  /** Client built exactly like the extension builds it (default mint provider). */
  function createTransportClient(): NativeCuaClient {
    return createNativeCuaClient({
      bridgePort: String(stub!.port),
      sessionCapability: stub!.capability,
      sessionKey: "session-1",
      computerCapability: "test-computer-grant",
      projectRoot: process.cwd(),
    });
  }
});

afterEach(() => {
  fake.calls.length = 0;
});
