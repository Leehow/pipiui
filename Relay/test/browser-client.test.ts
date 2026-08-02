import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  randomUUID,
  sign,
  webcrypto,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  ACTIVE_CONNECTION_LEASE_MS,
  ChunkReassembler,
  MutationUncertaintyLedger,
  RemoteP2PClient,
  bindingTranscript,
  classifySelectedCandidatePair,
  derSignatureToRaw,
  makeChunks,
  mutationScope,
  parseJSONExact,
  runTrackedRequest,
  revokeBrowserBinding,
  sdpSHA256Fingerprint,
  snapshotCommandBody,
  verifyBinding,
} from "../src/browser-client.js";

test("browser revoke is exact-CSRF, fail-closed, and records uncertainty", async () => {
  const deviceID = randomUUID();
  const ledger = new MutationUncertaintyLedger();
  let request: { url: string; init: RequestInit } | null = null;
  await revokeBrowserBinding({
    csrf: "csrf-token",
    deviceID,
    ledger,
    fetchImpl: async (url: string, init: RequestInit) => {
      request = { url, init };
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(request?.url, "/api/bindings/revoke");
  assert.equal(request?.init.headers["x-pipiui-csrf"], "csrf-token");
  assert.deepEqual(JSON.parse(String(request?.init.body)), { v: 1, deviceID });
  assert.deepEqual(ledger.list(), []);

  await assert.rejects(revokeBrowserBinding({
    csrf: "csrf-token",
    deviceID,
    ledger,
    fetchImpl: async () => { throw new Error("network result unknown"); },
  }), /network result unknown/);
  assert.equal(ledger.list().length, 1);
  assert.equal(ledger.list()[0].command, "binding.revoke");
  assert.equal(ledger.list()[0].scope, "global");
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function waitUntil(predicate: () => boolean, timeoutMS = 1_000) {
  const deadline = Date.now() + timeoutMS;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

function signedBinding(now = Date.now()) {
  const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = pair.publicKey.export({ format: "jwk" });
  const publicPoint = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x!, "base64url"),
    Buffer.from(jwk.y!, "base64url"),
  ]);
  const frame = {
    v: 1,
    type: "bind",
    connectionID: randomUUID(),
    deviceID: randomUUID(),
    publicKeyX963: publicPoint.toString("base64url"),
    deviceFingerprint: createHash("sha256").update(publicPoint).digest("hex"),
    hostEpoch: randomUUID(),
    browserNonce: Buffer.alloc(32, 1).toString("base64url"),
    hostNonce: Buffer.alloc(32, 2).toString("base64url"),
    expiresAt: now + 10_000,
    activeLeaseExpiresAt: now + 10_000 + ACTIVE_CONNECTION_LEASE_MS,
    offerFingerprint: `sha-256 ${Array(32).fill("AA").join(":")}`,
    answerFingerprint: `sha-256 ${Array(32).fill("BB").join(":")}`,
    signatureDER: "",
  };
  frame.signatureDER = sign(
    "sha256",
    Buffer.from(bindingTranscript(frame)),
    { key: pair.privateKey, dsaEncoding: "der" },
  ).toString("base64url");
  return { pair, publicPoint, frame };
}

test("browser SDP fingerprint parser matches the shared Swift/Relay vectors", () => {
  const vectors = JSON.parse(readFileSync(new URL(
    "../../Tests/Fixtures/RemotePeerSDPFingerprintVectors.json",
    import.meta.url,
  ), "utf8")) as Array<{ sdp: string; expected: string | null }>;
  for (const vector of vectors) {
    assert.equal(sdpSHA256Fingerprint(vector.sdp), vector.expected);
  }
});

test("browser binding verifies the pinned P-256 key and identical transcript", async () => {
  const now = Date.now();
  const { frame } = signedBinding(now);
  const expected = {
    connectionID: frame.connectionID,
    deviceID: frame.deviceID,
    publicKeyX963: frame.publicKeyX963,
    deviceFingerprint: frame.deviceFingerprint,
    browserNonce: frame.browserNonce,
    expiresAt: frame.expiresAt,
    offerFingerprint: frame.offerFingerprint,
    answerFingerprint: frame.answerFingerprint,
    hostNonce: frame.hostNonce,
    hostEpoch: frame.hostEpoch,
  };
  assert.equal(
    await verifyBinding(frame, expected, webcrypto, now),
    true,
  );
  assert.equal(derSignatureToRaw(Buffer.from(frame.signatureDER, "base64url")).length, 64);
  assert.equal(
    await verifyBinding(
      { ...frame, browserNonce: Buffer.alloc(32, 3).toString("base64url") },
      expected,
      webcrypto,
      now,
    ),
    false,
  );
  assert.equal(
    await verifyBinding(
      { ...frame, activeLeaseExpiresAt: frame.activeLeaseExpiresAt + 1 },
      expected,
      webcrypto,
      now,
    ),
    false,
  );
});

test("DER conversion rejects every non-minimal or non-positive encoding", () => {
  const canonical = Buffer.from(signedBinding().frame.signatureDER, "base64url");
  assert.equal(derSignatureToRaw(canonical).length, 64);
  const longSequence = Buffer.concat([
    Buffer.from([0x30, 0x81, canonical[1]]),
    canonical.subarray(2),
  ]);
  const hostile = [
    longSequence,
    Buffer.from([0x30, 0x80, ...canonical.subarray(2)]),
    Buffer.concat([canonical, Buffer.from([0])]),
    Buffer.from([0x30, 0x06, 0x02, 0x01, 0x00, 0x02, 0x01, 0x01]),
    Buffer.from([0x30, 0x06, 0x02, 0x01, 0x80, 0x02, 0x01, 0x01]),
    Buffer.from([0x30, 0x07, 0x02, 0x02, 0x00, 0x01, 0x02, 0x01, 0x01]),
    Buffer.from([0x30, 0x28, 0x02, 0x22, ...Buffer.alloc(34, 1), 0x02, 0x02, 1, 1]),
    Buffer.from([0x30, 0x07, 0x02, 0x81, 0x01, 0x01, 0x02, 0x01, 0x01]),
  ];
  for (const value of hostile) {
    assert.throws(() => derSignatureToRaw(value), /invalid DER signature/);
  }
});

test("browser chunk reassembly enforces duplicate, consistency, UTF-8 and expiry bounds", () => {
  const now = Date.now();
  const data = new TextEncoder().encode("x".repeat(70_000));
  const chunks = makeChunks(data, "response", randomUUID(), now + 10_000);
  const reassembler = new ChunkReassembler("response", () => now);
  assert.equal(reassembler.accept(chunks[0]), null);
  assert.deepEqual(reassembler.accept(chunks[1]), data);

  const duplicate = new ChunkReassembler("response", () => now);
  duplicate.accept(chunks[0]);
  assert.throws(() => duplicate.accept(chunks[0]), /inconsistent/);
  assert.throws(
    () => new ChunkReassembler("response", () => now)
      .accept({ ...chunks[0], expiresAt: now + 20_000 }),
    /invalid chunk/,
  );
  assert.throws(
    () => parseJSONExact('{"v":1,"v":1}'),
    /duplicate JSON key/,
  );
});

test("getStats classification is honest for host/srflx, relay and unknown", () => {
  const stats = (...values: Array<Record<string, unknown>>) => new Map(
    values.map((value) => [value.id, value]),
  );
  assert.equal(classifySelectedCandidatePair(stats(
    { id: "t", type: "transport", selectedCandidatePairId: "p" },
    { id: "p", type: "candidate-pair", localCandidateId: "l", remoteCandidateId: "r" },
    { id: "l", type: "local-candidate", candidateType: "host" },
    { id: "r", type: "remote-candidate", candidateType: "srflx" },
  )), "direct");
  assert.equal(classifySelectedCandidatePair(stats(
    { id: "p", type: "candidate-pair", nominated: true, state: "succeeded",
      localCandidateId: "l", remoteCandidateId: "r" },
    { id: "l", type: "local-candidate", candidateType: "relay" },
    { id: "r", type: "remote-candidate", candidateType: "host" },
  )), "relay");
  assert.equal(classifySelectedCandidatePair(new Map()), "unknown");
  assert.equal(classifySelectedCandidatePair(stats(
    { id: "old", type: "candidate-pair", nominated: true, state: "succeeded",
      localCandidateId: "relay", remoteCandidateId: "host" },
    { id: "current", type: "candidate-pair", nominated: true, state: "succeeded",
      localCandidateId: "host", remoteCandidateId: "srflx" },
    { id: "relay", type: "local-candidate", candidateType: "relay" },
    { id: "host", type: "local-candidate", candidateType: "host" },
    { id: "srflx", type: "remote-candidate", candidateType: "srflx" },
  )), "unknown");
  assert.equal(classifySelectedCandidatePair(stats(
    { id: "transport", type: "transport", selectedCandidatePairId: "current" },
    { id: "old", type: "candidate-pair", nominated: true, state: "succeeded",
      localCandidateId: "relay", remoteCandidateId: "host" },
    { id: "current", type: "candidate-pair", nominated: true, state: "succeeded",
      localCandidateId: "host", remoteCandidateId: "srflx" },
    { id: "relay", type: "local-candidate", candidateType: "relay" },
    { id: "host", type: "local-candidate", candidateType: "host" },
    { id: "srflx", type: "remote-candidate", candidateType: "srflx" },
  )), "direct");
});

test("browser snapshot body matches the shared Swift command fixture", () => {
  const vectors = JSON.parse(readFileSync(new URL(
    "../../Tests/Fixtures/RemoteBrowserCommandVectors.json",
    import.meta.url,
  ), "utf8")) as Array<{
    sessionID: string;
    revision: number | null;
    expectedBody: Record<string, unknown>;
  }>;
  for (const vector of vectors) {
    assert.deepEqual(
      snapshotCommandBody(vector.sessionID, vector.revision),
      vector.expectedBody,
    );
  }
});

test("mutation uncertainty is durable for create/open/send/stop until explicit acknowledgement", async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
  };
  const ledger = new MutationUncertaintyLedger(storage);
  const inputs = [
    ["session.create", { projectID: "p1" }],
    ["session.open", { sessionID: "s1" }],
    ["prompt.send", { sessionID: "s1", text: "hello", commandID: randomUUID() }],
    ["generation.stop", { sessionID: "s1" }],
  ] as const;
  for (const [command, body] of inputs) {
    await assert.rejects(runTrackedRequest(
      ledger,
      command,
      body,
      true,
      async () => { throw new Error("generic transport failure"); },
    ));
  }
  assert.deepEqual(
    ledger.list().map((item) => [item.command, item.scope]),
    [
      ["session.create", "project:p1"],
      ["session.open", "session:s1"],
      ["prompt.send", "session:s1"],
      ["generation.stop", "session:s1"],
    ],
  );
  assert.equal(mutationScope("snapshot", { sessionID: "s1" }), "session:s1");
  const reloaded = new MutationUncertaintyLedger(storage);
  assert.equal(reloaded.list().length, 4, "disconnect/fallback/page refresh must not clear");
  for (const record of reloaded.list()) reloaded.acknowledge(record.id);
  assert.equal(reloaded.list().length, 0);
  assert.equal(new MutationUncertaintyLedger(storage).list().length, 0);
});

test("fake RTC uses no ICE servers, reliable channel, and rejects changed binding pins", async () => {
  let configuration: unknown;
  let channelLabel = "";
  class FakeChannel {
    label: string;
    ordered = true;
    maxRetransmits = null;
    maxPacketLifeTime = null;
    readyState = "connecting";
    bufferedAmount = 0;
    bufferedAmountLowThreshold = 0;
    onmessage = null;
    onclose = null;
    onerror = null;
    onbufferedamountlow = null;
    constructor(label: string) { this.label = label; }
    close() {}
    send() {}
  }
  class FakePeer {
    localDescription: { sdp: string } | null = null;
    connectionState = "new";
    onicecandidate = null;
    onconnectionstatechange = null;
    constructor(value: unknown) { configuration = value; }
    createDataChannel(label: string) {
      channelLabel = label;
      return new FakeChannel(label);
    }
    async createOffer() {
      return { type: "offer", sdp: `v=0\r\na=fingerprint:sha-256 ${
        Array(32).fill("AA").join(":")
      }\r\n` };
    }
    async setLocalDescription(value: { sdp: string }) { this.localDescription = value; }
    close() {}
  }
  const point = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]);
  const device = {
    deviceID: randomUUID(),
    displayName: "Test Mac",
    online: true,
    publicKeyX963: point.toString("base64url"),
    fingerprint: createHash("sha256").update(point).digest("hex"),
  };
  const requested: string[] = [];
  const client = new RemoteP2PClient({
    csrf: "csrf",
    RTCPeerConnectionImpl: FakePeer,
    cryptoImpl: webcrypto,
    fetchImpl: async (url: string) => {
      requested.push(url);
      return new Response(JSON.stringify({
        v: 1,
        connectionID: randomUUID(),
        deviceID: device.deviceID,
        browserNonce: Buffer.alloc(32, 9).toString("base64url"),
        expiresAt: Date.now() + 30_000,
        fingerprint: "0".repeat(64),
        publicKeyX963: device.publicKeyX963,
      }), { status: 201, headers: { "content-type": "application/json" } });
    },
  });
  await assert.rejects(client.connect(device), /connect binding mismatch/);
  assert.deepEqual(configuration, { iceServers: [] });
  assert.equal(channelLabel, "pipiui.remote.v1");
  assert.deepEqual(requested, ["/api/connect"]);
});

