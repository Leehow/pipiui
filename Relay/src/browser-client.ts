// @ts-nocheck
// This file deliberately uses browser-native JavaScript syntax. TypeScript
// copies it to dist/browser-client.js, while Relay can also serve this source
// during tsx-based tests without maintaining a second browser bundle.

export const REMOTE_PROTOCOL_VERSION = 1;
export const REMOTE_CHANNEL_LABEL = "pipiui.remote.v1";
export const MAX_CHUNK_BYTES = 64 * 1024;
export const MAX_REQUEST_BYTES = 256 * 1024;
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const MAX_INFLIGHT = 16;
const MAX_SIGNALING_CANDIDATES = 64;
const MAX_SIGNALING_SDP_BYTES = 128 * 1024;
const REQUEST_LIFETIME_MS = 10_000;
const REASSEMBLY_LIFETIME_MS = 15_000;
const BUFFER_LOW_WATER = 256 * 1024;
const BUFFER_HIGH_WATER = 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();
export const ACTIVE_CONNECTION_LEASE_MS = 24 * 60 * 60 * 1000;
const decoder = new TextDecoder("utf-8", { fatal: true });

export function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

export function canonicalFingerprint(value) {
  if (typeof value !== "string") return null;
  const candidate = value.replace(/^[ \t]+|[ \t]+$/g, "");
  const parts = candidate.split(/ +/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== "sha-256") return null;
  const bytes = parts[1].split(":");
  if (bytes.length !== 32 || bytes.some((byte) => !/^[0-9a-f]{2}$/i.test(byte))) {
    return null;
  }
  return `sha-256 ${bytes.map((byte) => byte.toUpperCase()).join(":")}`;
}

export function sdpSHA256Fingerprint(sdp) {
  if (typeof sdp !== "string") return null;
  const values = [];
  for (const rawLine of sdp.split(/\r\n|\n|\r/)) {
    const line = rawLine.replace(/^[ \t]+|[ \t]+$/g, "");
    if (!line.toLowerCase().startsWith("a=fingerprint:")) continue;
    const value = canonicalFingerprint(line.slice("a=fingerprint:".length));
    if (!value) return null;
    values.push(value);
  }
  return values.length > 0 && values.every((value) => value === values[0])
    ? values[0]
    : null;
}

function bytesToBase64URL(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function base64URLToBytes(value, expectedLength) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if ((expectedLength !== undefined && bytes.length !== expectedLength)
      || bytesToBase64URL(bytes) !== value) return null;
    return bytes;
  } catch {
    return null;
  }
}

function randomNonce(cryptoImpl) {
  const bytes = new Uint8Array(32);
  cryptoImpl.getRandomValues(bytes);
  return bytesToBase64URL(bytes);
}

export function bindingTranscript(frame) {
  return encoder.encode([
    "PIPIUI-REMOTE-BIND-V1",
    "1",
    frame.connectionID,
    frame.deviceID,
    frame.deviceFingerprint,
    frame.browserNonce,
    frame.hostNonce,
    frame.hostEpoch,
    String(frame.expiresAt),
    String(frame.activeLeaseExpiresAt),
    frame.offerFingerprint,
    frame.answerFingerprint,
  ].join("\n"));
}

export function derSignatureToRaw(signature) {
  const bytes = signature instanceof Uint8Array ? signature : new Uint8Array(signature);
  let offset = 0;
  const take = () => {
    if (offset >= bytes.length) throw new Error("invalid DER signature");
    return bytes[offset++];
  };
  if (take() !== 0x30) throw new Error("invalid DER signature");
  const sequenceLength = take();
  // A canonical P-256 ECDSA signature is at most 72 bytes, so DER must use the
  // short length form. Long-form, indefinite, and overlong encodings are not
  // alternate representations we accept.
  if ((sequenceLength & 0x80) !== 0) throw new Error("invalid DER signature");
  if (sequenceLength !== bytes.length - offset) throw new Error("invalid DER signature");
  const integer = () => {
    if (take() !== 0x02) throw new Error("invalid DER signature");
    const length = take();
    if ((length & 0x80) !== 0) throw new Error("invalid DER signature");
    if (length < 1 || length > 33 || offset + length > bytes.length) {
      throw new Error("invalid DER signature");
    }
    let value = bytes.slice(offset, offset + length);
    offset += length;
    if (value.length === 33) {
      if (value[0] !== 0 || (value[1] & 0x80) === 0) throw new Error("invalid DER signature");
      value = value.slice(1);
    } else if ((value[0] & 0x80) !== 0 || (value.length > 1 && value[0] === 0
      && (value[1] & 0x80) === 0)) {
      throw new Error("invalid DER signature");
    }
    if (value.every((byte) => byte === 0)) throw new Error("invalid DER signature");
    const output = new Uint8Array(32);
    output.set(value, 32 - value.length);
    return output;
  };
  const raw = new Uint8Array(64);
  raw.set(integer(), 0);
  raw.set(integer(), 32);
  if (offset !== bytes.length) throw new Error("invalid DER signature");
  return raw;
}

function scanJSONNoDuplicates(text) {
  let index = 0;
  const whitespace = () => {
    while (index < text.length && /[\t\n\r ]/.test(text[index])) index += 1;
  };
  const stringToken = () => {
    if (text[index] !== "\"") throw new Error("invalid JSON");
    const start = index++;
    while (index < text.length) {
      if (text[index] === "\"") {
        index += 1;
        return JSON.parse(text.slice(start, index));
      }
      if (text[index] === "\\") {
        index += 1;
        if (text[index] === "u") index += 4;
      }
      index += 1;
    }
    throw new Error("invalid JSON");
  };
  const value = () => {
    whitespace();
    if (text[index] === "{") {
      index += 1;
      whitespace();
      const keys = new Set();
      if (text[index] === "}") { index += 1; return; }
      while (index < text.length) {
        whitespace();
        const key = stringToken();
        if (keys.has(key)) throw new Error("duplicate JSON key");
        keys.add(key);
        whitespace();
        if (text[index++] !== ":") throw new Error("invalid JSON");
        value();
        whitespace();
        if (text[index] === "}") { index += 1; return; }
        if (text[index++] !== ",") throw new Error("invalid JSON");
      }
      throw new Error("invalid JSON");
    }
    if (text[index] === "[") {
      index += 1;
      whitespace();
      if (text[index] === "]") { index += 1; return; }
      while (index < text.length) {
        value();
        whitespace();
        if (text[index] === "]") { index += 1; return; }
        if (text[index++] !== ",") throw new Error("invalid JSON");
      }
      throw new Error("invalid JSON");
    }
    if (text[index] === "\"") { stringToken(); return; }
    const match = /^(?:-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null)/
      .exec(text.slice(index));
    if (!match) throw new Error("invalid JSON");
    index += match[0].length;
  };
  value();
  whitespace();
  if (index !== text.length) throw new Error("invalid JSON");
}

