import test from "node:test";
import assert from "node:assert/strict";

import { createBossEscalation } from "../../Electron/resources/runtime/pi-ext/subagent/supervisor/contract.ts";
import { grantsForComputerRole } from "../../Electron/resources/runtime/pi-ext/packages/computer-agent/src/worker-broker.ts";
import {
  BOUNDED_OPERATOR_REJECT,
  DIRECT_DRIVE_ADVISOR_CUSTOM_TYPE,
  STILL_TRYING_PATTERN,
  adviseFromDirectDriveResult,
  adviseFromStuckRecord,
  advisorHasDesktopMutation,
  buildBlockedReport,
  createDirectDriveAdvisor,
  createOneShotAdvisorRequest,
  evaluateBoundedOperatorEscape,
  existingVerifierGrantsUnchanged,
  formatAdvisorFollowUpText,
  grantsForDirectDriveAdvisorRole,
  parseBlockedReport,
  queueAdvisorFollowUp,
  toAdvisorEscalationInput,
  toolNamesForDirectDriveAdvisorRole,
} from "../../Electron/resources/runtime/pi-ext/packages/computer-agent/src/verifier-recovery.ts";

function trajectory(overrides = {}) {
  return {
    sessionId: "desktop-1",
    steps: [
      {
        action: { type: "act", actions: [{ type: "click", x: 8, y: 8 }] },
        result: { ok: true },
        screenChanged: true,
        error: null,
        observationRef: "obs-1",
      },
    ],
    last_observation: { observationId: "obs-1", title: "TextEdit" },
    last_action: { type: "act", actions: [{ type: "click", x: 8, y: 8 }] },
    expected_effect: "Save sheet appears",
    actual_effect: "screen changed",
    attempt_count: 1,
    ...overrides,
  };
}

test("existing computer-verifier grants stay observe-only; recovery has no desktop mutation", () => {
  assert.equal(existingVerifierGrantsUnchanged(), true);
  assert.deepEqual(grantsForComputerRole("verifier"), ["observe"]);
  assert.deepEqual(grantsForDirectDriveAdvisorRole("verifier"), ["observe"]);
  assert.equal(advisorHasDesktopMutation("verifier"), false);
  assert.deepEqual(grantsForDirectDriveAdvisorRole("recovery"), []);
  assert.equal(advisorHasDesktopMutation("recovery"), false);
  assert.deepEqual(toolNamesForDirectDriveAdvisorRole("recovery"), []);
  assert.ok(!toolNamesForDirectDriveAdvisorRole("verifier").includes("desktop_act"));
  assert.ok(!toolNamesForDirectDriveAdvisorRole("verifier").includes("desktop_open_application"));
});

test("one-shot requests never hold the unique GUI session", () => {
  const request = createOneShotAdvisorRequest({
    role: "verifier",
    sessionId: "desktop-1",
    trigger: "completion_claim",
    trajectory: trajectory().steps,
    currentObservation: { observationId: "obs-1" },
  });
  assert.equal(request.fresh, true);
  assert.equal(request.retainContext, false);
  assert.equal(request.holdsGuiSession, false);
  assert.equal(request.desktopMutation, false);
  assert.deepEqual(request.grants, ["observe"]);
});

test("blocked report schema requires the closed fields and rejects still-trying prose", () => {
  const ok = parseBlockedReport({
    status: "blocked",
    last_observation: { observationId: "obs-1" },
    last_action: { type: "click" },
    expected_effect: "dialog opens",
    actual_effect: "nothing changed",
    attempt_count: 2,
    why_blocked: "same click twice left the screen unchanged",
    recommended_next_actions: ["change_interaction"],
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.expected_effect, "dialog opens");

  const missing = parseBlockedReport({
    status: "blocked",
    last_observation: null,
    last_action: null,
    why_blocked: "x",
    recommended_next_actions: ["y"],
  });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /actual_effect|attempt_count/);

  const trying = parseBlockedReport({
    status: "blocked",
    last_observation: null,
    last_action: null,
    actual_effect: null,
    attempt_count: 1,
    why_blocked: "still trying",
    recommended_next_actions: ["retry"],
  });
  assert.equal(trying.ok, false);
  assert.match(trying.error, /still-trying/);
  assert.equal(STILL_TRYING_PATTERN.test("仍在尝试打开菜单"), true);

  const built = buildBlockedReport({
    status: "needs_help",
    trajectory: trajectory({ attempt_count: 4 }),
    why_blocked: "step budget exhausted",
    recommended_next_actions: ["pause", "ask the user"],
  });
  assert.equal(built.status, "needs_help");
  assert.equal(built.attempt_count, 4);
  assert.ok(built.last_action);
});

