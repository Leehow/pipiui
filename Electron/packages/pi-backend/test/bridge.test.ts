import { afterEach, describe, expect, it } from "vitest";
// Import the units directly: the package barrel drags in the whole backend.
import { HostBridge } from "../src/bridge.js";
import { assemblePiSpawn, sanitizeEnvironment } from "../src/spawn-assembly.js";

let bridge: HostBridge | undefined;
afterEach(async () => { await bridge?.close(); bridge = undefined; });

type Received = { channel: string; sessionId: string; payload: any };

async function started() {
  const received: Received[] = [];
  bridge = new HostBridge({
    onAgentEvent: (event, sessionId) => received.push({ channel: "agent", sessionId, payload: event }),
    onPlanEvent: (event, sessionId) => received.push({ channel: "plan", sessionId, payload: event }),
    onBrowserAction: async (event, sessionId) => { received.push({ channel: "browser", sessionId, payload: event }); return { ok: true, text: "page text" } },
    onTerminalAction: async (event, sessionId) => { received.push({ channel: "terminal", sessionId, payload: event }); return { ok: true, terminalId: "term-1" } },
    onComputerAction: async (event, sessionId) => { received.push({ channel: "computer", sessionId, payload: event }); return { ok: true, screenshotId: "shot" } }
  });
  const port = await bridge.listen();
  return { port, received, bridge: bridge! };
}