export function parseJSONExact(text) {
  if (typeof text !== "string") throw new Error("JSON frame must be text");
  scanJSONNoDuplicates(text);
  return JSON.parse(text);
}

function validChunk(envelope, kind, now) {
  if (!exactKeys(envelope, [
    "v", "type", "messageID", "kind", "chunkIndex", "chunkCount",
    "totalBytes", "expiresAt", "payload",
  ])
    || envelope.v !== 1
    || envelope.type !== "chunk"
    || !UUID_RE.test(envelope.messageID)
    || envelope.kind !== kind
    || !Number.isSafeInteger(envelope.chunkIndex)
    || !Number.isSafeInteger(envelope.chunkCount)
    || !Number.isSafeInteger(envelope.totalBytes)
    || !Number.isSafeInteger(envelope.expiresAt)
    || envelope.chunkCount < 1
    || envelope.chunkIndex < 0
    || envelope.chunkIndex >= envelope.chunkCount
    || envelope.totalBytes < 0
    || envelope.totalBytes > (kind === "request" ? MAX_REQUEST_BYTES : MAX_RESPONSE_BYTES)
    || envelope.chunkCount > Math.max(1, Math.ceil(
      (kind === "request" ? MAX_REQUEST_BYTES : MAX_RESPONSE_BYTES) / MAX_CHUNK_BYTES,
    ))
    || envelope.expiresAt <= now
    || envelope.expiresAt > now + REASSEMBLY_LIFETIME_MS) return false;
  const payload = base64URLToBytes(envelope.payload);
  return payload !== null && payload.length <= MAX_CHUNK_BYTES;
}

export class ChunkReassembler {
  constructor(kind, now = Date.now) {
    this.kind = kind;
    this.now = now;
    this.contexts = new Map();
  }

  accept(envelope) {
    const now = this.now();
    this.collectExpired(now);
    if (!validChunk(envelope, this.kind, now)) throw new Error("invalid chunk");
    const payload = base64URLToBytes(envelope.payload);
    let context = this.contexts.get(envelope.messageID);
    if (!context) {
      if (this.contexts.size >= MAX_INFLIGHT || payload.length > envelope.totalBytes) {
        throw new Error("chunk capacity exceeded");
      }
      context = {
        chunkCount: envelope.chunkCount,
        totalBytes: envelope.totalBytes,
        expiresAt: envelope.expiresAt,
        chunks: new Map(),
        receivedBytes: 0,
      };
      this.contexts.set(envelope.messageID, context);
    } else if (context.chunkCount !== envelope.chunkCount
      || context.totalBytes !== envelope.totalBytes
      || context.expiresAt !== envelope.expiresAt
      || context.chunks.has(envelope.chunkIndex)
      || context.receivedBytes + payload.length > context.totalBytes) {
      this.contexts.delete(envelope.messageID);
      throw new Error("inconsistent chunk");
    }
    context.chunks.set(envelope.chunkIndex, payload);
    context.receivedBytes += payload.length;
    if (context.chunks.size !== context.chunkCount) return null;
    if (context.receivedBytes !== context.totalBytes) {
      this.contexts.delete(envelope.messageID);
      throw new Error("invalid chunk length");
    }
    const output = new Uint8Array(context.totalBytes);
    let offset = 0;
    for (let index = 0; index < context.chunkCount; index += 1) {
      const chunk = context.chunks.get(index);
      if (!chunk) throw new Error("missing chunk");
      output.set(chunk, offset);
      offset += chunk.length;
    }
    this.contexts.delete(envelope.messageID);
    return output;
  }

  collectExpired(now = this.now()) {
    for (const [messageID, context] of this.contexts) {
      if (context.expiresAt <= now) this.contexts.delete(messageID);
    }
  }

  remove(messageID) {
    this.contexts.delete(messageID);
  }

  clear() {
    this.contexts.clear();
  }
}

export function makeChunks(data, kind, messageID, expiresAt) {
  const maximum = kind === "request" ? MAX_REQUEST_BYTES : MAX_RESPONSE_BYTES;
  if (!(data instanceof Uint8Array) || data.length > maximum || !UUID_RE.test(messageID)) {
    throw new Error("invalid chunk input");
  }
  const count = Math.max(1, Math.ceil(data.length / MAX_CHUNK_BYTES));
  return Array.from({ length: count }, (_, index) => ({
    v: 1,
    type: "chunk",
    messageID,
    kind,
    chunkIndex: index,
    chunkCount: count,
    totalBytes: data.length,
    expiresAt,
    payload: bytesToBase64URL(data.slice(
      index * MAX_CHUNK_BYTES,
      Math.min(data.length, (index + 1) * MAX_CHUNK_BYTES),
    )),
  }));
}

function validDevice(device) {
  return exactKeys(device, [
    "deviceID", "displayName", "online", "publicKeyX963", "fingerprint",
  ])
    && UUID_RE.test(device.deviceID)
    && typeof device.displayName === "string"
    && typeof device.online === "boolean"
    && base64URLToBytes(device.publicKeyX963, 65)?.[0] === 4
    && /^[0-9a-f]{64}$/.test(device.fingerprint);
}

