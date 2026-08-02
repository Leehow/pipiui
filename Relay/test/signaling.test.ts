import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  MAX_SIGNALING_CANDIDATES,
  MAX_SIGNALING_PER_DEVICE,
  MAX_REVOCATION_ASSOCIATIONS,
  SIGNALING_TTL_MS,
  REVOCATION_LEASE_MS,
  SignalingRegistry,
  activeLeaseExpiresAt,
  parseBrowserConnect,
  sdpSHA256Fingerprint,
} from "../src/signaling.js";

const deviceID = randomUUID();
const browserNonce = randomBytes(32).toString("base64url");
const fingerprint = `sha-256 ${Array(32).fill("AB").join(":")}`;
const offerSDP = `v=0\r\na=fingerprint:${fingerprint}\r\n`;
const fingerprintVectors = (JSON.parse(readFileSync(
  new URL(
    "../../Tests/Fixtures/RemotePeerSDPFingerprintVectors.json",
    import.meta.url,
  ),
  "utf8",
)) as Array<{ name: string; sdp: string; expected: string | null }>).map(
  (vector) => ({
    ...vector,
    sdp: vector.sdp.replaceAll(
      "{{AB32}}",
      Array(32).fill("AB").join(":"),
    ),
  }),
);

function connectInput() {
  return {
    v: 1 as const,
    deviceID,
    browserNonce,
    offerSDP,
    offerFingerprint: fingerprint,
  };
}

test("browser connect schema is exact and bounded", () => {
  assert.deepEqual(parseBrowserConnect(connectInput()), connectInput());
  assert.equal(parseBrowserConnect({ ...connectInput(), extra: true }), null);
  assert.equal(parseBrowserConnect({ ...connectInput(), browserNonce: "short" }), null);
  assert.equal(parseBrowserConnect({
    ...connectInput(),
    offerSDP: `v=0${"x".repeat(128 * 1024)}`,
  }), null);
  assert.equal(parseBrowserConnect({
    ...connectInput(),
    offerFingerprint: "sha-256 AA",
  }), null);
  assert.equal(parseBrowserConnect({
    ...connectInput(),
    offerSDP: "v=0\r\n",
  }), null);
  assert.equal(parseBrowserConnect({
    ...connectInput(),
    offerSDP: `v=0\r\na=fingerprint:${fingerprint.replaceAll("AB", "CD")}\r\n`,
  }), null);
  assert.equal(parseBrowserConnect({
    ...connectInput(),
    offerSDP: `v=0\r\na=fingerprint:${fingerprint}\r\na=fingerprint:sha-1 AA\r\n`,
  }), null);
  assert.equal(parseBrowserConnect({
    ...connectInput(),
    offerSDP: `v=0\r\na=fingerprint:${fingerprint}\r\na=fingerprint:${
      fingerprint.replaceAll("AB", "CD")
    }\r\n`,
  }), null);
  assert.equal(
    sdpSHA256Fingerprint(
      `v=0\na=fingerprint:SHA-256 ${Array(32).fill("ab").join(":")}\n`,
    ),
    fingerprint,
  );
});

test("shared SDP fingerprint vectors match offers and answers", () => {
  for (const vector of fingerprintVectors) {
    assert.equal(
      sdpSHA256Fingerprint(vector.sdp),
      vector.expected,
      `${vector.name}: canonical result`,
    );
    const parsed = parseBrowserConnect({
      ...connectInput(),
      offerSDP: vector.sdp,
      offerFingerprint: vector.expected ?? fingerprint,
    });
    assert.equal(
      parsed !== null,
      vector.expected !== null,
      `${vector.name}: offer acceptance`,
    );

    const registry = new SignalingRegistry(() => 1_000);
    const created = registry.create("cf:vector", connectInput());
    assert(created);
    const accepted = registry.acceptDevice(deviceID, {
      v: 1,
      type: "signal.answer",
      connectionID: created.session.connectionID,
      deviceID,
      direction: "device-to-browser",
      sequence: 1,
      expiresAt: created.session.expiresAt,
      hostNonce: randomBytes(32).toString("base64url"),
      hostEpoch: randomUUID(),
      offerFingerprint: fingerprint,
      answerFingerprint: vector.expected ?? fingerprint,
      answerSDP: vector.sdp,
      signatureDER: randomBytes(72).toString("base64url"),
    });
    assert.equal(
      accepted !== null,
      vector.expected !== null,
      `${vector.name}: answer acceptance`,
    );
  }
});

