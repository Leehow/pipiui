import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, AgentSummary, HostEvent } from "@pipi/host-api";
import { createPiHostBackend } from "../src/index.js";

/**
 * These payloads are copied from the real emitters in
 * the bundled subagent runtime (`pipiuiReport({ kind: … })`). The panel renders
 * whatever this mapping produces, so a field the mapper drops is a field the user never sees —
 * which is exactly how model/activity/final-result silently stayed blank.
 */
const START = { kind: "start", agentId: "a1", runId: "r1", parentId: null, toolCallId: "tc1", name: "general-purpose", task: "接入真实左侧栏", depth: 2, model: null, title: "接入真实左侧栏", worktreePath: "/tmp/wt", worktreeBranch: "pipiui/worker-a1" };
const USAGE = { kind: "usage", agentId: "a1", runId: "r1", turn: 3, model: "deepseek/deepseek-v4-flash", tools: [], usage: { input: 12_400, output: 2_130, cacheRead: 8_900, cacheWrite: 100, cost: 0.42, contextTokens: 153_000, contextWindow: 262_144 } };
const UPDATE = { kind: "update", agentId: "a1", runId: "r1", output: "部分结果", activity: "bash cd Electron && npm run build", cost: 0.44, turns: 3 };
const END = { kind: "end", agentId: "a1", runId: "r1", ok: true, output: "最终结果全文", cost: 0.55, turns: 4 };

let root = "";
let backends: ReturnType<typeof createPiHostBackend>[] = [];
async function closeTracked(backend: ReturnType<typeof createPiHostBackend>) {
  await backend.close();
  backends = backends.filter(candidate => candidate !== backend);
}
async function removeRoot(path: string) {
  // createPiHostBackend fire-and-forgets a model-catalog probe whose helper
  // child briefly writes cache files into agentDir after close() returns; retry
  // so teardown doesn't flap on that benign race.
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if ((code !== "ENOTEMPTY" && code !== "EPERM") || attempt >= 20) throw error;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
}

afterEach(async () => {
  await Promise.all(backends.map(backend => backend.close()));
  backends = [];
  if (root) await removeRoot(root);
  root = "";
});

async function harness() {
  root = await mkdtemp(join(tmpdir(), "pipi-agent-events-"));
  const backend = createPiHostBackend({ agentDir: join(root, "agent"), sessionsRoot: join(root, "sessions") });
  backends.push(backend);
  const events: AgentEvent[] = [];
  backend.subscribe((frame: HostEvent) => { if (frame.channel === "agents") events.push(frame.event) });
  // The bridge hands each envelope's inner `event` to the mapper together with its session.
  const deliver = (payload: Record<string, unknown>) => (backend as unknown as { mapAgentEvent(raw: unknown, sessionId?: string): void }).mapAgentEvent(payload, "session-1");
  const latest = (): AgentSummary => {
    const summaries = events.filter((event): event is Extract<AgentEvent, { type: "agent" }> => event.type === "agent");
    return summaries[summaries.length - 1].agent;
  };
  return { backend, events, deliver, latest };
}

function fakeLive() {
  return {
    process: { pid: 1, exitCode: null, signalCode: null, stdin: { end() {} } },
    pending: new Map(),
    compaction: { dispose() {} },
    exit: Promise.resolve(),
  };
}

