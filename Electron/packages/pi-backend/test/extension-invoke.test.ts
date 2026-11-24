import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createPiHostBackend } from "../src/index.js";
import { HEADROOM_MANAGED_SETTINGS, type HeadroomManagedRuntimeLike } from "../src/headroom-managed-runtime.js";
import { extensionSettingsEnvName } from "../src/spawn-assembly.js";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

const fakePi = new URL("./fake-pi-invoke.mjs", import.meta.url).pathname;

type ExtResult = { ok: true; data: unknown } | { ok: false; error: { code: string; message: string } };

async function writeManifest(dir: string, body: unknown) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "pipiui-extension.json"), `${JSON.stringify(body, null, 2)}\n`);
}

function invokeAgentManifest(overrides: Record<string, unknown> = {}) {
  return {
    id: "invoke-agent",
    name: "Invoke Agent",
    version: "1.0.0",
    agent: { extension: "agent/index.js", skills: ["agent/skills"] },
    app: {
      settings: {
        scope: "app",
        schema: {
          type: "object",
          properties: { "ext.invoke-agent.flag": { type: "boolean" } },
        },
      },
    },
    capabilities: ["invoke.agent", "settings.read", "settings.write"],
    settingsVersion: 1,
    ...overrides,
  };
}

async function seedSession(cwd: string, sessionsRoot: string, sessionId = "session-1") {
  const dir = join(sessionsRoot, sessionId);
  await mkdir(dir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await writeFile(
    join(dir, "session.jsonl"),
    `${JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: "2026-08-10T00:00:00.000Z", cwd })}\n`,
  );
}

function backendFor(dirs: {
  agent: string;
  sessions: string;
  runtime: string;
  env?: Record<string, string>;
  logInvokeByCwd?: boolean;
  timeoutMs?: number;
  capture?: { args?: string[]; env?: NodeJS.ProcessEnv };
  headroomRuntime?: HeadroomManagedRuntimeLike;
}) {
  return createPiHostBackend({
    agentDir: dirs.agent,
    sessionsRoot: dirs.sessions,
    runtimeRoot: dirs.runtime,
    canonicalProjectPaths: async () => undefined,
    piPath: "node",
    extensionInvokeTimeoutMs: dirs.timeoutMs,
    headroomRuntime: dirs.headroomRuntime,
    spawn: (_bin, args, options) => {
      const argv = args as string[];
      if (dirs.capture && argv.includes("--mode") && argv.includes("rpc") && !argv.includes("--no-session")) {
        dirs.capture.args = argv;
        dirs.capture.env = options.env;
      }
      return spawn(process.execPath, [fakePi], {
        ...options,
        env: { ...options.env, PATH: "/usr/local/bin:/usr/bin:/bin", ...dirs.env,
          ...(dirs.logInvokeByCwd ? { FAKE_PI_INVOKE_LOG: join(String(options.cwd), "invoke.log") } : {}),
        },
      }) as any;
    },
  });
}

describe("invokeExtension and spawn settings snapshot", () => {
  it("returns not_found, disabled, capability_denied, and no_session without a live session", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-ext-invoke-err-"));
    const agent = join(root, "agent");
    const runtime = join(root, "runtime");
    await writeManifest(join(agent, "extensions", "invoke-agent"), invokeAgentManifest());
    await mkdir(join(agent, "extensions", "invoke-agent", "agent"), { recursive: true });
    await writeFile(join(agent, "extensions", "invoke-agent", "agent", "index.js"), "export default () => {};\n");
    await writeManifest(join(agent, "extensions", "quota"), {
      id: "quota",
      name: "Quota",
      version: "1.0.0",
      agent: { extension: "agent/index.js" },
      capabilities: ["bridge.emit"],
    });
    // The loader errors on a declared agent entry that is missing on disk;
    // quota only exercises the capability_denied path, so give it a real file.
    await mkdir(join(agent, "extensions", "quota", "agent"), { recursive: true });
    await writeFile(join(agent, "extensions", "quota", "agent", "index.js"), "export default () => {};\n");
    const backend = backendFor({ agent, sessions: join(root, "sessions"), runtime });
    await backend.handle("listExtensions" as never, []);

    for (const id of ["invoke-agent injected", "invoke-agent\n/other", "/invoke-agent", "invoke-agent\t", " invoke-agent", "invoke-agent\u2028"]) {
      const invalid = await backend.handle("invokeExtension" as never, [id, "ping", {}]);
      expect(invalid).toMatchObject({ ok: false, error: { code: "not_found" } });
    }
    const missing = (await backend.handle("invokeExtension" as never, ["no-such", "ping", {}])) as ExtResult;
    expect(missing).toMatchObject({ ok: false, error: { code: "not_found" } });

    const disabled = (await backend.handle("invokeExtension" as never, ["invoke-agent", "ping", {}])) as ExtResult;
    expect(disabled).toMatchObject({ ok: false, error: { code: "disabled" } });

    await backend.handle("setExtensionEnabled" as never, ["quota", true, "app"]);
    const denied = (await backend.handle("invokeExtension" as never, ["quota", "ping", {}])) as ExtResult;
    expect(denied).toMatchObject({ ok: false, error: { code: "capability_denied" } });

    await backend.handle("setExtensionEnabled" as never, ["invoke-agent", true, "app"]);
    const noSession = (await backend.handle("invokeExtension" as never, ["invoke-agent", "ping", { n: 1 }])) as ExtResult;
    expect(noSession).toMatchObject({ ok: false, error: { code: "no_session" } });
    await backend.close();
  });

  it.each([false, true])("uses native prompt ack, checks command registration (missing=%s), injects settings, and times out", async (missingCommand) => {
    root = await mkdtemp(join(tmpdir(), "pipi-ext-invoke-ok-"));
    const agent = join(root, "agent");
    const cwd = join(root, "project");
    const sessions = join(root, "sessions");
    const runtime = join(root, "runtime");
    const pkg = join(agent, "extensions", "invoke-agent");
    await writeManifest(pkg, invokeAgentManifest());
    await mkdir(join(pkg, "agent", "skills"), { recursive: true });
    await writeFile(join(pkg, "agent", "index.js"), "export default () => {};\n");
    await writeFile(join(pkg, "agent", "skills", "SKILL.md"), "# skill\n");
    await seedSession(cwd, sessions);
    const settingsLog = join(root, "settings.log");
    const invokeLog = join(root, "invoke.log");
    const capture: { args?: string[]; env?: NodeJS.ProcessEnv } = {};
    const backend = backendFor({
      agent,
      sessions,
      runtime,
      timeoutMs: 80,
      capture,
      env: { FAKE_PI_SETTINGS_LOG: settingsLog, FAKE_PI_INVOKE_LOG: invokeLog, ...(missingCommand ? { FAKE_PI_NO_INVOKE_COMMAND: "1" } : {}) },
    });
    await backend.handle("listExtensions" as never, []);
    await backend.handle("setExtensionEnabled" as never, ["invoke-agent", true, "app"]);
    await backend.handle("updateExtensionSettings" as never, [
      "invoke-agent",
      { "ext.invoke-agent.flag": true },
    ]);
    await backend.handle("addProject", [cwd]);
    await backend.handle("sendPrompt", ["session-1", "go"]);
    const spawnedUntil = Date.now() + 3000;
    while (!capture.args && Date.now() < spawnedUntil) await new Promise((r) => setTimeout(r, 20));

    const agentIndex = capture.args?.findIndex((arg, i) => arg === "-e" && capture.args?.[i + 1]?.endsWith("invoke-agent/agent/index.js"));
    expect(agentIndex).toBeGreaterThanOrEqual(0);
    expect(capture.env?.[extensionSettingsEnvName("invoke-agent")]).toBe(
      JSON.stringify({ "ext.invoke-agent.flag": true }),
    );
    expect(capture.env?.PIPIUI_SKILL_ROOTS?.split(":").some((p) => p.endsWith("agent/skills"))).toBe(true);

    const happy = (await backend.handle("invokeExtension" as never, [
      "invoke-agent",
      "ping",
      { n: 7 },
      { sessionId: "session-1" },
    ])) as ExtResult;
    if (missingCommand) {
      expect(happy).toMatchObject({ ok: false, error: { code: "agent_error", message: "extension command /invoke-agent is not registered" } });
      expect(await readFile(invokeLog, "utf8").catch(() => "")).toBe("");
      await backend.close();
      return;
    }
    expect(happy).toEqual({ ok: true, data: undefined });
    const wire = JSON.parse((await readFile(invokeLog, "utf8")).trim());
    expect(wire).toEqual({
      id: expect.any(String),
      type: "prompt",
      message: '/invoke-agent {"method":"ping","params":{"n":7}}',
    });

    const failedHandler = await backend.handle("invokeExtension" as never, [
      "invoke-agent", "fail", {}, { sessionId: "session-1" },
    ]);
    expect(failedHandler).toEqual({ ok: true, data: undefined });

    const timed = (await backend.handle("invokeExtension" as never, [
      "invoke-agent",
      "hang",
      {},
      { sessionId: "session-1" },
    ])) as ExtResult;
    expect(timed).toMatchObject({ ok: false, error: { code: "timeout" } });

    await backend.handle("updateExtensionSettings" as never, [
      "invoke-agent",
      { "ext.invoke-agent.flag": false },
    ]);
    const deadline = Date.now() + 1000;
    let settingsText = "";
    while (Date.now() < deadline) {
      settingsText = await readFile(settingsLog, "utf8").catch(() => "");
      if (settingsText.includes("ext.settings_changed")) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(settingsText).toContain("ext.settings_changed");
    expect(settingsText).toContain("invoke-agent");
    await backend.close();
  });

  it.each([true, false])("isolates project invoke routing and rejects cross-project sessions (A live=%s)", async (startA) => {
    root = await mkdtemp(join(tmpdir(), "pipi-ext-invoke-project-"));
    const agent = join(root, "agent");
    const sessions = join(root, "sessions");
    const a = join(root, "project-a");
    const b = join(root, "project-b");
    for (const [cwd, sessionId] of [[a, "session-a"], [b, "session-b"]]) {
      await seedSession(cwd, sessions, sessionId);
      const pkg = join(cwd, ".pi", "agent", "extensions", "invoke-agent");
      await writeManifest(pkg, invokeAgentManifest());
      await mkdir(join(pkg, "agent"), { recursive: true });
      await writeFile(join(pkg, "agent", "index.js"), "export default () => {};\n");
    }
    const backend = backendFor({ agent, sessions, runtime: join(root, "runtime"), logInvokeByCwd: true });
    try {
      const pa = await backend.handle("addProject", [a]) as { id: string };
      const pb = await backend.handle("addProject", [b]) as { id: string };
      for (const project of [pa, pb]) {
        await backend.handle("listExtensions" as never, [project.id]);
        await backend.handle("setExtensionEnabled" as never, ["invoke-agent", true, "project", project.id]);
      }
      if (startA) await backend.handle("sendPrompt", ["session-a", "go"]);
      await backend.handle("sendPrompt", ["session-b", "go"]);
      const invoke = (opts?: unknown) => backend.handle("invokeExtension" as never, ["invoke-agent", "ping", {}, opts]);
      const lines = async (cwd: string) => (await readFile(join(cwd, "invoke.log"), "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
      // B is the last live session and last scanned project, but A owns this request.
      expect(await invoke({ projectId: pa.id })).toMatchObject(startA ? { ok: true } : { ok: false, error: { code: "no_session" } });
      expect(await lines(a)).toHaveLength(startA ? 1 : 0);
      expect(await lines(b)).toHaveLength(0);
      expect(await invoke({ projectId: pa.id, sessionId: "session-b" })).toMatchObject({ ok: false, error: { code: "no_session" } });
      expect(await invoke({ projectId: pb.id })).toMatchObject({ ok: true });
      expect(await invoke()).toMatchObject({ ok: true }); // Legacy last-live routing.
      expect(await lines(b)).toHaveLength(2);

      // A's overlay must win even though scanning B most recently leaves B enabled.
      await backend.handle("setExtensionEnabled" as never, ["invoke-agent", false, "project", pa.id]);
      await backend.handle("listExtensions" as never, [pb.id]);
      expect(await invoke({ projectId: pa.id })).toMatchObject({ ok: false, error: { code: "disabled" } });
      await backend.handle("setExtensionEnabled" as never, ["invoke-agent", true, "project", pa.id]);
      // Same extension id, different project manifest capabilities.
      await writeManifest(join(a, ".pi", "agent", "extensions", "invoke-agent"), invokeAgentManifest({ capabilities: ["settings.read"] }));
      await backend.handle("listExtensions" as never, [pb.id]);
      expect(await invoke({ projectId: pa.id })).toMatchObject({ ok: false, error: { code: "capability_denied" } });
      expect(await lines(b)).toHaveLength(2);
    } finally {
      await backend.close();
    }
  });

  it("injects the host-managed Headroom endpoint without persisting it as user settings", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-ext-headroom-managed-"));
    const agent = join(root, "app-profile", "pi-agent");
    const cwd = join(root, "project");
    const sessions = join(root, "sessions");
    const runtime = join(root, "runtime");
    const pkg = join(runtime, "extensions", "pipiui-headroom");
    await writeManifest(pkg, {
      id: "pipiui-headroom",
      name: "PipiUI Headroom",
      version: "0.1.0",
      capabilities: ["settings.read", "settings.write"],
      agent: { extension: "agent/index.js" },
      app: {
        settings: {
          scope: "project",
          schema: { type: "object", properties: { "ext.pipiui-headroom.minResultChars": { type: "integer" } } },
        },
      },
      settingsVersion: 1,
    });
    await mkdir(join(pkg, "agent"), { recursive: true });
    await writeFile(join(pkg, "agent", "index.js"), "export default () => {};\n");
    await seedSession(cwd, sessions);
    const capture: { args?: string[]; env?: NodeJS.ProcessEnv } = {};
    const statePath = join(cwd, ".pi", "agent", "headroom", "service.json");
    const headroomRuntime: HeadroomManagedRuntimeLike = {
      settingsForProject: vi.fn(async () => ({
        [HEADROOM_MANAGED_SETTINGS.baseUrl]: "http://127.0.0.1:43126",
        [HEADROOM_MANAGED_SETTINGS.managed]: true,
        [HEADROOM_MANAGED_SETTINGS.state]: "ready",
        [HEADROOM_MANAGED_SETTINGS.statePath]: statePath,
        [HEADROOM_MANAGED_SETTINGS.engineVersion]: "0.45.0",
      })),
      prepare: vi.fn(async () => ({
        schemaVersion: 1,
        state: "ready",
        engineVersion: "0.45.0",
        baseUrl: "http://127.0.0.1:43126",
        statePath,
        updatedAt: new Date().toISOString(),
      })),
      stopProject: vi.fn(async () => undefined),
      stopAll: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const backend = backendFor({ agent, sessions, runtime, capture, headroomRuntime });
    await backend.handle("listExtensions" as never, []);
    await backend.handle("setExtensionEnabled" as never, ["pipiui-headroom", true, "app"]);
    await backend.handle("addProject", [cwd]);
    await backend.handle("sendPrompt", ["session-1", "go"]);
    await vi.waitFor(() => expect(capture.env?.[extensionSettingsEnvName("pipiui-headroom")]).toBeTruthy());

    const injected = JSON.parse(capture.env![extensionSettingsEnvName("pipiui-headroom")]!);
    expect(injected).toMatchObject({
      [HEADROOM_MANAGED_SETTINGS.baseUrl]: "http://127.0.0.1:43126",
      [HEADROOM_MANAGED_SETTINGS.managed]: true,
      [HEADROOM_MANAGED_SETTINGS.statePath]: statePath,
    });
    expect(headroomRuntime.settingsForProject).toHaveBeenCalledWith(cwd);
    const projectSettings = await readFile(join(cwd, ".pi", "agent", "ext-settings", "pipiui-headroom.json"), "utf8").catch(() => "");
    expect(projectSettings).not.toContain("43126");
    await backend.close();
    expect(headroomRuntime.close).toHaveBeenCalledTimes(1);
  });
});