function browserAttempt(client: any, frame: ReturnType<typeof signedBinding>["frame"]) {
  const sent: string[] = [];
  const channel = {
    label: "pipiui.remote.v1",
    ordered: true,
    maxRetransmits: null,
    maxPacketLifeTime: null,
    readyState: "open",
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    onopen: null,
    onclose: null,
    onmessage: null,
    onbufferedamountlow: null,
    send(value: string) { sent.push(value); },
    close() { this.readyState = "closed"; },
  };
  const peer = {
    connectionState: "connected",
    onicecandidate: null,
    onconnectionstatechange: null,
    close() {},
    async getStats() { return new Map(); },
    async setRemoteDescription() {},
    async addIceCandidate() {},
  };
  const attempt: any = {
    generation: 1,
    device: {
      deviceID: frame.deviceID,
      displayName: "Test",
      online: true,
      publicKeyX963: frame.publicKeyX963,
      fingerprint: frame.deviceFingerprint,
    },
    peer,
    channel,
    localCandidates: [],
    localSequence: 1,
    remoteSequence: 0,
    remoteCandidates: 0,
    pendingRemoteCandidates: [],
    answer: {
      hostNonce: frame.hostNonce,
      hostEpoch: frame.hostEpoch,
      answerFingerprint: frame.answerFingerprint,
    },
    connection: {
      connectionID: frame.connectionID,
      deviceID: frame.deviceID,
      browserNonce: frame.browserNonce,
      expiresAt: frame.expiresAt,
      fingerprint: frame.deviceFingerprint,
      publicKeyX963: frame.publicKeyX963,
      offerFingerprint: frame.offerFingerprint,
      answerFingerprint: frame.answerFingerprint,
      deviceFingerprint: frame.deviceFingerprint,
      hostNonce: frame.hostNonce,
      hostEpoch: frame.hostEpoch,
    },
    ready: false,
    closed: false,
    responseChunks: new ChunkReassembler("response"),
    pending: new Map(),
    sendQueue: [],
    expiryTimer: null,
    activeLeaseExpiresAt: null,
    candidatePumpRunning: false,
    resolveReady: () => { attempt.resolveCount += 1; },
    rejectReady: () => {},
    resolveCount: 0,
  };
  client.generation = 1;
  client.attempt = attempt;
  return { attempt, peer, channel, sent };
}

