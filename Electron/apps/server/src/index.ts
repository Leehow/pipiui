import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer, type ServerOptions as HttpsServerOptions } from "node:https";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type RequestHandler } from "express";
import WebSocket, { WebSocketServer, type RawData } from "ws";

import { createPiHostBackend, type PiBackendOptions } from "@pipi/pi-backend";
import {
  PIPI_HOST_PROTOCOL_VERSION,
  type HostBackend,
  type HostEvent,
  type HostMethod,
  type HostRequest,
  type HostResponse,
  type HostWireFrame,
  type TerminalEvent,
  type Unsubscribe,
} from "@pipi/host-api";
import {
  RELAY_PAIR_ID,
  RELAY_PAIR_SECRET,
  RelayCompatiblePairing,
  type PairingIdentity,
  type PairingLink,
} from "./relay-pairing.js";

export { PIPI_HOST_PROTOCOL_VERSION } from "@pipi/host-api";
export {
  DEFAULT_PAIRING_TTL_MS,
  PAIRING_COOKIE,
  RELAY_PAIR_ID,
  RELAY_PAIR_SECRET,
  RelayCompatiblePairing,
} from "./relay-pairing.js";

const MAX_WIRE_PAYLOAD_BYTES = 8 * 1024 * 1024;
const HOST_METHODS = new Set<HostMethod>([
  "listProjects", "getProjectPaths", "setProjectPaths", "addProject", "removeProject", "renameProject", "listSessions", "listDocuments", "readDocument",
  "newSession", "resumeSession", "renameSession", "deleteSession", "moveSession", "getSessionHistory",
  "getSessionLease", "forceTakeoverSessionLease", "sendPrompt", "listQueue",
  "enqueueMessage", "updateQueuedMessage", "removeQueuedMessage", "promoteQueuedMessage",
  "steerQueuedMessage", "retryQueuedMessage", "stop", "queueFollowUp", "compact", "listModels", "getModelState", "setModel",
  "setThinkingLevel", "getHiddenModelIds", "setHiddenModelIds", "getSidebarSessionPreferences", "setSidebarSessionPreferences", "authProviders", "beginProviderLogin", "continueProviderLogin", "cancelProviderLogin", "removeProviderCredentials", "getSessionStats", "getQuotaSnapshot", "listAgents", "abortAgent", "resolveAgent",
  "checkAgent", "getWorktreeStatus", "mergeWorktree", "discardWorktree",
  "getVisionModel", "setVisionModel", "getMemoryReviewModel", "setMemoryReviewModel",
  "capabilities", "gitStatus", "gitCheckout", "probeDirectoryGit", "gitInitDirectory", "probeGitBinary", "revealProject", "terminalOpen", "terminalWrite",
  "terminalClear", "terminalClose", "browserListTabs", "browserGetActiveTab",
  "browserNewTab", "browserSwitchTab", "browserCloseTab", "browserLoadURL",
  "browserGoBack", "browserGoForward", "browserReload", "browserSnapshot",
  "browserSetViewBounds",
]);
const TERMINAL_METHODS = new Set<HostMethod>([
  "terminalOpen", "terminalWrite", "terminalClear", "terminalClose",
]);
const BROWSER_METHODS = new Set<HostMethod>([
  "browserListTabs", "browserGetActiveTab", "browserNewTab", "browserSwitchTab",
  "browserCloseTab", "browserLoadURL", "browserGoBack", "browserGoForward",
  "browserReload", "browserSnapshot", "browserSetViewBounds",
]);

type ManagedHostBackend = HostBackend & { close?: () => Promise<void> | void };
type BrowserProvider = "disabled" | "playwright" | "steel";
type TerminalMode = "disabled" | "mock";
type NetworkServer = HttpServer | HttpsServer;

export type ServerCapabilities = {
  computerUse: false;
  revealInFinder: false;
  terminal: boolean;
  browser: boolean;
  plan: false;
  retainedWorktreeDisposition: false;
  /** The work tree lives on the server, so the pi backend answers git probes for remote clients too. */
  git: boolean;
  [capability: string]: boolean;
};

