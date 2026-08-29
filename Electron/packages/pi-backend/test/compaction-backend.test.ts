import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createPiHostBackend } from "../src/index.js";

/**
 * End-to-end context compaction against the fake pi: the `compact` host method,
 * the compaction stream events pi's own lifecycle produces, and the idle-time
 * scheduler that fires when the session parks above the high watermark.
 */

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

async function fixture(compaction?: {
  quietDelayMs?: number;
  waitWatermark?: number;
  waitQuietDelayMs?: number;
}, proactiveSummaryCompaction = true) {
  root = await mkdtemp(join(tmpdir(), "pipi-compact-"));
  const cwd = join(root, "project");
  const dir = join(root, "sessions", "project");
  await mkdir(dir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await writeFile(
    join(dir, "session.jsonl"),
    JSON.stringify({ type: "session", version: 3, id: "session-1", timestamp: "2026-08-10T00:00:00.000Z", cwd }) + "\n",
  );
  const backend = createPiHostBackend({
    agentDir: join(root, "agent"),
    sessionsRoot: join(root, "sessions"),
    runtimeRoot: join(root, "runtime"),
    piPath: "node",
    compaction: {
      highWatermark: 0.8,
      lowWatermark: 0.6,
      // Keep the quiet period short; the watermark logic is unit-tested separately.
      quietDelayMs: compaction?.quietDelayMs ?? 20,
      failureBackoffMs: 60_000,
      waitWatermark: compaction?.waitWatermark,
      waitQuietDelayMs: compaction?.waitQuietDelayMs,
    },
    // Production default is false (Headroom/context-fold try first). The
    // scheduler still falls back to a host compact when usage stays high.
    proactiveSummaryCompaction,
    spawn: (_bin, _args, options) =>
      spawn("/usr/local/bin/node", [new URL("./fake-pi.mjs", import.meta.url).pathname], {
        ...options,
        env: { ...options.env, PATH: "/usr/local/bin:/usr/bin:/bin" },
      }) as any,
  });
  await backend.handle("addProject", [cwd]);
  return backend;
}

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
/** Polls a condition; the fake pi's lifecycle is event-driven, not clock-driven. */
async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await settle(10);
  }
}
const compactionEvents = (events: any[]) =>
  events.filter((e) => e.channel === "stream" && e.event.type === "compaction").map((e) => e.event);

/** The classified start/end pair the host now emits for a real compaction. */
function classifiedLifecycle(sessionId: string, reason: string, trigger: string) {
  return [
    { type: "compaction", sessionId, phase: "start", reason, operation: "context_compaction", trigger, executed: true },
    { type: "compaction", sessionId, phase: "end", reason, aborted: undefined, error: undefined, operation: "context_compaction", trigger, executed: true },
  ];
}

