import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createPiHostBackend, FileQueueStore } from "../src/index.js";
import { defaultStopEscalationHooks } from "../src/stop-escalation.js";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }); root = ""; });

async function eventually(check: () => boolean | Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("condition was not met before timeout");
}

function trackSweeps(backend: any) {
  const inflight = new Set<Promise<unknown>>();
  const original = backend.sweepSessionAgents.bind(backend);
  backend.sweepSessionAgents = (sessionId: string) => {
    const work = Promise.resolve(original(sessionId));
    inflight.add(work);
    void work.finally(() => inflight.delete(work));
    return work;
  };
  return {
    async waitForIdle() {
      while (inflight.size > 0) await Promise.allSettled([...inflight]);
    },
  };
}

function isAbortLike(text: string): boolean {
  return text.includes('"type":"abort"') || text.includes("/subagent_abort_all");
}

async function fixture() {
  root = await mkdtemp(join(tmpdir(), "pipi-queue-backend-"));
  const agentDir = join(root, "agent");
  const sessionsRoot = join(root, "sessions");
  const cwd = join(root, "project");
  const directory = join(sessionsRoot, "project");
  await mkdir(agentDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await mkdir(directory, { recursive: true });
  for (const id of ["s1", "s2"]) {
    await writeFile(join(directory, `${id}.jsonl`), JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-08-10T00:00:00.000Z", cwd }) + "\n");
  }
  const create = () => createPiHostBackend({
    agentDir,
    sessionsRoot,
    runtimeRoot: root,
    piPath: process.execPath,
    spawn: (_bin, _args, options) => spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], options) as any,
  });
  return { agentDir, sessionsRoot, cwd, create };
}

