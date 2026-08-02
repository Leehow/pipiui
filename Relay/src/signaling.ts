import { randomBytes, randomUUID } from "node:crypto";
import { isExactObject } from "./protocol.js";

export const SIGNALING_TTL_MS = 30_000;
export const MAX_SIGNALING_SESSIONS = 1_024;
export const MAX_SIGNALING_PER_SUBJECT = 8;
export const MAX_SIGNALING_PER_DEVICE = 8;
export const MAX_SIGNALING_CANDIDATES = 64;
export const MAX_SIGNALING_SDP_BYTES = 128 * 1024;
export const MAX_SIGNALING_CANDIDATE_BYTES = 4 * 1024;
export const REVOCATION_LEASE_MS = 24 * 60 * 60 * 1000;
export const MAX_REVOCATION_ASSOCIATIONS = 4_096;
export const MAX_REVOCATION_PER_SUBJECT = MAX_SIGNALING_PER_SUBJECT;
export const MAX_REVOCATION_PER_DEVICE = MAX_SIGNALING_PER_DEVICE;

export function activeLeaseExpiresAt(signalingExpiresAt: number): number {
  return signalingExpiresAt + REVOCATION_LEASE_MS;
}

export interface BrowserConnectInput {
  v: 1;
  deviceID: string;
  browserNonce: string;
  offerSDP: string;
  offerFingerprint: string;
}

export interface SignalingSession {
  connectionID: string;
  subject: string;
  deviceID: string;
  browserNonce: string;
  offerFingerprint: string;
  expiresAt: number;
  browserSequence: number;
  deviceSequence: number;
  browserCandidates: number;
  deviceCandidates: number;
  answerSeen: boolean;
  terminal: boolean;
  queuedForBrowser: DeviceSignalFrame[];
}

export interface DeviceOfferFrame {
  v: 1;
  type: "signal.offer";
  connectionID: string;
  deviceID: string;
  direction: "browser-to-device";
  sequence: 1;
  expiresAt: number;
  browserNonce: string;
  offerSDP: string;
  offerFingerprint: string;
}

export type DeviceSignalFrame =
  | {
    v: 1;
    type: "signal.answer";
    connectionID: string;
    deviceID: string;
    direction: "device-to-browser";
    sequence: number;
    expiresAt: number;
    hostNonce: string;
    hostEpoch: string;
    offerFingerprint: string;
    answerFingerprint: string;
    answerSDP: string;
    signatureDER: string;
  }
  | {
    v: 1;
    type: "signal.ice";
    connectionID: string;
    deviceID: string;
    direction: "device-to-browser";
    sequence: number;
    expiresAt: number;
    candidate: string;
    sdpMid: string;
    sdpMLineIndex: number;
  }
  | {
    v: 1;
    type: "signal.close";
    connectionID: string;
    deviceID: string;
    direction: "device-to-browser";
    sequence: number;
    expiresAt: number;
    reason: string;
  };

export type BrowserSignalFrame =
  | {
    v: 1;
    type: "signal.ice";
    connectionID: string;
    deviceID: string;
    direction: "browser-to-device";
    sequence: number;
    expiresAt: number;
    candidate: string;
    sdpMid: string;
    sdpMLineIndex: number;
  }
  | {
    v: 1;
    type: "signal.close";
    connectionID: string;
    deviceID: string;
    direction: "browser-to-device";
    sequence: number;
    expiresAt: number;
    reason: string;
  };

function validUUID(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}

function validNonce(value: unknown): value is string {
  return typeof value === "string"
    && /^[A-Za-z0-9_-]{43}$/.test(value)
    && Buffer.from(value, "base64url").length === 32;
}

function validFingerprint(value: unknown): value is string {
  return typeof value === "string"
    && /^sha-256 [0-9A-F]{2}(?::[0-9A-F]{2}){31}$/.test(value);
}

export function sdpSHA256Fingerprint(value: string): string | null {
  const fingerprints: string[] = [];
  for (const rawLine of value.split(/\r\n|\n|\r/)) {
    const line = rawLine.replace(/^[ \t]+|[ \t]+$/g, "");
    if (!line.toLowerCase().startsWith("a=fingerprint:")) continue;
    const candidate = line.slice("a=fingerprint:".length)
      .replace(/^[ \t]+|[ \t]+$/g, "");
    // Match Swift/production WK exactly: SDP horizontal separation is one
    // or more ASCII spaces. Tabs and other whitespace are not silently
    // canonicalized into a different signaling grammar.
    const parts = candidate.split(/ +/);
    if (parts.length !== 2 || parts[0].toLowerCase() !== "sha-256") return null;
    const bytes = parts[1].split(":");
    if (bytes.length !== 32
      || bytes.some((byte) => !/^[0-9a-f]{2}$/i.test(byte))) return null;
    fingerprints.push(`sha-256 ${bytes.map((byte) => byte.toUpperCase()).join(":")}`);
  }
  if (fingerprints.length === 0
    || fingerprints.some((candidate) => candidate !== fingerprints[0])) return null;
  return fingerprints[0];
}