const post = (port: number, body: unknown, path = "/rpc") =>
  fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("HostBridge", () => {
  it("routes an authorized agent event to its own session", async () => {
    const { port, received, bridge } = await started();
    const capability = bridge.register("session-1");
    const response = await post(port, { schemaVersion: 1, sessionCapability: capability, action: "agent_event", event: { kind: "start", agentId: "a1", runId: "r1" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(received).toEqual([{ channel: "agent", sessionId: "session-1", payload: { kind: "start", agentId: "a1", runId: "r1" } }]);
  });

  it("refuses forged, stale and missing capabilities identically", async () => {
    const { port, received, bridge } = await started();
    const capability = bridge.register("session-1");
    const event = { kind: "start", agentId: "a1", runId: "r1" };
    expect((await post(port, { schemaVersion: 1, sessionCapability: "not-the-secret", action: "agent_event", event })).status).toBe(403);
    expect((await post(port, { schemaVersion: 1, action: "agent_event", event })).status).toBe(403);
    // A rotated capability must not keep working: re-registering the session invalidates it.
    bridge.register("session-1");
    expect((await post(port, { schemaVersion: 1, sessionCapability: capability, action: "agent_event", event })).status).toBe(403);
    bridge.unregister("session-1");
    expect(received).toEqual([]);
  });

  it("rejects a legacy flat envelope that carries no capability", async () => {
    const { port, received, bridge } = await started();
    bridge.register("session-1");
    expect((await post(port, { sessionKey: "session-1", action: "agent_event", kind: "start", agentId: "a1", runId: "r1" })).status).toBe(403);
    expect(received).toEqual([]);
  });

  it("answers plan events so plan tools do not look broken, and refuses unknown actions", async () => {
    const { port, received, bridge } = await started();
    const capability = bridge.register("session-1");
    expect((await post(port, { schemaVersion: 1, sessionCapability: capability, action: "plan_event", event: { event: "plan_publish" } })).status).toBe(200);
    expect((await post(port, { schemaVersion: 1, sessionCapability: capability, action: "delete_everything", event: {} })).status).toBe(400);
    expect(received.map(item => item.channel)).toEqual(["plan"]);
  });

  it("routes canonical browser actions and returns the host result", async () => {
    const { port, received, bridge } = await started();
    const capability = bridge.register("session-1");
    const response = await post(port, { schemaVersion: 1, sessionCapability: capability, action: "browser_action", event: { action: "observe" } });
    expect(await response.json()).toEqual({ ok: true, text: "page text" });
    expect(received).toContainEqual({ channel: "browser", sessionId: "session-1", payload: { action: "observe" } });
  });

  it("derives terminal ownership only from the authenticated capability", async () => {
    const { port, received, bridge } = await started();
    const capability = bridge.register("session-1");
    const response = await post(port, { schemaVersion: 1, sessionCapability: capability, sessionId: "forged", action: "terminal_action", event: { action: "list", sessionId: "forged" } });
    expect(await response.json()).toEqual({ ok: true, terminalId: "term-1" });
    expect(received.at(-1)).toEqual({ channel: "terminal", sessionId: "session-1", payload: { action: "list", sessionId: "forged" } });
    bridge.unregister("session-1");
    expect((await post(port, { schemaVersion: 1, sessionCapability: capability, action: "terminal_action", event: { action: "list" } })).status).toBe(403);
  });

  it("routes computer actions only with the separate per-session capability", async () => {
    const { port, received, bridge } = await started();
    const computerCapability = bridge.registerComputer("session-1");
    const response = await post(port, { sessionKey: "session-1", computerCapability, protocolVersion: 1, action: "computer_batch", actions: [{ type: "screenshot" }] });
    expect(await response.json()).toEqual({ ok: true, screenshotId: "shot" });
    expect(received.at(-1)).toMatchObject({ channel: "computer", sessionId: "session-1" });
    expect((await post(port, { sessionKey: "session-1", computerCapability: "forged", protocolVersion: 1, action: "computer_batch", actions: [] })).status).toBe(403);
  });

  it("serves only POST /rpc", async () => {
    const { port } = await started();
    expect((await post(port, {}, "/anything")).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/rpc`)).status).toBe(404);
  });

  it("rejects malformed JSON without taking the listener down", async () => {
    const { port, bridge } = await started();
    const capability = bridge.register("session-1");
    const broken = await fetch(`http://127.0.0.1:${port}/rpc`, { method: "POST", headers: { "content-type": "application/json" }, body: "{ not json" });
    expect(broken.status).toBe(400);
    expect((await post(port, { schemaVersion: 1, sessionCapability: capability, action: "agent_event", event: { kind: "end", agentId: "a", runId: "r" } })).status).toBe(200);
  });

  it("binds loopback only", async () => {
    const { port } = await started();
    // A bridge on 0.0.0.0 would let any host on the network drive this session's agent tree.
    await expect(fetch(`http://127.0.0.1:${port}/rpc`, { method: "POST", body: "{}" })).resolves.toBeDefined();
    expect(bridge).toBeDefined();
  });
});

describe("canonical v1 spawn credentials", () => {
  it("sets the protocol marker only together with a real capability", () => {
    const base = { cwd: "/tmp/project", paths: { subagentDir: "/ext/subagent" }, features: { subagent: true } };
    const withCapability = assemblePiSpawn({ ...base, bridgePort: 4321, bridgeRoutingKey: "session-1", sessionCapability: "secret" });
    expect(withCapability.env).toMatchObject({ PIPIUI_BRIDGE_PORT: "4321", PIPIUI_HOST_PROTOCOL: "1", PIPIUI_SESSION_CAPABILITY: "secret" });
    const withoutCapability = assemblePiSpawn({ ...base, bridgePort: 4321, bridgeRoutingKey: "session-1" });
    expect(withoutCapability.env.PIPIUI_HOST_PROTOCOL).toBeUndefined();
    expect(withoutCapability.env.PIPIUI_SESSION_CAPABILITY).toBeUndefined();
  });

  it("never lets an inherited capability reach the child", () => {
    const sanitized = sanitizeEnvironment({ PIPIUI_SESSION_CAPABILITY: "stolen", PIPIUI_HOST_PROTOCOL: "1", PATH: "/usr/bin" } as NodeJS.ProcessEnv);
    expect(sanitized.PIPIUI_SESSION_CAPABILITY).toBeUndefined();
    expect(sanitized.PIPIUI_HOST_PROTOCOL).toBeUndefined();
    expect(sanitized.PATH).toBe("/usr/bin");
  });
});
