import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import WebSocket from "ws";
import {
  createTunnelServer,
  tunnelOptionsFromEnvironment,
} from "../src/tunnel-server.js";

const roomID = "21c5b03d-98cf-4da0-8b5c-17a20d557663";
const secret = "a".repeat(64);
const wrongSecret = "b".repeat(64);
const frameQueues = new WeakMap<WebSocket, {
  values: Record<string, any>[];
  waiters: Array<(value: Record<string, any>) => void>;
}>();

function installFrameQueue(socket: WebSocket) {
  const queue = {
    values: [] as Record<string, any>[],
    waiters: [] as Array<(value: Record<string, any>) => void>,
  };
  frameQueues.set(socket, queue);
  socket.on("message", (data) => {
    const value = JSON.parse(String(data)) as Record<string, any>;
    const waiter = queue.waiters.shift();
    if (waiter) waiter(value);
    else queue.values.push(value);
  });
}

async function fixture() {
  const instance = createTunnelServer({
    host: "127.0.0.1",
    port: 0,
    publicOrigin: "http://127.0.0.1",
    tunnelURL: "ws://127.0.0.1/tunnel/ws",
  });
  instance.server.listen(0, "127.0.0.1");
  await once(instance.server, "listening");
  const address = instance.server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const socketURL = `ws://127.0.0.1:${address.port}/tunnel/ws`;
  return {
    instance,
    origin,
    socketURL,
    async close() {
      await instance.close();
      instance.server.closeAllConnections();
      await new Promise<void>((resolve) => {
        let completed = false;
        const finish = () => {
          if (completed) return;
          completed = true;
          clearTimeout(deadline);
          resolve();
        };
        const deadline = setTimeout(finish, 250);
        instance.server.close(finish);
      });
    },
  };
}

async function connect(url: string) {
  const socket = new WebSocket(url);
  installFrameQueue(socket);
  await once(socket, "open");
  return socket;
}

function hello(socket: WebSocket, role: "host" | "browser", value = secret) {
  socket.send(JSON.stringify({
    v: 1, type: "hello", roomID, secret: value, role,
  }));
}

async function nextFrame(socket: WebSocket): Promise<Record<string, any>> {
  const queue = frameQueues.get(socket);
  assert.ok(queue);
  const value = queue.values.shift();
  if (value) return value;
  return new Promise((resolve) => queue.waiters.push(resolve));
}