export async function verifyBinding(
  frame,
  expected,
  cryptoImpl,
  now,
  assertCurrent = () => {},
) {
  if (!exactKeys(frame, [
    "v", "type", "connectionID", "deviceID", "publicKeyX963",
    "deviceFingerprint", "hostEpoch", "browserNonce", "hostNonce",
    "expiresAt", "activeLeaseExpiresAt", "offerFingerprint",
    "answerFingerprint", "signatureDER",
  ])
    || frame.v !== 1
    || frame.type !== "bind"
    || frame.connectionID !== expected.connectionID
    || frame.deviceID !== expected.deviceID
    || frame.publicKeyX963 !== expected.publicKeyX963
    || frame.deviceFingerprint !== expected.deviceFingerprint
    || frame.browserNonce !== expected.browserNonce
    || frame.expiresAt !== expected.expiresAt
    || frame.activeLeaseExpiresAt !== frame.expiresAt + ACTIVE_CONNECTION_LEASE_MS
    || !Number.isSafeInteger(frame.activeLeaseExpiresAt)
    || frame.offerFingerprint !== expected.offerFingerprint
    || frame.answerFingerprint !== expected.answerFingerprint
    || !UUID_RE.test(frame.hostEpoch)
    || base64URLToBytes(frame.hostNonce, 32) === null
    || canonicalFingerprint(frame.offerFingerprint) !== frame.offerFingerprint
    || canonicalFingerprint(frame.answerFingerprint) !== frame.answerFingerprint
    || frame.expiresAt <= now) return false;
  if (expected.hostNonce && frame.hostNonce !== expected.hostNonce) return false;
  if (expected.hostEpoch && frame.hostEpoch !== expected.hostEpoch) return false;
  const publicKey = base64URLToBytes(frame.publicKeyX963, 65);
  const digest = new Uint8Array(await cryptoImpl.subtle.digest("SHA-256", publicKey));
  assertCurrent();
  if (bytesToHex(digest) !== frame.deviceFingerprint) return false;
  const signatureDER = base64URLToBytes(frame.signatureDER);
  if (!signatureDER || signatureDER.length < 64 || signatureDER.length > 80) return false;
  const key = await cryptoImpl.subtle.importKey(
    "raw",
    publicKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  assertCurrent();
  const verified = await cryptoImpl.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    derSignatureToRaw(signatureDER),
    bindingTranscript(frame),
  );
  assertCurrent();
  return verified;
}

export function classifySelectedCandidatePair(stats) {
  const values = [...stats.values()];
  const transport = values.find((entry) => entry.type === "transport"
    && typeof entry.selectedCandidatePairId === "string");
  let pair = transport ? stats.get(transport.selectedCandidatePairId) : null;
  if (!transport) {
    const explicit = values.filter((entry) => entry.type === "candidate-pair"
      && entry.selected === true && entry.state === "succeeded");
    const nominated = values.filter((entry) => entry.type === "candidate-pair"
      && entry.nominated === true && entry.state === "succeeded");
    pair = explicit.length === 1
      ? explicit[0]
      : explicit.length === 0 && nominated.length === 1
        ? nominated[0]
        : null;
  }
  if (!pair) return "unknown";
  const local = stats.get(pair.localCandidateId);
  const remote = stats.get(pair.remoteCandidateId);
  const types = [local?.candidateType, remote?.candidateType];
  if (types.includes("relay")) return "relay";
  if (types.every((type) => type === "host" || type === "srflx")) return "direct";
  return "unknown";
}

export function snapshotCommandBody(sessionID, revision) {
  if (Number.isSafeInteger(revision) && revision >= 0) {
    return { sessionID, revision };
  }
  return { sessionID };
}

export function mutationScope(command, body) {
  if (command === "session.create") return `project:${String(body?.projectID || "")}`;
  if (["session.open", "snapshot", "prompt.send", "generation.stop"].includes(command)) {
    return `session:${String(body?.sessionID || "")}`;
  }
  return "global";
}

export class MutationUncertaintyLedger {
  constructor(storage = null, storageKey = "pipiui.remote.uncertain.v1") {
    this.storage = storage;
    this.storageKey = storageKey;
    this.records = [];
    try {
      const value = JSON.parse(storage?.getItem(storageKey) || "[]");
      if (Array.isArray(value)) {
        this.records = value.filter((item) => exactKeys(item, [
          "id", "command", "scope", "createdAt",
        ])
          && UUID_RE.test(item.id)
          && typeof item.command === "string"
          && typeof item.scope === "string"
          && Number.isSafeInteger(item.createdAt));
      }
    } catch {}
  }

  record(command, body, now = Date.now(), id = crypto.randomUUID()) {
    const value = {
      id,
      command,
      scope: mutationScope(command, body),
      createdAt: now,
    };
    this.records.push(value);
    this.persist();
    return value;
  }

  acknowledge(id) {
    this.records = this.records.filter((item) => item.id !== id);
    this.persist();
  }

  list() {
    return this.records.map((item) => ({ ...item }));
  }

  persist() {
    try { this.storage?.setItem(this.storageKey, JSON.stringify(this.records)); } catch {}
  }
}

export async function runTrackedRequest(
  ledger,
  command,
  body,
  mutation,
  operation,
) {
  try {
    return await operation();
  } catch (error) {
    if (mutation) ledger.record(command, body);
    throw error;
  }
}

export async function revokeBrowserBinding({
  csrf,
  deviceID,
  fetchImpl,
  ledger,
}) {
  if (!UUID_RE.test(deviceID) || typeof csrf !== "string" || csrf.length === 0) {
    throw new Error("invalid revoke binding input");
  }
  const body = { v: 1, deviceID };
  const value = await runTrackedRequest(
    ledger,
    "binding.revoke",
    body,
    true,
    async () => {
      const response = await fetchImpl("/api/bindings/revoke", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-pipiui-csrf": csrf,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `HTTP ${response.status}`);
      }
      return response.json();
    },
  );
  if (!exactKeys(value, ["ok"]) || value.ok !== true) {
    throw new Error("invalid revoke binding response");
  }
  return value;
}