function validBoundedString(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return typeof value === "string"
    && Buffer.byteLength(value, "utf8") >= minimum
    && Buffer.byteLength(value, "utf8") <= maximum;
}

export function parseBrowserConnect(value: unknown): BrowserConnectInput | null {
  if (!isExactObject(value, [
    "v", "deviceID", "browserNonce", "offerSDP", "offerFingerprint",
  ])
    || value.v !== 1
    || !validUUID(value.deviceID)
    || !validNonce(value.browserNonce)
    || !validBoundedString(value.offerSDP, 1, MAX_SIGNALING_SDP_BYTES)
    || !value.offerSDP.startsWith("v=0")
    || !validFingerprint(value.offerFingerprint)
    || sdpSHA256Fingerprint(value.offerSDP) !== value.offerFingerprint) return null;
  return value as unknown as BrowserConnectInput;
}

function validSignalCommon(
  value: Record<string, unknown>,
  session: SignalingSession,
  direction: "browser-to-device" | "device-to-browser",
  sequence: number,
): boolean {
  return value.v === 1
    && value.connectionID === session.connectionID
    && value.deviceID === session.deviceID
    && value.direction === direction
    && value.sequence === sequence
    && value.expiresAt === session.expiresAt;
}

export class SignalingRegistry {
  private readonly sessions = new Map<string, SignalingSession>();
  private readonly revocationIndex = new Map<string, {
    subject: string;
    deviceID: string;
    expiresAt: number;
    signalingExpiresAt: number;
    browserSequence: number;
    deviceSequence: number;
  }>();

  constructor(private readonly now: () => number = Date.now) {}

  create(
    subject: string,
    input: BrowserConnectInput,
  ): { session: SignalingSession; offer: DeviceOfferFrame } | null {
    this.collectExpired();
    this.collectExpiredRevocations();
    const all = [...this.sessions.values()];
    const retained = [...this.revocationIndex.values()];
    if (all.length >= MAX_SIGNALING_SESSIONS
      || this.revocationIndex.size >= MAX_REVOCATION_ASSOCIATIONS
      || retained.filter((item) => item.subject === subject).length
        >= MAX_REVOCATION_PER_SUBJECT
      || retained.filter(
        (item) => item.deviceID === input.deviceID.toLowerCase(),
      ).length >= MAX_REVOCATION_PER_DEVICE
      || all.filter((item) => item.subject === subject).length
        >= MAX_SIGNALING_PER_SUBJECT
      || all.filter((item) => item.deviceID === input.deviceID.toLowerCase()).length
        >= MAX_SIGNALING_PER_DEVICE) return null;
    const connectionID = randomUUID();
    const expiresAt = this.now() + SIGNALING_TTL_MS;
    const session: SignalingSession = {
      connectionID,
      subject,
      deviceID: input.deviceID.toLowerCase(),
      browserNonce: input.browserNonce,
      offerFingerprint: input.offerFingerprint,
      expiresAt,
      browserSequence: 1,
      deviceSequence: 0,
      browserCandidates: 0,
      deviceCandidates: 0,
      answerSeen: false,
      terminal: false,
      queuedForBrowser: [],
    };
    this.sessions.set(connectionID, session);
    this.revocationIndex.set(connectionID, {
      subject,
      deviceID: session.deviceID,
      // This exact absolute deadline is also derived into the signed bind
      // frame and enforced by the WK host.
      expiresAt: activeLeaseExpiresAt(expiresAt),
      signalingExpiresAt: expiresAt,
      browserSequence: 1,
      deviceSequence: 0,
    });
    return {
      session,
      offer: {
        v: 1,
        type: "signal.offer",
        connectionID,
        deviceID: session.deviceID,
        direction: "browser-to-device",
        sequence: 1,
        expiresAt,
        browserNonce: input.browserNonce,
        offerSDP: input.offerSDP,
        offerFingerprint: input.offerFingerprint,
      },
    };
  }

