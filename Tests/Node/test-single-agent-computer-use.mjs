import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createTaskCheckpoint,
  reconcileTaskCheckpoint,
} from "../../Electron/resources/runtime/pi-ext/packages/computer-agent/src/checkpoint.ts";
import {
  mutationLimitFor,
  runGuardedActionBlock,
  validateActionBlockRequest,
} from "../../Electron/resources/runtime/pi-ext/packages/computer-agent/src/action-block.ts";
import {
  WorkflowMemoryStore,
  canonicalSensitiveApplicationPolicy,
} from "../../Electron/resources/runtime/pi-ext/packages/computer-agent/src/workflows.ts";
import { ComputerWorkerBroker } from "../../Electron/resources/runtime/pi-ext/packages/computer-agent/src/worker-broker.ts";
import { ComputerWorkerBrokerServer } from "../../Electron/resources/runtime/pi-ext/packages/computer-agent/src/worker-broker-server.ts";
import {
  registerComputerWorkerTools,
  toolNamesForComputerUseAgent,
} from "../../Electron/resources/runtime/pi-ext/packages/computer-agent/extensions/computer-worker.ts";

const observation = (id, overrides = {}) => ({
  observationId: id,
  target: { bundleId: "com.example.Editor", appName: "Editor", pid: 42, window_id: 7 },
  accessibility: {
    snapshot_id: `snapshot-${id}`,
    windows: [{ id: 7, role: "AXWindow" }],
    elements: [
      { role: "AXButton", name: "Continue", element_token: `token-${id}`, element_index: 1 },
    ],
  },
  ...overrides,
});