export class RemoteP2PClient {
  constructor(options) {
    this.csrf = options.csrf;
    this.fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.RTCPeerConnection = options.RTCPeerConnectionImpl
      ?? globalThis.RTCPeerConnection;
    this.crypto = options.cryptoImpl ?? crypto;
    this.now = options.now ?? Date.now;
    this.setTimeout = options.setTimeoutImpl
      ?? globalThis.setTimeout.bind(globalThis);
    this.clearTimeout = options.clearTimeoutImpl
      ?? globalThis.clearTimeout.bind(globalThis);
    this.onState = options.onState ?? (() => {});
    this.generation = 0;
    this.attempt = null;
  }

  owns(attempt) {
    return this.attempt === attempt
      && !attempt.closed
      && this.generation === attempt.generation;
  }

  assertCurrent(attempt) {
    if (!this.owns(attempt)) throw new Error("connection replaced");
  }

  async post(path, body, attempt = null) {
    const response = await this.fetch(path, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-pipiui-csrf": this.csrf,
      },
      body: JSON.stringify(body),
    });
    if (attempt) this.assertCurrent(attempt);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (attempt) this.assertCurrent(attempt);
      throw new Error(error.error || `HTTP ${response.status}`);
    }
    const value = await response.json();
    if (attempt) this.assertCurrent(attempt);
    return value;
  }

  async connect(device) {
    if (!validDevice(device) || !device.online) throw new Error("device unavailable");
    this.disconnect("replaced");
    const generation = ++this.generation;
    const peer = new this.RTCPeerConnection({ iceServers: [] });
    const channel = peer.createDataChannel(REMOTE_CHANNEL_LABEL, { ordered: true });
    if (channel.label !== REMOTE_CHANNEL_LABEL || channel.ordered !== true
      || channel.maxRetransmits != null || channel.maxPacketLifeTime != null) {
      peer.close();
      throw new Error("unexpected DataChannel contract");
    }
    const attempt = {
      generation,
      device,
      peer,
      channel,
      localCandidates: [],
      localSequence: 1,
      remoteSequence: 0,
      remoteCandidates: 0,
      pendingRemoteCandidates: [],
      answer: null,
      connection: null,
      ready: false,
      closed: false,
      responseChunks: new ChunkReassembler("response", this.now),
      pending: new Map(),
      sendQueue: [],
      expiryTimer: null,
      activeLeaseExpiresAt: null,
      candidatePumpRunning: false,
    };
    this.attempt = attempt;
    const owns = () => this.owns(attempt);
    const fail = (error) => {
      if (!owns()) return;
      this.closeAttempt(attempt, String(error?.message || error || "connection failed"));
    };
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = BUFFER_LOW_WATER;
    channel.onbufferedamountlow = () => this.flush(attempt);
    channel.onmessage = (event) => {
      if (!owns()) return;
      void this.acceptChannelMessage(attempt, event.data).catch(fail);
    };
    channel.onclose = () => fail(new Error("DataChannel closed"));
    channel.onerror = () => fail(new Error("DataChannel error"));
    peer.onconnectionstatechange = () => {
      if (!owns()) return;
      if (["failed", "disconnected", "closed"].includes(peer.connectionState)) {
        fail(new Error(`peer ${peer.connectionState}`));
      }
    };
    peer.onicecandidate = (event) => {
      if (!owns() || !event.candidate) return;
      const candidate = event.candidate;
      if (attempt.localCandidates.length >= MAX_SIGNALING_CANDIDATES) {
        fail(new Error("too many ICE candidates"));
        return;
      }
      attempt.localCandidates.push({
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid || "",
        sdpMLineIndex: candidate.sdpMLineIndex ?? 0,
      });
      this.startLocalCandidatePump(attempt, fail);
    };
    this.assertCurrent(attempt);
    this.onState({ state: "connecting", transport: "p2p", device });
    try {
      const offer = await peer.createOffer();
      this.assertCurrent(attempt);
      await peer.setLocalDescription(offer);
      this.assertCurrent(attempt);
      const offerSDP = peer.localDescription?.sdp;
      const offerFingerprint = sdpSHA256Fingerprint(offerSDP);
      if (typeof offerSDP !== "string"
        || encoder.encode(offerSDP).length > MAX_SIGNALING_SDP_BYTES
        || !offerFingerprint) throw new Error("invalid browser offer");
      const browserNonce = randomNonce(this.crypto);
      const connection = await this.post("/api/connect", {
        v: 1,
        deviceID: device.deviceID,
        browserNonce,
        offerSDP,
        offerFingerprint,
      }, attempt);
      this.assertCurrent(attempt);
      if (!exactKeys(connection, [
        "v", "connectionID", "deviceID", "browserNonce", "expiresAt",
        "fingerprint", "publicKeyX963",
      ])
        || connection.v !== 1
        || !UUID_RE.test(connection.connectionID)
        || connection.deviceID !== device.deviceID
        || connection.browserNonce !== browserNonce
        || !Number.isSafeInteger(connection.expiresAt)
        || connection.expiresAt <= this.now()
        || connection.expiresAt > this.now() + 32_000
        || connection.fingerprint !== device.fingerprint
        || connection.publicKeyX963 !== device.publicKeyX963) {
        throw new Error("connect binding mismatch");
      }
      attempt.connection = {
        ...connection,
        offerFingerprint,
        deviceFingerprint: connection.fingerprint,
      };
      attempt.expiryTimer = this.setTimeout(
        () => fail(new Error("binding expired")),
        Math.max(1, connection.expiresAt - this.now()),
      );
      const ready = new Promise((resolve, reject) => {
        attempt.resolveReady = resolve;
        attempt.rejectReady = reject;
      });
      this.startLocalCandidatePump(attempt, fail);
      this.assertCurrent(attempt);
      void this.pollSignals(attempt).catch(fail);
      return ready;
    } catch (error) {
      if (owns()) this.closeAttempt(attempt, String(error?.message || error));
      throw error;
    }
  }

  startLocalCandidatePump(attempt, fail = () => {}) {
    if (!this.owns(attempt) || !attempt.connection || attempt.candidatePumpRunning) return;
    attempt.candidatePumpRunning = true;
    void this.runLocalCandidatePump(attempt).catch(fail).finally(() => {
      if (this.owns(attempt)) attempt.candidatePumpRunning = false;
      if (this.owns(attempt) && attempt.connection && attempt.localCandidates.length > 0) {
        this.startLocalCandidatePump(attempt, fail);
      }
    });
  }

  async runLocalCandidatePump(attempt) {
    while (this.owns(attempt) && attempt.connection
      && attempt.localCandidates.length > 0) {
      this.assertCurrent(attempt);
      const candidate = attempt.localCandidates.shift();
      const sequence = attempt.localSequence + 1;
      attempt.localSequence = sequence;
      await this.post(`/api/connect/${attempt.connection.connectionID}/signal`, {
        v: 1,
        type: "signal.ice",
        connectionID: attempt.connection.connectionID,
        deviceID: attempt.device.deviceID,
        direction: "browser-to-device",
        sequence,
        expiresAt: attempt.connection.expiresAt,
        ...candidate,
      }, attempt);
      this.assertCurrent(attempt);
    }
  }

  async pollSignals(attempt) {
    while (this.owns(attempt) && !attempt.ready
      && this.now() < attempt.connection.expiresAt) {
      const response = await this.fetch(
        `/api/connect/${attempt.connection.connectionID}/signals?after=${attempt.remoteSequence}`,
        { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } },
      );
      this.assertCurrent(attempt);
      if (!response.ok) throw new Error(`signal poll ${response.status}`);
      const body = await response.json();
      this.assertCurrent(attempt);
      if (!exactKeys(body, ["v", "signals"]) || body.v !== 1 || !Array.isArray(body.signals)) {
        throw new Error("invalid signal poll");
      }
      for (const frame of body.signals) {
        this.assertCurrent(attempt);
        if (frame.sequence !== attempt.remoteSequence + 1) {
          throw new Error("non-contiguous device sequence");
        }
        attempt.remoteSequence = frame.sequence;
        await this.acceptSignal(attempt, frame);
        this.assertCurrent(attempt);
      }
      if (!attempt.ready) {
        await new Promise((resolve) => this.setTimeout(resolve, 150));
        this.assertCurrent(attempt);
      }
    }
  }

  async acceptSignal(attempt, frame) {
    this.assertCurrent(attempt);
    const common = frame.v === 1
      && frame.connectionID === attempt.connection.connectionID
      && frame.deviceID === attempt.device.deviceID
      && frame.direction === "device-to-browser"
      && frame.expiresAt === attempt.connection.expiresAt;
    if (!common) throw new Error("signal binding mismatch");
    if (frame.type === "signal.answer") {
      if (attempt.answer || !exactKeys(frame, [
        "v", "type", "connectionID", "deviceID", "direction", "sequence",
        "expiresAt", "hostNonce", "hostEpoch", "offerFingerprint",
        "answerFingerprint", "answerSDP", "signatureDER",
      ])
        || base64URLToBytes(frame.hostNonce, 32) === null
        || !UUID_RE.test(frame.hostEpoch)
        || frame.offerFingerprint !== attempt.connection.offerFingerprint
        || sdpSHA256Fingerprint(frame.answerSDP) !== frame.answerFingerprint) {
        throw new Error("invalid answer");
      }
      const binding = {
        v: 1,
        type: "bind",
        connectionID: frame.connectionID,
        deviceID: frame.deviceID,
        publicKeyX963: attempt.connection.publicKeyX963,
        deviceFingerprint: attempt.connection.deviceFingerprint,
        hostEpoch: frame.hostEpoch,
        browserNonce: attempt.connection.browserNonce,
        hostNonce: frame.hostNonce,
        expiresAt: frame.expiresAt,
        activeLeaseExpiresAt:
          frame.expiresAt + ACTIVE_CONNECTION_LEASE_MS,
        offerFingerprint: frame.offerFingerprint,
        answerFingerprint: frame.answerFingerprint,
        signatureDER: frame.signatureDER,
      };
      if (!await verifyBinding(binding, {
        ...attempt.connection,
        answerFingerprint: frame.answerFingerprint,
        hostNonce: frame.hostNonce,
        hostEpoch: frame.hostEpoch,
      }, this.crypto, this.now(), () => this.assertCurrent(attempt))) {
        throw new Error("answer signature rejected");
      }
      this.assertCurrent(attempt);
      await attempt.peer.setRemoteDescription({ type: "answer", sdp: frame.answerSDP });
      this.assertCurrent(attempt);
      attempt.answer = frame;
      attempt.connection.answerFingerprint = frame.answerFingerprint;
      attempt.connection.hostNonce = frame.hostNonce;
      attempt.connection.hostEpoch = frame.hostEpoch;
      for (const candidate of attempt.pendingRemoteCandidates.splice(0)) {
        this.assertCurrent(attempt);
        await attempt.peer.addIceCandidate(candidate);
        this.assertCurrent(attempt);
      }
      return;
    }
    if (frame.type === "signal.ice") {
      if (!exactKeys(frame, [
        "v", "type", "connectionID", "deviceID", "direction", "sequence",
        "expiresAt", "candidate", "sdpMid", "sdpMLineIndex",
      ])
        || ++attempt.remoteCandidates > MAX_SIGNALING_CANDIDATES
        || typeof frame.candidate !== "string"
        || encoder.encode(frame.candidate).length > 4096
        || typeof frame.sdpMid !== "string"
        || encoder.encode(frame.sdpMid).length > 256
        || !Number.isSafeInteger(frame.sdpMLineIndex)
        || frame.sdpMLineIndex < 0
        || frame.sdpMLineIndex > 65535) throw new Error("invalid remote candidate");
      const candidate = {
        candidate: frame.candidate,
        sdpMid: frame.sdpMid,
        sdpMLineIndex: frame.sdpMLineIndex,
      };
      if (attempt.answer) {
        await attempt.peer.addIceCandidate(candidate);
        this.assertCurrent(attempt);
      } else {
        this.assertCurrent(attempt);
        attempt.pendingRemoteCandidates.push(candidate);
      }
      return;
    }
    if (frame.type === "signal.close"
      && exactKeys(frame, [
        "v", "type", "connectionID", "deviceID", "direction", "sequence",
        "expiresAt", "reason",
      ])) throw new Error(`device closed: ${String(frame.reason).slice(0, 256)}`);
    throw new Error("invalid signal");
  }

  async acceptChannelMessage(attempt, data) {
    this.assertCurrent(attempt);
    if (attempt.ready
      && attempt.activeLeaseExpiresAt !== null
      && this.now() >= attempt.activeLeaseExpiresAt) {
      this.closeAttempt(attempt, "maximum connection lease expired");
      throw new Error("P2P connection lease expired");
    }
    if (typeof data !== "string") throw new Error("binary DataChannel frame rejected");
    if (encoder.encode(data).length > MAX_CHUNK_BYTES * 2) {
      throw new Error("oversized DataChannel frame");
    }
    if (!attempt.ready) {
      const frame = parseJSONExact(data);
      if (!attempt.answer
        || !await verifyBinding(
          frame,
          attempt.connection,
          this.crypto,
          this.now(),
          () => this.assertCurrent(attempt),
        )) {
        throw new Error("bind rejected");
      }
      this.assertCurrent(attempt);
      const route = await this.classify(attempt.peer, attempt);
      this.assertCurrent(attempt);
      attempt.ready = true;
      if (attempt.expiryTimer !== null) this.clearTimeout(attempt.expiryTimer);
      attempt.activeLeaseExpiresAt = frame.activeLeaseExpiresAt;
      attempt.expiryTimer = this.setTimeout(
        () => {
          if (this.owns(attempt)) {
            this.closeAttempt(attempt, "maximum connection lease expired");
          }
        },
        Math.max(0, frame.activeLeaseExpiresAt - this.now()),
      );
      this.assertCurrent(attempt);
      this.onState({ state: "connected", transport: "p2p", route, device: attempt.device });
      this.assertCurrent(attempt);
      attempt.resolveReady?.({ transport: "p2p", route });
      this.flush(attempt);
      return;
    }
    const envelope = parseJSONExact(data);
    const complete = attempt.responseChunks.accept(envelope);
    if (!complete) return;
    const pending = attempt.pending.get(envelope.messageID);
    if (!pending) throw new Error("unsolicited response");
    const responseText = decoder.decode(complete);
    const response = parseJSONExact(responseText);
    if (!exactKeys(response, ["v", "type", "requestID", "hostEpoch", "status", "body"])
      || response.v !== 1
      || response.type !== "response"
      || response.requestID !== pending.requestID
      || response.hostEpoch !== attempt.connection.hostEpoch
      || !Number.isInteger(response.status)
      || response.status < 100
      || response.status > 599) throw new Error("invalid command response");
    attempt.pending.delete(envelope.messageID);
    this.clearTimeout(pending.timer);
    if (response.status === 304) pending.resolve(null);
    else if (response.status >= 200 && response.status < 300) pending.resolve(response.body);
    else pending.reject(new Error(response.body?.error || `command ${response.status}`));
  }

  request(command, body) {
    const attempt = this.attempt;
    if (!attempt?.ready || attempt.channel.readyState !== "open") {
      return Promise.reject(new Error("P2P is not connected"));
    }
    if (attempt.activeLeaseExpiresAt !== null
      && this.now() >= attempt.activeLeaseExpiresAt) {
      this.closeAttempt(attempt, "maximum connection lease expired");
      return Promise.reject(new Error("P2P connection lease expired"));
    }
    if (![
      "index", "session.create", "session.open", "snapshot",
      "prompt.send", "generation.stop",
    ].includes(command) || attempt.pending.size >= MAX_INFLIGHT) {
      return Promise.reject(new Error("request capacity exceeded"));
    }
    const requestID = this.crypto.randomUUID();
    const messageID = this.crypto.randomUUID();
    const deadlineMs = this.now() + REQUEST_LIFETIME_MS;
    const bytes = encoder.encode(JSON.stringify({
      v: 1,
      type: "request",
      requestID,
      command,
      deadlineMs,
      body,
    }));
    if (bytes.length > MAX_REQUEST_BYTES) return Promise.reject(new Error("request too large"));
    const chunks = makeChunks(bytes, "request", messageID, deadlineMs);
    return new Promise((resolve, reject) => {
      const timer = this.setTimeout(() => {
        attempt.pending.delete(messageID);
        attempt.responseChunks.remove(messageID);
        reject(new Error("command timed out"));
      }, REQUEST_LIFETIME_MS);
      attempt.pending.set(messageID, { requestID, resolve, reject, timer });
      attempt.sendQueue.push(...chunks.map((chunk) => JSON.stringify(chunk)));
      this.flush(attempt);
    });
  }

  flush(attempt) {
    if (this.attempt !== attempt || !attempt.ready || attempt.channel.readyState !== "open") return;
    if (attempt.activeLeaseExpiresAt !== null
        && this.now() >= attempt.activeLeaseExpiresAt) {
      this.closeAttempt(attempt, "maximum connection lease expired");
      return;
    }
    while (attempt.sendQueue.length > 0 && attempt.channel.bufferedAmount < BUFFER_HIGH_WATER) {
      attempt.channel.send(attempt.sendQueue.shift());
    }
  }

  async classify(peer, attempt = null) {
    try {
      const stats = await peer.getStats();
      if (attempt) this.assertCurrent(attempt);
      return classifySelectedCandidatePair(stats);
    } catch {
      if (attempt) this.assertCurrent(attempt);
      return "unknown";
    }
  }

  closeAttempt(attempt, reason) {
    if (attempt.closed) return;
    const wasCurrent = this.owns(attempt);
    attempt.closed = true;
    if (this.attempt === attempt) this.attempt = null;
    if (wasCurrent && attempt.connection && this.now() < attempt.connection.expiresAt) {
      attempt.localSequence += 1;
      void this.post(`/api/connect/${attempt.connection.connectionID}/signal`, {
        v: 1,
        type: "signal.close",
        connectionID: attempt.connection.connectionID,
        deviceID: attempt.device.deviceID,
        direction: "browser-to-device",
        sequence: attempt.localSequence,
        expiresAt: attempt.connection.expiresAt,
        reason: String(reason || "closed").slice(0, 200),
      }).catch(() => {});
    }
    if (attempt.expiryTimer !== null) this.clearTimeout(attempt.expiryTimer);
    attempt.channel.onopen = null;
    attempt.channel.onclose = null;
    attempt.channel.onmessage = null;
    attempt.channel.onbufferedamountlow = null;
    try { attempt.channel.close(); } catch {}
    attempt.peer.onicecandidate = null;
    attempt.peer.onconnectionstatechange = null;
    try { attempt.peer.close(); } catch {}
    for (const pending of attempt.pending.values()) {
      this.clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    attempt.pending.clear();
    attempt.responseChunks.clear();
    attempt.rejectReady?.(new Error(reason));
    if (wasCurrent) this.onState({ state: "disconnected", transport: "p2p", reason });
  }

  disconnect(reason = "disconnected") {
    const attempt = this.attempt;
    if (attempt) this.closeAttempt(attempt, reason);
    this.generation += 1;
  }
}

