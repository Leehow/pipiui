import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";

const runtime = new URL("../../Electron/resources/runtime/pi-ext/", import.meta.url);

async function missing(relative) {
  try {
    await access(new URL(relative, runtime), constants.F_OK);
    return false;
  } catch {
    return true;
  }
}

test("Computer Use Leader agent, skills, and coordinator class are gone", async () => {
  assert.equal(await missing("agents/computer-use-leader/AGENT.md"), true);
  assert.equal(await missing("packages/computer-agent/skills/computer-task-planning/SKILL.md"), true);
  assert.equal(await missing("packages/computer-agent/skills/computer-task-recovery/SKILL.md"), true);
  assert.equal(await missing("packages/computer-agent/skills/procedure-learning/SKILL.md"), true);

  const [coordinator, index, policy, philosophy] = await Promise.all([
    readFile(new URL("packages/computer-agent/src/coordinator.ts", runtime), "utf8"),
    readFile(new URL("subagent/index.ts", runtime), "utf8"),
    readFile(new URL("subagent/runtime-policy.ts", runtime), "utf8"),
    readFile(new URL("../pi-philosophy/layers/30-orchestration.md", runtime), "utf8"),
  ]);
  assert.doesNotMatch(coordinator, /export class ComputerAgentCoordinator/);
  assert.doesNotMatch(coordinator, /export async function runComputerLeaderWithStallDeadline/);
  assert.doesNotMatch(index, /new ComputerAgentCoordinator/);
  assert.doesNotMatch(index, /registerLegacyComputerTaskTool/);
  assert.doesNotMatch(index, /runChild\("computer-use-leader"/);
  assert.match(index, /RETIRED_COMPUTER_AGENT_NAMES/);
  assert.match(index, /computer_task_leader_retired/);
  assert.match(policy, /RETIRED_COMPUTER_AGENT_NAMES = \["computer-use-leader", "computer-use"\]/);
  assert.match(philosophy, /Boss-driven desktop/);
  assert.match(philosophy, /screenshot\/action loop/);
  assert.doesNotMatch(philosophy, /Its private Computer Use Leader owns/);
  assert.doesNotMatch(philosophy, /supervising role such as\s+Computer Use Leader/);
});