async function waitUntil(
  predicate: () => boolean,
  message: string,
  timeoutMS = 1_000,
) {
  const deadline = Date.now() + timeoutMS;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

test("tunnel product defaults expose only exact static and WSS routes", async () => {
  const options = tunnelOptionsFromEnvironment({});
  assert.equal(options.publicOrigin, "https://pipi.aichattrpg.com");
  assert.equal(options.tunnelURL, "wss://signal.aichattrpg.com/tunnel/ws");
  assert.throws(() => tunnelOptionsFromEnvironment({
    PIPIUI_RELAY_HOST: "0.0.0.0",
  }), /loopback/);
  assert.throws(() => tunnelOptionsFromEnvironment({
    PIPIUI_TUNNEL_URL: "wss://signal.aichattrpg.com/trystero/ws",
  }), /tunnel/);

  const relay = await fixture();
  try {
    const response = await fetch(`${relay.origin}/pair/${roomID}`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(
      html.indexOf("history.replaceState")
        < html.indexOf('import("/assets/tunnel-browser.js")'),
    );
    assert.doesNotMatch(html, /trystero|RTCPeerConnection|pair\/claim|api\/devices/i);
    assert.match(html, /服务器隧道尚未连接/);
    assert.match(html, /PipiUI 远程会话/);
    assert.match(html, /id="project-list"/);
    assert.match(html, /id="session-list"/);
    assert.equal((await fetch(`${relay.origin}/assets/tunnel-browser.js`)).status, 200);
    assert.equal((await fetch(`${relay.origin}/assets/trystero-browser.js`)).status, 404);
    assert.equal((await fetch(`${relay.origin}/api/index`)).status, 404);
    assert.equal((await fetch(`${relay.origin}/api/pair/claim`)).status, 404);

    const accepted = await connect(relay.socketURL);
    const rejected = new WebSocket(relay.socketURL.replace("/tunnel/ws", "/trystero/ws"));
    const [error] = await once(rejected, "error");
    assert.ok(error instanceof Error);
    accepted.close();
  } finally {
    await relay.close();
  }
});

test("wrong secret and role do not consume the one-time browser slot", async () => {
  const relay = await fixture();
  const wrongRole = await connect(relay.socketURL);
  const host = await connect(relay.socketURL);
  const wrong = await connect(relay.socketURL);
  const valid = await connect(relay.socketURL);
  try {
    const wrongRoleClosed = once(wrongRole, "close");
    wrongRole.send(JSON.stringify({
      v: 1, type: "hello", roomID, secret, role: "observer",
    }));
    await wrongRoleClosed;
    hello(host, "host");
    assert.equal((await nextFrame(host)).type, "host-ready");
    const wrongClosed = once(wrong, "close");
    hello(wrong, "browser", wrongSecret);
    await wrongClosed;
    assert.equal(relay.instance.getRoomCount(), 1);
    const validReady = nextFrame(valid);
    const hostReady = nextFrame(host);
    hello(valid, "browser");
    assert.equal((await validReady).type, "ready");
    assert.equal((await hostReady).type, "ready");
  } finally {
    wrongRole.close();
    valid.close();
    host.close();
    await relay.close();
  }
});

test("null array and scalar JSON close only the sender and leave Relay healthy", async () => {
  const relay = await fixture();
  try {
    for (const payload of ["null", "[]", "42", '"scalar"', "true"]) {
      const malformed = await connect(relay.socketURL);
      const closed = once(malformed, "close");
      malformed.send(payload);
      const [code] = await closed;
      assert.equal(code, 1008);
      await waitUntil(
        () => relay.instance.getClientCount() === 0,
        `malformed ${payload} client was retained`,
      );
      assert.deepEqual(await (await fetch(`${relay.origin}/healthz`)).json(), { ok: true });
    }

    const host = await connect(relay.socketURL);
    const browser = await connect(relay.socketURL);
    hello(host, "host");
    await nextFrame(host);
    const hostReady = nextFrame(host);
    const browserReady = nextFrame(browser);
    hello(browser, "browser");
    await hostReady;
    await browserReady;
    const hostClosed = once(host, "close");
    const browserClosed = once(browser, "close");
    browser.send("null");
    await browserClosed;
    await hostClosed;
    await waitUntil(
      () => relay.instance.getClientCount() === 0
        && relay.instance.getRoomCount() === 0,
      "authenticated malformed frame retained a client or room",
    );
    assert.deepEqual(await (await fetch(`${relay.origin}/healthz`)).json(), { ok: true });
  } finally {
    await relay.close();
  }
});

test("tunnel relays bounded request/response frames and invalidates on disconnect", async () => {
  const relay = await fixture();
  const host = await connect(relay.socketURL);
  const browser = await connect(relay.socketURL);
  const requestID = "c88d9390-b890-4928-930b-015f56498cb0";
  try {
    hello(host, "host");
    await nextFrame(host);
    const browserReady = nextFrame(browser);
    const hostReady = nextFrame(host);
    hello(browser, "browser");
    await browserReady;
    await hostReady;
    const hostRequest = nextFrame(host);
    browser.send(JSON.stringify({
      v: 1, type: "request", requestID, command: "index", body: {},
    }));
    assert.deepEqual(await hostRequest, {
      v: 1, type: "request", requestID, command: "index", body: {},
    });
    const browserResponse = nextFrame(browser);
    host.send(JSON.stringify({
      v: 1, type: "response", requestID, status: 200,
      body: { projects: [], sessions: [] },
    }));
    assert.deepEqual(await browserResponse, {
      v: 1, type: "response", requestID, status: 200,
      body: { projects: [], sessions: [] },
    });
    const browserClosed = once(browser, "close");
    const hostClosed = once(host, "close");
    browser.close(1000, "done");
    await browserClosed;
    await hostClosed;
    assert.equal(relay.instance.getRoomCount(), 0);

    const second = await connect(relay.socketURL);
    const secondClosed = once(second, "close");
    hello(second, "browser");
    const replacementHost = await connect(relay.socketURL);
    const replacementClosed = once(replacementHost, "close");
    hello(replacementHost, "host");
    await replacementClosed;
    await secondClosed;
    second.close();
    replacementHost.close();
  } finally {
    host.close();
    browser.close();
    await relay.close();
  }
});

test("tunnel forwards model command frames unchanged", async () => {
  const relay = await fixture();
  const host = await connect(relay.socketURL);
  const browser = await connect(relay.socketURL);
  try {
    hello(host, "host");
    await nextFrame(host);
    const browserReady = nextFrame(browser);
    const hostReady = nextFrame(host);
    hello(browser, "browser");
    await browserReady;
    await hostReady;
    for (const [command, body] of [
      ["models.get", { sessionID: "session" }],
      ["model.set", { sessionID: "session", modelId: "xai/grok" }],
      ["subagentModel.set", { agent: "explore", model: "" }],
    ]) {
      const requestID = crypto.randomUUID();
      const forwarded = nextFrame(host);
      browser.send(JSON.stringify({ v: 1, type: "request", requestID, command, body }));
      assert.deepEqual(await forwarded, { v: 1, type: "request", requestID, command, body });
      const response = nextFrame(browser);
      host.send(JSON.stringify({
        v: 1, type: "response", requestID, status: 200, body: { accepted: true },
      }));
      assert.deepEqual(await response, {
        v: 1, type: "response", requestID, status: 200, body: { accepted: true },
      });
    }
  } finally {
    host.close();
    browser.close();
    await relay.close();
  }
});

test("browser may arrive just before host without letting wrong secret consume", async () => {
  const relay = await fixture();
  const wrong = await connect(relay.socketURL);
  const valid = await connect(relay.socketURL);
  const host = await connect(relay.socketURL);
  try {
    hello(wrong, "browser", wrongSecret);
    hello(valid, "browser");
    const hostRegistered = nextFrame(host);
    const validReady = nextFrame(valid);
    const hostReady = nextFrame(host);
    const wrongClosed = once(wrong, "close");
    hello(host, "host");
    assert.equal((await hostRegistered).type, "host-ready");
    assert.equal((await validReady).type, "ready");
    assert.equal((await hostReady).type, "ready");
    await wrongClosed;
  } finally {
    valid.close();
    host.close();
    wrong.close();
    await relay.close();
  }
});
