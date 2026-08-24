import test from "node:test";
import assert from "node:assert/strict";

import {
  CHANGE_INTERACTION_PROMPT,
  CHANGE_STRATEGY_PROMPT,
  DIRECT_DRIVE_PAUSED_CODE,
  DIRECT_DRIVE_PROGRESS_EVENT_KIND,
  computeHardSignals,
  createConservativeProgressDetector,
  createDirectDriveStuckGuard,
  isSafetyBoundaryError,
  stepFromDirectDriveResult,
  summarizeTrajectory,
  toBossEscalationInput,
} from "../../Electron/resources/runtime/pi-ext/packages/computer-agent/src/stuck-detector.ts";

const click = (x = 12, y = 40) => ({ type: "act", actions: [{ type: "click", x, y }] });

function step(overrides = {}) {
  return {
    action: click(),
    result: { ok: true },
    screenChanged: true,
    error: null,
    ...overrides,
  };
}

async function feed(guard, steps) {
  const records = [];
  for (const item of steps) records.push(await guard.record(item));
  return records;
}

test("normal progress stays progressing and injects nothing", async () => {
  const guard = createDirectDriveStuckGuard({ sessionId: "desktop-ok" });
  const records = await feed(guard, [
    step({ action: click(1, 1), observationRef: "obs-1" }),
    step({ action: click(2, 2), observationRef: "obs-2" }),
    step({ action: { type: "act", actions: [{ type: "type", text: "hello" }] }, observationRef: "obs-3" }),
  ]);
  for (const record of records) {
    assert.equal(record.verdict, "progressing");
    assert.equal(record.paused, false);
    assert.equal(record.injection, undefined);
    assert.equal(record.event, undefined);
  }
  assert.equal(guard.paused, false);
});

test("unchanged screenshots are a hard signal that starts looping, not an immediate pause", async () => {
  const guard = createDirectDriveStuckGuard({ sessionId: "desktop-still" });
  await guard.record(step({ action: click(8, 8), screenChanged: false, observationRef: "still-1" }));
  const second = await guard.record(step({ action: click(9, 9), screenChanged: false, observationRef: "still-2" }));
  assert.equal(second.verdict, "looping");
  assert.equal(second.paused, false);
  assert.equal(second.injection.kind, "change_interaction");
  assert.match(second.injection.prompt, /different interaction/i);
  assert.equal(second.evidence.hardSignals.consecutiveUnchanged >= 2, true);
  assert.equal(second.evidence.hardSignals.triggered, true);
});

test("repeated action+params is a hard signal that starts looping", async () => {
  const guard = createDirectDriveStuckGuard({ sessionId: "desktop-repeat" });
  await guard.record(step({ action: click(12, 40), screenChanged: null }));
  const second = await guard.record(step({ action: click(12, 40), screenChanged: null }));
  assert.equal(second.verdict, "looping");
  assert.equal(second.evidence.hardSignals.repeatedAction, true);
  assert.equal(second.injection.kind, "change_interaction");
});

test("consecutive action errors are a hard signal that starts looping", async () => {
  const guard = createDirectDriveStuckGuard({ sessionId: "desktop-errors" });
  await guard.record(step({ error: "locator_missed", screenChanged: null }));
  const second = await guard.record(step({
    action: click(3, 4),
    error: "locator_missed",
    screenChanged: null,
  }));
  assert.equal(second.verdict, "looping");
  assert.equal(second.evidence.hardSignals.consecutiveErrors >= 2, true);
  assert.equal(second.injection.kind, "change_interaction");
});

test("looping escalates through two distinct injections and then force-pauses as stuck", async () => {
  const guard = createDirectDriveStuckGuard({ sessionId: "desktop-loop" });
  const loop = () => step({ action: click(12, 40), screenChanged: false, observationRef: "loop" });
  const first = await guard.record(loop());
  assert.equal(first.verdict, "progressing");

  const nudge = await guard.record(loop());
  assert.equal(nudge.verdict, "looping");
  assert.equal(nudge.injection.kind, "change_interaction");
  assert.equal(nudge.injection.prompt, CHANGE_INTERACTION_PROMPT);

  const recover = await guard.record(loop());
  assert.equal(recover.verdict, "looping");
  assert.equal(recover.injection.kind, "change_strategy");
  assert.equal(recover.injection.prompt, CHANGE_STRATEGY_PROMPT);
  assert.notEqual(recover.injection.prompt, nudge.injection.prompt);
  assert.match(recover.injection.prompt, /strategy|recovery/i);

  const paused = await guard.record(loop());
  assert.equal(paused.verdict, "stuck");
  assert.equal(paused.paused, true);
  assert.equal(paused.injection, undefined);
  assert.equal(paused.event.kind, DIRECT_DRIVE_PROGRESS_EVENT_KIND);
  assert.equal(paused.event.recommendedAction, "pause");
  assert.equal(paused.event.sessionId, "desktop-loop");
  assert.ok(paused.event.evidenceRefs.includes("loop"));

  const again = await guard.record(loop());
  assert.equal(again.paused, true);
  assert.equal(again.injection, undefined);
  assert.equal(again.event.eventId, paused.event.eventId);
  assert.equal(guard.paused, true);
});

test("step budget force-pauses even when actions differ and the screen changes", async () => {
  const guard = createDirectDriveStuckGuard({ sessionId: "desktop-budget", stepBudget: 3 });
  await guard.record(step({ action: click(1, 1) }));
  await guard.record(step({ action: click(2, 2) }));
  const over = await guard.record(step({ action: click(3, 3) }));
  assert.equal(over.verdict, "stuck");
  assert.equal(over.paused, true);
  assert.equal(over.reason, "step_budget_exceeded");
  assert.equal(over.event.kind, DIRECT_DRIVE_PROGRESS_EVENT_KIND);
  assert.equal(over.evidence.hardSignals.budgetExceeded, true);
  assert.equal(over.evidence.hardSignals.stepsUsed, 3);
});

