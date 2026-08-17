import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";
import {
  createHostAPIRelay,
  defaultBrowserUIDir,
} from "./host-api-relay.js";
import type { HostAPIV2Limits } from "./host-api-v2.js";

const PAIR_PATH = /^\/pair\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const ROOM_ID = PAIR_PATH;
const DOWNLOAD_SEGMENT = "[A-Za-z0-9][A-Za-z0-9._-]{0,60}";
const DOWNLOAD_PATH = new RegExp(
  `^/downloads/(${DOWNLOAD_SEGMENT}(?:/${DOWNLOAD_SEGMENT}){0,3})$`,
);
const SECRET = /^[0-9a-f]{64}$/;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TUNNEL_PATH = "/tunnel/ws";
const ROOM_TTL_MS = 24 * 60 * 60 * 1_000;
const HELLO_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_PENDING_BROWSERS = 4;
const MAX_INFLIGHT = 32;
const MAX_ROOMS = 4_096;
const MAX_CLIENTS = 8_192;
const MAX_REQUEST_BYTES = 256 * 1_024;
const MAX_RESPONSE_BYTES = 8 * 1_024 * 1_024;

type Role = "host" | "browser";
type Client = {
  socket: WebSocket;
  role: Role | null;
  roomID: string | null;
  secretHash: Buffer | null;
  alive: boolean;
  helloTimer: NodeJS.Timeout;
};
type Room = {
  roomID: string;
  secretHash: Buffer;
  host: Client | null;
  browser: Client | null;
  expiresAt: number;
  expiryTimer: NodeJS.Timeout;
  inflight: Map<string, NodeJS.Timeout>;
};

export interface TunnelServerOptions {
  host: "127.0.0.1" | "::1";
  port: number;
  publicOrigin: string;
  tunnelURL: string;
  /** Directory behind GET /downloads/<name>; defaults to <relay>/downloads. */
  downloadsDir?: string;
  /** Shared packages/ui browser build, or a deployed copy. Missing dir uses fallback HTML. */
  browserUIDir?: string;
  now?: () => number;
  v2TTLMs?: number;
  v2Limits?: Partial<HostAPIV2Limits>;
  v2SecureCookies?: boolean;
}

export function tunnelOptionsFromEnvironment(
  env = process.env,
): TunnelServerOptions {
  const host = env.PIPIUI_RELAY_HOST ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "::1") {
    throw new Error("PIPIUI_RELAY_HOST must be loopback");
  }
  const publicOrigin = new URL(
    env.PIPIUI_PUBLIC_ORIGIN ?? "https://pipi.aichattrpg.com",
  );
  const tunnelURL = new URL(
    env.PIPIUI_TUNNEL_URL ?? "wss://signal.aichattrpg.com/tunnel/ws",
  );
  if (publicOrigin.protocol !== "https:" || publicOrigin.pathname !== "/"
    || publicOrigin.search || publicOrigin.hash) {
    throw new Error("PIPIUI_PUBLIC_ORIGIN must be an HTTPS origin");
  }
  if (tunnelURL.protocol !== "wss:" || tunnelURL.pathname !== TUNNEL_PATH
    || tunnelURL.search || tunnelURL.hash) {
    throw new Error("PIPIUI_TUNNEL_URL must be a wss /tunnel/ws URL");
  }
  const port = Number(env.PIPIUI_RELAY_PORT ?? "8787");
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("PIPIUI_RELAY_PORT must be a valid port");
  }
  const browserUIDir = env.PIPIUI_BROWSER_UI_DIR?.trim();
  return {
    host,
    port,
    publicOrigin: publicOrigin.origin,
    tunnelURL: tunnelURL.href,
    ...(browserUIDir ? { browserUIDir } : {}),
  };
}

function browserAsset(): string {
  const candidates = [
    new URL("../dist/assets/tunnel-browser.js", import.meta.url),
    new URL("./assets/tunnel-browser.js", import.meta.url),
  ];
  const selected = candidates.find((candidate) => existsSync(candidate));
  if (!selected) throw new Error("Tunnel browser bundle missing; run npm run bundle");
  return readFileSync(selected, "utf8");
}

