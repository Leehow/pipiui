import test from "node:test";
import assert from "node:assert/strict";
import {
  ComputerAgentCoordinator,
  computerOperatorContextOptions,
  computerTaskContent,
  computerTaskDetails,
  computerTaskRootTerminalState,
  finalizeComputerTaskWithOptionalSummary,
} from "../../Electron/resources/runtime/pi-ext/packages/computer-agent/src/coordinator.ts";
import { computerWorkerManualBlockFromOutput } from "../../Electron/resources/runtime/pi-ext/subagent/index.ts";

const condition = { kind: "visible_text", contains: "done" };
const episode = ({ agentId, runId, name, role, terminalState = "ok", outcome = role === "verifier" ? "verified" : "completed" }) => ({
  agentId,
  runId,
  parentId: "leader-1",
  name,
  role,
  terminalState,
  result: { outcome, summary: "private child prose must not cross the episode boundary" },
});

test("Computer Task preserves closed child episode identity across success, failure, and retry", async () => {
  const successfulPlan = {
    goal: "operate and verify",
    mode: "planned",
    successConditions: [condition],
    steps: [
      { id: "operate", role: "gui-operator", objective: "operate", dependsOn: [], postconditions: [condition] },
      { id: "verify", role: "verifier", objective: "verify", dependsOn: ["operate"], postconditions: [condition] },
    ],
  };
  const successful = new ComputerAgentCoordinator({
    planner: { plan: async () => successfulPlan, replan: async () => { throw new Error("not reached"); } },
    dispatcher: { dispatch: async ({ role }) => role === "gui-operator"
      ? { workerResult: { outcome: "completed", summary: "private", observation: { id: "operator-observation", visibleText: ["done"] } }, hostExecutionRecords: [], episode: episode({ agentId: "operator-stable", runId: "operator-run-1", name: "operator", role }) }
      : { workerResult: { outcome: "verified", summary: "private", observation: { id: "verifier-observation", visibleText: ["done"] } }, hostExecutionRecords: [], episode: episode({ agentId: "verifier-1", runId: "verifier-run-1", name: "computer-verifier", role }) } },
  });
  const success = await successful.run({ goal: successfulPlan.goal, taskId: "leader-1" });
  assert.equal(success.outcome, "succeeded");
  assert.deepEqual(success.episodes?.map(({ agentId, runId, parentId, name, role, terminalState }) => ({ agentId, runId, parentId, name, role, terminalState })), [
    { agentId: "operator-stable", runId: "operator-run-1", parentId: "leader-1", name: "operator", role: "gui-operator", terminalState: "ok" },
    { agentId: "verifier-1", runId: "verifier-run-1", parentId: "leader-1", name: "computer-verifier", role: "verifier", terminalState: "ok" },
  ]);
  assert.equal(JSON.stringify(success).includes("private child prose"), false);
  const root = episode({ agentId: "leader-1", runId: "coordinator-run", name: "computer-use-leader", role: "computer-use-leader" });
  root.parentId = null;
  const leaderRuns = [
    episode({ agentId: "leader-1", runId: "leader-plan-run", name: "computer-use-leader", role: "computer-use-leader" }),
    episode({ agentId: "leader-1", runId: "leader-summary-run", name: "computer-use-leader", role: "computer-use-leader" }),
  ];
  leaderRuns.forEach((item) => { item.parentId = null; });
  const details = computerTaskDetails(success, root, leaderRuns, "closed leader summary");
  assert.deepEqual(details.hierarchy.root, { agentId: "leader-1", runId: "coordinator-run", parentId: null, name: "computer-use-leader", role: "computer-use-leader" });
  assert.deepEqual(details.episodes.map(({ agentId, runId, role }) => ({ agentId, runId, role })), [
    { agentId: "leader-1", runId: "coordinator-run", role: "computer-use-leader" },
    { agentId: "leader-1", runId: "leader-plan-run", role: "computer-use-leader" },
    { agentId: "leader-1", runId: "leader-summary-run", role: "computer-use-leader" },
    { agentId: "operator-stable", runId: "operator-run-1", role: "gui-operator" },
    { agentId: "verifier-1", runId: "verifier-run-1", role: "verifier" },
  ]);
  const content = computerTaskContent(details, "closed leader summary");
  assert.match(content, /"episodeLedger"/);
  assert.match(content, /"runId":"operator-run-1"/);
  assert.doesNotMatch(content, /private child prose/);
  assert.equal(computerTaskRootTerminalState({ outcome: "blocked", summary: "blocked" }), "failed");
  assert.equal(computerTaskRootTerminalState({ outcome: "blocked", summary: "stalled", failureCode: "computer_leader_stalled" }), "stalled");
  assert.deepEqual(computerOperatorContextOptions({ role: "gui-operator", planRevision: 0 }, "operator-stable"), { agentId: "operator-stable", retainContext: true, fresh: false });
  assert.deepEqual(computerOperatorContextOptions({ role: "gui-operator", planRevision: 1 }, "operator-stable"), { agentId: "operator-stable", retainContext: true, fresh: true });

  let run = 0;
  const failedPlan = { goal: "retry operation", mode: "direct", successConditions: [condition], steps: [{ id: "operate", role: "gui-operator", objective: "operate", dependsOn: [], postconditions: [condition] }] };
  const dispatches = [];
  const failing = new ComputerAgentCoordinator({
    maxReplans: 1,
    planner: { plan: async () => failedPlan, replan: async () => ({ ...failedPlan, revision: 1 }) },
    dispatcher: { dispatch: async (request) => {
      const { role } = request;
      dispatches.push({ agentId: "operator-stable", planRevision: request.planRevision });
      run += 1;
      return {
        workerResult: { outcome: "failed", summary: "private", failureCode: "gui_child_failed" },
        hostExecutionRecords: [],
        episode: episode({ agentId: "operator-stable", runId: `operator-run-${run}`, name: "operator", role, terminalState: run === 2 ? "aborted" : "failed", outcome: "failed" }),
      };
    } },
  });
  const failed = await failing.run({ goal: failedPlan.goal, taskId: "leader-1" });
  assert.equal(failed.outcome, "blocked");
  assert.deepEqual(failed.investigation?.workerAttempts.map(({ agentId, runId, terminalState }) => ({ agentId, runId, terminalState })), [
    { agentId: "operator-stable", runId: "operator-run-1", terminalState: "failed" },
    { agentId: "operator-stable", runId: "operator-run-2", terminalState: "aborted" },
  ]);
  assert.deepEqual(failed.episodes?.map(({ agentId, runId }) => ({ agentId, runId })), [
    { agentId: "operator-stable", runId: "operator-run-1" },
    { agentId: "operator-stable", runId: "operator-run-2" },
  ]);
  assert.deepEqual(dispatches, [
    { agentId: "operator-stable", planRevision: 0 },
    { agentId: "operator-stable", planRevision: 1 },
  ]);
});

