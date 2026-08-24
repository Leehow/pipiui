import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Computer Use role manifests never pin a provider or model and runtime mirrors canonical resources", async () => {
  const roles = ["computer-use", "operator", "computer-verifier", "computer-terminal"];
  for (const role of roles) {
    const runtime = await readFile(new URL(`../../Electron/resources/runtime/pi-ext/agents/${role}/AGENT.md`, import.meta.url), "utf8");
    assert.doesNotMatch(runtime, /^model:\s*\S+/m, `${role} must follow explicit settings/main model`);
    assert.match(runtime, /^name:\s*/m, `${role} runtime manifest is the canonical Electron resource`);
  }
  const subagent = await readFile(new URL("../../Electron/resources/runtime/pi-ext/subagent/index.ts", import.meta.url), "utf8");
  assert.match(subagent, /computer_task_leader_retired/);
  assert.doesNotMatch(subagent, /new ComputerAgentCoordinator/);
  assert.doesNotMatch(subagent, /runChild\("computer-use-leader"/);
});
