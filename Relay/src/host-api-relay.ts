import { randomBytes } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";
import { FixedWindowRateLimiter } from "./limits.js";
import {
  BROWSER_WS_PATH,
  CLAIM_BODY_MAX_BYTES,
  DEFAULT_ROOM_TTL_MS,
  DEFAULT_V2_LIMITS,
  GRANT_TOKEN_RE,
  HOST_WS_PATH,
  PAIR_CLAIM_PATH_RE,
  PAIR_COOKIE,
  PAIR_PATH_RE,
  classifyFrame,
  cookieValue,
  exactBuffer,
  fallbackBrowserHTML,
  newGrantToken,
  pairCookie,
  pairPageHTML,
  parseClaimBody,
  parseHostHello,
  sha256utf8,
  type ClassifiedFrame,
  type HostAPIV2Limits,
} from "./host-api-v2.js";

export interface HostAPIRelayOptions {
  publicOrigin: string;
  browserUIDir?: string;
  now?: () => number;
  ttlMs?: number;
  limits?: Partial<HostAPIV2Limits>;
  secureCookies?: boolean;
}

type Peer = {
  socket: WebSocket;
  role: "host" | "browser";
  roomID: string | null;
  alive: boolean;
  helloTimer?: NodeJS.Timeout;
  hostEpoch?: number;
  generation?: number;
};

type Room = {
  roomID: string;
  pairSecretHash: Buffer;
  hostTokenHash: Buffer;
  host: Peer | null;
  browser: Peer | null;
  hostEpoch: number;
  browserGeneration: number;
  expiresAt: number;
  expiryTimer: NodeJS.Timeout;
  inflight: Set<string>;
  grantHash?: Buffer;
};

const TUNNEL_ASSET_PATHS = new Set([
  "/assets/tunnel-browser.js",
  "/assets/tunnel-browser.css",
]);

const STATIC_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function defaultBrowserUIDir(env = process.env): string | undefined {
  const configured = env.PIPIUI_BROWSER_UI_DIR?.trim();
  if (configured) return configured;
  const candidates = [
    fileURLToPath(new URL("../browser-ui/", import.meta.url)),
    fileURLToPath(new URL("../../Electron/packages/ui/dist/browser/", import.meta.url)),
  ];
  return candidates.find((dir) => existsSync(join(dir, "index.html")));
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(value));
}

function rejectUpgrade(
  socket: import("node:stream").Duplex,
  status = "400 Bad Request",
): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function clientAddress(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? "unknown";
}

async function readJSON(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new RangeError("body too large");
    chunks.push(chunk);
  }
  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendControl(peer: Peer, frame: Record<string, unknown>): void {
  if (peer.socket.readyState === WebSocket.OPEN) {
    peer.socket.send(JSON.stringify(frame));
  }
}

function sendRaw(peer: Peer, raw: string): boolean {
  if (peer.socket.readyState !== WebSocket.OPEN) return false;
  peer.socket.send(raw);
  return true;
}

function closePeer(peer: Peer, code = 1008, reason = "link unavailable"): void {
  if (peer.helloTimer) clearTimeout(peer.helloTimer);
  if (
    peer.socket.readyState === WebSocket.OPEN
    || peer.socket.readyState === WebSocket.CONNECTING
  ) {
    peer.socket.close(code, reason);
  }
}

function contentTypeFor(name: string): string {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  return STATIC_TYPES[lower.slice(dot)] ?? "application/octet-stream";
}

