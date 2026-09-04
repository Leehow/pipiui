import test from "node:test";
import assert from "node:assert/strict";

import { supervisorDeliveryArmsAlarm } from "../supervisor/host-seam.ts";
import type { BossEscalationEnvelope } from "../supervisor/contract.ts";

const escalation = { kind: "escalate" } as BossEscalationEnvelope;

test("a terminal episode stays armed until the Boss acknowledges it", () => {
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
