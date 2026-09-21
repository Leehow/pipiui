import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostBridge, type BridgeHandlers } from "../src/bridge.js";
import { handleExtState } from "../src/extension-channels.js";
import { createExtensionRegistry, writeProjectExtensionEnabled } from "../src/extension-registry.js";
import { createPiHostBackend } from "../src/index.js";
import { projectPiAgentDir } from "../src/project-pi-home.js";

let bridge: HostBridge | undefined;
let backend: ReturnType<typeof createPiHostBackend> | undefined;
let root = "";
afterEach(async () => {
  if (backend) {
    (backend as any).live.clear();
    await backend.close();
    backend = undefined;
  }
  await bridge?.close();
  bridge = undefined;
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

function registryFixture() {
  return createExtensionRegistry([{
    id: "state-probe", name: "State probe", version: "1.0.0", origin: "builtin",
    defaultEnabled: false, capabilities: [],
  }]);
}
const envelope = (sessionCapability: string, extra: Record<string, unknown> = {}) => ({
  schemaVersion: 1, sessionCapability, action: "ext.state", extensionId: "state-probe", ...extra,
});
const post = (port: number, body: unknown) => fetch(`http://127.0.0.1:${port}/rpc`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
async function start(onExtState?: BridgeHandlers["onExtState"]) {
  bridge = new HostBridge({ onAgentEvent: () => undefined, onExtState });
  return { port: await bridge.listen(), capability: bridge.register("session-one") };
}
const unavailable = { schemaVersion: 1, ok: false, error: "extension state unavailable", errorCode: "unavailable" };

describe("ext.state HTTP contract", () => {
  it("rejects missing, forged, rotated and revoked capabilities and unsupported schemas", async () => {
    const handler = vi.fn();
    const { port, capability } = await start(handler);
    for (const extra of [{ sessionCapability: undefined }, { sessionCapability: "forged" }, { schemaVersion: 2 }, { schemaVersion: undefined }]) {
      expect((await post(port, envelope(capability, extra))).status).toBe(403);
    }
    const rotated = bridge!.register("session-one");
    expect((await post(port, envelope(capability))).status).toBe(403);
    bridge!.unregister("session-one");
    expect((await post(port, envelope(rotated))).status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("validates the extension id without requiring an event", async () => {
    const handler = vi.fn();
    const { port, capability } = await start(handler);
    for (const extensionId of [undefined, null, 7, "", " "]) {
      expect((await post(port, envelope(capability, { extensionId }))).status).toBe(400);
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it("fails closed with a stable 503 when the handler is absent", async () => {
    const { port, capability } = await start();
    const response = await post(port, envelope(capability));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(unavailable);
  });

  it.each([false, true])("sanitizes synchronous/asynchronous handler faults (async=%s)", async (asyncFault) => {
    const fault = () => { throw new Error("secret-internal-error"); };
    const { port, capability } = await start(asyncFault ? async () => fault() : fault);
    const response = await post(port, envelope(capability));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(unavailable);
  });

  it("uses only capability routing and only returns lifecycle fields", async () => {
    const handler = vi.fn(() => ({
      schemaVersion: 1 as const, ok: true as const, enabled: true, mounted: true, state: "enabled" as const,
      settings: { token: "do-not-expose" },
    }));
    const { port, capability } = await start(handler);
    const response = await post(port, envelope(capability, { sessionId: "other-session", projectId: "other-project", projectRoot: "/other" }));
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith({ extensionId: "state-probe" }, "session-one");
    expect(await response.json()).toEqual({ schemaVersion: 1, ok: true, enabled: true, mounted: true, state: "enabled" });
  });

  it("allows a disabled mounted extension with no bridge.emit grant, but rejects unmounted ids", async () => {
    const registry = registryFixture();
    registry.mountSession("session-one", ["state-probe"]);
    const { port, capability } = await start((input, sessionId) => handleExtState(registry, input, sessionId, { "state-probe": false }));
    const response = await post(port, envelope(capability));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ schemaVersion: 1, ok: true, enabled: false, mounted: true, state: "disabled" });
    for (const extensionId of ["other-extension", "unknown-id"]) {
      expect((await post(port, envelope(capability, { extensionId }))).status).toBe(403);
    }
    registry.unmountSession("session-one");
    expect((await post(port, envelope(capability))).status).toBe(403);
  });

  it("reports error and unavailable as non-enabled without leaking diagnostics", async () => {
    const registry = registryFixture();
    registry.mountSession("session-one", ["state-probe"]);
    registry.enterError("state-probe", "private diagnostic");
    const { port, capability } = await start((input, sessionId) => handleExtState(registry, input, sessionId, { "state-probe": true }));
    expect(await (await post(port, envelope(capability))).json()).toEqual({ schemaVersion: 1, ok: true, enabled: false, mounted: true, state: "error" });
    registry.unload("state-probe");
    expect(await (await post(port, envelope(capability))).json()).toEqual({ schemaVersion: 1, ok: true, enabled: false, mounted: true, state: "unavailable" });
  });
});

describe("backend authoritative project extension state", () => {
  async function setup() {
    root = await mkdtemp(join(tmpdir(), "pipi-ext-state-"));
    const agent = join(root, "agent");
    const projectA = join(root, "project-a"), projectB = join(root, "project-b");
    await Promise.all([agent, projectA, projectB].map((path) => mkdir(path, { recursive: true })));
    const registry = registryFixture();
    registry.disable("state-probe");
    backend = createPiHostBackend({
      agentDir: agent, runtimeRoot: join(root, "runtime"), extensionRegistry: registry,
      canonicalProjectPaths: async () => undefined, profileMode: "default",
    });
    const internals = backend as any;
    // Deliberately disagree with cwd: the owning project root must win.
    internals.live.set("session-a", { projectRoot: projectA, cwd: projectB });
    internals.live.set("session-b", { projectRoot: projectB, cwd: projectA });
    registry.mountSession("session-a", ["state-probe"]);
    registry.mountSession("session-b", ["state-probe"]);
    await writeProjectExtensionEnabled(projectPiAgentDir(projectA), "state-probe", true);
    await writeProjectExtensionEnabled(projectPiAgentDir(projectB), "state-probe", false);
    const host = internals.bridge as HostBridge;
    return { internals, registry, projectA, projectB, host, port: await host.listen(), capA: host.register("session-a"), capB: host.register("session-b") };
  }

  it("keeps two project overlays independent and sees live disable/re-enable, not registry defaults", async () => {
    const { registry, projectA, projectB, port, capA, capB } = await setup();
    expect(registry.get("state-probe")?.state).toBe("disabled");
    const query = async (capability: string, extra = {}) => {
      const response = await post(port, envelope(capability, extra));
      expect(response.status).toBe(200);
      return response.json();
    };
    const [a, b] = await Promise.all([
      query(capA, { sessionId: "session-b", projectRoot: projectB }),
      query(capB, { sessionId: "session-a", projectRoot: projectA }),
    ]);
    expect(a).toEqual({ schemaVersion: 1, ok: true, enabled: true, mounted: true, state: "enabled" });
    expect(b).toEqual({ schemaVersion: 1, ok: true, enabled: false, mounted: true, state: "disabled" });
    await writeProjectExtensionEnabled(projectPiAgentDir(projectA), "state-probe", false);
    expect(await query(capA)).toMatchObject({ enabled: false, mounted: true, state: "disabled" });
    await writeProjectExtensionEnabled(projectPiAgentDir(projectB), "state-probe", true);
    expect(await query(capB)).toMatchObject({ enabled: true, state: "enabled" });
    expect(await query(capA)).toMatchObject({ enabled: false, state: "disabled" });
  });

  it("rejects dead/rootless/unmounted sessions before reading overlays; cwd is only a fallback", async () => {
    const { internals, registry, projectA, host, port, capA } = await setup();
    const overlay = vi.spyOn(internals, "mergedExtensionOverlay");
    internals.live.set("rootless", {});
    registry.mountSession("rootless", ["state-probe"]);
    for (const sessionId of ["missing", "rootless"]) {
      expect((await post(port, envelope(host.register(sessionId), { projectRoot: projectA }))).status).toBe(403);
    }
    expect((await post(port, envelope(capA, { extensionId: "unmounted" }))).status).toBe(403);
    expect(overlay).not.toHaveBeenCalled();
    internals.live.set("fallback", { cwd: projectA });
    registry.mountSession("fallback", ["state-probe"]);
    expect(await (await post(port, envelope(host.register("fallback")))).json()).toMatchObject({ enabled: true });
    internals.live.delete("session-a");
    expect((await post(port, envelope(capA))).status).toBe(403);
  });

  it("fails closed when authoritative overlay reads fail", async () => {
    const { internals, port, capA } = await setup();
    vi.spyOn(internals, "mergedExtensionOverlay").mockRejectedValue(new Error("private settings error"));
    const response = await post(port, envelope(capA));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(unavailable);
  });
});
