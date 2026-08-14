/**
 * Runtime-owned worktree merge recovery (Swift SubagentStore parity, host-free).
 *
 * Hosts that hand finalization to pi have no App watching merge outcomes, so the fixer-resume /
 * Boss-escalation loop lives in pi-ext/subagent/worktree-recovery.ts. These tests pin its pure
 * decision layer, the durable attempt ledger, and the injected scheduling (dispatch, escalate,
 * waiting-for-main retry) without Git, timers longer than a blink, or a live session.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const recoveryModule = join(
  repositoryRoot,
  "Electron/resources/runtime/pi-ext/subagent/worktree-recovery.ts",
);

/** One harness runs every scenario in-process and prints one JSON payload. */
const HARNESS = String.raw`
import * as recovery from ${JSON.stringify(recoveryModule)};
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratch = mkdtempSync(join(tmpdir(), "pipiui-worktree-recovery-"));

function makeState(overrides = {}) {
  const result = {
    disposition: "needs-fixer",
    ownership: "isolated",
    dirty: "clean",
    conflict: "merge-conflict",
    merge: "conflicted",
    recovery: {
      disposition: "needs-fixer",
      nextAction: "resolve-conflict",
      retryable: true,
      reason: "main merge failed: conflict in shared file",
      actionable: [],
    },
    verify: { command: "npm test", postMerge: "not-run" },
    worktree: { path: "/tmp/wt", branch: "pipiui/agent-a" },
    messages: ["merge failed; worktree and branch were retained"],
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...(overrides.result ?? {}),
  };
  return {
    schemaVersion: 1,
    input: { agentId: "agent-a", runId: "run-1", mainCwd: scratch },
    attempt: 1,
    createdAt: result.updatedAt,
    updatedAt: result.updatedAt,
    phase: "terminal",
    result,
  };
}

function fakeContext(store, state, agentId, extra = {}) {
  const calls = { dispatch: [], escalate: [], retry: [] };
  const context = {
    agentId,
    name: "general-purpose",
    mainCwd: scratch,
    branch: "pipiui/" + agentId,
    worktreePath: "/tmp/wt",
    verifyCommand: "npm test",
    state,
    depth: 0,
    dispatchRecovery: (input) => calls.dispatch.push(input),
    escalate: (text) => calls.escalate.push(text),
    retryFinalization: (retained) => calls.retry.push(retained),
    ...extra,
  };
  return { context, calls };
}

const report = {};

// ---- pure decision layer ----------------------------------------------------
report.decisions = {
  mergedClears: recovery.decideWorktreeRecovery({
    merge: "merged", recoveryDisposition: "merged", nextAction: "none",
    postMergeVerify: "passed", attempt: 2, bossSignaled: false,
  }),
  mergedButVerifyFailed: recovery.decideWorktreeRecovery({
    merge: "merged", recoveryDisposition: "post-merge-verify", nextAction: "rerun-post-merge-verify",
    postMergeVerify: "failed", attempt: 0, bossSignaled: false,
  }),
  firstRecover: recovery.decideWorktreeRecovery({
    merge: "conflicted", recoveryDisposition: "needs-fixer", nextAction: "resolve-conflict",
    postMergeVerify: "not-run", attempt: 0, bossSignaled: false,
  }),
  thirdRecoverIsFresh: recovery.decideWorktreeRecovery({
    merge: "conflicted", recoveryDisposition: "needs-fixer", nextAction: "resolve-conflict",
    postMergeVerify: "not-run", attempt: 2, bossSignaled: false,
  }),
  exhaustedEscalates: recovery.decideWorktreeRecovery({
    merge: "conflicted", recoveryDisposition: "needs-fixer", nextAction: "resolve-conflict",
    postMergeVerify: "not-run", attempt: 3, bossSignaled: false,
  }),
  exhaustedAfterEscalationIsSilent: recovery.decideWorktreeRecovery({
    merge: "conflicted", recoveryDisposition: "needs-fixer", nextAction: "resolve-conflict",
    postMergeVerify: "not-run", attempt: 3, bossSignaled: true,
  }),
  waitingForMain: recovery.decideWorktreeRecovery({
    merge: "failed", recoveryDisposition: "waiting-for-main", nextAction: "resolve-main-wip",
    postMergeVerify: "not-run", attempt: 0, bossSignaled: false,
  }),
  dirtyWorkerIsNotThisLoop: recovery.decideWorktreeRecovery({
    merge: "failed", recoveryDisposition: "needs-fixer", nextAction: "resume-worker",
    postMergeVerify: "not-run", attempt: 0, bossSignaled: false,
  }),
};

// ---- durable ledger ---------------------------------------------------------
const storePath = join(scratch, "ledger.json");
const store = new recovery.WorktreeRecoveryStoreV1(storePath);
store.upsert("agent-a", { attempt: 1, fresh: false, inFlight: true, name: "general-purpose" });
store.upsert("agent-a", { waitingState: makeState() });
const withWaiting = store.get("agent-a");
store.upsert("agent-a", { waitingState: null });
report.store = {
  path: recovery.worktreeRecoveryStorePath("/tmp/main", "sess-1"),
  attempt: withWaiting.attempt,
  name: withWaiting.name,
  inFlight: withWaiting.inFlight === true,
  hadWaiting: typeof withWaiting.waitingState === "object",
  waitingDropped: store.get("agent-a").waitingState === undefined,
  corruptTolerated: new recovery.WorktreeRecoveryStoreV1(join(scratch, "missing.json")).load().records,
};
store.clear("agent-a");
report.store.cleared = store.get("agent-a") === undefined;

// ---- scheduling: recover loop ----------------------------------------------
{
  const loopStore = new recovery.WorktreeRecoveryStoreV1(join(scratch, "loop.json"));
  const { context, calls } = fakeContext(loopStore, makeState(), "agent-a");
  const outcomes = [];
  for (let i = 0; i < 5; i += 1) {
    outcomes.push(recovery.scheduleWorktreeRecovery(loopStore, context));
  }
  report.recoverLoop = {
    outcomes,
    dispatchFreshness: calls.dispatch.map((entry) => entry.fresh),
    dispatchIds: [...new Set(calls.dispatch.map((entry) => entry.agentId))],
    escalations: calls.escalate.length,
    escalationHead: (calls.escalate[0] ?? "").split("\n")[0],
    record: loopStore.get("agent-a"),
  };
}

// ---- scheduling: verify-failed escalation + mainDirty probe -----------------
{
  const verifyStore = new recovery.WorktreeRecoveryStoreV1(join(scratch, "verify.json"));
  const state = makeState({
    result: {
      merge: "merged",
      disposition: "post-merge-verify",
      conflict: "none",
      recovery: { disposition: "post-merge-verify", nextAction: "rerun-post-merge-verify", retryable: true, reason: "post-merge verify failed", actionable: [] },
      verify: { command: "npm test", postMerge: "failed", postMergeExitCode: 1 },
    },
  });
  const { context, calls } = fakeContext(verifyStore, state, "agent-v");
  const outcome = recovery.scheduleWorktreeRecovery(verifyStore, context);
  report.verifyEscalation = {
    outcome,
    escalations: calls.escalate.length,
    head: (calls.escalate[0] ?? "").split("\n")[0],
    // scratch is not a Git repository, so the probe must read dirty (fail-closed).
    mainDirtyGuidance: (calls.escalate[0] ?? "").includes("mainDirty=true"),
    bossSignaled: verifyStore.get("agent-v").bossSignaled === true,
  };
}

// ---- scheduling: depth gate --------------------------------------------------
{
  const depthStore = new recovery.WorktreeRecoveryStoreV1(join(scratch, "depth.json"));
  const { context, calls } = fakeContext(depthStore, makeState(), "agent-d", { depth: 1 });
  report.depthGate = {
    outcome: recovery.scheduleWorktreeRecovery(depthStore, context),
    dispatch: calls.dispatch.length,
    escalate: calls.escalate.length,
    record: depthStore.get("agent-d"),
  };
}

// ---- scheduling: waiting-for-main retention + retry window -------------------
{
  const waitStore = new recovery.WorktreeRecoveryStoreV1(join(scratch, "wait.json"));
  const state = makeState({
    result: {
      merge: "failed",
      recovery: { disposition: "waiting-for-main", nextAction: "resolve-main-wip", retryable: true, reason: "main has work in progress", actionable: [] },
    },
  });
  const { context, calls } = fakeContext(waitStore, state, "agent-w");
  const outcome = recovery.scheduleWorktreeRecovery(waitStore, context);
  recovery.resetWaitingForMainForTests(); // drop the 60s default window; arm a fast one below
  const retained = waitStore.get("agent-w");
  recovery.scheduleWaitingForMainRetry(waitStore, context, { delayMs: 25 });
  await new Promise((resolveTimer) => setTimeout(resolveTimer, 120));
  report.waitingForMain = {
    outcome,
    retainedWaiting: typeof retained.waitingState === "object",
    retried: calls.retry.length,
    waitingConsumed: waitStore.get("agent-w").waitingState === undefined,
  };
  recovery.resetWaitingForMainForTests();
}

// ---- deduper -----------------------------------------------------------------
{
  let clock = 1000;
  const deduper = new recovery.EscalationDeduperV1({ windowMs: 60_000, now: () => clock });
  const first = deduper.shouldInject("merge", "agent-x", "boom");
  const withinWindow = deduper.shouldInject("merge", "agent-x", "boom");
  clock += 60_001;
  const afterWindow = deduper.shouldInject("merge", "agent-x", "boom");
  const differentDetail = deduper.shouldInject("merge", "agent-x", "other");
  report.deduper = { first, withinWindow, afterWindow, differentDetail };
}

// ---- escalation message shapes ------------------------------------------------
report.messages = {
  mergeHead: recovery.formatWorktreeMergeFailedMessage({
    agentId: "agent-a", name: "general-purpose", branch: "pipiui/agent-a",
    worktreePath: "/tmp/wt", error: "conflict in shared file", attemptsUsed: 3,
    conflictPaths: ["src/a.ts"],
  }).split("\n")[0],
  mergeGuidance: recovery.formatWorktreeMergeFailedMessage({
    agentId: "agent-a", error: "boom", attemptsUsed: 3,
  }).includes("You adjudicate three ways only"),
  verifyClean: recovery.formatPostMergeVerifyFailedMessage({
    agentId: "agent-v", command: "npm test", exitCode: 1, outputTail: "FAIL",
  }).includes("Immediately dispatch a general-purpose fixer on the main repo"),
  verifyDirty: recovery.formatPostMergeVerifyFailedMessage({
    agentId: "agent-v", command: "npm test", exitCode: 1, outputTail: "FAIL", mainDirty: true,
  }).includes("uncommitted changes"),
};

console.log(JSON.stringify(report));
`;