test("device close is terminal but remains subject-pollable until expiry", () => {
  let now = 10_000;
  const registry = new SignalingRegistry(() => now);
  const created = registry.create("cf:subject-a", connectInput());
  assert(created);
  const close = {
    v: 1 as const,
    type: "signal.close" as const,
    connectionID: created.session.connectionID,
    deviceID,
    direction: "device-to-browser" as const,
    sequence: 1,
    expiresAt: created.session.expiresAt,
    reason: "host closed",
  };
  assert.deepEqual(registry.acceptDevice(deviceID, close), close);
  assert.equal(registry.session(created.session.connectionID)?.terminal, true);
  assert.deepEqual(
    registry.poll("cf:subject-a", created.session.connectionID, 0),
    [close],
  );
  const lateICE = {
    v: 1 as const,
    type: "signal.ice" as const,
    connectionID: created.session.connectionID,
    deviceID,
    direction: "device-to-browser" as const,
    sequence: 2,
    expiresAt: created.session.expiresAt,
    candidate: "candidate:late 1 UDP 1 192.0.2.1 9 typ host",
    sdpMid: "0",
    sdpMLineIndex: 0,
  };
  assert.equal(registry.acceptDevice(deviceID, lateICE), null);
  assert.equal(registry.acceptDevice(deviceID, { ...close, sequence: 2 }), null);
  assert.equal(registry.acceptDevice(deviceID, {
    v: 1,
    type: "signal.answer",
    connectionID: created.session.connectionID,
    deviceID,
    direction: "device-to-browser",
    sequence: 2,
    expiresAt: created.session.expiresAt,
    hostNonce: randomBytes(32).toString("base64url"),
    hostEpoch: randomUUID(),
    offerFingerprint: fingerprint,
    answerFingerprint: fingerprint,
    answerSDP: offerSDP,
    signatureDER: randomBytes(72).toString("base64url"),
  }), null);
  assert.equal(registry.acceptBrowser("cf:subject-a", created.session.connectionID, {
    ...lateICE,
    direction: "browser-to-device",
  }), null);
  now = created.session.expiresAt;
  assert.equal(registry.poll("cf:subject-a", created.session.connectionID, 0), null);
  assert.equal(registry.count(), 0);
});

test("signaling registry enforces subject device sequence expiry and replay", () => {
  let now = 1_000;
  const registry = new SignalingRegistry(() => now);
  const created = registry.create("cf:subject-a", connectInput());
  assert(created);
  assert.equal(created.offer.sequence, 1);
  assert.equal(created.offer.direction, "browser-to-device");
  assert.equal(created.session.expiresAt, now + SIGNALING_TTL_MS);

  const answer = {
    v: 1 as const,
    type: "signal.answer" as const,
    connectionID: created.session.connectionID,
    deviceID,
    direction: "device-to-browser" as const,
    sequence: 1,
    expiresAt: created.session.expiresAt,
    hostNonce: randomBytes(32).toString("base64url"),
    hostEpoch: randomUUID(),
    offerFingerprint: fingerprint,
    answerFingerprint: fingerprint.replaceAll("AB", "CD"),
    answerSDP: `v=0\r\na=fingerprint:${fingerprint.replaceAll("AB", "CD")}\r\n`,
    signatureDER: randomBytes(72).toString("base64url"),
  };
  assert.deepEqual(registry.acceptDevice(deviceID, answer), answer);
  assert.equal(registry.acceptDevice(deviceID, answer), null);
  assert.equal(registry.acceptDevice(randomUUID(), { ...answer, sequence: 2 }), null);
  assert.equal(registry.poll("cf:subject-b", created.session.connectionID, 0), null);
  assert.deepEqual(
    registry.poll("cf:subject-a", created.session.connectionID, 0),
    [answer],
  );
  assert.deepEqual(registry.poll("cf:subject-a", created.session.connectionID, 1), []);

  const browserICE = {
    v: 1 as const,
    type: "signal.ice" as const,
    connectionID: created.session.connectionID,
    deviceID,
    direction: "browser-to-device" as const,
    sequence: 2,
    expiresAt: created.session.expiresAt,
    candidate: "candidate:1 1 UDP 1 192.0.2.1 9 typ host",
    sdpMid: "0",
    sdpMLineIndex: 0,
  };
  assert.deepEqual(
    registry.acceptBrowser("cf:subject-a", created.session.connectionID, browserICE),
    browserICE,
  );
  assert.equal(
    registry.acceptBrowser("cf:subject-a", created.session.connectionID, browserICE),
    null,
  );

  now += SIGNALING_TTL_MS;
  assert.equal(registry.poll("cf:subject-a", created.session.connectionID, 0), null);
  assert.equal(registry.count(), 0);
});

