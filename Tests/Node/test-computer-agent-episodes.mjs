import test from "node:test";
import assert from "node:assert/strict";
import {
  computerTaskContent,
  computerTaskDetails,
  computerTaskRootTerminalState,
} from "../../Electron/resources/runtime/pi-ext/packages/computer-agent/src/coordinator.ts";

test("closed computer_task helpers still project a direct-drive style envelope without a Leader", () => {
  const result = {
    outcome: "succeeded",
    summary: "clicked Save in TextEdit",
    verification: { status: "verified", conditionResults: [] },
    planRevisions: 0,
  };
  const root = {
    agentId: "desktop-1",
    runId: "run-1",
    parentId: null,
    name: "computer-use",
    role: "computer-use-agent",
    terminalState: "ok",
    result: { outcome: "completed", summary: "clicked Save in TextEdit" },
  };
  const details = computerTaskDetails(result, root, []);
  assert.equal(details.outcome, "succeeded");
  assert.equal(computerTaskRootTerminalState(result), "ok");
  const content = computerTaskContent(details, "clicked Save in TextEdit");
  assert.match(content, /clicked Save in TextEdit/);
  assert.doesNotMatch(content, /computer-use-leader/);
});
