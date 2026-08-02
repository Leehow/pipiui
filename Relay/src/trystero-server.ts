import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { createWsRelayServer } from "@trystero-p2p/ws-relay/server";

const PAIR_PATH = /^\/pair\/([0-9a-f-]{36})$/i;
const SIGNAL_PATH = "/trystero/ws";

export interface TrysteroRelayOptions {
  host: "127.0.0.1" | "::1";
  port: number;
  publicOrigin: string;
  signalURL: string;
}

export function trysteroOptionsFromEnvironment(
  env = process.env,
): TrysteroRelayOptions {
  const host = env.PIPIUI_RELAY_HOST ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "::1") {
    throw new Error("PIPIUI_RELAY_HOST must be loopback");
  }
  const publicOrigin = new URL(
    env.PIPIUI_PUBLIC_ORIGIN ?? "https://pipi.aichattrpg.com",
  );
  const signalURL = new URL(
    env.PIPIUI_SIGNAL_URL ?? "wss://signal.aichattrpg.com/trystero/ws",
  );
  if (publicOrigin.protocol !== "https:" || publicOrigin.pathname !== "/"
    || publicOrigin.search || publicOrigin.hash) {
    throw new Error("PIPIUI_PUBLIC_ORIGIN must be an HTTPS origin");
  }
  if (signalURL.protocol !== "wss:" || signalURL.pathname !== SIGNAL_PATH
    || signalURL.search || signalURL.hash) {
    throw new Error("PIPIUI_SIGNAL_URL must be a wss /trystero/ws URL");
  }
  const port = Number(env.PIPIUI_RELAY_PORT ?? "8787");
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("PIPIUI_RELAY_PORT must be a valid port");
  }
  return {
    host,
    port,
    publicOrigin: publicOrigin.origin,
    signalURL: signalURL.href,
  };
}

function browserAsset(): string {
  const candidates = [
    new URL("../dist/assets/trystero-browser.js", import.meta.url),
    new URL("./assets/trystero-browser.js", import.meta.url),
  ];
  const selected = candidates.find((candidate) => existsSync(candidate));
  if (!selected) throw new Error("Trystero browser bundle missing; run npm run bundle");
  return readFileSync(selected, "utf8");
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(value));
}

function pairPage(
  roomID: string,
  signalURL: string,
  nonce: string,
): string {
  const boot = JSON.stringify({ roomID, signalURL }).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta name="referrer" content="no-referrer"><title>PipiUI Remote</title>
<style nonce="${nonce}">body{font:15px system-ui;margin:0;background:#f5f5f7;color:#1d1d1f}main{max-width:900px;margin:32px auto;padding:20px}section{background:white;border-radius:14px;padding:16px;margin:12px 0}button,select,textarea{font:inherit;padding:8px;margin:3px}textarea{width:100%;box-sizing:border-box}.msg{white-space:pre-wrap;border-top:1px solid #eee;padding:10px 0}.muted{color:#666}.transport{font-weight:600}.error{color:#b42318}</style>
</head><body><main><h1>PipiUI Remote</h1><p id="status" class="muted">正在通过一次性链接连接 Mac…</p>
<p id="transport" class="transport">Trystero DataChannel 尚未连接</p>
<section><button id="refresh">刷新</button> <select id="projects"></select> <button id="create">新建会话</button><br><select id="sessions"></select> <button id="open">打开</button> <button id="revoke">断开并作废此链接</button></section>
<section id="transcript"></section>
<section><textarea id="prompt" rows="4" placeholder="输入消息"></textarea><button id="send">发送</button> <button id="stop">Stop</button></section>
</main><script nonce="${nonce}">
(() => {
  const secret = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  history.replaceState(null, "", location.pathname + location.search);
  window.__PIPI_TRYSTERO_BOOT__ = Object.freeze({...${boot}, password: secret});
  if (!/^[0-9a-f]{64}$/.test(secret)) {
    document.getElementById("status").textContent = "一次性链接无效或密钥已经被清除";
    document.getElementById("status").className = "error";
    return;
  }
  import("/assets/trystero-browser.js").catch(error => {
    document.getElementById("status").textContent = String(error?.message || error);
    document.getElementById("status").className = "error";
  });
})();
</script></body></html>`;
}

export function createTrysteroRelayServer(options: TrysteroRelayOptions) {
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
      return res.end("<!doctype html><meta charset=utf-8><title>PipiUI Remote</title><p>请在 Mac 上生成一个新的一次性远程链接。</p>");
    }
    if (req.method === "GET" && url.pathname === "/assets/trystero-browser.js") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/javascript; charset=utf-8");
      return res.end(browserAsset());
    }
    const pair = req.method === "GET" ? PAIR_PATH.exec(url.pathname) : null;
    if (pair) {
      const nonce = randomBytes(18).toString("base64");
      const connectOrigin = new URL(options.signalURL).origin;
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader(
        "Content-Security-Policy",
        `default-src 'none'; script-src 'nonce-${nonce}' 'self'; style-src 'nonce-${nonce}'; connect-src ${connectOrigin}; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
      );
      return res.end(pairPage(
        pair[1].toLowerCase(),
        options.signalURL,
        nonce,
      ));
    }
    return json(res, 404, { error: "not found" });
  });
  // 0.25.3's server wrapper installs its own WebSocketServer. Supplying the
  // existing HTTP server plus ws' exact `path` gate keeps every other upgrade
  // outside the signaling surface.
  const relay = createWsRelayServer({ server, path: SIGNAL_PATH });
  return { server, relay, options };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = trysteroOptionsFromEnvironment();
  const { server } = createTrysteroRelayServer(options);
  server.listen(options.port, options.host, () => {
    process.stdout.write(`PipiUI Trystero relay listening on loopback port ${options.port}\n`);
  });
}