test("completion_claim / milestone / mutation_uncertain / detector_escalation each fire once", async () => {
  const advisor = createDirectDriveAdvisor({ sessionId: "desktop-1" });
  const completion = await advisor.handle({
    trigger: "completion_claim",
    eventId: "claim-1",
    trajectory: trajectory(),
  });
  assert.equal(completion.fired, true);
  assert.equal(completion.trigger, "completion_claim");
  assert.equal(completion.status, "progressing");
  assert.equal(completion.request.role, "verifier");
  assert.equal(completion.holdsGuiSession, false);
  assert.equal(completion.followUp, undefined);

  const again = await advisor.handle({
    trigger: "completion_claim",
    eventId: "claim-1",
    trajectory: trajectory(),
  });
  assert.equal(again.fired, false);

  const milestone = await advisor.handle({
    trigger: "milestone",
    eventId: "mile-1",
    trajectory: trajectory({ steps: [{ action: { type: "act" }, screenChanged: false, error: null }] }),
  });
  assert.equal(milestone.trigger, "milestone");
  assert.equal(milestone.status, "blocked");
  assert.ok(milestone.blocked);
  assert.ok(milestone.followUp);

  const uncertain = await advisor.handle({
    trigger: "mutation_uncertain",
    eventId: "mut-1",
    trajectory: trajectory({
      steps: [{ action: { type: "act" }, screenChanged: null, error: "mutation_outcome_unknown" }],
      actual_effect: "unknown",
    }),
  });
  assert.equal(uncertain.trigger, "mutation_uncertain");
  assert.equal(uncertain.status, "blocked");
  assert.equal(uncertain.request.desktopMutation, false);
  assert.match(uncertain.blocked.why_blocked, /uncertain|unknown/i);

  const escalation = await advisor.handle({
    trigger: "detector_escalation",
    eventId: "esc-1",
    trajectory: trajectory({ attempt_count: 3 }),
    escalation: {
      eventId: "esc-1",
      sessionId: "desktop-1",
      reason: "step_budget_exceeded",
      verdict: "stuck",
      recommendedAction: "pause",
      evidenceRefs: ["obs-1"],
    },
  });
  assert.equal(escalation.trigger, "detector_escalation");
  assert.equal(escalation.status, "needs_help");
  assert.equal(escalation.recovery.decides, false);
  assert.equal(escalation.recoveryRequest.role, "recovery");
  assert.equal(escalation.recoveryRequest.desktopMutation, false);
  assert.deepEqual(escalation.recoveryRequest.grants, []);
});

test("runtime follow-up uses the existing triggerTurn followUp channel and createBossEscalation", async () => {
  const calls = [];
  const advisor = createDirectDriveAdvisor({
    injectFollowUp: (text, envelope, report) =>
      queueAdvisorFollowUp({ sendMessage: (...args) => calls.push(args) }, text, envelope, report),
  });
  const result = await advisor.handle({
    trigger: "detector_escalation",
    eventId: "esc-follow",
    trajectory: trajectory({ attempt_count: 4 }),
    escalation: {
      eventId: "esc-follow",
      sessionId: "desktop-1",
      reason: "step_budget_exceeded",
      verdict: "stuck",
      recommendedAction: "pause",
      evidenceRefs: ["obs-1"],
    },
  });
  assert.equal(result.followUp.injected, true);
  assert.equal(result.followUp.envelope.kind, "escalate");
  assert.equal(result.followUp.envelope.agentId, "boss-direct-desktop-1");
  assert.equal(result.followUp.envelope.recommendedAction, "pause");
  assert.equal("transcript" in result.followUp.envelope, false);
  assert.deepEqual(calls[0][1], { triggerTurn: true, deliverAs: "followUp" });
  assert.equal(calls[0][0].customType, DIRECT_DRIVE_ADVISOR_CUSTOM_TYPE);
  assert.match(calls[0][0].content, /needs_help/);
  assert.equal(calls[0][0].details.report.status, "needs_help");

  const mapped = toAdvisorEscalationInput({
    eventId: "direct-drive-escalation-desktop-1",
    sessionId: "desktop-1",
    reason: "step_budget_exceeded",
    recommendedAction: "pause",
    evidenceRefs: ["obs-1"],
  });
  const envelope = createBossEscalation(mapped);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.value.kind, "escalate");
  assert.match(formatAdvisorFollowUpText(result.blocked, "detector_escalation"), /direct-drive-advisor/);
});

