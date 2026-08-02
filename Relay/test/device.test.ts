import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  KeyObject,
  randomBytes,
  randomUUID,
  sign,
  webcrypto,
} from "node:crypto";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import vm from "node:vm";
import WebSocket from "ws";
import {
  DeviceAuthChallenge,
  deviceAuthTranscript,
  pairCreateTranscript,
  parseDeviceAuthProof,
} from "../src/protocol.js";
import { createRelayServer, RelayOptions } from "../src/server.js";
import { DeviceStore } from "../src/store.js";
import { fetchWithHost as fetch } from "./support.js";

const publicOrigin = "https://pipi.aichattrpg.com";
const deviceSignalOrigin = "https://signal.aichattrpg.com";
const subjectA = "subject-a";
const subjectB = "subject-b";
const tokenA = "access-a-v1";
const tokenARenewed = "access-a-v2";
const tokenB = "access-b-v1";
const sockets: WebSocket[] = [];
const servers: Array<ReturnType<typeof createRelayServer>["server"]> = [];

async function waitUntil(predicate: () => boolean, timeoutMS = 1_000) {
  const deadline = Date.now() + timeoutMS;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

afterEach(async () => {
  while (sockets.length) {
    const ws = sockets.pop()!;
    if (ws.readyState === WebSocket.CLOSED) continue;
    const closed = once(ws, "close");
    ws.close();
    await closed;
  }
  while (servers.length) {
    const server = servers.pop()!;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

function identity() {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = keys.publicKey.export({ format: "jwk" });
  assert(jwk.x && jwk.y);
  const point = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, "base64url"),
    Buffer.from(jwk.y, "base64url"),
  ]);
  return {
    deviceID: randomUUID(),
    privateKey: keys.privateKey,
    publicKeyX963: point.toString("base64url"),
    fingerprint: createHash("sha256").update(point).digest("hex"),
  };
}

async function start(overrides: Partial<RelayOptions> = {}) {
  const relay = createRelayServer({
    host: "127.0.0.1",
    port: 0,
    publicOrigin,
    deviceSignalOrigin,
    requireAccessIdentity: true,
    accessVerifier: {
      async verify(assertion: string) {
        if (assertion === tokenA || assertion === tokenARenewed) {
          return { subject: `cf:${subjectA}`, email: "a@example.test" };
        }
        if (assertion === tokenB) {
          return { subject: `cf:${subjectB}`, email: "b@example.test" };
        }
        return null;
      },
    },
    ...overrides,
  });
  relay.server.listen(0, "127.0.0.1");
  await once(relay.server, "listening");
  const address = relay.server.address();
  assert(address && typeof address === "object");
  servers.push(relay.server);
  return { ...relay, port: address.port };
}

function wsURL(port: number): string {
  return `ws://127.0.0.1:${port}/device/ws`;
}

async function nextJSON(ws: WebSocket): Promise<Record<string, unknown>> {
  const [data] = await once(ws, "message");
  return JSON.parse(data.toString()) as Record<string, unknown>;
}

async function nextFrameOfType(
  ws: WebSocket,
  type: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const listener = (data: import("ws").RawData) => {
      const value = JSON.parse(data.toString()) as Record<string, unknown>;
      if (value.type !== type) return;
      ws.off("message", listener);
      resolve(value);
    };
    ws.on("message", listener);
  });
}

function signedProof(
  challenge: DeviceAuthChallenge,
  id: ReturnType<typeof identity>,
  privateKey: KeyObject = id.privateKey,
) {
  const hostEpoch = randomUUID();
  const signatureDER = sign(
    "sha256",
    deviceAuthTranscript(challenge, {
      deviceID: id.deviceID,
      hostEpoch,
      fingerprint: id.fingerprint,
    }),
    { key: privateKey, dsaEncoding: "der" },
  ).toString("base64url");
  return {
    v: 1,
    type: "auth.proof",
    deviceID: id.deviceID,
    publicKeyX963: id.publicKeyX963,
    fingerprint: id.fingerprint,
    connectionID: challenge.connectionID,
    expiresAt: challenge.expiresAt,
    hostEpoch,
    clientVersion: "test",
    displayName: "Test Mac",
    signatureDER,
  };
}

async function connectDevice(
  port: number,
  id: ReturnType<typeof identity>,
) {
  const ws = new WebSocket(wsURL(port), {
    headers: { host: new URL(deviceSignalOrigin).host },
  });
  sockets.push(ws);
  const challengeMessage = once(ws, "message");
  await once(ws, "open");
  const [challengeData] = await challengeMessage;
  const challenge = JSON.parse(
    challengeData.toString(),
  ) as unknown as DeviceAuthChallenge;
  const proof = signedProof(challenge, id);
  const resultMessage = once(ws, "message");
  ws.send(JSON.stringify(proof));
  const [resultData] = await resultMessage;
  const result = JSON.parse(resultData.toString()) as Record<string, unknown>;
  assert.equal(result.type, "auth.result");
  return { ws, challenge, proof, result };
}

