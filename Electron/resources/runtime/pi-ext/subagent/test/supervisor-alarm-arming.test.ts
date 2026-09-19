import test from "node:test";
import assert from "node:assert/strict";

import { supervisorDeliveryArmsAlarm } from "../supervisor/host-seam.ts";
import type { BossEscalationEnvelope } from "../supervisor/contract.ts";

const escalation = { kind: "escalate" } as BossEscalationEnvelope;

test("a successful completion is consumed after the Boss sees it, while abnormal terminals stay armed", () => {
  assert.equal(supervisorDeliveryArmsAlarm({
    kind: "completion",
    job: { status: "completed", verify: "passed" },
  }), false);
  assert.equal(supervisorDeliveryArmsAlarm({
    kind: "completion",
    job: { status: "failed", verify: "failed" },
  }), true);
  // Missing job evidence remains fail-closed and keeps the old alarm behavior.
  assert.equal(supervisorDeliveryArmsAlarm({ kind: "completion" }), true);
  assert.equal(supervisorDeliveryArmsAlarm({ kind: "upgrade_failure" }), true);
});

test("an escalation stays armed: it is asking the Boss for a decision", () => {
  assert.equal(supervisorDeliveryArmsAlarm({ kind: "escalate", envelope: escalation }), true);
  // Even a wave carrying an escalation envelope is a request, not a summary.
  assert.equal(supervisorDeliveryArmsAlarm({ kind: "wave", envelope: escalation }), true);
});

test("a bare wave summary is not armed", () => {
  // The observed loop: an armed wave re-woke the Boss every minute over a line
  // whose correct response was "nothing to do, keep waiting", and held real
  // completion receipts behind it while the Boss stayed busy.
  assert.equal(supervisorDeliveryArmsAlarm({ kind: "wave" }), false);
});

import { fallbackReachesBoss } from "../supervisor/delivery.ts";
import type { SupervisorDeliveryRequest } from "../supervisor/delivery.ts";

function request(kind: SupervisorDeliveryRequest["kind"]): SupervisorDeliveryRequest {
  return {
    kind,
    agentId: "coc-build",
    runId: "run-1",
    sequence: 1,
    summary: "two drivers streaming",
    publicText: "[wave] 2 running",
    job: { agentId: "coc-build", runId: "run-1", status: "running" },
  } as SupervisorDeliveryRequest;
}

test("a supervisor failure still hands the Boss what it must not miss", () => {
  assert.equal(fallbackReachesBoss(request("completion"), 2), true);
  assert.equal(fallbackReachesBoss(request("stall"), 2), true);
  assert.equal(fallbackReachesBoss(request("upgrade_failure"), 2), true);
});

test("a wave that closes the generation still reaches the Boss", () => {
  assert.equal(fallbackReachesBoss(request("wave"), 0), true);
});

test("a wave about workers that are still running is absorbed, not queued at the Boss", () => {
  // It has no acknowledgement to give, and it shares the follow-up queue with
  // the user's own messages. The next wave restates the same state anyway.
  assert.equal(fallbackReachesBoss(request("wave"), 2), false);
});