test("browser bind uses the signed absolute lease across bind delay and exact boundary", async () => {
  const signalingStartedAt = Date.now();
  const { frame } = signedBinding(signalingStartedAt);
  let clock = signalingStartedAt + 9_000;
  const timers: Array<{ callback: () => void; delay: number }> = [];
  const client: any = new RemoteP2PClient({
    csrf: "csrf",
    cryptoImpl: webcrypto,
    now: () => clock,
    fetchImpl: async () => new Response("{}", {
      status: 202,
      headers: { "content-type": "application/json" },
    }),
    setTimeoutImpl: (callback: () => void, delay: number) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimeoutImpl: () => {},
  });
  const { attempt, sent } = browserAttempt(client, frame);
  await client.acceptChannelMessage(attempt, JSON.stringify(frame));
  assert.equal(attempt.activeLeaseExpiresAt, frame.activeLeaseExpiresAt);
  assert.equal(
    timers.at(-1)?.delay,
    frame.activeLeaseExpiresAt - clock,
    "bind delay must shorten the remaining lease instead of restarting 24 hours",
  );

  clock = frame.activeLeaseExpiresAt - 1;
  attempt.sendQueue.push("before-boundary");
  client.flush(attempt);
  assert.deepEqual(sent, ["before-boundary"]);

  clock = frame.activeLeaseExpiresAt;
  await assert.rejects(client.request("index", {}), /lease expired/);
  assert.equal(attempt.closed, true);
  assert.equal(attempt.channel.readyState, "closed");
  assert.equal(client.attempt, null);
});

