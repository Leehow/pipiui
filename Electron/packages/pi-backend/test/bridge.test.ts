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
    onVaultAction: async (event, sessionId) => { received.push({ channel: "vault", sessionId, payload: event }); return { secrets: [{ id: "1", name: "demo", envName: "DEMO_TOKEN" }], mounts: [], sessionId } },
    onStructuredOutput: async (event, sessionId) => {
      received.push({ channel: "structured_output", sessionId, payload: event });
      if (event.op !== "take") throw new Error("unsupported structured_output op");
      return sessionId === "session-1" ? { name: "flag", schema: { type: "object" }, strict: true } : null;
    },
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

  it("takes structured output only for the capability-mapped session", async () => {
    const { port, received, bridge } = await started();
    const capability = bridge.register("session-1");
    const other = bridge.register("session-2");
    const first = await post(port, {
      schemaVersion: 1,
      sessionCapability: capability,
      action: "structured_output",
      event: { op: "take", sessionId: "forged" },
    });
    expect(await first.json()).toEqual({
      ok: true,
      result: { name: "flag", schema: { type: "object" }, strict: true },
    });
    expect(received.at(-1)).toEqual({
      channel: "structured_output",
      sessionId: "session-1",
      payload: { op: "take", sessionId: "forged" },
    });
    const second = await post(port, {
      schemaVersion: 1,
      sessionCapability: other,
      action: "structured_output",
      event: { op: "take" },
    });
    expect(await second.json()).toEqual({ ok: true, result: null });
    expect((await post(port, {
      schemaVersion: 1,
      sessionCapability: "forged",
      action: "structured_output",
      event: { op: "take" },
    })).status).toBe(403);
  });

  it("lists open documents only for the capability-mapped session", async () => {
    const received: Received[] = [];
    bridge = new HostBridge({
      onAgentEvent: () => undefined,
      onDocumentsList: async (sessionId) => {
        received.push({ channel: "documents", sessionId, payload: {} });
        return {
          documents: sessionId === "session-1"
            ? [{ name: "notes.md", kind: "markdown", path: "/abs/notes.md", size: 4 }]
            : [],
        };
      },
    });
    const port = await bridge.listen();
    const capability = bridge.register("session-1");
    const other = bridge.register("session-2");
    const first = await post(port, {
      schemaVersion: 1,
      sessionCapability: capability,
      action: "documents_list",
      event: { sessionId: "forged" },
    });
    expect(await first.json()).toEqual({
      ok: true,
      result: { documents: [{ name: "notes.md", kind: "markdown", path: "/abs/notes.md", size: 4 }] },
    });
    expect(received.at(-1)).toEqual({ channel: "documents", sessionId: "session-1", payload: {} });
    const second = await post(port, {
      schemaVersion: 1,
      sessionCapability: other,
      action: "documents_list",
      event: {},
    });
    expect(await second.json()).toEqual({ ok: true, result: { documents: [] } });
    expect((await post(port, {
      schemaVersion: 1,
      sessionCapability: "forged",
      action: "documents_list",
      event: {},
    })).status).toBe(403);
  });

  it("routes vault actions to existing host methods without echoing values", async () => {
    const { port, received, bridge } = await started();
    const capability = bridge.register("session-1");
    const response = await post(port, {
      schemaVersion: 1,
      sessionCapability: capability,
      action: "vault_action",
      event: { method: "listSecretVault", params: ["forged"] },
    });
    expect(await response.json()).toEqual({
      ok: true,
      result: { secrets: [{ id: "1", name: "demo", envName: "DEMO_TOKEN" }], mounts: [], sessionId: "session-1" },
    });
    expect(JSON.stringify(received.at(-1))).not.toMatch(/sk-|ghp_|password=/i);
    expect(received.at(-1)).toEqual({
      channel: "vault",
      sessionId: "session-1",
      payload: { method: "listSecretVault", params: ["forged"] },
    });
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

describe("HostBridge model_pin_validate", () => {
  const ALLOW = { schemaVersion: 1, decision: "allow", authorityRevision: 17 };
  async function pinBridge(handler?: ConstructorParameters<typeof HostBridge>[0]["onModelPinValidate"]) {
    bridge = new HostBridge({
      onAgentEvent: () => {},
      ...(handler ? { onModelPinValidate: handler } : {}),
    });
    const port = await bridge.listen();
    return { port, capability: bridge.register("session-1") };
  }
  const postPins = (port: number, capability: unknown, refs: string[], action = "model_pin_validate") =>
    post(port, { schemaVersion: 1, sessionCapability: capability, action, event: { schemaVersion: 1, refs } });

  it("returns the handler decision verbatim; the batch shares one synchronous read", async () => {
    let calls = 0;
    const { port, capability } = await pinBridge((input) => {
      calls += 1;
      expect(Object.keys(input).sort()).toEqual(["refs"]);
      if (input.refs.includes("prov/gone")) {
        return { schemaVersion: 1, decision: "deny", code: "model_unavailable", invalidIndex: input.refs.indexOf("prov/gone"), authorityRevision: 42, retryable: false };
      }
      return { schemaVersion: 1, decision: "allow", authorityRevision: 42 };
    });
    const allowed = await postPins(port, capability, ["prov/a", "prov/b"]);
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ schemaVersion: 1, decision: "allow", authorityRevision: 42 });
    const denied = await postPins(port, capability, ["prov/a", "prov/gone"]);
    expect(await denied.json()).toMatchObject({ decision: "deny", code: "model_unavailable", invalidIndex: 1 });
    expect(calls).toBe(2);
  });

  it("denies fail-closed when the host has no pin surface at all", async () => {
    const { port, capability } = await pinBridge();
    const response = await postPins(port, capability, ["prov/a"]);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ decision: "deny", code: "catalog_unavailable", retryable: true });
  });

  it("never authorizes pins through a forged/rotated capability and rejects malformed batches with 400", async () => {
    const { port, capability } = await pinBridge(() => {
      throw new Error("must not be called for unauthorized callers");
    });
    // Forged, missing, rotated (re-register invalidates the old one) — identical 403.
    await expect(postPins(port, "forged", ["prov/a"])).resolves.toMatchObject({ status: 403 });
    const bare = await fetch(`http://127.0.0.1:${port}/rpc`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ schemaVersion: 1, action: "model_pin_validate", event: { schemaVersion: 1, refs: ["prov/a"] } }) });
    expect(bare.status).toBe(403);
    bridge!.register("session-1");
    expect((await postPins(port, capability, ["prov/a"])).status).toBe(403);

    // Re-arm a valid capability for malformed-body checks against a permissive handler.
    bridge = new HostBridge({ onAgentEvent: () => {}, onModelPinValidate: () => ALLOW });
    const port2 = await bridge.listen();
    const cap2 = bridge.register("session-1");
    for (const badEvent of [
      {}, // no refs key at all
      { refs: "prov/a" },
      { refs: [42] },
      { refs: [Array(1001).fill("prov/x")].flat() },
      { refs: [`prov/${"x".repeat(301)}`] },
    ]) {
      const response = await post(port2, { schemaVersion: 1, sessionCapability: cap2, action: "model_pin_validate", event: badEvent });
      expect(response.status).toBe(400);
    }
    // Over-limit batch is refused BEFORE the handler sees it.
    const huge = Array.from({ length: 1001 }, (_, i) => `prov/m${i}`);
    expect((await postPins(port2, cap2, huge)).status).toBe(400);
    // Exactly at the limit passes.
    expect((await postPins(port2, cap2, huge.slice(0, 1000))).status).toBe(200);
  });

  it("sanitizes handler faults into the same stable catalog_unavailable deny", async () => {
    const { port, capability } = await pinBridge(() => {
      throw new Error("apiKey=SECRET baseUrl=https://internal.example expires=soon");
    });
    const response = await postPins(port, capability, ["prov/a"]);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ schemaVersion: 1, decision: "deny", code: "catalog_unavailable", authorityRevision: -1, retryable: true });
    expect(JSON.stringify(body)).not.toContain("SECRET");
    expect(JSON.stringify(body)).not.toContain("internal.example");
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