function pairFrame(
  id: ReturnType<typeof identity>,
  secret: Buffer,
  expiresAt: number,
) {
  const pairID = randomUUID();
  const secretHash = createHash("sha256").update(secret).digest("hex");
  const body = {
    pairID,
    deviceID: id.deviceID,
    fingerprint: id.fingerprint,
    secretHash,
    expiresAt,
  };
  return {
    v: 1,
    type: "pair.create",
    ...body,
    signatureDER: sign(
      "sha256",
      pairCreateTranscript(body),
      { key: id.privateKey, dsaEncoding: "der" },
    ).toString("base64url"),
  };
}

async function csrf(port: number, assertion: string) {
  const response = await fetch(`http://127.0.0.1:${port}/`, {
    headers: {
      host: new URL(publicOrigin).host,
      "cf-access-jwt-assertion": assertion,
    },
  });
  const token = response.headers.get("set-cookie")?.match(/pipiui_csrf=([^;]+)/)?.[1];
  assert(token);
  return token;
}

async function claim(
  port: number,
  assertion: string,
  frame: ReturnType<typeof pairFrame>,
  secret: Buffer,
) {
  const token = await csrf(port, assertion);
  return fetch(`http://127.0.0.1:${port}/api/pair/claim`, {
    method: "POST",
    headers: {
      host: new URL(publicOrigin).host,
      "cf-access-jwt-assertion": assertion,
      "content-type": "application/json",
      origin: publicOrigin,
      cookie: `pipiui_csrf=${token}`,
      "x-pipiui-csrf": token,
    },
    body: JSON.stringify({
      v: 1,
      pairID: frame.pairID,
      pairSecret: secret.toString("base64url"),
      fingerprint: frame.fingerprint,
    }),
  });
}

async function createPair(
  ws: WebSocket,
  id: ReturnType<typeof identity>,
  expiresAt: number,
) {
  const secret = randomBytes(32);
  const frame = pairFrame(id, secret, expiresAt);
  const created = once(ws, "message");
  ws.send(JSON.stringify(frame));
  const [data] = await created;
  const result = JSON.parse(data.toString()) as Record<string, unknown>;
  assert.equal(result.type, "pair.created");
  return { frame, secret };
}

test("device auth uses proof of possession without shared Cloudflare headers", async () => {
  const relay = await start();
  const id = identity();
  const connected = await connectDevice(relay.port, id);
  assert.equal(connected.result.enrollmentStatus, "pending");
  assert.equal(connected.result.commandAuthorized, false);
  assert.equal(relay.store.device(id.deviceID)?.publicKeyX963, id.publicKeyX963);
  const replayed = once(connected.ws, "close");
  connected.ws.send(JSON.stringify(connected.proof));
  const [code, reason] = await replayed;
  assert.equal(code, 1008);
  assert.equal(reason.toString(), "authentication failed");
});

test("closing the current authenticated device revokes its pending pair", async () => {
  const clock = 40_000;
  const relay = await start({ now: () => clock });
  const id = identity();
  const connected = await connectDevice(relay.port, id);
  const pending = await createPair(connected.ws, id, clock + 60_000);
  const closed = once(connected.ws, "close");
  connected.ws.close();
  await closed;
  assert.equal(
    (await claim(relay.port, tokenA, pending.frame, pending.secret)).status,
    403,
  );
});

test("device replacement revokes old pending pair but delayed old close cannot revoke new pair", async () => {
  const clock = 50_000;
  const relay = await start({ now: () => clock });
  const id = identity();
  const oldConnection = await connectDevice(relay.port, id);
  const oldPair = await createPair(oldConnection.ws, id, clock + 60_000);
  const oldClosed = once(oldConnection.ws, "close");
  const replacement = await connectDevice(relay.port, id);
  const newPair = await createPair(replacement.ws, id, clock + 60_000);
  await oldClosed;

  assert.equal(
    (await claim(relay.port, tokenA, oldPair.frame, oldPair.secret)).status,
    403,
  );
  assert.equal(
    (await claim(relay.port, tokenA, newPair.frame, newPair.secret)).status,
    200,
  );
});

test("first authentication after Relay restart revokes durable pending pairs", async () => {
  const clock = 55_000;
  const directory = mkdtempSync(join(tmpdir(), "pipiui-relay-auth-epoch-"));
  const databasePath = join(directory, "relay.sqlite");
  const id = identity();
  const staleSecret = randomBytes(32);
  const staleFrame = pairFrame(id, staleSecret, clock + 60_000);
  const seed = new DeviceStore(databasePath, () => clock);
  assert(seed.registerOrVerifyDevice({
    deviceID: id.deviceID,
    publicKeyX963: id.publicKeyX963,
    fingerprint: id.fingerprint,
    displayName: "Seeded Mac",
  }));
  assert(seed.createPair({
    pairID: staleFrame.pairID,
    deviceID: id.deviceID,
    fingerprint: id.fingerprint,
    secretHash: staleFrame.secretHash,
    expiresAt: staleFrame.expiresAt,
  }));
  seed.close();

  const relay = await start({ databasePath, now: () => clock });
  const connected = await connectDevice(relay.port, id);
  assert.equal(
    relay.store.pair(staleFrame.pairID, id.deviceID)?.state,
    "revoked",
  );
  assert.equal(
    (await claim(relay.port, tokenA, staleFrame, staleSecret)).status,
    403,
  );
  const fresh = await createPair(connected.ws, id, clock + 60_000);
  assert.equal(
    (await claim(relay.port, tokenA, fresh.frame, fresh.secret)).status,
    200,
  );
});

