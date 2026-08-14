import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createPiHostBackend, FileQueueStore } from "../src/index.js";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ""; });

async function eventually(check: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("condition was not met before timeout");
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
});