async function runHarness() {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-recovery-test-"));
  const harness = join(directory, "harness.mjs");
  await writeFile(harness, HARNESS, "utf-8");
  const { stdout } = await execFileAsync("node", ["--experimental-strip-types", harness]);
  return JSON.parse(stdout.trim().split("\n").at(-1));
}

let cachedReport;
const runHarnessOnce = runHarness().then((report) => {
  cachedReport = report;
  return report;
});

async function reportFor() {
  return cachedReport ?? (await runHarnessOnce);
}

test("worktree recovery decision layer follows the Swift fixer budget", async () => {
  const { decisions } = await reportFor();
  assert.deepEqual(decisions.mergedClears, { kind: "clear" });
  assert.deepEqual(decisions.mergedButVerifyFailed, { kind: "escalate", message: "verify-failed" });
  assert.deepEqual(decisions.firstRecover, { kind: "recover", fresh: false, attempt: 1 });
  assert.deepEqual(decisions.thirdRecoverIsFresh, { kind: "recover", fresh: true, attempt: 3 });
  assert.deepEqual(decisions.exhaustedEscalates, { kind: "escalate", message: "merge-failed" });
  assert.deepEqual(decisions.exhaustedAfterEscalationIsSilent, { kind: "none" });
  assert.deepEqual(decisions.waitingForMain, { kind: "waiting-for-main" });
  assert.deepEqual(decisions.dirtyWorkerIsNotThisLoop, { kind: "none" });
});

