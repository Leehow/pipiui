import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const subagentURL = new URL("../../Sources/PipiUI/PiExt/subagent/index.ts", import.meta.url);

test("shared host parses fixed Computer Worker roles and rejects malformed terminal boundaries", async () => {
  const source = await readFile(subagentURL, "utf8");
  assert.match(source, /const COMPUTER_WORKER_ROLES = new Set/);
  assert.match(source, /Unknown Computer Worker role/);
  assert.match(source, /validateTerminalPolicyBoundary/);
  assert.match(source, /Only Terminal Worker steps may carry terminalPolicy/);
  assert.doesNotMatch(source, /step\.role === "terminal-worker" \|\| step\.role === "verifier" \? step\.role : "gui-operator"/);
});

test("terminal dispatch uses only its attenuated host tool broker and mounts scoped extension, tools, and env bounds", async () => {
  const source = await readFile(subagentURL, "utf8");
  const terminalStart = source.indexOf('if (role === "terminal-worker")');
  const guiStart = source.indexOf("broker ??= await ensureComputerWorkerBroker()", terminalStart);
  assert.ok(terminalStart >= 0 && guiStart > terminalStart, "desktop broker must be lazy and after terminal branch");
  const terminalBranch = source.slice(terminalStart, guiStart);
  assert.doesNotMatch(terminalBranch, /ensureComputerWorkerBroker|PIPIUI_COMPUTER_WORKER_BROKER/);
  assert.match(terminalBranch, /TerminalWorkerBrokerServer/);
  assert.match(terminalBranch, /terminalBroker\.issue/);
  assert.match(terminalBranch, /COMPUTER_TERMINAL_EXTENSION/);
  for (const tool of ["terminal_read_file", "terminal_write_file", "terminal_file_status", "terminal_execute"]) {
    assert.match(terminalBranch, new RegExp(`"${tool}"`));
  }
  assert.match(terminalBranch, /terminal-investigation/);
  assert.match(terminalBranch, /procedure-learning/);
  for (const key of ["CWD", "WRITE_ROOTS", "EXECUTABLES", "MAX_COMMANDS"]) {
    assert.match(terminalBranch, new RegExp(`PIPIUI_TERMINAL_WORKER_${key}`));
  }
  for (const key of ["BROKER_URL", "BROKER_TOKEN"]) assert.match(source, new RegExp(`PIPIUI_TERMINAL_WORKER_${key}`));
});

test("all unrelated child spawns strip terminal policy and isolated terminal children accept only attenuated broker and policy keys", async () => {
  const source = await readFile(subagentURL, "utf8");
  assert.match(source, /TERMINAL_WORKER_ENV_KEYS/);
  assert.match(source, /for \(const key of Object\.keys\(env\)\)/);
  assert.match(source, /key\.startsWith\("PIPIUI_TERMINAL_"\)/);
  assert.doesNotMatch(source, /key\.startsWith\("PIPIUI_TERMINAL_WORKER_"\)\s*\|\| key === "PIPIUI_AGENT_ID"/);
});

test("all Computer Workers use a positive environment allowlist and private resources are realpath-contained regular files", async () => {
  const source = await readFile(subagentURL, "utf8");
  assert.match(source, /options\?\.computerWorker\s*\n\s*\? isolatedComputerWorkerChildProcessEnv/);
  assert.match(source, /desktopWorkerEnvKeys/);
  assert.match(source, /containedRegularComputerResource/);
  assert.match(source, /fs\.realpathSync/);
  assert.match(source, /const metadata = fs\.statSync\(realCandidate\)/);
  assert.match(source, /!metadata\.isFile\(\) \|\| metadata\.nlink !== 1/);
  assert.match(source, /Computer Agent Cua private skill\/driver contract mismatch/);
  assert.doesNotMatch(source, /new JsonProcedureStore/);
});
