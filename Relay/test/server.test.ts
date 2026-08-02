import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { afterEach, test } from "node:test";
import WebSocket from "ws";
import {
  createRelayServer,
  normalizedHostHeader,
  optionsFromEnvironment,
} from "../src/server.js";
import { MAX_RESPONSE_BYTES } from "../src/protocol.js";
import { fetchWithHost as fetch } from "./support.js";

const publicOrigin = "https://pipi.aichattrpg.com";
const deviceSignalOrigin = "https://signal.aichattrpg.com";
const deviceID = randomUUID();
const secret = "x".repeat(48);
const options = {
  host: "127.0.0.1" as const,
  port: 0,
  publicOrigin,
  deviceSignalOrigin,
  deviceID,
  deviceSecretSHA256: createHash("sha256").update(secret).digest("hex"),
  requireAccessIdentity: true,
  accessVerifier: {
    async verify(assertion: string) {
      return assertion === "test-assertion"
        ? { subject: "cf:test-user", email: "user@example.test" }
        : null;
    },
  },
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
      host: new URL(publicOrigin).host,
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
  // Upgrade now includes asynchronous Access JWT verification before the
  // legacy WSS is accepted and its hello reaches the broker.
  await new Promise((resolve) => setTimeout(resolve, 20));
  return { ws, epoch };
}

async function fetchIndex(port: number) {
  return fetch(`http://127.0.0.1:${port}/api/index`, {
    headers: {
      host: new URL(publicOrigin).host,
      "cf-access-jwt-assertion": "test-assertion",
    },
  });
}

async function rejectedUpgrade(
  port: number,
  path: string,
  hostHeader: string,
  headers: Record<string, string> = {},
): Promise<number> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, {
    headers: {
      host: hostHeader,
      ...headers,
    },
  });
  return new Promise<number>((resolve, reject) => {
    ws.once("unexpected-response", (_request, response) => {
      resolve(response.statusCode ?? 0);
      response.destroy();
    });
    ws.once("error", reject);
  });
}

test("environment refuses a non-loopback listener", () => {
  assert.throws(() => optionsFromEnvironment({
    PIPIUI_RELAY_HOST: "0.0.0.0",
    PIPIUI_DEVICE_ID: deviceID,
    PIPIUI_DEVICE_SECRET_SHA256: options.deviceSecretSHA256,
  }), /loopback/);
});

test("environment fails closed without Access team domain and audience", () => {
  assert.throws(() => optionsFromEnvironment({
    PIPIUI_RELAY_HOST: "127.0.0.1",
    PIPIUI_REQUIRE_ACCESS_IDENTITY: "true",
  }), /TEAM_DOMAIN.*AUD/);
});

test("environment defaults the browser product flow to accountless pairing", () => {
  const configured = optionsFromEnvironment({
    PIPIUI_RELAY_HOST: "127.0.0.1",
  });
  assert.equal(configured.requireAccessIdentity, false);
  assert.equal(configured.publicOrigin, publicOrigin);
  assert.equal(configured.deviceSignalOrigin, deviceSignalOrigin);
});

test("environment requires distinct browser and device signaling origins", () => {
  assert.throws(() => optionsFromEnvironment({
    PIPIUI_PUBLIC_ORIGIN: publicOrigin,
    PIPIUI_DEVICE_SIGNAL_ORIGIN: publicOrigin,
    PIPIUI_REQUIRE_ACCESS_IDENTITY: "false",
  }), /must be distinct/);
  assert.throws(() => optionsFromEnvironment({
    PIPIUI_PUBLIC_ORIGIN: "https://same.example",
    PIPIUI_DEVICE_SIGNAL_ORIGIN: "https://same.example:444",
    PIPIUI_REQUIRE_ACCESS_IDENTITY: "false",
  }), /must be distinct/);
  assert.throws(() => createRelayServer({
    ...options,
    publicOrigin: "https://same.example",
    deviceSignalOrigin: "https://same.example:444",
  }), /must be distinct/);

  for (const [left, right] of [
    ["https://SAME.example", "https://same.example:444"],
    ["https://éxample.com", "https://xn--xample-9ua.com:444"],
    ["https://[2001:db8::1]", "https://[2001:0DB8:0:0:0:0:0:1]:444"],
    ["https://127.0.0.1", "https://0177.0.0.1:444"],
    ["https://127.0.0.1", "https://2130706433:444"],
    ["https://127.0.0.1", "https://127.1:444"],
    ["https://127.0.0.1", "https://0x7f.1:444"],
  ]) {
    assert.throws(() => optionsFromEnvironment({
      PIPIUI_PUBLIC_ORIGIN: left,
      PIPIUI_DEVICE_SIGNAL_ORIGIN: right,
      PIPIUI_REQUIRE_ACCESS_IDENTITY: "false",
    }), /must be distinct/);
    assert.throws(() => createRelayServer({
      ...options,
      publicOrigin: left,
      deviceSignalOrigin: right,
    }), /must be distinct/);
  }
});

test("configured origins reject terminal DNS root dots", () => {
  assert.throws(() => optionsFromEnvironment({
    PIPIUI_PUBLIC_ORIGIN: "https://same.example",
    PIPIUI_DEVICE_SIGNAL_ORIGIN: "https://same.example.:444",
    PIPIUI_REQUIRE_ACCESS_IDENTITY: "false",
  }), /terminal DNS root dot/);
  assert.throws(() => createRelayServer({
    ...options,
    publicOrigin: "https://same.example.",
    deviceSignalOrigin: deviceSignalOrigin,
  }), /terminal DNS root dot/);
});