test("planned verifier replaces the automatic verifier while verifier-free plans still get one", async () => {
  const visual = { kind: "visual_judgement", description: "target is visibly ready" };
  const roles = [];
  const planned = new ComputerAgentCoordinator({
    planner: { plan: async () => ({
      goal: "operate then verify",
      mode: "planned",
      successConditions: [visual],
      steps: [
        { id: "operate", role: "gui-operator", objective: "operate", dependsOn: [], postconditions: [visual] },
        { id: "planned-verify", role: "verifier", objective: "independent verify", dependsOn: ["operate"], postconditions: [visual] },
      ],
    }), replan: async () => { throw new Error("not reached"); } },
    dispatcher: { dispatch: async ({ role, stepId }) => {
      roles.push({ role, stepId });
      const workerResult = role === "verifier"
        ? { outcome: "verified", summary: "verified", observation: { id: "planned-verifier-observation" } }
        : { outcome: "completed", summary: "completed", observation: { id: "operator-observation" } };
      return { workerResult, hostExecutionRecords: [], episode: episode({ agentId: `${role}-agent`, runId: `${stepId}-run`, name: role === "verifier" ? "computer-verifier" : "operator", role }) };
    } },
  });
  const plannedResult = await planned.run({ goal: "operate then verify", taskId: "planned" });
  assert.equal(plannedResult.outcome, "succeeded");
  assert.deepEqual(roles, [
    { role: "gui-operator", stepId: "operate" },
    { role: "verifier", stepId: "planned-verify" },
  ]);
  assert.deepEqual(plannedResult.episodes?.map(({ role, runId }) => ({ role, runId })), [
    { role: "gui-operator", runId: "operate-run" },
    { role: "verifier", runId: "planned-verify-run" },
  ]);

  roles.length = 0;
  const automatic = new ComputerAgentCoordinator({
    planner: { plan: async () => ({ goal: "operate", mode: "direct", successConditions: [visual], steps: [{ id: "operate", role: "gui-operator", objective: "operate", dependsOn: [], postconditions: [visual] }] }), replan: async () => { throw new Error("not reached"); } },
    dispatcher: { dispatch: async ({ role, stepId }) => {
      roles.push({ role, stepId });
      return role === "verifier"
        ? { outcome: "verified", summary: "verified", observation: { id: "automatic-verifier-observation" } }
        : { outcome: "completed", summary: "completed", observation: { id: "operator-observation" } };
    } },
  });
  assert.equal((await automatic.run({ goal: "operate", taskId: "automatic" })).outcome, "succeeded");
  assert.deepEqual(roles, [
    { role: "gui-operator", stepId: "operate" },
    { role: "verifier", stepId: "operate-verify" },
  ]);
});

