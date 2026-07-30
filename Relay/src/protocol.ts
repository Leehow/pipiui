export const PROTOCOL_VERSION = 1;
export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const MAX_PENDING = 16;
export const COMMANDS = new Set([
  "index",
  "session.create",
  "session.open",
  "snapshot",
  "prompt.send",
  "generation.stop",
]);

export type Command = "index" | "session.create" | "session.open" | "snapshot"
  | "prompt.send" | "generation.stop";

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
