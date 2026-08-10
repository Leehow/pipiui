import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  decodeHostCommandV1,
  decodePlanEventV1,
} from "../../Sources/PipiUI/PiExt/subagent-host/contract.ts";
import {
  encodeAgentEventBridgeRequestV1,
  encodePlanEventBridgeRequestV1,
  usesCanonicalHostProtocolV1,
} from "../../Sources/PipiUI/PiExt/subagent/host-bridge.ts";

const fixtureURL = new URL(
  "../../Sources/PipiUI/PiExt/subagent-host/fixtures/current-bridge-compat-v0.json",
  import.meta.url,
);

async function fixture() {
  return JSON.parse(await readFile(fixtureURL, "utf8"));
}

test("bridge encoder preserves the legacy Swift golden by default and stamps every event with its captured runId", async () => {
  const current = await fixture();
  const event = {
    kind: "update",
    agentId: "agent-a",
    runId: "run-a",
    output: "legacy flat bridge body now retains the producer run identity",
    activity: "write adapter",
    cost: 0.1,
    turns: 1,
  };
  const environment = {
    PIPIUI_SESSION_KEY: current.currentAgentUpdate.sessionKey,
  };

  assert.equal(usesCanonicalHostProtocolV1(environment), false);
  assert.deepEqual(
    encodeAgentEventBridgeRequestV1(event, environment),
    current.currentAgentUpdate,
    "flag-off output must stay the existing flat Swift bridge shape",
  );
});

test("bridge encoder opts into canonical v1 once, uses sessionCapability, fails closed without runId, and also encodes plan envelopes", () => {
  const capability = "canonical-capability-0123456789abcdef";
  const environment = {
    PIPIUI_HOST_PROTOCOL: "1",
    PIPIUI_SESSION_CAPABILITY: capability,
    PIPIUI_SESSION_KEY: "legacy-alias-must-not-be-used-0123456789",
  };
  assert.equal(usesCanonicalHostProtocolV1(environment), true);

  const canonical = encodeAgentEventBridgeRequestV1({
    kind: "log_delta",
    agentId: "agent-canonical",
    runId: "run-canonical",
    contentIndex: 0,
    itemType: "text",
    text: "streamed",
  }, environment);
  assert.deepEqual(canonical, {
    schemaVersion: 1,
    sessionCapability: capability,
    action: "agent_event",
    event: {
      schemaVersion: 1,
      kind: "log_delta",
      agentId: "agent-canonical",
      runId: "run-canonical",
      contentIndex: 0,
      itemType: "text",
      text: "streamed",
    },
  });
  const decoded = decodeHostCommandV1(canonical);
  assert.equal(decoded.ok, true, JSON.stringify(decoded.diagnostics));
  assert.equal(decoded.value.sessionCapability, capability, "canonical body must not read the legacy alias");
  assert.equal(decoded.value.event.runId, "run-canonical");

  assert.equal(
    encodeAgentEventBridgeRequestV1({ kind: "update", agentId: "agent-canonical" }, environment),
    undefined,
    "missing runId must fail closed instead of asking the host to infer one from agentId",
  );
  assert.equal(
    encodeAgentEventBridgeRequestV1({ kind: "update", agentId: "agent-canonical", runId: "run-canonical" }, {
      PIPIUI_HOST_PROTOCOL: "1",
      PIPIUI_SESSION_KEY: capability,
    }),
    undefined,
    "canonical mode requires PIPIUI_SESSION_CAPABILITY rather than silently falling back to SESSION_KEY",
  );

  const plan = encodePlanEventBridgeRequestV1({
    event: "approve",
    planId: "plan-canonical",
  }, environment);
  const decodedPlanCommand = decodeHostCommandV1(plan);
  assert.equal(decodedPlanCommand.ok, true, JSON.stringify(decodedPlanCommand.diagnostics));
  assert.equal(decodedPlanCommand.value.action, "plan_event");
  const decodedPlan = decodePlanEventV1(decodedPlanCommand.value.event);
  assert.equal(decodedPlan.ok, true, JSON.stringify(decodedPlan.diagnostics));
  assert.equal(decodedPlan.value.planId, "plan-canonical");
});
