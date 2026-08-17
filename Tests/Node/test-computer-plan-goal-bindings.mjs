import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "../../Electron/node_modules/typescript/lib/typescript.js";
import {
  createComputerPlanRepairTracker,
  diagnoseComputerPlanAdmissionFailure,
  normalizeComputerPostconditionProposals,
  normalizeTerminalWorkerObjective,
  shouldRepairComputerPlanAdmission,
  validateComputerPlanCandidateCuaOnly,
  validateComputerPlanGoalBindings,
} from "../../Electron/resources/runtime/pi-ext/packages/computer-agent/src/plan-proposal.ts";

const visible = { kind: "visible_text", contains: "edited interface" };
const goal = "Use GUI Operator for two serial UI edits, then Verifier to independently verify the edited interface";

async function loadElectronComputerPlanParser() {
  const source = await readFile(new URL("../../Electron/resources/runtime/pi-ext/subagent/index.ts", import.meta.url), "utf8");
  const start = source.indexOf("function computerPlanFromOutput(");
  const end = source.indexOf("const PLAN_ADMISSION_MAX_DISTINCT_CANDIDATES", start);
  const javascript = ts.transpileModule(source.slice(start, end), { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(
    "parseComputerJSON", "COMPUTER_WORKER_ROLES", "normalizeComputerPostconditionProposals", "normalizeTerminalWorkerObjective", "validateTerminalPolicyBoundary", "validateComputerPlanCandidateCuaOnly", "validateComputerPlanGoalBindings",
    `${javascript}\nreturn computerPlanFromOutput;`,
  )(
    JSON.parse,
    new Set(["gui-operator", "terminal-worker", "verifier"]),
    normalizeComputerPostconditionProposals,
    normalizeTerminalWorkerObjective,
    () => { throw new Error("terminal policy validation ran before Cua admission"); },
    validateComputerPlanCandidateCuaOnly,
    validateComputerPlanGoalBindings,
  );
}

test("plan admission follows serial GUI dependencies to the verifier", () => {
  const serial = {
    steps: [
      { id: "open-ui", role: "gui-operator", objective: "Open the Electron interface", dependsOn: [], postconditions: [visible] },
      { id: "edit-ui", role: "gui-operator", objective: "Edit the opened interface", dependsOn: ["open-ui"], postconditions: [visible] },
      { id: "verify-ui", role: "verifier", objective: "Independently verify the edit", dependsOn: ["edit-ui"], postconditions: [visible] },
    ],
    successConditions: [visible],
  };
  assert.doesNotThrow(() => validateComputerPlanGoalBindings(serial, goal));

  const noDependency = structuredClone(serial);
  noDependency.steps[2].dependsOn = [];
  assert.throws(() => validateComputerPlanGoalBindings(noDependency, goal), /Verifier must depend on the requested GUI Operator step/);

  const disconnected = structuredClone(serial);
  disconnected.steps[1].dependsOn = [];
  assert.throws(() => validateComputerPlanGoalBindings(disconnected, goal), /Verifier must depend on the requested GUI Operator step/);
});

test("Computer Task admission rejects every non-Cua worker and action", () => {
  const terminalWorker = {
    steps: [
      { id: "inspect", role: "terminal-worker", objective: "Use terminal_read_file to inspect package.json", dependsOn: [], postconditions: [] },
      { id: "open", role: "gui-operator", objective: "Open the Electron app", dependsOn: ["inspect"], postconditions: [visible] },
    ],
    successConditions: [visible],
  };
  assert.throws(() => validateComputerPlanGoalBindings(terminalWorker, "Open the Electron app"), /Computer Task accepts only Cua desktop actions/);

  const disguisedTerminalAction = structuredClone(terminalWorker);
  disguisedTerminalAction.steps = [
    { id: "open", role: "gui-operator", objective: "Open Terminal and run npm start, then open the Electron app", dependsOn: [], postconditions: [visible] },
  ];
  assert.throws(() => validateComputerPlanGoalBindings(disguisedTerminalAction, "Open the Electron app"), /Computer Task accepts only Cua desktop actions/);

  const diagnostic = diagnoseComputerPlanAdmissionFailure(new Error("Computer Task accepts only Cua desktop actions; terminal/file/shell/bootstrap work belongs to the Boss"));
  assert.equal(diagnostic.code, "non_cua_worker_not_allowed");
  assert.match(diagnostic.leaderInstruction, /ordinary tools/i);
  assert.equal(shouldRepairComputerPlanAdmission(diagnostic), false, "non-Cua plans return to the Boss without another Leader call");

  assert.throws(() => validateComputerPlanCandidateCuaOnly({
    steps: [{ role: "terminal-worker", objective: "Use terminalreadfile", postconditions: [], terminalPolicy: { writeRoots: [], maxCommands: 0 } }],
  }), /Computer Task accepts only Cua desktop actions/, "raw role admission must precede terminal policy validation");
});

test("Electron plan parser diagnoses the captured terminal candidate before terminal policy repair", async () => {
  const parse = await loadElectronComputerPlanParser();
  const captured = JSON.stringify({
    goal: "Read README and launch Electron",
    mode: "planned",
    successConditions: [{ kind: "file_exists", path: "/tmp/README.md" }],
    steps: [{ id: "read", role: "terminal-worker", objective: "Use terminalreadfile to read README.md", dependsOn: [], postconditions: [{ kind: "file_exists", path: "/tmp/README.md" }], terminalPolicy: { cwd: "/tmp", writeRoots: [], allowedExecutables: [], maxCommands: 0 } }],
  });
  assert.throws(() => parse(captured, "First use terminalreadfile, then launch Electron"), /Computer Task accepts only Cua desktop actions/);
});

test("plan repair tracker stops a semantically equivalent revision", () => {
  const first = JSON.stringify({
    goal: "Open the Electron model manager",
    mode: "planned",
    procedureContext: { application: { bundleId: "org.example.App", appName: "Example App" }, parameters: {}, qualification: true },
    successConditions: [{ kind: "visible_text", contains: "Save Key" }],
    steps: [
      { id: "inspect", role: "terminal-worker", objective: "Use terminal_read_file on package.json", dependsOn: [], postconditions: [{ kind: "file_exists", path: "/tmp/package.json" }], terminalPolicy: { cwd: "/tmp", writeRoots: [], allowedExecutables: [], maxCommands: 0 } },
      { id: "open", role: "gui-operator", objective: "Open the model manager", dependsOn: ["inspect"], postconditions: [{ kind: "visible_text", contains: "Save Key" }] },
    ],
  });
  const equivalentRepair = JSON.stringify({
    goal: "Open the Electron model manager",
    mode: "planned",
    procedureContext: { application: { appName: "Example App", bundleId: "org.example.App" }, parameters: {}, qualification: true },
    successConditions: [{ kind: "visible_text", contains: "Save Key" }],
    steps: [
      { id: "read-files", role: "terminal-worker", objective: "Inspect package.json with /usr/bin/head", dependsOn: [], postconditions: [{ kind: "file_exists", path: "/tmp/package.json" }], terminalPolicy: { cwd: "/tmp", writeRoots: ["/tmp"], allowedExecutables: ["/usr/bin/head"], maxCommands: 3 } },
      { id: "show-dialog", role: "gui-operator", objective: "Navigate to the model manager dialog", dependsOn: ["read-files"], postconditions: [{ kind: "visible_text", contains: "Save Key" }] },
    ],
  });
  const differentTarget = equivalentRepair.replace("Save Key", "Provider Settings").replace("Save Key", "Provider Settings");
  const differentApplication = equivalentRepair.replace("org.example.App", "org.example.Other");

  const tracker = createComputerPlanRepairTracker();
  assert.equal(tracker.admit(first), true);
  assert.equal(tracker.admit(equivalentRepair), false);
  assert.equal(tracker.size, 1);
  assert.equal(tracker.admit(differentTarget), true);
  assert.equal(tracker.admit(differentApplication), true);
});