test("manual target-state block closes immediately without recovery planning or verifier dispatch", async () => {
  const textCondition = { kind: "visible_text", contains: "target" };
  let replans = 0;
  const dispatches = [];
  const events = [];
  const coordinator = new ComputerAgentCoordinator({
    maxReplans: 2,
    planner: {
      plan: async () => ({
        goal: "observe target without changing state",
        mode: "planned",
        successConditions: [textCondition],
        steps: [
          { id: "observe", role: "gui-operator", objective: "observe only", dependsOn: [], postconditions: [textCondition] },
          { id: "verify", role: "verifier", objective: "verify", dependsOn: ["observe"], postconditions: [textCondition] },
        ],
      }),
      replan: async () => { replans += 1; throw new Error("manual intervention must not invoke recovery Leader"); },
    },
    dispatcher: { dispatch: async (request) => {
      dispatches.push(request.role);
      return {
        workerResult: {
          outcome: "blocked",
          summary: "private worker prose",
          recoveryDisposition: "manual_intervention",
          blockedReason: "target_state_mismatch",
          nextAction: "restore_target_state_manually",
          observation: { id: "wrong-target-state", visibleText: ["settings"] },
        },
        hostExecutionRecords: [],
        episode: episode({ agentId: "operator-stable", runId: "operator-blocked-run", name: "operator", role: request.role, terminalState: "failed", outcome: "blocked" }),
      };
    } },
    onEvent: event => events.push(event),
  });

  const result = await coordinator.run({ goal: "observe target without changing state", taskId: "leader-manual-block" });

  assert.equal(replans, 0);
  assert.deepEqual(dispatches, ["gui-operator"], "verifier cannot run before operator success");
  assert.equal(result.outcome, "blocked");
  assert.equal(result.summary, "Target state requires manual restoration before retry");
  assert.deepEqual(result.investigation, {
    stage: "manual_intervention",
    code: "target_state_mismatch",
    recoveryAttempts: 0,
    failedConditions: [{ conditionId: "task:condition:0", kind: "visible_text", outcome: "not_verified" }],
    workerAttempts: [{
      stepId: "observe", role: "gui-operator", outcome: "blocked", verification: "not_verified",
      agentId: "operator-stable", runId: "operator-blocked-run", parentId: "leader-1", name: "operator", terminalState: "failed",
      result: { outcome: "blocked", summary: "Worker blocked" },
    }],
    blockedReason: "target_state_mismatch",
    nextAction: "restore_target_state_manually",
  });
  assert.deepEqual(result.episodes?.map(({ agentId, runId }) => ({ agentId, runId })), [
    { agentId: "operator-stable", runId: "operator-blocked-run" },
  ]);
  assert.deepEqual(events.filter(event => event.type === "task_finished"), [
    { type: "task_finished", taskId: "leader-manual-block", outcome: "blocked" },
  ]);
  let summaryCalls = 0;
  const finalized = await finalizeComputerTaskWithOptionalSummary(result, async () => {
    summaryCalls += 1;
    return "model summary must not run";
  });
  assert.equal(summaryCalls, 0, "manual intervention is already a bounded deterministic tool result");
  assert.equal(finalized.result, result);
  assert.equal(finalized.leaderSummary, undefined);
});

