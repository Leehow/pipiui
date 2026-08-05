import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";

const PAIR_PATH = /^\/pair\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const ROOM_ID = PAIR_PATH;
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
  return {
    host,
    port,
    publicOrigin: publicOrigin.origin,
    tunnelURL: tunnelURL.href,
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
<style nonce="${nonce}">
:root{color-scheme:dark;--bg:#0b0f14;--surface:#131a22;--surface-2:#1a2430;--border:#26313d;--text:#e6edf3;--muted:#8b98a5;--accent:#2f81f7;--accent-soft:rgba(47,129,247,.16);--accent-text:#79b8ff;--ok:#3dd68c;--warn:#ffb020;font:15px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif}*{box-sizing:border-box}html,body{height:100%}body{height:100vh;height:100dvh;margin:0;overflow:hidden;display:flex;flex-direction:column;background:var(--bg);color:var(--text)}h1,h2{margin:0}button,textarea{font:inherit}button{border:1px solid var(--border);border-radius:10px;background:var(--surface-2);color:var(--text);padding:7px 14px;cursor:pointer}button:hover:not(:disabled){background:#22303e;border-color:#354554}button:disabled{opacity:.45;cursor:default}button.primary{background:var(--accent);border-color:transparent;color:#fff;font-weight:600}header{flex:none;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 20px;border-bottom:1px solid var(--border);background:rgba(11,15,20,.92);backdrop-filter:blur(12px)}header h1{font-size:16px;font-weight:650}.conn-pill{display:inline-flex;align-items:center;gap:7px;padding:5px 12px;border-radius:999px;font-size:12.5px;white-space:nowrap;background:var(--surface);border:1px solid var(--border);color:var(--muted)}.conn-dot{width:8px;height:8px;border-radius:50%;background:var(--warn);flex:none}.conn-pill.connected{color:var(--ok)}.conn-pill.connected .conn-dot{background:var(--ok)}main{flex:1;min-height:0;display:grid;grid-template-columns:minmax(260px,32%) 1fr}aside{min-height:0;overflow-y:auto;padding:16px;border-right:1px solid var(--border)}aside h2{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin:0 0 10px}.list{display:grid;gap:8px;margin-bottom:24px;align-content:start}.row.card{display:flex;gap:10px;align-items:center;justify-content:space-between;min-height:44px;padding:8px 10px;border:1px solid var(--border);border-radius:12px;background:var(--surface);cursor:pointer;user-select:none}.row.card button:not(.row-main){flex:none}.row.card:hover{background:var(--surface-2);border-color:#354554}.row.card.selected{border-color:var(--accent);background:var(--accent-soft)}.row-main{flex:1;min-width:0;display:flex;align-items:center;min-height:36px;padding:2px 6px;border:0;background:none;color:inherit;text-align:left;cursor:pointer;border-radius:8px}.row-main:hover{background:rgba(255,255,255,.05)}.row-main:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}.row-title{display:flex;align-items:center;gap:8px;min-width:0}.row-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.list-empty{grid-column:1/-1;padding:14px;text-align:center;color:var(--muted);font-size:13px;border:1px dashed var(--border);border-radius:12px}.badge{flex:none;font-size:11px;line-height:1;padding:4px 8px;border-radius:999px;background:var(--accent-soft);color:var(--accent-text)}#session-pane{display:flex;flex-direction:column;min-width:0;min-height:0}.session-head{display:flex;align-items:center;gap:10px;padding:14px 20px 6px}.panel-tabs{display:flex;gap:6px;margin-left:auto}.panel-tabs button{padding:5px 8px;font-size:12px}.panel-tabs button.active{background:var(--accent-soft);border-color:var(--accent);color:var(--accent-text)}.remote-panel{position:absolute;z-index:10;top:0;right:0;width:min(380px,48vw);height:100%;overflow:auto;padding:14px;background:var(--surface);border-left:1px solid var(--border);box-shadow:-12px 0 28px rgba(0,0,0,.22)}.remote-panel h3{margin:0 0 10px;font-size:14px}.panel-item{display:block;width:100%;margin:0 0 8px;text-align:left}.panel-detail,.document-content{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}.web-frame{width:100%;height:calc(100% - 50px);border:1px solid var(--border);border-radius:8px;background:#fff}.session-head h2{font-size:15px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#back-to-list{display:none;flex:none;padding:6px 10px}.model-bar{padding:0 20px 10px}.model-panel{display:grid;gap:9px;margin-top:8px;padding:10px;border:1px solid var(--border);border-radius:10px;background:var(--surface)}.model-row{display:grid;grid-template-columns:minmax(90px,auto) minmax(0,1fr);gap:10px;align-items:center}.model-row label{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.model-row select{min-width:0;width:100%;background:var(--surface-2);color:var(--text);border:1px solid var(--border);border-radius:7px;padding:6px}#transcript{flex:1;min-height:0;overflow-y:auto;padding:10px 20px 18px;display:flex;flex-direction:column;gap:10px}.message{max-width:78%;padding:10px 14px;border-radius:16px;white-space:pre-wrap;overflow-wrap:anywhere}.message.user{align-self:flex-end;background:var(--accent);color:#fff;border-bottom-right-radius:6px}.message.assistant{align-self:flex-start;background:var(--surface-2);border:1px solid var(--border);border-bottom-left-radius:6px}.message.system{align-self:center;max-width:92%;background:transparent;border:1px dashed var(--border);color:var(--muted);font-size:13px}.role{display:block;color:var(--muted);font-size:11.5px;margin-bottom:4px}.message.user .role{color:rgba(255,255,255,.75)}.tool-entry{align-self:flex-start;max-width:88%;padding:6px 12px;border-radius:10px;background:var(--surface);border:1px solid var(--border);font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}.composer{flex:none;display:grid;gap:8px;padding:12px 20px calc(12px + env(safe-area-inset-bottom,0px));background:var(--bg);border-top:1px solid var(--border)}textarea{width:100%;min-height:62px;max-height:180px;resize:vertical;border:1px solid var(--border);border-radius:12px;padding:10px 12px;background:var(--surface);color:inherit}textarea:focus{outline:none;border-color:var(--accent)}.actions{display:flex;gap:8px;align-items:center}#status{color:var(--muted);margin-left:auto;font-size:12px;text-align:right}.hidden-select{display:none}@media(max-width:760px){main{display:block}aside{border-right:0;height:100%}main[data-mobile-view="list"] #session-pane{display:none}main[data-mobile-view="detail"] #list-pane{display:none}main[data-mobile-view="detail"] #session-pane{display:flex;height:100%}main[data-mobile-view="detail"] #back-to-list{display:inline-flex}.message{max-width:88%}.model-row{grid-template-columns:1fr}.remote-panel{width:100%;top:0;border-left:0}.panel-tabs button{padding:5px 6px}textarea{min-height:72px}}
</style>
</head><body><header><h1>PipiUI 远程会话</h1><div id="conn-pill" class="conn-pill" role="status"><span class="conn-dot"></span><span id="transport">服务器隧道尚未连接</span></div></header>
<main id="remote-main" data-mobile-view="list"><aside id="list-pane" aria-label="项目与会话列表"><h2>项目</h2><div id="project-list" class="list"></div><select id="projects" class="hidden-select"></select><h2>会话</h2><div id="session-list" class="list"></div><select id="sessions" class="hidden-select"></select></aside><section id="session-pane" aria-label="会话详情"><div class="session-head"><button id="back-to-list" type="button">← 返回</button><h2 id="session-title">请选择会话</h2><div class="panel-tabs"><button id="agents-toggle" type="button" disabled>Subagents</button><button id="web-toggle" type="button" disabled>Web</button><button id="documents-toggle" type="button" disabled>文档</button></div></div><div id="remote-panel" class="remote-panel" hidden></div><div class="model-bar"><button id="models-toggle" type="button" disabled>模型</button><div id="models-panel" class="model-panel" hidden></div></div><div id="transcript" aria-live="polite"></div><div class="composer"><textarea id="prompt" placeholder="输入消息"></textarea><div class="actions"><button id="send" class="primary" disabled>发送</button><button id="stop" disabled>停止</button><button id="revoke">断开</button><span id="status">正在通过链接连接 Mac…</span></div></div></section></main><script nonce="${nonce}">
(() => {
  const secret = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  window.__PIPI_TUNNEL_BOOT__ = Object.freeze({...${boot}, secret});
  if (!/^[0-9a-f]{64}$/.test(secret)) {
    document.getElementById("status").textContent = "链接无效或密钥缺失；请从 Mac 重新复制完整链接。";
    document.getElementById("status").className = "error";
    return;
  }
  import("/assets/tunnel-browser.js").catch(error => {
    document.getElementById("status").textContent = String(error?.message || error);
    document.getElementById("status").className = "error";
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
  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const url = new URL(req.url ?? "/", options.publicOrigin);
    if (req.method === "GET" && url.pathname === "/healthz") {
      return json(res, 200, { ok: true });
    }
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
    const pair = req.method === "GET" ? PAIR_PATH.exec(url.pathname) : null;
    if (pair) {
      const nonce = randomBytes(18).toString("base64");
      const connectOrigin = new URL(options.tunnelURL).origin;
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader(
        "Content-Security-Policy",
        `default-src 'none'; script-src 'nonce-${nonce}' 'self'; style-src 'nonce-${nonce}'; connect-src ${connectOrigin}; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
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
    if (url.pathname !== TUNNEL_PATH || url.search || url.hash) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (webSocket) => {
      wss.emit("connection", webSocket, request);
    });
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
    close: async () => {
      clearInterval(heartbeat);
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
