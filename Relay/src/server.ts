import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import http, { IncomingMessage, ServerResponse } from "node:http";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";
import {
  AccessIdentityVerifier,
  CloudflareAccessJWTVerifier,
} from "./access.js";
import {
  HostBroker,
  HostBusyError,
  HostOfflineError,
  HostReplacedError,
  HostTimeoutError,
} from "./broker.js";
import {
  AUTH_DEADLINE_MS,
  COMMANDS,
  Command,
  DeviceAuthChallenge,
  MAX_BODY_BYTES,
  MAX_RESPONSE_BYTES,
  PROTOCOL_VERSION,
  deviceAuthTranscript,
  isExactObject,
  pairCreateTranscript,
  parseDeviceAuthProof,
  parseHello,
  parsePairControl,
  parsePairCreate,
  verifyDeviceSignature,
} from "./protocol.js";
import { pageHTML, unpairedPageHTML } from "./page.js";
import { PAIRING_FRAGMENT_PATTERN_SOURCE } from "./pairing.js";
import { DeviceBrokerRegistry } from "./registry.js";
import {
  DeviceStore,
  DeviceStoreLimits,
} from "./store.js";
import {
  ConcurrentConnectionLimiter,
  FixedWindowRateLimiter,
} from "./limits.js";
import {
  SignalingRegistry,
  parseBrowserConnect,
} from "./signaling.js";

function browserClientAsset(): string {
  const candidates = [
    new URL("./browser-client.js", import.meta.url),
    new URL("../dist/browser-client.js", import.meta.url),
    new URL("./browser-client.ts", import.meta.url),
  ];
  const selected = candidates.find((candidate) => existsSync(candidate));
  if (!selected) throw new Error("browser client asset missing");
  return readFileSync(selected, "utf8");
}

export interface RelayAbuseLimits {
  authWindowMS: number;
  maximumGlobalAuthAttempts: number;
  maximumAuthAttemptsPerIP: number;
  maximumDeviceConnections: number;
  maximumDeviceConnectionsPerIP: number;
  pairWindowMS: number;
  maximumPairCreatesPerDevice: number;
}

const DEFAULT_ABUSE_LIMITS: RelayAbuseLimits = {
  authWindowMS: 60_000,
  maximumGlobalAuthAttempts: 300,
  maximumAuthAttemptsPerIP: 30,
  maximumDeviceConnections: 256,
  maximumDeviceConnectionsPerIP: 8,
  pairWindowMS: 5 * 60_000,
  maximumPairCreatesPerDevice: 10,
};

export interface RelayOptions {
  host: "127.0.0.1" | "::1";
  port: number;
  publicOrigin: string;
  deviceSignalOrigin: string;
  requireAccessIdentity: boolean;
  accessTeamDomain?: string;
  accessAudience?: string;
  accessVerifier?: AccessIdentityVerifier;
  trustCFConnectingIP?: boolean;
  abuseLimits?: Partial<RelayAbuseLimits>;
  storeLimits?: Partial<DeviceStoreLimits>;
  databasePath?: string;
  now?: () => number;
  /** Explicit compatibility-only single-device /host/ws configuration. */
  deviceID?: string;
  deviceSecretSHA256?: string;
}

export function optionsFromEnvironment(env = process.env): RelayOptions {
  const host = env.PIPIUI_RELAY_HOST ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "::1") {
    throw new Error("PIPIUI_RELAY_HOST must be loopback");
  }
  const publicOrigin = configuredHTTPSOrigin(
    env.PIPIUI_PUBLIC_ORIGIN ?? "https://pipi.aichattrpg.com",
    "PIPIUI_PUBLIC_ORIGIN",
  );
  const deviceSignalOrigin = configuredHTTPSOrigin(
    env.PIPIUI_DEVICE_SIGNAL_ORIGIN ?? "https://signal.aichattrpg.com",
    "PIPIUI_DEVICE_SIGNAL_ORIGIN",
  );
  if (new URL(publicOrigin).hostname === new URL(deviceSignalOrigin).hostname) {
    throw new Error("browser and device signaling hosts must be distinct");
  }
  const requireAccessIdentity = env.PIPIUI_REQUIRE_ACCESS_IDENTITY === "true";
  const accessTeamDomain = env.PIPIUI_CF_ACCESS_TEAM_DOMAIN?.trim();
  const accessAudience = env.PIPIUI_CF_ACCESS_AUD?.trim();
  if (requireAccessIdentity && (!accessTeamDomain || !accessAudience)) {
    throw new Error(
      "PIPIUI_CF_ACCESS_TEAM_DOMAIN and PIPIUI_CF_ACCESS_AUD are required",
    );
  }
  const deviceID = env.PIPIUI_DEVICE_ID?.toLowerCase();
  const deviceSecretSHA256 = env.PIPIUI_DEVICE_SECRET_SHA256?.toLowerCase();
  if ((deviceID && !deviceSecretSHA256) || (!deviceID && deviceSecretSHA256)) {
    throw new Error("legacy device ID and secret hash must be configured together");
  }
  if (deviceID && !/^[0-9a-f-]{36}$/i.test(deviceID)) {
    throw new Error("invalid legacy PIPIUI_DEVICE_ID");
  }
  if (deviceSecretSHA256 && !/^[0-9a-f]{64}$/i.test(deviceSecretSHA256)) {
    throw new Error("invalid legacy PIPIUI_DEVICE_SECRET_SHA256");
  }
  return {
    host,
    port: Number(env.PIPIUI_RELAY_PORT ?? "8787"),
    publicOrigin,
    deviceSignalOrigin,
    requireAccessIdentity,
    trustCFConnectingIP: env.PIPIUI_TRUST_CF_CONNECTING_IP === "true",
    ...(accessTeamDomain ? { accessTeamDomain } : {}),
    ...(accessAudience ? { accessAudience } : {}),
    databasePath: env.PIPIUI_RELAY_DATABASE ?? "./pipiui-relay.sqlite",
    ...(deviceID && deviceSecretSHA256 ? { deviceID, deviceSecretSHA256 } : {}),
  };
}

