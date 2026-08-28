import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createTurnTelemetry,
  sanitizeRendererTurnTelemetry,
  turnTelemetryBackupPath,
  turnTelemetryPath,
  type TurnTelemetryRecord,
} from "../src/turn-telemetry.js";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

function rows(text: string): TurnTelemetryRecord[] {
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as TurnTelemetryRecord);
}

async function readRows(path: string): Promise<TurnTelemetryRecord[]> {
  try {
    return rows(await readFile(path, "utf8"));
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function finishPerformanceTurn(
  telemetry: ReturnType<typeof createTurnTelemetry>,
  sessionId: string,
  clock: { value: number },
  outputTokens = 20,
): void {
  telemetry.beginDispatch(sessionId, undefined);
  telemetry.dispatchStarted(sessionId);
  clock.value += 1;
  telemetry.observeRpc(sessionId, {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "token" },
  });
  clock.value += 1;
  telemetry.observeRpc(sessionId, {
    type: "message_end",
    message: { role: "assistant", usage: { input: 10, output: outputTokens } },
  });
  telemetry.terminal(sessionId, "settled");
  telemetry.flushTerminal(sessionId);
}

describe("turn telemetry", () => {
  it("traces direct and queued turns with one safe id each and ordered observable phases", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-turn-telemetry-"));
    let now = 10;
    let resources = 0;
    const telemetry = createTurnTelemetry({
      agentDir: root,
      now: () => now,
      resourceSample: () => ({ rssBytes: 1_000 + ++resources, childCount: 1 }),
    });

    const complete = (turnId: string, queued: boolean) => {
      const sample = telemetry.rendererSubmission("session-1", {
        turnId,
        submittedAt: 1,
        preflightStartedAt: 2,
        preflightEndedAt: 5,
        promptBytes: 17,
        attachmentCount: 1,
        attachmentBytes: 3,
        documentCount: 1,
        prompt: "very sensitive prompt body",
      });
      expect(sample?.turnId).toBe(turnId);
      if (queued) {
        now = 20;
        telemetry.markQueued(sample);
      }
      now = queued ? 30 : 20;
      telemetry.beginDispatch("session-1", sample);
      now += 2;
      telemetry.preparationComplete("session-1", 123);
      now += 2;
      telemetry.dispatchStarted("session-1");
      now += 1;
      telemetry.dispatchAccepted("session-1");
      now += 1;
      telemetry.observeRpc("session-1", { type: "agent_start" });
      now += 2;
      telemetry.observeRpc("session-1", {
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta", delta: "private reasoning body" },
      });
      now += 3;
      telemetry.observeRpc("session-1", {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "first visible token" },
      });
      now += 1;
      telemetry.observeRpc("session-1", {
        type: "tool_execution_start",
        toolCallId: "tool-a",
        toolName: "read",
        args: { path: "/private/document/path" },
      });
      now += 1;
      telemetry.observeRpc("session-1", {
        type: "tool_execution_end",
        toolCallId: "tool-a",
        result: { content: "tool result secret body" },
        isError: false,
      });
      now += 4;
      telemetry.observeRpc("session-1", {
        type: "message_end",
        message: {
          role: "assistant",
          content: "final assistant body",
          usage: { input: 120, output: 20 },
        },
      });
      now += 1;
      telemetry.observeSessionStats("session-1", { contextTokens: 4_096, contextWindow: 32_768 });
      telemetry.terminal("session-1", "settled");
      telemetry.flushTerminal("session-1");
    };

    complete("direct-turn", false);
    complete("queued-turn", true);
    await telemetry.pending();

    const stored = await readRows(turnTelemetryPath(root));
    expect(stored.map((row) => row.turnId)).toEqual(["direct-turn", "queued-turn"]);
    for (const row of stored) {
      const times = row.phases.map((phase) => phase.at);
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(row.phases.map((phase) => phase.name)).toEqual(expect.arrayContaining([
        "renderer_submit", "renderer_preflight_start", "renderer_preflight_end",
        "host_received", "host_preparation_start", "host_preparation_end",
        "pi_dispatch", "first_stream", "first_thinking", "first_text",
        "first_assistant", "tool_activity", "settled",
      ]));
      expect(row.metrics).toMatchObject({
        promptBytes: 17,
        attachmentCount: 1,
        attachmentBytes: 3,
        documentCount: 1,
        piRpcBytes: 123,
        assistantMessageCount: 1,
        toolResultCount: 1,
        inputTokens: 120,
        outputTokens: 20,
        contextTokens: 4_096,
        contextWindow: 32_768,
      });
      expect(row.durations?.rendererPreflightMs).toBe(3);
      expect(row.durations?.ttftMs).toBeGreaterThan(0);
      expect(row.performance?.tokensPerSecond).toBeGreaterThan(0);
      expect(row.resources?.start?.rssBytes).toEqual(expect.any(Number));
      expect(row.resources?.end?.childCount).toBe(1);
    }
    expect(stored[0]!.phases.some((phase) => phase.name === "host_queued")).toBe(false);
    expect(stored[1]!.phases.map((phase) => phase.name)).toContain("host_queued");
    expect(stored[1]!.durations?.hostQueueMs).toBeGreaterThan(0);
    expect(telemetry.sessionPerformance("session-1")).toMatchObject({
      ttftMs: expect.any(Number),
      tokensPerSecond: expect.any(Number),
      sampleCount: 2,
    });

    const raw = await readFile(turnTelemetryPath(root), "utf8");
    expect(raw).not.toMatch(/very sensitive prompt body|private reasoning body|tool result secret body|private\/document\/path/);
  });

  it("omits unavailable samples instead of filling zeros or inferred performance", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-turn-telemetry-missing-"));
    let now = 1;
    const telemetry = createTurnTelemetry({ agentDir: root, now: () => now });
    telemetry.beginDispatch("no-evidence", undefined);
    now += 1;
    telemetry.preparationComplete("no-evidence", 10);
    now += 1;
    telemetry.dispatchStarted("no-evidence");
    now += 1;
    telemetry.terminal("no-evidence", "stopped");
    telemetry.flushTerminal("no-evidence");
    await telemetry.pending();

    const [record] = await readRows(turnTelemetryPath(root));
    expect(record!.outcome).toBe("stopped");
    expect(record!.durations).not.toHaveProperty("ttftMs");
    expect(record!.durations).not.toHaveProperty("generationMs");
    expect(record!.metrics).not.toHaveProperty("inputTokens");
    expect(record!.metrics).not.toHaveProperty("contextTokens");
    expect(record!.performance).toBeUndefined();
    expect(telemetry.sessionPerformance("no-evidence")).toBeUndefined();
  });

  it("projects a real TTFT-only sample without inventing a token rate", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-turn-telemetry-ttft-only-"));
    const clock = { value: 10 };
    const telemetry = createTurnTelemetry({ agentDir: root, now: () => clock.value });
    finishPerformanceTurn(telemetry, "ttft-only", clock, 0);
    await telemetry.pending();

    const [record] = await readRows(turnTelemetryPath(root));
    expect(record!.performance).toMatchObject({ ttftMs: 1 });
    expect(record!.performance).not.toHaveProperty("tokensPerSecond");
    expect(telemetry.sessionPerformance("ttft-only")).toEqual({ ttftMs: 1, sampleCount: 1 });
  });

  it("evicts the oldest inactive session aggregate at the global cap", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-turn-telemetry-eviction-"));
    const clock = { value: 10 };
    const telemetry = createTurnTelemetry({
      agentDir: root,
      now: () => clock.value,
      maxPerformanceSessions: 2,
    });
    finishPerformanceTurn(telemetry, "old", clock);
    finishPerformanceTurn(telemetry, "middle", clock);
    finishPerformanceTurn(telemetry, "new", clock);

    expect(telemetry.sessionPerformance("old")).toBeUndefined();
    expect(telemetry.sessionPerformance("middle")).toMatchObject({ sampleCount: 1 });
    expect(telemetry.sessionPerformance("new")).toMatchObject({ sampleCount: 1 });
    await telemetry.pending();
  });

  it("protects a session with an in-flight turn from global eviction", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-turn-telemetry-active-"));
    const clock = { value: 10 };
    const telemetry = createTurnTelemetry({
      agentDir: root,
      now: () => clock.value,
      maxPerformanceSessions: 2,
    });
    finishPerformanceTurn(telemetry, "protected", clock);
    finishPerformanceTurn(telemetry, "evicted", clock);
    telemetry.beginDispatch("protected", undefined);
    finishPerformanceTurn(telemetry, "new", clock);
    finishPerformanceTurn(telemetry, "newest", clock);

    expect(telemetry.sessionPerformance("protected")).toMatchObject({ sampleCount: 1 });
    expect(telemetry.sessionPerformance("new")).toBeUndefined();
    expect(telemetry.sessionPerformance("newest")).toMatchObject({ sampleCount: 1 });
    telemetry.terminal("protected", "stopped");
    telemetry.flushTerminal("protected");
    await telemetry.pending();
  });

  it("bounds retained records by rotating the current telemetry file", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-turn-telemetry-retention-"));
    let now = 1;
    const telemetry = createTurnTelemetry({ agentDir: root, now: () => now, maxBytes: 1 });
    for (const id of ["one", "two", "three"]) {
      telemetry.beginDispatch("retention", undefined);
      now += 1;
      telemetry.preparationComplete("retention", 1);
      now += 1;
      telemetry.dispatchStarted("retention");
      now += 1;
      telemetry.terminal("retention", "settled");
      telemetry.flushTerminal("retention");
      now += 1;
      await telemetry.pending();
    }
    const retained = [
      ...(await readRows(turnTelemetryPath(root))),
      ...(await readRows(turnTelemetryBackupPath(root))),
    ];
    expect(retained).toHaveLength(2);
  });

  it("fences an in-flight turn without fabricating TTFT/TPS and ignores late events", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-turn-telemetry-fence-"));
    let now = 10;
    const telemetry = createTurnTelemetry({ agentDir: root, now: () => now });
    telemetry.beginDispatch("s1", undefined);
    now += 5;
    expect(telemetry.hasActive("s1")).toBe(true);
    telemetry.fenceSession("s1");
    await telemetry.pending();

    expect(telemetry.hasActive("s1")).toBe(false);
    expect(telemetry.sessionPerformance("s1")).toBeUndefined();
    expect(telemetry.retainedState()).toMatchObject({ active: 0, fenced: 1, performance: 0 });
    const [record] = await readRows(turnTelemetryPath(root));
    expect(record!.outcome).toBe("stopped");
    expect(record!.performance).toBeUndefined();
    expect(record!.durations).not.toHaveProperty("ttftMs");
    expect(record!.durations).not.toHaveProperty("tokensPerSecond");

    telemetry.beginDispatch("s1", undefined);
    telemetry.observeRpc("s1", {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "late" },
    });
    telemetry.terminal("s1", "settled");
    telemetry.flushTerminal("s1");
    await telemetry.pending();
    expect(telemetry.hasActive("s1")).toBe(false);
    expect(telemetry.sessionPerformance("s1")).toBeUndefined();
    expect(await readRows(turnTelemetryPath(root))).toHaveLength(1);

    telemetry.reclaimSession("s1");
    expect(telemetry.retainedState().fenced).toBe(0);
    telemetry.beginDispatch("s1", undefined);
    expect(telemetry.hasActive("s1")).toBe(true);
    telemetry.terminal("s1", "stopped");
    telemetry.flushTerminal("s1");
    await telemetry.pending();
  });

  it("rejects malformed renderer input rather than using it as a payload channel", () => {
    expect(sanitizeRendererTurnTelemetry({
      turnId: "../../not-a-turn",
      submittedAt: 1,
      prompt: "secret",
    })).toBeUndefined();
    expect(sanitizeRendererTurnTelemetry({
      turnId: "safe-turn",
      submittedAt: 10,
      preflightStartedAt: 9,
      preflightEndedAt: 11,
      headers: { authorization: "secret" },
    })).toEqual({ turnId: "safe-turn", submittedAt: 10 });
  });
});
