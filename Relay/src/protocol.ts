import { createHash, createPublicKey, verify } from "node:crypto";

export const PROTOCOL_VERSION = 1;
export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const MAX_PENDING = 16;
export const AUTH_DEADLINE_MS = 5_000;
export const AUTH_AUDIENCE_MAX_BYTES = 256;
export const DISPLAY_NAME_MAX_BYTES = 80;
const P256_SPKI_PREFIX = Buffer.from(
  "3059301306072a8648ce3d020106082a8648ce3d030107034200",
  "hex",
);
export const COMMANDS = new Set([
  "index",
  "session.create",
  "session.open",
  "snapshot",
  "prompt.send",
  "generation.stop",
  "models.get",
  "model.set",
  "subagentModel.set",
  "agents.list",
  "agents.detail",
  "panel.state",
  "document.get",
]);

export type Command = "index" | "session.create" | "session.open" | "snapshot"
  | "prompt.send" | "generation.stop" | "models.get" | "model.set"
  | "subagentModel.set" | "agents.list" | "agents.detail" | "panel.state"
  | "document.get";

export interface HostHello {
  v: 1;
  type: "hello";
  deviceID: string;
  hostEpoch: string;
  clientVersion: string;
  displayName: string;
}

export interface HostResponse {
  v: 1;
  type: "response";
  requestID: string;
  hostEpoch: string;
  status: number;
  body: unknown;
}

export interface DeviceAuthChallenge {
  v: 1;
  type: "auth.challenge";
  connectionID: string;
  nonce: string;
  audience: string;
  expiresAt: number;
}

export interface DeviceAuthProof {
  v: 1;
  type: "auth.proof";
  deviceID: string;
  publicKeyX963: string;
  fingerprint: string;
  connectionID: string;
  expiresAt: number;
  hostEpoch: string;
  clientVersion: string;
  displayName: string;
  signatureDER: string;
}

export interface PairCreate {
  v: 1;
  type: "pair.create";
  pairID: string;
  deviceID: string;
  fingerprint: string;
  secretHash: string;
  expiresAt: number;
  signatureDER: string;
}

export interface PairControl {
  v: 1;
  type: "pair.status" | "pair.revoke";
  pairID: string;
  deviceID: string;
}

export function isExactObject(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

export function parseHello(text: string): HostHello | null {
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return null;
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  if (!isExactObject(
    value,
    ["v", "type", "deviceID", "hostEpoch", "clientVersion", "displayName"],
  )) return null;
  if (value.v !== PROTOCOL_VERSION || value.type !== "hello") return null;
  if (typeof value.deviceID !== "string"
    || typeof value.hostEpoch !== "string"
    || typeof value.clientVersion !== "string"
    || typeof value.displayName !== "string") return null;
  if (!/^[0-9a-f-]{36}$/i.test(value.deviceID)
    || !/^[0-9a-f-]{36}$/i.test(value.hostEpoch)
    || value.displayName.length > 80
    || value.clientVersion.length > 80) return null;
  return value as unknown as HostHello;
}

export function parseResponse(text: string): HostResponse | null {
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) return null;
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  if (!isExactObject(
    value,
    ["v", "type", "requestID", "hostEpoch", "status", "body"],
  )) return null;
  if (value.v !== PROTOCOL_VERSION || value.type !== "response") return null;
  if (typeof value.requestID !== "string"
    || typeof value.hostEpoch !== "string"
    || typeof value.status !== "number"
    || !Number.isInteger(value.status)
    || value.status < 100
    || value.status > 599) return null;
  return value as unknown as HostResponse;
}

function validUUID(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validBase64URL(value: unknown, decodedBytes: number): value is string {
  if (typeof value !== "string"
    || !/^[A-Za-z0-9_-]+$/.test(value)
    || value.includes("=")) return false;
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.length === decodedBytes && decoded.toString("base64url") === value;
  } catch {
    return false;
  }
}

function utf8Within(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string"
    && Buffer.byteLength(value) >= minimum
    && Buffer.byteLength(value) <= maximum
    && !/[\r\n\0]/.test(value);
}

