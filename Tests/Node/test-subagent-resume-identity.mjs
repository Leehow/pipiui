import test from "node:test";
import assert from "node:assert/strict";

import * as subagentRuntime from "../../Electron/resources/runtime/pi-ext/subagent/index.ts";

test("same agentId preserves its persisted agent type across every resume mode", () => {
  const problem = subagentRuntime.agentResumeIdentityProblem;
  assert.equal(typeof problem, "function", "agentResumeIdentityProblem must be an exported behavioral seam");

  assert.match(problem({
    agentId: "cua-op-example",
    historicalName: "operator",
    requestedName: "general-purpose",
    fresh: false,
  }), /belongs to "operator".*not "general-purpose".*new agentId/i);

  assert.equal(problem({
    agentId: "cua-op-example",
    historicalName: "operator",
    requestedName: "operator",
    fresh: false,
  }), null);

  assert.match(problem({
    agentId: "cua-op-example",
    historicalName: "operator",
    requestedName: "general-purpose",
    fresh: true,
  }), /belongs to "operator".*not "general-purpose".*new agentId/i);

  assert.equal(problem({
    agentId: "new-agent",
    requestedName: "general-purpose",
    fresh: false,
  }), null);
});
