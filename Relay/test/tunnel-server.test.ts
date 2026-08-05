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
    // The 64-hex secret must stay in the URL fragment so one copied link works
    // everywhere; the page must not strip it via history.replaceState.
    assert.ok(html.indexOf("location.hash") < html.indexOf('import("/assets/tunnel-browser.js")'));
    assert.doesNotMatch(html, /history\.replaceState/);
    assert.doesNotMatch(html, /trystero|RTCPeerConnection|pair\/claim|api\/devices/i);
    assert.match(html, /PipiUI 远程会话/);
    assert.match(html, /id="root"/);
    assert.match(html, /id="boot-status"/);
    assert.match(html, /\/assets\/tunnel-browser\.css/);
    assert.equal((await fetch(`${relay.origin}/assets/tunnel-browser.js`)).status, 200);
    assert.equal((await fetch(`${relay.origin}/assets/tunnel-browser.css`)).status, 200);
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

test("wrong secret and role are rejected without breaking a later valid attach", async () => {
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
    const browserClosed = once(browser, "close");
    browser.send("null");
    await browserClosed;
    // Malformed authenticated frame closes only the sender; the room and host
    // survive (browser disconnect no longer kills the room).
    assert.equal(relay.instance.getRoomCount(), 1);
    await waitUntil(
      () => relay.instance.getClientCount() === 1,
      "malformed authenticated frame retained the host too",
    );
    assert.deepEqual(await (await fetch(`${relay.origin}/healthz`)).json(), { ok: true });
    // Intentional host teardown (explicit end frame) is what ends the room.
    const hostClosed = once(host, "close");
    host.send(JSON.stringify({ v: 1, type: "end" }));
    await hostClosed;
    await waitUntil(
      () => relay.instance.getClientCount() === 0
        && relay.instance.getRoomCount() === 0,
      "host teardown retained a client or room",
    );
    assert.deepEqual(await (await fetch(`${relay.origin}/healthz`)).json(), { ok: true });
  } finally {
    await relay.close();
  }
});

test("tunnel relays frames; browser and host disconnect do not kill the room", async () => {
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
    browser.close(1000, "done");
    await browserClosed;
    // Browser disconnect must NOT kill the room: the pairID stays connectable.
    assert.equal(relay.instance.getRoomCount(), 1);

    const second = await connect(relay.socketURL);
    const secondReady = nextFrame(second);
    const hostReadySecond = nextFrame(host);
    hello(second, "browser");
    await secondReady;
    await hostReadySecond;

    // Host drop without an explicit end frame only clears room.host; the room
    // stays connectable so the host can rejoin within the TTL.
    const hostClosed = once(host, "close");
    host.close(1000, "done");
    await hostClosed;
    assert.equal(relay.instance.getRoomCount(), 1);

    // A new host re-joins the same room; the attached browser reconnects.
    const host2 = await connect(relay.socketURL);
    const host2Ready = nextFrame(host2);
    const secondReady2 = nextFrame(second);
    hello(host2, "host");
    assert.equal((await host2Ready).type, "host-ready");
    assert.equal((await secondReady2).type, "ready");

    // Intentional end from the (new) host invalidates + tombstones the room.
    const host2Closed = once(host2, "close");
    const secondClosed = once(second, "close");
    host2.send(JSON.stringify({ v: 1, type: "end" }));
    await host2Closed;
    await secondClosed;
    assert.equal(relay.instance.getRoomCount(), 0);
    second.close();
    host2.close();
  } finally {
    host.close();
    browser.close();
    await relay.close();
  }
});