export function parseDeviceAuthProof(text: string): DeviceAuthProof | null {
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return null;
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  if (!isExactObject(value, [
    "v", "type", "deviceID", "publicKeyX963", "fingerprint", "connectionID",
    "expiresAt", "hostEpoch", "clientVersion", "displayName", "signatureDER",
  ])) return null;
  if (value.v !== PROTOCOL_VERSION || value.type !== "auth.proof"
    || !validUUID(value.deviceID)
    || !validBase64URL(value.publicKeyX963, 65)
    || typeof value.fingerprint !== "string"
    || !/^[0-9a-f]{64}$/.test(value.fingerprint)
    || !validUUID(value.connectionID)
    || typeof value.expiresAt !== "number"
    || !Number.isSafeInteger(value.expiresAt)
    || !validUUID(value.hostEpoch)
    || !utf8Within(value.clientVersion, 1, 80)
    || !utf8Within(value.displayName, 1, DISPLAY_NAME_MAX_BYTES)
    || typeof value.signatureDER !== "string"
    || !/^[A-Za-z0-9_-]+$/.test(value.signatureDER)
    || Buffer.from(value.signatureDER, "base64url").length > 80) return null;
  const publicKey = Buffer.from(value.publicKeyX963, "base64url");
  if (publicKey[0] !== 0x04) return null;
  const fingerprint = createHash("sha256").update(publicKey).digest("hex");
  if (fingerprint !== value.fingerprint) return null;
  return value as unknown as DeviceAuthProof;
}

export function deviceAuthTranscript(
  challenge: DeviceAuthChallenge,
  proof: Pick<DeviceAuthProof, "deviceID" | "hostEpoch" | "fingerprint">,
): Buffer {
  return Buffer.from([
    "PIPIUI-DEVICE-AUTH-V1",
    challenge.audience,
    proof.deviceID,
    challenge.nonce,
    challenge.connectionID,
    String(challenge.expiresAt),
    proof.hostEpoch,
    proof.fingerprint,
  ].join("\n"), "utf8");
}

export function verifyDeviceSignature(
  publicKeyX963: string,
  transcript: Buffer,
  signatureDER: string,
): boolean {
  try {
    const point = Buffer.from(publicKeyX963, "base64url");
    const publicKey = createPublicKey({
      key: Buffer.concat([P256_SPKI_PREFIX, point]),
      format: "der",
      type: "spki",
    });
    return verify(
      "sha256",
      transcript,
      { key: publicKey, dsaEncoding: "der" },
      Buffer.from(signatureDER, "base64url"),
    );
  } catch {
    return false;
  }
}

export function parsePairCreate(text: string): PairCreate | null {
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return null;
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  if (!isExactObject(value, [
    "v", "type", "pairID", "deviceID", "fingerprint", "secretHash",
    "expiresAt", "signatureDER",
  ])) return null;
  if (value.v !== PROTOCOL_VERSION || value.type !== "pair.create"
    || !validUUID(value.pairID)
    || !validUUID(value.deviceID)
    || typeof value.fingerprint !== "string"
    || !/^[0-9a-f]{64}$/.test(value.fingerprint)
    || typeof value.secretHash !== "string"
    || !/^[0-9a-f]{64}$/.test(value.secretHash)
    || typeof value.expiresAt !== "number"
    || !Number.isSafeInteger(value.expiresAt)
    || typeof value.signatureDER !== "string"
    || !/^[A-Za-z0-9_-]+$/.test(value.signatureDER)
    || Buffer.from(value.signatureDER, "base64url").length > 80) return null;
  return value as unknown as PairCreate;
}

export function pairCreateTranscript(frame: Omit<PairCreate, "v" | "type" | "signatureDER">): Buffer {
  return Buffer.from([
    "PIPIUI-PAIR-CREATE-V1",
    frame.deviceID,
    frame.pairID,
    frame.secretHash,
    frame.fingerprint,
    String(frame.expiresAt),
  ].join("\n"), "utf8");
}

export function parsePairControl(text: string): PairControl | null {
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return null;
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  if (!isExactObject(value, ["v", "type", "pairID", "deviceID"])) return null;
  if (value.v !== PROTOCOL_VERSION
    || (value.type !== "pair.status" && value.type !== "pair.revoke")
    || !validUUID(value.pairID)
    || !validUUID(value.deviceID)) return null;
  return value as unknown as PairControl;
}
