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
    // The tail shape alone is not proof: a real long tool also left its
    // `tool_execution_start` in the host, which is what the watchdog now reads.
    live.toolNames.set("t1", "bash");
    live.lastTurnActivityAt = Date.now() - (TURN_WATCHDOG_TIMEOUT_MS + 5_000);

    await (backend as any).checkTurnWatchdogs();
    // Give it a tick
    await new Promise(r => setTimeout(r, 100));
    expect(statuses).toEqual(["started"]); // still not settled
    expect((backend as any).queue.isBusy("s1")).toBe(true);

    off();
    await backend.close();
  });

  it("releases a parked FIFO when Pi exits after the settle epoch has been overtaken", async () => {
    const { backend } = await fixture();
    const statuses: string[] = [];
    const off = backend.subscribe(e => { if (e.channel === "stream" && e.event.type === "status") statuses.push(e.event.status); });

    await backend.handle("sendPrompt", ["s1", "__hold__"]);
    await eventually(() => statuses.includes("started"));
    const queued = await backend.handle("enqueueMessage", ["s1", "after-writer-exit"]) as any;
    expect(queued.outcome).toBe("queued");

    const live = (backend as any).live.get("s1");
    expect(live?.process?.pid).toEqual(expect.any(Number));
    // Mint a newer queue epoch without a real new turn. The close handler used
    // to pass the dead writer's epoch into notifyIdle, which then ignored the
    // idle and left turnActive set forever.
    (backend as any).queue.markBusy("s1");
    expect((backend as any).queue.isBusy("s1")).toBe(true);
    live.process.kill();

    await eventually(async () => ((await backend.handle("listQueue", ["s1"]) as any[]).every((item: any) => item.id !== queued.message.id)), 4_000);

    off();
    await backend.close();
  });

  it("drains a busy queue with no live writer when the JSONL tail is already terminal", async () => {
    const { backend, sessionPath } = await fixture();
    await backend.handle("getSessionHistory", ["s1"]);
    await backend.handle("listQueue", ["s1"]);
    (backend as any).queue.markBusy("s1");
    const queued = await backend.handle("enqueueMessage", ["s1", "orphan-busy"]) as any;
    expect(queued.outcome).toBe("queued");
    expect((backend as any).queue.isBusy("s1")).toBe(true);
    expect((backend as any).live.has("s1")).toBe(false);

    await appendFile(sessionPath, JSON.stringify({
      type: "message", id: "tail-stop", parentId: null,
      message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop", timestamp: Date.now() },
      timestamp: new Date().toISOString(),
    }) + "\n");

    await (backend as any).checkTurnWatchdogs();
    await eventually(async () => ((await backend.handle("listQueue", ["s1"]) as any[]).length === 0));

    await backend.close();
  });

  it("releases a leaked queue gate when live is already terminal (settle's queue-side release was lost)", async () => {
    const { backend, sessionPath } = await fixture();
    const statuses: string[] = [];
    const off = backend.subscribe(e => { if (e.channel === "stream" && e.event.type === "status") statuses.push(e.event.status); });

    // A normal completed turn: live projected terminal (epoch is fenced off),
    // so projectTurnTerminal can never run again for it.
    await backend.handle("sendPrompt", ["s1", "hello"]);
    await eventually(() => statuses.includes("settled"));

    // Durable terminal tail so the watchdog's tail gate passes.
    await appendFile(sessionPath, JSON.stringify({
      type: "message", id: "tail-stop", parentId: null,
      message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop", timestamp: Date.now() },
      timestamp: new Date().toISOString(),
    }) + "\n");

    // The settle's queue-side release was lost: the FIFO still holds turnActive
    // even though live says no turn is open. Every later prompt parks forever.
    (backend as any).queue.markBusy("s1");
    const enqueued = await backend.handle("enqueueMessage", ["s1", "typed-behind-leak"]) as any;
    expect(enqueued.outcome).toBe("queued");

    const live = (backend as any).live.get("s1");
    expect(live).toBeTruthy();
    live.lastTurnActivityAt = Date.now() - (TURN_WATCHDOG_TIMEOUT_MS + 5_000);
    await (backend as any).checkTurnWatchdogs();

    // The leaked gate is released and the parked prompt drains as a new turn.
    await eventually(async () => ((await backend.handle("listQueue", ["s1"]) as any[]).length === 0));
    await eventually(() => statuses.filter(s => s === "started").length >= 2);

    off();
    await backend.close();
  });

  it("settles a wedged turn whose tail is a tool result when no tool is executing", async () => {
    const { backend, sessionPath } = await fixture();
    const statuses: string[] = [];
    const off = backend.subscribe(e => { if (e.channel === "stream" && e.event.type === "status") statuses.push(e.event.status); });

    await backend.handle("sendPrompt", ["s1", "__hold__"]);
    await eventually(() => statuses.includes("started"));

    // The wedge: a tool result is durable, the model hop that follows never
    // produced anything, and nothing is executing. Tail shape is not terminal.
    await appendFile(sessionPath, JSON.stringify({
      type: "message", id: "tail-tool-result", parentId: null,
      message: { role: "toolResult", toolCallId: "t1", toolName: "grep", content: [{ type: "text", text: "hits" }], timestamp: Date.now() },
      timestamp: new Date().toISOString(),
    }) + "\n");

    const live = (backend as any).live.get("s1");
    expect(live).toBeTruthy();
    expect(live.toolNames.size).toBe(0);
    live.lastTurnActivityAt = Date.now() - (TURN_WATCHDOG_TIMEOUT_MS + 5_000);

    await (backend as any).checkTurnWatchdogs();
    await eventually(() => statuses.includes("settled"));

    off();
    await backend.close();
  });

  it("does not settle a non-terminal tail while a tool is still executing", async () => {
    const { backend, sessionPath } = await fixture();
    const statuses: string[] = [];
    const off = backend.subscribe(e => { if (e.channel === "stream" && e.event.type === "status") statuses.push(e.event.status); });

    await backend.handle("sendPrompt", ["s1", "__hold__"]);
    await eventually(() => statuses.includes("started"));

    await appendFile(sessionPath, JSON.stringify({
      type: "message", id: "tail-tool-result-2", parentId: null,
      message: { role: "toolResult", toolCallId: "t2", toolName: "bash", content: [{ type: "text", text: "still running" }], timestamp: Date.now() },
      timestamp: new Date().toISOString(),
    }) + "\n");

    const live = (backend as any).live.get("s1");
    live.toolNames.set("t2", "bash");
    live.lastTurnActivityAt = Date.now() - (TURN_WATCHDOG_TIMEOUT_MS + 5_000);

    await (backend as any).checkTurnWatchdogs();
    await new Promise(r => setTimeout(r, 100));
    expect(statuses).toEqual(["started"]);
    expect((backend as any).queue.isBusy("s1")).toBe(true);

    off();
    await backend.close();
  });

  it("does not settle a non-terminal tail while a compaction is in flight", async () => {
    const { backend, sessionPath } = await fixture();
    const statuses: string[] = [];
    const off = backend.subscribe(e => { if (e.channel === "stream" && e.event.type === "status") statuses.push(e.event.status); });

    await backend.handle("sendPrompt", ["s1", "__hold__"]);
    await eventually(() => statuses.includes("started"));

    await appendFile(sessionPath, JSON.stringify({
      type: "message", id: "tail-tool-result-3", parentId: null,
      message: { role: "toolResult", toolCallId: "t3", toolName: "grep", content: [{ type: "text", text: "hits" }], timestamp: Date.now() },
      timestamp: new Date().toISOString(),
    }) + "\n");

    const live = (backend as any).live.get("s1");
    expect(live.toolNames.size).toBe(0);
    // Compaction is model work that never enters toolNames; it must not be
    // mistaken for a wedged model hop.
    live.activeCompaction = { operation: "context_compaction" };
    live.lastTurnActivityAt = Date.now() - (TURN_WATCHDOG_TIMEOUT_MS + 5_000);

    await (backend as any).checkTurnWatchdogs();
    await new Promise(r => setTimeout(r, 100));
    expect(statuses).toEqual(["started"]);
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
