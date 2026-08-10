import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  WorktreeFinalizationServiceV1,
  createNodeFsStorageAdapterV1,
  createSubagentHostRuntimeV1,
} from "../../Sources/PipiUI/PiExt/subagent-host/index.ts";

const capability = "0123456789abcdef0123456789abcdef";

async function post(port, body) {
  const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function command(action, fields = {}) {
  return {
    schemaVersion: 1,
    sessionCapability: capability,
    action,
    ...fields,
  };
}

function agentEvent(kind, agentId, runId, fields = {}) {
  return { schemaVersion: 1, kind, agentId, runId, ...fields };
}

function safeInspection(input) {
  return {
    main: {
      isRepo: true,
      branch: "main",
      head: "main-head",
      stagedPaths: [],
      unstagedPaths: [],
      untrackedPaths: [],
      conflictPaths: [],
      dangerousOperations: [],
      pathsKnown: true,
      errors: [],
    },
    worktree: {
      isRepo: true,
      branch: input.worktree.branch,
      head: "worker-head",
      stagedPaths: [],
      unstagedPaths: [],
      untrackedPaths: [],
      conflictPaths: [],
      dangerousOperations: [],
      pathsKnown: true,
      errors: [],
    },
    registeredWorktrees: [{ path: input.worktree.path, branch: input.worktree.branch }],
    registeredWorktreePath: input.worktree.path,
    branchExists: true,
    branchHead: "worker-head",
    branchIsAncestorOfMain: false,
    workerBranchChangedPaths: ["Sources/Feature.swift"],
    errors: [],
  };
}

class FakeWorktreeAdapter {
  constructor() {
    this.mergeCalls = 0;
    this.removeCalls = 0;
    this.cleanupCalls = 0;
  }

  async repositoryKey() { return "fake-main"; }
  async inspect(input) { return safeInspection(input); }
  async merge() {
    this.mergeCalls += 1;
    return { ok: true, exitCode: 0, stdout: "", stderr: "" };
  }
  async removeWorktree() {
    this.removeCalls += 1;
    return { ok: true, exitCode: 0, stdout: "", stderr: "" };
  }
  async cleanupMergedBranch({ branch }) {
    this.cleanupCalls += 1;
    return { disposition: "deleted", branch, message: "deleted" };
  }
}

function persistence(directory, name = "runtime") {
  return {
    storage: createNodeFsStorageAdapterV1(),
    agentProjectionPath: join(directory, `${name}-agents.json`),
    planPath: join(directory, `${name}-plan.json`),
    worktreeFinalizationsPath: join(directory, `${name}-worktrees.json`),
  };
}

test("runtime bridge persists agent/plan projections, preserves run IDs, serves display snapshots, and contains callback errors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-host-runtime-"));
  const projectionEvents = [];
  const planEvents = [];
  const runtimeErrors = [];
  const finalizations = [];
  const statePaths = persistence(directory);
  const runtime = createSubagentHostRuntimeV1({
    sessionCapability: capability,
    persistence: statePaths,
    callbacks: {
      onJobsSnapshot(notification) {
        projectionEvents.push(notification);
        if (notification.event?.agentId === "callback-error") throw new Error("consumer exploded");
      },
      onPlan(notification) { planEvents.push(notification); },
      onWorktreeFinalization(notification) { finalizations.push(notification); },
      onError(error) { runtimeErrors.push(error); },
    },
  });

  const { port } = await runtime.start();
  try {
    const start = await post(port, command("agent_event", {
      event: agentEvent("start", "reused-agent", "run-one", {
        name: "worker",
        task: "first implementation",
        title: "First",
        worktreePath: "/tmp/worker-one",
        worktreeBranch: "pipiui/worker-one",
      }),
    }));
    assert.equal(start.status, 200);
    assert.equal(start.body.ok, true);
    assert.equal(start.body.result.agentId, "reused-agent");
    assert.equal(start.body.result.runId, "run-one");

    const update = await post(port, command("agent_event", {
      event: agentEvent("update", "reused-agent", "run-one", {
        output: "working",
        activity: "editing runtime",
        cost: 0.5,
        turns: 2,
      }),
    }));
    assert.equal(update.body.accepted, true);

    const logDelta = await post(port, command("agent_event", {
      event: agentEvent("log_delta", "reused-agent", "run-one", {
        contentIndex: 0,
        itemType: "text",
        text: "streamed first failure",
      }),
    }));
    assert.equal(logDelta.body.accepted, true);
    const log = await post(port, command("agent_event", {
      event: agentEvent("log", "reused-agent", "run-one", {
        items: [{ itemType: "tool", name: "swift", text: "swift test" }],
      }),
    }));
    assert.equal(log.body.accepted, true);
    const usage = await post(port, command("agent_event", {
      event: agentEvent("usage", "reused-agent", "run-one", {
        turn: 1,
        model: "openai-codex/gpt-5.6",
        tools: ["swift"],
        usage: { input: 100, output: 20, cost: 0.01, contextTokens: 120 },
      }),
    }));
    assert.equal(usage.body.accepted, true);

    const stalled = await post(port, command("agent_event", {
      event: agentEvent("stalled", "reused-agent", "run-one", { idle: 42, stalled: true, activity: "waiting" }),
    }));
    assert.equal(stalled.body.accepted, true);

    const ended = await post(port, command("agent_event", {
      event: agentEvent("end", "reused-agent", "run-one", {
        ok: false,
        output: "first failure retained for review",
        worktreePath: "/tmp/worker-one",
        worktreeBranch: "pipiui/worker-one",
      }),
    }));
    assert.equal(ended.body.accepted, true);
    const closeout = await post(port, command("agent_event", {
      event: agentEvent("closeout", "reused-agent", "run-one", {
        disposition: "cleaned",
        reason: "boss reviewed the first failure",
        closeoutAt: 1786320005000,
      }),
    }));
    assert.equal(closeout.body.accepted, true);
    assert.equal(finalizations.length, 0, "worktree finalization must be disabled by default and closeout must not become a scheduler");

    const secondStart = await post(port, command("agent_event", {
      event: agentEvent("start", "reused-agent", "run-two", { name: "worker", task: "second implementation" }),
    }));
    assert.equal(secondStart.body.result.runId, "run-two");
    const secondUpdate = await post(port, command("agent_event", {
      event: agentEvent("update", "reused-agent", "run-two", { output: "second live output", activity: "working" }),
    }));
    assert.equal(secondUpdate.body.accepted, true);

    // Reuse then deliver late old-run packets. Exact run identity may refine the
    // old terminal history, but cannot mutate run-two's active display row.
    const lateOldUpdate = await post(port, command("agent_event", {
      event: agentEvent("update", "reused-agent", "run-one", { output: "late old output", activity: "old-only" }),
    }));
    assert.equal(lateOldUpdate.body.accepted, true);
    const lateOldEnd = await post(port, command("agent_event", {
      event: agentEvent("end", "reused-agent", "run-one", { ok: false, output: "late old terminal" }),
    }));
    assert.equal(lateOldEnd.body.accepted, true);
    const duplicateOldCloseout = await post(port, command("agent_event", {
      event: agentEvent("closeout", "reused-agent", "run-one", {
        disposition: "cleaned",
        reason: "late duplicate must not replace the first reason",
        closeoutAt: 1786320006000,
      }),
    }));
    assert.equal(duplicateOldCloseout.body.accepted, true);

    const callbackFailure = await post(port, command("agent_event", {
      event: agentEvent("start", "callback-error", "run-callback", { name: "worker", task: "callback coverage" }),
    }));
    assert.equal(callbackFailure.status, 200);
    assert.equal(callbackFailure.body.ok, true, "a display callback cannot roll back a persisted event");
    assert.equal(callbackFailure.body.accepted, true);
    assert.ok(callbackFailure.body.diagnostics.some((entry) => entry.code === "callback_failed"));
    assert.ok(runtimeErrors.some((entry) => entry.code === "callback_failed"));

    const publish = await post(port, command("plan_event", {
      event: {
        schemaVersion: 1,
        event: "publish",
        plan: {
          id: "runtime-plan",
          title: "Runtime plan",
          tasks: [{ id: "facade", title: "Build facade", state: "pending" }],
        },
      },
    }));
    assert.deepEqual(
      { ok: publish.body.ok, applied: publish.body.applied, revision: publish.body.revision },
      { ok: true, applied: true, revision: 1 },
    );
    const approve = await post(port, command("plan_event", {
      event: { schemaVersion: 1, event: "approve", planId: "runtime-plan" },
    }));
    assert.equal(approve.body.revision, 2);
    const taskUpdate = await post(port, command("plan_event", {
      event: {
        schemaVersion: 1,
        event: "task_update",
        planId: "runtime-plan",
        task: { id: "facade", state: "completed", detail: "done" },
      },
    }));
    assert.equal(taskUpdate.body.revision, 3);
    const rejectedPlan = await post(port, command("plan_event", {
      event: {
        schemaVersion: 1,
        event: "task_update",
        planId: "runtime-plan",
        task: { id: "missing-task", state: "running" },
      },
    }));
    assert.deepEqual(
      { ok: rejectedPlan.body.ok, applied: rejectedPlan.body.applied, currentRevision: rejectedPlan.body.currentRevision },
      { ok: false, applied: false, currentRevision: 3 },
      "rejected plan observations retain the reducer-owned revision response",
    );
    assert.ok(planEvents.some((entry) => entry.source === "plan_event" && entry.plan?.revision === 3));

    const extensionSnapshot = await runtime.applyExtensionSnapshot({
      schemaVersion: 1,
      generatedAt: "2026-08-10T00:00:00.000Z",
      jobs: [{
        agentId: "reused-agent",
        runId: "run-two",
        name: "worker",
        task: "second implementation",
        state: "running",
        activity: "extension-authoritative",
        cost: 1,
        turns: 3,
      }],
    });
    assert.equal(extensionSnapshot.ok, true);
    assert.ok(projectionEvents.some((entry) => entry.source === "extension_snapshot"));

    const snapshot = await post(port, command("snapshot", { requestId: "display-snapshot" }));
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.body.action, "snapshot");
    const firstRun = snapshot.body.jobs.find((job) => job.agentId === "reused-agent" && job.runId === "run-one");
    const secondRun = snapshot.body.jobs.find((job) => job.agentId === "reused-agent" && job.runId === "run-two");
    assert.equal(firstRun.state, "failed", "old terminal run remains separate after agentId reuse");
    assert.equal(firstRun.resultText, "late old terminal");
    assert.equal(firstRun.closeoutDisposition, "cleaned");
    assert.equal(firstRun.closeoutReason, "boss reviewed the first failure", "duplicate closeout is idempotent");
    assert.equal(firstRun.closeoutAt, 1786320005000);
    assert.equal(secondRun.state, "running");
    assert.equal(secondRun.activity, "extension-authoritative");
  } finally {
    await runtime.stop();
  }

  const reloaded = createSubagentHostRuntimeV1({ sessionCapability: capability, persistence: statePaths });
  try {
    const loaded = await reloaded.load();
    assert.equal(loaded.agents.status, "loaded");
    assert.equal(loaded.plan.status, "loaded");
    assert.equal(loaded.plan.state.plan.revision, 3);
    const firstRun = loaded.snapshot.jobs.find((job) => job.agentId === "reused-agent" && job.runId === "run-one");
    const secondRun = loaded.snapshot.jobs.find((job) => job.agentId === "reused-agent" && job.runId === "run-two");
    assert.equal(firstRun.state, "failed");
    assert.equal(firstRun.closeoutDisposition, "cleaned");
    assert.equal(firstRun.closeoutReason, "boss reviewed the first failure");
    assert.equal(secondRun.state, "interrupted", "reloading only reconciles display projection; it never resumes a worker");
  } finally {
    await reloaded.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("runtime bounds subscriber callbacks without blocking later observations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-host-runtime-callback-timeout-"));
  const errors = [];
  const runtime = createSubagentHostRuntimeV1({
    sessionCapability: capability,
    persistence: persistence(directory, "callbacks"),
    callbackTimeoutMs: 20,
    callbacks: {
      onJobsSnapshot(notification) {
        if (notification.event?.agentId === "hang") return new Promise(() => {});
      },
      onError(error) { errors.push(error); },
    },
  });
  try {
    const hanging = await runtime.applyAgentEvent(agentEvent("start", "hang", "run-hang", { name: "worker", task: "bounded callback" }));
    assert.equal(hanging.accepted, true);
    assert.ok(hanging.diagnostics.some((entry) => entry.code === "callback_timeout"));
    const after = await runtime.applyAgentEvent(agentEvent("start", "after", "run-after", { name: "worker", task: "still processes" }));
    assert.equal(after.accepted, true);
    assert.ok(errors.some((entry) => entry.code === "callback_timeout"));
  } finally {
    await runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("runtime gives each subscriber an isolated jobs snapshot copy", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-host-runtime-copies-"));
  const observedTasks = [];
  const runtime = createSubagentHostRuntimeV1({
    sessionCapability: capability,
    persistence: persistence(directory, "copies"),
    callbacks: {
      onJobsSnapshot(notification) {
        if (notification.source === "agent_event") notification.snapshot.jobs[0].task = "tampered";
      },
    },
  });
  runtime.subscribe({
    onJobsSnapshot(notification) {
      if (notification.source === "agent_event") observedTasks.push(notification.snapshot.jobs[0].task);
    },
  });
  try {
    const applied = await runtime.applyAgentEvent(agentEvent("start", "copies", "run-copies", {
      name: "worker",
      task: "original task",
    }));
    assert.equal(applied.accepted, true);
    assert.deepEqual(observedTasks, ["original task"]);
    assert.equal(runtime.snapshot({ generatedAt: "2026-08-10T00:00:00.000Z" }).jobs[0].task, "original task");
  } finally {
    await runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("runtime serializes concurrent start/stop calls around an ephemeral loopback port", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-host-runtime-lifecycle-"));
  const runtime = createSubagentHostRuntimeV1({
    sessionCapability: capability,
    persistence: persistence(directory, "lifecycle"),
  });
  try {
    const [first, second] = await Promise.all([
      runtime.start({ load: false }),
      runtime.start({ load: false }),
    ]);
    assert.equal(first.port, second.port, "concurrent starts share one actual ephemeral listener");
    assert.equal(first.host, "127.0.0.1");
    await runtime.stop();

    const starting = runtime.start({ load: false });
    const stopping = runtime.stop();
    const stoppingPort = (await starting).port;
    await stopping;
    await assert.rejects(() => fetch(`http://127.0.0.1:${stoppingPort}/rpc`));

    const restarted = await runtime.start({ load: false });
    const snapshot = await post(restarted.port, command("snapshot", { requestId: "lifecycle-restart" }));
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.body.ok, true);
  } finally {
    await runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("worktree finalization is opt-in, persists structured results, and reuses the injected service", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-host-runtime-worktree-"));
  const disabledFinalizations = [];
  const disabled = createSubagentHostRuntimeV1({
    sessionCapability: capability,
    persistence: persistence(directory, "disabled"),
    callbacks: { onWorktreeFinalization: (notification) => disabledFinalizations.push(notification) },
  });
  try {
    await disabled.applyAgentEvent(agentEvent("start", "disabled-agent", "run-disabled", {
      name: "worker",
      task: "must not merge",
      worktreePath: "/tmp/disabled-worker",
      worktreeBranch: "pipiui/disabled-worker",
    }));
    const ended = await disabled.applyAgentEvent(agentEvent("end", "disabled-agent", "run-disabled", {
      ok: true,
      worktreePath: "/tmp/disabled-worker",
      worktreeBranch: "pipiui/disabled-worker",
    }));
    assert.equal(ended.finalization, undefined);
    assert.equal(disabledFinalizations.length, 0, "no config means no automatic Git/finalization path");
  } finally {
    await disabled.stop();
  }

  const adapter = new FakeWorktreeAdapter();
  const service = new WorktreeFinalizationServiceV1({ adapter });
  const finalizations = [];
  const statePaths = persistence(directory, "enabled");
  const enabled = createSubagentHostRuntimeV1({
    sessionCapability: capability,
    persistence: statePaths,
    worktreeFinalization: {
      enabled: true,
      mainCwd: "/tmp/electron-main",
      ownership: { mode: "isolated", role: "worker" },
      service,
    },
    callbacks: { onWorktreeFinalization: (notification) => finalizations.push(notification) },
  });
  try {
    await enabled.applyAgentEvent(agentEvent("start", "enabled-agent", "run-enabled", {
      name: "worker",
      task: "safe merge",
      worktreePath: "/tmp/enabled-worker",
      worktreeBranch: "pipiui/enabled-worker",
    }));
    const ended = await enabled.applyAgentEvent(agentEvent("end", "enabled-agent", "run-enabled", {
      ok: true,
      worktreePath: "/tmp/enabled-worker",
      worktreeBranch: "pipiui/enabled-worker",
    }));
    assert.equal(ended.finalization.result.disposition, "merged");
    assert.equal(adapter.mergeCalls, 1);
    assert.equal(adapter.removeCalls, 1);
    assert.equal(adapter.cleanupCalls, 1);
    assert.equal(finalizations.length, 1);
    assert.equal(finalizations[0].persisted, true);

    const reloaded = createSubagentHostRuntimeV1({
      sessionCapability: capability,
      persistence: statePaths,
      worktreeFinalization: {
        enabled: true,
        mainCwd: "/tmp/electron-main",
        ownership: { mode: "isolated", role: "worker" },
        service,
      },
    });
    const loaded = await reloaded.load();
    assert.equal(loaded.worktreeFinalizations.status, "loaded");
    assert.equal(Object.keys(loaded.worktreeFinalizations.state.recordsByRunKey).length, 1);
    assert.equal(adapter.mergeCalls, 1, "loading a persisted finalization is descriptive and never re-merges");
    await reloaded.stop();
  } finally {
    await enabled.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