function configuredHTTPSOrigin(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an HTTPS origin`);
  }
  if (url.protocol !== "https:"
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash) {
    throw new Error(`${name} must be an HTTPS origin`);
  }
  if (url.hostname.endsWith(".")) {
    throw new Error(`${name} must not use a terminal DNS root dot`);
  }
  return url.origin;
}

function noStore(res: ServerResponse): void {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
}

function json(res: ServerResponse, status: number, value: unknown): void {
  noStore(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(value));
}

function accessAssertion(req: IncomingMessage): string | null {
  const assertion = req.headers["cf-access-jwt-assertion"];
  return typeof assertion === "string" ? assertion : null;
}

export function normalizedHostHeader(
  values: readonly string[],
  protocol: "https:",
): string | null {
  if (values.length !== 1) return null;
  const value = values[0];
  if (value.length === 0
    || value.length > 512
    || /[\u0000-\u0020\u007f,]/.test(value)) return null;
  try {
    const parsed = new URL(`${protocol}//${value}`);
    if (parsed.username
      || parsed.password
      || parsed.pathname !== "/"
      || parsed.search
      || parsed.hash
      || parsed.hostname.endsWith(".")) return null;
    return parsed.host;
  } catch {
    return null;
  }
}

function requestHost(req: IncomingMessage, protocol: "https:"): string | null {
  const values: string[] = [];
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    if (req.rawHeaders[index]?.toLowerCase() === "host") {
      values.push(req.rawHeaders[index + 1] ?? "");
    }
  }
  return normalizedHostHeader(values, protocol);
}

function clientAddress(req: IncomingMessage, trustCFConnectingIP: boolean): string {
  const socketAddress = req.socket.remoteAddress ?? "unknown";
  if (!trustCFConnectingIP) return socketAddress;
  const forwarded = req.headers["cf-connecting-ip"];
  if (typeof forwarded === "string"
    && !forwarded.includes(",")
    && isIP(forwarded.trim()) !== 0) return forwarded.trim();
  return socketAddress;
}

function rejectUpgrade(
  socket: import("node:stream").Duplex,
  status = "401 Unauthorized",
): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

async function readJSON(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new RangeError("body too large");
    chunks.push(chunk);
  }
  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function cookie(req: IncomingMessage, name: string): string | undefined {
  for (const item of (req.headers.cookie ?? "").split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === name) return parts.join("=");
  }
  return undefined;
}

const BROWSER_SESSION_COOKIE = "pipiui_session";
const BROWSER_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function browserSessionSubject(
  req: IncomingMessage,
  store: DeviceStore,
): string | null {
  const token = cookie(req, BROWSER_SESSION_COOKIE);
  if (!token
    || !/^[A-Za-z0-9_-]{43}$/.test(token)
    || Buffer.from(token, "base64url").toString("base64url") !== token) {
    return null;
  }
  const subject = `browser:${
    createHash("sha256").update(Buffer.from(token, "base64url")).digest("hex")
  }`;
  return store.boundDeviceIDs(subject).length > 0 ? subject : null;
}

function browserSessionCookie(token: string): string {
  return `${BROWSER_SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${
    BROWSER_SESSION_MAX_AGE_SECONDS
  }`;
}