describe("context compaction", () => {
  it("runs `compact` on demand and reports the lifecycle as stream events", async () => {
    const backend = await fixture();
    await backend.handle("sendPrompt", ["session-1", "go"]);
    await settle();
    const events: any[] = [];
    const off = backend.subscribe((e) => events.push(e));

    await backend.handle("compact", ["session-1"]);
    await settle();
    off();

    expect(compactionEvents(events)).toEqual(classifiedLifecycle("session-1", "manual", "manual"));
    // The post-compaction snapshot is what drops the stale context number.
    expect(events.some((e) => e.channel === "session_stats" && e.event.stats.contextUsage?.tokens === 12000)).toBe(true);
    await backend.close();
  });

  it("surfaces a refused compact as a rejection, with no lifecycle events", async () => {
    const backend = await fixture();
    await backend.handle("sendPrompt", ["session-1", "fill-context-no-compact"]);
    await settle();
    const events: any[] = [];
    const off = backend.subscribe((e) => events.push(e));

    await expect(backend.handle("compact", ["session-1"])).rejects.toThrow(/Nothing to compact/);
    off();
    expect(compactionEvents(events)).toEqual([]);
    await backend.close();
  });

  it("clears the proactive intent when the scheduler's compact RPC fails, so a later host-uninitiated manual compaction stays manual", async () => {
    const backend = await fixture();
    const events: any[] = [];
    const off = backend.subscribe((e) => events.push(e));

    // 92% context + failCompact: the scheduler's compact RPC is refused with
    // no lifecycle, so its `proactive_idle` intent must be released — a stale
    // intent would paint the next reason:"manual" lifecycle as proactive idle.
    await backend.handle("sendPrompt", ["session-1", "fill-context-no-compact"]);
    await settle(200);
    expect(compactionEvents(events)).toEqual([]);

    // A pi-side reason:"manual" compaction that no host RPC initiated (an
    // extension calling session.compact()): with the slot clean it must
    // classify manual; with the failed RPC's residue it would read proactive_idle.
    await backend.handle("sendPrompt", ["session-1", "__pi_self_compact__"]);
    await waitFor(() => compactionEvents(events).length >= 2);
    await settle();
    off();

    expect(compactionEvents(events)).toEqual(classifiedLifecycle("session-1", "manual", "manual"));
    await backend.close();
  });

  it("clears the manual intent when its compact RPC fails, and a later scheduler compaction still attributes correctly", async () => {
    const backend = await fixture();
    const events: any[] = [];
    const off = backend.subscribe((e) => events.push(e));

    // A refused manual compact with context low: the scheduler stays quiet, so
    // only the manual intent exists — and must be released on rejection.
    await backend.handle("sendPrompt", ["session-1", "__fail_compact_once__"]);
    await settle();
    await expect(backend.handle("compact", ["session-1"])).rejects.toThrow(/Nothing to compact/);
    expect(compactionEvents(events)).toEqual([]);

    // Re-arm compaction and park high again: the scheduler's own successful
    // compaction must still attribute proactive_idle (success path no-regress).
    await backend.handle("sendPrompt", ["session-1", "__allow_compact__"]);
    await waitFor(() => compactionEvents(events).length >= 2);
    await settle();
    off();

    expect(compactionEvents(events)).toEqual(classifiedLifecycle("session-1", "manual", "proactive_idle"));
    await backend.close();
  });

  it("compacts on its own once an idle session parks above the high watermark", async () => {
    const backend = await fixture();
    const events: any[] = [];
    const off = backend.subscribe((e) => events.push(e));

    // 240000/262144 ≈ 92%: pi's own threshold check only runs on the next turn,
    // which is exactly the gap this scheduler closes.
    await backend.handle("sendPrompt", ["session-1", "fill-context"]);
    await waitFor(() => compactionEvents(events).length >= 2);
    off();

    expect(compactionEvents(events).map((e) => e.phase)).toEqual(["start", "end"]);
    // The scheduler issued the compact RPC, so reason "manual" is classified as
    // proactive idle — not 手动.
    expect(compactionEvents(events).map((e: any) => e.trigger)).toEqual(["proactive_idle", "proactive_idle"]);
    expect(compactionEvents(events).every((e: any) => e.operation === "context_compaction" && e.executed === true)).toBe(true);
    expect((await backend.handle("getSessionStats", ["session-1"])) as any).toMatchObject({
      contextUsage: { tokens: 12000 },
    });
    await backend.close();
  });

  it("production default falls back to host summary compaction when lossless rewrite leaves usage high", async () => {
    const backend = await fixture(undefined, false);
    const events: any[] = [];
    const off = backend.subscribe((e) => events.push(e));

    await backend.handle("sendPrompt", ["session-1", "fill-context"]);
    await waitFor(() => compactionEvents(events).length >= 2);
    off();

    expect(compactionEvents(events).map((e) => e.phase)).toEqual(["start", "end"]);
    expect(compactionEvents(events).map((e: any) => e.trigger)).toEqual(["proactive_idle", "proactive_idle"]);
    expect((await backend.handle("getSessionStats", ["session-1"])) as any).toMatchObject({
      contextUsage: { tokens: 12000 },
    });
    await backend.close();
  });

  it("classifies pi's own overflow recovery as overflow", async () => {
    const backend = await fixture();
    const events: any[] = [];
    const off = backend.subscribe((e) => events.push(e));

    await backend.handle("sendPrompt", ["session-1", "__overflow_compact__"]);
    await waitFor(() => compactionEvents(events).length >= 2);
    off();

    expect(compactionEvents(events).map((e: any) => e.trigger)).toEqual(["overflow", "overflow"]);
    await backend.close();
  });

  it("classifies a mid-turn threshold compaction as mid_turn, not near-overflow", async () => {
    const backend = await fixture();
    const events: any[] = [];
    const off = backend.subscribe((e) => events.push(e));

    await backend.handle("sendPrompt", ["session-1", "__midturn_compact__"]);
    await waitFor(() => compactionEvents(events).length >= 2);
    off();

    expect(compactionEvents(events).map((e: any) => e.trigger)).toEqual(["mid_turn", "mid_turn"]);
    await backend.close();
  });

  it("classifies an idle (pre-prompt) threshold compaction as near_overflow", async () => {
    const backend = await fixture();
    const events: any[] = [];
    const off = backend.subscribe((e) => events.push(e));

    await backend.handle("sendPrompt", ["session-1", "__threshold_preprompt__"]);
    await waitFor(() => compactionEvents(events).length >= 2);
    off();

    expect(compactionEvents(events).map((e: any) => e.trigger)).toEqual(["near_overflow", "near_overflow"]);
    await backend.close();
  });

  it("surfaces a deterministic context_manage fold as context_fold, never as a compaction lifecycle", async () => {
    const backend = await fixture();
    const events: any[] = [];
    const off = backend.subscribe((e) => events.push(e));

    await backend.handle("sendPrompt", ["session-1", "__fold_tool__"]);
    await waitFor(() => compactionEvents(events).length >= 1);
    await settle();
    off();

    expect(compactionEvents(events)).toEqual([
      { type: "compaction", sessionId: "session-1", phase: "end", reason: undefined, aborted: undefined, error: undefined, operation: "context_fold", trigger: "idle_fold", executed: true },
    ]);
    await backend.close();
  });

  it("does not surface a fold-shaped result from a tool that is not context_manage", async () => {
    const backend = await fixture();
    const events: any[] = [];
    const off = backend.subscribe((e) => events.push(e));

    // Same details fingerprint, but the paired tool_execution_start names bash:
    // the result shape alone must never read as a fold.
    await backend.handle("sendPrompt", ["session-1", "__fold_other_tool__"]);
    await settle(200);
    off();

    expect(compactionEvents(events)).toEqual([]);
    await backend.close();
  });

  it("does not claim a fold from a result with no tool_execution_start pairing", async () => {
    const backend = await fixture();
    const events: any[] = [];
    const off = backend.subscribe((e) => events.push(e));

    // A fold-fingerprinted tool_execution_end whose toolCallId was never
    // announced: the tool identity is unknown, so no fold may be claimed.
    await backend.handle("sendPrompt", ["session-1", "__fold_unpaired_end__"]);
    await settle(200);
    off();

    expect(compactionEvents(events)).toEqual([]);
    await backend.close();
  });

  it("classifies a non-nudge context_manage fold as auto_fold, never as idle", async () => {
    const backend = await fixture();
    const events: any[] = [];
    const off = backend.subscribe((e) => events.push(e));

    // context_manage folding inside a normal turn — the agent tidying context
    // on its own — must not borrow the idle scheduler's label.
    await backend.handle("sendPrompt", ["session-1", "__fold_tool_no_nudge__"]);
    await waitFor(() => compactionEvents(events).length >= 1);
    await settle();
    off();

    expect(compactionEvents(events)).toEqual([
      { type: "compaction", sessionId: "session-1", phase: "end", reason: undefined, aborted: undefined, error: undefined, operation: "context_fold", trigger: "auto_fold", executed: true },
    ]);
    await backend.close();
  });

  it("leaves a session below the watermark alone", async () => {
    const backend = await fixture();
    const events: any[] = [];
    const off = backend.subscribe((e) => events.push(e));

    await backend.handle("sendPrompt", ["session-1", "go"]);
    await settle(200);
    off();

    expect(compactionEvents(events)).toEqual([]);
    await backend.close();
  });

  it("uses exact live-agent host state to compact a quiet waiting Boss below the ordinary watermark", async () => {
    // `__agent_running__` parks at 200000/262144 ≈ 76%: above the 200k floor
    // and the injected wait watermark, but below this suite's 80% ordinary
    // high watermark. Lower only the wait watermark so the test exercises
    // host live-agent wiring; unit tests own the real 45%/4-minute values.
    const backend = await fixture({ waitWatermark: 0.05, waitQuietDelayMs: 20 });
    const events: any[] = [];
    const off = backend.subscribe((e) => events.push(e));

    await backend.handle("sendPrompt", ["session-1", "__agent_running__"]);
    await waitFor(() => compactionEvents(events).length >= 2);
    off();

    expect(compactionEvents(events).map((e) => e.phase)).toEqual(["start", "end"]);
    await backend.close();
  });

  it("cancels a pending wait compact when the last live agent becomes terminal", async () => {
    const backend = await fixture({ waitWatermark: 0.05, waitQuietDelayMs: 150 });
    const events: any[] = [];
    const off = backend.subscribe((e) => events.push(e));

    await backend.handle("sendPrompt", ["session-1", "__agent_running__"]);
    // Force a fresh eligible sample while the exact durable projection is live.
    await backend.handle("getSessionStats", ["session-1"]);
    await backend.handle("sendPrompt", ["session-1", "/subagent_abort_all"]);
    await settle(250);
    off();

    expect(compactionEvents(events)).toEqual([]);
    await backend.close();
  });

  it("holds a prompt sent during an idle-time compaction instead of racing pi", async () => {
    const backend = await fixture();
    const events: any[] = [];
    const off = backend.subscribe((e) => events.push(e));

    await backend.handle("sendPrompt", ["session-1", "fill-context-slow"]);
    // Wait for the scheduler's compact to be under way but not yet finished.
    await waitFor(() => compactionEvents(events).some((e) => e.phase === "start"));
    expect(compactionEvents(events).some((e) => e.phase === "end")).toBe(false);

    const result = (await backend.handle("enqueueMessage", ["session-1", "during"])) as any;
    expect(result.outcome).toBe("queued");
    expect(result.message.state).toBe("queued");
    expect(result.message.error).toBeUndefined();

    // A mid-compact drain must not surface Pi's compaction rejection as 发送失败.
    await settle(30);
    const mid = (await backend.handle("listQueue", ["session-1"])) as any[];
    expect(mid.every((item) => item.state !== "failed")).toBe(true);
    expect(mid.some((item) => item.text === "during" && item.state === "queued")).toBe(true);
    expect(compactionEvents(events).some((e) => e.phase === "end")).toBe(false);

    // Releasing the hold drains the queue: the held prompt reaches pi afterwards.
    await waitFor(() => compactionEvents(events).some((e) => e.phase === "end"));
    await waitFor(async () => ((await backend.handle("listQueue", ["session-1"])) as any[]).length === 0);
    const after = (await backend.handle("listQueue", ["session-1"])) as any[];
    expect(after).toEqual([]);
    off();
    await backend.close();
  });

  it("advertises the capability", async () => {
    const backend = await fixture();
    expect(await backend.handle("capabilities", [])).toMatchObject({ compact: true });
    await backend.close();
  });

  it("logs compaction diagnostics with a stable operationId, trigger, and duration", async () => {
    const backend = await fixture();
    await backend.handle("sendPrompt", ["session-1", "go"]);
    await settle();
    await backend.handle("compact", ["session-1"]);
    await settle();
    // close() drains the diagnostics writer's queue.
    await backend.close();

    const text = await readFile(join(root, "agent", "pipiui-compaction-diagnostics.jsonl"), "utf8");
    const lines = text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, any>);
    const start = lines.find((l) => l.event === "compaction_start");
    const end = lines.find((l) => l.event === "compaction_end");
    expect(start).toMatchObject({
      schemaVersion: 1,
      sessionId: "session-1",
      operation: "context_compaction",
      trigger: "manual",
      reason: "manual",
    });
    expect(typeof start.operationId).toBe("string");
    expect(end.operationId).toBe(start.operationId);
    expect(end.trigger).toBe("manual");
    expect(end.success).toBe(true);
    expect(typeof end.durationMs).toBe("number");
    expect(end.durationMs).toBeGreaterThanOrEqual(0);

    // Scheduler decisions share the same file, tagged proactive_idle, with the
    // fixture's watermarks and no operation yet (operationId null).
    const decisions = lines.filter((l) => l.event === "scheduler_decision");
    expect(decisions.length).toBeGreaterThan(0);
    for (const line of decisions) {
      expect(line).toMatchObject({
        trigger: "proactive_idle",
        operation: "context_compaction",
        operationId: null,
        highWatermark: 0.8,
        lowWatermark: 0.6,
      });
      expect(typeof line.decision).toBe("string");
    }

    // Only allowlisted metadata keys ever appear — no content-bearing fields.
    const allowed = new Set([
      "schemaVersion", "timestamp", "sessionId", "event", "operation", "trigger",
      "operationId", "reason", "decision", "skipReason", "executed", "contextTokens",
      "contextWindow", "usagePercent", "idleMs", "requiredIdleMs", "remainingIdleMs",
      "highWatermark", "lowWatermark", "beforeTokens", "afterTokens", "durationMs",
      "success", "aborted", "error", "errorKind",
    ]);
    for (const line of lines) {
      for (const key of Object.keys(line)) expect(allowed.has(key)).toBe(true);
    }
  });

  it("does not invent an operationId when end arrives without a retained start", async () => {
    const backend = await fixture();
    await backend.handle("sendPrompt", ["session-1", "__compaction_end_only__"]);
    await settle();
    await backend.close();

    const text = await readFile(join(root, "agent", "pipiui-compaction-diagnostics.jsonl"), "utf8");
    const ends = text.trim().split("\n")
      .map((line) => JSON.parse(line) as Record<string, any>)
      .filter((line) => line.event === "compaction_end");
    expect(ends.length).toBeGreaterThanOrEqual(1);
    for (const end of ends) {
      expect(end).not.toHaveProperty("operationId");
      expect(end.skipReason).toBe("missing_start");
      expect(end.errorKind).toBe("missing_start");
      expect(end.decision).toBe("missing_start");
    }
  });

  it("records settle fallback without fabricating success, and a late end does not repeat", async () => {
    const backend = await fixture();
    await backend.handle("sendPrompt", ["session-1", "__compaction_start_no_end__"]);
    await settle();
    await backend.close();

    const lines = (await readFile(join(root, "agent", "pipiui-compaction-diagnostics.jsonl"), "utf8"))
      .trim().split("\n")
      .map((line) => JSON.parse(line) as Record<string, any>);
    const starts = lines.filter((line) => line.event === "compaction_start");
    const ends = lines.filter((line) => line.event === "compaction_end");
    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    expect(ends[0]!.operationId).toBe(starts[0]!.operationId);
    expect(ends[0]!.skipReason).toBe("settled_without_end");
    expect(ends[0]!.errorKind).toBe("settled_without_end");
    expect(ends[0]!.decision).toBe("settled_without_end");
    expect(ends[0]!).not.toHaveProperty("success");
  });
});
