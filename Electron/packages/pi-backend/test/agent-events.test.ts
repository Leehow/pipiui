import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
const USAGE = { kind: "usage", agentId: "a1", runId: "r1", turn: 3, model: "deepseek/deepseek-v4-flash", tools: [], usage: { input: 12_400, output: 2_130, cacheRead: 8_900, cacheWrite: 100, cost: 0.42, contextTokens: 153_000 } };
const UPDATE = { kind: "update", agentId: "a1", runId: "r1", output: "部分结果", activity: "bash cd Electron && npm run build", cost: 0.44, turns: 3 };
const END = { kind: "end", agentId: "a1", runId: "r1", ok: true, output: "最终结果全文", cost: 0.55, turns: 4 };

let root = "";
let backends: ReturnType<typeof createPiHostBackend>[] = [];
async function closeTracked(backend: ReturnType<typeof createPiHostBackend>) {
  await backend.close();
  backends = backends.filter(candidate => candidate !== backend);
}
afterEach(async () => {
  await Promise.all(backends.map(backend => backend.close()));
  backends = [];
  if (root) await rm(root, { recursive: true, force: true });
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

describe("subagent lifecycle → AgentSummary", () => {
	it("routes targeted abort through the owning live Pi command and waits for the real end event", async () => {
		const { backend, deliver, latest } = await harness();
		deliver({ ...START, agentId: "agent-safe_1" });
		const command = vi.fn(async () => ({}));
		(backend as any).command = command;
		const aborting = backend.handle("abortAgent", ["agent-safe_1"]);
		await vi.waitFor(() => expect(command).toHaveBeenCalledWith("session-1", { type: "prompt", message: "/subagent_abort agent-safe_1" }));
		expect(command).toHaveBeenCalledWith("session-1", { type: "prompt", message: "/subagent_abort agent-safe_1" });
		expect(latest().state).toBe("running");
		deliver({ ...END, agentId: "agent-safe_1", ok: false, aborted: true, output: "aborted" });
		await expect(aborting).resolves.toBeUndefined();
		expect(latest().state).toBe("aborted");
	});

	it("rejects a stop request when the owning Pi never acknowledges the command", async () => {
		vi.useFakeTimers();
		try {
			const { backend, deliver, latest } = await harness();
			deliver({ ...START, agentId: "agent-safe_1" });
			const command = vi.fn(() => new Promise<never>(() => undefined));
			(backend as any).command = command;
			const aborting = backend.handle("abortAgent", ["agent-safe_1"]);
			await vi.advanceTimersByTimeAsync(0);
			expect(command).toHaveBeenCalledWith("session-1", { type: "prompt", message: "/subagent_abort agent-safe_1" });
			const rejected = expect(aborting).rejects.toThrow("停止请求在 5 秒内未被主 Agent 接收；请重试");
			await vi.advanceTimersByTimeAsync(5_000);
			await rejected;
			expect(latest().state).toBe("running");
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
  it("carries identity, model, live activity and tokens through to the panel", async () => {
    const { deliver, latest } = await harness();

    deliver(START);
    expect(latest()).toMatchObject({ agentId: "a1", runId: "r1", name: "general-purpose", task: "接入真实左侧栏", title: "接入真实左侧栏", depth: 2, state: "running", sessionId: "session-1" });
    // `start` sends model:null, so nothing may be invented for the provider badge yet.
    expect(latest().model).toBeUndefined();
    expect(latest().provider).toBeUndefined();

    deliver(USAGE);
    expect(latest()).toMatchObject({ model: "deepseek/deepseek-v4-flash", provider: "deepseek", inputTokens: 12_400, outputTokens: 2_130, cacheTokens: 8_900, contextTokens: 153_000, turns: 3, cost: 0.42 });

    deliver(UPDATE);
    // The 正在执行 line, and no final-result card while the worker is still running.
    expect(latest().listSubtitle).toBe("bash cd Electron && npm run build");
    expect(latest().finalResult).toBeUndefined();
    // A payload without `model` must not erase the resolved one.
    expect(latest().model).toBe("deepseek/deepseek-v4-flash");

    deliver(END);
    expect(latest()).toMatchObject({ state: "ok", finalResult: "最终结果全文", cost: 0.55, turns: 4 });
    expect(latest().endedAt).toBeGreaterThan(0);
    // Everything learned earlier survives the terminal event.
    expect(latest()).toMatchObject({ model: "deepseek/deepseek-v4-flash", contextTokens: 153_000, listSubtitle: "bash cd Electron && npm run build" });
  });

  it("publishes the worktree lifecycle the panel badges read", async () => {
    const { deliver, events } = await harness();
    deliver(START);
    const worktree = events.filter((event): event is Extract<AgentEvent, { type: "worktree" }> => event.type === "worktree");
    expect(worktree.at(-1)?.status).toMatchObject({ agentId: "a1", path: "/tmp/wt", branch: "pipiui/worker-a1", lifecycle: "active" });
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
    deliver({ kind: "log_delta", agentId: "a1", runId: "r1", contentIndex: 0, itemType: "thinking", text: "Planning project rebuild" });
    deliver({ kind: "log", agentId: "a1", runId: "r1", items: [{ itemType: "tool", name: "bash", text: "npm run build" }, { itemType: "toolResult", text: "done", isError: false }] });
    const logs = events.filter((event): event is Extract<AgentEvent, { type: "agent_log" }> => event.type === "agent_log");
    expect(logs.map(log => [log.itemType, log.name ?? "", log.text])).toEqual([
      ["thinking", "", "Planning project rebuild"],
      ["tool", "bash", "npm run build"],
      ["toolResult", "", "done"]
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
    const logs = events.filter((event): event is Extract<AgentEvent, { type: "agent_log" }> => event.type === "agent_log");
    expect(logs.map(log => [log.contentIndex, log.text])).toEqual([
      [0, "{\"step\":"],
      [0, "{\"step\": 1}"],
      [1, "plan"],
      [undefined, "legacy"],
      [undefined, "run"],
    ]);
  });

  it("marks a failed run failed rather than leaving it running forever", async () => {
    const { deliver, latest } = await harness();
    deliver(START);
    deliver({ kind: "end", agentId: "a1", runId: "r1", ok: false, output: "boom" });
    expect(latest()).toMatchObject({ state: "failed", finalResult: "boom" });
  });

  it("clears terminal fields when a Computer Leader reuses its agentId for a new planning run", async () => {
    const { deliver, latest } = await harness();
    deliver({ ...START, agentId: "leader", runId: "plan-1", name: "computer-use-leader" });
    deliver({ ...END, agentId: "leader", runId: "plan-1", output: "old plan" });
    expect(latest()).toMatchObject({ state: "ok", finalResult: "old plan" });
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