test("device proof parser enforces the shared UTF-8 byte boundary", () => {
  const id = identity();
  const challenge: DeviceAuthChallenge = {
    v: 1,
    type: "auth.challenge",
    connectionID: randomUUID(),
    nonce: randomBytes(32).toString("base64url"),
    audience: deviceSignalOrigin,
    expiresAt: Date.now() + 4_000,
  };
  const proof = signedProof(challenge, id);
  proof.displayName = "你".repeat(26);
  proof.clientVersion = "版本".repeat(13);
  assert.equal(Buffer.byteLength(proof.displayName), 78);
  assert.equal(Buffer.byteLength(proof.clientVersion), 78);
  assert(parseDeviceAuthProof(JSON.stringify(proof)));
  proof.displayName = "你".repeat(27);
  assert.equal(Buffer.byteLength(proof.displayName), 81);
  assert.equal(parseDeviceAuthProof(JSON.stringify(proof)), null);
});

test("pair page removes the fragment before exact same-origin claim", async () => {
  const relay = await start();
  const pairID = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const response = await fetch(
    `http://127.0.0.1:${relay.port}/pair/${pairID}#v=1&s=${secret}`,
    {
      headers: {
        host: new URL(publicOrigin).host,
        "cf-access-jwt-assertion": tokenA,
      },
    },
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /history\.replaceState/);
  assert.match(html, /fetch\("\/api\/pair\/claim"/);
  assert(!html.includes(secret));
  assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  assert.match(response.headers.get("referrer-policy") ?? "", /no-referrer/);

  const script = html.match(/<script nonce="[^"]+">([\s\S]+)<\/script>/)?.[1];
  assert(script);
  const pairIdentity = identity();
  async function runPairPage(
    publicKeyX963: string,
    fragment = `v=1&s=${secret}&fp=${pairIdentity.fingerprint}`,
  ) {
    const status = { textContent: "正在打开配对链接…" };
    let cleared = false;
    let replaced = false;
    let fetchCount = 0;
    const context = {
      location: {
        hash: `#${fragment}`,
        pathname: `/pair/${pairID}`,
        replace(value: string) {
          assert.equal(value, "/");
          replaced = true;
        },
      },
      history: {
        replaceState() {
          cleared = true;
          context.location.hash = "";
        },
      },
      document: {
        cookie: "pipiui_csrf=test-csrf",
        getElementById() { return status; },
      },
      fetch: async () => {
        fetchCount += 1;
        assert.equal(cleared, true, "fragment must clear before claim I/O");
        return new Response(JSON.stringify({
          ok: true,
          deviceID: pairIdentity.deviceID,
          fingerprint: pairIdentity.fingerprint,
          publicKeyX963,
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
      crypto: webcrypto,
      Uint8Array,
      atob,
      btoa,
      Response,
      JSON,
      Promise,
    };
    vm.runInNewContext(script, context);
    await waitUntil(() => status.textContent !== "正在打开配对链接…");
    return { text: status.textContent, fetchCount, replaced };
  }
  const accepted = await runPairPage(pairIdentity.publicKeyX963);
  assert.match(accepted.text, /配对成功/);
  assert.equal(accepted.replaced, true);
  assert.match((await runPairPage("definitely-not-a-p256-key")).text, /配对失败/);
  const otherIdentity = identity();
  assert.match((await runPairPage(otherIdentity.publicKeyX963)).text, /配对失败/);
  const noncanonical = await runPairPage(
    pairIdentity.publicKeyX963,
    `v=1&s=${"A".repeat(42)}B&fp=${pairIdentity.fingerprint}`,
  );
  assert.match(noncanonical.text, /配对链接无效/);
  assert.equal(noncanonical.fetchCount, 0);
});

test("device can atomically revoke a pending pair before claim", async () => {
  const clock = 25_000;
  const relay = await start({ now: () => clock });
  const id = identity();
  const { ws } = await connectDevice(relay.port, id);
  const { frame, secret } = await createPair(ws, id, clock + 60_000);
  const statusMessage = once(ws, "message");
  ws.send(JSON.stringify({
    v: 1,
    type: "pair.revoke",
    pairID: frame.pairID,
    deviceID: id.deviceID,
  }));
  const [statusData] = await statusMessage;
  const status = JSON.parse(statusData.toString()) as Record<string, unknown>;
  assert.equal(status.state, "revoked");
  assert.equal((await claim(relay.port, tokenA, frame, secret)).status, 403);
});

test("wrong signature, expired challenge, and challenge replay fail generically", async () => {
  let clock = 10_000;
  const relay = await start({ now: () => clock });
  const firstID = identity();
  const wrongID = identity();
  const wrong = new WebSocket(wsURL(relay.port), {
    headers: { host: new URL(deviceSignalOrigin).host },
  });
  sockets.push(wrong);
  const wrongChallengeMessage = once(wrong, "message");
  await once(wrong, "open");
  const [wrongChallengeData] = await wrongChallengeMessage;
  const challenge = JSON.parse(
    wrongChallengeData.toString(),
  ) as unknown as DeviceAuthChallenge;
  wrong.send(JSON.stringify(signedProof(challenge, firstID, wrongID.privateKey)));
  const [wrongCode, wrongReason] = await once(wrong, "close");
  assert.equal(wrongCode, 1008);
  assert.equal(wrongReason.toString(), "authentication failed");

  const expired = new WebSocket(wsURL(relay.port), {
    headers: { host: new URL(deviceSignalOrigin).host },
  });
  sockets.push(expired);
  const expiredChallengeMessage = once(expired, "message");
  await once(expired, "open");
  const [expiredChallengeData] = await expiredChallengeMessage;
  const expiredChallenge = JSON.parse(
    expiredChallengeData.toString(),
  ) as unknown as DeviceAuthChallenge;
  const expiredProof = signedProof(expiredChallenge, firstID);
  clock = expiredChallenge.expiresAt + 1;
  expired.send(JSON.stringify(expiredProof));
  const [expiredCode] = await once(expired, "close");
  assert.equal(expiredCode, 1008);

  clock = 20_000;
  const replay = new WebSocket(wsURL(relay.port), {
    headers: { host: new URL(deviceSignalOrigin).host },
  });
  sockets.push(replay);
  const replayChallengeMessage = once(replay, "message");
  await once(replay, "open");
  await replayChallengeMessage;
  replay.send(JSON.stringify(expiredProof));
  const [replayCode] = await once(replay, "close");
  assert.equal(replayCode, 1008);
});

test("valid signed device proof is rejected at the exact challenge expiry", async () => {
  let clock = 30_000;
  const relay = await start({ now: () => clock });
  const id = identity();
  const ws = new WebSocket(wsURL(relay.port), {
    headers: { host: new URL(deviceSignalOrigin).host },
  });
  sockets.push(ws);
  const challengeMessage = once(ws, "message");
  await once(ws, "open");
  const [challengeData] = await challengeMessage;
  const challenge = JSON.parse(
    challengeData.toString(),
  ) as unknown as DeviceAuthChallenge;
  const proof = signedProof(challenge, id);
  clock = challenge.expiresAt;
  ws.send(JSON.stringify(proof));
  const [code, reason] = await once(ws, "close");
  assert.equal(code, 1008);
  assert.equal(reason.toString(), "authentication failed");
  assert.equal(relay.store.device(id.deviceID), null);
});

test("a failed first auth frame consumes the socket even when a valid proof is queued", async () => {
  const relay = await start();
  const id = identity();
  const attacker = identity();
  const ws = new WebSocket(wsURL(relay.port), {
    headers: { host: new URL(deviceSignalOrigin).host },
  });
  sockets.push(ws);
  const challengeMessage = once(ws, "message");
  await once(ws, "open");
  const [challengeData] = await challengeMessage;
  const challenge = JSON.parse(
    challengeData.toString(),
  ) as unknown as DeviceAuthChallenge;
  const received: Array<Record<string, unknown>> = [];
  ws.on("message", (data) => {
    received.push(JSON.parse(data.toString()) as Record<string, unknown>);
  });
  const closed = once(ws, "close");
  ws.send(JSON.stringify(signedProof(challenge, id, attacker.privateKey)));
  ws.send(JSON.stringify(signedProof(challenge, id)));
  const [code] = await closed;
  assert.equal(code, 1008);
  assert.equal(received.some((frame) => frame.type === "auth.result"), false);
  assert.equal(relay.store.device(id.deviceID), null);
});

test("pair claim is reusable across browsers and wrong secret/fingerprint reject", async () => {
  let clock = 50_000;
  const relay = await start({ now: () => clock });
  const id = identity();
  const { ws } = await connectDevice(relay.port, id);
  const { frame, secret } = await createPair(ws, id, clock + 60_000);

  const wrong = await claim(relay.port, tokenA, frame, randomBytes(32));
  assert.equal(wrong.status, 403);
  const wrongFingerprint = await claim(
    relay.port,
    tokenA,
    { ...frame, fingerprint: "0".repeat(64) },
    secret,
  );
  assert.equal(wrongFingerprint.status, 403);
  const accepted = await claim(relay.port, tokenA, frame, secret);
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), {
    ok: true,
    deviceID: id.deviceID,
    fingerprint: id.fingerprint,
    publicKeyX963: id.publicKeyX963,
  });
  const deviceList = await fetch(
    `http://127.0.0.1:${relay.port}/api/devices`,
    {
      headers: {
        host: new URL(publicOrigin).host,
        "cf-access-jwt-assertion": tokenA,
      },
    },
  );
  assert.equal(deviceList.status, 200);
  assert.deepEqual(await deviceList.json(), {
    devices: [{
      deviceID: id.deviceID,
      displayName: "Test Mac",
      online: true,
      publicKeyX963: id.publicKeyX963,
      fingerprint: id.fingerprint,
    }],
  });
  // The same link stays claimable by another browser after the first
  // pairing: claims do not consume the pair and each claim renews the
  // sliding one-hour TTL.
  const replay = await claim(relay.port, tokenB, frame, secret);
  assert.equal(replay.status, 200);
  assert.equal(relay.store.isBound(`cf:${subjectA}`, id.deviceID), true);
  assert.equal(relay.store.isBound(`cf:${subjectB}`, id.deviceID), true);
  const renewed = relay.store.pair(frame.pairID, id.deviceID);
  assert.equal(renewed?.state, "pending");
  assert.equal(renewed?.expiresAt, clock + 60 * 60 * 1_000);
});

test("accountless pair claim issues a hash-bound browser cookie and revoke invalidates it", async () => {
  const clock = 72_000;
  const relay = await start({
    now: () => clock,
    requireAccessIdentity: false,
  });
  const unpaired = await fetch(`http://127.0.0.1:${relay.port}/`, {
    headers: { host: new URL(publicOrigin).host },
  });
  assert.equal(unpaired.status, 200);
  const unpairedHTML = await unpaired.text();
  assert.match(unpairedHTML, /生成配对链接/);
  assert.doesNotMatch(unpairedHTML, /id="devices"/);

  const anonymousDevices = await fetch(
    `http://127.0.0.1:${relay.port}/api/devices`,
    { headers: { host: new URL(publicOrigin).host } },
  );
  assert.equal(anonymousDevices.status, 401);

  const id = identity();
  const { ws } = await connectDevice(relay.port, id);
  const created = await createPair(ws, id, clock + 60_000);
  const accepted = await claim(
    relay.port,
    "",
    created.frame,
    created.secret,
  );
  assert.equal(accepted.status, 200);
  const setCookie = accepted.headers.get("set-cookie") ?? "";
  const sessionToken = setCookie.match(/pipiui_session=([^;]+)/)?.[1];
  assert(sessionToken);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.match(setCookie, /Path=\//i);
  assert.match(setCookie, /Max-Age=2592000/i);
  const sessionSubject = `browser:${
    createHash("sha256")
      .update(Buffer.from(sessionToken, "base64url"))
      .digest("hex")
  }`;
  assert.equal(relay.store.isBound(sessionSubject, id.deviceID), true);
  assert.equal(relay.store.isBound(sessionToken, id.deviceID), false);
  assert.equal(
    relay.store.pair(created.frame.pairID, id.deviceID)?.state,
    "pending",
    "a successful claim must keep the pair reusable",
  );

  const sessionCookie = `pipiui_session=${sessionToken}`;
  const listed = await fetch(
    `http://127.0.0.1:${relay.port}/api/devices`,
    {
      headers: {
        host: new URL(publicOrigin).host,
        cookie: sessionCookie,
      },
    },
  );
  assert.equal(listed.status, 200);
  assert.equal((await listed.json() as { devices: unknown[] }).devices.length, 1);
  const randomSession = randomBytes(32).toString("base64url");
  const crossBinding = await fetch(
    `http://127.0.0.1:${relay.port}/api/devices`,
    {
      headers: {
        host: new URL(publicOrigin).host,
        cookie: `pipiui_session=${randomSession}`,
      },
    },
  );
  assert.equal(crossBinding.status, 401);
  // The same link still works for another browser: the anonymous claim binds
  // a fresh session subject instead of being rejected.
  const secondAccepted = await claim(relay.port, "", created.frame, created.secret);
  assert.equal(secondAccepted.status, 200);
  assert(secondAccepted.headers.get("set-cookie")?.includes("pipiui_session=") === true);

  const page = await fetch(`http://127.0.0.1:${relay.port}/`, {
    headers: {
      host: new URL(publicOrigin).host,
      cookie: sessionCookie,
    },
  });
  const csrfToken = page.headers.get("set-cookie")
    ?.match(/pipiui_csrf=([^;]+)/)?.[1];
  assert(csrfToken);
  assert.match(await page.text(), /id="devices"/);
  const revoked = await fetch(
    `http://127.0.0.1:${relay.port}/api/bindings/revoke`,
    {
      method: "POST",
      headers: {
        host: new URL(publicOrigin).host,
        origin: publicOrigin,
        cookie: `${sessionCookie}; pipiui_csrf=${csrfToken}`,
        "content-type": "application/json",
        "x-pipiui-csrf": csrfToken,
      },
      body: JSON.stringify({ v: 1, deviceID: id.deviceID }),
    },
  );
  assert.equal(revoked.status, 200);
  assert.match(revoked.headers.get("set-cookie") ?? "", /pipiui_session=.*Max-Age=0/i);
  assert.equal(relay.store.isBound(sessionSubject, id.deviceID), false);
  const afterRevoke = await fetch(
    `http://127.0.0.1:${relay.port}/api/devices`,
    {
      headers: {
        host: new URL(publicOrigin).host,
        cookie: sessionCookie,
      },
    },
  );
  assert.equal(afterRevoke.status, 401);
});

test("revoking the last binding never falls back to the legacy broker", async () => {
  const clock = 75_000;
  const relay = await start({ now: () => clock });
  const id = identity();
  const { ws } = await connectDevice(relay.port, id);
  const created = await createPair(ws, id, clock + 60_000);
  assert.equal(
    (await claim(relay.port, tokenA, created.frame, created.secret)).status,
    200,
  );
  const offerFingerprint = `sha-256 ${Array(32).fill("AA").join(":")}`;
  const offerSDP = `v=0\r\na=fingerprint:${offerFingerprint}\r\n`;
  const connectionA = relay.signaling.create(`cf:${subjectA}`, {
    v: 1,
    deviceID: id.deviceID,
    browserNonce: randomBytes(32).toString("base64url"),
    offerSDP,
    offerFingerprint,
  });
  const connectionA2 = relay.signaling.create(`cf:${subjectA}`, {
    v: 1,
    deviceID: id.deviceID,
    browserNonce: randomBytes(32).toString("base64url"),
    offerSDP,
    offerFingerprint,
  });
  const connectionB = relay.signaling.create(`cf:${subjectB}`, {
    v: 1,
    deviceID: id.deviceID,
    browserNonce: randomBytes(32).toString("base64url"),
    offerSDP,
    offerFingerprint,
  });
  assert(connectionA && connectionA2 && connectionB);
  const revokeControl = nextFrameOfType(ws, "binding.revoked");
  const token = await csrf(relay.port, tokenARenewed);
  const revoked = await fetch(
    `http://127.0.0.1:${relay.port}/api/bindings/revoke`,
    {
      method: "POST",
      headers: {
        host: new URL(publicOrigin).host,
        "cf-access-jwt-assertion": tokenARenewed,
        "content-type": "application/json",
        origin: publicOrigin,
        cookie: `pipiui_csrf=${token}`,
        "x-pipiui-csrf": token,
      },
      body: JSON.stringify({ v: 1, deviceID: id.deviceID }),
    },
  );
  assert.equal(revoked.status, 200);
  assert.deepEqual(await revokeControl, {
    v: 1,
    type: "binding.revoked",
    subject: `cf:${subjectA}`,
    deviceID: id.deviceID,
    connectionIDs: [
      connectionA.session.connectionID,
      connectionA2.session.connectionID,
    ].sort(),
  });
  assert.equal(relay.signaling.session(connectionA.session.connectionID), null);
  assert(relay.signaling.session(connectionB.session.connectionID));
  const routed = await fetch(`http://127.0.0.1:${relay.port}/api/index`, {
    headers: {
      host: new URL(publicOrigin).host,
      "cf-access-jwt-assertion": tokenARenewed,
      "x-pipiui-device-id": id.deviceID,
    },
  });
  assert.equal(routed.status, 403);
  assert.deepEqual(await routed.json(), { error: "device selection rejected" });
  assert.equal(relay.broker.requestCount(), 0);
});

test("binding remains revoked when its device control channel is unavailable", async () => {
  const clock = 80_000;
  const relay = await start({ now: () => clock });
  const id = identity();
  const connected = await connectDevice(relay.port, id);
  const created = await createPair(connected.ws, id, clock + 60_000);
  assert.equal(
    (await claim(relay.port, tokenA, created.frame, created.secret)).status,
    200,
  );
  const closed = once(connected.ws, "close");
  connected.ws.close();
  await closed;
  const token = await csrf(relay.port, tokenARenewed);
  const revoked = await fetch(
    `http://127.0.0.1:${relay.port}/api/bindings/revoke`,
    {
      method: "POST",
      headers: {
        host: new URL(publicOrigin).host,
        "cf-access-jwt-assertion": tokenARenewed,
        "content-type": "application/json",
        origin: publicOrigin,
        cookie: `pipiui_csrf=${token}`,
        "x-pipiui-csrf": token,
      },
      body: JSON.stringify({ v: 1, deviceID: id.deviceID }),
    },
  );
  assert.equal(revoked.status, 200);
  assert.equal(relay.store.isBound(`cf:${subjectA}`, id.deviceID), false);
});

test("device admission has bounded per-IP, global, and per-device limits", async () => {
  const perIPRelay = await start({
    abuseLimits: {
      maximumDeviceConnections: 4,
      maximumDeviceConnectionsPerIP: 1,
      maximumGlobalAuthAttempts: 10,
      maximumAuthAttemptsPerIP: 10,
    },
  });
  const held = new WebSocket(wsURL(perIPRelay.port), {
    headers: { host: new URL(deviceSignalOrigin).host },
  });
  sockets.push(held);
  await once(held, "open");
  const rejectedPerIP = new WebSocket(wsURL(perIPRelay.port), {
    headers: { host: new URL(deviceSignalOrigin).host },
  });
  const perIPStatus = await new Promise<number>((resolve, reject) => {
    rejectedPerIP.once("unexpected-response", (_request, response) => {
      resolve(response.statusCode ?? 0);
      response.destroy();
    });
    rejectedPerIP.once("error", reject);
  });
  assert.equal(perIPStatus, 429);

  const globalRelay = await start({
    trustCFConnectingIP: true,
    abuseLimits: {
      maximumDeviceConnections: 4,
      maximumDeviceConnectionsPerIP: 4,
      maximumGlobalAuthAttempts: 1,
      maximumAuthAttemptsPerIP: 4,
    },
  });
  const first = new WebSocket(wsURL(globalRelay.port), {
    headers: {
      host: new URL(deviceSignalOrigin).host,
      "cf-connecting-ip": "203.0.113.10",
    },
  });
  sockets.push(first);
  await once(first, "open");
  const rejectedGlobal = new WebSocket(wsURL(globalRelay.port), {
    headers: {
      host: new URL(deviceSignalOrigin).host,
      "cf-connecting-ip": "203.0.113.11",
    },
  });
  const globalStatus = await new Promise<number>((resolve, reject) => {
    rejectedGlobal.once("unexpected-response", (_request, response) => {
      resolve(response.statusCode ?? 0);
      response.destroy();
    });
    rejectedGlobal.once("error", reject);
  });
  assert.equal(globalStatus, 429);

  const pairRelay = await start({
    abuseLimits: { maximumPairCreatesPerDevice: 1 },
  });
  const id = identity();
  const connected = await connectDevice(pairRelay.port, id);
  await createPair(connected.ws, id, Date.now() + 60_000);
  const second = pairFrame(id, randomBytes(32), Date.now() + 60_000);
  const responseMessage = once(connected.ws, "message");
  connected.ws.send(JSON.stringify(second));
  const [responseData] = await responseMessage;
  const response = JSON.parse(responseData.toString()) as Record<string, unknown>;
  assert.equal(response.type, "pair.rejected");
  assert.equal(response.pairID, second.pairID);
});

test("two paired devices cannot cross-route commands", async () => {
  const clock = 100_000;
  const relay = await start({ now: () => clock });
  const a = identity();
  const b = identity();
  const aConnection = await connectDevice(relay.port, a);
  const bConnection = await connectDevice(relay.port, b);
  const aPair = await createPair(aConnection.ws, a, clock + 60_000);
  const bPair = await createPair(bConnection.ws, b, clock + 60_000);
  assert.equal((await claim(relay.port, tokenA, aPair.frame, aPair.secret)).status, 200);
  assert.equal((await claim(relay.port, tokenB, bPair.frame, bPair.secret)).status, 200);

  aConnection.ws.on("message", (data) => {
    const request = JSON.parse(data.toString()) as Record<string, unknown>;
    if (request.type !== "request") return;
    aConnection.ws.send(JSON.stringify({
      v: 1,
      type: "response",
      requestID: request.requestID,
      hostEpoch: aConnection.proof.hostEpoch,
      status: 200,
      body: { device: "a" },
    }));
  });
  bConnection.ws.on("message", (data) => {
    const request = JSON.parse(data.toString()) as Record<string, unknown>;
    if (request.type !== "request") return;
    bConnection.ws.send(JSON.stringify({
      v: 1,
      type: "response",
      requestID: request.requestID,
      hostEpoch: bConnection.proof.hostEpoch,
      status: 200,
      body: { device: "b" },
    }));
  });

  const responseA = await fetch(`http://127.0.0.1:${relay.port}/api/index`, {
    headers: {
      host: new URL(publicOrigin).host,
      "cf-access-jwt-assertion": tokenARenewed,
      "x-pipiui-device-id": a.deviceID,
    },
  });
  assert.deepEqual(await responseA.json(), { device: "a" });
  const cross = await fetch(`http://127.0.0.1:${relay.port}/api/index`, {
    headers: {
      host: new URL(publicOrigin).host,
      "cf-access-jwt-assertion": tokenARenewed,
      "x-pipiui-device-id": b.deviceID,
    },
  });
  assert.equal(cross.status, 403);
});

test("browser signaling routes only through its Access-bound device session", async () => {
  const relay = await start();
  const id = identity();
  const connected = await connectDevice(relay.port, id);
  const created = await createPair(
    connected.ws,
    id,
    Date.now() + 60_000,
  );
  assert.equal(
    (await claim(relay.port, tokenA, created.frame, created.secret)).status,
    200,
  );
  const csrfToken = await csrf(relay.port, tokenARenewed);
  const browserNonce = randomBytes(32).toString("base64url");
  const offerFingerprint = `sha-256 ${Array(32).fill("AA").join(":")}`;
  const offerSDP = `v=0\r\na=fingerprint:${offerFingerprint}\r\n`;
  const connectHeaders = {
    host: new URL(publicOrigin).host,
    "cf-access-jwt-assertion": tokenARenewed,
    "content-type": "application/json",
    origin: publicOrigin,
    cookie: `pipiui_csrf=${csrfToken}`,
    "x-pipiui-csrf": csrfToken,
  };
  for (const invalidSDP of [
    "v=0\r\n",
    `v=0\r\na=fingerprint:sha-256 ${Array(32).fill("CC").join(":")}\r\n`,
    `v=0\r\na=fingerprint:${offerFingerprint}\r\na=fingerprint:sha-1 AA\r\n`,
    `v=0\r\na=fingerprint:${offerFingerprint}\r\na=fingerprint:sha-256 ${
      Array(32).fill("DD").join(":")
    }\r\n`,
  ]) {
    const rejected = await fetch(
      `http://127.0.0.1:${relay.port}/api/connect`,
      {
        method: "POST",
        headers: connectHeaders,
        body: JSON.stringify({
          v: 1,
          deviceID: id.deviceID,
          browserNonce,
          offerSDP: invalidSDP,
          offerFingerprint,
        }),
      },
    );
    assert.equal(rejected.status, 403);
    assert.equal(relay.signaling.count(), 0);
  }
  const deviceOffer = nextFrameOfType(connected.ws, "signal.offer");
  const connect = await fetch(`http://127.0.0.1:${relay.port}/api/connect`, {
    method: "POST",
    headers: connectHeaders,
    body: JSON.stringify({
      v: 1,
      deviceID: id.deviceID,
      browserNonce,
      offerSDP,
      offerFingerprint,
    }),
  });
  assert.equal(connect.status, 201);
  const connection = await connect.json() as Record<string, unknown>;
  const offer = await deviceOffer;
  assert.equal(offer.connectionID, connection.connectionID);
  assert.equal(offer.deviceID, id.deviceID);
  assert.equal(offer.sequence, 1);
  assert.equal(offer.browserNonce, browserNonce);

  const answerFingerprint = `sha-256 ${Array(32).fill("BB").join(":")}`;
  connected.ws.send(JSON.stringify({
    v: 1,
    type: "signal.answer",
    connectionID: connection.connectionID,
    deviceID: id.deviceID,
    direction: "device-to-browser",
    sequence: 1,
    expiresAt: connection.expiresAt,
    hostNonce: randomBytes(32).toString("base64url"),
    hostEpoch: connected.proof.hostEpoch,
    offerFingerprint,
    answerFingerprint,
    answerSDP: `v=0\r\na=fingerprint:${answerFingerprint}\r\n`,
    signatureDER: randomBytes(64).toString("base64url"),
  }));

  const polled = await fetch(
    `http://127.0.0.1:${relay.port}/api/connect/${connection.connectionID}/signals?after=0`,
    {
      headers: {
        host: new URL(publicOrigin).host,
        "cf-access-jwt-assertion": tokenARenewed,
      },
    },
  );
  assert.equal(polled.status, 200);
  const pollBody = await polled.json() as {
    signals: Array<Record<string, unknown>>;
  };
  assert.equal(pollBody.signals.length, 1);
  assert.equal(pollBody.signals[0].type, "signal.answer");
  assert.equal(pollBody.signals[0].sequence, 1);

  const crossSubject = await fetch(
    `http://127.0.0.1:${relay.port}/api/connect/${connection.connectionID}/signals?after=0`,
    {
      headers: {
        host: new URL(publicOrigin).host,
        "cf-access-jwt-assertion": tokenB,
      },
    },
  );
  assert.equal(crossSubject.status, 403);

  const deviceICE = nextFrameOfType(connected.ws, "signal.ice");
  const browserICE = await fetch(
    `http://127.0.0.1:${relay.port}/api/connect/${connection.connectionID}/signal`,
    {
      method: "POST",
      headers: {
        host: new URL(publicOrigin).host,
        "cf-access-jwt-assertion": tokenARenewed,
        "content-type": "application/json",
        origin: publicOrigin,
        cookie: `pipiui_csrf=${csrfToken}`,
        "x-pipiui-csrf": csrfToken,
      },
      body: JSON.stringify({
        v: 1,
        type: "signal.ice",
        connectionID: connection.connectionID,
        deviceID: id.deviceID,
        direction: "browser-to-device",
        sequence: 2,
        expiresAt: connection.expiresAt,
        candidate: "candidate:1 1 udp 1 127.0.0.1 5000 typ host",
        sdpMid: "0",
        sdpMLineIndex: 0,
      }),
    },
  );
  assert.equal(browserICE.status, 202);
  assert.equal((await deviceICE).sequence, 2);
  const p2pBroker = relay.registry.broker(id.deviceID);
  assert(p2pBroker);
  assert.equal(p2pBroker.requestCount(), 0);

  connected.ws.on("message", (data) => {
    const request = JSON.parse(data.toString()) as Record<string, unknown>;
    if (request.type !== "request") return;
    connected.ws.send(JSON.stringify({
      v: 1,
      type: "response",
      requestID: request.requestID,
      hostEpoch: connected.proof.hostEpoch,
      status: 200,
      body: { transport: "explicit-fallback" },
    }));
  });
  const fallback = await fetch(
    `http://127.0.0.1:${relay.port}/api/index`,
    {
      headers: {
        host: new URL(publicOrigin).host,
        "cf-access-jwt-assertion": tokenARenewed,
        "x-pipiui-device-id": id.deviceID,
      },
    },
  );
  assert.equal(fallback.status, 200);
  assert.deepEqual(await fallback.json(), { transport: "explicit-fallback" });
  assert.equal(p2pBroker.requestCount(), 1);
});

test("restart preserves bindings and discards expired pending transactions", async () => {
  let clock = 200_000;
  const directory = mkdtempSync(join(tmpdir(), "pipiui-relay-"));
  const databasePath = join(directory, "relay.sqlite");
  const first = await start({ databasePath, now: () => clock });
  const bound = identity();
  const pending = identity();
  const boundConnection = await connectDevice(first.port, bound);
  const pendingConnection = await connectDevice(first.port, pending);
  const boundPair = await createPair(boundConnection.ws, bound, clock + 60_000);
  const pendingPair = await createPair(pendingConnection.ws, pending, clock + 1_000);
  assert.equal(
    (await claim(first.port, tokenA, boundPair.frame, boundPair.secret)).status,
    200,
  );
  const boundClosed = once(boundConnection.ws, "close");
  const pendingClosed = once(pendingConnection.ws, "close");
  boundConnection.ws.close();
  pendingConnection.ws.close();
  await Promise.all([boundClosed, pendingClosed]);
  await waitUntil(
    () => first.store.pair(pendingPair.frame.pairID, pending.deviceID)?.state
      === "revoked",
  );
  servers.pop();
  await new Promise<void>((resolve) => first.server.close(() => resolve()));

  clock += 2_000;
  const second = await start({ databasePath, now: () => clock });
  assert.equal(second.store.isBound(`cf:${subjectA}`, bound.deviceID), true);
  assert.equal(
    second.store.pair(pendingPair.frame.pairID, pending.deviceID)?.state,
    "revoked",
  );
  const expired = await claim(second.port, tokenB, pendingPair.frame, pendingPair.secret);
  assert.equal(expired.status, 403);
});