export type WsHostServerOptions = {
  /** Test/embedding override. Normal server connections use `createPiHostBackend`. */
  backend?: HostBackend;
  /** Preferred production path: one backend (and event stream) per WSS client. */
  createBackend?: () => HostBackend;
  backendOptions?: PiBackendOptions;
  /** A supplied adapter must implement browser Host API methods before browser is advertised. */
  browserBackend?: (backend: HostBackend) => HostBackend;
  browserProvider?: BrowserProvider;
  terminalMode?: TerminalMode;
  staticDir?: string;
  host?: string;
  port?: number;
  publicOrigin?: string;
  pairing?: false | { ttlMs?: number };
  secureCookies?: boolean;
  tls?: HttpsServerOptions;
};

export type WsHostServer = {
  server: NetworkServer;
  listen(port?: number, host?: string): Promise<number>;
  close(): Promise<void>;
  /** Generated only after an origin is known; its secret intentionally stays in the URL fragment. */
  readonly pairingLink?: string;
  createPairingLink(): string | undefined;
};

type Connection = {
  backend: ManagedHostBackend;
  unsubscribe: Unsubscribe;
  pairing?: PairingIdentity;
  cookieHeader?: string;
  expiryTimer?: NodeJS.Timeout;
  closed: boolean;
  /** Resolves when the backend drain finished; close() awaits these so no
   * backend write outlives the server and races a caller's temp-dir cleanup. */
  closing?: Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(raw: RawData): string {
  if (typeof raw === "string") return raw;
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  return Buffer.from(raw).toString("utf8");
}

function requestFromWire(raw: RawData, isBinary: boolean): HostRequest | undefined {
  if (isBinary) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(asText(raw));
  } catch {
    return undefined;
  }
  if (!isRecord(value)
    || value.protocolVersion !== PIPI_HOST_PROTOCOL_VERSION
    || value.type !== "request"
    || typeof value.id !== "string"
    || value.id.length === 0
    || value.id.length > 256
    || typeof value.method !== "string"
    || !HOST_METHODS.has(value.method as HostMethod)
    || !Array.isArray(value.params)) return undefined;
  return value as unknown as HostRequest;
}

function responseError(id: string, error: string): HostResponse {
  return { protocolVersion: PIPI_HOST_PROTOCOL_VERSION, id, type: "response", ok: false, error };
}

function responseSuccess(id: string, result: unknown): HostResponse {
  return { protocolVersion: PIPI_HOST_PROTOCOL_VERSION, id, type: "response", ok: true, result };
}

function safeSend(socket: WebSocket, frame: HostWireFrame): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify(frame));
  } catch {
    // A close race is normal; the close handler tears down the backend subscription.
  }
}

function copyDisposer(source: ManagedHostBackend, target: HostBackend): ManagedHostBackend {
  const close = source.close?.bind(source);
  return close ? Object.assign(target, { close }) : target;
}

/** Optional mock only: it never executes a command on the server. */
function withMockTerminal(backend: ManagedHostBackend): ManagedHostBackend {
  const listeners = new Set<(event: HostEvent) => void>();
  const terminals = new Map<string, { cwd: string; input: string }>();
  const emit = (terminalId: string, data: string) => {
    const frame: HostEvent = {
      protocolVersion: PIPI_HOST_PROTOCOL_VERSION,
      channel: "terminal",
      event: { type: "output", terminalId, data },
    };
    listeners.forEach(listener => listener(frame));
  };
  const terminal = (terminalId: string) => {
    const current = terminals.get(terminalId);
    if (!current) throw new Error(`unknown terminal: ${terminalId}`);
    return current;
  };

  return copyDisposer(backend, {
    async handle(method: HostMethod, params: unknown[]): Promise<unknown> {
      switch (method) {
        case "terminalOpen": {
          const options = (params[0] ?? {}) as { cwd?: string };
          const id = `terminal-${randomBytes(12).toString("base64url")}`;
          const cwd = options.cwd ?? process.cwd();
          terminals.set(id, { cwd, input: "" });
          return {
            id,
            title: "终端",
            cwd,
            initialOutput: `\u001b[1;36mpipiui_e mock terminal (server)\u001b[0m\r\n${cwd}\r\n$ `,
          };
        }
        case "terminalWrite": {
          const [terminalId, raw] = params as [string, string];
          if (typeof raw !== "string") throw new Error("terminal input must be text");
          const current = terminal(terminalId);
          for (const character of raw.replace(/\r\n/g, "\r")) {
            if (character === "\r" || character === "\n") {
              const command = current.input.trim();
              current.input = "";
              emit(terminalId, "\r\n");
              if (command) emit(terminalId, `mock: received ${command}\r\n`);
              emit(terminalId, "$ ");
            } else if (character === "\u0003") {
              current.input = "";
              emit(terminalId, "^C\r\n$ ");
            } else if (character === "\u007f") {
              if (current.input) {
                current.input = current.input.slice(0, -1);
                emit(terminalId, "\b \b");
              }
            } else {
              current.input += character;
              emit(terminalId, character);
            }
          }
          return;
        }
        case "terminalClear":
          terminal(params[0] as string).input = "";
          return;
        case "terminalClose":
          terminals.delete(params[0] as string);
          return;
        default:
          return backend.handle(method, params);
      }
    },
    subscribe(listener: (event: HostEvent) => void): Unsubscribe {
      listeners.add(listener);
      const unsubscribe = backend.subscribe(listener);
      return () => {
        listeners.delete(listener);
        unsubscribe();
      };
    },
  });
}