test("normal computer_task has one goal parameter and one non-delegating Computer Use Agent episode", async () => {
  const source = await readFile(new URL("../../Electron/resources/runtime/pi-ext/subagent/index.ts", import.meta.url), "utf8");
  const start = source.indexOf("function registerComputerTaskTool(");
  const end = source.indexOf("function registerLedgerNoteTool", start);
  assert.ok(start >= 0 && end > start, "computer_task registration seam remains discoverable");
  const block = source.slice(start, end);
  assert.match(block, /Type\.Object\(\{\s*goal:\s*Type\.String/);
  assert.doesNotMatch(block, /agentId:\s*Type\.Optional|recoveryPolicy:\s*Type\.Optional|procedureContext/);
  assert.match(block, /runSingleAgent\([^,]+,\s*computerAgents,\s*"computer-use"/);
  assert.doesNotMatch(block, /ComputerAgentCoordinator|computer-use-leader|computer-verifier|computer-terminal|runLeader|dispatcher|one_state_mutation_per_observation/);
  assert.match(block, /computerAgent:\s*\{/);
  assert.match(block, /episodeCount:\s*1/);
});

test("old global Procedure Store is not injected into the normal Pi spawn", async () => {
  const source = await readFile(new URL("../../Electron/packages/pi-backend/src/spawn-assembly.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /PIPIUI_COMPUTER_PROCEDURE_STORE/);
  assert.match(source, /PIPIUI_ACTIVE_PROJECT_PI_HOME/);
  assert.match(source, /input\.agentDir/);
});

test("Computer Use Agent broker grant carries no raw Host capability and mounts exactly three desktop tools", async () => {
  const runtimeRequests = [];
  const broker = new ComputerWorkerBroker({
    tokenFactory: () => "t".repeat(48),
    request: async (request) => {
      runtimeRequests.push(request);
      return observation(`runtime-${runtimeRequests.length}`);
    },
  });
  const issued = broker.issue({
    taskId: "single-task",
    stepId: "episode",
    runId: "single-run",
    role: "computer-use-agent",
    goal: "Continue safely",
  });
  assert.deepEqual(Object.keys(issued.environment).sort(), [
    "PIPIUI_COMPUTER_WORKER_ROLE",
    "PIPIUI_COMPUTER_WORKER_STEP_ID",
    "PIPIUI_COMPUTER_WORKER_TASK_ID",
    "PIPIUI_COMPUTER_WORKER_BROKER_TOKEN",
  ].sort());
  assert.equal("PIPIUI_COMPUTER_CAPABILITY" in issued.environment, false);
  await broker.execute(issued.token, {
    operation: "observe",
    payload: {
      fresh: true,
      constraints: ["do not leave the target application"],
      successConditions: [{ kind: "visible_text", contains: "Done" }],
    },
  });
  const result = await broker.execute(issued.token, {
    operation: "actionBlock",
    payload: {
      intent: "continue once",
      actions: [{ id: "continue", type: "click", target: { by: "accessibility", role: "AXButton", name: "Continue" } }],
    },
  });
  assert.equal(result.outcome, "completed");
  assert.equal(runtimeRequests.every(({ taskId, stepId, runId }) => taskId === "single-task" && stepId === "episode" && runId === "single-run"), true);
  assert.deepEqual(toolNamesForComputerUseAgent(), ["desktop_observe", "desktop_open_application", "desktop_run_action_block"]);
  const registered = [];
  registerComputerWorkerTools({ registerTool: (tool) => registered.push(tool.name) }, {
    PIPIUI_COMPUTER_WORKER_BROKER_URL: "http://127.0.0.1:12345/v1/computer-worker",
    PIPIUI_COMPUTER_WORKER_BROKER_TOKEN: "t".repeat(48),
    PIPIUI_COMPUTER_WORKER_ROLE: "computer-use-agent",
  });
  assert.deepEqual(registered, toolNamesForComputerUseAgent());
});

test("Computer Use Agent may take more than three fresh observations and continue", async () => {
  let runtimeCalls = 0;
  const broker = new ComputerWorkerBroker({
    tokenFactory: () => "o".repeat(48),
    request: async () => observation(`observe-budget-${++runtimeCalls}`),
  });
  const issued = broker.issue({
    taskId: "single-observe-budget",
    stepId: "episode",
    runId: "single-observe-budget-run",
    role: "computer-use-agent",
    goal: "Wait for the application to become ready, then continue",
  });

  for (let index = 0; index < 5; index += 1) {
    const fresh = await broker.execute(issued.token, { operation: "observe", payload: { fresh: true } });
    assert.equal(fresh.observationId, `observe-budget-${index + 1}`);
  }
  const result = await broker.execute(issued.token, {
    operation: "actionBlock",
    payload: {
      intent: "continue after benign observation changes",
      actions: [{ id: "continue", type: "key", keys: ["RETURN"] }],
    },
  });

  assert.equal(result.outcome, "completed");
  assert.equal(runtimeCalls, 6);
});

test("Computer Use Agent reconciles a mutation transport timeout without poisoning its grant", async () => {
  const runtimeRequests = [];
  const fatalEvents = [];
  const cancellations = [];
  const broker = new ComputerWorkerBroker({
    requestTimeoutMs: 10,
    tokenFactory: () => "u".repeat(48),
    onFatal: (event) => fatalEvents.push(event),
    cancelRuntime: async (event) => cancellations.push(event),
    request: async (request) => {
      runtimeRequests.push(request);
      if (runtimeRequests.length === 2) return new Promise(() => {});
      return observation(`timeout-recovery-${runtimeRequests.length}`);
    },
  });
  const issued = broker.issue({
    taskId: "single-timeout",
    stepId: "episode",
    runId: "single-timeout-run",
    role: "computer-use-agent",
    goal: "Save once, then continue",
  });
  await broker.execute(issued.token, { operation: "observe", payload: { fresh: true } });
  const block = {
    intent: "save and continue",
    actions: [
      { id: "save", type: "key", keys: ["CMD", "S"], consequential: true },
      { id: "tail", type: "key", keys: ["RETURN"] },
    ],
  };

  const first = await broker.execute(issued.token, { operation: "actionBlock", payload: block });
  assert.equal(first.outcome, "outcome_unknown");
  assert.equal(first.stopReason, "outcome_unknown");
  assert.deepEqual(first.completedActionIds, []);
  assert.deepEqual(first.skippedActionIds, ["tail"]);
  assert.equal(first.effects[0].actionId, "save");
  assert.equal(first.effects[0].status, "unknown");
  assert.equal(first.checkpoint.pendingUnknownEffects.length, 1);
  assert.equal(first.checkpoint.pendingUnknownEffects[0].actionId, "save");
  assert.equal(runtimeRequests.length, 2, "the block tail is not dispatched after an unknown mutation effect");
  assert.deepEqual(cancellations, [{
    taskId: "single-timeout",
    stepId: "episode",
    runId: "single-timeout-run",
    reason: "computer_worker_runtime_timeout",
  }], "a timed-out Host mutation is cancelled before the same agent reconciles fresh state");

  const replay = await broker.execute(issued.token, { operation: "actionBlock", payload: block });
  assert.equal(replay.outcome, "stopped");
  assert.equal(replay.stopReason, "consequential_effect_pending");
  assert.equal(runtimeRequests.length, 2, "a consequential unknown effect is not blindly replayed");

  const reconciled = await broker.execute(issued.token, { operation: "observe", payload: { fresh: true } });
  assert.equal(reconciled.observationId, "timeout-recovery-3");
  assert.equal(reconciled.checkpoint.pendingUnknownEffects.length, 1);
  assert.deepEqual(fatalEvents, []);
});

test("accessibility targets accept the macOS description field used by Calculator buttons", async () => {
  const calls = [];
  const calculator = observation("calculator-before", {
    target: { bundleId: "com.apple.calculator", appName: "Calculator", pid: 99, window_id: 4 },
    accessibility: {
      snapshot_id: "calculator-snapshot",
      windows: [{ id: 4, role: "AXWindow" }],
      elements: [{ role: "AXButton", description: "全部清除", element_index: 8 }],
    },
  });
  const result = await runGuardedActionBlock({
    intent: "clear Calculator",
    actions: [{ id: "clear", type: "click", target: { by: "accessibility", role: "AXButton", name: "全部清除" } }],
  }, {
    taskId: "calculator-description",
    runId: "calculator-description-run",
    maturity: "cold",
    checkpoint: createTaskCheckpoint({ taskId: "calculator-description", goal: "clear Calculator" }),
    observation: calculator,
    execute: async (actions) => {
      calls.push(actions);
      return { ...calculator, observationId: "calculator-after", ok: true };
    },
  });
  assert.equal(result.outcome, "completed");
  assert.equal(calls[0][0].element_index, 8);
  assert.equal(calls[0][0].snapshot_id, "calculator-snapshot");
});

test("visual regions are observation-bound coordinates instead of an always-failing pseudo locator", async () => {
  const calls = [];
  const checkpoint = createTaskCheckpoint({ taskId: "visual-region", goal: "click visible button" });
  const result = await runGuardedActionBlock({
    intent: "click the visually identified button",
    actions: [{
      id: "visual-click",
      type: "click",
      target: {
        by: "visual",
        description: "blue Continue button",
        observationId: "visual-before",
        region: { x: 100, y: 200, width: 40, height: 20 },
      },
    }],
  }, {
    taskId: "visual-region",
    runId: "visual-region-run",
    maturity: "cold",
    checkpoint,
    observation: observation("visual-before"),
    execute: async (actions) => {
      calls.push(actions);
      return { ...observation("visual-after"), ok: true };
    },
  });
  assert.equal(result.outcome, "completed");
  assert.deepEqual(calls[0][0].coordinate, [120, 210]);

  const stale = await runGuardedActionBlock({
    intent: "do not click a stale visual region",
    actions: [{
      id: "stale-visual",
      type: "click",
      target: {
        by: "visual",
        description: "old button",
        observationId: "old-observation",
        region: { x: 0, y: 0, width: 20, height: 20 },
      },
    }],
  }, {
    taskId: "stale-visual",
    runId: "stale-visual-run",
    maturity: "cold",
    checkpoint: createTaskCheckpoint({ taskId: "stale-visual", goal: "do not click stale UI" }),
    observation: observation("fresh-observation"),
    execute: async () => { throw new Error("stale visual action reached Runtime"); },
  });
  assert.equal(stale.stopReason, "stale_locator");
});

test("Computer Use Agent observe transport timeout is recoverable on the same grant", async () => {
  let calls = 0;
  const fatalEvents = [];
  const broker = new ComputerWorkerBroker({
    tokenFactory: () => "r".repeat(48),
    onFatal: (event) => fatalEvents.push(event),
    request: async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("private typed transport timeout"), { code: "cua_driver_rpc_timeout" });
      return observation("observe-timeout-recovered");
    },
  });
  const server = new ComputerWorkerBrokerServer(broker);
  await server.start();
  try {
    const issued = server.issue({
      taskId: "single-observe-timeout",
      stepId: "episode",
      runId: "single-observe-timeout-run",
      role: "computer-use-agent",
      goal: "Observe until the application is stable",
    });
    const registered = [];
    registerComputerWorkerTools({ registerTool: (tool) => registered.push(tool) }, issued.environment);
    const desktopObserve = registered.find(({ name }) => name === "desktop_observe");

    await assert.rejects(desktopObserve.execute("timed-out", { fresh: true }, undefined), /^Error: computer_worker_runtime_timeout$/);
    const recovered = await desktopObserve.execute("reconciled", { fresh: true }, undefined);
    assert.equal(recovered.details.observationId, "observe-timeout-recovered");
    assert.equal(calls, 2);
    assert.deepEqual(fatalEvents, []);
  } finally {
    await server.stop();
  }
});

test("legacy timeout and Computer Use Agent cancellation remain fatal at the child tool boundary", async () => {
  const registerObserve = (role, firstError) => {
    const registered = [];
    let fetchCalls = 0;
    registerComputerWorkerTools({ registerTool: (tool) => registered.push(tool) }, {
      PIPIUI_COMPUTER_WORKER_BROKER_URL: "http://127.0.0.1:1/v1/computer-worker",
      PIPIUI_COMPUTER_WORKER_BROKER_TOKEN: "f".repeat(48),
      PIPIUI_COMPUTER_WORKER_ROLE: role,
    }, async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify(fetchCalls === 1
        ? { ok: false, error: firstError }
        : observation(`${role}-unexpected-retry`)), {
        status: fetchCalls === 1 ? 500 : 200,
        headers: { "content-type": "application/json" },
      });
    });
    return { observe: registered.find(({ name }) => name === "desktop_observe"), fetchCalls: () => fetchCalls };
  };

  const legacy = registerObserve("gui-operator", "computer_worker_runtime_timeout");
  await assert.rejects(legacy.observe.execute("legacy-timeout", { fresh: true }, undefined), /^Error: computer_worker_runtime_timeout$/);
  await assert.rejects(legacy.observe.execute("legacy-retry", { fresh: true }, undefined), /^Error: computer_worker_runtime_timeout$/);
  assert.equal(legacy.fetchCalls(), 1);

  const cancelled = registerObserve("computer-use-agent", "computer_worker_request_cancelled");
  await assert.rejects(cancelled.observe.execute("single-cancelled", { fresh: true }, undefined), /^Error: computer_worker_request_cancelled$/);
  await assert.rejects(cancelled.observe.execute("single-retry", { fresh: true }, undefined), /^Error: computer_worker_request_cancelled$/);
  assert.equal(cancelled.fetchCalls(), 1);
});

test("Workflow learning requires Host-verified checkpoint conditions, not only the Agent final claim", async () => {
  const learned = [];
  let mutationVerified = false;
  const workflowMemory = {
    recall: async () => ({ entries: [], isolatedRecords: [] }),
    recordAutonomousSuccess: async (input) => { learned.push(input); return { id: "workflow:test", version: 1, state: "candidate" }; },
  };
  const broker = new ComputerWorkerBroker({
    workflowMemory,
    tokenFactory: () => "w".repeat(48),
    request: async (request) => observation(`learn-${request.action}-${learned.length}`, {
      target: { bundleId: "com.example.Editor", appName: "Editor", pid: 42, window_id: 7 },
      accessibility: {
        snapshot_id: "learn-snapshot",
        windows: [{ id: 7, role: "AXWindow" }],
        elements: mutationVerified
          ? [{ role: "AXStaticText", name: "Done" }]
          : [{ role: "AXButton", name: "Continue", element_token: "learn-token", element_index: 1 }],
      },
    }),
  });
  const first = broker.issue({ taskId: "unverified", stepId: "episode", runId: "run-unverified", role: "computer-use-agent", goal: "continue" });
  await broker.execute(first.token, { operation: "openApplication", payload: { bundle_identifier: "com.example.Editor", application_name: "Editor" } });
  await broker.execute(first.token, { operation: "actionBlock", payload: { intent: "continue", actions: [{ id: "continue", type: "key", keys: ["RETURN"] }] } });
  await broker.recordTaskSuccess("unverified", "episode");
  assert.equal(learned.length, 0);

  const second = broker.issue({ taskId: "verified", stepId: "episode", runId: "run-verified", role: "computer-use-agent", goal: "continue" });
  await broker.execute(second.token, { operation: "openApplication", payload: { bundle_identifier: "com.example.Editor", application_name: "Editor" } });
  await broker.execute(second.token, { operation: "observe", payload: { fresh: true, successConditions: [{ kind: "visible_text", contains: "Done" }] } });
  mutationVerified = true;
  await broker.execute(second.token, { operation: "actionBlock", payload: { intent: "continue", actions: [{ id: "continue", type: "key", keys: ["RETURN"] }] } });
  await broker.recordTaskSuccess("verified", "episode");
  assert.equal(learned.length, 1);
  assert.equal(learned[0].taskId, "verified");
});

test("action-block pacing is Host-owned at Cold 2, Candidate 4, and Practiced 12 mutations", () => {
  assert.equal(mutationLimitFor("cold"), 2);
  assert.equal(mutationLimitFor("candidate"), 4);
  assert.equal(mutationLimitFor("practiced"), 12);
  const mutations = (count) => Array.from({ length: count }, (_, index) => ({
    id: `a-${index}`,
    type: "click",
    target: { by: "accessibility", role: "AXButton", name: "Continue" },
  }));
  assert.throws(() => validateActionBlockRequest({ intent: "cold", actions: mutations(3) }, "cold"), /cold.*2/i);
  assert.doesNotThrow(() => validateActionBlockRequest({ intent: "candidate", actions: mutations(4) }, "candidate"));
  assert.throws(() => validateActionBlockRequest({ intent: "candidate", actions: mutations(5) }, "candidate"), /candidate.*4/i);
  assert.doesNotThrow(() => validateActionBlockRequest({ intent: "practiced", actions: mutations(12) }, "practiced"));
  assert.throws(() => validateActionBlockRequest({ intent: "practiced", actions: mutations(13) }, "practiced"), /practiced.*12/i);
  assert.doesNotThrow(() => validateActionBlockRequest({
    intent: "waits do not consume mutation budget",
    actions: [...mutations(2), { id: "settle", type: "wait_until", condition: { kind: "visible_text", contains: "Ready" }, timeoutMs: 20_000 }],
  }, "cold"));
});

test("guarded block resolves semantic locators just in time and stops its tail on topology barrier", async () => {
  const calls = [];
  const checkpoint = createTaskCheckpoint({ taskId: "task-1", goal: "continue safely" });
  const result = await runGuardedActionBlock({
    intent: "continue then type",
    actions: [
      { id: "continue", type: "click", target: { by: "accessibility", role: "AXButton", name: "Continue" } },
      { id: "type", type: "type", text: "hello" },
    ],
  }, {
    taskId: "task-1",
    runId: "run-1",
    maturity: "cold",
    checkpoint,
    observation: observation("before"),
    execute: async (actions) => {
      calls.push(actions);
      return {
        ...observation("modal", {
          accessibility: {
            snapshot_id: "snapshot-modal",
            modal_window_id: 9,
            windows: [{ id: 7, role: "AXWindow" }, { id: 9, role: "AXSheet" }],
            elements: [],
          },
        }),
        ok: true,
        batchInterrupted: true,
        interruptionReason: "actionable_context_changed",
        completedActions: 1,
      };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].element_token, "token-before");
  assert.equal(calls[0][0].snapshot_id, "snapshot-before");
  assert.deepEqual(result.completedActionIds, ["continue"]);
  assert.deepEqual(result.skippedActionIds, ["type"]);
  assert.equal(result.outcome, "stopped");
  assert.equal(result.stopReason, "topology_changed");
  assert.match(result.receiptRef, /^receipt:/);
});

test("guarded block skips a user-completed effect and executes only the shortest safe suffix", async () => {
  const calls = [];
  const alreadyFilled = observation("filled", {
    accessibility: {
      snapshot_id: "snapshot-filled",
      windows: [{ id: 7, role: "AXWindow" }],
      elements: [
        { role: "AXTextField", name: "Title", value: "Already done", element_token: "field-filled", element_index: 2 },
        { role: "AXButton", name: "Save", element_token: "save-filled", element_index: 3 },
      ],
    },
  });
  const result = await runGuardedActionBlock({
    intent: "fill and save",
    actions: [
      { id: "fill", type: "type", text: "Already done", target: { by: "accessibility", role: "AXTextField", name: "Title" } },
      { id: "save", type: "click", target: { by: "accessibility", role: "AXButton", name: "Save" } },
    ],
    expectedEffects: [
      { actionId: "fill", kind: "element_value", role: "AXTextField", name: "Title", value: "Already done" },
    ],
  }, {
    taskId: "task-2",
    runId: "run-2",
    maturity: "cold",
    checkpoint: createTaskCheckpoint({ taskId: "task-2", goal: "fill and save" }),
    observation: alreadyFilled,
    execute: async (actions) => {
      calls.push(actions);
      return { ...observation("saved"), ok: true };
    },
  });
  assert.deepEqual(result.skippedActionIds, ["fill"]);
  assert.deepEqual(result.completedActionIds, ["save"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].element_token, "save-filled");
});

test("stale coordinate bindings fail closed before Runtime and long settle remains block-local", async () => {
  let calls = 0;
  const stale = await runGuardedActionBlock({
    intent: "stale click",
    actions: [{ id: "stale", type: "click", target: { by: "coordinate", x: 10, y: 20, observationId: "old" } }],
  }, {
    taskId: "task-3",
    runId: "run-3",
    maturity: "cold",
    checkpoint: createTaskCheckpoint({ taskId: "task-3", goal: "stale click" }),
    observation: observation("fresh"),
    execute: async () => { calls += 1; return { ok: true }; },
  });
  assert.equal(calls, 0);
  assert.equal(stale.stopReason, "stale_locator");

  const executed = [];
  const settled = await runGuardedActionBlock({
    intent: "click then wait for long settle",
    actions: [
      { id: "click", type: "click", target: { by: "accessibility", role: "AXButton", name: "Continue" } },
      { id: "settle", type: "wait_until", condition: { kind: "visible_text", contains: "Ready" }, timeoutMs: 20_000 },
    ],
  }, {
    taskId: "task-4",
    runId: "run-4",
    maturity: "cold",
    checkpoint: createTaskCheckpoint({ taskId: "task-4", goal: "wait" }),
    observation: observation("start"),
    execute: async (actions) => {
      executed.push(actions[0]);
      return { ...observation(`after-${executed.length}`, executed.length === 2 ? {
        accessibility: { snapshot_id: "snapshot-ready", windows: [{ id: 7, role: "AXWindow" }], elements: [{ role: "AXStaticText", name: "Ready" }] },
      } : {}), ok: true };
    },
  });
  assert.equal(settled.outcome, "completed");
  assert.deepEqual(executed.map(({ type }) => type), ["click", "wait"]);
});

test("raw stale element tokens are rejected and target drift stops the guarded tail", async () => {
  assert.throws(() => validateActionBlockRequest({
    intent: "do not trust a model-carried token",
    actions: [{ id: "stale-token", type: "click", element_token: "stale", snapshot_id: "old" }],
  }, "cold"), /Host binding field.*element_token/i);
  const calls = [];
  const result = await runGuardedActionBlock({
    intent: "continue without crossing targets",
    actions: [
      { id: "continue", type: "click", target: { by: "accessibility", role: "AXButton", name: "Continue" } },
      { id: "type", type: "type", text: "must not run" },
    ],
  }, {
    taskId: "target-drift-task",
    runId: "target-drift-run",
    maturity: "cold",
    checkpoint: createTaskCheckpoint({ taskId: "target-drift-task", goal: "stay pinned" }),
    observation: observation("before-drift"),
    execute: async (actions) => {
      calls.push(actions);
      return observation("after-drift", { target: { bundleId: "com.example.Other", appName: "Other", pid: 77, window_id: 10 } });
    },
  });
  assert.equal(result.stopReason, "target_drift");
  assert.deepEqual(result.completedActionIds, []);
  assert.deepEqual(result.skippedActionIds, ["continue", "type"]);
  assert.equal(calls.length, 1);
});

test("consequential outcome_unknown is checkpointed and cannot be blindly replayed", async () => {
  const checkpoint = createTaskCheckpoint({ taskId: "task-unknown", goal: "save once" });
  let calls = 0;
  const request = {
    intent: "save once",
    actions: [{ id: "save", type: "key", keys: ["CMD", "S"], consequential: true }],
  };
  const context = {
    taskId: "task-unknown",
    runId: "run-unknown",
    maturity: "cold",
    checkpoint,
    observation: observation("before-save"),
    execute: async () => {
      calls += 1;
      return {
        ...observation("after-unknown"),
        ok: false,
        outcomeUnknown: true,
        runtimeError: { code: "mutation_outcome_unknown", requiresObservation: true },
      };
    },
  };
  const first = await runGuardedActionBlock(request, context);
  assert.equal(first.outcome, "outcome_unknown");
  assert.equal(first.effects[0].status, "unknown");
  assert.equal(checkpoint.pendingUnknownEffects.length, 1);
  const second = await runGuardedActionBlock(request, { ...context, observation: observation("fresh-after-unknown") });
  assert.equal(second.outcome, "stopped");
  assert.equal(second.stopReason, "consequential_effect_pending");
  assert.equal(calls, 1);
});

test("checkpoint reconciliation preserves task anchors and classifies fresh satisfied facts", () => {
  const checkpoint = createTaskCheckpoint({
    taskId: "checkpoint-task",
    goal: "edit and save",
    constraints: ["do not overwrite another file"],
    successConditions: [{ kind: "visible_text", contains: "Saved" }],
  });
  checkpoint.pendingUnknownEffects.push({ actionId: "save", signature: "sig", consequential: true, recordedAt: "2026-08-19T00:00:00.000Z" });
  const reconciled = reconcileTaskCheckpoint(checkpoint, observation("reconciled", {
    accessibility: { snapshot_id: "snapshot-r", windows: [{ id: 7 }], elements: [{ role: "AXStaticText", name: "Saved" }] },
  }));
  assert.equal(reconciled.goal, "edit and save");
  assert.deepEqual(reconciled.constraints, ["do not overwrite another file"]);
  assert.equal(reconciled.verifiedFacts.some(({ description }) => description.includes("Saved")), true);
  assert.equal(reconciled.pendingUnknownEffects.length, 1, "fresh visible success does not guess away a consequential unknown effect");
  assert.equal(reconciled.lastObservationRef, "reconciled");
});

test("Workflow Memory v2 is project-local, promotes after two independent successes, recalls top three, suspends, and isolates corruption", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipiui-workflow-v2-"));
  try {
    const projectA = join(root, "project-a", ".pi", "agent");
    const projectB = join(root, "project-b", ".pi", "agent");
    await mkdir(projectA, { recursive: true });
    await mkdir(projectB, { recursive: true });
    const storeA = new WorkflowMemoryStore(projectA, { isSensitiveApplication: canonicalSensitiveApplicationPolicy });
    const storeB = new WorkflowMemoryStore(projectB, { isSensitiveApplication: canonicalSensitiveApplicationPolicy });
    const base = {
      application: { bundleId: "com.example.Editor", appName: "Editor" },
      taskFamily: "edit-title",
      intent: "edit a title",
      blocks: [{ intent: "edit", actions: [{ id: "edit", type: "type", text: "private-title-8841" }] }],
      postconditions: [{ kind: "visible_text", contains: "Saved" }],
      humanCorrected: false,
    };
    const candidate = await storeA.recordAutonomousSuccess({ ...base, taskId: "task-a1", runId: "run-a1", receiptRef: "receipt:a1" });
    assert.equal(candidate.schemaVersion, 2);
    assert.equal(candidate.state, "candidate");
    assert.doesNotMatch(JSON.stringify(candidate), /private-title-8841|Saved/);
    assert.match(JSON.stringify(candidate), /\{\{input_1\}\}/);
    const practiced = await storeA.recordAutonomousSuccess({ ...base, taskId: "task-a2", runId: "run-a2", receiptRef: "receipt:a2" });
    assert.equal(practiced.state, "practiced");
    assert.equal(practiced.evidence.autonomousSuccessReceipts.length, 2);
    assert.equal((await storeB.recall({ application: base.application, taskFamily: base.taskFamily, intent: base.intent })).entries.length, 0);

    let lastLesson;
    for (let index = 0; index < 4; index += 1) {
      lastLesson = await storeA.recordRecoveryLesson({
        application: base.application,
        taskFamily: base.taskFamily,
        condition: `drift-${index}`,
        alternative: `route-${index}`,
        receiptRef: `receipt:lesson-${index}`,
      });
    }
    const duplicateLesson = await storeA.recordRecoveryLesson({
      application: base.application,
      taskFamily: base.taskFamily,
      condition: "drift-3",
      alternative: "route-3",
      receiptRef: "receipt:duplicate-lesson",
    });
    assert.equal(duplicateLesson.id, lastLesson.id, "lesson dedupe scans the full task family, not only its first record");
    const recalled = await storeA.recall({ application: base.application, taskFamily: base.taskFamily, intent: base.intent });
    assert.equal(recalled.entries.length, 3);
    assert.equal(recalled.entries.filter(({ kind }) => kind === "workflow").length, 1);
    assert.equal(recalled.entries.filter(({ kind }) => kind === "lesson").length, 2);

    await storeA.recordFailure(practiced.id, { kind: "drift" });
    const suspended = await storeA.recordFailure(practiced.id, { kind: "drift" });
    assert.equal(suspended.state, "suspended");
    const repair = await storeA.createRepairCandidate(practiced.id, {
      taskId: "task-repair",
      runId: "run-repair",
      receiptRef: "receipt:repair",
      blocks: [{ intent: "repair", actions: [{ id: "repair", type: "type", text: "repair-secret-9922" }] }],
    });
    assert.equal(repair.version, 2);
    assert.equal(repair.state, "candidate");
    assert.doesNotMatch(JSON.stringify(repair), /repair-secret-9922/);
    assert.match(JSON.stringify(repair), /\{\{input_/);

    const workflowsDir = join(projectA, "computer-use", "workflows");
    await writeFile(join(workflowsDir, "corrupt.json"), "{not-json", "utf8");
    const afterCorruption = await storeA.recall({ application: base.application, taskFamily: base.taskFamily, intent: base.intent });
    assert.equal(afterCorruption.isolatedRecords.some((name) => name === "corrupt.json"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sensitive applications never learn or recall durable workflows", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipiui-workflow-sensitive-"));
  try {
    const store = new WorkflowMemoryStore(root, { isSensitiveApplication: canonicalSensitiveApplicationPolicy });
    const result = await store.recordAutonomousSuccess({
      taskId: "secret-task",
      runId: "secret-run",
      application: { bundleId: "com.1password.1password", appName: "1Password" },
      taskFamily: "login",
      intent: "sign in",
      receiptRef: "receipt:secret",
      blocks: [],
      postconditions: [],
      humanCorrected: false,
    });
    assert.equal(result, undefined);
    assert.equal((await store.recall({ application: { bundleId: "com.1password.1password", appName: "1Password" }, taskFamily: "login", intent: "sign in" })).entries.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