describe("PiHostBackend message queue integration", () => {
  it("queues busy sends, emits snapshots, preserves attachments, and drains FIFO only after settle", async () => {
    const setup = await fixture();
    const backend = setup.create();
    const events: any[] = [];
    const off = backend.subscribe(event => { if (event.channel === "stream" && event.event.type === "queue_update") events.push(event.event); });

    expect(await backend.handle("sendPrompt", ["s1", "__hold__"])).toMatchObject({ outcome: "direct" });
    const first = await backend.handle("sendPrompt", ["s1", "first", [{ dataBase64: "aGVsbG8=", mimeType: "image/png", name: "first.png", width: 640 }]]) as any;
    const second = await backend.handle("enqueueMessage", ["s1", "second"]) as any;
    expect(first).toMatchObject({ outcome: "queued", message: { state: "queued" } });
    expect(second).toMatchObject({ outcome: "queued", message: { state: "queued" } });
    expect(await backend.handle("listQueue", ["s1"])).toEqual([
      expect.objectContaining({ id: first.message.id, text: "first", attachments: [expect.objectContaining({ width: 640, name: "first.png" })] }),
      expect.objectContaining({ id: second.message.id, text: "second" }),
    ]);

    await backend.handle("stop", ["s1"]);
    await eventually(() => events.some(event => event.queue?.length === 2));
    expect(await backend.handle("listQueue", ["s1"])).toEqual([
      expect.objectContaining({ text: "first" }),
      expect.objectContaining({ text: "second" }),
    ]);
    (backend as any).queue.markBusy("s1");
    await (backend as any).queue.notifyIdle("s1");
    await eventually(() => (backend as any).queue?.listQueue("s1").length === 0);
    off();
    const snapshots = events.map(event => event.queue.map((item: any) => item.text).join(","));
    expect(snapshots).toContain("first,second");
    expect(snapshots.some((snapshot: string) => snapshot === "second")).toBe(true); // first left before second, FIFO
    await backend.close();
  });

  it("supports edit, promote, steer, remove, failed retention, and retry through the real RPC path", async () => {
    const setup = await fixture();
    const backend = setup.create();
    await backend.handle("sendPrompt", ["s1", "__hold__"]);
    const a = await backend.handle("enqueueMessage", ["s1", "A"]) as any;
    const b = await backend.handle("enqueueMessage", ["s1", "B"]) as any;
    const edited = await backend.handle("updateQueuedMessage", ["s1", b.message.id, "B edited", [{ dataBase64: "d29ybGQ=", mimeType: "image/jpeg", name: "b.jpg" }]]) as any;
    expect(edited).toMatchObject({ text: "B edited", attachments: [expect.objectContaining({ name: "b.jpg" })] });
    await backend.handle("promoteQueuedMessage", ["s1", b.message.id]);
    expect((await backend.handle("listQueue", ["s1"]) as any[]).map(item => item.text)).toEqual(["B edited", "A"]);
    const steered = await backend.handle("steerQueuedMessage", ["s1", b.message.id]) as any;
    expect(steered.text).toBe("B edited");
    expect((await backend.handle("listQueue", ["s1"]) as any[]).map(item => item.text)).toEqual(["A"]);
    expect((await backend.handle("removeQueuedMessage", ["s1", a.message.id]) as any).text).toBe("A");

    const failed = await backend.handle("enqueueMessage", ["s1", "__queue_fail__"]) as any;
    expect(failed.outcome).toBe("queued");
    await backend.handle("stop", ["s1"]);
    (backend as any).queue.markBusy("s1");
    await (backend as any).queue.notifyIdle("s1");
    await eventually(() => ((backend as any).queue.listQueue("s1")[0]?.state) === "failed");
    const failedItem = (await backend.handle("listQueue", ["s1"]) as any[])[0];
    expect(failedItem).toMatchObject({ text: "__queue_fail__", state: "failed", error: "queue dispatch failed" });
    await backend.handle("updateQueuedMessage", ["s1", failedItem.id, "recovered"]);
    const retried = await backend.handle("retryQueuedMessage", ["s1", failedItem.id]) as any;
    expect(retried).toMatchObject({ state: "queued", error: undefined, text: "recovered" });
    await eventually(() => (backend as any).queue.listQueue("s1").length === 0);
    await backend.close();
  });

  it("persists queued/failed work per session and restores sending as queued after restart", async () => {
    const setup = await fixture();
    const first = setup.create();
    await first.handle("sendPrompt", ["s1", "__hold__"]);
    const persisted = await first.handle("enqueueMessage", ["s1", "survive restart", [{ dataBase64: "aGVsbG8=", mimeType: "image/png", name: "persist.png" }]]) as any;
    expect(persisted.outcome).toBe("queued");
    await first.close();

    const second = setup.create();
    expect(await second.handle("listQueue", ["s1"])).toMatchObject([expect.objectContaining({ id: persisted.message.id, text: "survive restart", state: "queued" })]);
    await second.close();

    const store = new FileQueueStore(join(setup.agentDir, "pipiui-queues"));
    await store.save("s2", [{ id: "sending-on-crash", sessionId: "s2", text: "recover me", attachments: [], createdAt: 1, state: "sending" }]);
    const third = setup.create();
    expect(await third.handle("listQueue", ["s2"])).toEqual([expect.objectContaining({ id: "sending-on-crash", state: "queued", text: "recover me" })]);
    await third.close();
  });

  it("keeps queue state isolated across sessions", async () => {
    const setup = await fixture();
    const backend = setup.create();
    await backend.handle("sendPrompt", ["s1", "__hold__"]);
    await backend.handle("enqueueMessage", ["s1", "blocked in s1"]);
    const s2 = await backend.handle("enqueueMessage", ["s2", "free in s2"]) as any;
    expect(s2.outcome).toBe("direct");
    await eventually(() => (backend as any).queue.listQueue("s2").length === 0);
    expect(await backend.handle("listQueue", ["s1"])).toMatchObject([expect.objectContaining({ text: "blocked in s1" })]);
    await backend.close();
  });

  it("announces a drained queue prompt on the next started so the UI does not treat it as a ghost", async () => {
    const setup = await fixture();
    const backend = setup.create();
    const events: any[] = [];
    const off = backend.subscribe(event => {
      if (event.channel === "stream" && event.event.type === "status") events.push(event.event);
    });
    expect(await backend.handle("sendPrompt", ["s1", "__hold__"])).toMatchObject({ outcome: "direct" });
    const queued = await backend.handle("enqueueMessage", ["s1", "继续"]) as any;
    expect(queued).toMatchObject({ outcome: "queued", message: { text: "继续" } });
    await backend.handle("stop", ["s1"]);
    (backend as any).queue.markBusy("s1");
    await (backend as any).queue.notifyIdle("s1");
    await eventually(() => events.some(event =>
      event.status === "started" && event.pendingFollowUps?.includes("继续"),
    ));
    off();
    expect(await backend.handle("listQueue", ["s1"])).toEqual([]);
    await backend.close();
  });

  it("does not emit status:streaming for a late pi queue_update after settle", async () => {
    const setup = await fixture();
    const backend = setup.create();
    const events: any[] = [];
    const off = backend.subscribe(event => {
      if (event.channel === "stream" && event.event.type === "status") events.push(event.event);
    });
    await backend.handle("sendPrompt", ["s1", "__late_queue_update__"]);
    await eventually(() => events.some(event => event.status === "settled"));
    off();
    const lastSettled = events.findLastIndex(event => event.status === "settled");
    expect(lastSettled).toBeGreaterThanOrEqual(0);
    expect(events.slice(lastSettled + 1).some(event => event.status === "streaming")).toBe(false);
    await backend.close();
  });

  it("streams an injected follow-up user message so the UI can show [subagent-done]", async () => {
    const setup = await fixture();
    const backend = setup.create();
    const events: any[] = [];
    const off = backend.subscribe(event => {
      if (event.channel === "stream") events.push(event.event);
    });
    await backend.handle("sendPrompt", ["s1", "__user_followup__"]);
    await eventually(() => events.some(event => event.type === "user_message"));
    off();
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "user_message",
        sessionId: "s1",
        content: "[subagent-done] agentId=a1 name=explore ok=true",
      }),
      expect.objectContaining({
        type: "status",
        sessionId: "s1",
        status: "started",
        pendingFollowUps: ["[subagent-done] agentId=a1 name=explore ok=true"],
      }),
    ]));
    await backend.close();
  });

  it("does not surface already-processing when a stale settle drains into a live turn", async () => {
    const setup = await fixture();
    const backend = setup.create();
    expect(await backend.handle("sendPrompt", ["s1", "__hold__"])).toMatchObject({ outcome: "direct" });
    const queued = await backend.handle("enqueueMessage", ["s1", "hello after settle"]) as any;
    expect(queued).toMatchObject({ outcome: "queued", message: { state: "queued" } });

    await (backend as any).queueIdle("s1");
    await eventually(() => {
      const items = (backend as any).queue.listQueue("s1");
      return items.length === 0 || items.some((item: any) => item.state === "failed");
    });

    const items = await backend.handle("listQueue", ["s1"]) as any[];
    expect(items.some(item => String(item.error ?? "").includes("already processing"))).toBe(false);
    expect(items).toEqual([]);
    await backend.close();
  });

  it("streams a hidden-display subagent completion custom_message as user_message", async () => {
    const setup = await fixture();
    const backend = setup.create();
    const events: any[] = [];
    const off = backend.subscribe(event => {
      if (event.channel === "stream") events.push(event.event);
    });
    await backend.handle("sendPrompt", ["s1", "__custom_followup__"]);
    await eventually(() => events.some(event => event.type === "user_message"));
    off();
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "user_message",
        sessionId: "s1",
        content: "[subagent-done] agentId=a1 name=explore ok=true",
      }),
      expect.objectContaining({
        type: "status",
        sessionId: "s1",
        status: "started",
        pendingFollowUps: ["[subagent-done] agentId=a1 name=explore ok=true"],
      }),
    ]));
    await backend.close();
  });

  it("emits settled when the Pi child exits mid-turn without agent_settled", async () => {
    const setup = await fixture();
    const children: ReturnType<typeof spawn>[] = [];
    const backend = createPiHostBackend({
      agentDir: setup.agentDir,
      sessionsRoot: setup.sessionsRoot,
      runtimeRoot: root,
      piPath: process.execPath,
      spawn: (_bin, _args, options) => {
        const child = spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], options);
        children.push(child);
        return child as any;
      },
    });
    const events: any[] = [];
    const off = backend.subscribe(event => {
      if (event.channel === "stream" && event.event.type === "status") events.push(event.event);
    });
    await backend.handle("sendPrompt", ["s1", "__hold__"]);
    await eventually(() => events.some(event => event.status === "started"));
    children[0].kill("SIGKILL");
    await eventually(() => events.some(event => event.status === "settled" || event.status === "stopped"));
    off();
    expect(events.some(event => event.status === "settled")).toBe(true);
    await backend.close();
  });

  it("user stop unwinds a parked cut-in when Pi never settles", async () => {
    const setup = await fixture();
    const backend = setup.create();
    const events: any[] = [];
    const off = backend.subscribe(event => {
      if (event.channel === "stream" && event.event.type === "status") events.push(event.event);
    });
    await backend.handle("sendPrompt", ["s1", "__hold_stuck__"]);
    const queued = await backend.handle("enqueueMessage", ["s1", "unstick me"]) as any;
    expect(queued.outcome).toBe("queued");
    await backend.handle("cutInQueuedMessage", ["s1", queued.message.id]);
    expect(await backend.handle("listQueue", ["s1"])).toEqual([
      expect.objectContaining({ id: queued.message.id, text: "unstick me", state: "sending" }),
    ]);
    const started = Date.now();
    await backend.handle("stop", ["s1"]);
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(events.some(event => event.status === "stopped")).toBe(true);
    expect(await backend.handle("listQueue", ["s1"])).toEqual([
      expect.objectContaining({ id: queued.message.id, text: "unstick me", state: "queued" }),
    ]);
    off();
    await backend.close();
  });

  it("user stop unwinds a hung prompt dispatch that never acks", async () => {
    const setup = await fixture();
    const backend = setup.create();
    await backend.handle("sendPrompt", ["s1", "hello"]);
    void backend.handle("enqueueMessage", ["s1", "__no_ack__"]);
    await eventually(() => {
      const items = (backend as any).queue.listQueue("s1") as Array<{ state: string; text: string }>;
      return items.some(item => item.text === "__no_ack__" && item.state === "sending");
    });
    const started = Date.now();
    await backend.handle("stop", ["s1"]);
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(await backend.handle("listQueue", ["s1"])).toEqual([
      expect.objectContaining({ text: "__no_ack__", state: "queued" }),
    ]);
    await backend.close();
  });

  it("user stop emits stopped without waiting for abort ack", async () => {
    const setup = await fixture();
    const backend = setup.create();
    const events: any[] = [];
    const off = backend.subscribe(event => {
      if (event.channel === "stream" && event.event.type === "status") events.push(event.event);
    });
    await backend.handle("sendPrompt", ["s1", "__slow_abort__"]);
    const started = Date.now();
    await backend.handle("stop", ["s1"]);
    expect(Date.now() - started).toBeLessThan(50);
    expect(events.some(event => event.status === "stopped")).toBe(true);
    off();
    await backend.close();
  });

  it("user stop emits stopped promptly and does not drain the queue", async () => {
    const setup = await fixture();
    const backend = setup.create();
    const events: any[] = [];
    const off = backend.subscribe(event => {
      if (event.channel === "stream" && event.event.type === "status") events.push(event.event);
    });
    await backend.handle("sendPrompt", ["s1", "__hold__"]);
    const queued = await backend.handle("enqueueMessage", ["s1", "stay queued"]) as any;
    expect(queued.outcome).toBe("queued");
    const started = Date.now();
    await backend.handle("stop", ["s1"]);
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(events.some(event => event.status === "stopped")).toBe(true);
    expect(await backend.handle("listQueue", ["s1"])).toEqual([
      expect.objectContaining({ id: queued.message.id, text: "stay queued", state: "queued" }),
    ]);
    off();
    await backend.close();
  });

  it("cutIn while busy aborts and dispatches only the chosen item", async () => {
    const setup = await fixture();
    const backend = setup.create();
    const sending: string[] = [];
    const off = backend.subscribe(event => {
      if (event.channel !== "stream" || event.event.type !== "queue_update") return;
      for (const item of event.event.queue ?? []) {
        if (item.state === "sending" && !sending.includes(item.text)) sending.push(item.text);
      }
    });
    await backend.handle("sendPrompt", ["s1", "__hold__"]);
    const head = await backend.handle("enqueueMessage", ["s1", "fifo-head"]) as any;
    const chosen = await backend.handle("enqueueMessage", ["s1", "cut-in-me"]) as any;
    expect(head.outcome).toBe("queued");
    await backend.handle("cutInQueuedMessage", ["s1", chosen.message.id]);
    await eventually(() => sending.includes("cut-in-me"));
    expect(sending.filter(text => text === "fifo-head" || text === "cut-in-me")[0]).toBe("cut-in-me");
    off();
    await backend.close();
  });

  it("cutIn while idle dispatches immediately", async () => {
    const setup = await fixture();
    const backend = setup.create();
    await backend.handle("sendPrompt", ["s1", "__hold__"]);
    const head = await backend.handle("enqueueMessage", ["s1", "fifo-head"]) as any;
    const chosen = await backend.handle("enqueueMessage", ["s1", "idle-cut"]) as any;
    await backend.handle("stop", ["s1"]);
    await (backend as any).queue.notifyIdle("s1");
    await backend.handle("cutInQueuedMessage", ["s1", chosen.message.id]);
    await eventually(() => {
      const items = (backend as any).queue.listQueue("s1");
      return items.length === 1 && items[0].id === head.message.id;
    });
    expect((await backend.handle("listQueue", ["s1"]) as any[]).map(item => item.text)).toEqual(["fifo-head"]);
    await backend.close();
  });

  it("rejects a second cutIn while one is pending", async () => {
    const setup = await fixture();
    const backend = createPiHostBackend({
      agentDir: setup.agentDir,
      sessionsRoot: setup.sessionsRoot,
      runtimeRoot: root,
      piPath: process.execPath,
      abortAckTimeoutMs: 20,
      spawn: (_bin, _args, options) => spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], options) as any,
    });
    await backend.handle("sendPrompt", ["s1", "__hold__"]);
    const a = await backend.handle("enqueueMessage", ["s1", "first-cut"]) as any;
    const b = await backend.handle("enqueueMessage", ["s1", "second-cut"]) as any;
    // Park first cut-in without waiting for abort settle by marking busy path only.
    (backend as any).queue.markBusy("s1");
    await (backend as any).queue.cutInMessage("s1", a.message.id);
    await expect((backend as any).queue.cutInMessage("s1", b.message.id)).rejects.toThrow(/cut-in in progress/);
    const listed = (backend as any).queue.listQueue("s1");
    expect(listed.some((item: any) => item.id === b.message.id && item.state === "queued")).toBe(true);
    await backend.close();
  });

  it("repeated settle and process-exit idle after stop do not drain", async () => {
    const setup = await fixture();
    const backend = setup.create();
    await backend.handle("sendPrompt", ["s1", "__hold__"]);
    const queued = await backend.handle("enqueueMessage", ["s1", "stay queued"]) as any;
    await backend.handle("stop", ["s1"]);
    await (backend as any).queueIdle("s1");
    await (backend as any).queueIdle("s1");
    await (backend as any).queue.notifyIdle("s1");
    expect(await backend.handle("listQueue", ["s1"])).toEqual([
      expect.objectContaining({ id: queued.message.id, text: "stay queued", state: "queued" }),
    ]);
    await backend.close();
  });

  it("stale process-exit queueIdle after a newer turn does not clear busy or drain", async () => {
    const setup = await fixture();
    const backend = setup.create();
    await backend.handle("sendPrompt", ["s1", "__hold__"]);
    const queued = await backend.handle("enqueueMessage", ["s1", "stay"]) as any;
    expect(await backend.handle("listQueue", ["s1"])).toEqual([
      expect.objectContaining({ id: queued.message.id, text: "stay", state: "queued" }),
    ]);
    const staleEpoch = (backend as any).queue.state("s1").turnEpoch;
    (backend as any).queue.markBusy("s1");
    await (backend as any).queueIdle("s1", staleEpoch);
    expect((backend as any).queue.isBusy("s1")).toBe(true);
    expect(await backend.handle("listQueue", ["s1"])).toEqual([
      expect.objectContaining({ id: queued.message.id, text: "stay", state: "queued" }),
    ]);
    await backend.close();
  });

  it("cut-in after SIGKILL waits for the old pi close before sending the next command", async () => {
    const setup = await fixture();
    const children: ReturnType<typeof spawn>[] = [];
    const writes: { pid: number | undefined; text: string }[] = [];
    const kills: { pid: number; signal: NodeJS.Signals }[] = [];
    const dyingPids = new Set<number>();
    let releaseKill: (() => void) | undefined;
    const hooks = defaultStopEscalationHooks();
    const backend = createPiHostBackend({
      agentDir: setup.agentDir,
      sessionsRoot: setup.sessionsRoot,
      runtimeRoot: root,
      piPath: process.execPath,
      abortAckTimeoutMs: 20,
      stopEscalationDelays: { termDescendantsMs: 8, killDescendantsMs: 8, killPiMs: 8 },
      stopEscalationHooks: {
        ...hooks,
        listDescendants: () => [],
        kill: (pid, signal) => {
          kills.push({ pid, signal });
          if (signal === "SIGKILL" && children[0]?.pid === pid) {
            dyingPids.add(pid);
            releaseKill = () => hooks.kill(pid, signal);
            return;
          }
          hooks.kill(pid, signal);
        },
      },
      spawn: (_bin, _args, options) => {
        const child = spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], options);
        const stdin = child.stdin as any;
        const originalWrite = stdin.write.bind(stdin);
        stdin.write = (chunk: any, encoding?: any, cb?: any) => {
          const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
          writes.push({ pid: child.pid, text });
          const isAbort = text.includes('"type":"abort"');
          const isPrompt = text.includes('"type":"prompt"');
          if (isAbort || (isPrompt && child.pid !== undefined && dyingPids.has(child.pid))) {
            if (typeof encoding === "function") encoding();
            else if (typeof cb === "function") cb();
            return true;
          }
          return originalWrite(chunk, encoding, cb);
        };
        children.push(child);
        return child as any;
      },
    });

    const sweeps = trackSweeps(backend as any);
    await backend.handle("sendPrompt", ["s1", "__hold__"]);
    const oldPid = children[0]?.pid;
    expect(oldPid).toEqual(expect.any(Number));
    const fifo = await backend.handle("enqueueMessage", ["s1", "fifo-head"]) as any;
    const chosen = await backend.handle("enqueueMessage", ["s1", "cut-in-after-kill"]) as any;
    expect(fifo.outcome).toBe("queued");

    const cutIn = backend.handle("cutInQueuedMessage", ["s1", chosen.message.id]);
    await eventually(() =>
      kills.some(item => item.pid === oldPid && item.signal === "SIGKILL")
      && (backend as any).live.get("s1")?.exiting === true,
    );

    const promptTo = (pid: number | undefined) => writes.filter(item =>
      item.pid === pid && item.text.includes('"type":"prompt"') && item.text.includes("cut-in-after-kill"));
    const sessionPid = () => (backend as any).live.get("s1")?.process?.pid as number | undefined;
    expect(promptTo(oldPid)).toEqual([]);
    expect(sessionPid()).toBe(oldPid);
    expect(children[0].exitCode).toBeNull();
    expect((await backend.handle("listQueue", ["s1"]) as any[]).some(item =>
      item.id === chosen.message.id && String(item.error ?? "").includes("SIGKILL"),
    )).toBe(false);

    expect(releaseKill).toEqual(expect.any(Function));
    releaseKill!();
    await cutIn;
    await sweeps.waitForIdle();
    await eventually(() => {
      const nextPid = sessionPid();
      return nextPid !== undefined && nextPid !== oldPid && promptTo(nextPid).length > 0;
    });
    await sweeps.waitForIdle();

    const nextPid = sessionPid();
    expect(nextPid).not.toBe(oldPid);
    expect(promptTo(oldPid)).toEqual([]);
    expect(promptTo(nextPid)).toHaveLength(1);
    expect(writes.filter(item => item.pid === nextPid && isAbortLike(item.text))).toEqual([]);
    await eventually(() => !(backend as any).queue.listQueue("s1").some((item: any) => item.id === chosen.message.id));
    const leftover = await backend.handle("listQueue", ["s1"]) as any[];
    expect(leftover.some(item => String(item.error ?? "").includes("SIGKILL"))).toBe(false);
    expect(leftover.some(item => item.id === fifo.message.id && item.state === "failed")).toBe(false);
    await backend.close();
  });

  it("stop after exiting does not spawn a replacement or abort a new pid", async () => {
    const setup = await fixture();
    const children: ReturnType<typeof spawn>[] = [];
    const writes: { pid: number | undefined; text: string }[] = [];
    const backend = createPiHostBackend({
      agentDir: setup.agentDir,
      sessionsRoot: setup.sessionsRoot,
      runtimeRoot: root,
      piPath: process.execPath,
      abortAckTimeoutMs: 20,
      spawn: (_bin, _args, options) => {
        const child = spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], options);
        const stdin = child.stdin as any;
        const originalWrite = stdin.write.bind(stdin);
        stdin.write = (chunk: any, encoding?: any, cb?: any) => {
          const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
          writes.push({ pid: child.pid, text });
          return originalWrite(chunk, encoding, cb);
        };
        children.push(child);
        return child as any;
      },
    });
    const sweeps = trackSweeps(backend as any);

    await backend.handle("sendPrompt", ["s1", "__agent_running__"]);
    const oldPid = children[0]?.pid;
    expect(oldPid).toEqual(expect.any(Number));
    await eventually(async () => {
      const agents = await backend.handle("listAgents", ["s1"]) as any[];
      return agents.some(agent => agent.agentId === "agent-1" && agent.state === "running");
    });
    const running = ((await backend.handle("listAgents", ["s1"]) as any[]).find(agent => agent.agentId === "agent-1"));
    expect(running?.state).toBe("running");

    children[0].kill("SIGKILL");
    await eventually(() => children[0].exitCode !== null || children[0].signalCode !== null);
    await eventually(() => (backend as any).live.get("s1") === undefined);
    const stored = [...(backend as any).agents.values()].find((agent: any) => agent.agentId === "agent-1");
    expect(stored).toBeTruthy();
    (backend as any).agents.set(
      (backend as any).agentKey(stored.agentId, stored.sessionId, stored.runId),
      {
        ...stored,
        state: "running",
        stalled: false,
        endedAt: undefined,
        closeout: undefined,
        updatedAt: Date.now(),
      },
    );
    expect(((await backend.handle("listAgents", ["s1"]) as any[]).find(agent => agent.agentId === "agent-1")?.state)).toBe("running");
    const spawnCount = children.length;
    expect(spawnCount).toBeGreaterThanOrEqual(1);
    const abortLikeBefore = writes.filter(item => isAbortLike(item.text)).length;

    await backend.handle("stop", ["s1"]);
    await sweeps.waitForIdle();

    expect(children).toHaveLength(spawnCount);
    expect((backend as any).live.get("s1")).toBeUndefined();
    const after = (await backend.handle("listAgents", ["s1"]) as any[]).find(agent => agent.agentId === "agent-1");
    expect(after).toMatchObject({
      agentId: "agent-1",
      state: "aborted",
      closeout: expect.stringMatching(/无主 Agent 进程/),
    });
    expect(writes.filter(item => isAbortLike(item.text))).toHaveLength(abortLikeBefore);
    expect(writes.filter(item => item.pid !== oldPid && isAbortLike(item.text))).toEqual([]);
    await backend.close();
  });
});