function safeStaticPath(root: string, pathname: string): string | null {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const segments = decoded.split("/").filter(Boolean);
  if (segments.some((segment) => segment === ".." || segment.startsWith("."))) {
    return null;
  }
  const full = resolve(join(root, ...segments));
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

export function createHostAPIRelay(options: HostAPIRelayOptions) {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? DEFAULT_ROOM_TTL_MS;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new Error("Host API v2 TTL must be a positive integer");
  }
  const limits: HostAPIV2Limits = { ...DEFAULT_V2_LIMITS, ...options.limits };
  if (Object.values(limits).some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error("invalid Host API v2 limits");
  }
  const secureCookies = options.secureCookies
    ?? options.publicOrigin.startsWith("https:");
  const uiRoot = options.browserUIDir ? resolve(options.browserUIDir) : undefined;
  const rooms = new Map<string, Room>();
  const invalidated = new Map<string, NodeJS.Timeout>();
  const grants = new Map<string, Room>();
  const peers = new Set<Peer>();
  const claimLimiter = new FixedWindowRateLimiter(
    limits.claimWindowMs,
    limits.maxClaimAttemptsPerIP,
    limits.maxClients * 4,
    now,
  );
  const frameLimiter = new FixedWindowRateLimiter(
    limits.frameWindowMs,
    limits.maxFramesPerWindow,
    limits.maxClients * 4,
    now,
  );

  const hostWSS = new WebSocketServer({
    noServer: true,
    maxPayload: limits.maxResponseBytes,
  });
  const browserWSS = new WebSocketServer({
    noServer: true,
    maxPayload: limits.maxRequestBytes,
  });

  const knowsRoom = (roomID: string): boolean =>
    rooms.has(roomID) || invalidated.has(roomID);

  const forgetGrant = (room: Room): void => {
    if (!room.grantHash) return;
    const key = room.grantHash.toString("hex");
    if (grants.get(key) === room) grants.delete(key);
    room.grantHash = undefined;
  };

  const expireRoom = (
    room: Room,
    reason: "end" | "expired" | "server_stopped",
    retainTombstone = true,
  ): void => {
    if (rooms.get(room.roomID) !== room) return;
    rooms.delete(room.roomID);
    clearTimeout(room.expiryTimer);
    room.inflight.clear();
    forgetGrant(room);
    if (retainTombstone) {
      const existing = invalidated.get(room.roomID);
      if (existing) clearTimeout(existing);
      const remaining = Math.max(1, room.expiresAt - now());
      const timer = setTimeout(() => invalidated.delete(room.roomID), remaining);
      timer.unref();
      invalidated.set(room.roomID, timer);
    }
    const frame = reason === "end"
      ? { v: 2, type: "end" }
      : reason === "expired"
        ? { v: 2, type: "expired" }
        : { v: 2, type: "replaced" };
    if (room.host) {
      sendControl(room.host, frame);
      closePeer(room.host, 1000, reason === "end" ? "host ended" : "link expired");
    }
    if (room.browser) {
      sendControl(room.browser, frame);
      closePeer(room.browser, 1000, reason === "end" ? "host ended" : "link expired");
    }
  };

  const liveRoom = (roomID: string | null): Room | undefined => {
    if (!roomID) return undefined;
    const room = rooms.get(roomID);
    if (!room) return undefined;
    if (now() >= room.expiresAt) {
      expireRoom(room, "expired");
      return undefined;
    }
    return room;
  };

  const authorize = (cookieHeader: string | undefined): Room | undefined => {
    const token = cookieValue(cookieHeader, PAIR_COOKIE);
    if (!token || !GRANT_TOKEN_RE.test(token)) return undefined;
    const digest = sha256utf8(token);
    const room = grants.get(digest.toString("hex"));
    if (!room || !room.grantHash || !exactBuffer(digest, room.grantHash)) {
      return undefined;
    }
    return liveRoom(room.roomID);
  };

  const replaceBrowser = (room: Room, reason = "replaced"): void => {
    const previous = room.browser;
    room.browser = null;
    room.inflight.clear();
    room.browserGeneration += 1;
    if (previous) {
      sendControl(previous, { v: 2, type: "replaced" });
      closePeer(previous, 4001, reason);
    }
  };

  const attachHost = (peer: Peer, hello: {
    roomID: string;
    hostToken: string;
    pairSecretHash: string;
  }): void => {
    if (invalidated.has(hello.roomID)) {
      closePeer(peer);
      return;
    }
    const tokenHash = sha256utf8(hello.hostToken);
    const pairHash = Buffer.from(hello.pairSecretHash, "hex");
    const existing = rooms.get(hello.roomID);
    if (existing) {
      if (now() >= existing.expiresAt) {
        expireRoom(existing, "expired");
        closePeer(peer);
        return;
      }
      if (
        !exactBuffer(tokenHash, existing.hostTokenHash)
        || !exactBuffer(pairHash, existing.pairSecretHash)
      ) {
        closePeer(peer);
        return;
      }
      const previous = existing.host;
      existing.hostEpoch += 1;
      existing.inflight.clear();
      existing.host = peer;
      peer.roomID = existing.roomID;
      peer.hostEpoch = existing.hostEpoch;
      if (previous && previous !== peer) {
        sendControl(previous, { v: 2, type: "replaced", hostEpoch: existing.hostEpoch });
        closePeer(previous, 4001, "replaced");
      }
      sendControl(peer, {
        v: 2,
        type: "ready",
        hostEpoch: existing.hostEpoch,
        expiresAt: existing.expiresAt,
        browserAttached: Boolean(existing.browser),
      });
      if (existing.browser) {
        sendControl(peer, {
          v: 2,
          type: "paired",
          hostEpoch: existing.hostEpoch,
          generation: existing.browserGeneration,
        });
      }
      return;
    }
    if (rooms.size >= limits.maxRooms) {
      closePeer(peer, 1013, "server busy");
      return;
    }
    const room: Room = {
      roomID: hello.roomID,
      pairSecretHash: pairHash,
      hostTokenHash: tokenHash,
      host: peer,
      browser: null,
      hostEpoch: 1,
      browserGeneration: 0,
      expiresAt: now() + ttlMs,
      expiryTimer: setTimeout(() => {}, ttlMs),
      inflight: new Set(),
    };
    clearTimeout(room.expiryTimer);
    room.expiryTimer = setTimeout(() => expireRoom(room, "expired"), ttlMs);
    room.expiryTimer.unref();
    rooms.set(room.roomID, room);
    peer.roomID = room.roomID;
    peer.hostEpoch = room.hostEpoch;
    sendControl(peer, {
      v: 2,
      type: "ready",
      hostEpoch: room.hostEpoch,
      expiresAt: room.expiresAt,
      browserAttached: false,
    });
  };

  const attachBrowser = (peer: Peer, room: Room): void => {
    replaceBrowser(room);
    room.browser = peer;
    peer.roomID = room.roomID;
    peer.generation = room.browserGeneration;
    peer.hostEpoch = room.hostEpoch;
    if (room.host) {
      sendControl(room.host, {
        v: 2,
        type: "paired",
        hostEpoch: room.hostEpoch,
        generation: room.browserGeneration,
      });
    }
  };

  const overQueued = (peer: Peer, bytes: number): boolean =>
    peer.socket.bufferedAmount + bytes > limits.maxQueuedBytes;

  const forwardData = (
    peer: Peer,
    raw: string,
    frame: Exclude<ClassifiedFrame, { kind: "control" } | { kind: "invalid" }>,
  ): void => {
    const room = liveRoom(peer.roomID);
    if (!room) {
      closePeer(peer, 1000, "link expired");
      return;
    }
    if (peer.role === "browser") {
      if (room.browser !== peer) return;
      if (frame.kind !== "request") {
        closePeer(peer, 1008, "wrong direction");
        return;
      }
      if (
        (frame.generation !== undefined && frame.generation !== room.browserGeneration)
        || (frame.hostEpoch !== undefined && frame.hostEpoch !== room.hostEpoch)
      ) {
        return;
      }
      if (!room.host || room.host.socket.readyState !== WebSocket.OPEN) {
        sendControl(peer, { v: 2, type: "error", reason: "host_offline" });
        return;
      }
      if (room.inflight.size >= limits.maxInflight || room.inflight.has(frame.id)) {
        sendControl(peer, { v: 2, type: "error", reason: "limit_exceeded" });
        closePeer(peer, 1008, "limit exceeded");
        return;
      }
      if (overQueued(room.host, Buffer.byteLength(raw))) {
        sendControl(peer, { v: 2, type: "error", reason: "limit_exceeded" });
        closePeer(peer, 1008, "limit exceeded");
        return;
      }
      room.inflight.add(frame.id);
      sendRaw(room.host, raw);
      return;
    }
    if (room.host !== peer) return;
    if (
      frame.hostEpoch !== undefined && frame.hostEpoch !== room.hostEpoch
    ) {
      return;
    }
    if (frame.kind === "response") {
      if (!room.inflight.has(frame.id)) return;
      if (
        frame.generation !== undefined && frame.generation !== room.browserGeneration
      ) {
        room.inflight.delete(frame.id);
        return;
      }
      room.inflight.delete(frame.id);
    } else if (frame.kind !== "event") {
      closePeer(peer, 1008, "wrong direction");
      return;
    } else if (
      frame.generation !== undefined && frame.generation !== room.browserGeneration
    ) {
      return;
    }
    if (!room.browser || room.browser.socket.readyState !== WebSocket.OPEN) return;
    if (overQueued(room.browser, Buffer.byteLength(raw))) {
      closePeer(room.browser, 1008, "limit exceeded");
      return;
    }
    sendRaw(room.browser, raw);
  };

  const handleMessage = (peer: Peer, raw: Buffer | string, isBinary: boolean): void => {
    if (isBinary) {
      closePeer(peer, 1003, "text frames required");
      return;
    }
    const text = raw.toString();
    const bytes = Buffer.byteLength(text);
    const max = peer.role === "host" ? limits.maxResponseBytes : limits.maxRequestBytes;
    if (bytes > max) {
      closePeer(peer, 1009, "frame too large");
      return;
    }
    if (!frameLimiter.take(peer.roomID ?? clientKey(peer))) {
      sendControl(peer, { v: 2, type: "error", reason: "limit_exceeded" });
      closePeer(peer, 1008, "limit exceeded");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      closePeer(peer);
      return;
    }
    const frame = classifyFrame(parsed);
    if (!peer.roomID) {
      if (peer.role !== "host") {
        closePeer(peer);
        return;
      }
      const hello = parseHostHello(parsed);
      if (!hello) {
        closePeer(peer);
        return;
      }
      if (peer.helloTimer) clearTimeout(peer.helloTimer);
      attachHost(peer, hello);
      return;
    }
    if (frame.kind === "invalid") {
      closePeer(
        peer,
        frame.reason === "version" ? 1008 : 1008,
        frame.reason === "version" ? "unsupported version" : "invalid frame",
      );
      return;
    }
    if (frame.kind === "control") {
      if (peer.role === "host" && frame.type === "end") {
        const room = liveRoom(peer.roomID);
        if (room && room.host === peer) expireRoom(room, "end");
        else closePeer(peer);
        return;
      }
      if (frame.type === "ping") {
        const at = typeof frame.value.at === "number" ? frame.value.at : now();
        sendControl(peer, { v: 2, type: "pong", at });
        return;
      }
      closePeer(peer);
      return;
    }
    forwardData(peer, text, frame);
  };

  const clientKey = (peer: Peer): string =>
    `${peer.role}:${peer.socket.url || "local"}`;

  const track = (peer: Peer): void => {
    if (peers.size >= limits.maxClients) {
      if (peer.helloTimer) clearTimeout(peer.helloTimer);
      peer.socket.close(1013, "server busy");
      return;
    }
    peers.add(peer);
    peer.socket.on("message", (data, isBinary) => {
      handleMessage(peer, data as Buffer, isBinary);
    });
    peer.socket.on("pong", () => {
      peer.alive = true;
    });
    peer.socket.on("close", () => {
      peers.delete(peer);
      if (peer.helloTimer) clearTimeout(peer.helloTimer);
      const room = peer.roomID ? rooms.get(peer.roomID) : undefined;
      if (!room) return;
      if (room.browser === peer) {
        room.browser = null;
        room.inflight.clear();
      } else if (room.host === peer) {
        room.host = null;
      }
    });
    peer.socket.on("error", () => {
      closePeer(peer, 1011, "socket error");
    });
  };

  hostWSS.on("connection", (socket) => {
    const peer: Peer = {
      socket,
      role: "host",
      roomID: null,
      alive: true,
      helloTimer: setTimeout(
        () => socket.close(1008, "hello required"),
        limits.helloTimeoutMs,
      ),
    };
    peer.helloTimer?.unref();
    track(peer);
  });

  browserWSS.on("connection", (socket, req) => {
    const room = authorize(req.headers.cookie);
    if (!room) {
      socket.close(4001, "pairing required");
      return;
    }
    const peer: Peer = {
      socket,
      role: "browser",
      roomID: room.roomID,
      alive: true,
    };
    track(peer);
    if (!peers.has(peer)) return;
    attachBrowser(peer, room);
  });

  const heartbeat = setInterval(() => {
    for (const peer of peers) {
      if (!peer.alive) {
        peer.socket.terminate();
        continue;
      }
      peer.alive = false;
      try {
        peer.socket.ping();
      } catch {
        peer.socket.terminate();
      }
    }
  }, limits.heartbeatMs);
  heartbeat.unref();

  const servePairPage = (res: ServerResponse, roomID: string): void => {
    const nonce = randomBytes(18).toString("base64");
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    );
    res.end(pairPageHTML(roomID, nonce));
  };

  const serveFallback = (res: ServerResponse): void => {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(fallbackBrowserHTML());
  };

  const serveStatic = async (
    res: ServerResponse,
    pathname: string,
  ): Promise<void> => {
    if (!uiRoot || !existsSync(join(uiRoot, "index.html"))) {
      if (pathname === "/" || pathname === "/index.html") {
        serveFallback(res);
        return;
      }
      json(res, 404, { error: "not found" });
      return;
    }
    const requested = pathname === "/" ? "/index.html" : pathname;
    const filePath = safeStaticPath(uiRoot, requested);
    if (!filePath) {
      json(res, 404, { error: "not found" });
      return;
    }
    const sendFile = async (path: string): Promise<boolean> => {
      try {
        const info = await stat(path);
        if (!info.isFile()) return false;
        res.statusCode = 200;
        res.setHeader("Content-Type", contentTypeFor(path));
        res.setHeader("Content-Length", String(info.size));
        createReadStream(path).on("error", () => res.destroy()).pipe(res);
        return true;
      } catch {
        return false;
      }
    };
    if (await sendFile(filePath)) return;
    const last = requested.split("/").pop() ?? "";
    if (!last.includes(".")) {
      const index = join(uiRoot, "index.html");
      if (await sendFile(index)) return;
    }
    json(res, 404, { error: "not found" });
  };

  const handleClaim = async (
    req: IncomingMessage,
    res: ServerResponse,
    roomID: string,
  ): Promise<void> => {
    const address = clientAddress(req);
    if (!claimLimiter.take(address)) {
      json(res, 429, { error: "pairing rejected" });
      return;
    }
    const contentType = req.headers["content-type"]?.split(";")[0].trim();
    if (req.method !== "POST" || contentType !== "application/json") {
      json(res, 403, { error: "pairing rejected" });
      return;
    }
    let body: unknown;
    try {
      body = await readJSON(req, CLAIM_BODY_MAX_BYTES);
    } catch {
      json(res, 403, { error: "pairing rejected" });
      return;
    }
    const secret = parseClaimBody(body);
    const room = liveRoom(roomID);
    if (!secret || !room) {
      json(res, 403, { error: "pairing rejected" });
      return;
    }
    const actual = sha256utf8(secret);
    if (!exactBuffer(actual, room.pairSecretHash)) {
      json(res, 403, { error: "pairing rejected" });
      return;
    }
    forgetGrant(room);
    replaceBrowser(room);
    const token = newGrantToken();
    room.grantHash = sha256utf8(token);
    grants.set(room.grantHash.toString("hex"), room);
    const maxAge = Math.max(1, Math.floor((room.expiresAt - now()) / 1_000));
    res.setHeader("Set-Cookie", pairCookie(token, maxAge, secureCookies));
    res.statusCode = 204;
    res.end();
  };

  const reservedPublicPath = (pathname: string): boolean =>
    pathname === "/healthz"
    || pathname.startsWith("/downloads/")
    || TUNNEL_ASSET_PATHS.has(pathname)
    || pathname === "/tunnel/ws"
    || pathname === HOST_WS_PATH;

  return {
    knowsRoom,
    getRoomCount: () => rooms.size,
    getClientCount: () => peers.size,
    handleRequest(
      req: IncomingMessage,
      res: ServerResponse,
      url: URL,
    ): boolean {
      const claim = PAIR_CLAIM_PATH_RE.exec(url.pathname);
      if (claim) {
        void handleClaim(req, res, claim[1].toLowerCase());
        return true;
      }
      const pair = req.method === "GET" ? PAIR_PATH_RE.exec(url.pathname) : null;
      if (pair && knowsRoom(pair[1].toLowerCase())) {
        servePairPage(res, pair[1].toLowerCase());
        return true;
      }
      if (reservedPublicPath(url.pathname)) return false;
      const room = authorize(req.headers.cookie);
      if (!room) return false;
      if (req.method !== "GET" && req.method !== "HEAD") return false;
      void serveStatic(res, url.pathname);
      return true;
    },
    handleUpgrade(
      req: IncomingMessage,
      socket: import("node:stream").Duplex,
      head: Buffer,
    ): boolean {
      let url: URL;
      try {
        url = new URL(req.url ?? "/", options.publicOrigin);
      } catch {
        rejectUpgrade(socket, "400 Bad Request");
        return true;
      }
      if (url.search || url.hash) return false;
      if (url.pathname === HOST_WS_PATH) {
        try {
          hostWSS.handleUpgrade(req, socket, head, (ws) => {
            hostWSS.emit("connection", ws, req);
          });
        } catch {
          rejectUpgrade(socket);
        }
        return true;
      }
      if (url.pathname === BROWSER_WS_PATH) {
        if (!authorize(req.headers.cookie)) {
          rejectUpgrade(socket, "401 Unauthorized");
          return true;
        }
        try {
          browserWSS.handleUpgrade(req, socket, head, (ws) => {
            browserWSS.emit("connection", ws, req);
          });
        } catch {
          rejectUpgrade(socket);
        }
        return true;
      }
      return false;
    },
    async close(): Promise<void> {
      clearInterval(heartbeat);
      for (const room of [...rooms.values()]) {
        expireRoom(room, "server_stopped", false);
      }
      for (const timer of invalidated.values()) clearTimeout(timer);
      invalidated.clear();
      grants.clear();
      for (const peer of peers) {
        if (peer.helloTimer) clearTimeout(peer.helloTimer);
        peer.socket.terminate();
      }
      peers.clear();
      await Promise.all([closeWSS(hostWSS), closeWSS(browserWSS)]);
    },
  };
}

function closeWSS(wss: WebSocketServer): Promise<void> {
  return new Promise((resolve) => {
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
}