function clearBrowserSessionCookie(): string {
  return `${BROWSER_SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

function validDeviceSecret(secret: string, expectedHash: string): boolean {
  const actual = createHash("sha256").update(secret).digest();
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function csrfAccepted(req: IncomingMessage, publicOrigin: string): boolean {
  const csrfCookie = cookie(req, "pipiui_csrf");
  const csrfHeader = req.headers["x-pipiui-csrf"];
  return req.headers.origin === publicOrigin
    && typeof csrfHeader === "string"
    && Boolean(csrfCookie)
    && csrfHeader === csrfCookie
    && req.headers["content-type"]?.split(";")[0].trim() === "application/json";
}

function pairPageHTML(nonce: string): string {
  return `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer">
<title>PipiUI 配对</title><main><h1>PipiUI 配对</h1><p id="status">正在打开一次性配对链接…</p></main>
<script nonce="${nonce}">(()=>{"use strict";
const raw=location.hash.slice(1);history.replaceState(null,"",location.pathname);
const match=new RegExp(${JSON.stringify(PAIRING_FRAGMENT_PATTERN_SOURCE)}).exec(raw);
const pairID=location.pathname.split("/").pop();
const csrf=document.cookie.split(";").map(v=>v.trim()).find(v=>v.startsWith("pipiui_csrf="))?.slice("pipiui_csrf=".length);
const status=document.getElementById("status");
const keyBytes=value=>{if(typeof value!=="string"||!/^[A-Za-z0-9_-]+$/.test(value))return null;
try{const normalized=value.split("-").join("+").split("_").join("/");const binary=atob(normalized+"=".repeat((4-normalized.length%4)%4));
const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));let check="";for(const byte of bytes)check+=String.fromCharCode(byte);
if(btoa(check).split("+").join("-").split("/").join("_").replace(/=+$/,"")!==value)return null;return bytes;}catch{return null;}};
const pairSecret=match&&keyBytes(match[1]);
if(!match||!pairSecret||pairSecret.length!==32||!pairID||!csrf){status.textContent="配对链接无效或已过期。";return;}
fetch("/api/pair/claim",{method:"POST",credentials:"same-origin",headers:{
"content-type":"application/json","x-pipiui-csrf":csrf},body:JSON.stringify({
v:1,pairID,pairSecret:match[1],fingerprint:match[2]})})
.then(async response=>{if(!response.ok)throw new Error("claim rejected");const value=await response.json();
const key=keyBytes(value.publicKeyX963);if(!/^[0-9a-f-]{36}$/i.test(value.deviceID)||value.fingerprint!==match[2]||!key||key.length!==65||key[0]!==4)throw new Error("identity mismatch");
const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",key));const fingerprint=[...digest].map(byte=>byte.toString(16).padStart(2,"0")).join("");
if(fingerprint!==match[2])throw new Error("identity mismatch");
status.textContent="配对成功，正在连接 Mac…";location.replace("/");})
.catch(()=>{status.textContent="配对失败，请检查网络后重试。";});
})();</script>`;
}

export function createRelayServer(options: RelayOptions) {
  const publicOrigin = configuredHTTPSOrigin(
    options.publicOrigin,
    "publicOrigin",
  );
  const deviceSignalOrigin = configuredHTTPSOrigin(
    options.deviceSignalOrigin,
    "deviceSignalOrigin",
  );
  const publicHost = new URL(publicOrigin).host;
  const deviceSignalHost = new URL(deviceSignalOrigin).host;
  if (new URL(publicOrigin).hostname
    === new URL(deviceSignalOrigin).hostname) {
    throw new Error("browser and device signaling hosts must be distinct");
  }
  const now = options.now ?? Date.now;
  const abuseLimits = { ...DEFAULT_ABUSE_LIMITS, ...options.abuseLimits };
  if (Object.values(abuseLimits).some(
    (value) => !Number.isSafeInteger(value) || value <= 0,
  )) throw new Error("invalid Relay abuse limits");
  const legacyBroker = new HostBroker();
  const registry = new DeviceBrokerRegistry();
  const store = new DeviceStore(
    options.databasePath ?? ":memory:",
    now,
    options.storeLimits,
  );
  let storeOpen = true;
  const accessVerifier = options.accessVerifier ?? (
    options.accessTeamDomain && options.accessAudience
      ? new CloudflareAccessJWTVerifier({
        teamDomain: options.accessTeamDomain,
        audience: options.accessAudience,
      })
      : undefined
  );
  if (options.requireAccessIdentity && !accessVerifier) {
    store.close();
    throw new Error("Cloudflare Access JWT verification is required");
  }
  const globalAuthLimiter = new FixedWindowRateLimiter(
    abuseLimits.authWindowMS,
    abuseLimits.maximumGlobalAuthAttempts,
    1,
    now,
  );
  const perIPAuthLimiter = new FixedWindowRateLimiter(
    abuseLimits.authWindowMS,
    abuseLimits.maximumAuthAttemptsPerIP,
    abuseLimits.maximumDeviceConnections * 4,
    now,
  );
  const connectionLimiter = new ConcurrentConnectionLimiter(
    abuseLimits.maximumDeviceConnections,
    abuseLimits.maximumDeviceConnectionsPerIP,
    abuseLimits.maximumDeviceConnections * 4,
  );
  const pairLimiter = new FixedWindowRateLimiter(
    abuseLimits.pairWindowMS,
    abuseLimits.maximumPairCreatesPerDevice,
    abuseLimits.maximumDeviceConnections * 4,
    now,
  );
  const signaling = new SignalingRegistry(now);
  const deviceConnections = new Map<string, {
    ws: WebSocket;
    hostEpoch: string;
    commandAuthorized: boolean;
  }>();

  const server = http.createServer(async (req, res) => {
    noStore(res);
    const url = new URL(req.url ?? "/", publicOrigin);
    const authoritativeHost = requestHost(req, "https:");
    // The signaling hostname exposes no HTTP application surface. cloudflared
    // also path-filters it, while this origin check fails closed if that outer
    // boundary is misconfigured.
    if (authoritativeHost === deviceSignalHost) {
      return json(res, 404, { error: "not found" });
    }
    if (authoritativeHost !== publicHost) {
      return json(res, 400, { error: "invalid host" });
    }
    const assertion = accessAssertion(req);
    const accessIdentity = assertion && accessVerifier
      ? await accessVerifier.verify(assertion)
      : null;
    if (options.requireAccessIdentity && !accessIdentity) {
      return json(res, 401, { error: "access identity required" });
    }
    const subject = options.requireAccessIdentity
      ? accessIdentity?.subject ?? null
      : browserSessionSubject(req, store);
    if (url.pathname === "/healthz") return json(res, 200, { ok: true });
    if (url.pathname === "/" && req.method === "GET") {
      const csrf = randomBytes(24).toString("base64url");
      const nonce = randomBytes(18).toString("base64");
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Set-Cookie", `pipiui_csrf=${csrf}; Secure; SameSite=Strict; Path=/`);
      res.setHeader(
        "Content-Security-Policy",
        `default-src 'none'; script-src 'nonce-${nonce}' 'self'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
      );
      const html = subject ? pageHTML : unpairedPageHTML;
      return res.end(html.replaceAll("{{NONCE}}", nonce));
    }
    if (url.pathname === "/assets/remote.js" && req.method === "GET") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/javascript; charset=utf-8");
      return res.end(browserClientAsset());
    }
    if (req.method === "GET" && /^\/pair\/[0-9a-f-]{36}$/i.test(url.pathname)) {
      const csrf = randomBytes(24).toString("base64url");
      const nonce = randomBytes(18).toString("base64");
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Set-Cookie", `pipiui_csrf=${csrf}; Secure; SameSite=Strict; Path=/`);
      res.setHeader(
        "Content-Security-Policy",
        `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
      );
      return res.end(pairPageHTML(nonce));
    }
    if (url.pathname === "/api/devices" && req.method === "GET") {
      if (!subject) return json(res, 401, { error: "browser pairing required" });
      return json(res, 200, {
        devices: store.boundDeviceIDs(subject).flatMap((deviceID) => {
          const device = store.device(deviceID);
          return device && device.status === "active" ? [{
            deviceID,
            displayName: device.displayName,
            online: registry.online(deviceID),
            publicKeyX963: device.publicKeyX963,
            fingerprint: device.fingerprint,
          }] : [];
        }),
      });
    }
    if (url.pathname === "/api/pair/claim" && req.method === "POST") {
      if (!csrfAccepted(req, publicOrigin)) {
        return json(res, 403, { error: "request rejected" });
      }
      let body: unknown;
      try { body = await readJSON(req); } catch {
        return json(res, 400, { error: "request rejected" });
      }
      if (!isExactObject(body, ["v", "pairID", "pairSecret", "fingerprint"])
        || body.v !== PROTOCOL_VERSION
        || typeof body.pairID !== "string"
        || !/^[0-9a-f-]{36}$/i.test(body.pairID)
        || typeof body.pairSecret !== "string"
        || !/^[A-Za-z0-9_-]{43}$/.test(body.pairSecret)
        || Buffer.from(body.pairSecret, "base64url").toString("base64url")
            !== body.pairSecret
        || typeof body.fingerprint !== "string"
        || !/^[0-9a-f]{64}$/.test(body.fingerprint)) {
        return json(res, 400, { error: "request rejected" });
      }
      const pendingDeviceID = store.pendingPairDevice(
        body.pairID.toLowerCase(),
        body.fingerprint,
      );
      const pendingConnection = pendingDeviceID
        ? deviceConnections.get(pendingDeviceID)
        : undefined;
      if (!pendingDeviceID
        || !pendingConnection
        || pendingConnection.ws.readyState !== WebSocket.OPEN) {
        return json(res, 403, { error: "request rejected" });
      }
      const sessionToken = options.requireAccessIdentity || subject
        ? null
        : randomBytes(32).toString("base64url");
      const claimSubject = subject ?? (sessionToken
        ? `browser:${
          createHash("sha256")
            .update(Buffer.from(sessionToken, "base64url"))
            .digest("hex")
        }`
        : null);
      if (!claimSubject) return json(res, 403, { error: "request rejected" });
      const claimed = store.claimPair({
        pairID: body.pairID.toLowerCase(),
        pairSecretHash: createHash("sha256").update(
          Buffer.from(body.pairSecret, "base64url"),
        ).digest("hex"),
        fingerprint: body.fingerprint,
        subject: claimSubject,
      });
      if (!claimed) return json(res, 403, { error: "request rejected" });
      const claimedDevice = store.device(claimed.deviceID);
      if (!claimedDevice || claimedDevice.status === "revoked") {
        return json(res, 403, { error: "request rejected" });
      }
      const connection = deviceConnections.get(claimed.deviceID);
      if (connection === pendingConnection
        && connection.ws.readyState === WebSocket.OPEN) {
        connection.commandAuthorized = true;
        registry.attach(claimed.deviceID, connection.ws, connection.hostEpoch);
        connection.ws.send(JSON.stringify({
          v: PROTOCOL_VERSION,
          type: "pair.claimed",
          pairID: claimed.pairID,
          expiresAt: claimed.expiresAt,
        }));
      }
      if (sessionToken) {
        res.setHeader("Set-Cookie", browserSessionCookie(sessionToken));
      }
      return json(res, 200, {
        ok: true,
        deviceID: claimed.deviceID,
        fingerprint: claimed.fingerprint,
        publicKeyX963: claimedDevice.publicKeyX963,
      });
    }
    if (url.pathname === "/api/bindings/revoke" && req.method === "POST") {
      if (!subject || !csrfAccepted(req, publicOrigin)) {
        return json(res, 403, { error: "request rejected" });
      }
      let body: unknown;
      try { body = await readJSON(req); } catch {
        return json(res, 400, { error: "request rejected" });
      }
      if (!isExactObject(body, ["v", "deviceID"])
        || body.v !== PROTOCOL_VERSION
        || typeof body.deviceID !== "string"
        || !/^[0-9a-f-]{36}$/i.test(body.deviceID)
        || !store.revokeBinding(subject, body.deviceID.toLowerCase())) {
        return json(res, 403, { error: "request rejected" });
      }
      const revokedDeviceID = body.deviceID.toLowerCase();
      const connectionIDs = signaling.revokeSubjectDevice(
        subject,
        revokedDeviceID,
      );
      const deviceConnection = deviceConnections.get(revokedDeviceID);
      if (deviceConnection?.ws.readyState === WebSocket.OPEN) {
        const control = JSON.stringify({
          v: PROTOCOL_VERSION,
          type: "binding.revoked",
          subject,
          deviceID: revokedDeviceID,
          connectionIDs,
        });
        try {
          deviceConnection.ws.send(control, (error) => {
            if (error) deviceConnection.ws.close(1011, "revoke delivery failed");
          });
        } catch {
          deviceConnection.ws.close(1011, "revoke delivery failed");
        }
      }
      if (!options.requireAccessIdentity
        && store.boundDeviceIDs(subject).length === 0) {
        res.setHeader("Set-Cookie", clearBrowserSessionCookie());
      }
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/api/connect" && req.method === "POST") {
      if (!subject || !csrfAccepted(req, publicOrigin)) {
        return json(res, 403, { error: "request rejected" });
      }
      let body: unknown;
      try { body = await readJSON(req); } catch {
        return json(res, 400, { error: "request rejected" });
      }
      const input = parseBrowserConnect(body);
      if (!input || !store.isBound(subject, input.deviceID.toLowerCase())) {
        return json(res, 403, { error: "request rejected" });
      }
      const device = store.device(input.deviceID.toLowerCase());
      const deviceConnection = deviceConnections.get(input.deviceID.toLowerCase());
      if (!device || !deviceConnection?.commandAuthorized
        || deviceConnection.ws.readyState !== WebSocket.OPEN) {
        return json(res, 503, { error: "device unavailable" });
      }
      const created = signaling.create(subject, input);
      if (!created) return json(res, 429, { error: "signaling capacity exceeded" });
      deviceConnection.ws.send(JSON.stringify(created.offer));
      return json(res, 201, {
        v: PROTOCOL_VERSION,
        connectionID: created.session.connectionID,
        deviceID: created.session.deviceID,
        browserNonce: created.session.browserNonce,
        expiresAt: created.session.expiresAt,
        fingerprint: device.fingerprint,
        publicKeyX963: device.publicKeyX963,
      });
    }
    const signalPath = /^\/api\/connect\/([0-9a-f-]{36})\/signal$/i.exec(
      url.pathname,
    );
    if (signalPath && req.method === "POST") {
      if (!subject || !csrfAccepted(req, publicOrigin)) {
        return json(res, 403, { error: "request rejected" });
      }
      let body: unknown;
      try { body = await readJSON(req); } catch {
        return json(res, 400, { error: "request rejected" });
      }
      const forwarded = signaling.acceptBrowser(
        subject,
        signalPath[1].toLowerCase(),
        body,
      );
      if (!forwarded) return json(res, 403, { error: "request rejected" });
      const deviceConnection = deviceConnections.get(forwarded.deviceID);
      if (!deviceConnection?.commandAuthorized
        || deviceConnection.ws.readyState !== WebSocket.OPEN) {
        return json(res, 503, { error: "device unavailable" });
      }
      deviceConnection.ws.send(JSON.stringify(forwarded));
      return json(res, 202, { ok: true });
    }
    const signalsPath = /^\/api\/connect\/([0-9a-f-]{36})\/signals$/i.exec(
      url.pathname,
    );
    if (signalsPath && req.method === "GET") {
      if (!subject
        || [...url.searchParams.keys()].length !== 1
        || !url.searchParams.has("after")) {
        return json(res, 403, { error: "request rejected" });
      }
      const afterText = url.searchParams.get("after") ?? "";
      if (!/^(0|[1-9][0-9]*)$/.test(afterText)) {
        return json(res, 400, { error: "request rejected" });
      }
      const frames = signaling.poll(
        subject,
        signalsPath[1].toLowerCase(),
        Number(afterText),
      );
      if (!frames) return json(res, 403, { error: "request rejected" });
      return json(res, 200, { v: PROTOCOL_VERSION, signals: frames });
    }

    const routes: Record<string, Command> = {
      "GET /api/index": "index",
      "POST /api/sessions": "session.create",
      "POST /api/sessions/open": "session.open",
      "POST /api/snapshot": "snapshot",
      "POST /api/send": "prompt.send",
      "POST /api/stop": "generation.stop",
      "POST /api/models": "models.get",
      "POST /api/model": "model.set",
      "POST /api/subagent-model": "subagentModel.set",
      "POST /api/agents": "agents.list",
      "POST /api/agent": "agents.detail",
      "POST /api/panel-state": "panel.state",
      "POST /api/document": "document.get",
    };
    const command = routes[`${req.method} ${url.pathname}`];
    if (!command || !COMMANDS.has(command)) return json(res, 404, { error: "not found" });
    if (req.method === "POST" && !csrfAccepted(req, publicOrigin)) {
      const contentType = req.headers["content-type"]?.split(";")[0].trim();
      return json(
        res,
        contentType !== "application/json" ? 415 : 403,
        { error: contentType !== "application/json"
          ? "application/json required"
          : "origin or csrf rejected" },
      );
    }
    let broker: HostBroker | null = null;
    if (subject) {
      const requested = req.headers["x-pipiui-device-id"];
      const bound = store.boundDeviceIDs(subject);
      if (typeof requested === "string"
        && /^[0-9a-f-]{36}$/i.test(requested)
        && store.isBound(subject, requested.toLowerCase())) {
        broker = registry.broker(requested.toLowerCase());
      } else if (requested === undefined && bound.length === 1) {
        broker = registry.broker(bound[0]);
      }
    }
    if (!broker) return json(res, 403, { error: "device selection rejected" });
    let body: unknown = {};
    try { body = await readJSON(req); } catch (error) {
      return json(res, error instanceof RangeError ? 413 : 400, { error: "invalid body" });
    }
    try {
      const response = await broker.request(command, body);
      const epoch = broker.currentEpoch();
      if (epoch) res.setHeader("X-PipiUI-Host-Epoch", epoch);
      return json(res, response.status, response.body);
    } catch (error) {
      if (error instanceof HostOfflineError || error instanceof HostReplacedError) {
        return json(res, 503, { error: "host_offline" });
      }
      if (error instanceof HostTimeoutError) return json(res, 504, { error: "host_timeout" });
      if (error instanceof HostBusyError) return json(res, 429, { error: "host_busy" });
      return json(res, 502, { error: "relay_error" });
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_RESPONSE_BYTES });
  const legacyWSS = new WebSocketServer({ noServer: true, maxPayload: MAX_RESPONSE_BYTES });
  server.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url ?? "/", publicOrigin);
    const authoritativeHost = requestHost(req, "https:");
    if (url.pathname === "/device/ws"
      && authoritativeHost === deviceSignalHost) {
      const address = clientAddress(req, options.trustCFConnectingIP === true);
      if (!globalAuthLimiter.take("global")
        || !perIPAuthLimiter.take(address)
        || !connectionLimiter.open(address)) {
        rejectUpgrade(socket, "429 Too Many Requests");
        return;
      }
      try {
        wss.handleUpgrade(req, socket, head, (ws) => {
          ws.once("close", () => connectionLimiter.close(address));
          wss.emit("connection", ws, req);
        });
      } catch {
        connectionLimiter.close(address);
        rejectUpgrade(socket);
      }
      return;
    }
    const assertion = accessAssertion(req);
    const accessIdentity = assertion && accessVerifier
      ? await accessVerifier.verify(assertion)
      : null;
    if (url.pathname === "/host/ws"
      && options.deviceID
      && options.deviceSecretSHA256
      && authoritativeHost === publicHost
      && (!options.requireAccessIdentity || Boolean(accessIdentity))
      && req.headers["x-pipiui-device-id"]?.toString().toLowerCase() === options.deviceID
      && typeof req.headers["x-pipiui-device-secret"] === "string"
      && validDeviceSecret(
        req.headers["x-pipiui-device-secret"],
        options.deviceSecretSHA256,
      )) {
      legacyWSS.handleUpgrade(req, socket, head, (ws) => legacyWSS.emit("connection", ws, req));
      return;
    }
    rejectUpgrade(socket);
  });

  wss.on("connection", (ws: WebSocket) => {
    const challenge: DeviceAuthChallenge = {
      v: PROTOCOL_VERSION,
      type: "auth.challenge",
      connectionID: randomUUID(),
      nonce: randomBytes(32).toString("base64url"),
      audience: deviceSignalOrigin,
      expiresAt: now() + AUTH_DEADLINE_MS,
    };
    let authState: "awaiting" | "terminal" | "authenticated" = "awaiting";
    let deviceID: string | undefined;
    let publicKeyX963: string | undefined;
    let fingerprint: string | undefined;
    let hostEpoch: string | undefined;
    const authDeadline = setTimeout(
      () => ws.close(1008, "authentication failed"),
      AUTH_DEADLINE_MS,
    );
    ws.send(JSON.stringify(challenge));
    ws.on("message", (data, isBinary) => {
      if (isBinary) return ws.close(1003, "text frames required");
      const text = data.toString();
      if (authState === "awaiting") {
        // Consume the one allowed first application frame before parsing or
        // verifying it. A queued valid frame cannot revive a failed socket.
        authState = "terminal";
        const proof = parseDeviceAuthProof(text);
        if (!proof
          || proof.connectionID !== challenge.connectionID
          || proof.expiresAt !== challenge.expiresAt
          || now() >= challenge.expiresAt
          || !verifyDeviceSignature(
            proof.publicKeyX963,
            deviceAuthTranscript(challenge, proof),
            proof.signatureDER,
          )) {
          return ws.close(1008, "authentication failed");
        }
        const device = store.registerOrVerifyDevice({
          deviceID: proof.deviceID.toLowerCase(),
          publicKeyX963: proof.publicKeyX963,
          fingerprint: proof.fingerprint,
          displayName: proof.displayName,
        });
        if (!device) return ws.close(1008, "authentication failed");
        // Every successful authentication establishes a fresh pending-pair
        // epoch, including the first socket after a Relay process restart.
        // Clear durable pairs before this socket can create a replacement.
        store.revokePendingPairsForDevice(device.deviceID, now());
        authState = "authenticated";
        clearTimeout(authDeadline);
        deviceID = device.deviceID;
        publicKeyX963 = device.publicKeyX963;
        fingerprint = device.fingerprint;
        hostEpoch = proof.hostEpoch.toLowerCase();
        const previous = deviceConnections.get(deviceID);
        if (previous && previous.ws !== ws) {
          // Revoke before installing the replacement as current. The old
          // socket's delayed close then fails the current-socket identity
          // check and cannot revoke a pair created by this replacement.
          signaling.closeDevice(deviceID);
          previous.ws.close(4001, "device replaced");
        }
        const connection = {
          ws,
          hostEpoch,
          commandAuthorized: device.status === "active",
        };
        deviceConnections.set(deviceID, connection);
        if (connection.commandAuthorized) registry.attach(deviceID, ws, hostEpoch);
        ws.send(JSON.stringify({
          v: PROTOCOL_VERSION,
          type: "auth.result",
          enrollmentStatus: device.status,
          commandAuthorized: connection.commandAuthorized,
        }));
        return;
      }
      if (authState !== "authenticated"
        || !deviceID || !publicKeyX963 || !fingerprint || !hostEpoch) {
        return ws.close(1008, "authentication failed");
      }
      const pairCreate = parsePairCreate(text);
      if (pairCreate) {
        if (!pairLimiter.take(deviceID)) {
          return ws.send(JSON.stringify({
            v: PROTOCOL_VERSION,
            type: "pair.rejected",
            pairID: pairCreate.pairID,
          }));
        }
        if (pairCreate.deviceID.toLowerCase() !== deviceID
          || pairCreate.fingerprint !== fingerprint
          || !verifyDeviceSignature(
            publicKeyX963,
            pairCreateTranscript(pairCreate),
            pairCreate.signatureDER,
          )) return ws.close(1008, "request rejected");
        const pair = store.createPair({
          pairID: pairCreate.pairID.toLowerCase(),
          deviceID,
          fingerprint,
          secretHash: pairCreate.secretHash,
          expiresAt: pairCreate.expiresAt,
        });
        if (!pair) return ws.send(JSON.stringify({
          v: PROTOCOL_VERSION,
          type: "pair.rejected",
          pairID: pairCreate.pairID,
        }));
        return ws.send(JSON.stringify({
          v: PROTOCOL_VERSION,
          type: "pair.created",
          pairID: pair.pairID,
          expiresAt: pair.expiresAt,
        }));
      }
      const pairControl = parsePairControl(text);
      if (pairControl && pairControl.deviceID.toLowerCase() === deviceID) {
        if (pairControl.type === "pair.revoke") {
          store.revokePair(pairControl.pairID.toLowerCase(), deviceID);
        }
        const pair = store.pair(pairControl.pairID.toLowerCase(), deviceID);
        return ws.send(JSON.stringify({
          v: PROTOCOL_VERSION,
          type: "pair.status",
          pairID: pairControl.pairID.toLowerCase(),
          state: pair?.state ?? "unavailable",
          expiresAt: pair?.expiresAt ?? 0,
        }));
      }
      let signalingValue: unknown;
      try { signalingValue = JSON.parse(text); } catch {
        return ws.close(1008, "request rejected");
      }
      if (typeof signalingValue === "object"
        && signalingValue !== null
        && typeof (signalingValue as { type?: unknown }).type === "string"
        && (signalingValue as { type: string }).type.startsWith("signal.")) {
        const forwarded = signaling.acceptDevice(deviceID, signalingValue);
        if (!forwarded) return ws.close(1008, "request rejected");
        return;
      }
      let value: unknown;
      value = signalingValue;
      if (typeof value === "object"
        && value !== null
        && (value as { type?: unknown }).type === "auth.proof") {
        return ws.close(1008, "authentication failed");
      }
      if (isExactObject(value, ["v", "type", "at"])
        && value.v === PROTOCOL_VERSION
        && value.type === "pong"
        && typeof value.at === "number") return;
      const connection = deviceConnections.get(deviceID);
      if (!connection?.commandAuthorized) return ws.close(1008, "request rejected");
      registry.broker(deviceID).receive(text);
    });
    ws.on("close", () => {
      clearTimeout(authDeadline);
      if (!deviceID) return;
      const current = deviceConnections.get(deviceID);
      if (current?.ws === ws) {
        deviceConnections.delete(deviceID);
        signaling.closeDevice(deviceID);
        if (storeOpen) store.revokePendingPairsForDevice(deviceID, now());
      }
      registry.detach(deviceID, ws);
    });
    ws.on("error", () => {
      if (deviceID) registry.detach(deviceID, ws);
    });
  });

  legacyWSS.on("connection", (ws: WebSocket) => {
    let accepted = false;
    const helloDeadline = setTimeout(
      () => ws.close(1008, "hello required"),
      AUTH_DEADLINE_MS,
    );
    ws.on("message", (data, isBinary) => {
      if (isBinary) return ws.close(1003, "text frames required");
      const text = data.toString();
      if (!accepted) {
        const hello = parseHello(text);
        if (!hello || hello.deviceID.toLowerCase() !== options.deviceID) {
          return ws.close(1008, "invalid hello");
        }
        accepted = true;
        clearTimeout(helloDeadline);
        legacyBroker.replace(ws, hello.hostEpoch);
        return;
      }
      let value: unknown;
      try { value = JSON.parse(text); } catch { return; }
      if (typeof value === "object" && value !== null
        && (value as { type?: unknown }).type === "pong") return;
      legacyBroker.receive(text);
    });
    ws.on("close", () => {
      clearTimeout(helloDeadline);
      legacyBroker.detach(ws);
    });
    ws.on("error", () => legacyBroker.detach(ws));
  });

  server.on("close", () => {
    storeOpen = false;
    store.close();
  });
  return {
    server,
    broker: legacyBroker,
    registry,
    store,
    signaling,
    options,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = optionsFromEnvironment();
  const { server } = createRelayServer(options);
  server.listen(options.port, options.host, () => {
    // Never log request bodies, prompts, transcript data, credentials, pair
    // secrets, device identifiers, or Access assertions.
    process.stdout.write(`PipiUI Relay listening on loopback port ${options.port}\n`);
  });
}