test("delayed bind crypto cannot ready or emit connected after disconnect", async () => {
  const { frame } = signedBinding();
  const digestGate = deferred<void>();
  let digestStarted = false;
  const cryptoImpl = {
    randomUUID,
    getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
    subtle: {
      async digest(...args: Parameters<SubtleCrypto["digest"]>) {
        digestStarted = true;
        await digestGate.promise;
        return webcrypto.subtle.digest(...args);
      },
      importKey: webcrypto.subtle.importKey.bind(webcrypto.subtle),
      verify: webcrypto.subtle.verify.bind(webcrypto.subtle),
    },
  };
  const events: Array<Record<string, unknown>> = [];
  const client: any = new RemoteP2PClient({
    csrf: "csrf",
    cryptoImpl,
    fetchImpl: async () => new Response("{}", {
      status: 202,
      headers: { "content-type": "application/json" },
    }),
    onState: (event: Record<string, unknown>) => events.push(event),
  });
  const { attempt, sent } = browserAttempt(client, frame);
  const accepting = client.acceptChannelMessage(attempt, JSON.stringify(frame));
  await waitUntil(() => digestStarted);
  client.disconnect("replacement");
  digestGate.resolve(undefined);
  await assert.rejects(accepting, /connection replaced/);
  assert.equal(attempt.ready, false);
  assert.equal(attempt.resolveCount, 0);
  assert.equal(sent.length, 0);
  assert.equal(events.some((event) => event.state === "connected"), false);
});