test("the attempt ledger persists attempts, in-flight claims, and waiting state", async () => {
  const { store } = await reportFor();
  assert.ok(store.path.endsWith(".pi/pipiui-memory/worktree-recovery-sess-1.json"));
  assert.equal(store.attempt, 1);
  assert.equal(store.name, "general-purpose");
  assert.equal(store.inFlight, true);
  assert.equal(store.hadWaiting, true);
  assert.equal(store.waitingDropped, true);
  assert.deepEqual(store.corruptTolerated, {});
  assert.equal(store.cleared, true);
});

test("a terminal merge failure resumes the fixer up to three times, then escalates once", async () => {
  const { recoverLoop } = await reportFor();
  const kinds = recoverLoop.outcomes.map((entry) => entry.kind);
  assert.deepEqual(kinds, ["recover", "recover", "recover", "escalate", "none"]);
  assert.deepEqual(recoverLoop.dispatchFreshness, [false, false, true]);
  assert.deepEqual(recoverLoop.dispatchIds, ["agent-a"]);
  assert.equal(recoverLoop.escalations, 1);
  assert.ok(recoverLoop.escalationHead.startsWith("[worktree-merge-failed] agentId=agent-a"));
  assert.equal(recoverLoop.record.bossSignaled, true);
  assert.equal(recoverLoop.record.attempt, 3);
});

