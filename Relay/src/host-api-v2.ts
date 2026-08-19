import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const HOST_API_PROTOCOL_VERSION = 2;
export const RELAY_CONTROL_VERSION = 2;
export const PAIR_COOKIE = "pipiui_pair";
export const HOST_WS_PATH = "/relay/host";
export const BROWSER_WS_PATH = "/ws";
export const ROOM_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const HEX32_RE = /^[0-9a-f]{64}$/;
export const PAIR_PATH_RE =
  /^\/pair\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
export const PAIR_CLAIM_PATH_RE =
  /^\/pair\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/claim$/i;

export const DEFAULT_ROOM_TTL_MS = 24 * 60 * 60 * 1_000;
export const CLAIM_BODY_MAX_BYTES = 1_024;
export const GRANT_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const DEFAULT_V2_LIMITS = {
  maxRooms: 4_096,
  maxClients: 8_192,
  maxRequestBytes: 8 * 1_024 * 1_024,
  maxResponseBytes: 8 * 1_024 * 1_024,
  maxInflight: 32,
  maxQueuedBytes: 8 * 1_024 * 1_024,
  helloTimeoutMs: 5_000,
  claimWindowMs: 60_000,
  maxClaimAttemptsPerIP: 30,
  frameWindowMs: 1_000,
  maxFramesPerWindow: 120,
  // Any inbound WS frame (including app ping) refreshes liveness; pong still counts.
  heartbeatMs: 25_000,
} as const;

export type HostAPIV2Limits = {
  -readonly [K in keyof typeof DEFAULT_V2_LIMITS]: number;
};

export const CONTROL_TYPES = new Set([
  "hello",
  "ready",
  "replaced",
  "end",
  "expired",
  "error",
  "ping",
  "pong",
  "paired",
]);

export type ControlType =
  | "hello"
  | "ready"
  | "replaced"
  | "end"
  | "expired"
  | "error"
  | "ping"
  | "pong"
  | "paired";

export type ClassifiedFrame =
  | { kind: "control"; type: ControlType; value: Record<string, unknown> }
  | {
    kind: "request";
    id: string;
    hostEpoch?: number;
    generation?: number;
    value: Record<string, unknown>;
  }
  | {
    kind: "response";
    id: string;
    hostEpoch?: number;
    generation?: number;
    value: Record<string, unknown>;
  }
  | {
    kind: "event";
    hostEpoch?: number;
    generation?: number;
    value: Record<string, unknown>;
  }
  | { kind: "invalid"; reason: "version" | "direction" | "malformed" };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sha256utf8(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function exactBuffer(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

export function hashHex(value: string): string {
  return sha256utf8(value).toString("hex");
}

export function classifyFrame(value: unknown): ClassifiedFrame {
  if (!isRecord(value)) return { kind: "invalid", reason: "malformed" };
  const hasV = Object.prototype.hasOwnProperty.call(value, "v");
  const hasProtocol = Object.prototype.hasOwnProperty.call(value, "protocolVersion");
  if (hasV && hasProtocol) return { kind: "invalid", reason: "malformed" };
  if (hasV) {
    if (value.v !== RELAY_CONTROL_VERSION) {
      return { kind: "invalid", reason: "version" };
    }
    if (typeof value.type !== "string" || !CONTROL_TYPES.has(value.type)) {
      return { kind: "invalid", reason: "malformed" };
    }
    return { kind: "control", type: value.type as ControlType, value };
  }
  if (!hasProtocol) return { kind: "invalid", reason: "malformed" };
  if (value.protocolVersion !== HOST_API_PROTOCOL_VERSION) {
    return { kind: "invalid", reason: "version" };
  }
  const hostEpoch = optionalUint(value.hostEpoch);
  const generation = optionalUint(value.generation);
  const epoch = {
    ...(hostEpoch !== undefined ? { hostEpoch } : {}),
    ...(generation !== undefined ? { generation } : {}),
  };
  if (value.type === "request") {
    if (!validWireID(value.id)) return { kind: "invalid", reason: "malformed" };
    return { kind: "request", id: value.id, ...epoch, value };
  }
  if (value.type === "response") {
    if (!validWireID(value.id)) return { kind: "invalid", reason: "malformed" };
    return { kind: "response", id: value.id, ...epoch, value };
  }
  if (value.type === "event") {
    return { kind: "event", ...epoch, value };
  }
  return { kind: "invalid", reason: "malformed" };
}

function validWireID(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function optionalUint(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

export function parseHostHello(
  value: unknown,
): { roomID: string; hostToken: string; pairSecretHash: string } | null {
  if (!isRecord(value)) return null;
  if (Object.keys(value).sort().join(",") !== "hostToken,pairSecretHash,roomID,type,v") {
    return null;
  }
  if (value.v !== RELAY_CONTROL_VERSION || value.type !== "hello") return null;
  if (typeof value.roomID !== "string" || !ROOM_ID_RE.test(value.roomID)) return null;
  if (typeof value.hostToken !== "string" || !HEX32_RE.test(value.hostToken)) return null;
  if (typeof value.pairSecretHash !== "string" || !HEX32_RE.test(value.pairSecretHash)) {
    return null;
  }
  return {
    roomID: value.roomID.toLowerCase(),
    hostToken: value.hostToken.toLowerCase(),
    pairSecretHash: value.pairSecretHash.toLowerCase(),
  };
}

export function parseClaimBody(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (Object.keys(value).sort().join(",") !== "secret") return null;
  if (typeof value.secret !== "string" || !HEX32_RE.test(value.secret)) return null;
  return value.secret.toLowerCase();
}

export function cookieValue(
  header: string | undefined,
  name: string,
): string | undefined {
  if (!header) return undefined;
  for (const item of header.split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === name) return parts.join("=");
  }
  return undefined;
}

export function pairCookie(
  token: string,
  maxAgeSeconds: number,
  secure: boolean,
): string {
  return `${PAIR_COOKIE}=${token}; HttpOnly; ${
    secure ? "Secure; " : ""
  }SameSite=Strict; Path=/; Max-Age=${Math.max(1, maxAgeSeconds)}`;
}

export function newGrantToken(): string {
  return randomBytes(32).toString("base64url");
}

export function pairPageHTML(roomID: string, nonce: string): string {
  const encodedID = JSON.stringify(roomID).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>PipiUI 配对</title>
<style nonce="${nonce}">body{font:16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#17181c;color:#f4f5f7;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:32rem;padding:2rem}p{color:#c9cbd1}.error{color:#ff9b9b}</style>
</head><body><main><h1>PipiUI 远程会话</h1><p id="status" role="status">正在安全连接服务器…</p></main>
<script nonce="${nonce}">(()=>{"use strict";const pairID=${encodedID};const status=document.getElementById("status");const secret=location.hash.startsWith("#")?location.hash.slice(1):"";if(!/^[0-9a-f]{64}$/.test(secret)){status.textContent="链接无效或密钥缺失；请使用完整配对链接。";status.className="error";return;}fetch("/pair/"+pairID+"/claim",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({secret})}).then(response=>{if(!response.ok)throw new Error("pairing rejected");history.replaceState(null,"",location.pathname+location.hash);location.reload();}).catch(()=>{status.textContent="配对失败或链接已过期。";status.className="error";});})();</script>
</body></html>`;
}

export function fallbackBrowserHTML(): string {
  return `<!doctype html><meta charset="utf-8"><title>PipiUI</title>
<main data-fallback="browser-ui-missing"><h1>PipiUI</h1>
<p>配对已成功，但 Relay 未部署共享 browser UI。</p></main>`;
}