test("signaling caps outstanding sessions and candidate floods", () => {
  const registry = new SignalingRegistry(() => 1_000);
  const sessions = [];
  for (let index = 0; index < MAX_SIGNALING_PER_DEVICE; index += 1) {
    const created = registry.create(`cf:subject-${index}`, {
      ...connectInput(),
      browserNonce: randomBytes(32).toString("base64url"),
    });
    assert(created);
    sessions.push(created.session);
  }
  assert.equal(registry.create("cf:overflow", connectInput()), null);

  const session = sessions[0];
  for (let index = 0; index < MAX_SIGNALING_CANDIDATES; index += 1) {
    assert(registry.acceptDevice(deviceID, {
      v: 1,
      type: "signal.ice",
      connectionID: session.connectionID,
      deviceID,
      direction: "device-to-browser",
      sequence: index + 1,
      expiresAt: session.expiresAt,
      candidate: `candidate:${index} 1 UDP 1 192.0.2.1 9 typ host`,
      sdpMid: "0",
      sdpMLineIndex: 0,
    }));
  }
  assert.equal(registry.acceptDevice(deviceID, {
    v: 1,
    type: "signal.ice",
    connectionID: session.connectionID,
    deviceID,
    direction: "device-to-browser",
    sequence: MAX_SIGNALING_CANDIDATES + 1,
    expiresAt: session.expiresAt,
    candidate: "candidate:overflow 1 UDP 1 192.0.2.1 9 typ host",
    sdpMid: "0",
    sdpMLineIndex: 0,
  }), null);

  registry.closeDevice(deviceID);
  assert.equal(registry.count(), 0);
});

test("revocation associations outlive signaling but retire exactly", () => {
  let now = 5_000;
  const registry = new SignalingRegistry(() => now);
  const subjectA = "cf:subject-a";
  const subjectB = "cf:subject-b";
  const first = registry.create(subjectA, connectInput());
  const second = registry.create(subjectA, {
    ...connectInput(),
    browserNonce: randomBytes(32).toString("base64url"),
  });
  const unrelated = registry.create(subjectB, {
    ...connectInput(),
    browserNonce: randomBytes(32).toString("base64url"),
  });
  assert(first && second && unrelated);

  now += SIGNALING_TTL_MS;
  assert.equal(registry.session(first.session.connectionID), null);
  assert.deepEqual(
    registry.revokeSubjectDevice(subjectA, deviceID),
    [first.session.connectionID, second.session.connectionID].sort(),
  );
  assert.deepEqual(
    registry.revokeSubjectDevice(subjectB, deviceID),
    [unrelated.session.connectionID],
  );
});

test("retained association accepts exact terminal close and expires at max lease", () => {
  let now = 9_000;
  const registry = new SignalingRegistry(() => now);
  const created = registry.create("cf:subject", connectInput());
  assert(created);
  now += SIGNALING_TTL_MS;
  const close = {
    v: 1 as const,
    type: "signal.close" as const,
    connectionID: created.session.connectionID,
    deviceID,
    direction: "device-to-browser" as const,
    sequence: 1,
    expiresAt: created.session.expiresAt,
    reason: "peer closed",
  };
  assert.deepEqual(registry.acceptDevice(deviceID, close), close);
  assert.deepEqual(registry.revokeSubjectDevice("cf:subject", deviceID), []);

  const expiring = registry.create("cf:subject", {
    ...connectInput(),
    browserNonce: randomBytes(32).toString("base64url"),
  });
  assert(expiring);
  now += SIGNALING_TTL_MS + REVOCATION_LEASE_MS;
  assert.deepEqual(registry.revokeSubjectDevice("cf:subject", deviceID), []);
});