test("a post-merge verify failure escalates immediately with mainDirty attribution", async () => {
  const { verifyEscalation } = await reportFor();
  assert.deepEqual(verifyEscalation.outcome, { kind: "escalate", message: "verify-failed" });
  assert.equal(verifyEscalation.escalations, 1);
  assert.ok(verifyEscalation.head.startsWith("[post-merge-verify-failed] agentId=agent-v"));
  assert.equal(verifyEscalation.mainDirtyGuidance, true);
  assert.equal(verifyEscalation.bossSignaled, true);
});

test("worker-depth terminals never drive recovery or escalation", async () => {
  const { depthGate } = await reportFor();
  assert.deepEqual(depthGate.outcome, { kind: "none" });
  assert.equal(depthGate.dispatch, 0);
  assert.equal(depthGate.escalate, 0);
  assert.equal(depthGate.record, undefined);
});

test("waiting-for-main retains the state and the retry window re-runs finalization", async () => {
  const { waitingForMain } = await reportFor();
  assert.deepEqual(waitingForMain.outcome, { kind: "waiting-for-main" });
  assert.equal(waitingForMain.retainedWaiting, true);
  assert.equal(waitingForMain.retried, 1);
  assert.equal(waitingForMain.waitingConsumed, true);
});

test("identical escalations are deduped inside one 60s window", async () => {
  const { deduper } = await reportFor();
  assert.equal(deduper.first, true);
  assert.equal(deduper.withinWindow, false);
  assert.equal(deduper.afterWindow, true);
  assert.equal(deduper.differentDetail, true);
});

test("escalation messages keep the Swift guidance contract", async () => {
  const { messages } = await reportFor();
  assert.ok(messages.mergeHead.startsWith("[worktree-merge-failed] agentId=agent-a"));
  assert.equal(messages.mergeGuidance, true);
  assert.equal(messages.verifyClean, true);
  assert.equal(messages.verifyDirty, true);
});