test("delayed getStats cannot publish or resolve a stale verified bind", async () => {
  const { frame } = signedBinding();
  const statsGate = deferred<Map<string, unknown>>();
  let statsStarted = false;
  const events: Array<Record<string, unknown>> = [];
  const client: any = new RemoteP2PClient({
    csrf: "csrf",
    cryptoImpl: webcrypto,
    fetchImpl: async () => new Response("{}", {
      status: 202,
      headers: { "content-type": "application/json" },
    }),
    onState: (event: Record<string, unknown>) => events.push(event),
  });
  const { attempt, peer, sent } = browserAttempt(client, frame);
  peer.getStats = async () => {
    statsStarted = true;
    return statsGate.promise;
  };
  const accepting = client.acceptChannelMessage(attempt, JSON.stringify(frame));
  await waitUntil(() => statsStarted);
  client.disconnect("replacement");
  statsGate.resolve(new Map());
  await assert.rejects(accepting, /connection replaced/);
  assert.equal(attempt.ready, false);
  assert.equal(attempt.resolveCount, 0);
  assert.equal(sent.length, 0);
  assert.equal(events.some((event) => event.state === "connected"), false);
});

test("delayed setRemoteDescription cannot install answer or mutate peer after replacement", async () => {
  const { frame } = signedBinding();
  const remoteGate = deferred<void>();
  let remoteStarted = false;
  let candidateCalls = 0;
  const client: any = new RemoteP2PClient({
    csrf: "csrf",
    cryptoImpl: webcrypto,
    fetchImpl: async () => new Response("{}", {
      status: 202,
      headers: { "content-type": "application/json" },
    }),
  });
  const { attempt, peer } = browserAttempt(client, frame);
  attempt.answer = null;
  attempt.pendingRemoteCandidates.push({
    candidate: "candidate:1 1 udp 1 127.0.0.1 5000 typ host",
    sdpMid: "0",
    sdpMLineIndex: 0,
  });
  peer.setRemoteDescription = async () => {
    remoteStarted = true;
    await remoteGate.promise;
  };
  peer.addIceCandidate = async () => { candidateCalls += 1; };
  const signal = {
    v: 1,
    type: "signal.answer",
    connectionID: frame.connectionID,
    deviceID: frame.deviceID,
    direction: "device-to-browser",
    sequence: 1,
    expiresAt: frame.expiresAt,
    hostNonce: frame.hostNonce,
    hostEpoch: frame.hostEpoch,
    offerFingerprint: frame.offerFingerprint,
    answerFingerprint: frame.answerFingerprint,
    answerSDP: `v=0\r\na=fingerprint:${frame.answerFingerprint}\r\n`,
    signatureDER: frame.signatureDER,
  };
  const accepting = client.acceptSignal(attempt, signal);
  await waitUntil(() => remoteStarted);
  client.disconnect("replacement");
  remoteGate.resolve(undefined);
  await assert.rejects(accepting, /connection replaced/);
  assert.equal(attempt.answer, null);
  assert.equal(candidateCalls, 0);
});