function withServerCapabilities(
  backend: ManagedHostBackend,
  capabilities: ServerCapabilities,
): ManagedHostBackend {
  return copyDisposer(backend, {
    async handle(method: HostMethod, params: unknown[]): Promise<unknown> {
      if (TERMINAL_METHODS.has(method) && !capabilities.terminal) {
        throw new Error("terminal is unavailable in the server host");
      }
      if (BROWSER_METHODS.has(method) && !capabilities.browser) {
        throw new Error("browser is unavailable in the server host");
      }
      if (method === "revealProject" && !capabilities.revealInFinder) {
        throw new Error("Finder reveal is unavailable in the server host");
      }
      if (method === "capabilities") return capabilities;
      return backend.handle(method, params);
    },
    subscribe(listener: (event: HostEvent) => void): Unsubscribe {
      return backend.subscribe(listener);
    },
  });
}

function decorateBackend(base: HostBackend, options: WsHostServerOptions): ManagedHostBackend {
  let backend = base as ManagedHostBackend;
  const terminalMode = options.terminalMode ?? "disabled";
  const browserProvider = options.browserProvider ?? "disabled";
  if (terminalMode === "mock") backend = withMockTerminal(backend);
  if (browserProvider !== "disabled" && options.browserBackend) {
    backend = options.browserBackend(backend) as ManagedHostBackend;
  }
  // A provider name without an actual browser HostBackend is deliberately not
  // advertised. Reporting true before Playwright/Steel has an adapter would
  // make the unified UI open a non-functional browser panel.
  return withServerCapabilities(backend, {
    computerUse: false,
    revealInFinder: false,
    terminal: terminalMode === "mock",
    browser: browserProvider !== "disabled" && Boolean(options.browserBackend),
    git: true,
    plan: false,
    retainedWorktreeDisposition: false,
  });
}

function defaultStaticDir(): string {
  // This relative path works from both src/index.ts under Vitest and dist/index.js after tsc.
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/ui/dist/browser");
}

function defaultAuthHelperPath(env: NodeJS.ProcessEnv): string {
  const runtimeRoot = env.PIPIUI_RUNTIME_SOURCE_ROOT?.trim()
    || resolve(dirname(fileURLToPath(import.meta.url)), "../../../resources/runtime");
  const helper = join(runtimeRoot, "auth", "pi-auth-helper.mjs");
  if (!existsSync(helper)) {
    throw new Error(`Pi auth helper missing at ${helper}; set PIPIUI_RUNTIME_SOURCE_ROOT to the canonical runtime assets`);
  }
  return helper;
}

function normalizedOrigin(value: string): string {
  const parsed = new URL(value);
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:")
    || parsed.username || parsed.password || parsed.pathname !== "/"
    || parsed.search || parsed.hash) {
    throw new Error("PIPIUI_SERVER_PUBLIC_ORIGIN must be an HTTP(S) origin");
  }
  return parsed.origin;
}

