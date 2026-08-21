import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPiHostBackend, TURN_WATCHDOG_TIMEOUT_MS } from "../src/index.js";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }); root = ""; });

async function eventually(check: () => boolean | Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("condition was not met before timeout");
}

async function fixture() {
  root = await mkdtemp(join(tmpdir(), "pipi-watchdog-"));
  const agentDir = join(root, "agent");
  const sessionsRoot = join(root, "sessions");
  const cwd = join(root, "project");
  const directory = join(sessionsRoot, "project");
  await mkdir(agentDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await mkdir(directory, { recursive: true });
  const sessionPath = join(directory, "s1.jsonl");
  await writeFile(sessionPath, JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-08-17T00:00:00.000Z", cwd }) + "\n");
  const backend = createPiHostBackend({
    agentDir,
    sessionsRoot,
    runtimeRoot: root,
    piPath: process.execPath,
    spawn: (_bin, _args, options) => spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], options) as any,
  });
  return { backend, sessionPath };
}

describe("turn watchdog (fix 3)", () => {
  it("triggers settle+drain when tail is assistant stop and turn silent >120s", async () => {
    const { backend, sessionPath } = await fixture();
    const statuses: string[] = [];
    const off = backend.subscribe(e => { if (e.channel === "stream" && e.event.type === "status") statuses.push(e.event.status); });

    await backend.handle("sendPrompt", ["s1", "__hold__"]);
    await eventually(() => statuses.includes("started"));
    expect(statuses).toEqual(["started"]);

    // Enqueue a message that should be drained after watchdog settles
    const queued = await backend.handle("enqueueMessage", ["s1", "from-watchdog"]) as any;
    expect(queued.outcome).toBe("queued");

    // Make JSONL tail look terminal (assistant stop) so watchdog considers it eligible
    await appendFile(sessionPath, JSON.stringify({
      type: "message", id: "tail-stop", parentId: null,
      message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop", timestamp: Date.now() },
      timestamp: new Date().toISOString(),
    }) + "\n");

    // Force idle time >120s by backdating live's last activity
    const live = (backend as any).live.get("s1");
    expect(live).toBeTruthy();
    live.lastTurnActivityAt = Date.now() - (TURN_WATCHDOG_TIMEOUT_MS + 5_000);

    // Trigger watchdog sweep directly
    await (backend as any).checkTurnWatchdogs();

    await eventually(() => statuses.includes("settled"));
    // After watchdog settle, queue should be drained (FIFO auto-drain, no age check)
    await eventually(async () => ((await backend.handle("listQueue", ["s1"]) as any[]).length === 0));
    expect(statuses.filter(s => s === "started").length).toBeGreaterThanOrEqual(2); // watchdog drain started next turn

    off();
    await backend.close();
  });

  it("does not trigger when tail is tool_use (long tool call in progress)", async () => {
    const { backend, sessionPath } = await fixture();
    const statuses: string[] = [];
    const off = backend.subscribe(e => { if (e.channel === "stream" && e.event.type === "status") statuses.push(e.event.status); });

    await backend.handle("sendPrompt", ["s1", "__hold__"]);
    await eventually(() => statuses.includes("started"));

    // Tail is assistant with tool_use — must not be considered terminal, watchdog must not fire
    await appendFile(sessionPath, JSON.stringify({
      type: "message", id: "tail-tool", parentId: null,
      message: { role: "assistant", content: [{ type: "tool_use", name: "bash", input: {} }], stopReason: "toolUse", timestamp: Date.now() },
      timestamp: new Date().toISOString(),
    }) + "\n");

    const live = (backend as any).live.get("s1");
    live.lastTurnActivityAt = Date.now() - (TURN_WATCHDOG_TIMEOUT_MS + 5_000);

    await (backend as any).checkTurnWatchdogs();
    // Give it a tick
    await new Promise(r => setTimeout(r, 100));
    expect(statuses).toEqual(["started"]); // still not settled
    expect((backend as any).queue.isBusy("s1")).toBe(true);

    off();
    await backend.close();
  });

  it("isSessionTailTerminal distinguishes stop vs tool_use", async () => {
    const { backend, sessionPath } = await fixture();
    // Write stop tail
    await appendFile(sessionPath, JSON.stringify({
      type: "message", id: "a1", parentId: null,
      message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop", timestamp: Date.now() },
      timestamp: new Date().toISOString(),
    }) + "\n");
    expect(await (backend as any).isSessionTailTerminal(sessionPath)).toBe(true);

    // Overwrite with tool_use tail (append, tool_use is now last)
    await appendFile(sessionPath, JSON.stringify({
      type: "message", id: "a2", parentId: null,
      message: { role: "assistant", content: [{ type: "tool_use", name: "bash" }], stopReason: "toolUse", timestamp: Date.now() },
      timestamp: new Date().toISOString(),
    }) + "\n");
    expect(await (backend as any).isSessionTailTerminal(sessionPath)).toBe(false);

    await backend.close();
  });
});