function browserCSSAsset(): string {
  const candidates = [
    new URL("../dist/assets/tunnel-browser.css", import.meta.url),
    new URL("./assets/tunnel-browser.css", import.meta.url),
  ];
  const selected = candidates.find((candidate) => existsSync(candidate));
  if (!selected) throw new Error("Tunnel browser CSS missing; run npm run bundle");
  return readFileSync(selected, "utf8");
}

function downloadContentType(name: string): string {
  if (name.endsWith(".zip")) return "application/zip";
  if (name.endsWith(".dmg")) return "application/x-apple-diskimage";
  if (name.endsWith(".tar.gz")) return "application/gzip";
  if (name.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

/**
 * Streams one file from the relay's downloads directory (App builds etc.).
 * Path is 1–4 segments; each segment starts with [A-Za-z0-9] (no `..` or
 * dotfiles). After join(), resolve() must stay under downloadsRoot.
 * Single-range responses keep large downloads resumable.
 */
async function serveDownload(
  name: string,
  downloadsRoot: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const root = resolve(downloadsRoot);
  const filePath = resolve(join(downloadsRoot, name));
  if (filePath !== root && !filePath.startsWith(root + sep)) {
    return json(res, 404, { error: "not found" });
  }
  let size = 0;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("not a regular file");
    size = info.size;
  } catch {
    return json(res, 404, { error: "not found" });
  }
  let start = 0;
  let end = size - 1;
  let partial = false;
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
  if (range) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Number(range[2]);
    } else {
      start = Math.max(0, size - Number(range[2] || 0));
    }
    if (start >= size || start > end) {
      res.statusCode = 416;
      res.setHeader("Content-Range", `bytes */${size}`);
      res.end();
      return;
    }
    end = Math.min(end, size - 1);
    partial = true;
  }
  res.statusCode = partial ? 206 : 200;
  res.setHeader("Content-Type", downloadContentType(name));
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Length", String(end - start + 1));
  if (partial) res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
  if (req.method === "HEAD" || size === 0) {
    res.end();
    return;
  }
  createReadStream(filePath, { start, end })
    .on("error", () => res.destroy())
    .pipe(res);
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(value));
}