test("Host normalization rejects ambiguity and preserves strict origin ports", () => {
  assert.equal(
    normalizedHostHeader(["SIGNAL.AICHATTRPG.COM"], "https:"),
    "signal.aichattrpg.com",
  );
  assert.equal(
    normalizedHostHeader(["signal.aichattrpg.com:443"], "https:"),
    "signal.aichattrpg.com",
  );
  assert.equal(
    normalizedHostHeader(["signal.aichattrpg.com:444"], "https:"),
    "signal.aichattrpg.com:444",
  );
  assert.equal(
    normalizedHostHeader(["[2001:0DB8::1]:444"], "https:"),
    "[2001:db8::1]:444",
  );
  assert.equal(
    normalizedHostHeader(["signal.aichattrpg.com."], "https:"),
    null,
  );
  assert.equal(normalizedHostHeader([], "https:"), null);
  assert.equal(
    normalizedHostHeader(["pipi.aichattrpg.com", "signal.aichattrpg.com"], "https:"),
    null,
  );
  assert.equal(
    normalizedHostHeader(["pipi.aichattrpg.com,signal.aichattrpg.com"], "https:"),
    null,
  );
  assert.equal(normalizedHostHeader(["bad host"], "https:"), null);
  assert.equal(normalizedHostHeader(["user@pipi.aichattrpg.com"], "https:"), null);
  assert.equal(normalizedHostHeader(["pipi.aichattrpg.com/path"], "https:"), null);
});

test("browser requires Access identity and returns no-store", async () => {
  const relay = await start();
  const response = await fetch(`http://127.0.0.1:${relay.port}/`, {
    headers: { host: new URL(publicOrigin).host },
  });
  assert.equal(response.status, 401);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const forgedEmail = await fetch(`http://127.0.0.1:${relay.port}/`, {
    headers: {
      host: new URL(publicOrigin).host,
      "cf-access-authenticated-user-email": "forged@example.test",
    },
  });
  assert.equal(forgedEmail.status, 401);
});

test("browser and accountless device signaling hosts are strictly separated", async () => {
  const relay = await start();
  const signalHost = new URL(deviceSignalOrigin).host;
  const browserHost = new URL(publicOrigin).host;

  const ws = new WebSocket(`ws://127.0.0.1:${relay.port}/device/ws`, {
    headers: {
      host: signalHost.toUpperCase(),
      "x-forwarded-host": browserHost,
    },
  });
  const challengeMessage = once(ws, "message");
  await once(ws, "open");
  const [challengeData] = await challengeMessage;
  const challenge = JSON.parse(challengeData.toString()) as {
    type?: unknown;
    audience?: unknown;
  };
  assert.equal(challenge.type, "auth.challenge");
  assert.equal(challenge.audience, deviceSignalOrigin);
  const closed = once(ws, "close");
  ws.close();
  await closed;

  assert.equal(
    await rejectedUpgrade(relay.port, "/device/ws", browserHost, {
      "cf-access-jwt-assertion": "test-assertion",
      "x-forwarded-host": signalHost,
    }),
    401,
  );
  assert.equal(
    await rejectedUpgrade(relay.port, "/host/ws", signalHost, {
      "cf-access-jwt-assertion": "test-assertion",
      "x-pipiui-device-id": deviceID,
      "x-pipiui-device-secret": secret,
      "x-forwarded-host": browserHost,
    }),
    401,
  );
  assert.equal(
    await rejectedUpgrade(relay.port, "/other", signalHost),
    401,
  );
  assert.equal(
    await rejectedUpgrade(relay.port, "/device/ws", `${signalHost}:444`),
    401,
  );

  for (const path of ["/", "/healthz", "/api/index"]) {
    const response = await fetch(`http://127.0.0.1:${relay.port}${path}`, {
      headers: {
        host: signalHost,
        "cf-access-jwt-assertion": "test-assertion",
        "x-forwarded-host": browserHost,
      },
    });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "not found" });
  }
  const browserWithoutAccess = await fetch(
    `http://127.0.0.1:${relay.port}/healthz`,
    {
      headers: {
        host: browserHost,
        "x-forwarded-host": signalHost,
      },
    },
  );
  assert.equal(browserWithoutAccess.status, 401);
});

test("zero binding never selects legacy and mutation still requires Origin plus CSRF", async () => {
  const relay = await start();
  const common = {
    host: new URL(publicOrigin).host,
    "cf-access-jwt-assertion": "test-assertion",
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
  const unbound = await fetch(`http://127.0.0.1:${relay.port}/api/send`, {
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
  assert.equal(unbound.status, 403);
  assert.deepEqual(await unbound.json(), { error: "device selection rejected" });
  assert.equal(relay.broker.requestCount(), 0);
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
  const response = await relay.broker.request("index", {});
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { projects: [], sessions: [] });
  const page = await fetch(`http://127.0.0.1:${relay.port}/`, {
    headers: {
      host: new URL(publicOrigin).host,
      "cf-access-jwt-assertion": "test-assertion",
    },
  });
  const html = await page.text();
  assert(!html.includes(secret));
  assert(!html.includes("CF-Access-Client-Secret"));
  assert.match(html, /type="module"/);
  assert.match(html, /显式使用兼容回退/);
  const asset = await fetch(`http://127.0.0.1:${relay.port}/assets/remote.js`, {
    headers: {
      host: new URL(publicOrigin).host,
      "cf-access-jwt-assertion": "test-assertion",
    },
  });
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get("content-type") ?? "", /text\/javascript/);
  assert.match(await asset.text(), /class RemoteP2PClient/);
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
  const response = await relay.broker.request("index", {});
  assert.equal(response.status, 200);
  assert.equal((response.body as { payload: string }).payload.length, payload.length);
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
  const response = await relay.broker.request("index", {});
  assert.equal(response.status, 200);
  assert.equal((response.body as { payload: string }).payload.length, payload.length);
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
      host: new URL(publicOrigin).host,
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
