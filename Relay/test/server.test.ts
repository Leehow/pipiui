import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { afterEach, test } from "node:test";
import WebSocket from "ws";
import { createRelayServer, optionsFromEnvironment } from "../src/server.js";
import { COMMANDS, MAX_RESPONSE_BYTES } from "../src/protocol.js";

const publicOrigin = "https://pipi.aichattrpg.com";
const deviceID = randomUUID();
const secret = "x".repeat(48);
const options = {
  host: "127.0.0.1" as const,
  port: 0,
  publicOrigin,
  deviceID,
  deviceSecretSHA256: createHash("sha256").update(secret).digest("hex"),
  requireAccessIdentity: true,
};
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()?.();
});

async function start() {
  const relay = createRelayServer(options);
  relay.server.listen(0, options.host);
  await once(relay.server, "listening");
  const address = relay.server.address();
  assert(address && typeof address === "object");
  closers.push(() => new Promise((resolve) => relay.server.close(() => resolve())));
  return { ...relay, port: address.port };
}

async function connectHost(
  port: number,
  onRequest?: (request: Record<string, unknown>, ws: WebSocket, epoch: string) => void,
) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/host/ws`, {
    headers: {
      "x-forwarded-host": new URL(publicOrigin).host,
      "cf-access-jwt-assertion": "test-assertion",
      "x-pipiui-device-id": deviceID,
      "x-pipiui-device-secret": secret,
    },
  });
  await once(ws, "open");
  const epoch = randomUUID();
  ws.send(JSON.stringify({
    v: 1,
    type: "hello",
    deviceID,
    hostEpoch: epoch,
    clientVersion: "test",
    displayName: "Test Mac",
  }));
  ws.on("message", (data) => {
    const request = JSON.parse(data.toString()) as Record<string, unknown>;
    if (request.type === "request") onRequest?.(request, ws, epoch);
  });
  closers.push(async () => {
    if (ws.readyState === WebSocket.CLOSED) return;
    const closed = once(ws, "close");
    ws.close();
    await closed;
  });
  await new Promise((resolve) => setImmediate(resolve));
  return { ws, epoch };
}

async function fetchIndex(port: number) {
  return fetch(`http://127.0.0.1:${port}/api/index`, {
    headers: {
      "x-forwarded-host": new URL(publicOrigin).host,
      "cf-access-authenticated-user-email": "user@example.test",
    },
  });
}

test("environment refuses a non-loopback listener", () => {
  assert.throws(() => optionsFromEnvironment({
    PIPIUI_RELAY_HOST: "0.0.0.0",
    PIPIUI_DEVICE_ID: deviceID,
    PIPIUI_DEVICE_SECRET_SHA256: options.deviceSecretSHA256,
  }), /loopback/);
});

test("browser requires Access identity and returns no-store", async () => {
  const relay = await start();
  const response = await fetch(`http://127.0.0.1:${relay.port}/`, {
    headers: { "x-forwarded-host": new URL(publicOrigin).host },
  });
  assert.equal(response.status, 401);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});

test("offline host is 503 and mutation requires exact Origin plus CSRF", async () => {
  const relay = await start();
  const common = {
    "x-forwarded-host": new URL(publicOrigin).host,
    "cf-access-authenticated-user-email": "user@example.test",
  };
  const page = await fetch(`http://127.0.0.1:${relay.port}/`, { headers: common });
  const cookie = page.headers.get("set-cookie")?.match(/pipiui_csrf=([^;]+)/)?.[1];
  assert(cookie);
  const rejected = await fetch(`http://127.0.0.1:${relay.port}/api/send`, {
    method: "POST",
    headers: { ...common, "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(rejected.status, 403);
  const offline = await fetch(`http://127.0.0.1:${relay.port}/api/send`, {
    method: "POST",
    headers: {
      ...common,
      "content-type": "application/json",
      origin: publicOrigin,
      cookie: `pipiui_csrf=${cookie}`,
      "x-pipiui-csrf": cookie,
    },
    body: "{}",
  });
  assert.equal(offline.status, 503);
  assert.deepEqual(await offline.json(), { error: "host_offline" });
});

test("authenticated host forwards index and no credential appears in page", async () => {
  const relay = await start();
  const { ws } = await connectHost(relay.port, (request, socket, epoch) => {
    socket.send(JSON.stringify({
      v: 1,
      type: "response",
      requestID: request.requestID,
      hostEpoch: epoch,
      status: 200,
      body: { projects: [], sessions: [] },
    }));
  });
  const response = await fetchIndex(relay.port);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { projects: [], sessions: [] });
  const page = await fetch(`http://127.0.0.1:${relay.port}/`, {
    headers: {
      "x-forwarded-host": new URL(publicOrigin).host,
      "cf-access-authenticated-user-email": "user@example.test",
    },
  });
  const html = await page.text();
  assert(!html.includes(secret));
  assert(!html.includes("CF-Access-Client-Secret"));
  ws.close();
});

test("response above request cap and below 8 MiB is forwarded", async () => {
  const relay = await start();
  const payload = "y".repeat(300 * 1024);
  await connectHost(relay.port, (request, ws, epoch) => {
    ws.send(JSON.stringify({
      v: 1,
      type: "response",
      requestID: request.requestID,
      hostEpoch: epoch,
      status: 200,
      body: { payload },
    }));
  });
  const response = await fetchIndex(relay.port);
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { payload: string }).payload.length, payload.length);
});