export class HTTPFallbackTransport {
  constructor(options) {
    this.csrf = options.csrf;
    this.deviceID = options.deviceID;
    this.fetch = options.fetchImpl ?? fetch;
  }

  async request(command, body) {
    const routes = {
      index: ["GET", "/api/index"],
      "session.create": ["POST", "/api/sessions"],
      "session.open": ["POST", "/api/sessions/open"],
      snapshot: ["POST", "/api/snapshot"],
      "prompt.send": ["POST", "/api/send"],
      "generation.stop": ["POST", "/api/stop"],
    };
    const route = routes[command];
    if (!route) throw new Error("unsupported command");
    const headers = {
      accept: "application/json",
      "x-pipiui-device-id": this.deviceID,
    };
    if (route[0] === "POST") {
      headers["content-type"] = "application/json";
      headers["x-pipiui-csrf"] = this.csrf;
    }
    const response = await this.fetch(route[1], {
      method: route[0],
      credentials: "same-origin",
      cache: "no-store",
      headers,
      body: route[0] === "POST" ? JSON.stringify(body) : undefined,
    });
    if (response.status === 304) return null;
    if (!response.ok) {
      const value = await response.json().catch(() => ({}));
      throw new Error(value.error || `HTTP ${response.status}`);
    }
    return response.json();
  }
}