test("active lease is one absolute signaling-derived boundary independent of bind delay", () => {
  const createdAt = 100_000;
  const signalingDeadline = createdAt + SIGNALING_TTL_MS;
  const deadline = activeLeaseExpiresAt(signalingDeadline);
  assert.equal(deadline, signalingDeadline + REVOCATION_LEASE_MS);
  for (const bindDelay of [0, SIGNALING_TTL_MS - 1]) {
    assert.equal(
      activeLeaseExpiresAt(signalingDeadline),
      deadline,
      `bind delay ${bindDelay} must not move the absolute lease`,
    );
  }

  let beforeNow = createdAt;
  const before = new SignalingRegistry(() => beforeNow);
  const beforeCreated = before.create("cf:lease", connectInput());
  assert(beforeCreated);
  beforeNow = deadline - 1;
  assert.deepEqual(
    before.revokeSubjectDevice("cf:lease", deviceID),
    [beforeCreated.session.connectionID],
  );

  let boundaryNow = createdAt;
  const atBoundary = new SignalingRegistry(() => boundaryNow);
  assert(atBoundary.create("cf:lease", connectInput()));
  boundaryNow = deadline;
  assert.deepEqual(atBoundary.revokeSubjectDevice("cf:lease", deviceID), []);
});

test("device signaling replacement closes offers without discarding revocation ownership", () => {
  const registry = new SignalingRegistry(() => 12_000);
  const created = registry.create("cf:subject", connectInput());
  assert(created);
  registry.closeDevice(deviceID);
  assert.equal(registry.session(created.session.connectionID), null);
  assert.deepEqual(
    registry.revokeSubjectDevice("cf:subject", deviceID),
    [created.session.connectionID],
  );
});

test("retained ownership caps one subject across expired negotiations until terminal close", () => {
  let now = 20_000;
  const registry = new SignalingRegistry(() => now);
  const created: Array<NonNullable<ReturnType<SignalingRegistry["create"]>>> = [];
  for (let index = 0; index < MAX_SIGNALING_PER_DEVICE; index += 1) {
    const item = registry.create("cf:capped-subject", {
      ...connectInput(),
      deviceID: randomUUID(),
      browserNonce: randomBytes(32).toString("base64url"),
    });
    assert(item);
    created.push(item);
  }
  now += SIGNALING_TTL_MS;
  assert.equal(registry.count(), 0);
  assert.equal(registry.create("cf:capped-subject", {
    ...connectInput(),
    deviceID: randomUUID(),
    browserNonce: randomBytes(32).toString("base64url"),
  }), null);

  const unrelated = registry.create("cf:unrelated", {
    ...connectInput(),
    deviceID: randomUUID(),
    browserNonce: randomBytes(32).toString("base64url"),
  });
  assert(unrelated);
  const retired = created[0];
  assert(registry.acceptBrowser(
    "cf:capped-subject",
    retired.session.connectionID,
    {
      v: 1,
      type: "signal.close",
      connectionID: retired.session.connectionID,
      deviceID: retired.session.deviceID,
      direction: "browser-to-device",
      sequence: 2,
      expiresAt: retired.session.expiresAt,
      reason: "browser closed",
    },
  ));
  assert(registry.create("cf:capped-subject", {
    ...connectInput(),
    deviceID: randomUUID(),
    browserNonce: randomBytes(32).toString("base64url"),
  }));
});

test("retained ownership caps one device while unrelated devices remain available", () => {
  let now = 30_000;
  const registry = new SignalingRegistry(() => now);
  for (let index = 0; index < MAX_SIGNALING_PER_DEVICE; index += 1) {
    assert(registry.create(`cf:device-user-${index}`, {
      ...connectInput(),
      browserNonce: randomBytes(32).toString("base64url"),
    }));
  }
  now += SIGNALING_TTL_MS;
  assert.equal(registry.create("cf:device-overflow", {
    ...connectInput(),
    browserNonce: randomBytes(32).toString("base64url"),
  }), null);
  assert(registry.create("cf:unrelated-device", {
    ...connectInput(),
    deviceID: randomUUID(),
    browserNonce: randomBytes(32).toString("base64url"),
  }));
});

test("global retained ownership cap remains fail-closed", () => {
  let now = 40_000;
  const registry = new SignalingRegistry(() => now);
  for (let index = 0; index < MAX_REVOCATION_ASSOCIATIONS; index += 1) {
    if (index > 0 && index % 1_024 === 0) now += SIGNALING_TTL_MS;
    assert(registry.create(`cf:global-${index}`, {
      ...connectInput(),
      deviceID: randomUUID(),
      browserNonce: randomBytes(32).toString("base64url"),
    }));
  }
  now += SIGNALING_TTL_MS;
  assert.equal(registry.create("cf:global-overflow", {
    ...connectInput(),
    deviceID: randomUUID(),
    browserNonce: randomBytes(32).toString("base64url"),
  }), null);
});