  acceptBrowser(
    subject: string,
    connectionID: string,
    value: unknown,
  ): BrowserSignalFrame | null {
    this.collectExpired();
    const session = this.sessions.get(connectionID);
    if (!session) return this.acceptRetainedBrowserClose(subject, connectionID, value);
    if (session.subject !== subject || session.terminal
      || typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const frame = value as Record<string, unknown>;
    const nextSequence = session.browserSequence + 1;
    if (frame.type === "signal.ice") {
      if (!isExactObject(frame, [
        "v", "type", "connectionID", "deviceID", "direction", "sequence",
        "expiresAt", "candidate", "sdpMid", "sdpMLineIndex",
      ])
        || !validSignalCommon(frame, session, "browser-to-device", nextSequence)
        || session.browserCandidates >= MAX_SIGNALING_CANDIDATES
        || !validBoundedString(frame.candidate, 1, MAX_SIGNALING_CANDIDATE_BYTES)
        || !validBoundedString(frame.sdpMid, 0, 256)
        || !Number.isSafeInteger(frame.sdpMLineIndex)
        || (frame.sdpMLineIndex as number) < 0
        || (frame.sdpMLineIndex as number) > 65_535) return null;
      session.browserCandidates += 1;
    } else if (frame.type === "signal.close") {
      if (!isExactObject(frame, [
        "v", "type", "connectionID", "deviceID", "direction", "sequence",
        "expiresAt", "reason",
      ])
        || !validSignalCommon(frame, session, "browser-to-device", nextSequence)
        || !validBoundedString(frame.reason, 1, 256)) return null;
    } else {
      return null;
    }
    session.browserSequence = nextSequence;
    const association = this.revocationIndex.get(connectionID);
    if (association) association.browserSequence = nextSequence;
    if (frame.type === "signal.close") {
      this.sessions.delete(connectionID);
      this.revocationIndex.delete(connectionID);
    }
    return frame as BrowserSignalFrame;
  }

  acceptDevice(deviceID: string, value: unknown): DeviceSignalFrame | null {
    this.collectExpired();
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const frame = value as Record<string, unknown>;
    const connectionID = frame.connectionID;
    if (typeof connectionID !== "string") return null;
    const session = this.sessions.get(connectionID);
    if (!session) return this.acceptRetainedDeviceClose(deviceID, connectionID, frame);
    if (session.deviceID !== deviceID || session.terminal) return null;
    const nextSequence = session.deviceSequence + 1;
    if (frame.type === "signal.answer") {
      if (session.answerSeen
        || !isExactObject(frame, [
          "v", "type", "connectionID", "deviceID", "direction", "sequence",
          "expiresAt", "hostNonce", "hostEpoch", "offerFingerprint",
          "answerFingerprint", "answerSDP", "signatureDER",
        ])
        || !validSignalCommon(frame, session, "device-to-browser", nextSequence)
        || !validNonce(frame.hostNonce)
        || !validUUID(frame.hostEpoch)
        || !validFingerprint(frame.offerFingerprint)
        || !validFingerprint(frame.answerFingerprint)
        || !validBoundedString(frame.answerSDP, 1, MAX_SIGNALING_SDP_BYTES)
        || !frame.answerSDP.startsWith("v=0")
        || frame.offerFingerprint !== session.offerFingerprint
        || sdpSHA256Fingerprint(frame.answerSDP as string) !== frame.answerFingerprint
        || !validBoundedString(frame.signatureDER, 64, 256)
        || !/^[A-Za-z0-9_-]+$/.test(frame.signatureDER as string)) return null;
      session.answerSeen = true;
    } else if (frame.type === "signal.ice") {
      if (!isExactObject(frame, [
        "v", "type", "connectionID", "deviceID", "direction", "sequence",
        "expiresAt", "candidate", "sdpMid", "sdpMLineIndex",
      ])
        || !validSignalCommon(frame, session, "device-to-browser", nextSequence)
        || session.deviceCandidates >= MAX_SIGNALING_CANDIDATES
        || !validBoundedString(frame.candidate, 1, MAX_SIGNALING_CANDIDATE_BYTES)
        || !validBoundedString(frame.sdpMid, 0, 256)
        || !Number.isSafeInteger(frame.sdpMLineIndex)
        || (frame.sdpMLineIndex as number) < 0
        || (frame.sdpMLineIndex as number) > 65_535) return null;
      session.deviceCandidates += 1;
    } else if (frame.type === "signal.close") {
      if (!isExactObject(frame, [
        "v", "type", "connectionID", "deviceID", "direction", "sequence",
        "expiresAt", "reason",
      ])
        || !validSignalCommon(frame, session, "device-to-browser", nextSequence)
        || !validBoundedString(frame.reason, 1, 256)) return null;
    } else {
      return null;
    }
    session.deviceSequence = nextSequence;
    const association = this.revocationIndex.get(connectionID);
    if (association) association.deviceSequence = nextSequence;
    session.queuedForBrowser.push(frame as DeviceSignalFrame);
    if (session.queuedForBrowser.length > MAX_SIGNALING_CANDIDATES + 2) return null;
    if (frame.type === "signal.close") {
      session.terminal = true;
      this.revocationIndex.delete(connectionID);
    }
    return frame as DeviceSignalFrame;
  }

  poll(subject: string, connectionID: string, after: number): DeviceSignalFrame[] | null {
    this.collectExpired();
    const session = this.sessions.get(connectionID);
    if (!session || session.subject !== subject
      || !Number.isSafeInteger(after) || after < 0) return null;
    return session.queuedForBrowser.filter((frame) => frame.sequence > after);
  }

  session(connectionID: string): SignalingSession | null {
    this.collectExpired();
    return this.sessions.get(connectionID) ?? null;
  }

  closeDevice(deviceID: string): void {
    for (const [connectionID, session] of this.sessions) {
      if (session.deviceID === deviceID) this.sessions.delete(connectionID);
    }
  }

  revokeSubjectDevice(subject: string, deviceID: string): string[] {
    this.collectExpiredRevocations();
    const connectionIDs: string[] = [];
    for (const [connectionID, association] of this.revocationIndex) {
      if (association.subject !== subject || association.deviceID !== deviceID) continue;
      connectionIDs.push(connectionID);
      this.revocationIndex.delete(connectionID);
      this.sessions.delete(connectionID);
    }
    return connectionIDs.sort();
  }

  collectExpired(): number {
    const current = this.now();
    let removed = 0;
    for (const [connectionID, session] of this.sessions) {
      if (session.expiresAt <= current) {
        this.sessions.delete(connectionID);
        removed += 1;
      }
    }
    return removed;
  }

  private collectExpiredRevocations(): void {
    const current = this.now();
    for (const [connectionID, association] of this.revocationIndex) {
      if (association.expiresAt <= current) this.revocationIndex.delete(connectionID);
    }
  }

  private acceptRetainedBrowserClose(
    subject: string,
    connectionID: string,
    value: unknown,
  ): BrowserSignalFrame | null {
    this.collectExpiredRevocations();
    const association = this.revocationIndex.get(connectionID);
    if (!association || association.subject !== subject
      || typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const frame = value as Record<string, unknown>;
    if (!isExactObject(frame, [
      "v", "type", "connectionID", "deviceID", "direction", "sequence",
      "expiresAt", "reason",
    ])
      || frame.v !== 1
      || frame.type !== "signal.close"
      || frame.connectionID !== connectionID
      || frame.deviceID !== association.deviceID
      || frame.direction !== "browser-to-device"
      || frame.sequence !== association.browserSequence + 1
      || frame.expiresAt !== association.signalingExpiresAt
      || !validBoundedString(frame.reason, 1, 256)) return null;
    this.revocationIndex.delete(connectionID);
    return frame as BrowserSignalFrame;
  }

  private acceptRetainedDeviceClose(
    deviceID: string,
    connectionID: string,
    frame: Record<string, unknown>,
  ): DeviceSignalFrame | null {
    this.collectExpiredRevocations();
    const association = this.revocationIndex.get(connectionID);
    if (!association || association.deviceID !== deviceID
      || !isExactObject(frame, [
        "v", "type", "connectionID", "deviceID", "direction", "sequence",
        "expiresAt", "reason",
      ])
      || frame.v !== 1
      || frame.type !== "signal.close"
      || frame.connectionID !== connectionID
      || frame.deviceID !== deviceID
      || frame.direction !== "device-to-browser"
      || frame.sequence !== association.deviceSequence + 1
      || frame.expiresAt !== association.signalingExpiresAt
      || !validBoundedString(frame.reason, 1, 256)) return null;
    this.revocationIndex.delete(connectionID);
    return frame as DeviceSignalFrame;
  }

  count(): number {
    this.collectExpired();
    return this.sessions.size;
  }
}