test("host drop without end survives; browser fails gracefully until host rejoins", async () => {
  const relay = await fixture();
  const hostA = await connect(relay.socketURL);
  try {
    hello(hostA, "host");
    await nextFrame(hostA);

    const browser = await connect(relay.socketURL);
    const bReady = nextFrame(browser);
    const hostReadyA = nextFrame(hostA);
    hello(browser, "browser");
    await bReady;
    await hostReadyA;

    // Host A drops without an end frame: room survives, host cleared.
    const hostAClosed = once(hostA, "close");
    hostA.close(1000, "drop");
    await hostAClosed;
    assert.equal(relay.instance.getRoomCount(), 1);

    // Browser request while host is offline fails gracefully (no hang/crash).
    const requestID = "c88d9390-b890-4928-930b-015f56498cb0";
    const offlineError = nextFrame(browser);
    browser.send(JSON.stringify({
      v: 1, type: "request", requestID, command: "index", body: {},
    }));
    assert.deepEqual(await offlineError, {
      v: 1, type: "error", requestID, message: "host offline",
    });

    // Host B rejoins the same room; it gets host-ready then ready (the browser
    // is already attached), and the attached browser gets ready again too.
    const hostB = await connect(relay.socketURL);
    const hostBReady = nextFrame(hostB);
    const hostBAccepted = nextFrame(hostB);
    const bReady2 = nextFrame(browser);
    hello(hostB, "host");
    assert.equal((await hostBReady).type, "host-ready");
    assert.equal((await hostBAccepted).type, "ready");
    assert.equal((await bReady2).type, "ready");

    // Requests relay again after the host rejoins.
    const requestID2 = "c88d9390-b890-4928-930b-015f56498cb1";
    const forwarded = nextFrame(hostB);
    browser.send(JSON.stringify({
      v: 1, type: "request", requestID: requestID2, command: "index", body: {},
    }));
    assert.deepEqual(await forwarded, {
      v: 1, type: "request", requestID: requestID2, command: "index", body: {},
    });
    const response = nextFrame(browser);
    hostB.send(JSON.stringify({
      v: 1, type: "response", requestID: requestID2, status: 200, body: { sessions: [] },
    }));
    assert.deepEqual(await response, {
      v: 1, type: "response", requestID: requestID2, status: 200, body: { sessions: [] },
    });
  } finally {
    hostA.close();
    await relay.close();
  }
});

test("host re-hello replaces the previous host socket; wrong secret rejected", async () => {
  const relay = await fixture();
  const hostA = await connect(relay.socketURL);
  try {
    hello(hostA, "host");
    await nextFrame(hostA);

    const hostAClosed = once(hostA, "close");
    const hostB = await connect(relay.socketURL);
    const hostBReady = nextFrame(hostB);
    hello(hostB, "host");
    assert.equal((await hostBReady).type, "host-ready");
    await hostAClosed; // A is closed (replaced).
    assert.equal(relay.instance.getRoomCount(), 1);

    // Mismatched secret on an existing room is still rejected.
    const hostC = await connect(relay.socketURL);
    const hostCClosed = once(hostC, "close");
    hello(hostC, "host", wrongSecret);
    await hostCClosed;
    assert.equal(relay.instance.getRoomCount(), 1);
  } finally {
    hostA.close();
    await relay.close();
  }
});

test("last browser wins and disconnect does not kill the room", async () => {
  const relay = await fixture();
  const host = await connect(relay.socketURL);
  const browserA = await connect(relay.socketURL);
  try {
    hello(host, "host");
    await nextFrame(host);
    const aReady = nextFrame(browserA);
    const hostReadyA = nextFrame(host);
    hello(browserA, "browser");
    await aReady;
    await hostReadyA;

    // Browser B attaches with the same correct secret -> A is closed, B is active.
    const browserB = await connect(relay.socketURL);
    const aClosed = once(browserA, "close");
    const bReady = nextFrame(browserB);
    const hostReadyB = nextFrame(host);
    hello(browserB, "browser");
    await bReady;
    await hostReadyB;
    await aClosed;

    // B is now THE browser and can relay requests.
    const requestID = "c88d9390-b890-4928-930b-015f56498cb0";
    const forwarded = nextFrame(host);
    browserB.send(JSON.stringify({
      v: 1, type: "request", requestID, command: "index", body: {},
    }));
    assert.deepEqual(await forwarded, {
      v: 1, type: "request", requestID, command: "index", body: {},
    });
    const response = nextFrame(browserB);
    host.send(JSON.stringify({
      v: 1, type: "response", requestID, status: 200, body: { projects: [] },
    }));
    assert.deepEqual(await response, {
      v: 1, type: "response", requestID, status: 200, body: { projects: [] },
    });

    // B disconnects -> room stays; C reattaches successfully within the TTL.
    const bClosed = once(browserB, "close");
    browserB.close(1000, "done");
    await bClosed;
    assert.equal(relay.instance.getRoomCount(), 1);

    const browserC = await connect(relay.socketURL);
    const cReady = nextFrame(browserC);
    const hostReadyC = nextFrame(host);
    hello(browserC, "browser");
    await cReady;
    await hostReadyC;
  } finally {
    host.close();
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
