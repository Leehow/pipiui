import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import WebSocket from "ws";
import { createTunnelServer } from "../src/tunnel-server.js";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function availablePort(): Promise<number> {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("port allocation failed");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

function emit(value: Record<string, unknown>) {
  process.stdout.write(`PIPI_E2E ${JSON.stringify(value)}\n`);
}

async function waitUntil<T>(
  operation: () => Promise<T | null>,
  timeoutMS = 15_000,
  label = "condition",
): Promise<T> {
  const deadline = Date.now() + timeoutMS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await operation();
      if (value !== null) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} timed out${lastError ? `: ${String(lastError)}` : ""}`);
}

async function cdpPage(port: number) {
  const pages = await waitUntil(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!response.ok) return null;
    return response.json() as Promise<Array<{
      type: string;
      webSocketDebuggerUrl: string;
    }>>;
  }, 15_000, "CDP page discovery");
  const target = pages.find((item) => item.type === "page");
  if (!target) throw new Error("Chrome page target unavailable");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await once(socket, "open");
  let nextID = 0;
  const pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  socket.on("message", (data) => {
    const value = JSON.parse(data.toString()) as {
      id?: number;
      result?: unknown;
      error?: { message?: string };
    };
    if (typeof value.id !== "number") return;
    const waiter = pending.get(value.id);
    if (!waiter) return;
    pending.delete(value.id);
    if (value.error) waiter.reject(new Error(value.error.message || "CDP error"));
    else waiter.resolve(value.result);
  });
  const send = (method: string, params: Record<string, unknown> = {}) => {
    const id = ++nextID;
    return new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  };
  const evaluate = async (expression: string) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }) as {
      result?: { value?: unknown };
      exceptionDetails?: { text?: string };
    };
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "browser evaluation failed");
    }
    return result.result?.value;
  };
  await send("Runtime.enable");
  await send("Page.enable");
  return { socket, send, evaluate };
}

const relayPort = await availablePort();
const debuggingPort = await availablePort();
const origin = `http://127.0.0.1:${relayPort}`;
const relay = createTunnelServer({
  host: "127.0.0.1",
  port: relayPort,
  publicOrigin: origin,
  tunnelURL: `ws://127.0.0.1:${relayPort}/tunnel/ws`,
});
relay.server.listen(relayPort, "127.0.0.1");
await once(relay.server, "listening");

const temporary = mkdtempSync(join(tmpdir(), "pipiui-trystero-e2e-"));
let chrome: ReturnType<typeof spawn> | null = null;
let page: Awaited<ReturnType<typeof cdpPage>> | null = null;
let stopping = false;

async function stop() {
  if (stopping) return;
  stopping = true;
  try { page?.socket.close(); } catch {}
  if (chrome?.exitCode === null) {
    const exited = once(chrome, "exit").then(() => undefined);
    chrome.kill("SIGTERM");
    await Promise.race([exited, new Promise<void>(
      (resolve) => setTimeout(resolve, 1_000),
    )]);
  }
  await Promise.race([
    relay.close(),
    new Promise<void>((resolve) => setTimeout(resolve, 500)),
  ]);
  relay.server.closeAllConnections();
  await Promise.race([
    new Promise<void>((resolve) => relay.server.close(() => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 500)),
  ]);
  try {
    rmSync(temporary, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  } catch {}
}

process.on("SIGTERM", () => { void stop().finally(() => process.exit(0)); });
process.on("uncaughtException", (error) => {
  emit({ type: "error", message: String(error.stack || error) });
  void stop().finally(() => process.exit(1));
});
process.on("unhandledRejection", (error) => {
  emit({ type: "error", message: String(error) });
  void stop().finally(() => process.exit(1));
});

emit({
  type: "ready",
  webSocketURL: `ws://127.0.0.1:${relayPort}/tunnel/ws`,
  publicURL: `${origin}/`,
});

let inputBuffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  inputBuffer += chunk;
  while (inputBuffer.includes("\n")) {
    const index = inputBuffer.indexOf("\n");
    const line = inputBuffer.slice(0, index);
    inputBuffer = inputBuffer.slice(index + 1);
    if (line.trim()) void handle(JSON.parse(line));
  }
});

async function handle(message: Record<string, unknown>) {
  if (message.type === "run") {
    const pairURL = String(message.pairURL);
    chrome = spawn(chromePath, [
      "--headless=new",
      "--disable-gpu",
      "--disable-background-networking",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${debuggingPort}`,
      `--user-data-dir=${join(temporary, "chrome-profile")}`,
      "about:blank",
    ], { stdio: ["ignore", "ignore", "pipe"] });
    page = await cdpPage(debuggingPort);
    await page.send("Page.addScriptToEvaluateOnNewDocument", {
      source: "globalThis.__pipiRtcConstructorCalls = 0; Object.defineProperty(globalThis, 'RTCPeerConnection', { configurable: true, value: class { constructor(){ globalThis.__pipiRtcConstructorCalls += 1; throw new Error('WebRTC must be unused by tunnel'); } } });",
    });
    await page.send("Page.navigate", { url: pairURL });
    let connected;
    try {
      connected = await waitUntil(async () => {
        const value = await page!.evaluate(`JSON.stringify({
          hashCleared: location.hash === "",
          transport: document.getElementById("transport")?.textContent || "",
          project: document.getElementById("projects")?.options?.[0]?.value || "",
          status: document.getElementById("status")?.textContent || "",
          rtcConstructorCalls: globalThis.__pipiRtcConstructorCalls
        })`);
        const parsed = JSON.parse(String(value));
        return parsed.hashCleared && parsed.transport.includes("服务器能力隧道")
          && parsed.project === "e2e-project" ? parsed : null;
      }, 30_000, "Trystero DataChannel index command");
    } catch (error) {
      const browser = await page.evaluate(`JSON.stringify({
        href: location.href,
        transport: document.getElementById("transport")?.textContent || "",
        project: document.getElementById("projects")?.options?.[0]?.value || "",
        status: document.getElementById("status")?.textContent || ""
      })`);
      throw new Error(`${String(error)}; browser=${String(browser)}; rooms=${
        relay.getRoomCount()
      }`);
    }

    const serverCommandHTTPStatus = (
      await fetch(`${origin}/api/index`, { cache: "no-store" })
    ).status;
    await page.send("Page.navigate", {
      url: "about:blank",
    });
    await waitUntil(async () => relay.getRoomCount() === 0 ? true : null,
      5_000, "tunnel invalidation after browser disconnect");
    emit({
      type: "complete",
      connected,
      serverCommandHTTPStatus,
      tunnelRooms: relay.getRoomCount(),
    });
    return;
  }
  if (message.type === "shutdown") {
    await stop();
    process.exit(0);
  }
}