test("adviseFromStuckRecord / adviseFromDirectDriveResult compose without wrapping execute()", async () => {
  const advisor = createDirectDriveAdvisor();
  const looping = adviseFromStuckRecord(advisor, {
    verdict: "looping",
    reason: "repeated_action",
  }, "desktop-1");
  assert.equal(looping.fired, false);

  const stuck = await adviseFromStuckRecord(advisor, {
    verdict: "stuck",
    reason: "step_budget_exceeded",
    paused: true,
    event: {
      eventId: "direct-drive-escalation-desktop-9",
      sessionId: "desktop-9",
      reason: "step_budget_exceeded",
      verdict: "stuck",
      recommendedAction: "pause",
      evidenceRefs: ["obs-9"],
    },
    evidence: {
      steps: [{ action: { type: "act" }, error: null, screenChanged: false }],
      observationRefs: ["obs-9"],
    },
  }, "desktop-9");
  assert.equal(stuck.fired, true);
  assert.equal(stuck.trigger, "detector_escalation");

  const fromUnknown = await adviseFromDirectDriveResult(advisor, {
    sessionId: "desktop-2",
    action: { type: "act" },
    error: "mutation_outcome_unknown",
    screenChanged: null,
  });
  assert.equal(fromUnknown.trigger, "mutation_uncertain");
  assert.equal(fromUnknown.fired, true);

  const fromClaim = await adviseFromDirectDriveResult(advisor, {
    sessionId: "desktop-3",
    action: { type: "act" },
    screenChanged: true,
    claim: { kind: "completion" },
  });
  assert.equal(fromClaim.trigger, "completion_claim");
});

test("bounded operator escape allows one named desktop action and rejects long-task CUA form", () => {
  const ok = evaluateBoundedOperatorEscape({
    goal: "Click Save in TextEdit",
    desktop: "user-requested",
  });
  assert.equal(ok.ok, true);

  const leader = evaluateBoundedOperatorEscape({
    goal: "Click Save in TextEdit",
    desktop: "user-requested",
    agentName: "computer-use-leader",
  });
  assert.equal(leader.ok, false);
  assert.equal(leader.code, BOUNDED_OPERATOR_REJECT.longTask);

  const longGoal = evaluateBoundedOperatorEscape({
    goal: "Complete the workflow until done, then replan if needed",
    desktop: "user-requested",
  });
  assert.equal(longGoal.ok, false);
  assert.equal(longGoal.code, BOUNDED_OPERATOR_REJECT.longTask);

  const plan = evaluateBoundedOperatorEscape({
    goal: "Click Save in TextEdit",
    desktop: "ui-verify",
    planSteps: [{ id: "a" }, { id: "b" }],
  });
  assert.equal(plan.ok, false);

  const retain = evaluateBoundedOperatorEscape({
    goal: "Click Save in TextEdit",
    desktop: "user-requested",
    retainContext: true,
  });
  assert.equal(retain.ok, false);

  const noGrant = evaluateBoundedOperatorEscape({
    goal: "Click Save in TextEdit",
  });
  assert.equal(noGrant.ok, false);
  assert.equal(noGrant.code, BOUNDED_OPERATOR_REJECT.missingGrant);

  const noTarget = evaluateBoundedOperatorEscape({
    goal: "Click Save",
    desktop: "user-requested",
  });
  assert.equal(noTarget.ok, false);
  assert.equal(noTarget.code, BOUNDED_OPERATOR_REJECT.missingTarget);
});

test("injected verifier/recovery runners still cannot receive mutate grants", async () => {
  const seen = [];
  const advisor = createDirectDriveAdvisor({
    runVerifier: (request) => {
      seen.push(request);
      return { status: "blocked", summary: "postcondition missing", confirmed: false };
    },
    runRecovery: (request) => {
      seen.push(request);
      return {
        status: "blocked",
        kind: "change_interaction",
        summary: "try a different locator",
        recommended_next_actions: ["change_interaction"],
        decides: false,
      };
    },
  });
  await advisor.handle({ trigger: "completion_claim", eventId: "v1", trajectory: trajectory() });
  await advisor.handle({
    trigger: "detector_escalation",
    eventId: "r1",
    trajectory: trajectory(),
    escalation: { eventId: "r1", sessionId: "desktop-1", reason: "looping", verdict: "looping" },
  });
  assert.equal(seen.length, 2);
  for (const request of seen) {
    assert.equal(request.desktopMutation, false);
    assert.equal(request.holdsGuiSession, false);
    assert.ok(!request.grants.includes("mutate"));
    assert.ok(!request.tools.includes("desktop_act"));
  }
});
