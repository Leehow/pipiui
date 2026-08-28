import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { createPiHostBackend } from "../src/index.js";
import { turnTelemetryPath, type TurnTelemetryRecord } from "../src/turn-telemetry.js";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

async function eventually(check: () => boolean | Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("condition was not met before timeout");
}

function rendererSample(turnId: string, promptBytes = 14) {
  const submittedAt = Date.now() - 5;
  return {
    turnId,
    submittedAt,
    preflightStartedAt: submittedAt + 1,
    preflightEndedAt: submittedAt + 2,
    promptBytes,
    attachmentCount: 0,
    attachmentBytes: 0,
    documentCount: 0,
    prompt: "must never be retained",
  };
}

async function telemetryRows(agentDir: string): Promise<TurnTelemetryRecord[]> {
  try {
    return (await readFile(turnTelemetryPath(agentDir), "utf8"))
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line) as TurnTelemetryRecord);
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function fixture() {
  root = await mkdtemp(join(tmpdir(), "pipi-turn-telemetry-backend-"));
  const agentDir = join(root, "agent");
  const sessions = join(root, "sessions");
  const project = join(root, "project");
  const sessionDir = join(sessions, "project");
  await Promise.all([mkdir(agentDir, { recursive: true }), mkdir(project, { recursive: true }), mkdir(sessionDir, { recursive: true })]);
  await writeFile(join(sessionDir, "s1.jsonl"), JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-08-10T00:00:00.000Z", cwd: project }) + "\n");
  const backend = createPiHostBackend({
    agentDir,
    sessionsRoot: sessions,
    runtimeRoot: root,
    piPath: process.execPath,
    env: { PATH: process.env.PATH ?? "" },
    spawn: (_bin, _args, options) => spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], options) as any,
    authRuntime: { getProviders: async () => [], getAvailable: async () => [], login: async () => undefined, logout: async () => undefined },
  });
  return { agentDir, backend };
}