function csrfCookie(documentImpl) {
  return documentImpl.cookie.split(";").map((value) => value.trim())
    .find((value) => value.startsWith("pipiui_csrf="))
    ?.slice("pipiui_csrf=".length) || "";
}

export async function bootstrapBrowser(options = {}) {
  const documentImpl = options.documentImpl ?? document;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const confirmImpl = options.confirmImpl ?? globalThis.confirm.bind(globalThis);
  const csrf = csrfCookie(documentImpl);
  const elements = Object.fromEntries([
    "status", "transport", "devices", "connect", "disconnect", "revoke", "fallback",
    "refresh", "projects", "create", "sessions", "open", "transcript",
    "prompt", "send", "stop", "uncertainSection", "uncertainList",
  ].map((id) => [id, documentImpl.getElementById(id)]));
  let selectedDevice = null;
  let transport = null;
  let transportMode = "none";
  let sessionID = null;
  let revision = null;
  let pollGeneration = 0;
  const uncertainty = new MutationUncertaintyLedger(
    options.storageImpl ?? globalThis.sessionStorage,
  );
  let baseStatus = "请选择已配对的 Mac。";
  const renderUncertainty = () => {
    const records = uncertainty.list();
    elements.uncertainSection.hidden = records.length === 0;
    elements.uncertainList.textContent = "";
    for (const record of records) {
      const row = documentImpl.createElement("div");
      const label = documentImpl.createElement("span");
      label.textContent = `${record.command} · ${record.scope} · ${
        new Date(record.createdAt).toLocaleString()
      } `;
      const acknowledge = documentImpl.createElement("button");
      acknowledge.textContent = "我已核对，清除此项";
      acknowledge.onclick = () => {
        uncertainty.acknowledge(record.id);
        renderUncertainty();
      };
      row.append(label, acknowledge);
      elements.uncertainList.append(row);
    }
    elements.status.textContent = records.length > 0
      ? `⚠️ 有 ${records.length} 个变更命令结果未知；不会自动重放。${baseStatus}`
      : baseStatus;
  };
  const setStatus = (text) => {
    baseStatus = text;
    renderUncertainty();
  };
  const setTransport = (text) => { elements.transport.textContent = text; };
  const p2p = new RemoteP2PClient({
    csrf,
    fetchImpl,
    onState(event) {
      if (event.state === "connected") {
        setTransport(event.route === "direct"
          ? "P2P 直连（host/srflx，无 TURN）"
          : event.route === "relay"
            ? "P2P 经 TURN relay"
            : "P2P 已连接（路径未知；未宣称 TURN）");
      } else if (event.state === "disconnected" && transportMode === "p2p") {
        setStatus(event.reason || "P2P 已断开");
      }
    },
  });

  async function devices() {
    const response = await fetchImpl("/api/devices", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`devices ${response.status}`);
    const value = await response.json();
    if (!exactKeys(value, ["devices"]) || !Array.isArray(value.devices)
      || !value.devices.every(validDevice)) throw new Error("invalid device list");
    const previous = selectedDevice;
    const selectedID = elements.devices.value;
    elements.devices.textContent = "";
    for (const device of value.devices) {
      const option = documentImpl.createElement("option");
      option.value = device.deviceID;
      option.textContent = `${device.displayName} — ${device.online ? "在线" : "离线"} — ${
        device.fingerprint.slice(0, 12)
      }…`;
      option.disabled = !device.online;
      elements.devices.append(option);
    }
    selectedDevice = value.devices.find((item) => item.deviceID === selectedID)
      || value.devices.find((item) => item.online)
      || value.devices[0]
      || null;
    if (selectedDevice) elements.devices.value = selectedDevice.deviceID;
    elements.revoke.disabled = !selectedDevice;
    elements.fallback.disabled = !selectedDevice;
    if (previous && (!selectedDevice
      || previous.deviceID !== selectedDevice.deviceID
      || previous.publicKeyX963 !== selectedDevice.publicKeyX963
      || previous.fingerprint !== selectedDevice.fingerprint
      || !selectedDevice.online)) {
      disconnect("设备离线、撤销或身份已更换");
    }
    return value.devices;
  }

  function disconnect(reason = "已断开") {
    pollGeneration += 1;
    p2p.disconnect(reason);
    transport = null;
    transportMode = "none";
    setTransport("未连接");
    setStatus(reason);
  }

  async function connect() {
    const list = await devices();
    selectedDevice = list.find((item) => item.deviceID === elements.devices.value) || null;
    if (!selectedDevice?.online) throw new Error("请选择在线 Mac");
    transportMode = "p2p";
    await p2p.connect(selectedDevice);
    transport = p2p;
    setStatus("Mac 已在线");
    await loadIndex();
  }

  function useFallback() {
    if (!selectedDevice) throw new Error("请先选择 Mac");
    p2p.disconnect("切换到兼容回退");
    transport = new HTTPFallbackTransport({ csrf, deviceID: selectedDevice.deviceID, fetchImpl });
    transportMode = "fallback";
    pollGeneration += 1;
    setTransport("兼容回退：命令经 Relay 转发（显式选择）");
    setStatus("已启用兼容回退；不会重放先前命令");
    void loadIndex();
  }

  async function revokeBinding() {
    if (!selectedDevice) throw new Error("没有可解除的 Mac 配对");
    if (!confirmImpl(`解除与“${selectedDevice.displayName}”的配对？`)) return;
    const device = selectedDevice;
    disconnect("正在解除配对…");
    // Fail closed once the destructive request is submitted: a network error
    // is uncertain and must never leave an old Relay fallback target usable.
    selectedDevice = null;
    elements.revoke.disabled = true;
    elements.fallback.disabled = true;
    await revokeBrowserBinding({
      csrf,
      deviceID: device.deviceID,
      fetchImpl,
      ledger: uncertainty,
    });
    await devices();
    setStatus("配对已解除；如需再次连接，请打开新的一次性配对链接");
  }

  async function command(name, body, mutation = false) {
    if (!transport) throw new Error("请先连接 Mac");
    try {
      return await runTrackedRequest(
        uncertainty,
        name,
        body,
        mutation,
        () => transport.request(name, body),
      );
    } catch (error) {
      if (mutation) renderUncertainty();
      throw error;
    }
  }

  async function loadIndex() {
    const value = await command("index", {});
    elements.projects.textContent = "";
    for (const item of value.projects || []) {
      const option = documentImpl.createElement("option");
      option.value = item.id;
      option.textContent = item.name;
      elements.projects.append(option);
    }
    elements.sessions.textContent = "";
    for (const item of value.sessions || []) {
      const option = documentImpl.createElement("option");
      option.value = item.id;
      option.textContent = item.title;
      elements.sessions.append(option);
    }
  }

  async function poll(generation) {
    while (sessionID && generation === pollGeneration) {
      try {
        const value = await command(
          "snapshot",
          snapshotCommandBody(sessionID, revision),
        );
        if (value) {
          revision = value.revision;
          elements.transcript.textContent = "";
          for (const message of value.snapshot.messages) {
            const node = documentImpl.createElement("div");
            node.className = "msg";
            node.textContent = message.kind === "thinking" ? "[thinking]"
              : message.kind === "tool"
                ? `[tool] ${message.toolName || ""} ${message.toolSummary || ""}`
                : message.text;
            elements.transcript.append(node);
          }
        }
      } catch (error) {
        setStatus(error.message);
      }
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
  }

  elements.devices.onchange = async () => {
    disconnect("设备选择已更改");
    await devices();
  };
  elements.connect.onclick = () => connect().catch((error) => setStatus(error.message));
  elements.disconnect.onclick = () => disconnect();
  elements.revoke.onclick = () => revokeBinding().catch((error) => {
    renderUncertainty();
    setStatus(error.message);
  });
  elements.fallback.onclick = () => {
    try { useFallback(); } catch (error) { setStatus(error.message); }
  };
  elements.refresh.onclick = () => loadIndex().catch((error) => setStatus(error.message));
  elements.open.onclick = async () => {
    sessionID = elements.sessions.value;
    if (!sessionID) return;
    await command("session.open", { sessionID }, true);
    revision = null;
    pollGeneration += 1;
    void poll(pollGeneration);
  };
  elements.create.onclick = async () => {
    const projectID = elements.projects.value;
    if (!projectID) return;
    const value = await command("session.create", { projectID }, true);
    sessionID = value.sessionID;
    revision = null;
    await loadIndex();
    pollGeneration += 1;
    void poll(pollGeneration);
  };
  elements.send.onclick = async () => {
    const text = elements.prompt.value;
    if (!sessionID || !text) return;
    await command("prompt.send", {
      sessionID,
      text,
      commandID: crypto.randomUUID(),
    }, true);
    elements.prompt.value = "";
  };
  elements.stop.onclick = () => sessionID
    && command("generation.stop", { sessionID }, true)
      .catch((error) => setStatus(error.message));
  renderUncertainty();
  const initialDevices = await devices().catch((error) => {
    setStatus(error.message);
    return [];
  });
  if (initialDevices.some((device) => device.online)) {
    await connect().catch((error) => setStatus(error.message));
  }
  setInterval(() => {
    void devices().catch((error) => {
      disconnect("设备状态检查失败");
      setStatus(error.message);
    });
  }, 5_000);
}