function hostForURL(host: string): string {
  if (host === "0.0.0.0") return "127.0.0.1";
  if (host === "::") return "[::1]";
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function rejectUpgrade(socket: import("node:stream").Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function pairPage(pairID: string, nonce: string): string {
  const encodedID = JSON.stringify(pairID).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>PipiUI 配对</title>
<style nonce="${nonce}">body{font:16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#17181c;color:#f4f5f7;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:32rem;padding:2rem}p{color:#c9cbd1}.error{color:#ff9b9b}</style>
</head><body><main><h1>PipiUI 远程会话</h1><p id="status" role="status">正在安全连接服务器…</p></main>
<script nonce="${nonce}">(()=>{"use strict";const pairID=${encodedID};const status=document.getElementById("status");const secret=location.hash.startsWith("#")?location.hash.slice(1):"";if(!/^[0-9a-f]{64}$/.test(secret)){status.textContent="链接无效或密钥缺失；请使用完整配对链接。";status.className="error";return;}fetch("/pair/"+pairID+"/claim",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({secret})}).then(response=>{if(!response.ok)throw new Error("pairing rejected");history.replaceState(null,"","/");location.replace("/");}).catch(()=>{status.textContent="配对失败或链接已过期。";status.className="error";});})();</script>
</body></html>`;
}

/**
 * Serves the built browser UI and a same-origin Host API WebSocket.  In normal
 * mode each browser socket owns its own PiHostBackend, so streamed events and
 * live pi processes are never broadcast to unrelated paired browsers.
 */
export function createWsHostServer(
  input: HostBackend | WsHostServerOptions = {},
): WsHostServer {
  const options: WsHostServerOptions = ("handle" in input && "subscribe" in input)
    ? { backend: input }
    : input;
  const staticDir = options.staticDir ?? defaultStaticDir();
  const indexFile = join(staticDir, "index.html");
  if (!existsSync(indexFile)) {
    throw new Error(`browser UI build missing at ${indexFile}; run npm run build -w @pipiui/ui`);
  }
  const configuredHost = options.host ?? "127.0.0.1";
  const configuredPort = options.port ?? 0;
  const publicOrigin = options.publicOrigin ? normalizedOrigin(options.publicOrigin) : undefined;
  const pairing = options.pairing === false
    ? undefined
    : new RelayCompatiblePairing({ ttlMs: options.pairing?.ttlMs });
  const secureCookies = options.secureCookies
    ?? publicOrigin?.startsWith("https:")
    ?? Boolean(options.tls);
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    next();
  });

  const connections = new Map<WebSocket, Connection>();
  /** Backend drains still in flight; close() awaits them so no backend write
   * (agent logs, session JSONL) outlives the server teardown. */
  const backendClosings = new Set<Promise<void>>();
  let boundPort: number | undefined;
  let boundHost = configuredHost;
  let defaultPairing: PairingLink | undefined;
  const resolvedOrigin = (): string | undefined => {
    if (publicOrigin) return publicOrigin;
    if (boundPort === undefined) return undefined;
    return `${options.tls ? "https" : "http"}://${hostForURL(boundHost)}:${boundPort}`;
  };
  const issuePairingLink = (): string | undefined => {
    if (!pairing) return undefined;
    const origin = resolvedOrigin();
    if (!origin) return undefined;
    return pairing.create(origin).url;
  };
  const ensureDefaultPairing = (): string | undefined => {
    if (!pairing) return undefined;
    if (!defaultPairing) {
      const origin = resolvedOrigin();
      if (!origin) return undefined;
      defaultPairing = pairing.create(origin);
    }
    return defaultPairing.url;
  };

  const requirePairing: RequestHandler = (req, res, next) => {
    if (!pairing) return next();
    if (!pairing.authorize(req.headers.cookie)) {
      res.status(401).json({ error: "pairing required" });
      return;
    }
    next();
  };

  app.get(["/health", "/healthz"], (_req, res) => res.status(200).type("text/plain").send("ok"));
  app.get("/pair/:pairID", (req, res) => {
    if (!pairing || !RELAY_PAIR_ID.test(req.params.pairID)) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const nonce = randomBytes(18).toString("base64");
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    );
    res.type("html").send(pairPage(req.params.pairID.toLowerCase(), nonce));
  });
  app.post("/pair/:pairID/claim", express.json({ limit: "1kb", strict: true }), (req, res) => {
    if (!pairing || !RELAY_PAIR_ID.test(req.params.pairID)
      || !isRecord(req.body)
      || Object.keys(req.body).sort().join(",") !== "secret"
      || typeof req.body.secret !== "string"
      || !RELAY_PAIR_SECRET.test(req.body.secret)) {
      res.status(403).json({ error: "pairing rejected" });
      return;
    }
    const grant = pairing.claim(req.params.pairID.toLowerCase(), req.body.secret);
    if (!grant) {
      res.status(403).json({ error: "pairing rejected" });
      return;
    }
    // Match Relay's last-opener-wins semantics: a fresh use of the same link
    // revokes the previous browser grant and its Host API socket.
    for (const [socket, connection] of connections) {
      if (connection.pairing?.pairID === grant.pairID) socket.close(4001, "replaced");
    }
    res.setHeader("Set-Cookie", pairing.cookie(grant, secureCookies));
    res.status(204).end();
  });
  app.use(requirePairing, express.static(staticDir, {
    dotfiles: "deny",
    fallthrough: true,
    index: "index.html",
  }));
  app.get("*", requirePairing, (_req, res) => {
    res.sendFile(indexFile, error => {
      const statusCode = isRecord(error) && typeof error.statusCode === "number" ? error.statusCode : 500;
      if (error && !res.headersSent) res.status(statusCode).end();
    });
  });
  app.use(((error: unknown, _req, res, _next) => {
    if (!res.headersSent) res.status(400).json({ error: "invalid request" });
  }) as express.ErrorRequestHandler);

  const server: NetworkServer = options.tls
    ? createHttpsServer(options.tls, app)
    : createHttpServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WIRE_PAYLOAD_BYTES });
  const createBackend = options.backend
    ? () => options.backend!
    : options.createBackend ?? (() => createPiHostBackend(options.backendOptions));

  const closeConnection = (socket: WebSocket, connection: Connection): void => {
    if (connection.closed) return;
    connection.closed = true;
    connections.delete(socket);
    if (connection.expiryTimer) clearTimeout(connection.expiryTimer);
    connection.unsubscribe();
    connection.closing = Promise.resolve(connection.backend.close?.()).catch(() => undefined);
    backendClosings.add(connection.closing);
    void connection.closing.finally(() => backendClosings.delete(connection.closing!));
  };

  const openConnection = (socket: WebSocket, identity?: PairingIdentity, cookieHeader?: string): void => {
    const backend = decorateBackend(createBackend(), options);
    const connection: Connection = {
      backend,
      pairing: identity,
      cookieHeader,
      closed: false,
      unsubscribe: () => {},
    };
    connection.unsubscribe = backend.subscribe(event => {
      if (pairing && (!connection.cookieHeader || !pairing.authorize(connection.cookieHeader))) {
        socket.close(4001, "link expired");
        return;
      }
      safeSend(socket, { type: "event", ...event });
    });
    if (identity) {
      connection.expiryTimer = setTimeout(() => socket.close(4001, "link expired"), Math.max(1, identity.expiresAt - Date.now()));
      connection.expiryTimer.unref?.();
    }
    connections.set(socket, connection);
    socket.on("close", () => closeConnection(socket, connection));
    socket.on("error", () => closeConnection(socket, connection));
    socket.on("message", async (raw, isBinary) => {
      // A later use of the same pairing link invalidates the old cookie before
      // this handler can execute another Host API request.
      if (pairing && (!connection.cookieHeader || !pairing.authorize(connection.cookieHeader))) {
        socket.close(4001, "replaced");
        return;
      }
      const request = requestFromWire(raw, isBinary);
      if (!request) {
        safeSend(socket, responseError("", "unsupported protocol"));
        return;
      }
      try {
        safeSend(socket, responseSuccess(request.id, await backend.handle(request.method, request.params)));
      } catch (error) {
        safeSend(socket, responseError(request.id, error instanceof Error ? error.message : String(error)));
      }
    });
  };

  server.on("upgrade", (request: IncomingMessage, socket, head) => {
    let url: URL;
    try {
      url = new URL(request.url ?? "/", "http://pipiui.invalid");
    } catch {
      rejectUpgrade(socket, "400 Bad Request");
      return;
    }
    if (url.pathname !== "/ws" || url.search) {
      rejectUpgrade(socket, "404 Not Found");
      return;
    }
    const identity = pairing?.authorize(request.headers.cookie);
    if (pairing && !identity) {
      rejectUpgrade(socket, "401 Unauthorized");
      return;
    }
    wss.handleUpgrade(request, socket, head, webSocket => {
      openConnection(webSocket, identity, request.headers.cookie);
    });
  });

  return {
    server,
    get pairingLink(): string | undefined {
      return ensureDefaultPairing();
    },
    createPairingLink: issuePairingLink,
    listen(port = configuredPort, host = configuredHost): Promise<number> {
      return new Promise((resolve, reject) => {
        boundHost = host;
        const onError = (error: Error) => reject(error);
        server.once("error", onError);
        server.listen(port, host, () => {
          server.off("error", onError);
          const address = server.address();
          if (!address || typeof address === "string") {
            reject(new Error("server did not report a TCP port"));
            return;
          }
          boundPort = address.port;
          ensureDefaultPairing();
          resolve(address.port);
        });
      });
    },
    async close(): Promise<void> {
      for (const [socket, connection] of [...connections]) {
        closeConnection(socket, connection);
        socket.terminate();
      }
      await new Promise<void>(resolve => wss.close(() => resolve()));
      if (!server.listening) return;
      // Destroy every open HTTP connection (not just idle ones). Node's fetch
      // (undici) holds keep-alive sockets in its pool after a response, and
      // server.close() otherwise waits several seconds for them to drain — long
      // enough to trip teardown timeouts. On shutdown we are tearing the server
      // down, so terminating in-flight connections is the intended behavior.
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await Promise.allSettled([...backendClosings]);
    },
  };
}