describe("PiHostBackend turn telemetry wiring", () => {
  it("keeps direct and queued turns correlated through preparation, stream, and settle", async () => {
    const { agentDir, backend } = await fixture();
    const direct = rendererSample("direct-turn");
    await backend.handle("sendPrompt", ["s1", "__telemetry__", undefined, direct]);
    await eventually(async () => (await telemetryRows(agentDir)).some(row => row.turnId === "direct-turn"));

    // Hold an active turn so the next user submission uses the same queue path
    // production uses, then explicitly cut it in after Stop releases the hold.
    await backend.handle("sendPrompt", ["s1", "__hold__"]);
    const queued = await backend.handle("enqueueMessage", ["s1", "__telemetry__", undefined, rendererSample("queued-turn")]) as any;
    expect(queued).toMatchObject({ outcome: "queued", message: { state: "queued" } });
    expect(await backend.handle("listQueue", ["s1"])).toEqual([
      expect.not.objectContaining({ turnTelemetry: expect.anything() }),
    ]);
    await backend.handle("stop", ["s1"]);
    await eventually(() => (backend as any).queue.isBusy("s1") === false);
    await backend.handle("cutInQueuedMessage", ["s1", queued.message.id]);
    await eventually(async () => (await telemetryRows(agentDir)).some(row => row.turnId === "queued-turn"));

    const records = await telemetryRows(agentDir);
    const directRecord = records.find(row => row.turnId === "direct-turn")!;
    const queuedRecord = records.find(row => row.turnId === "queued-turn")!;
    for (const record of [directRecord, queuedRecord]) {
      expect(record).toBeDefined();
      const phases = record.phases.map(phase => phase.name);
      expect(phases).toEqual(expect.arrayContaining([
        "renderer_submit", "renderer_preflight_start", "renderer_preflight_end",
        "host_received", "host_preparation_start", "host_preparation_end",
        "pi_dispatch", "first_stream", "first_thinking", "first_text",
        "first_assistant", "tool_activity", "settled",
      ]));
      const times = record.phases.map(phase => phase.at);
      expect(times).toEqual([...times].sort((left, right) => left - right));
      expect(record.metrics).toMatchObject({
        promptBytes: 14,
        piRpcBytes: expect.any(Number),
        assistantMessageCount: 1,
        toolResultCount: 1,
        inputTokens: 120,
        outputTokens: 20,
        contextTokens: 15_000,
      });
      expect(record.performance).toMatchObject({ ttftMs: expect.any(Number), tokensPerSecond: expect.any(Number) });
    }
    expect(directRecord.phases.map(phase => phase.name)).not.toContain("host_queued");
    expect(queuedRecord.phases.map(phase => phase.name)).toContain("host_queued");
    expect(queuedRecord.durations?.hostQueueMs).toEqual(expect.any(Number));

    const stats = await backend.handle("getSessionStats", ["s1"]) as any;
    expect(stats.performance).toMatchObject({
      ttftMs: expect.any(Number),
      tokensPerSecond: expect.any(Number),
      // The held turn has real TTFT but no output usage, so it contributes a
      // third partial performance sample without changing the TPS average.
      sampleCount: 3,
    });
    const raw = await readFile(turnTelemetryPath(agentDir), "utf8");
    expect(raw).not.toMatch(/must never be retained|private reasoning body|private\/document\/path|tool result secret body/);
    await backend.close();
  });

  it("projects TTFT-only SessionPerformance when Pi omits output usage", async () => {
    const { agentDir, backend } = await fixture();
    await backend.handle("sendPrompt", ["s1", "hello", undefined, rendererSample("no-performance")]);
    await eventually(async () => (await telemetryRows(agentDir)).some(row => row.turnId === "no-performance"));
    const [record] = (await telemetryRows(agentDir)).filter(row => row.turnId === "no-performance");
    expect(record!.performance?.ttftMs).toEqual(expect.any(Number));
    expect(record!.performance).not.toHaveProperty("tokensPerSecond");
    const stats = await backend.handle("getSessionStats", ["s1"]) as any;
    expect(stats.performance).toMatchObject({ ttftMs: expect.any(Number), sampleCount: 1 });
    expect(stats.performance).not.toHaveProperty("tokensPerSecond");
    await backend.close();
  });

  it("strips turnTelemetry from every public queue mutation while dispatching a fresh edited sample", async () => {
    const { agentDir, backend } = await fixture();
    const queueUpdates: any[] = [];
    const off = backend.subscribe(event => {
      if (event.channel === "stream" && event.event.type === "queue_update") queueUpdates.push(event.event);
    });
    const expectPublicMessage = (value: any) => {
      const message = value && Object.prototype.hasOwnProperty.call(value, "message") ? value.message : value;
      expect(message).not.toHaveProperty("turnTelemetry");
    };

    const direct = await backend.handle("sendPrompt", ["s1", "__hold__", undefined, rendererSample("hold")]) as any;
    expectPublicMessage(direct);
    const original = await backend.handle("enqueueMessage", ["s1", "original", undefined, rendererSample("old-edit", 8)]) as any;
    expectPublicMessage(original);
    const promotedItem = await backend.handle("enqueueMessage", ["s1", "promote me", undefined, rendererSample("promote")]) as any;
    expectPublicMessage(promotedItem);
    const steeredItem = await backend.handle("enqueueMessage", ["s1", "__steer_echo__ steer me", undefined, rendererSample("steer")]) as any;
    expectPublicMessage(steeredItem);
    const removableItem = await backend.handle("enqueueMessage", ["s1", "remove me", undefined, rendererSample("remove")]) as any;
    expectPublicMessage(removableItem);

    const fresh = rendererSample("fresh-edit", 77);
    const updated = await backend.handle("updateQueuedMessage", [
      "s1",
      original.message.id,
      "edited",
      undefined,
      fresh,
    ]) as any;
    expectPublicMessage(updated);
    expect(updated).toMatchObject({ id: original.message.id, text: "edited", state: "queued" });

    const promoted = await backend.handle("promoteQueuedMessage", ["s1", promotedItem.message.id]) as any;
    expectPublicMessage(promoted);
    const removedPromoted = await backend.handle("removeQueuedMessage", ["s1", promotedItem.message.id]) as any;
    expectPublicMessage(removedPromoted);
    const steered = await backend.handle("steerQueuedMessage", ["s1", steeredItem.message.id]) as any;
    expectPublicMessage(steered);
    const removed = await backend.handle("removeQueuedMessage", ["s1", removableItem.message.id]) as any;
    expectPublicMessage(removed);
    expect(await backend.handle("listQueue", ["s1"])).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: original.message.id, text: "edited" }),
    ]));

    await backend.handle("stop", ["s1"]);
    await eventually(() => (backend as any).queue.isBusy("s1") === false);
    const cutIn = await backend.handle("cutInQueuedMessage", ["s1", original.message.id]) as any;
    expectPublicMessage(cutIn);
    await eventually(async () => (await telemetryRows(agentDir)).some(row => row.turnId === "fresh-edit"));
    const freshRecord = (await telemetryRows(agentDir)).find(row => row.turnId === "fresh-edit");
    expect(freshRecord?.metrics).toMatchObject({ promptBytes: 77 });
    expect((await telemetryRows(agentDir)).some(row => row.turnId === "old-edit")).toBe(false);

    await eventually(() => (backend as any).queue.isBusy("s1") === false);
    const failed = await backend.handle("enqueueMessage", ["s1", "__queue_fail__", undefined, rendererSample("retry")]) as any;
    expectPublicMessage(failed);
    await eventually(() => (backend as any).queue.listQueue("s1").some((item: any) => item.id === failed.message.id && item.state === "failed"));
    const retried = await backend.handle("retryQueuedMessage", ["s1", failed.message.id]) as any;
    expectPublicMessage(retried);
    await eventually(() => (backend as any).queue.listQueue("s1").some((item: any) => item.id === failed.message.id && item.state === "failed"));

    off();
    expect(queueUpdates.length).toBeGreaterThan(0);
    expect(queueUpdates.every(event => event.queue.every((item: any) => !Object.prototype.hasOwnProperty.call(item, "turnTelemetry")))).toBe(true);
    expect((await backend.handle("listQueue", ["s1"])).every((item: any) => !Object.prototype.hasOwnProperty.call(item, "turnTelemetry"))).toBe(true);
    await backend.close();
  });
});