describe("subagent lifecycle → AgentSummary", () => {
	it("routes targeted abort through the owning live Pi command and waits for the real end event", async () => {
		const { backend, deliver, latest } = await harness();
		deliver({ ...START, agentId: "agent-safe_1" });
		(backend as any).live.set("session-1", fakeLive());
		const command = vi.fn(async () => ({}));
		(backend as any).command = command;
		const aborting = backend.handle("abortAgent", ["agent-safe_1"]);
		await vi.waitFor(() => expect(command).toHaveBeenCalledWith("session-1", { type: "prompt", message: "/subagent_abort agent-safe_1", streamingBehavior: "followUp" }));
		expect(command).toHaveBeenCalledWith("session-1", { type: "prompt", message: "/subagent_abort agent-safe_1", streamingBehavior: "followUp" });
		expect(latest().state).toBe("running");
		deliver({ ...END, agentId: "agent-safe_1", ok: false, aborted: true, output: "aborted" });
		await expect(aborting).resolves.toBeUndefined();
		expect(latest().state).toBe("aborted");
	});

	it("force-settles a stop when the owning Pi never acknowledges the command", async () => {
		vi.useFakeTimers();
		try {
			const { backend, deliver, latest } = await harness();
			deliver({ ...START, agentId: "agent-safe_1" });
			(backend as any).live.set("session-1", fakeLive());
			const command = vi.fn(() => new Promise<never>(() => undefined));
			(backend as any).command = command;
			const aborting = backend.handle("abortAgent", ["agent-safe_1"]);
			await vi.advanceTimersByTimeAsync(0);
			expect(command).toHaveBeenCalledWith("session-1", { type: "prompt", message: "/subagent_abort agent-safe_1", streamingBehavior: "followUp" });
			await vi.advanceTimersByTimeAsync(5_000);
			await expect(aborting).resolves.toBeUndefined();
			expect(latest()).toMatchObject({ agentId: "agent-safe_1", state: "aborted" });
			await expect(backend.handle("listAgents", ["session-1"])).resolves.toMatchObject([
				expect.objectContaining({ agentId: "agent-safe_1", state: "aborted" }),
			]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("force-settles a stop when the host closes before the end event arrives", async () => {
		const { backend, deliver, latest } = await harness();
		deliver({ ...START, agentId: "agent-safe_1" });
		(backend as any).live.set("session-1", fakeLive());
		const command = vi.fn(async () => ({}));
		(backend as any).command = command;
		const aborting = backend.handle("abortAgent", ["agent-safe_1"]);
		await vi.waitFor(() => expect(command).toHaveBeenCalled());
		expect(latest().state).toBe("running");
		await backend.close();
		await expect(aborting).resolves.toBeUndefined();
		expect(latest()).toMatchObject({ agentId: "agent-safe_1", state: "aborted" });
		await expect(backend.handle("listAgents", ["session-1"])).resolves.toMatchObject([
			expect.objectContaining({ agentId: "agent-safe_1", state: "aborted" }),
		]);
	});

	it("force-settles a stop when no live Pi process exists to receive /subagent_abort", async () => {
		const { backend, deliver, latest } = await harness();
		deliver({ ...START, agentId: "agent-safe_1" });
		const command = vi.fn(async () => ({}));
		(backend as any).command = command;
		await expect(backend.handle("abortAgent", ["agent-safe_1"])).resolves.toBeUndefined();
		expect(command).not.toHaveBeenCalled();
		expect(latest()).toMatchObject({ agentId: "agent-safe_1", state: "aborted" });
	});

	it("force-settles a stop when the worker never emits an end event", async () => {
		vi.useFakeTimers();
		try {
			const { backend, deliver, latest } = await harness();
			deliver({ ...START, agentId: "agent-safe_1" });
			(backend as any).live.set("session-1", fakeLive());
			const command = vi.fn(async () => ({}));
			(backend as any).command = command;
			const aborting = backend.handle("abortAgent", ["agent-safe_1"]);
			await vi.advanceTimersByTimeAsync(0);
			expect(command).toHaveBeenCalledWith("session-1", { type: "prompt", message: "/subagent_abort agent-safe_1", streamingBehavior: "followUp" });
			expect(latest().state).toBe("running");
			await vi.advanceTimersByTimeAsync(15_000);
			await expect(aborting).resolves.toBeUndefined();
			expect(latest()).toMatchObject({ agentId: "agent-safe_1", state: "aborted" });
		} finally {
			vi.useRealTimers();
		}
	});

	it("keeps a same-run terminal state when an older update arrives late", async () => {
		const { deliver, latest } = await harness();
		deliver(START);
		deliver({ ...END, ok: false, aborted: true, output: "aborted" });
		const endedAt = latest().endedAt;
		deliver({ ...UPDATE, output: "late preview", activity: "stale activity" });
		expect(latest()).toMatchObject({ state: "aborted", finalResult: "aborted", endedAt });
	});

  it("clears the runtime-budget deadline on terminal events and lets a new run re-arm it", async () => {
    const { deliver, latest } = await harness();
    deliver(START);
    const deadlineAt = Date.now() + 180_000;
    deliver({ ...UPDATE, deadlineAt });
    expect(latest().deadlineAt).toBe(deadlineAt);
    // A dead worker must never keep rendering "最迟 NNN 秒后自动中止".
    deliver(END);
    expect(latest().state).toBe("ok");
    expect(latest().deadlineAt).toBeUndefined();
    // Late non-terminal events on the terminal run cannot resurrect the deadline either.
    deliver({ ...UPDATE, output: "late preview" });
    expect(latest().deadlineAt).toBeUndefined();
    // A fresh run for the same agentId starts clean and can arm a new deadline.
    deliver({ ...START, runId: "r2" });
    const newDeadline = Date.now() + 300_000;
    deliver({ ...UPDATE, runId: "r2", deadlineAt: newDeadline });
    expect(latest()).toMatchObject({ runId: "r2", deadlineAt: newDeadline });
  });
  it("carries identity, model, live activity and tokens through to the panel", async () => {
    const { deliver, latest } = await harness();

    deliver(START);
    expect(latest()).toMatchObject({ agentId: "a1", runId: "r1", name: "general-purpose", task: "接入真实左侧栏", title: "接入真实左侧栏", depth: 2, state: "running", sessionId: "session-1" });
    // `start` sends model:null, so nothing may be invented for the provider badge yet.
    expect(latest().model).toBeUndefined();
    expect(latest().provider).toBeUndefined();

    deliver(USAGE);
    expect(latest()).toMatchObject({ model: "deepseek/deepseek-v4-flash", provider: "deepseek", inputTokens: 12_400, outputTokens: 2_130, cacheTokens: 8_900, contextTokens: 153_000, contextWindowTokens: 262_144, turns: 3, cost: 0.42 });

    deliver(UPDATE);
    // The 正在执行 line, and no final-result card while the worker is still running.
    expect(latest().listSubtitle).toBe("bash cd Electron && npm run build");
    expect(latest().finalResult).toBeUndefined();
    // A payload without `model` must not erase the resolved one.
    expect(latest().model).toBe("deepseek/deepseek-v4-flash");
    expect(latest()).toMatchObject({ provider: "deepseek", inputTokens: 12_400, outputTokens: 2_130, cacheTokens: 8_900, contextTokens: 153_000, turns: 3, cost: 0.44 });

    deliver(END);
    expect(latest()).toMatchObject({ state: "ok", finalResult: "最终结果全文", cost: 0.55, turns: 4 });
    expect(latest().endedAt).toBeGreaterThan(0);
    // Everything learned earlier survives the terminal event.
    expect(latest()).toMatchObject({ model: "deepseek/deepseek-v4-flash", contextTokens: 153_000, listSubtitle: "bash cd Electron && npm run build" });
  });

  it("replaces streaming usage totals instead of adding them", async () => {
    const { deliver, latest } = await harness();
    deliver(START);
    deliver(USAGE);
    deliver({
      ...USAGE,
      turn: 3,
      usage: { input: 12_800, output: 2_400, cacheRead: 8_900, cacheWrite: 100, cost: 0.45, contextTokens: 154_200 },
    });
    expect(latest()).toMatchObject({
      inputTokens: 12_800,
      outputTokens: 2_400,
      cacheTokens: 8_900,
      contextTokens: 154_200,
      contextWindowTokens: 262_144,
      turns: 3,
      cost: 0.45,
    });
    deliver({
      ...USAGE,
      turn: 4,
      usage: { input: 13_100, output: 2_600, cacheRead: 8_900, cacheWrite: 100, cost: 0.48, contextTokens: 155_000 },
    });
    expect(latest()).toMatchObject({
      inputTokens: 13_100,
      outputTokens: 2_600,
      cacheTokens: 8_900,
      contextTokens: 155_000,
      turns: 4,
      cost: 0.48,
    });
  });

  it("projects an explicit merged lifecycle instead of pendingReview from a leftover path", async () => {
    const { deliver, backend, events } = await harness();
    deliver(START);
    deliver({
      ...END,
      worktreePath: "/tmp/wt",
      worktreeBranch: "pipiui/worker-a1",
      worktreeLifecycle: "merged",
      worktreeFinalization: "disposition=merged merge=merged cleanup=cleaned phase=completed",
    });
    const worktree = events.filter((event): event is Extract<AgentEvent, { type: "worktree" }> => event.type === "worktree").at(-1);
    expect(worktree?.status).toMatchObject({ lifecycle: "merged", merge: "merged", discard: "unavailable" });
    await expect(backend.handle("getWorktreeStatus", ["a1"])).resolves.toMatchObject({ lifecycle: "merged", merge: "merged" });
  });

  it("keeps pendingReview for retained/needs-fixer and accepts legacy path-only ends", async () => {
    const { deliver, backend } = await harness();
    deliver(START);
    deliver({
      ...END,
      worktreePath: "/tmp/wt",
      worktreeBranch: "pipiui/worker-a1",
      worktreeLifecycle: "pendingReview",
      worktreeFinalization: "disposition=needs-fixer merge=not-attempted cleanup=not-attempted phase=recovery",
    });
    await expect(backend.handle("getWorktreeStatus", ["a1"])).resolves.toMatchObject({
      lifecycle: "pendingReview",
      merge: "ready",
      discard: "ready",
    });
    deliver({
      ...START,
      agentId: "legacy",
      runId: "r-legacy",
      worktreePath: "/tmp/legacy",
      worktreeBranch: "pipiui/legacy",
    });
    deliver({
      kind: "end",
      agentId: "legacy",
      runId: "r-legacy",
      ok: true,
      output: "ok",
      worktreePath: "/tmp/legacy",
    });
    await expect(backend.handle("getWorktreeStatus", ["legacy"])).resolves.toMatchObject({
      lifecycle: "pendingReview",
      merge: "ready",
    });
  });

  it("publishes the worktree lifecycle the panel badges read", async () => {
    const { deliver, events } = await harness();
    deliver(START);
    const worktree = events.filter((event): event is Extract<AgentEvent, { type: "worktree" }> => event.type === "worktree");
    expect(worktree.at(-1)?.status).toMatchObject({ agentId: "a1", path: "/tmp/wt", branch: "pipiui/worker-a1", lifecycle: "active" });
  });

  it("carries worktreeError to the panel when writable isolation failed before spawn", async () => {
    const { deliver, latest } = await harness();
    // Mirrors the runtime's refuse-shared-cwd fallback: start + end both carry the
    // reason; the panel turns it into an actionable Chinese hint.
    const reason = "writable isolation requires a git work tree; refusing shared-cwd fallback";
    deliver({ ...START, worktreePath: undefined, worktreeBranch: undefined, worktreeError: reason });
    deliver({ ...END, ok: false, output: `Writable subagent isolation failed before spawn: ${reason}`, worktreeError: reason });
    expect(latest()).toMatchObject({ state: "failed", worktreeError: reason });
  });

  it("preserves the dispatching toolCallId so the transcript card can join agents", async () => {
    const { deliver, latest } = await harness();
    deliver(START);
    expect(latest().toolCallId).toBe("tc1");
    // A later preview must not erase the link, and the terminal event keeps it
    // so a finished boss turn can still group workers under its tool_call.
    deliver(UPDATE);
    deliver(END);
    expect(latest().toolCallId).toBe("tc1");
    // Newer events without a toolCallId (e.g. child agents) fall back to the
    // known one rather than dropping it.
    deliver({ ...UPDATE, parentId: "a1", toolCallId: undefined });
    expect(latest().toolCallId).toBe("tc1");

    // Agent ids may be reused for a later planning run. A fresh run has no
    // relationship to the old tool_call unless its own START reports one.
    deliver({ ...START, runId: "r2", toolCallId: undefined });
    expect(latest()).toMatchObject({ runId: "r2", state: "running" });
    expect(latest().toolCallId).toBeUndefined();
  });

  it("does not display a private Operator blocked verdict as successful just because Pi exited zero", async () => {
    const { deliver, latest } = await harness();
    deliver({ ...START, name: "operator" });
    deliver({
      ...END,
      name: "operator",
      ok: true,
      output: JSON.stringify({ outcome: "blocked", summary: "The document remained inaccessible." }),
    });
    expect(latest()).toMatchObject({
      name: "operator",
      state: "failed",
      finalResult: JSON.stringify({ outcome: "blocked", summary: "The document remained inaccessible." }),
    });
  });

  it("relays streamed log deltas and batched log items", async () => {
    const { deliver, events } = await harness();
    deliver(START);
    deliver({ kind: "log_delta", agentId: "a1", runId: "r1", contentIndex: 0, itemType: "thinking", text: "Planning project rebuild", charCount: 2400 });
    deliver({ kind: "log", agentId: "a1", runId: "r1", items: [{ itemType: "tool", name: "bash", text: "npm run build" }, { itemType: "toolResult", text: "done", isError: false }] });
    const logs = events.filter((event): event is Extract<AgentEvent, { type: "agent_log" }> => event.type === "agent_log" && !event.resetStreamSlots);
    expect(logs.map(log => [log.itemType, log.name ?? "", log.text, log.charCount])).toEqual([
      ["thinking", "", "Planning project rebuild", 2400],
      ["tool", "bash", "npm run build", undefined],
      ["toolResult", "", "done", undefined]
    ]);
  });

  it("passes log_delta contentIndex through so the panel can upsert one row per chunk", async () => {
    const { deliver, events } = await harness();
    deliver(START);
    deliver({ kind: "log_delta", agentId: "a1", runId: "r1", contentIndex: 0, itemType: "text", text: "{\"step\":" });
    deliver({ kind: "log_delta", agentId: "a1", runId: "r1", contentIndex: 0, itemType: "text", text: "{\"step\": 1}" });
    deliver({ kind: "log_delta", agentId: "a1", runId: "r1", contentIndex: 1, itemType: "thinking", text: "plan" });
    // A runtime without the key stays backward compatible: the field is simply absent.
    deliver({ kind: "log_delta", agentId: "a1", runId: "r1", itemType: "text", text: "legacy" });
    deliver({ kind: "log", agentId: "a1", runId: "r1", items: [{ itemType: "tool", name: "bash", text: "run" }] });
    const logs = events.filter((event): event is Extract<AgentEvent, { type: "agent_log" }> => event.type === "agent_log" && !event.resetStreamSlots);
    expect(logs.map(log => [log.contentIndex, log.text])).toEqual([
      [0, "{\"step\":"],
      [0, "{\"step\": 1}"],
      [1, "plan"],
      [undefined, "legacy"],
      [undefined, "run"],
    ]);
  });

  it("does not persist the durable agent index on every streamed log_delta", async () => {
    const { backend, deliver } = await harness();
    deliver(START);
    await (backend as any).agentsWrite;
    const persist = vi.spyOn(backend as any, "persistAgents");
    for (let i = 1; i <= 80; i++) {
      deliver({ kind: "log_delta", agentId: "a1", runId: "r1", contentIndex: 0, itemType: "text", text: "x".repeat(i) });
    }
    expect(persist).not.toHaveBeenCalled();
    persist.mockRestore();
  });

  it("coalesces persistAgents bursts to one snapshot write", async () => {
    const { backend, deliver } = await harness();
    deliver(START);
    await (backend as any).agentsWrite;
    const { promises: fs } = await import("node:fs");
    const writeFile = vi.spyOn(fs, "writeFile");
    for (let i = 0; i < 40; i++) (backend as any).persistAgents();
    await (backend as any).agentsWrite;
    const indexWrites = writeFile.mock.calls.filter(([path]) => String(path).includes("pipiui-agent-index.json"));
    expect(indexWrites.length).toBe(1);
    writeFile.mockRestore();
  });

  it("qualifies cached and live logs by the exact session, agent, and run", async () => {
    const { backend, events } = await harness();
    const deliverFor = (sessionId: string, payload: Record<string, unknown>) =>
      (backend as unknown as { mapAgentEvent(raw: unknown, sessionId?: string): void }).mapAgentEvent(payload, sessionId);

    deliverFor("session-1", { ...START, agentId: "shared", runId: "run-1" });
    deliverFor("session-1", { kind: "log_delta", agentId: "shared", runId: "run-1", contentIndex: 0, itemType: "text", text: "session one" });
    deliverFor("session-2", { ...START, agentId: "shared", runId: "run-2" });
    deliverFor("session-2", { kind: "log_delta", agentId: "shared", runId: "run-2", contentIndex: 0, itemType: "text", text: "session two" });
    deliverFor("session-1", { ...START, agentId: "shared", runId: "run-3" });
    deliverFor("session-1", { kind: "log_delta", agentId: "shared", runId: "run-3", contentIndex: 0, itemType: "text", text: "new run" });

    const logs = events.filter((event): event is Extract<AgentEvent, { type: "agent_log" }> => event.type === "agent_log");
    expect(logs.map(log => [log.sessionId, log.agentId, log.runId, log.contentIndex, log.text])).toEqual([
      ["session-1", "shared", "run-1", 0, "session one"],
      ["session-2", "shared", "run-2", 0, "session two"],
      ["session-1", "shared", "run-3", 0, "new run"],
    ]);
    await expect(backend.handle("getAgentLogs", ["shared", "session-1", "run-1"])).resolves.toMatchObject([{ contentIndex: 0, text: "session one" }]);
    await expect(backend.handle("getAgentLogs", ["shared", "session-2", "run-2"])).resolves.toMatchObject([{ contentIndex: 0, text: "session two" }]);
    await expect(backend.handle("getAgentLogs", ["shared", "session-1", "run-3"])).resolves.toMatchObject([{ contentIndex: 0, text: "new run" }]);
    await expect(backend.handle("getAgentLogs", ["shared", "session-2", "run-1"])).resolves.toEqual([]);
  });

  it("persists agent logs across host restart so a completed transcript can be reloaded", async () => {
    const { backend, deliver } = await harness();
    deliver(START);
    deliver({ kind: "log_delta", agentId: "a1", runId: "r1", contentIndex: 0, itemType: "thinking", text: "first" });
    deliver({ kind: "log_delta", agentId: "a1", runId: "r1", contentIndex: 1, itemType: "text", text: "先读 A" });
    deliver({ kind: "log", agentId: "a1", runId: "r1", items: [{ itemType: "tool", name: "read", text: "A.tsx" }] });
    deliver(END);
    await closeTracked(backend);

    const restarted = createPiHostBackend({ agentDir: join(root, "agent"), sessionsRoot: join(root, "sessions") });
    backends.push(restarted);
    await expect(restarted.handle("getAgentLogs", ["a1", "session-1", "r1"])).resolves.toMatchObject([
      { itemType: "thinking", text: "first" },
      { itemType: "text", text: "先读 A" },
      { itemType: "tool", name: "read", text: "A.tsx" },
    ]);
    await closeTracked(restarted);
  });

  it("resets cached contentIndex slots on batched log so the next turn does not overwrite", async () => {
    const { backend, deliver } = await harness();
    deliver(START);
    deliver({ kind: "log_delta", agentId: "a1", runId: "r1", contentIndex: 0, itemType: "thinking", text: "first" });
    deliver({ kind: "log_delta", agentId: "a1", runId: "r1", contentIndex: 1, itemType: "text", text: "先读 A" });
    deliver({ kind: "log", agentId: "a1", runId: "r1", items: [{ itemType: "tool", name: "read", text: "A.tsx" }] });
    deliver({ kind: "log_delta", agentId: "a1", runId: "r1", contentIndex: 0, itemType: "thinking", text: "second" });
    deliver({ kind: "log_delta", agentId: "a1", runId: "r1", contentIndex: 1, itemType: "text", text: "再读 B" });
    await expect(backend.handle("getAgentLogs", ["a1", "session-1", "r1"])).resolves.toMatchObject([
      { itemType: "thinking", text: "first" },
      { itemType: "text", text: "先读 A" },
      { itemType: "tool", text: "A.tsx" },
      { itemType: "thinking", text: "second" },
      { itemType: "text", text: "再读 B" },
    ]);
  });

  it("marks a failed run failed rather than leaving it running forever", async () => {
    const { deliver, latest } = await harness();
    deliver(START);
    deliver({ kind: "end", agentId: "a1", runId: "r1", ok: false, output: "boom" });
    expect(latest()).toMatchObject({ state: "failed", finalResult: "boom" });
  });

  it("clears terminal fields when a Computer Leader reuses its agentId for a new planning run", async () => {
    const { backend, deliver, latest } = await harness();
    deliver({ ...START, agentId: "leader", runId: "plan-1", name: "computer-use-leader" });
    deliver({ ...USAGE, agentId: "leader", runId: "plan-1" });
    deliver({ ...UPDATE, agentId: "leader", runId: "plan-1" });
    deliver({ ...END, agentId: "leader", runId: "plan-1", output: "old plan" });
    await backend.handle("resolveAgent", ["leader"]);
    expect(latest()).toMatchObject({ state: "ok", finalResult: "old plan", handled: true, model: "deepseek/deepseek-v4-flash", provider: "deepseek", cost: 0.55, turns: 4, outputCount: 1, inputTokens: 12_400, outputTokens: 2_130, cacheTokens: 8_900, contextTokens: 153_000, listSubtitle: "bash cd Electron && npm run build" });
    expect(latest().endedAt).toBeGreaterThan(0);
    deliver({
      ...START,
      agentId: "leader",
      runId: "replan-2",
      name: "computer-use-leader",
      task: "Revise this Computer Task plan after real failure",
      title: "Revise Computer Task",
    });
    expect(latest()).toMatchObject({ state: "running", runId: "replan-2" });
    expect(latest().endedAt).toBeUndefined();
    expect(latest().finalResult).toBeUndefined();
    expect(latest().handled).toBeUndefined();
    expect(latest().model).toBeUndefined();
    expect(latest().provider).toBeUndefined();
    expect(latest().cost).toBeUndefined();
    expect(latest().turns).toBeUndefined();
    expect(latest().outputCount).toBeUndefined();
    expect(latest().inputTokens).toBeUndefined();
    expect(latest().outputTokens).toBeUndefined();
    expect(latest().cacheTokens).toBeUndefined();
    expect(latest().contextTokens).toBeUndefined();
    expect(latest().listSubtitle).toBeUndefined();
  });

  it("persists restart normalization once and preserves an existing endedAt", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-agent-events-restart-"));
    const agentDir = join(root, "agent");
    const indexPath = join(agentDir, "pipiui-agent-index.json");
    await mkdir(agentDir, { recursive: true });
    await writeFile(indexPath, JSON.stringify({
      version: 1,
      agents: [
        { agentId: "running", runId: "run-1", name: "explore", task: "running before restart", state: "running", sessionId: "session-1", createdAt: 1, endedAt: 777 },
        { agentId: "stalled", runId: "run-2", name: "reviewer", task: "stalled before restart", state: "stalled", sessionId: "session-1", createdAt: 2 },
      ],
      worktrees: [],
    }, null, 2) + "\n");

    const first = createPiHostBackend({ agentDir, sessionsRoot: join(root, "sessions") });
    backends.push(first);
    const firstRows = await first.handle("listAgents", ["session-1"]) as AgentSummary[];
    expect(firstRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ agentId: "running", state: "interrupted", endedAt: 777 }),
      expect.objectContaining({ agentId: "stalled", state: "interrupted", endedAt: expect.any(Number) }),
    ]));
    await closeTracked(first);

    const persistedOnce = await readFile(indexPath, "utf8");
    expect(JSON.parse(persistedOnce).agents).toEqual(expect.arrayContaining([
      expect.objectContaining({ agentId: "running", state: "interrupted", endedAt: 777 }),
      expect.objectContaining({ agentId: "stalled", state: "interrupted", endedAt: expect.any(Number) }),
    ]));

    const second = createPiHostBackend({ agentDir, sessionsRoot: join(root, "sessions") });
    backends.push(second);
    await expect(second.handle("listAgents", ["session-1"])).resolves.toEqual(firstRows);
    await closeTracked(second);
    expect(await readFile(indexPath, "utf8")).toBe(persistedOnce);
  });

  it("rehydrates the session-scoped tree after restart without faking a running process", async () => {
    const { backend, deliver } = await harness();
    deliver(START);
    deliver(UPDATE);
    (backend as unknown as { mapAgentEvent(raw: unknown, sessionId?: string): void }).mapAgentEvent(
      { ...START, runId: "r-other", task: "另一个项目里的同名切片", title: "另一个项目" },
      "session-2"
    );
    await closeTracked(backend);

    const restarted = createPiHostBackend({ agentDir: join(root, "agent"), sessionsRoot: join(root, "sessions") });
    backends.push(restarted);
    await expect(restarted.handle("listAgents", ["another-session"])).resolves.toEqual([]);
    await expect(restarted.handle("listAgents", ["session-1"])).resolves.toMatchObject([{
      agentId: "a1",
      runId: "r1",
      toolCallId: "tc1",
      state: "interrupted",
      task: "接入真实左侧栏",
      title: "接入真实左侧栏",
      listSubtitle: "bash cd Electron && npm run build",
      sessionId: "session-1"
    }]);
    await expect(restarted.handle("listAgents", ["session-2"])).resolves.toMatchObject([{
      agentId: "a1",
      runId: "r-other",
      state: "interrupted",
      task: "另一个项目里的同名切片",
      sessionId: "session-2"
    }]);
    await closeTracked(restarted);
  });

  it("loads the durable index before an immediate live START can replace or drop rows", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-agent-events-race-"));
    const agentDir = join(root, "agent");
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "pipiui-agent-index.json"), JSON.stringify({
      version: 1,
      agents: [
        { agentId: "same", runId: "stale-run", name: "general-purpose", task: "旧任务", state: "ok", sessionId: "session-live", createdAt: 1 },
        { agentId: "old", runId: "old-run", name: "explore", task: "历史无关任务", state: "ok", sessionId: "session-old", createdAt: 2 }
      ],
      worktrees: []
    }));

    const backend = createPiHostBackend({ agentDir, sessionsRoot: join(root, "sessions") });
    backends.push(backend);
    // Deliberately no await/yield between construction and event delivery.
    (backend as unknown as { mapAgentEvent(raw: unknown, sessionId?: string): void }).mapAgentEvent(
      { ...START, agentId: "same", runId: "new-run", task: "当前新任务", title: "当前新任务" },
      "session-live"
    );

    await expect(backend.handle("listAgents", ["session-live"])).resolves.toMatchObject([{
      agentId: "same", runId: "new-run", state: "running", task: "当前新任务"
    }]);
    await expect(backend.handle("listAgents", ["session-old"])).resolves.toMatchObject([{
      agentId: "old", runId: "old-run", task: "历史无关任务"
    }]);
    await closeTracked(backend);

    const restarted = createPiHostBackend({ agentDir, sessionsRoot: join(root, "sessions") });
    backends.push(restarted);
    await expect(restarted.handle("listAgents", [])).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ agentId: "same", runId: "new-run", state: "interrupted", task: "当前新任务" }),
      expect.objectContaining({ agentId: "old", runId: "old-run", task: "历史无关任务" })
    ]));
  });

  it("keeps a resolved failure terminal instead of synthesizing a generic running agent", async () => {
    const { backend, deliver, latest } = await harness();
    deliver(START);
    deliver({ kind: "end", agentId: "a1", runId: "r1", ok: false, output: "desktop unavailable" });
    deliver({ kind: "closeout", agentId: "a1", runId: "r1", disposition: "cleaned", reason: "handled", closeoutAt: 123 });

    expect(latest()).toMatchObject({
      agentId: "a1",
      runId: "r1",
      name: "general-purpose",
      state: "failed",
      handled: true
    });
    await expect(backend.handle("listAgents", ["session-1"])).resolves.toHaveLength(1);
  });

  it("ignores an orphaned or stale closeout instead of creating a running placeholder", async () => {
    const { backend, deliver } = await harness();
    deliver({ kind: "closeout", agentId: "missing", runId: "r-missing", disposition: "cleaned" });
    deliver(START);
    deliver({ kind: "closeout", agentId: "a1", runId: "stale-run", disposition: "cleaned" });

    await expect(backend.handle("listAgents", ["session-1"])).resolves.toMatchObject([
      { agentId: "a1", runId: "r1", name: "general-purpose", state: "running", handled: undefined }
    ]);
  });

  it("marks a failed row handled without rewriting its terminal state", async () => {
    const { backend, deliver } = await harness();
    deliver(START);
    deliver({ kind: "end", agentId: "a1", runId: "r1", ok: false, output: "boom" });

    await backend.handle("resolveAgent", ["a1"]);
    await expect(backend.handle("checkAgent", ["a1"])).resolves.toMatchObject({ state: "failed", handled: true });
  });
});

