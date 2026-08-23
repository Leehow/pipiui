import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Computer Use role manifests never pin a provider or model and runtime mirrors canonical resources", async () => {
  const roles = ["computer-use", "computer-use-leader", "operator", "computer-verifier", "computer-terminal"];
  for (const role of roles) {
    const runtime = await readFile(new URL(`../../Electron/resources/runtime/pi-ext/agents/${role}/AGENT.md`, import.meta.url), "utf8");
    assert.doesNotMatch(runtime, /^model:\s*\S+/m, `${role} must follow explicit settings/main model`);
    assert.match(runtime, /^name:\s*/m, `${role} runtime manifest is the canonical Electron resource`);
  }
  const leader = await readFile(new URL("../../Electron/resources/runtime/pi-ext/agents/computer-use-leader/AGENT.md", import.meta.url), "utf8");
  assert.match(leader, /Worker interface map/);
  assert.match(leader, /GUI Operator/);
  assert.match(leader, /closed\s+outcome/i);
  const agent = await readFile(new URL("../../Electron/resources/runtime/pi-ext/agents/computer-use/AGENT.md", import.meta.url), "utf8");
  assert.match(agent, /single Computer Use Agent/);
  assert.match(agent, /closed `outcome` is terminal/);
});