function pairPage(roomID: string, tunnelURL: string, nonce: string): string {
  const boot = JSON.stringify({ roomID, tunnelURL }).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="referrer" content="no-referrer"><title>PipiUI 远程会话</title>
<link rel="stylesheet" href="/assets/tunnel-browser.css" nonce="${nonce}">
</head><body>
<div id="root"></div>
<div id="boot-status" role="status">连接服务器隧道…</div>
<script nonce="${nonce}">
(() => {
  try {
    const stored = localStorage.getItem("pipiui-remote-theme");
    document.documentElement.dataset.theme = stored === "dark" || stored === "light"
      ? stored
      : (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  } catch {
    try {
      document.documentElement.dataset.theme =
        matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    } catch {}
  }
  const secret = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  window.__PIPI_TUNNEL_BOOT__ = Object.freeze({...${boot}, secret});
  if (!/^[0-9a-f]{64}$/.test(secret)) {
    document.getElementById("boot-status").textContent = "链接无效或密钥缺失；请从 Mac 重新复制完整链接。";
    document.getElementById("boot-status").className = "boot-error";
    return;
  }
  import("/assets/tunnel-browser.js").catch(error => {
    document.getElementById("boot-status").textContent = String(error?.message || error);
    document.getElementById("boot-status").className = "boot-error";
  });
})();
</script></body></html>`;
}

const secretHash = (secret: string): Buffer =>
  createHash("sha256").update(secret, "utf8").digest();
const exactSecret = (left: Buffer, right: Buffer): boolean =>
  left.length === right.length && timingSafeEqual(left, right);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const send = (client: Client, frame: unknown): void => {
  if (client.socket.readyState === WebSocket.OPEN) {
    client.socket.send(JSON.stringify(frame));
  }
};
const closeClient = (client: Client, code = 1008, reason = "link unavailable") => {
  clearTimeout(client.helloTimer);
  if (client.socket.readyState === WebSocket.OPEN
    || client.socket.readyState === WebSocket.CONNECTING) {
    client.socket.close(code, reason);
  }
};

export function createTunnelServer(options: TunnelServerOptions) {
  const rooms = new Map<string, Room>();
  const invalidatedRooms = new Map<string, NodeJS.Timeout>();
  const pendingBrowsers = new Map<string, Client[]>();
  const clients = new Set<Client>();
  const downloadsRoot = options.downloadsDir
    ?? fileURLToPath(new URL("../downloads/", import.meta.url));
  const v2 = createHostAPIRelay({
    publicOrigin: options.publicOrigin,
    browserUIDir: options.browserUIDir ?? defaultBrowserUIDir(),
    now: options.now,
    ttlMs: options.v2TTLMs,
    limits: options.v2Limits,
    secureCookies: options.v2SecureCookies,
  });
  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const url = new URL(req.url ?? "/", options.publicOrigin);
    if (req.method === "GET" && url.pathname === "/healthz") {
      return json(res, 200, { ok: true });
    }
    if (v2.handleRequest(req, res, url)) return;
    if (req.method === "GET" && url.pathname === "/") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.end("<!doctype html><meta charset=utf-8><title>PipiUI Remote</title><p>请在 Mac 上生成一个新的远程链接。</p>");
    }
    if (req.method === "GET" && url.pathname === "/assets/tunnel-browser.js") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/javascript; charset=utf-8");
      return res.end(browserAsset());
    }
    if (req.method === "GET" && url.pathname === "/assets/tunnel-browser.css") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/css; charset=utf-8");
      return res.end(browserCSSAsset());
    }
    const download = DOWNLOAD_PATH.exec(url.pathname);
    if (download && (req.method === "GET" || req.method === "HEAD")) {
      return void serveDownload(download[1], downloadsRoot, req, res);
    }
    const pair = req.method === "GET" ? PAIR_PATH.exec(url.pathname) : null;
    if (pair) {
      const nonce = randomBytes(18).toString("base64");
      const connectOrigin = new URL(options.tunnelURL).origin;
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader(
        "Content-Security-Policy",
        `default-src 'none'; script-src 'nonce-${nonce}' 'self'; style-src 'nonce-${nonce}' 'self'; connect-src ${connectOrigin}; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
      );
      return res.end(pairPage(pair[1].toLowerCase(), options.tunnelURL, nonce));
    }
    return json(res, 404, { error: "not found" });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_RESPONSE_BYTES });
  const invalidateRoom = (
    room: Room,
    reason: string,
    retainTombstone = true,
  ): void => {
    if (rooms.get(room.roomID) !== room) return;
    rooms.delete(room.roomID);
    clearTimeout(room.expiryTimer);
    for (const timer of room.inflight.values()) clearTimeout(timer);
    room.inflight.clear();
    if (retainTombstone) {
      const existing = invalidatedRooms.get(room.roomID);
      if (existing) clearTimeout(existing);
      const remaining = Math.max(1, room.expiresAt - Date.now());
      const timer = setTimeout(() => invalidatedRooms.delete(room.roomID), remaining);
      timer.unref();
      invalidatedRooms.set(room.roomID, timer);
    }
    if (room.host) send(room.host, { v: 1, type: "invalidated", reason });
    if (room.browser) send(room.browser, { v: 1, type: "invalidated", reason });
    if (room.host) closeClient(room.host, 1000, "link invalidated");
    if (room.browser) closeClient(room.browser, 1000, "link invalidated");
  };
  // Last-opener-wins: a new browser with the correct secret becomes THE
  // browser. The previous one is closed immediately (the page surfaces the
  // "replaced" reason); the room and its TTL are untouched, so both refreshing
  // the old URL and brand-new browsers keep connecting.
  const attachBrowser = (room: Room, browser: Client): void => {
    const previous = room.browser;
    room.browser = browser;
    if (previous) {
      send(previous, { v: 1, type: "replaced" });
      closeClient(previous, 1000, "replaced");
    }
    if (room.host) send(room.host, { v: 1, type: "ready" });
    send(browser, { v: 1, type: "ready" });
  };

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", options.publicOrigin);
    if (url.pathname === TUNNEL_PATH && !url.search && !url.hash) {
      wss.handleUpgrade(request, socket, head, (webSocket) => {
        wss.emit("connection", webSocket, request);
      });
      return;
    }
    if (v2.handleUpgrade(request, socket, head)) return;
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
  });

  wss.on("connection", (socket) => {
    const client: Client = {
      socket,
      role: null,
      roomID: null,
      secretHash: null,
      alive: true,
      helloTimer: setTimeout(() => socket.close(1008, "hello required"), HELLO_TIMEOUT_MS),
    };
    if (clients.size >= MAX_CLIENTS) {
      clearTimeout(client.helloTimer);
      socket.close(1013, "server busy");
      return;
    }
    client.helloTimer.unref();
    clients.add(client);
    socket.on("message", (raw, isBinary) => {
      if (isBinary) return closeClient(client);
      const bytes = Buffer.byteLength(raw as Buffer);
      if (bytes > (client.role === "host" ? MAX_RESPONSE_BYTES : MAX_REQUEST_BYTES)) {
        return closeClient(client, 1009, "frame too large");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString()) as unknown;
      } catch {
        return closeClient(client);
      }
      if (!isRecord(parsed)) return closeClient(client);
      const frame = parsed;
      if (!client.role) {
        if (Object.keys(frame).sort().join(",") !== "role,roomID,secret,type,v"
          || frame.v !== 1 || frame.type !== "hello"
          || (frame.role !== "host" && frame.role !== "browser")
          || typeof frame.roomID !== "string" || !ROOM_ID.test(`/pair/${frame.roomID}`)
          || typeof frame.secret !== "string" || !SECRET.test(frame.secret)) {
          return closeClient(client);
        }
        clearTimeout(client.helloTimer);
        client.role = frame.role;
        client.roomID = frame.roomID.toLowerCase();
        client.secretHash = secretHash(frame.secret);
        if (client.role === "host") {
          if (invalidatedRooms.has(client.roomID)) return closeClient(client);
          const existing = rooms.get(client.roomID);
          if (existing) {
            // Host rejoin/replace for an existing room: the new host becomes
            // THE host (last-opener-wins), the old socket is closed. Room,
            // browser and inflight state are preserved.
            if (!exactSecret(client.secretHash, existing.secretHash)) {
              return closeClient(client);
            }
            const previous = existing.host;
            existing.host = client;
            if (previous) {
              send(previous, { v: 1, type: "replaced" });
              closeClient(previous, 1000, "replaced");
            }
            send(client, { v: 1, type: "host-ready", expiresAt: existing.expiresAt });
            if (existing.browser) {
              send(client, { v: 1, type: "ready" });
              send(existing.browser, { v: 1, type: "ready" });
            }
            return;
          }
          if (rooms.size >= MAX_ROOMS) return closeClient(client);
          const room: Room = {
            roomID: client.roomID,
            secretHash: client.secretHash,
            host: client,
            browser: null,
            expiresAt: Date.now() + ROOM_TTL_MS,
            expiryTimer: setTimeout(() => {}, ROOM_TTL_MS),
            inflight: new Map(),
          };
          clearTimeout(room.expiryTimer);
          room.expiryTimer = setTimeout(
            () => invalidateRoom(room, "link expired"),
            ROOM_TTL_MS,
          );
          room.expiryTimer.unref();
          rooms.set(room.roomID, room);
          send(client, { v: 1, type: "host-ready", expiresAt: room.expiresAt });
          const waiting = pendingBrowsers.get(room.roomID) ?? [];
          pendingBrowsers.delete(room.roomID);
          for (const item of waiting) {
            if (item.secretHash && exactSecret(item.secretHash, room.secretHash)) {
              attachBrowser(room, item);
            } else {
              closeClient(item);
            }
          }
          return;
        }
        const room = rooms.get(client.roomID);
        if (room) {
          if (!exactSecret(client.secretHash, room.secretHash)) return closeClient(client);
          attachBrowser(room, client);
          return;
        }
        if (invalidatedRooms.has(client.roomID)) return closeClient(client);
        const waiting = pendingBrowsers.get(client.roomID) ?? [];
        if (waiting.length >= MAX_PENDING_BROWSERS) return closeClient(client);
        waiting.push(client);
        pendingBrowsers.set(client.roomID, waiting);
        return;
      }

      const room = client.roomID ? rooms.get(client.roomID) : undefined;
      if (!room || Date.now() >= room.expiresAt) {
        if (room) invalidateRoom(room, "link expired");
        else closeClient(client);
        return;
      }
      if (client.role === "browser") {
        if (room.browser !== client
          || Object.keys(frame).sort().join(",") !== "body,command,requestID,type,v"
          || frame.v !== 1 || frame.type !== "request"
          || typeof frame.requestID !== "string" || !REQUEST_ID.test(frame.requestID)
          || typeof frame.command !== "string" || frame.command.length > 64
          || !frame.body || typeof frame.body !== "object" || Array.isArray(frame.body)
          || room.inflight.size >= MAX_INFLIGHT || room.inflight.has(frame.requestID)) {
          return closeClient(client);
        }
        if (!room.host || room.host.socket.readyState !== WebSocket.OPEN) {
          // Host dropped; fail the request gracefully instead of hanging.
          send(client, { v: 1, type: "error", requestID: frame.requestID, message: "host offline" });
          return;
        }
        const requestID = frame.requestID;
        const timer = setTimeout(() => {
          if (!room.inflight.delete(requestID)) return;
          send(client, { v: 1, type: "error", requestID, message: "request timed out" });
        }, REQUEST_TIMEOUT_MS);
        timer.unref();
        room.inflight.set(requestID, timer);
        send(room.host, frame);
        return;
      }
      if (room.host !== client) return closeClient(client);
      if (frame.type === "end" && frame.v === 1) {
        // Intentional host teardown: invalidate + tombstone the room.
        invalidateRoom(room, "host ended");
        return;
      }
      if (Object.keys(frame).sort().join(",") !== "body,requestID,status,type,v"
        || frame.v !== 1 || frame.type !== "response"
        || typeof frame.requestID !== "string" || !REQUEST_ID.test(frame.requestID)
        || typeof frame.status !== "number" || !Number.isInteger(frame.status)
        || frame.status < 100 || frame.status > 599
        || !("body" in frame)) {
        return closeClient(client);
      }
      const timer = room.inflight.get(frame.requestID);
      if (!timer) return closeClient(client);
      clearTimeout(timer);
      room.inflight.delete(frame.requestID);
      if (room.browser) send(room.browser, frame);
    });
    socket.on("close", () => {
      clients.delete(client);
      clearTimeout(client.helloTimer);
      if (client.role === "browser" && client.roomID) {
        const waiting = pendingBrowsers.get(client.roomID);
        if (waiting) {
          const remaining = waiting.filter((item) => item !== client);
          if (remaining.length) pendingBrowsers.set(client.roomID, remaining);
          else pendingBrowsers.delete(client.roomID);
        }
      }
      const room = client.roomID ? rooms.get(client.roomID) : undefined;
      if (!room) return;
      // Browser disconnect must not kill the room. A host drop without an
      // explicit "end" frame only clears room.host so the host can rejoin the
      // same room within the TTL; the room and browser stay. Only an explicit
      // "end" frame (or TTL expiry / server stop) invalidates + tombstones.
      if (room.browser === client) {
        room.browser = null;
      } else if (room.host === client) {
        room.host = null;
      }
    });
    socket.on("pong", () => { client.alive = true; });
  });

  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) {
        client.socket.terminate();
        continue;
      }
      client.alive = false;
      client.socket.ping();
    }
  }, 25_000);
  heartbeat.unref();

  return {
    server,
    options,
    getRoomCount: () => rooms.size,
    getClientCount: () => clients.size,
    getV2RoomCount: () => v2.getRoomCount(),
    getV2ClientCount: () => v2.getClientCount(),
    close: async () => {
      clearInterval(heartbeat);
      await v2.close();
      for (const room of [...rooms.values()]) {
        invalidateRoom(room, "server stopped", false);
      }
      for (const timer of invalidatedRooms.values()) clearTimeout(timer);
      invalidatedRooms.clear();
      for (const waiting of pendingBrowsers.values()) waiting.forEach((item) => closeClient(item));
      pendingBrowsers.clear();
      // Shutdown is an operational boundary, not a peer protocol event. Do not
      // wait indefinitely for remote close handshakes during tests or SIGTERM.
      for (const client of clients) {
        clearTimeout(client.helloTimer);
        client.socket.terminate();
      }
      clients.clear();
      await new Promise<void>((resolve) => {
        let completed = false;
        const finish = () => {
          if (completed) return;
          completed = true;
          clearTimeout(deadline);
          resolve();
        };
        const deadline = setTimeout(finish, 250);
        try {
          wss.close(finish);
        } catch {
          finish();
        }
      });
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = tunnelOptionsFromEnvironment();
  const instance = createTunnelServer(options);
  instance.server.listen(options.port, options.host, () => {
    process.stdout.write(`PipiUI capability tunnel listening on loopback port ${options.port}\n`);
  });
}
