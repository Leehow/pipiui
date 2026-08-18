import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { createPiHostBackend } from "@pipi/pi-backend";
import { createWsHost, type HostBackend } from "@pipi/host-api";
import { createWsHostServer, RELAY_PAIR_ID, RELAY_PAIR_SECRET, serverOptionsFromEnvironment, type WsHostServer, type WsHostServerOptions } from "../src/index.js";

const TEST_STATIC_DIR = fileURLToPath(new URL("./fixtures/browser", import.meta.url));
const SERVER_ENV_KEYS = [
  "PIPIUI_SERVER_HOST",
  "PIPIUI_SERVER_PORT",
  "PIPIUI_SERVER_PAIRING",
  "PIPIUI_SERVER_PUBLIC_ORIGIN",
  "PIPIUI_SERVER_TERMINAL",
  "PIPIUI_SERVER_BROWSER",
  "PIPIUI_SERVER_TLS_KEY",
  "PIPIUI_SERVER_TLS_CERT",
] as const;
const previousServerEnv = new Map<string, string | undefined>();

beforeAll(() => {
  for (const key of SERVER_ENV_KEYS) {
    previousServerEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterAll(() => {
  for (const [key, value] of previousServerEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function startServer(options: WsHostServerOptions | HostBackend = {}): WsHostServer {
  const resolved: WsHostServerOptions = ("handle" in options && "subscribe" in options)
    ? { backend: options }
    : options;
  return createWsHostServer({ staticDir: TEST_STATIC_DIR, ...resolved });
}

let active: WsHostServer | undefined;
let tempRoot = "";

afterEach(async () => {
  if (active) await active.close();
  active = undefined;
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = "";
});

function quietBackend(): HostBackend {
  return {
    async handle(method) {
      if (method === "capabilities") return { computerUse: true, revealInFinder: true, terminal: true, browser: true };
      if (method === "listProjects") return [];
      throw new Error(`unexpected method: ${method}`);
    },
    subscribe: () => () => {},
  };
}

async function openSocket(url: string, cookie?: string): Promise<WebSocket> {
  const socket = new WebSocket(url, cookie ? { headers: { Cookie: cookie } } : undefined);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
    socket.once("unexpected-response", (_request, response) => reject(new Error(`unexpected response ${response.statusCode}`)));
  });
  return socket;
}

async function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return;
  const closed = once(socket, "close");
  socket.close();
  await closed;
}

async function eventually(check: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("condition was not met before timeout");
}

async function eventuallyAsync(check: () => Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("async condition was not met before timeout");
}

describe("server browser host", () => {
  it("keeps the dev listener on 127.0.0.1 while advertising the canonical localhost cookie origin", async () => {
    const options = serverOptionsFromEnvironment({
      PIPIUI_SERVER_HOST: "127.0.0.1",
      PIPIUI_SERVER_PORT: "0",
      PIPIUI_SERVER_PUBLIC_ORIGIN: "http://localhost:5173",
    } as NodeJS.ProcessEnv);
    expect(options).toMatchObject({ host: "127.0.0.1", port: 0, publicOrigin: "http://localhost:5173" });
    expect(options.backendOptions?.authHelperPath).toMatch(/resources\/runtime\/auth\/pi-auth-helper\.mjs$/);

    active = startServer({ ...options, backend: quietBackend() });
    const port = await active.listen();
    expect(new URL(active.pairingLink!).origin).toBe("http://localhost:5173");
    // The TCP endpoint is still loopback-only and root remains protected even
    // though its advertised browser/cookie origin intentionally differs.
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(401);
  });

  it("uses the canonical external ModelRuntime helper with agent .env without exposing API keys", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "pipi-server-auth-helper-"));
    const agentDir = join(tempRoot, "agent");
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, ".env"), "DEEPSEEK_API_KEY=server-test-secret\n");
    const helper = join(tempRoot, "helper.mjs");
    await writeFile(helper, `
const command = process.argv[2];
const configured = process.env.DEEPSEEK_API_KEY === "server-test-secret";
if (command === "list-providers") console.log(JSON.stringify({ok:true,providers:[{id:"deepseek",name:"DeepSeek",auth:{apiKey:{}}}]}));
else if (command === "list-models") console.log(JSON.stringify({ok:true,models:configured?[{provider:"deepseek",id:"deepseek-chat",name:"DeepSeek Chat",reasoning:false}]:[]}));
else console.log(JSON.stringify({ok:false,error:"unsupported test command"}));
`);
    active = startServer({
      pairing: false,
      backendOptions: {
        agentDir,
        authHelperPath: helper,
        authNodePath: process.execPath,
        piPath: process.execPath,
        env: { PATH: process.env.PATH },
      },
    });
    const port = await active.listen();
    const socket = await openSocket(`ws://127.0.0.1:${port}/ws`);
    const host = createWsHost(socket as any);
    const models = await host.listModels();
    const providers = await host.authProviders();
    expect(models).toMatchObject([{ provider: "deepseek", id: "deepseek-chat" }]);
    expect(providers).toMatchObject([{ id: "deepseek", authenticated: true, authType: "api_key" }]);
    expect(JSON.stringify({ models, providers })).not.toContain("server-test-secret");
    await closeSocket(socket);
  });

  it("serves the packages/ui browser build only after a Relay-compatible random pairing link is claimed", async () => {
    active = startServer({ backend: quietBackend() });
    const port = await active.listen();
    const origin = `http://127.0.0.1:${port}`;

    expect((await fetch(`${origin}/`)).status).toBe(401);
    const link = active.pairingLink;
    expect(link).toBeTruthy();
    const pairingURL = new URL(link!);
    expect(pairingURL.pathname).toMatch(/^\/pair\//);
    expect(pairingURL.pathname.split("/").at(-1)).toMatch(RELAY_PAIR_ID);
    expect(pairingURL.hash.slice(1)).toMatch(RELAY_PAIR_SECRET);

    const pairPage = await fetch(`${origin}${pairingURL.pathname}`);
    const pairHTML = await pairPage.text();
    expect(pairPage.status).toBe(200);
    expect(pairHTML).not.toContain(pairingURL.hash.slice(1));
    expect(pairHTML).toContain("location.hash");
    expect(pairHTML).toContain("location.pathname+location.hash");
    expect(pairHTML).toContain("location.reload()");
    expect(pairHTML).not.toContain('location.replace("/")');
    expect(pairHTML).not.toContain('replaceState(null,"","/")');

    const claim = await fetch(`${origin}${pairingURL.pathname}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: pairingURL.hash.slice(1) }),
    });
    expect(claim.status).toBe(204);
    const cookie = claim.headers.get("set-cookie")?.split(";", 1)[0];
    expect(cookie).toMatch(/^pipiui_pair=/);

    const index = await fetch(`${origin}/`, { headers: { Cookie: cookie! } });
    const html = await index.text();
    expect(index.status).toBe(200);
    expect(html).toContain('<div id="root">');
    const pairAfterClaim = await fetch(`${origin}${pairingURL.pathname}`, { headers: { Cookie: cookie! } });
    const pairAfterHTML = await pairAfterClaim.text();
    expect(pairAfterClaim.status).toBe(200);
    expect(pairAfterHTML).toContain('<div id="root">');
    expect(pairAfterHTML).not.toContain("正在安全连接服务器");
    const asset = html.match(/src="(\/assets\/[^\"]+\.js)"/)?.[1];
    expect(asset).toBeTruthy();
    const assetResponse = await fetch(`${origin}${asset}`, { headers: { Cookie: cookie! } });
    expect(assetResponse.status).toBe(200);

    const socket = await openSocket(`ws://127.0.0.1:${port}/ws`, cookie);
    const host = createWsHost(socket as any);
    await expect(host.capabilities()).resolves.toMatchObject({
      computerUse: false,
      revealInFinder: false,
      terminal: false,
      browser: false,
    });
    await closeSocket(socket);
  });

  it("runs the real Pi backend over the Host API WebSocket and scopes events to its connection", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "pipi-server-"));
    const cwd = join(tempRoot, "project");
    const sessionsRoot = join(tempRoot, "sessions");
    const agentDir = join(tempRoot, "agent");
    const sessionDirectory = join(sessionsRoot, "project");
    await mkdir(cwd, { recursive: true });
    await mkdir(agentDir, { recursive: true });
    await mkdir(sessionDirectory, { recursive: true });
    await writeFile(join(sessionDirectory, "session.jsonl"), [
      JSON.stringify({ type: "session", version: 3, id: "session-1", timestamp: "2026-08-10T00:00:00.000Z", cwd }),
      JSON.stringify({ type: "message", id: "saved-message", parentId: null, timestamp: "2026-08-10T00:00:01.000Z", message: { role: "user", content: "saved" } }),
    ].join("\n") + "\n");

    let backendCount = 0;
    active = startServer({
      pairing: false,
      createBackend: () => {
        backendCount += 1;
        return createPiHostBackend({
          agentDir,
          sessionsRoot,
          canonicalProjectPaths: async () => undefined,
          sourceRoot: process.cwd(),
          piPath: process.execPath,
          authRuntime: {
            getProviders: async () => [{ id: "pi-auth", name: "Pi Auth", auth: { oauth: { loginLabel: "Login" } } }],
            getAvailable: async () => [{ provider: "pi-auth", id: "pi-live", name: "Pi Live", reasoning: true }],
            login: async () => ({ type: "oauth" }),
            logout: async () => undefined,
          },
          spawn: (_bin, _args, options) => spawn(process.execPath, [new URL("../../../packages/pi-backend/test/fake-pi.mjs", import.meta.url).pathname], options) as any,
        });
      },
    });
    const port = await active.listen();
    const socket = await openSocket(`ws://127.0.0.1:${port}/ws`);
    const host = createWsHost(socket as any);

    await expect(host.listModels()).resolves.toMatchObject([{ provider: "pi-auth", id: "pi-live" }]);
    await expect(host.authProviders()).resolves.toMatchObject([{ id: "pi-auth", authTypes: ["oauth"] }]);

    if (!host.getProjectPaths || !host.addProject || !host.removeProject) throw new Error("project persistence extension unavailable");
    await host.addProject(cwd);
    const [project] = await host.listProjects();
    expect(project.path).toBe(cwd);
    expect(await host.getProjectPaths()).toEqual([cwd]);
    await host.removeProject(project.id);
    expect(await host.listProjects()).toEqual([]);
    const restored = await host.addProject(cwd);
    expect(restored).toMatchObject({ id: project.id, path: cwd });
    const sessions = await host.listSessions(project.id);
    expect(sessions).toMatchObject([{ id: "session-1" }]);
    expect(await host.getSessionHistory("session-1")).toMatchObject([{ content: "saved" }]);

    const stream: any[] = [];
    const unsubscribe = host.subscribeStream("session-1", event => stream.push(event));
    await host.sendPrompt("session-1", "hello through WSS");
    await eventually(() => stream.some(event => event.type === "text" && event.delta === "hello"));
    const queueEvents: any[] = [];
    const offQueue = host.subscribeStream("session-1", event => { if (event.type === "queue_update") queueEvents.push(event); });
    // Real pi-backend WSS path: while __hold__ is active, normal enqueue is a
    // product queue item instead of an already-processing RPC error.
    await host.sendPrompt("session-1", "__hold__");
    const queued = await host.enqueueMessage("session-1", "remote queued", [{ dataBase64: "aGVsbG8=", mimeType: "image/png", name: "remote.png", width: 320 }]);
    expect(queued).toMatchObject({ outcome: "queued", message: { state: "queued", attachments: [expect.objectContaining({ width: 320 })] } });
    expect(await host.listQueue("session-1")).toEqual(expect.arrayContaining([expect.objectContaining({ text: "remote queued" })]));
    // a1c64472: a user stop takes effect immediately and no longer FIFO-drains.
    // The queued item must survive the stop rather than be auto-sent behind it.
    await host.stop("session-1");
    await eventuallyAsync(async () => (await host.listQueue("session-1")).some((item: any) => item.text === "remote queued"));
    expect(await host.listQueue("session-1")).toEqual(expect.arrayContaining([expect.objectContaining({ text: "remote queued" })]));
    offQueue();
    unsubscribe();
    expect(queueEvents.some(event => event.queue.some((item: any) => item.text === "remote queued"))).toBe(true);
    expect(stream.map(event => event.type)).toEqual(expect.arrayContaining(["status", "thinking", "text", "tool_call", "tool_result"]));
    expect(await host.listAgents("session-1")).toEqual(expect.arrayContaining([expect.objectContaining({ agentId: "agent-1", sessionId: "session-1" })]));
    expect(await host.capabilities()).toMatchObject({ computerUse: false, revealInFinder: false, terminal: false, browser: false });
    expect(backendCount).toBe(1);

    const second = await openSocket(`ws://127.0.0.1:${port}/ws`);
    expect(backendCount).toBe(2);
    await closeSocket(second);
    await closeSocket(socket);
  });

  it("revokes the prior browser WebSocket when the same pairing link is opened again", async () => {
    active = startServer({ backend: quietBackend() });
    const port = await active.listen();
    const origin = `http://127.0.0.1:${port}`;
    const pairingURL = new URL(active.pairingLink!);
    const claim = async () => {
      const response = await fetch(`${origin}${pairingURL.pathname}/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: pairingURL.hash.slice(1) }),
      });
      return response.headers.get("set-cookie")!.split(";", 1)[0];
    };
    const firstCookie = await claim();
    const first = await openSocket(`ws://127.0.0.1:${port}/ws`, firstCookie);
    const closed = once(first, "close");
    const secondCookie = await claim();
    const [code, reason] = await closed;
    expect(code).toBe(4001);
    expect(String(reason)).toBe("replaced");
    const second = await openSocket(`ws://127.0.0.1:${port}/ws`, secondCookie);
    await closeSocket(second);
  });
});