test("operator closed JSON preserves only the allowlisted manual target-state block", () => {
  assert.deepEqual(computerWorkerManualBlockFromOutput(JSON.stringify({
    outcome: "blocked",
    summary: "fixed-safe",
    recoveryDisposition: "manual_intervention",
    blockedReason: "target_state_mismatch",
    nextAction: "restore_target_state_manually",
  })), {
    recoveryDisposition: "manual_intervention",
    blockedReason: "target_state_mismatch",
    nextAction: "restore_target_state_manually",
  });
  assert.equal(computerWorkerManualBlockFromOutput(JSON.stringify({
    outcome: "failed",
    recoveryDisposition: "manual_intervention",
    blockedReason: "target_state_mismatch",
    nextAction: "restore_target_state_manually",
  })), undefined);
  assert.equal(computerWorkerManualBlockFromOutput(JSON.stringify({
    outcome: "blocked",
    recoveryDisposition: "manual_intervention",
    blockedReason: "private_arbitrary_reason",
    nextAction: "run_arbitrary_action",
  })), undefined);
});

test("a stalled optional final summary cannot downgrade verified work or discard worker episodes", async () => {
  const verified = {
    outcome: "succeeded",
    summary: "Computer Task completed",
    verification: { status: "verified", conditionResults: [] },
    planRevisions: 0,
    investigation: {
      stage: "verified",
      code: "success_conditions_verified",
      nextAction: "none",
      workerAttempts: [
        { stepId: "operate", role: "gui-operator", outcome: "completed", agentId: "operator-stable", runId: "operator-run", terminalState: "ok" },
        { stepId: "verify", role: "verifier", outcome: "verified", agentId: "verifier-stable", runId: "verifier-run", terminalState: "ok" },
      ],
    },
    episodes: [
      episode({ agentId: "operator-stable", runId: "operator-run", name: "operator", role: "gui-operator" }),
      episode({ agentId: "verifier-stable", runId: "verifier-run", name: "computer-verifier", role: "verifier" }),
    ],
  };
  let summaryAttempts = 0;
  const finalized = await finalizeComputerTaskWithOptionalSummary(verified, async () => {
    summaryAttempts += 1;
    throw Object.assign(new Error("summary timed out"), { failureCode: "computer_leader_stalled" });
  });

  assert.equal(summaryAttempts, 1, "optional prose summary is never retried");
  assert.equal(finalized.result, verified, "the closed coordinator result remains authoritative");
  assert.equal(finalized.leaderSummary, undefined);
  assert.equal(computerTaskRootTerminalState(finalized.result), "ok");
  assert.deepEqual(finalized.result.episodes.map(({ agentId, runId, role }) => ({ agentId, runId, role })), [
    { agentId: "operator-stable", runId: "operator-run", role: "gui-operator" },
    { agentId: "verifier-stable", runId: "verifier-run", role: "verifier" },
  ]);
});

test("a stalled optional summary keeps blocked and failed coordinator results", async () => {
  const blocked = {
    outcome: "blocked",
    summary: "Computer Task blocked",
    verification: { status: "not_verified", conditionResults: [] },
    planRevisions: 1,
    investigation: {
      stage: "recovery_exhausted",
      code: "worker_failed",
      recoveryAttempts: 1,
      failedConditions: [],
      workerAttempts: [{ stepId: "operate", role: "gui-operator", outcome: "failed", verification: "unknown" }],
    },
  };
  const failed = {
    outcome: "failed",
    summary: "Computer Task failed",
    verification: { status: "not_verified", conditionResults: [] },
    planRevisions: 0,
  };
  const cancelled = {
    outcome: "cancelled",
    summary: "Computer Task cancelled",
    verification: { status: "not_verified", conditionResults: [] },
    planRevisions: 0,
    investigation: { stage: "cancelled", code: "task_cancelled", recoveryAttempts: 0, failedConditions: [], workerAttempts: [] },
  };

  let blockedAttempts = 0;
  const blockedFinal = await finalizeComputerTaskWithOptionalSummary(blocked, async () => {
    blockedAttempts += 1;
    throw Object.assign(new Error("summary timed out"), { failureCode: "computer_leader_stalled" });
  });
  assert.equal(blockedAttempts, 1);
  assert.equal(blockedFinal.result, blocked);
  assert.equal(blockedFinal.leaderSummary, "Computer Task blocked");

  const failedFinal = await finalizeComputerTaskWithOptionalSummary(failed, async () => {
    throw new Error("summary writer crashed");
  });
  assert.equal(failedFinal.result, failed);
  assert.equal(failedFinal.leaderSummary, "Computer Task failed");

  const cancelledFinal = await finalizeComputerTaskWithOptionalSummary(cancelled, async () => {
    throw Object.assign(new Error("summary timed out"), { failureCode: "computer_leader_stalled" });
  });
  assert.equal(cancelledFinal.result, cancelled);
  assert.equal(cancelledFinal.leaderSummary, "Computer Task cancelled");
});