test("hard signals trigger a check but do not monopolize the semantic verdict", async () => {
  let judged = 0;
  const guard = createDirectDriveStuckGuard({
    sessionId: "desktop-semantic",
    detector: {
      judge(input) {
        judged += 1;
        assert.equal(input.hardSignals.triggered, true);
        assert.equal(input.steps.length <= 8, true);
        return {
          verdict: "progressing",
          reason: "semantic_override",
          evidence: { hardSignals: input.hardSignals, steps: [...input.steps], observationRefs: [] },
        };
      },
    },
  });
  await guard.record(step({ action: click(12, 40), screenChanged: false }));
  const second = await guard.record(step({ action: click(12, 40), screenChanged: false }));
  assert.equal(judged >= 1, true);
  assert.equal(second.verdict, "progressing");
  assert.equal(second.injection, undefined);
  assert.equal(second.paused, false);
});

test("detector cannot override a safety boundary or mint a desktop grant", async () => {
  const guard = createDirectDriveStuckGuard({
    sessionId: "desktop-safe",
    detector: {
      judge(input) {
        return {
          verdict: "progressing",
          reason: "ignore_grant",
          evidence: { hardSignals: input.hardSignals, steps: [...input.steps], observationRefs: [] },
        };
      },
    },
  });
  const denied = await guard.record(step({
    action: click(1, 1),
    error: "desktop_grant_required: open a session with desktop:\"user-requested\"",
    screenChanged: null,
  }));
  assert.equal(isSafetyBoundaryError(denied.evidence.steps.at(-1).error), true);
  assert.notEqual(denied.verdict, "progressing");
  assert.equal(denied.reason, "safety_boundary_not_overridable");
  assert.equal(denied.event?.recommendedAction === "grant" || denied.injection?.prompt.includes("desktop:"), false);
});

test("paused guard consumes DirectDriveResult and blocks further mutations", async () => {
  const guard = createDirectDriveStuckGuard({ sessionId: "desktop-wrap", stepBudget: 2 });
  const asResult = (overrides) => ({
    action: { type: "act", actions: [{ type: "click", x: 1, y: 1 }] },
    observation: { observationId: "obs-1" },
    screenChanged: false,
    error: null,
    sessionId: "desktop-wrap",
    spawnedLeader: false,
    ...overrides,
  });

  const firstStep = stepFromDirectDriveResult(asResult({ observation: { observationId: "obs-1" } }));
  const secondStep = stepFromDirectDriveResult(asResult({
    action: { type: "act", actions: [{ type: "click", x: 2, y: 2 }] },
    observation: { observationId: "obs-2" },
  }));
  await guard.record(firstStep);
  const paused = await guard.record(secondStep);
  assert.equal(paused.paused, true);
  assert.equal(paused.event.kind, DIRECT_DRIVE_PROGRESS_EVENT_KIND);

  const third = stepFromDirectDriveResult(asResult({
    action: { type: "act", actions: [{ type: "click", x: 3, y: 3 }] },
    observation: { observationId: "obs-3" },
  }));
  const blocked = await guard.record(third);
  assert.equal(blocked.paused, true);
  assert.equal(blocked.verdict, "stuck");
  assert.equal(DIRECT_DRIVE_PAUSED_CODE, "direct_drive_paused");

  assert.equal(stepFromDirectDriveResult(asResult({ action: { type: "close" }, observation: null })), null);
});

test("trajectory summary stays bounded and the phase-3 seam maps onto a Boss escalation envelope", () => {
  const steps = Array.from({ length: 12 }, (_, index) => step({
    action: click(index, index),
    observationRef: `obs-${index}`,
  }));
  const summary = summarizeTrajectory(steps, { windowSize: 4 });
  assert.equal(summary.length, 4);
  assert.equal(summary[0].observationRef, "obs-8");
  assert.equal("screenshotBase64" in summary[0], false);

  const signals = computeHardSignals([
    step({ action: click(1, 1), screenChanged: false, error: "boom" }),
    step({ action: click(1, 1), screenChanged: false, error: "boom" }),
  ], { stepBudget: 10 });
  assert.equal(signals.triggered, true);
  assert.equal(signals.repeatedAction, true);

  const envelope = toBossEscalationInput({
    kind: DIRECT_DRIVE_PROGRESS_EVENT_KIND,
    eventId: "direct-drive-escalation-desktop-1",
    sessionId: "desktop-1",
    verdict: "stuck",
    reason: "step_budget_exceeded",
    recommendedAction: "pause",
    evidenceRefs: ["obs-8"],
    hardSignals: signals,
    safetyBoundary: false,
  });
  assert.equal(envelope.kind, "escalate");
  assert.equal(envelope.agentId, "boss-direct-desktop-1");
  assert.equal(envelope.recommendedAction, "pause");
  assert.deepEqual(envelope.evidenceRefs, ["obs-8"]);
  assert.equal("transcript" in envelope, false);
  assert.equal("steps" in envelope, false);

  assert.equal(stepFromDirectDriveResult({ action: { type: "session" } }), null);
  assert.equal(createConservativeProgressDetector().judge({
    sessionId: "x",
    steps: [],
    hardSignals: computeHardSignals([]),
  }).verdict, "progressing");
});
