import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import http, { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";
import {
  HostBroker,
  HostBusyError,
  HostOfflineError,
  HostReplacedError,
  HostTimeoutError,
} from "./broker.js";
import {
  COMMANDS,
  Command,
  MAX_BODY_BYTES,
  MAX_RESPONSE_BYTES,
  PROTOCOL_VERSION,
  parseHello,
} from "./protocol.js";
import { pageHTML } from "./page.js";

export interface RelayOptions {
  host: "127.0.0.1" | "::1";
  port: number;
  publicOrigin: string;
  deviceID: string;
  deviceSecretSHA256: string;
  requireAccessIdentity: boolean;
}

export function optionsFromEnvironment(env = process.env): RelayOptions {
  const host = env.PIPIUI_RELAY_HOST ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "::1") {
    throw new Error("PIPIUI_RELAY_HOST must be loopback");
  }
  const publicOrigin = new URL(env.PIPIUI_PUBLIC_ORIGIN ?? "https://pipi.aichattrpg.com").origin;
  const deviceID = env.PIPIUI_DEVICE_ID ?? "";
  const deviceSecretSHA256 = env.PIPIUI_DEVICE_SECRET_SHA256 ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(deviceID)) throw new Error("PIPIUI_DEVICE_ID required");
  if (!/^[0-9a-f]{64}$/i.test(deviceSecretSHA256)) {
    throw new Error("PIPIUI_DEVICE_SECRET_SHA256 required");
  }
  return {
    host,
    port: Number(env.PIPIUI_RELAY_PORT ?? "8787"),
    publicOrigin,
    deviceID: deviceID.toLowerCase(),
    deviceSecretSHA256: deviceSecretSHA256.toLowerCase(),
    requireAccessIdentity: env.PIPIUI_REQUIRE_ACCESS_IDENTITY !== "false",
  };
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

function identityPresent(req: IncomingMessage): boolean {
  return typeof req.headers["cf-access-jwt-assertion"] === "string"
    || typeof req.headers["cf-access-authenticated-user-email"] === "string";
}

function effectiveHost(req: IncomingMessage): string | undefined {
  const forwarded = req.headers["x-forwarded-host"];
  return typeof forwarded === "string" ? forwarded.split(",")[0].trim() : req.headers.host;
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

function validDeviceSecret(secret: string, expectedHash: string): boolean {
  const actual = createHash("sha256").update(secret).digest();
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createRelayServer(options: RelayOptions) {
  const broker = new HostBroker();
  const server = http.createServer(async (req, res) => {
    noStore(res);
    const url = new URL(req.url ?? "/", options.publicOrigin);
    if (url.pathname === "/healthz") {
      return json(res, 200, { ok: true });
    }
    if (options.requireAccessIdentity && !identityPresent(req)) {
      return json(res, 401, { error: "access identity required" });
    }
    if (effectiveHost(req) !== new URL(options.publicOrigin).host) {
      return json(res, 400, { error: "invalid host" });
    }
    if (url.pathname === "/" && req.method === "GET") {
      const csrf = randomBytes(24).toString("base64url");
      const nonce = randomBytes(18).toString("base64");
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      // This is a non-secret double-submit CSRF nonce. Cloudflare Access owns
      // the separate HttpOnly authentication cookie.
      res.setHeader("Set-Cookie", `pipiui_csrf=${csrf}; Secure; SameSite=Strict; Path=/`);
      res.setHeader(
        "Content-Security-Policy",
        `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
      );
      return res.end(pageHTML.replaceAll("{{NONCE}}", nonce));
    }
    const routes: Record<string, Command> = {
      "GET /api/index": "index",
      "POST /api/sessions": "session.create",
      "POST /api/sessions/open": "session.open",
      "POST /api/snapshot": "snapshot",
      "POST /api/send": "prompt.send",
      "POST /api/stop": "generation.stop",
    };
    const command = routes[`${req.method} ${url.pathname}`];
    if (!command || !COMMANDS.has(command)) return json(res, 404, { error: "not found" });
    if (req.method === "POST") {
      const csrfCookie = cookie(req, "pipiui_csrf");
      const csrfHeader = req.headers["x-pipiui-csrf"];
      if (req.headers.origin !== options.publicOrigin
        || typeof csrfHeader !== "string"
        || !csrfCookie
        || csrfHeader !== csrfCookie) {
        return json(res, 403, { error: "origin or csrf rejected" });
      }
      if (req.headers["content-type"]?.split(";")[0].trim() !== "application/json") {
        return json(res, 415, { error: "application/json required" });
      }
    }
    let body: unknown = {};
    try { body = await readJSON(req); }
    catch (error) {
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
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", options.publicOrigin);
    if (url.pathname !== "/host/ws"
      || (options.requireAccessIdentity && !identityPresent(req))
      || effectiveHost(req) !== new URL(options.publicOrigin).host
      || req.headers["x-pipiui-device-id"]?.toString().toLowerCase() !== options.deviceID
      || typeof req.headers["x-pipiui-device-secret"] !== "string"
      || !validDeviceSecret(req.headers["x-pipiui-device-secret"], options.deviceSecretSHA256)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws: WebSocket) => {
    let accepted = false;
    const helloDeadline = setTimeout(() => ws.close(1008, "hello required"), 5_000);
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
        broker.replace(ws, hello.hostEpoch);
        return;
      }
      let value: unknown;
      try { value = JSON.parse(text); } catch { return; }
      if (typeof value === "object" && value !== null
        && (value as { type?: unknown }).type === "pong") return;
      broker.receive(text);
    });
    ws.on("close", () => {
      clearTimeout(helloDeadline);
      broker.detach(ws);
    });
    ws.on("error", () => broker.detach(ws));
  });

  return { server, broker, options };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = optionsFromEnvironment();
  const { server } = createRelayServer(options);
  server.listen(options.port, options.host, () => {
    // No request bodies, prompts, transcript data, credentials, or device IDs.
    process.stdout.write(`PipiUI Relay listening on loopback port ${options.port}\n`);
  });
}