test("response frame near 8 MiB is accepted", async () => {
  const relay = await start();
  const payload = "b".repeat(MAX_RESPONSE_BYTES - 2_048);
  await connectHost(relay.port, (request, ws, epoch) => {
    ws.send(JSON.stringify({
      v: 1,
      type: "response",
      requestID: request.requestID,
      hostEpoch: epoch,
      status: 200,
      body: { payload },
    }));
  });
  const response = await fetchIndex(relay.port);
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { payload: string }).payload.length, payload.length);
});

test("model commands are allowlisted and forwarded unchanged", async () => {
  assert(COMMANDS.has("models.get"));
  assert(COMMANDS.has("model.set"));
  assert(COMMANDS.has("subagentModel.set"));
  assert(COMMANDS.has("agents.list"));
  assert(COMMANDS.has("agents.detail"));
  assert(COMMANDS.has("panel.state"));
  assert(COMMANDS.has("document.get"));
  const relay = await start();
  const seen: Array<{ command: unknown; body: unknown }> = [];
  await connectHost(relay.port, (request, ws, epoch) => {
    seen.push({ command: request.command, body: request.body });
    ws.send(JSON.stringify({
      v: 1, type: "response", requestID: request.requestID, hostEpoch: epoch,
      status: 200, body: { accepted: true },
    }));
  });
  const common = {
    "x-forwarded-host": new URL(publicOrigin).host,
    "cf-access-authenticated-user-email": "user@example.test",
  };
  const page = await fetch(`http://127.0.0.1:${relay.port}/`, { headers: common });
  const csrf = page.headers.get("set-cookie")?.match(/pipiui_csrf=([^;]+)/)?.[1];
  assert(csrf);
  for (const [path, body] of [
    ["/api/models", { sessionID: "session" }],
    ["/api/model", { sessionID: "session", modelId: "xai/grok" }],
    ["/api/subagent-model", { agent: "explore", model: "" }],
    ["/api/agents", { sessionID: "session" }],
    ["/api/agent", { sessionID: "session", agentID: "agent" }],
    ["/api/panel-state", { sessionID: "session" }],
    ["/api/document", { sessionID: "session", documentID: "document" }],
  ] as const) {
    const response = await fetch(`http://127.0.0.1:${relay.port}${path}`, {
      method: "POST",
      headers: { ...common, "content-type": "application/json", origin: publicOrigin,
        cookie: `pipiui_csrf=${csrf}`, "x-pipiui-csrf": csrf },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 200);
  }
  assert.deepEqual(seen, [
    { command: "models.get", body: { sessionID: "session" } },
    { command: "model.set", body: { sessionID: "session", modelId: "xai/grok" } },
    { command: "subagentModel.set", body: { agent: "explore", model: "" } },
    { command: "agents.list", body: { sessionID: "session" } },
    { command: "agents.detail", body: { sessionID: "session", agentID: "agent" } },
    { command: "panel.state", body: { sessionID: "session" } },
    { command: "document.get", body: { sessionID: "session", documentID: "document" } },
  ]);
});

test("response above 8 MiB is rejected by websocket transport", async () => {
  const relay = await start();
  const { ws } = await connectHost(relay.port);
  const closed = once(ws, "close");
  ws.send("z".repeat(MAX_RESPONSE_BYTES + 1));
  const [code] = await closed;
  assert.equal(code, 1009);
});

test("hello remains capped at 256 KiB", async () => {
  const relay = await start();
  const ws = new WebSocket(`ws://127.0.0.1:${relay.port}/host/ws`, {
    headers: {
      "x-forwarded-host": new URL(publicOrigin).host,
      "cf-access-jwt-assertion": "test-assertion",
      "x-pipiui-device-id": deviceID,
      "x-pipiui-device-secret": secret,
    },
  });
  await once(ws, "open");
  const closed = once(ws, "close");
  ws.send("h".repeat(300 * 1024));
  const [code] = await closed;
  assert.equal(code, 1008);
});
