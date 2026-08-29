import { afterEach, describe, expect, it } from "vitest";
// Import the units directly: the package barrel drags in the whole backend.
import { HostBridge } from "../src/bridge.js";
import { HostCapabilityBroker } from "../src/host-capability.js";
import { EXTENSION_HOST_API_VERSION, EXTENSION_PERMISSIONS } from "../src/extension-manifest.js";
import {
  HOST_CAPABILITY_PERMISSIONS,
  HOST_CAPABILITY_WIRE_VERSION,
  hostApiRangeSatisfies,
  negotiateHostApiVersion,
  type HostCapabilityRequestV1,
} from "@pipi/host-api";

let bridge: HostBridge | undefined;
afterEach(async () => {
  await bridge?.close();
  bridge = undefined;
});

const post = (port: number, body: unknown) =>
  fetch(`http://127.0.0.1:${port}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

type TestClock = { now: () => number; advance: (ms: number) => void };
function makeClock(start = 1_000_000): TestClock {
  let current = start;
  return { now: () => current, advance: (ms) => (current += ms) };
}

type DriverLog = { calls: Array<{ op: string; sessionId: string; params: Record<string, unknown> }> };
function makeDrivers() {
  const log: DriverLog = { calls: [] };
  return {
    log,
    drivers: {
      browser: {
        toolAction: async (sessionId: string, request: Record<string, unknown>) => {
          log.calls.push({ op: "browser.action", sessionId, params: request });
          return { ok: true, text: "page text" };
        },
        watchAction: async (sessionId: string, request: Record<string, unknown>) => {
          log.calls.push({ op: "browser.watch", sessionId, params: request });
          return { ok: true, watchId: "w1" };
        },
        disposeSession: async (sessionId: string) => {
          log.calls.push({ op: "browser.disposeSession", sessionId, params: {} });
        },
      },
      native: {
        handle: async (request: Record<string, unknown>) => {
          log.calls.push({ op: "native.cua", sessionId: "-", params: request });
          return { ok: true, screenshotId: "shot" };
        },
        usable: () => true,
      },
    },
  };
}

const ALLOWING_POLICY = {
  declaredPermissions: (extensionId: string) =>
    extensionId === "declared-ext"
      ? ["browser.session", "native.exec"]
      : extensionId === "browser-only-ext"
        ? ["browser.session"]
        : [],
  projectAllows: (extensionId: string, projectRoot: string) => projectRoot === "/proj/a" || extensionId === "declared-ext",
  // Desktop grant: only the capability minted for this test session passes.
  verifyDesktopGrant: ({ computerCapability }: { sessionId: string; computerCapability: string }) =>
    computerCapability === "grant-ok",
};

function makeRequest(overrides: Partial<HostCapabilityRequestV1> = {}): HostCapabilityRequestV1 {
  return {
    schemaVersion: HOST_CAPABILITY_WIRE_VERSION,
    extensionId: "declared-ext",
    hostApi: `>=${EXTENSION_HOST_API_VERSION} <2.0.0`,
    permission: "browser.session",
    projectRoot: "/proj/a",
    token: "",
    op: "browser.action",
    params: { action: "navigate", url: "https://example.com" },
    ...overrides,
  };
}

function makeBroker(options: { clock?: TestClock; policy?: typeof ALLOWING_POLICY } = {}) {
  const { drivers, log } = makeDrivers();
  const broker = new HostCapabilityBroker({
    drivers: drivers as never,
    policy: options.policy ?? ALLOWING_POLICY,
    now: options.clock?.now,
  });
  return { broker, log };
}

describe("host capability version handshake", () => {
  it("accepts the running host version inside a declared range", () => {
    const decision = negotiateHostApiVersion({
      hostVersion: EXTENSION_HOST_API_VERSION,
      requestedRange: `>=${EXTENSION_HOST_API_VERSION} <2.0.0`,
    });
    expect(decision).toEqual({
      schemaVersion: 1,
      ok: true,
      hostApiVersion: EXTENSION_HOST_API_VERSION,
      wireVersion: 1,
    });
  });

  it("rejects a range above the running host version (and malformed ranges fail closed)", () => {
    expect(negotiateHostApiVersion({ hostVersion: "1.0.0", requestedRange: ">=2.0.0" })).toEqual({
      schemaVersion: 1,
      ok: false,
      code: "host_api_mismatch",
      hostApiVersion: "1.0.0",
    });
    expect(hostApiRangeSatisfies("^1.0.0", "1.5.0")).toBe(true);
    expect(hostApiRangeSatisfies("~1.0.0", "1.0.5")).toBe(true);
    expect(hostApiRangeSatisfies("~1.0.0", "1.1.0")).toBe(false);
    expect(hostApiRangeSatisfies("not-a-range", "1.0.0")).toBe(false);
    expect(hostApiRangeSatisfies(">=1.0.0", "1.0")).toBe(false);
  });

  it("dispatch refuses a stale extension whose manifest targets a newer host API", async () => {
    const { broker, log } = makeBroker();
    const response = await broker.dispatch(
      // Placeholder token passes the shape gate: the version gate runs before redemption.
      makeRequest({ hostApi: ">=2.0.0", token: "placeholder" }),
      "session-1",
    );
    expect(response).toEqual({
      schemaVersion: 1,
      ok: false,
      code: "host_api_mismatch",
      error: expect.any(String),
      hostApiVersion: EXTENSION_HOST_API_VERSION,
    });
    expect(log.calls).toEqual([]);
  });
});

describe("host capability permission gates", () => {
  it("refuses a permission the extension manifest does not declare", async () => {
    const { broker, log } = makeBroker();
    const { token } = broker.issueToken({
      extensionId: "undeclared-ext",
      projectRoot: "/proj/a",
      permission: "browser.session",
    });
    const response = await broker.dispatch(
      makeRequest({ extensionId: "undeclared-ext", token }),
      "session-1",
    );
    expect(response.ok).toBe(false);
    expect(response.ok === false && response.code).toBe("permission_denied");
    expect(log.calls).toEqual([]);
  });

  it("refuses a permission the project has not granted, even when declared", async () => {
    const policy = {
      ...ALLOWING_POLICY,
      projectAllows: () => false,
    };
    const { broker, log } = makeBroker({ policy });
    const { token } = broker.issueToken({
      extensionId: "declared-ext",
      projectRoot: "/proj/locked",
      permission: "browser.session",
    });
    const response = await broker.dispatch(
      makeRequest({ projectRoot: "/proj/locked", token }),
      "session-1",
    );
    expect(response.ok === false && response.code).toBe("permission_denied");
    expect(log.calls).toEqual([]);
  });
});

describe("host capability wire shape", () => {
  it("pins the frozen contract constants", () => {
    expect(HOST_CAPABILITY_WIRE_VERSION).toBe(1);
    expect(EXTENSION_HOST_API_VERSION).toBe("1.0.0");
    // Drift pin: the transport enum must stay identical to the manifest enum.
    expect([...HOST_CAPABILITY_PERMISSIONS]).toEqual([...EXTENSION_PERMISSIONS]);
  });

  it("answers a wrong schemaVersion with the exact stable deny envelope", async () => {
    const { broker } = makeBroker();
    const response = await broker.dispatch(makeRequest({ schemaVersion: 2 as never }), "session-1");
    expect(response).toEqual({
      schemaVersion: 1,
      ok: false,
      code: "unsupported_wire",
      error: expect.any(String),
      hostApiVersion: EXTENSION_HOST_API_VERSION,
    });
    expect(Object.keys(response).sort()).toEqual(["code", "error", "hostApiVersion", "ok", "schemaVersion"]);
  });

  it("answers a routed call with the exact stable result envelope", async () => {
    const { broker } = makeBroker();
    const { token } = broker.issueToken({
      extensionId: "declared-ext",
      projectRoot: "/proj/a",
      permission: "browser.session",
    });
    const response = await broker.dispatch(makeRequest({ token }), "session-1");
    expect(response).toEqual({
      schemaVersion: 1,
      ok: true,
      result: { ok: true, text: "page text" },
      hostApiVersion: EXTENSION_HOST_API_VERSION,
    });
    expect(Object.keys(response).sort()).toEqual(["hostApiVersion", "ok", "result", "schemaVersion"]);
  });
});

describe("one-time capability tokens", () => {
  it("consumes a token on first use and refuses replay with token_consumed", async () => {
    const { broker, log } = makeBroker();
    const { token } = broker.issueToken({
      extensionId: "declared-ext",
      projectRoot: "/proj/a",
      permission: "browser.session",
    });
    const first = await broker.dispatch(makeRequest({ token }), "session-1");
    expect(first.ok).toBe(true);
    const replay = await broker.dispatch(makeRequest({ token }), "session-1");
    expect(replay.ok === false && replay.code).toBe("token_consumed");
    expect(log.calls).toHaveLength(1);
  });

  it("expires tokens past their TTL", async () => {
    const clock = makeClock();
    const { broker } = makeBroker({ clock });
    const { token } = broker.issueToken({
      extensionId: "declared-ext",
      projectRoot: "/proj/a",
      permission: "browser.session",
      ttlMs: 1_000,
    });
    clock.advance(1_001);
    const response = await broker.dispatch(makeRequest({ token }), "session-1");
    expect(response.ok === false && response.code).toBe("token_expired");
  });

  it("binds a token to its extension, project and permission context", async () => {
    const { broker } = makeBroker();
    const { token } = broker.issueToken({
      extensionId: "browser-only-ext",
      projectRoot: "/proj/a",
      permission: "browser.session",
    });
    const wrongPermission = broker.redeem(token, {
      extensionId: "browser-only-ext",
      projectRoot: "/proj/a",
      permission: "native.exec",
    });
    expect(wrongPermission).toEqual({ ok: false, code: "token_invalid", error: expect.any(String) });
    const wrongProject = broker.redeem(token, {
      extensionId: "browser-only-ext",
      projectRoot: "/proj/b",
      permission: "browser.session",
    });
    expect(wrongProject.ok === false && wrongProject.code).toBe("token_invalid");
    const wrongExtension = broker.redeem(token, {
      extensionId: "declared-ext",
      projectRoot: "/proj/a",
      permission: "browser.session",
    });
    expect(wrongExtension.ok === false && wrongExtension.code).toBe("token_invalid");
  });

  it("refuses unknown and missing tokens without touching a driver", async () => {
    const { broker, log } = makeBroker();
    const unknown = await broker.dispatch(makeRequest({ token: "forged-token" }), "session-1");
    expect(unknown.ok === false && unknown.code).toBe("token_invalid");
    const missing = await broker.dispatch(makeRequest({ token: "" }), "session-1");
    expect(missing.ok === false && missing.code).toBe("token_required");
    expect(log.calls).toEqual([]);
  });
});

describe("driver routing", () => {
  it("routes browser.session lifecycle ops to the browser driver with the bridge session id", async () => {
    const { broker, log } = makeBroker();
    const issue = () =>
      broker.issueToken({ extensionId: "declared-ext", projectRoot: "/proj/a", permission: "browser.session" });
    await broker.dispatch(makeRequest({ token: issue().token, op: "browser.action" }), "session-1");
    await broker.dispatch(makeRequest({ token: issue().token, op: "browser.watch", params: { watchId: "w1" } }), "session-1");
    await broker.dispatch(makeRequest({ token: issue().token, op: "browser.disposeSession", params: {} }), "session-2");
    expect(log.calls.map((call) => ({ op: call.op, sessionId: call.sessionId }))).toEqual([
      { op: "browser.action", sessionId: "session-1" },
      { op: "browser.watch", sessionId: "session-1" },
      { op: "browser.disposeSession", sessionId: "session-2" },
    ]);
  });

  it("routes native.cua to the CUA driver and denies when unusable", async () => {
    const { broker, log } = makeBroker();
    const { token } = broker.issueToken({
      extensionId: "declared-ext",
      projectRoot: "/proj/a",
      permission: "native.exec",
    });
    const response = await broker.dispatch(
      makeRequest({
        token,
        permission: "native.exec",
        op: "native.cua",
        params: { action: "computer_open_application", sessionKey: "session-1", computerCapability: "grant-ok" },
      }),
      "session-1",
    );
    expect(response).toEqual({
      schemaVersion: 1,
      ok: true,
      result: { ok: true, screenshotId: "shot" },
      hostApiVersion: EXTENSION_HOST_API_VERSION,
    });
    expect(log.calls[0]).toMatchObject({ op: "native.cua", params: { action: "computer_open_application" } });

    const unusable = new HostCapabilityBroker({
      drivers: { native: { handle: async () => ({ ok: true }), usable: () => false } },
      policy: ALLOWING_POLICY,
    });
    const unusableToken = unusable.issueToken({
      extensionId: "declared-ext",
      projectRoot: "/proj/a",
      permission: "native.exec",
    });
    const denied = await unusable.dispatch(
      makeRequest({
        token: unusableToken.token,
        permission: "native.exec",
        op: "native.cua",
        params: { action: "computer_batch", sessionKey: "session-1", computerCapability: "grant-ok" },
      }),
      "session-1",
    );
    expect(denied.ok === false && denied.code).toBe("host_unavailable");
  });

  it("has no driver for net.request / memory.read in this wave and denies them", async () => {
    const { broker, log } = makeBroker();
    const { token } = broker.issueToken({
      extensionId: "declared-ext",
      projectRoot: "/proj/a",
      permission: "memory.read",
    });
    const response = await broker.dispatch(
      makeRequest({ token, permission: "memory.read", op: "browser.action" as never }),
      "session-1",
    );
    expect(response.ok === false && response.code).toBe("unknown_capability");
    expect(log.calls).toEqual([]);
  });
});

describe("token mint (host_capability_token)", () => {
  it("mints a one-time token after the permission gates and returns the stable shape", async () => {
    const clock = makeClock();
    const { broker } = makeBroker({ clock });
    const response = await broker.mint({
      extensionId: "declared-ext",
      permission: "native.exec",
      projectRoot: "/proj/a",
    });
    expect(response).toEqual({
      schemaVersion: 1,
      ok: true,
      token: expect.any(String),
      expiresAt: clock.now() + 30_000,
      hostApiVersion: EXTENSION_HOST_API_VERSION,
    });
    expect(Object.keys(response).sort()).toEqual(["expiresAt", "hostApiVersion", "ok", "schemaVersion", "token"]);
    // The minted token is immediately usable exactly once.
    if (!(response.ok === true && response.token)) throw new Error("expected ok mint");
    const redeemed = broker.redeem(response.token, {
      extensionId: "declared-ext",
      projectRoot: "/proj/a",
      permission: "native.exec",
    });
    expect(redeemed).toEqual({ ok: true });
    const replay = broker.redeem(response.token, {
      extensionId: "declared-ext",
      projectRoot: "/proj/a",
      permission: "native.exec",
    });
    expect(replay.ok === false && replay.code).toBe("token_consumed");
  });

  it("honors a requested TTL and expires minted tokens", async () => {
    const clock = makeClock();
    const { broker } = makeBroker({ clock });
    const minted = await broker.mint({
      extensionId: "declared-ext",
      permission: "browser.session",
      projectRoot: "/proj/a",
    });
    if (!(minted.ok === true)) throw new Error("expected ok mint");
    clock.advance(60_001);
    const response = await broker.dispatch(makeRequest({ token: minted.token }), "session-1");
    expect(response.ok === false && response.code).toBe("token_expired");
  });

  it("fails closed without a policy and repeats the dispatch permission gates", async () => {
    // No policy configured: the broker cannot prove any authorization.
    const bare = new HostCapabilityBroker({});
    const bareMint = await bare.mint({ extensionId: "declared-ext", permission: "native.exec", projectRoot: "/proj/a" });
    expect(bareMint.ok === false && bareMint.code).toBe("permission_denied");

    const { broker } = makeBroker();
    const undeclared = await broker.mint({ extensionId: "undeclared-ext", permission: "native.exec", projectRoot: "/proj/a" });
    expect(undeclared.ok === false && undeclared.code).toBe("permission_denied");
    const locked = makeBroker({ policy: { ...ALLOWING_POLICY, projectAllows: () => false } });
    const ungranted = await locked.broker.mint({
      extensionId: "declared-ext",
      permission: "native.exec",
      projectRoot: "/proj/locked",
    });
    expect(ungranted.ok === false && ungranted.code).toBe("permission_denied");
  });

  it("rejects malformed mint requests without issuing anything", async () => {
    const { broker } = makeBroker();
    const nullRequest = await broker.mint(null);
    expect(nullRequest.ok === false && nullRequest.code).toBe("unsupported_wire");
    const badPermission = await broker.mint({ extensionId: "declared-ext", permission: "desktop.admin", projectRoot: "/proj/a" });
    expect(badPermission.ok === false && badPermission.code).toBe("unknown_capability");
    const missingExtension = await broker.mint({ permission: "native.exec", projectRoot: "/proj/a" });
    expect(missingExtension.ok === false && missingExtension.code).toBe("unsupported_wire");
    const missingProject = await broker.mint({ extensionId: "declared-ext", permission: "native.exec" });
    expect(missingProject.ok === false && missingProject.code).toBe("unsupported_wire");
  });

  it("answers host_capability_token over the bridge and refuses forged session capabilities", async () => {
    const { broker } = makeBroker();
    bridge = new HostBridge({ onHostCapabilityMint: (event) => broker.mint(event) });
    const port = await bridge.listen();
    const capability = bridge.register("session-1");
    const mintBody = {
      schemaVersion: 1,
      sessionCapability: capability,
      action: "host_capability_token",
      event: { extensionId: "declared-ext", permission: "native.exec", projectRoot: "/proj/a" },
    };
    const ok = await post(port, mintBody);
    expect(ok.status).toBe(200);
    const minted = await ok.json();
    expect(minted).toMatchObject({ ok: true });
    expect(typeof minted.token).toBe("string");
    expect(minted.token.length).toBeGreaterThan(0);
    // Minted token drives a real gated dispatch end to end.
    const dispatched = await broker.dispatch(
      makeRequest({ token: minted.token, permission: "native.exec", op: "native.cua", params: { computerCapability: "grant-ok" } }),
      "session-1",
    );
    expect(dispatched.ok).toBe(true);

    const forged = await post(port, { ...mintBody, sessionCapability: "not-the-secret" });
    expect(forged.status).toBe(403);
  });

  it("denies host_capability_token with no broker bound (fail closed)", async () => {
    bridge = new HostBridge({});
    const port = await bridge.listen();
    bridge.register("session-1");
    const response = await post(port, {
      schemaVersion: 1,
      sessionCapability: bridge.register("session-1"),
      action: "host_capability_token",
      event: { extensionId: "declared-ext", permission: "native.exec", projectRoot: "/proj/a" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: false,
      code: "host_unavailable",
      error: "host capability token mint unavailable",
    });
  });
});

describe("native.cua desktop-grant validation", () => {
  const nativeRequest = (overrides: Partial<HostCapabilityRequestV1> = {}): Partial<HostCapabilityRequestV1> => ({
    permission: "native.exec",
    op: "native.cua",
    params: { action: "computer_batch", sessionKey: "session-1", computerCapability: "grant-ok" },
    ...overrides,
  });

  it("refuses a native.cua call whose params carry no computerCapability", async () => {
    const { broker, log } = makeBroker();
    const { token } = broker.issueToken({
      extensionId: "declared-ext",
      projectRoot: "/proj/a",
      permission: "native.exec",
    });
    const response = await broker.dispatch(
      makeRequest({ token, permission: "native.exec", op: "native.cua", params: { action: "computer_batch", sessionKey: "session-1" } }),
      "session-1",
    );
    expect(response.ok === false && response.code).toBe("permission_denied");
    expect(log.calls).toEqual([]);
  });

  it("refuses a computerCapability the session was not granted, and never burns the token", async () => {
    const { broker, log } = makeBroker();
    const { token } = broker.issueToken({
      extensionId: "declared-ext",
      projectRoot: "/proj/a",
      permission: "native.exec",
    });
    const denied = await broker.dispatch(
      makeRequest({
        token,
        ...nativeRequest({ params: { action: "computer_batch", sessionKey: "session-1", computerCapability: "someone-elses-grant" } }),
      }),
      "session-1",
    );
    expect(denied.ok === false && denied.code).toBe("permission_denied");
    expect(log.calls).toEqual([]);
    // The grant check runs before redemption: the still-valid token works after a fixed grant.
    const retried = await broker.dispatch(makeRequest({ token, ...nativeRequest() }), "session-1");
    expect(retried.ok).toBe(true);
  });

  it("accepts the bridge-minted grant via HostBridge.verifyComputerGrant", async () => {
    const bridgeOnly = new HostBridge({});
    try {
      const port = await bridgeOnly.listen();
      const sessionCapability = bridgeOnly.register("session-1");
      const computerCapability = bridgeOnly.registerComputer("session-1");
      const { broker } = makeBroker({
        policy: {
          ...ALLOWING_POLICY,
          verifyDesktopGrant: ({ sessionId, computerCapability: presented }) =>
            bridgeOnly.verifyComputerGrant(sessionId, presented),
        },
      });
      // Wrong session's grant or a forged string fails; the real grant passes.
      expect(bridgeOnly.verifyComputerGrant("session-1", "forged")).toBe(false);
      expect(bridgeOnly.verifyComputerGrant("session-2", computerCapability)).toBe(false);
      expect(bridgeOnly.verifyComputerGrant("session-1", computerCapability)).toBe(true);
      const { token } = broker.issueToken({
        extensionId: "declared-ext",
        projectRoot: "/proj/a",
        permission: "native.exec",
      });
      const response = await broker.dispatch(
        makeRequest({
          token,
          permission: "native.exec",
          op: "native.cua",
          params: { action: "computer_runtime_capabilities", sessionKey: "session-1", computerCapability },
        }),
        "session-1",
      );
      expect(response.ok).toBe(true);
      void port;
    } finally {
      await bridgeOnly.close();
    }
  });

  it("denies native.exec when no desktop-grant verifier is configured (fail closed)", async () => {
    const { drivers } = makeDrivers();
    const broker = new HostCapabilityBroker({
      drivers: drivers as never,
      policy: { declaredPermissions: () => ["native.exec"], projectAllows: () => true },
    });
    const { token } = broker.issueToken({
      extensionId: "declared-ext",
      projectRoot: "/proj/a",
      permission: "native.exec",
    });
    const response = await broker.dispatch(
      makeRequest({
        token,
        permission: "native.exec",
        op: "native.cua",
        params: { action: "computer_batch", sessionKey: "session-1", computerCapability: "grant-ok" },
      }),
      "session-1",
    );
    expect(response.ok === false && response.code).toBe("permission_denied");
  });
});

describe("HostBridge host_capability action", () => {
  it("routes an authorized request through the broker and refuses a forged session capability", async () => {
    const { broker } = makeBroker();
    bridge = new HostBridge({ onHostCapability: (event, sessionId) => broker.dispatch(event, sessionId) });
    const port = await bridge.listen();
    const capability = bridge.register("session-1");
    const { token } = broker.issueToken({
      extensionId: "declared-ext",
      projectRoot: "/proj/a",
      permission: "browser.session",
    });

    const ok = await post(port, {
      schemaVersion: 1,
      sessionCapability: capability,
      action: "host_capability",
      event: makeRequest({ token }),
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      schemaVersion: 1,
      ok: true,
      result: { ok: true, text: "page text" },
      hostApiVersion: EXTENSION_HOST_API_VERSION,
    });

    const replay = await post(port, {
      schemaVersion: 1,
      sessionCapability: capability,
      action: "host_capability",
      event: makeRequest({ token }),
    });
    expect(await replay.json()).toMatchObject({ ok: false, code: "token_consumed" });

    const forged = await post(port, {
      schemaVersion: 1,
      sessionCapability: "not-the-secret",
      action: "host_capability",
      event: makeRequest({ token: "another" }),
    });
    expect(forged.status).toBe(403);
  });

  it("answers host_capability over HTTP 200 when no broker is bound", async () => {
    bridge = new HostBridge({});
    const port = await bridge.listen();
    bridge.register("session-1");
    const response = await post(port, {
      schemaVersion: 1,
      sessionCapability: bridge.register("session-1"),
      action: "host_capability",
      event: makeRequest({}),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: false,
      code: "host_unavailable",
      error: "host capability broker unavailable",
    });
  });
});