describe("dead-session orphan reconcile", () => {
  const base = Date.parse("2026-01-01T00:00:00.000Z");
  const staleAt = new Date(base).toISOString();
  const staleNow = base + 10 * 60 * 1000;

  it("sweeps a stale running worker to interrupted even while the session process is still alive", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(staleNow));
    try {
      const { backend, deliver, events } = await harness();
      deliver({ ...START, at: staleAt });
      (backend as any).live.set("session-1", fakeLive());
      expect((backend as any).reconcileOrphanedNow("session-1", staleNow)).toBe(true);
      await expect(backend.handle("listAgents", ["session-1"])).resolves.toMatchObject([
        { agentId: "a1", state: "interrupted" },
      ]);
      expect(events.some(e => e.type === "agent" && (e as any).agent.state === "interrupted")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not misjudge a worker with a fresh heartbeat while the session is alive", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(staleNow));
    try {
      const { backend, deliver } = await harness();
      deliver({ ...START, at: new Date(staleNow - 60_000).toISOString() });
      // Fresh log_delta within watchdog window is worker liveness evidence.
      deliver({ kind: "log_delta", agentId: "a1", runId: "r1", contentIndex: 0, itemType: "text", text: "still working", at: new Date(staleNow - 30_000).toISOString() });
      (backend as any).live.set("session-1", fakeLive());
      expect((backend as any).reconcileOrphanedNow("session-1", staleNow)).toBe(false);
      await expect(backend.handle("listAgents", ["session-1"])).resolves.toMatchObject([
        { agentId: "a1", state: "running" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reconciles on listAgents so a reconnect immediately corrects a stale running row", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(staleNow));
    try {
      const { backend, deliver } = await harness();
      deliver({ ...START, at: staleAt });
      (backend as any).live.set("session-1", fakeLive());
      (backend as any).reconcileOrphanedNow("session-1", staleNow);
      await expect(backend.handle("listAgents", ["session-1"])).resolves.toMatchObject([
        { agentId: "a1", state: "interrupted", endedAt: staleNow },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sweeps a stale running worker to interrupted after the session process dies", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(staleNow));
    try {
      const { backend, deliver, events } = await harness();
      deliver({ ...START, at: staleAt, activity: "bash sleep 999" });
      expect((backend as any).reconcileOrphanedNow("session-1", staleNow)).toBe(true);
      await expect(backend.handle("listAgents", ["session-1"])).resolves.toMatchObject([
      {
        agentId: "a1",
        state: "interrupted",
        endedAt: staleNow,
        listSubtitle: "",
        closeout: "会话进程已退出且超过 10 分钟无观察事件；按中断成果保留",
      },
    ]);
    const worktree = events.filter((event): event is Extract<AgentEvent, { type: "worktree" }> => event.type === "worktree").at(-1);
      expect(worktree?.status).toMatchObject({ agentId: "a1", lifecycle: "pendingReview", merge: "ready", discard: "ready" });
      await expect(backend.handle("getWorktreeStatus", ["a1"])).resolves.toMatchObject({
        lifecycle: "pendingReview",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not sweep a fresh observation or a terminal row", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(staleNow));
    try {
      const { backend, deliver } = await harness();
    deliver({ ...START, at: staleAt });
    deliver({ ...START, agentId: "fresh", runId: "r-fresh", at: new Date(staleNow).toISOString(), worktreePath: undefined });
    deliver({ ...START, agentId: "done", runId: "r-done", at: staleAt, worktreePath: undefined });
    deliver({ kind: "end", agentId: "done", runId: "r-done", ok: true, output: "ok", at: staleAt });
    expect((backend as any).reconcileOrphanedNow("session-1", staleNow)).toBe(true);
    const rows = await backend.handle("listAgents", ["session-1"]) as AgentSummary[];
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ agentId: "a1", state: "interrupted" }),
      expect.objectContaining({ agentId: "fresh", state: "running" }),
      expect.objectContaining({ agentId: "done", state: "ok" }),
    ]));
      expect((backend as any).reconcileOrphanedNow("session-1", staleNow + 10 * 60 * 1000)).toBe(true);
      vi.setSystemTime(new Date(staleNow + 10 * 60 * 1000));
      await expect(backend.handle("listAgents", ["session-1"])).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ agentId: "fresh", state: "interrupted" }),
        expect.objectContaining({ agentId: "done", state: "ok" }),
      ]));
    } finally {
      vi.useRealTimers();
    }
  });

  it("is idempotent and persists so a restart does not see a running ghost", async () => {
    const { backend, deliver } = await harness();
    deliver({ ...START, at: staleAt });
    expect((backend as any).reconcileOrphanedNow("session-1", staleNow)).toBe(true);
    expect((backend as any).reconcileOrphanedNow("session-1", staleNow + 120_000)).toBe(false);
    await (backend as any).agentsWrite;
    const persisted = JSON.parse(await readFile(join(root, "agent", "pipiui-agent-index.json"), "utf8"));
    expect(persisted.agents).toEqual(expect.arrayContaining([
      expect.objectContaining({ agentId: "a1", state: "interrupted", endedAt: staleNow }),
    ]));
    expect(persisted.agents.some((agent: { state: string }) => agent.state === "running")).toBe(false);
  });
});