export function serverOptionsFromEnvironment(env = process.env): WsHostServerOptions {
  const host = env.PIPIUI_SERVER_HOST ?? "127.0.0.1";
  const port = Number(env.PIPIUI_SERVER_PORT ?? "8788");
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("PIPIUI_SERVER_PORT must be a valid port");
  }
  const pairing = env.PIPIUI_SERVER_PAIRING === "false" ? false : {};
  const publicOrigin = env.PIPIUI_SERVER_PUBLIC_ORIGIN?.trim() || undefined;
  if (publicOrigin) normalizedOrigin(publicOrigin);
  if (pairing !== false && !publicOrigin && (host === "0.0.0.0" || host === "::")) {
    throw new Error("PIPIUI_SERVER_PUBLIC_ORIGIN is required when binding a public interface");
  }
  const terminalMode = env.PIPIUI_SERVER_TERMINAL ?? "disabled";
  if (terminalMode !== "disabled" && terminalMode !== "mock") {
    throw new Error("PIPIUI_SERVER_TERMINAL must be disabled or mock");
  }
  const browserProvider = env.PIPIUI_SERVER_BROWSER ?? "disabled";
  if (browserProvider !== "disabled" && browserProvider !== "playwright" && browserProvider !== "steel") {
    throw new Error("PIPIUI_SERVER_BROWSER must be disabled, playwright, or steel");
  }
  const tlsKeyPath = env.PIPIUI_SERVER_TLS_KEY?.trim();
  const tlsCertPath = env.PIPIUI_SERVER_TLS_CERT?.trim();
  if (Boolean(tlsKeyPath) !== Boolean(tlsCertPath)) {
    throw new Error("PIPIUI_SERVER_TLS_KEY and PIPIUI_SERVER_TLS_CERT must be configured together");
  }
  const tls = tlsKeyPath && tlsCertPath
    ? { key: readFileSync(tlsKeyPath), cert: readFileSync(tlsCertPath) }
    : undefined;
  return {
    host,
    port,
    publicOrigin,
    pairing,
    terminalMode,
    browserProvider,
    tls,
    // Match Electron main: the external helper runs Pi's canonical
    // ModelRuntime with ~/.pi/agent/.env overlaid in its child environment.
    // Keys remain child-only and never enter the Host API response.
    backendOptions: { authHelperPath: defaultAuthHelperPath(env) },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const instance = createWsHostServer(serverOptionsFromEnvironment());
  void instance.listen().then(port => {
    process.stdout.write(`PipiUI server listening on ${port}\n`);
    if (instance.pairingLink) process.stdout.write(`PipiUI pairing link (valid for 24h): ${instance.pairingLink}\n`);
  }).catch(error => {
    process.stderr.write(`[pipiui-server] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