test("delayed signal fetch cannot advance stale attempt state", async () => {
  const { frame } = signedBinding();
  const pollGate = deferred<Response>();
  let pollStarted = false;
  const client: any = new RemoteP2PClient({
    csrf: "csrf",
    cryptoImpl: webcrypto,
    fetchImpl: async (url: string) => {
      if (url.includes("/signals?")) {
        pollStarted = true;
        return pollGate.promise;
      }
      return new Response("{}", {
        status: 202,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const { attempt } = browserAttempt(client, frame);
  attempt.answer = null;
  const polling = client.pollSignals(attempt);
  await waitUntil(() => pollStarted);
  client.disconnect("replacement");
  pollGate.resolve(new Response(JSON.stringify({
    v: 1,
    signals: [{ sequence: 1 }],
  }), { status: 200, headers: { "content-type": "application/json" } }));
  await assert.rejects(polling, /connection replaced/);
  assert.equal(attempt.remoteSequence, 0);
});

test("ICE POST pump holds one request in flight and preserves exact sequence", async () => {
  const { frame } = signedBinding();
  const firstGate = deferred<Response>();
  const arrived: number[] = [];
  let concurrent = 0;
  let maximumConcurrent = 0;
  const client: any = new RemoteP2PClient({
    csrf: "csrf",
    cryptoImpl: webcrypto,
    fetchImpl: async (_url: string, init: RequestInit) => {
      const value = JSON.parse(String(init.body));
      arrived.push(value.sequence);
      concurrent += 1;
      maximumConcurrent = Math.max(maximumConcurrent, concurrent);
      const response = arrived.length === 1
        ? await firstGate.promise
        : new Response("{}", {
          status: 202,
          headers: { "content-type": "application/json" },
        });
      concurrent -= 1;
      return response;
    },
  });
  const { attempt } = browserAttempt(client, frame);
  attempt.localCandidates.push(
    { candidate: "c1", sdpMid: "0", sdpMLineIndex: 0 },
    { candidate: "c2", sdpMid: "0", sdpMLineIndex: 0 },
    { candidate: "c3", sdpMid: "0", sdpMLineIndex: 0 },
  );
  client.startLocalCandidatePump(attempt, (error: unknown) => { throw error; });
  client.startLocalCandidatePump(attempt, (error: unknown) => { throw error; });
  await waitUntil(() => arrived.length === 1);
  assert.equal(maximumConcurrent, 1);
  assert.deepEqual(arrived, [2]);
  firstGate.resolve(new Response("{}", {
    status: 202,
    headers: { "content-type": "application/json" },
  }));
  await waitUntil(() => attempt.localCandidates.length === 0
    && !attempt.candidatePumpRunning);
  assert.equal(maximumConcurrent, 1);
  assert.deepEqual(arrived, [2, 3, 4]);
});
