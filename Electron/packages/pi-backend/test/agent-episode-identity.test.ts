import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, HostEvent } from "@pipi/host-api";
import { createPiHostBackend } from "../src/index.js";

/**
 * Exact episode identity for host-level agent control: abort / resolve / check /
 * worktree operations bind {sessionId, agentId, runId} and must never fall through
 * to the globally newest row reusing the same semantic slug — not across sessions,
 * not across runs of one session.
 */

let root = "";
let backends: ReturnType<typeof createPiHostBackend>[] = [];
afterEach(async () => {
  await Promise.all(backends.map(backend => backend.close()));
  backends = [];
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

function fakeLive() {
  return {
    process: { pid: 1, exitCode: null, signalCode: null, stdin: { end() {} } },
    pending: new Map(),
    compaction: { dispose() {} },
    exit: Promise.resolve(),
  };
}

async function harness() {
  root = await mkdtemp(join(tmpdir(), "pipi-agent-episode-"));
  const backend = createPiHostBackend({ agentDir: join(root, "agent"), sessionsRoot: join(root, "sessions") });
  backends.push(backend);
  const events: AgentEvent[] = [];
  backend.subscribe((frame: HostEvent) => { if (frame.channel === "agents") events.push(frame.event) });
  const deliver = (payload: Record<string, unknown>, sessionId = "session-1") =>
    (backend as unknown as { mapAgentEvent(raw: unknown, sessionId?: string): void }).mapAgentEvent(payload, sessionId);
  const latest = () => events.filter((event): event is Extract<AgentEvent, { type: "agent" }> => event.type === "agent").at(-1)?.agent;
  return { backend, deliver, events, latest };
}

const START_A = { kind: "start", agentId: "builder", runId: "run-1", parentId: null, name: "general-purpose", task: "shared slug", depth: 1, worktreePath: "/tmp/wt-builder", worktreeBranch: "pipiui/builder" };
const END = { kind: "end", agentId: "builder", runId: "run-1", name: "general-purpose", ok: false, output: "boom", worktreePath: "/tmp/wt-builder", worktreeBranch: "pipiui/builder" };

it("targets abort at the exact session and never the same slug in another session", async () => {
  const { backend, deliver, latest } = await harness();
  deliver({ ...START_A, task: "session one worker" });
  deliver({ ...START_A, task: "session two worker" }, "session-2");
  (backend as any).live.set("session-1", fakeLive());
  (backend as any).live.set("session-2", fakeLive());
  const command = vi.fn(async () => ({}));
  (backend as any).command = command;

  const aborting = backend.handle("abortAgent", ["session-1", "builder", "run-1"]);
  await vi.waitFor(() => expect(command).toHaveBeenCalledWith("session-1", { type: "prompt", message: "/subagent_abort builder run-1", streamingBehavior: "followUp" }));
  // Exact runId rides the runtime command so a stale panel row cannot kill a newer run.
  expect(command.mock.calls.every(call => call[1].message === "/subagent_abort builder run-1")).toBe(true);
  deliver({ ...END, aborted: true });
  deliver({ kind: "update", agentId: "builder", runId: "run-1", output: "session two still working" }, "session-2");
  await expect(aborting).resolves.toBeUndefined();
  expect(latest()).toMatchObject({ sessionId: "session-2", state: "running" });

  // session-2's row stays untouched by session-1's stop: its own abort still applies.
  const command2 = vi.fn(async () => ({}));
  (backend as any).command = command2;
  const aborting2 = backend.handle("abortAgent", ["session-2", "builder", "run-1"]);
  await vi.waitFor(() => expect(command2).toHaveBeenCalledWith("session-2", expect.objectContaining({ type: "prompt" })));
  deliver({ ...END, aborted: true }, "session-2");
  await expect(aborting2).resolves.toBeUndefined();
  expect(latest()).toMatchObject({ sessionId: "session-2", state: "aborted" });
});

it("rejects control for a wrong session, a wrong run, or an already-terminal run", async () => {
  const { backend, deliver } = await harness();
  deliver(START_A);
  deliver({ ...START_A, runId: "run-2", task: "second attempt" });
  deliver(END);

  // run-1 is terminal now; run-2 is the live run. Both lookups are exact.
  await expect(backend.handle("checkAgent", ["session-1", "builder", "run-2"])).resolves.toMatchObject({ runId: "run-2", state: "running" });
  await expect(backend.handle("checkAgent", ["session-1", "builder", "run-1"])).resolves.toMatchObject({ runId: "run-1", state: "failed" });
  // Another session's same slug: rejected, never routed to the newest row.
  await expect(backend.handle("checkAgent", ["session-2", "builder", "run-2"])).rejects.toThrow(/unknown agent builder/);
  await expect(backend.handle("abortAgent", ["session-2", "builder", "run-2"])).rejects.toThrow(/unknown agent builder/);
  await expect(backend.handle("resolveAgent", ["session-2", "builder", "run-1"])).rejects.toThrow(/unknown agent builder/);
  // A run that never existed: rejected.
  await expect(backend.handle("checkAgent", ["session-1", "builder", "run-never"])).rejects.toThrow(/unknown agent builder/);
  // Aborting an already-terminal episode is a stale request, not a no-op on the live run.
  await expect(backend.handle("abortAgent", ["session-1", "builder", "run-1"])).rejects.toThrow(/already finished/);
});

it("resolves exactly one episode and never marks a newer run handled", async () => {
  const { backend, deliver } = await harness();
  deliver({ ...START_A, name: "computer-use-leader" });
  deliver(END);
  deliver({ ...START_A, runId: "run-2", name: "computer-use-leader", task: "recovery attempt" });
  deliver({ ...END, runId: "run-2" });

  await backend.handle("resolveAgent", ["session-1", "builder", "run-1"]);
  const rows = await backend.handle("listAgents", ["session-1", "history"]) as any[];
  expect(rows.find(row => row.runId === "run-1")).toMatchObject({ handled: true });
  expect(rows.find(row => row.runId === "run-2")).toMatchObject({ handled: undefined });
});

it("forwards an exact /subagent_resolve to the owning live session, and only for that episode", async () => {
  const { backend, deliver } = await harness();
  deliver({ ...START_A, name: "computer-use-leader" });
  deliver(END);
  (backend as any).live.set("session-1", fakeLive());
  const command = vi.fn(async () => ({}));
  (backend as any).command = command;

  await backend.handle("resolveAgent", ["session-1", "builder", "run-1"]);
  expect(command).toHaveBeenCalledWith("session-1", {
    type: "prompt",
    message: "/subagent_resolve builder run-1",
    streamingBehavior: "followUp",
  });
  // The command went to the episode's own session only, and exactly once.
  expect(command).toHaveBeenCalledTimes(1);
});

it("projects worktrees per exact episode: same slug across sessions and runs never overwrites", async () => {
  const { backend, deliver, events } = await harness();
  deliver(START_A); // session-1, run-1: active
  deliver({ ...END, worktreeLifecycle: "pendingReview" }); // retained for review
  deliver({ ...START_A, runId: "run-2", worktreePath: "/tmp/wt-builder", worktreeBranch: "pipiui/builder" }); // new run takes a fresh entry
  // A late worktree-bearing event from the retired run-1 must not touch run-2's entry.
  deliver({ kind: "update", agentId: "builder", runId: "run-1", output: "late", worktreeLifecycle: "discarded" });
  // Another session reuses the slug with its own worktree.
  deliver({ ...START_A, runId: "run-other-session", worktreePath: "/tmp/wt-session2", worktreeBranch: "pipiui/builder" }, "session-2");

  await expect(backend.handle("getWorktreeStatus", ["session-1", "builder", "run-1"])).resolves.toMatchObject({ lifecycle: "pendingReview", sessionId: "session-1", runId: "run-1" });
  await expect(backend.handle("getWorktreeStatus", ["session-1", "builder", "run-2"])).resolves.toMatchObject({ lifecycle: "active", sessionId: "session-1", runId: "run-2" });
  await expect(backend.handle("getWorktreeStatus", ["session-2", "builder", "run-other-session"])).resolves.toMatchObject({ lifecycle: "active", path: "/tmp/wt-session2", sessionId: "session-2" });
  // Unrelated (session, agent, run) triple sees no worktree at all.
  await expect(backend.handle("getWorktreeStatus", ["session-2", "builder", "run-1"])).resolves.toMatchObject({ lifecycle: "none" });

  const statuses = events.filter((event): event is Extract<AgentEvent, { type: "worktree" }> => event.type === "worktree").map(event => event.status);
  expect(statuses.every(status => typeof status.sessionId === "string" && typeof status.runId === "string")).toBe(true);
  // run-1's late "discarded" event only ever targeted its own entry.
  expect(statuses.filter(status => status.runId === "run-1" && status.sessionId === "session-1").at(-1)).toMatchObject({ lifecycle: "pendingReview" });

  // A live newer run owns the physical worktree: merge/discard of the old episode is refused.
  await expect(backend.handle("mergeWorktree", ["session-1", "builder", "run-1"])).rejects.toThrow(/newer run of builder is live/);
});

it("keeps worktree episodes isolated across a restart", async () => {
  root = await mkdtemp(join(tmpdir(), "pipi-agent-episode-restart-"));
  const options = { agentDir: join(root, "agent"), sessionsRoot: join(root, "sessions") };
  const first = createPiHostBackend(options);
  const deliver = (payload: Record<string, unknown>, sessionId = "session-1") =>
    (first as unknown as { mapAgentEvent(raw: unknown, sessionId?: string): void }).mapAgentEvent(payload, sessionId);
  deliver(START_A);
  deliver({ ...END, worktreeLifecycle: "pendingReview" });
  deliver({ ...START_A, runId: "run-s2", worktreePath: "/tmp/wt-s2", worktreeBranch: "pipiui/builder" }, "session-2");
  deliver({ ...END, runId: "run-s2", worktreePath: "/tmp/wt-s2", worktreeLifecycle: "pendingReview" }, "session-2");
  await first.close();

  const restarted = createPiHostBackend(options);
  backends.push(restarted);
  await expect(restarted.handle("getWorktreeStatus", ["session-1", "builder", "run-1"])).resolves.toMatchObject({ lifecycle: "pendingReview", sessionId: "session-1", runId: "run-1" });
  await expect(restarted.handle("getWorktreeStatus", ["session-2", "builder", "run-s2"])).resolves.toMatchObject({ lifecycle: "pendingReview", path: "/tmp/wt-s2", sessionId: "session-2", runId: "run-s2" });
  await expect(restarted.handle("getWorktreeStatus", ["session-2", "builder", "run-1"])).resolves.toMatchObject({ lifecycle: "none" });
});

it("scopes cached logs to the exact run by default and keeps agent history explicit", async () => {
  const { backend, deliver } = await harness();
  deliver(START_A);
  deliver({ kind: "log", agentId: "builder", runId: "run-1", items: [{ itemType: "text", text: "run one evidence" }] });
  deliver(END);
  deliver({ ...START_A, runId: "run-2", task: "second attempt" });
  deliver({ kind: "log", agentId: "builder", runId: "run-2", items: [{ itemType: "text", text: "run two evidence" }] });

  // Default scope is the exact run: the current run's transcript never mixes the old run.
  await expect(backend.handle("getAgentLogs", ["builder", "session-1", "run-2"])).resolves.toMatchObject([{ text: "run two evidence" }]);
  await expect(backend.handle("getAgentLogs", ["builder", "session-1", "run-1"])).resolves.toMatchObject([{ text: "run one evidence" }]);
  // Cross-session runId: no bleed.
  await expect(backend.handle("getAgentLogs", ["builder", "session-2", "run-2"])).resolves.toEqual([]);
  // The agent-history view stays an explicit, distinct scope.
  await expect(backend.handle("getAgentLogs", ["builder", "session-1", "run-2", "agent"])).resolves.toMatchObject([
    { text: "run one evidence" },
    { text: "run two evidence" },
  ]);
});

/**
 * Strict wire: the exact [sessionId, agentId, runId] triple is the ONLY accepted
 * control form. There is deliberately no agentId-only route — a fuzzy route would
 * pick a running/newest same-slug episode, which is the cross-session misbinding
 * this contract removed.
 */
it("rejects every non-triple wire form instead of resolving an episode", async () => {
  const { backend, deliver } = await harness();
  deliver({ ...START_A, createdAt: 1_000 });
  deliver({ ...START_A, runId: "run-2", createdAt: 2_000 }, "session-2");

  for (const method of ["abortAgent", "resolveAgent", "checkAgent", "getWorktreeStatus", "mergeWorktree", "discardWorktree"] as const) {
    // Bare agentId — the old fuzzy form — is rejected like any other non-triple.
    await expect(backend.handle(method, ["builder"])).rejects.toThrow(`${method} expects exactly [sessionId, agentId, runId] (exact episode), got 1 argument(s)`);
    // The ambiguous 2-argument form is a bridge bug: never guess which episode was meant.
    await expect(backend.handle(method, ["session-1", "builder"])).rejects.toThrow(`${method} expects exactly [sessionId, agentId, runId] (exact episode), got 2 argument(s)`);
    await expect(backend.handle(method, [])).rejects.toThrow("got 0 argument(s)");
  }
  // Nothing was mutated by the rejected calls: both runs still stand as delivered.
  await expect(backend.handle("checkAgent", ["session-1", "builder", "run-1"])).resolves.toMatchObject({ state: "running" });
  await expect(backend.handle("checkAgent", ["session-2", "builder", "run-2"])).resolves.toMatchObject({ state: "running" });
});

it("resolve against a live owner propagates the runtime forward failure and marks nothing handled", async () => {
  vi.useFakeTimers();
  try {
    const { backend, deliver } = await harness();
    deliver(START_A);
    deliver(END);
    (backend as any).live.set("session-1", fakeLive());
    // The live process never acknowledges the command: the 5s timeout fires.
    const command = vi.fn(() => new Promise<never>(() => undefined));
    (backend as any).command = command;

    const resolving = backend.handle("resolveAgent", ["session-1", "builder", "run-1"]);
    // Pre-attach the rejection so the timer-fire never surfaces as unhandled.
    const observed = resolving.then(() => "resolved", (error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(command).toHaveBeenCalledWith("session-1", expect.objectContaining({ type: "prompt" })));
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(observed).resolves.toBe("标记已处理请求在 5 秒内未被主 Agent 接收");
    // The failure propagated AND nothing was marked handled — a silent local
    // marking would cancel no interrupted reminder and skip the closeout re-entry.
    const rows = await backend.handle("listAgents", ["session-1", "history"]) as any[];
    expect(rows.find(row => row.runId === "run-1")).toMatchObject({ handled: undefined });
  } finally {
    vi.useRealTimers();
  }
});

it("resolve without a live owner is the explicit offline path and marks locally", async () => {
  const { backend, deliver } = await harness();
  deliver(START_A);
  deliver(END);
  // No live process: the episode's owner died, which is the offline case.
  const command = vi.fn(async () => ({}));
  (backend as any).command = command;

  await backend.handle("resolveAgent", ["session-1", "builder", "run-1"]);
  expect(command).not.toHaveBeenCalled();
  const rows = await backend.handle("listAgents", ["session-1", "history"]) as any[];
  expect(rows.find(row => row.runId === "run-1")).toMatchObject({ handled: true });
});
