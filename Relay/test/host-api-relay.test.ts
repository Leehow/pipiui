import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import WebSocket from "ws";
import { createTunnelServer } from "../src/tunnel-server.js";
import {
  PAIR_COOKIE,
  hashHex,
  pairCookie,
  type HostAPIV2Limits,
} from "../src/host-api-v2.js";

const secretA = "ab".repeat(32);
const secretB = "cd".repeat(32);
const hostTokenA = "11".repeat(32);
const hostTokenB = "22".repeat(32);

type FrameQueue = {
  values: string[];
  waiters: Array<(value: string) => void>;
};

const queues = new WeakMap<WebSocket, FrameQueue>();

function installQueue(socket: WebSocket): void {
  const queue: FrameQueue = { values: [], waiters: [] };
  queues.set(socket, queue);
  socket.on("message", (data) => {
    const text = String(data);
    const waiter = queue.waiters.shift();
    if (waiter) waiter(text);
    else queue.values.push(text);
  });
}

async function nextRaw(socket: WebSocket): Promise<string> {
  const queue = queues.get(socket);
  assert.ok(queue);
  const value = queue.values.shift();
  if (value !== undefined) return value;
  if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
    throw new Error("socket closed");
  }
  return new Promise((resolve, reject) => {
    const onClose = () => {
      const queued = queue.values.shift();
      if (queued !== undefined) resolve(queued);
      else reject(new Error("socket closed"));
    };
    socket.once("close", onClose);
    queue.waiters.push((text) => {
      socket.off("close", onClose);
      resolve(text);
    });
  });
}

async function nextFrame(socket: WebSocket): Promise<Record<string, unknown>> {
  return JSON.parse(await nextRaw(socket)) as Record<string, unknown>;
}

