import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIPI_HOST_PROTOCOL_VERSION, type HostEvent } from "@pipi/host-api";
import { HostBridge } from "../src/bridge.js";
import { handleExtEmit, toolResultDetailsField } from "../src/extension-channels.js";
import { createExtensionRegistry, type ExtensionDescriptor } from "../src/extension-registry.js";
import { projectExtensionSettingsPath } from "../src/extension-settings.js";
import { listSecretMeta, resetInMemoryVault } from "../src/secret-vault.js";
import { createPiHostBackend } from "../src/index.js";
import { projectPiAgentDir } from "../src/project-pi-home.js";

let root = "";
let bridge: HostBridge | undefined;

afterEach(async () => {
  await bridge?.close();
  bridge = undefined;
  resetInMemoryVault();
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

const quotaApp = (): ExtensionDescriptor => ({
  id: "quota",
  name: "Quota",
  version: "1.0.0",
  origin: "app",
  defaultEnabled: true,
  capabilities: ["bridge.emit"],
  settings: {
    scope: "app",
    settingsVersion: 1,
    schema: {
      type: "object",
      properties: {
        "ext.quota.threshold": { type: "number" },
        "ext.quota.token": { type: "string", format: "secret" },
      },
    },
  },
});

const quotaProject = (): ExtensionDescriptor => ({
  ...quotaApp(),
  id: "quotap",
  settings: {
    scope: "project",
    settingsVersion: 1,
    schema: {
      type: "object",
      properties: {
        "ext.quotap.threshold": { type: "number" },
        "ext.quotap.token": { type: "string", format: "secret" },
      },
    },
  },
});

const post = (port: number, body: unknown) =>
  fetch(`http://127.0.0.1:${port}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("ext.emit HostBridge seam", () => {
  async function started(registry = createExtensionRegistry([])) {
    const events: HostEvent[] = [];
    bridge = new HostBridge({
      onAgentEvent: () => undefined,
      onExtEmit: (input, sessionId) => {
        const result = handleExtEmit(registry, input, sessionId);
        if (!result.ok) return result;
        events.push(result.event);
        return { ok: true };
      },
    });
    const port = await bridge.listen();
    return { port, events, bridge: bridge!, registry };
  }

  it("rejects a missing sessionCapability identically to other actions", async () => {
    const { port, events, registry } = await started();
    registry.ingest(quotaApp());
    registry.mountSession("session-1", ["quota"]);
    const response = await post(port, {
      schemaVersion: 1,
      action: "ext.emit",
      extensionId: "quota",
      event: "warning",
      payload: { used: 92 },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: "unauthorized bridge capability" });
    expect(events).toEqual([]);
  });

  it("rejects emit when the session has not mounted the extension", async () => {
    const { port, events, bridge, registry } = await started();
    registry.ingest(quotaApp());
    const capability = bridge.register("session-1");
    const response = await post(port, {
      schemaVersion: 1,
      sessionCapability: capability,
      action: "ext.emit",
      extensionId: "quota",
      event: "warning",
      payload: { used: 92 },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ ok: false, errorCode: "capability_denied", error: "extension not mounted" });
    expect(events).toEqual([]);
  });

  it("rejects emit when bridge.emit was not declared", async () => {
    const { port, events, bridge, registry } = await started();
    registry.ingest({ ...quotaApp(), capabilities: [] });
    registry.mountSession("session-1", ["quota"]);
    const capability = bridge.register("session-1");
    const response = await post(port, {
      schemaVersion: 1,
      sessionCapability: capability,
      action: "ext.emit",
      extensionId: "quota",
      event: "warning",
      payload: { used: 92 },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ ok: false, errorCode: "capability_denied" });
    expect(events).toEqual([]);
  });

  it("emits HostEvent on channel ext.<id> after auth", async () => {
    const { port, events, bridge, registry } = await started();
    registry.ingest(quotaApp());
    registry.mountSession("session-1", ["quota"]);
    const capability = bridge.register("session-1");
    const response = await post(port, {
      schemaVersion: 1,
      sessionCapability: capability,
      action: "ext.emit",
      extensionId: "quota",
      event: "warning",
      payload: { used: 92 },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(events).toEqual([
      {
        protocolVersion: PIPI_HOST_PROTOCOL_VERSION,
        channel: "ext.quota",
        event: { type: "warning", payload: { used: 92 } },
      },
    ]);
  });

  it("does not mix ext.<id> into other sessions or extensions", async () => {
    const registry = createExtensionRegistry([]);
    registry.ingest(quotaApp());
    registry.mountSession("session-1", ["quota"]);
    const result = handleExtEmit(
      registry,
      { extensionId: "quota", event: "warning", payload: { used: 92 } },
      "session-1",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.channel).toBe("ext.quota");
      expect(result.event.channel).not.toBe("agents");
    }
  });
});

describe("extension settings schema seam", () => {
  async function backendWith(descriptors: ExtensionDescriptor[]) {
    root = await mkdtemp(join(tmpdir(), "pipi-ext-settings-"));
    const agent = join(root, "agent");
    await mkdir(agent, { recursive: true });
    const registry = createExtensionRegistry([]);
    for (const descriptor of descriptors) registry.ingest(descriptor);
    const backend = createPiHostBackend({
      agentDir: agent,
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
      extensionRegistry: registry,
      vaultDir: agent,
    });
    return { backend, agent };
  }

  it("accepts schema keys and rejects unknown keys", async () => {
    const { backend } = await backendWith([quotaApp()]);
    const accepted = (await backend.handle("updateExtensionSettings" as never, [
      "quota",
      { "ext.quota.threshold": 80 },
    ])) as { ok: boolean; data?: Record<string, unknown> };
    expect(accepted).toEqual({ ok: true, data: { "ext.quota.threshold": 80 } });
    const got = (await backend.handle("getExtensionSettings" as never, ["quota"])) as Record<string, unknown>;
    expect(got).toEqual({ "ext.quota.threshold": 80 });
    const rejected = (await backend.handle("updateExtensionSettings" as never, [
      "quota",
      { "ext.quota.unknown": 1 },
    ])) as { ok: boolean; error?: { code: string } };
    expect(rejected.ok).toBe(false);
    expect(rejected.error?.code).toBe("capability_denied");
    await backend.close();
  });

  it("routes format:secret to the vault and never writes it to settings JSON", async () => {
    const { backend, agent } = await backendWith([quotaApp()]);
    const secret = "s3cret-token-value";
    const updated = (await backend.handle("updateExtensionSettings" as never, [
      "quota",
      { "ext.quota.threshold": 90, "ext.quota.token": secret },
    ])) as { ok: boolean; data?: Record<string, unknown> };
    expect(updated.ok).toBe(true);
    expect(updated.data).toEqual({ "ext.quota.threshold": 90 });
    const settings = JSON.parse(await readFile(join(agent, "pipiui-settings.json"), "utf8"));
    expect(JSON.stringify(settings)).not.toContain(secret);
    expect(settings.extensions.quota.settings).toEqual({ "ext.quota.threshold": 90 });
    expect(listSecretMeta(agent)).toEqual([expect.objectContaining({ name: "ext.quota.token" })]);
    const got = (await backend.handle("getExtensionSettings" as never, ["quota"])) as Record<string, unknown>;
    expect(got).toEqual({ "ext.quota.threshold": 90 });
    expect(JSON.stringify(got)).not.toContain(secret);
    await backend.close();
  });

  it("writes project-scoped settings next to ext-enabled.json", async () => {
    const { backend } = await backendWith([quotaProject()]);
    const project = join(root, "repo");
    await mkdir(project, { recursive: true });
    const added = (await backend.handle("addProject", [project])) as { id: string };
    const updated = (await backend.handle("updateExtensionSettings" as never, [
      "quotap",
      { "ext.quotap.threshold": 12 },
      added.id,
    ])) as { ok: boolean; data?: Record<string, unknown> };
    expect(updated).toEqual({ ok: true, data: { "ext.quotap.threshold": 12 } });
    const disk = JSON.parse(await readFile(projectExtensionSettingsPath(projectPiAgentDir(project), "quotap"), "utf8"));
    expect(disk.settings).toEqual({ "ext.quotap.threshold": 12 });
    expect(JSON.stringify(disk)).not.toContain("token");
    await backend.close();
  });
});

describe("tool_result details projection", () => {
  it("projects tool_execution_end.result onto details when present", () => {
    expect(toolResultDetailsField(undefined)).toEqual({});
    expect(toolResultDetailsField({ kind: "quota", used: 1200, limit: 1500 })).toEqual({
      details: { kind: "quota", used: 1200, limit: 1500 },
    });
    const mapped = {
      type: "tool_result" as const,
      sessionId: "s",
      toolCallId: "t",
      content: "ok",
      ...toolResultDetailsField({ content: "ok", kind: "quota" }),
    };
    expect(mapped).toMatchObject({ type: "tool_result", details: { content: "ok", kind: "quota" } });
  });
});