async function waitUntil(
  predicate: () => boolean,
  message: string,
  timeoutMS = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMS;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

async function fixture(overrides: {
  browserUIDir?: string;
  v2TTLMs?: number;
  v2Limits?: Partial<HostAPIV2Limits>;
  v2SecureCookies?: boolean;
  publicOrigin?: string;
} = {}) {
  const instance = createTunnelServer({
    host: "127.0.0.1",
    port: 0,
    publicOrigin: overrides.publicOrigin ?? "http://127.0.0.1",
    tunnelURL: "ws://127.0.0.1/tunnel/ws",
    browserUIDir: overrides.browserUIDir ?? join(tmpdir(), "pipiui-missing-browser-ui"),
    v2TTLMs: overrides.v2TTLMs,
    v2Limits: overrides.v2Limits,
    v2SecureCookies: overrides.v2SecureCookies,
  });
  instance.server.listen(0, "127.0.0.1");
  await once(instance.server, "listening");
  const address = instance.server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    instance,
    origin,
    hostURL: `ws://127.0.0.1:${address.port}/relay/host`,
    browserURL: `ws://127.0.0.1:${address.port}/ws`,
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

async function connect(url: string, cookie?: string): Promise<WebSocket> {
  const socket = new WebSocket(url, cookie ? { headers: { Cookie: cookie } } : undefined);
  installQueue(socket);
  await once(socket, "open");
  return socket;
}

function hello(roomID: string, hostToken: string, pairSecret: string) {
  return {
    v: 2,
    type: "hello",
    roomID,
    hostToken,
    pairSecretHash: hashHex(pairSecret),
  };
}

async function openHost(
  url: string,
  roomID: string,
  hostToken: string,
  pairSecret: string,
): Promise<WebSocket> {
  const socket = await connect(url);
  socket.send(JSON.stringify(hello(roomID, hostToken, pairSecret)));
  const ready = await nextFrame(socket);
  assert.equal(ready.type, "ready");
  assert.equal(ready.v, 2);
  return socket;
}

function cookieHeader(setCookie: string | null): string {
  assert.ok(setCookie);
  const match = new RegExp(`${PAIR_COOKIE}=([^;]+)`).exec(setCookie);
  assert.ok(match);
  return `${PAIR_COOKIE}=${match[1]}`;
}

async function claim(
  origin: string,
  roomID: string,
  secret: string,
): Promise<Response> {
  return fetch(`${origin}/pair/${roomID}/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret }),
  });
}

test("v2 pairing claim sets HttpOnly cookie and never puts the fragment on the page", async () => {
  const roomID = randomUUID();
  const relay = await fixture({
    publicOrigin: "https://relay.test",
    v2SecureCookies: true,
  });
  const host = await openHost(relay.hostURL, roomID, hostTokenA, secretA);
  try {
    const page = await fetch(`${relay.origin}/pair/${roomID}`);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.doesNotMatch(html, new RegExp(secretA));
    assert.match(html, /location\.hash/);
    assert.match(html, /\/pair\/.+\/claim/);
    assert.match(html, /location\.pathname\+location\.hash/);
    assert.match(html, /location\.reload\(\)/);
    assert.doesNotMatch(html, /location\.replace\("\/"\)/);
    assert.doesNotMatch(html, /replaceState\(null,"","\/"\)/);
    assert.doesNotMatch(html, /tunnel-browser/);

    const rejected = await claim(relay.origin, roomID, secretB);
    assert.equal(rejected.status, 403);
    assert.equal(rejected.headers.get("set-cookie"), null);

    const tokenAsSecret = await claim(relay.origin, roomID, hostTokenA);
    assert.equal(tokenAsSecret.status, 403);

    const ok = await claim(relay.origin, roomID, secretA);
    assert.equal(ok.status, 204);
    const setCookie = ok.headers.get("set-cookie");
    assert.match(setCookie ?? "", new RegExp(`^${PAIR_COOKIE}=`));
    assert.match(setCookie ?? "", /HttpOnly/i);
    assert.match(setCookie ?? "", /SameSite=Strict/i);
    assert.match(setCookie ?? "", /Secure/i);
    assert.doesNotMatch(setCookie ?? "", new RegExp(secretA));

    const reloaded = await fetch(`${relay.origin}/pair/${roomID}`, {
      headers: { Cookie: cookieHeader(setCookie) },
    });
    const reloadedHTML = await reloaded.text();
    assert.equal(reloaded.status, 200);
    assert.doesNotMatch(reloadedHTML, /正在安全连接服务器/);
    assert.match(reloadedHTML, /data-fallback="browser-ui-missing"/);
    const stillInterstitial = await fetch(`${relay.origin}/pair/${roomID}`);
    assert.match(await stillInterstitial.text(), /正在安全连接服务器/);
  } finally {
    host.close();
    await relay.close();
  }
});

test("unauthenticated browser UI and /ws are rejected", async () => {
  const roomID = randomUUID();
  const relay = await fixture();
  const host = await openHost(relay.hostURL, roomID, hostTokenA, secretA);
  try {
    const root = await fetch(`${relay.origin}/`);
    assert.equal(root.status, 200);
    assert.match(await root.text(), /pi coding agent 的图形界面/);

    const denied = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(relay.browserURL);
      socket.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      socket.on("open", () => reject(new Error("unauthenticated /ws opened")));
      socket.on("error", () => undefined);
    });
    assert.equal(denied, 401);

    await claim(relay.origin, roomID, secretA);
    const stillDeniedWithoutCookie = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(relay.browserURL);
      socket.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      socket.on("open", () => reject(new Error("cookie-less /ws opened after claim")));
      socket.on("error", () => undefined);
    });
    assert.equal(stillDeniedWithoutCookie, 401);
  } finally {
    host.close();
    await relay.close();
  }
});

test("host and browser pair with separated host token and pair secret", async () => {
  const roomID = randomUUID();
  const relay = await fixture();
  const host = await openHost(relay.hostURL, roomID, hostTokenA, secretA);
  try {
    const wrongHost = await connect(relay.hostURL);
    const closed = once(wrongHost, "close");
    wrongHost.send(JSON.stringify(hello(roomID, hostTokenB, secretA)));
    await closed;
    assert.equal(relay.instance.getV2RoomCount(), 1);

    const granted = await claim(relay.origin, roomID, secretA);
    const cookie = cookieHeader(granted.headers.get("set-cookie"));
    const paired = nextFrame(host);
    const browser = await connect(relay.browserURL, cookie);
    const notice = await paired;
    assert.equal(notice.type, "paired");
    assert.equal(notice.v, 2);
    browser.close();
  } finally {
    host.close();
    await relay.close();
  }
});

test("transparent request-response-event forwarding preserves business JSON", async () => {
  const roomID = randomUUID();
  const relay = await fixture();
  const host = await openHost(relay.hostURL, roomID, hostTokenA, secretA);
  const granted = await claim(relay.origin, roomID, secretA);
  const browser = await connect(
    relay.browserURL,
    cookieHeader(granted.headers.get("set-cookie")),
  );
  await nextFrame(host);
  try {
    const request =
      '{"type":"request","method":"listProjects","params":[],"id":"req-1","protocolVersion":2,"extra":true}';
    const forwarded = nextRaw(host);
    browser.send(request);
    assert.equal(await forwarded, request);

    const response =
      '{"ok":true,"type":"response","id":"req-1","result":[{"id":"p"}],"protocolVersion":2}';
    const returned = nextRaw(browser);
    host.send(response);
    assert.equal(await returned, response);

    const event =
      '{"type":"event","protocolVersion":2,"channel":"stream","event":{"type":"status","sessionId":"s"}}';
    const pushed = nextRaw(browser);
    host.send(event);
    assert.equal(await pushed, event);
  } finally {
    browser.close();
    host.close();
    await relay.close();
  }
});

test("second browser claim replaces the first socket and cookie", async () => {
  const roomID = randomUUID();
  const relay = await fixture();
  const host = await openHost(relay.hostURL, roomID, hostTokenA, secretA);
  const firstGrant = await claim(relay.origin, roomID, secretA);
  const firstCookie = cookieHeader(firstGrant.headers.get("set-cookie"));
  const first = await connect(relay.browserURL, firstCookie);
  await nextFrame(host);
  try {
    const firstClosed = once(first, "close");
    const secondGrant = await claim(relay.origin, roomID, secretA);
    const [code, reason] = await firstClosed;
    assert.equal(code, 4001);
    assert.equal(String(reason), "replaced");
    const secondCookie = cookieHeader(secondGrant.headers.get("set-cookie"));
    assert.notEqual(secondCookie, firstCookie);

    const staleDenied = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(relay.browserURL, { headers: { Cookie: firstCookie } });
      socket.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      socket.on("open", () => reject(new Error("stale cookie opened /ws")));
      socket.on("error", () => undefined);
    });
    assert.equal(staleDenied, 401);

    const second = await connect(relay.browserURL, secondCookie);
    await nextFrame(host);
    const request = {
      protocolVersion: 2,
      id: "after-replace",
      type: "request",
      method: "listProjects",
      params: [],
    };
    const forwarded = nextFrame(host);
    second.send(JSON.stringify(request));
    assert.deepEqual(await forwarded, request);
    second.close();
  } finally {
    first.close();
    host.close();
    await relay.close();
  }
});

test("host generation replace drops late frames from the previous host", async () => {
  const roomID = randomUUID();
  const relay = await fixture();
  const hostA = await openHost(relay.hostURL, roomID, hostTokenA, secretA);
  const granted = await claim(relay.origin, roomID, secretA);
  const browser = await connect(
    relay.browserURL,
    cookieHeader(granted.headers.get("set-cookie")),
  );
  const firstPaired = await nextFrame(hostA);
  assert.equal(firstPaired.type, "paired");
  try {
    const request = {
      protocolVersion: 2,
      id: "live-1",
      type: "request",
      method: "listProjects",
      params: [],
    };
    const toA = nextFrame(hostA);
    browser.send(JSON.stringify(request));
    assert.deepEqual(await toA, request);

    const hostAClosed = once(hostA, "close");
    const hostB = await openHost(relay.hostURL, roomID, hostTokenA, secretA);
    const [code] = await hostAClosed;
    assert.equal(code, 4001);
    const replaced = await nextFrame(hostA).catch(() => ({ type: "closed" }));
    assert.ok(replaced.type === "replaced" || replaced.type === "closed");
    const pairedB = await nextFrame(hostB);
    assert.equal(pairedB.type, "paired");
    assert.equal(pairedB.hostEpoch, 2);

    hostA.send(JSON.stringify({
      protocolVersion: 2,
      id: "live-1",
      type: "response",
      ok: true,
      result: "stale",
      hostEpoch: 1,
    }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const browserQueue = queues.get(browser);
    assert.ok(browserQueue);
    assert.equal(browserQueue.values.length, 0);

    const request2 = {
      protocolVersion: 2,
      id: "live-2",
      type: "request",
      method: "listProjects",
      params: [],
    };
    const toB = nextFrame(hostB);
    browser.send(JSON.stringify(request2));
    assert.deepEqual(await toB, request2);
    const returned = nextRaw(browser);
    const response = JSON.stringify({
      protocolVersion: 2,
      id: "live-2",
      type: "response",
      ok: true,
      result: ["fresh"],
    });
    hostB.send(response);
    assert.equal(await returned, response);
    hostB.close();
  } finally {
    browser.close();
    hostA.close();
    await relay.close();
  }
});

test("two rooms stay isolated", async () => {
  const roomA = randomUUID();
  const roomB = randomUUID();
  const relay = await fixture();
  const host1 = await openHost(relay.hostURL, roomA, hostTokenA, secretA);
  const host2 = await openHost(relay.hostURL, roomB, hostTokenB, secretB);
  const cookie1 = cookieHeader((await claim(relay.origin, roomA, secretA)).headers.get("set-cookie"));
  const cookie2 = cookieHeader((await claim(relay.origin, roomB, secretB)).headers.get("set-cookie"));
  const browser1 = await connect(relay.browserURL, cookie1);
  const browser2 = await connect(relay.browserURL, cookie2);
  await nextFrame(host1);
  await nextFrame(host2);
  try {
    const requestA = {
      protocolVersion: 2,
      id: "room-a",
      type: "request",
      method: "listProjects",
      params: ["keep-a"],
    };
    const requestB = {
      protocolVersion: 2,
      id: "room-b",
      type: "request",
      method: "listSessions",
      params: ["keep-b"],
    };
    const seen1 = nextFrame(host1);
    const seen2 = nextFrame(host2);
    browser1.send(JSON.stringify(requestA));
    browser2.send(JSON.stringify(requestB));
    assert.deepEqual(await seen1, requestA);
    assert.deepEqual(await seen2, requestB);

    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(queues.get(host1)?.values.length, 0);

    const eventA = JSON.stringify({
      protocolVersion: 2,
      type: "event",
      channel: "stream",
      event: { type: "text", sessionId: "a" },
    });
    const pushed = nextRaw(browser1);
    host1.send(eventA);
    assert.equal(await pushed, eventA);
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(queues.get(browser2)?.values.length, 0);
  } finally {
    browser1.close();
    browser2.close();
    host1.close();
    host2.close();
    await relay.close();
  }
});

test("wrong direction, version, and over-limit frames are rejected", async () => {
  const roomID = randomUUID();
  const relay = await fixture({
    v2Limits: {
      maxInflight: 1,
      maxRequestBytes: 256,
      maxFramesPerWindow: 40,
    },
  });
  const host = await openHost(relay.hostURL, roomID, hostTokenA, secretA);
  const cookie = cookieHeader((await claim(relay.origin, roomID, secretA)).headers.get("set-cookie"));
  const browser = await connect(relay.browserURL, cookie);
  await nextFrame(host);
  try {
    const wrongDirection = once(browser, "close");
    browser.send(JSON.stringify({
      protocolVersion: 2,
      id: "nope",
      type: "response",
      ok: true,
      result: null,
    }));
    const [directionCode] = await wrongDirection;
    assert.equal(directionCode, 1008);

    const browser2 = await connect(relay.browserURL, cookie);
    await nextFrame(host);
    const versionClosed = once(browser2, "close");
    browser2.send(JSON.stringify({
      protocolVersion: 1,
      id: "old",
      type: "request",
      method: "listProjects",
      params: [],
    }));
    const [versionCode] = await versionClosed;
    assert.equal(versionCode, 1008);

    const browser3 = await connect(relay.browserURL, cookie);
    await nextFrame(host);
    const first = {
      protocolVersion: 2,
      id: "inflight",
      type: "request",
      method: "listProjects",
      params: [],
    };
    const forwarded = nextFrame(host);
    browser3.send(JSON.stringify(first));
    assert.deepEqual(await forwarded, first);
    const limited = once(browser3, "close");
    browser3.send(JSON.stringify({
      protocolVersion: 2,
      id: "overflow",
      type: "request",
      method: "listProjects",
      params: [],
    }));
    await limited;

    const browser4 = await connect(relay.browserURL, cookie);
    await nextFrame(host);
    const oversized = once(browser4, "close");
    browser4.send(JSON.stringify({
      protocolVersion: 2,
      id: "huge",
      type: "request",
      method: "listProjects",
      params: ["x".repeat(300)],
    }));
    const [sizeCode] = await oversized;
    assert.equal(sizeCode, 1009);

    const hostClosed = once(host, "close");
    host.send(JSON.stringify({
      protocolVersion: 2,
      id: "host-req",
      type: "request",
      method: "listProjects",
      params: [],
    }));
    const [hostCode] = await hostClosed;
    assert.equal(hostCode, 1008);
  } finally {
    await relay.close();
  }
});

test("TTL expiry and explicit host end close the room", async () => {
  const roomID = randomUUID();
  const relay = await fixture({ v2TTLMs: 250 });
  const host = await openHost(relay.hostURL, roomID, hostTokenA, secretA);
  const cookie = cookieHeader((await claim(relay.origin, roomID, secretA)).headers.get("set-cookie"));
  const browser = await connect(relay.browserURL, cookie);
  await nextFrame(host);
  try {
    const hostClosed = once(host, "close");
    const browserClosed = once(browser, "close");
    await hostClosed;
    await browserClosed;
    await waitUntil(
      () => relay.instance.getV2RoomCount() === 0,
      "expired room was retained",
    );
    const lateClaim = await claim(relay.origin, roomID, secretA);
    assert.equal(lateClaim.status, 403);
  } finally {
    await relay.close();
  }

  const room2 = randomUUID();
  const relay2 = await fixture();
  const host2 = await openHost(relay2.hostURL, room2, hostTokenA, secretA);
  const cookie2 = cookieHeader((await claim(relay2.origin, room2, secretA)).headers.get("set-cookie"));
  const browser2 = await connect(relay2.browserURL, cookie2);
  await nextFrame(host2);
  try {
    const endedHost = once(host2, "close");
    const endedBrowser = once(browser2, "close");
    host2.send(JSON.stringify({ v: 2, type: "end" }));
    await endedHost;
    await endedBrowser;
    await waitUntil(
      () => relay2.instance.getV2RoomCount() === 0,
      "ended room was retained",
    );
    assert.equal((await claim(relay2.origin, room2, secretA)).status, 403);
  } finally {
    await relay2.close();
  }
});

test("static UI fallback when the browser build is missing, and serves files when present", async () => {
  const roomID = randomUUID();
  const missing = await fixture();
  const host = await openHost(missing.hostURL, roomID, hostTokenA, secretA);
  try {
    const cookie = cookieHeader((await claim(missing.origin, roomID, secretA)).headers.get("set-cookie"));
    const page = await fetch(`${missing.origin}/`, { headers: { Cookie: cookie } });
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /data-fallback="browser-ui-missing"/);
    assert.equal(
      (await fetch(`${missing.origin}/assets/app.js`, { headers: { Cookie: cookie } })).status,
      404,
    );
  } finally {
    host.close();
    await missing.close();
  }

  const dir = await mkdtemp(join(tmpdir(), "pipiui-browser-ui-"));
  await writeFile(join(dir, "index.html"), "<!doctype html><div id=\"root\" data-browser-ui=\"ok\"></div><script src=\"/assets/app.js\"></script>");
  await writeFile(join(dir, "app.js"), "window.__PIPIUI_BROWSER__=true;");
  const assetsDir = join(dir, "assets");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(assetsDir);
  await writeFile(join(assetsDir, "app.js"), "window.__PIPIUI_BROWSER__=true;");

  const room2 = randomUUID();
  const present = await fixture({ browserUIDir: dir });
  const host2 = await openHost(present.hostURL, room2, hostTokenA, secretA);
  try {
    const cookie = cookieHeader((await claim(present.origin, room2, secretA)).headers.get("set-cookie"));
    const page = await fetch(`${present.origin}/`, { headers: { Cookie: cookie } });
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /data-browser-ui="ok"/);
    const pairAfterClaim = await fetch(`${present.origin}/pair/${room2}`, {
      headers: { Cookie: cookie },
    });
    assert.equal(pairAfterClaim.status, 200);
    assert.match(await pairAfterClaim.text(), /data-browser-ui="ok"/);
    const asset = await fetch(`${present.origin}/assets/app.js`, { headers: { Cookie: cookie } });
    assert.equal(asset.status, 200);
    assert.equal(await asset.text(), "window.__PIPIUI_BROWSER__=true;");
    assert.equal(
      (await fetch(`${present.origin}/assets/app.js`)).status,
      404,
    );
  } finally {
    host2.close();
    await present.close();
  }
});

test("v2 pair page is not used for ordinary Swift tunnel rooms", async () => {
  const relay = await fixture();
  try {
    const page = await fetch(`${relay.origin}/pair/${randomUUID()}`);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /tunnel-browser\.js/);
    assert.doesNotMatch(html, /\/claim/);
    assert.equal((await fetch(`${relay.origin}/api/pair/claim`)).status, 404);
    assert.equal(pairCookie(randomBytes(32).toString("base64url"), 60, true).includes("Secure"), true);
    assert.equal(createHash("sha256").update(secretA, "utf8").digest("hex"), hashHex(secretA));
  } finally {
    await relay.close();
  }
});

test("v2 inbound app ping counts as alive without a websocket pong", async () => {
  const roomID = randomUUID();
  const relay = await fixture({ v2Limits: { heartbeatMs: 80 } });
  const host = await openHost(relay.hostURL, roomID, hostTokenA, secretA);
  const cookie = cookieHeader((await claim(relay.origin, roomID, secretA)).headers.get("set-cookie"));
  const browser = new WebSocket(relay.browserURL, {
    headers: { Cookie: cookie },
    autoPong: false,
  } as WebSocket.ClientOptions);
  installQueue(browser);
  await once(browser, "open");
  await nextFrame(host);
  try {
    const closed = once(browser, "close");
    const keepAlive = setInterval(() => {
      browser.send(JSON.stringify({ v: 2, type: "ping", at: Date.now() }));
    }, 40);
    const raced = await Promise.race([
      closed.then(() => "closed"),
      new Promise<string>((resolve) => setTimeout(() => resolve("open"), 280)),
    ]);
    clearInterval(keepAlive);
    assert.equal(raced, "open");
    assert.equal(browser.readyState, WebSocket.OPEN);
  } finally {
    browser.close();
    host.close();
    await relay.close();
  }
});
