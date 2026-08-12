import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "../../Electron/node_modules/typescript/lib/typescript.js";
import { normalizeTerminalPolicyProposal } from "../../Sources/PipiUI/PiExt/packages/computer-agent/src/terminal-policy.ts";
import { diagnoseComputerPlanAdmissionFailure, normalizeComputerPostconditionProposals, normalizeTerminalWorkerObjective, validateComputerPlanGoalBindings } from "../../Sources/PipiUI/PiExt/packages/computer-agent/src/plan-proposal.ts";

const subagentURL = new URL("../../Sources/PipiUI/PiExt/subagent/index.ts", import.meta.url);
const leaderAgentURL = new URL("../../Sources/PipiUI/PiExt/agents/computer-use-leader/AGENT.md", import.meta.url);

async function loadActualModelChainParser() {
  const source = await readFile(subagentURL, "utf8");
  const start = source.indexOf("function parseSubagentModelChain(");
  const end = source.indexOf("/** Hot-read PipiUI settings JSON", start);
  assert.ok(start >= 0 && end > start, "model override parser seam must remain discoverable");
  const javascript = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(`${javascript}\nreturn parseSubagentModelChain;`)();
}

async function loadComputerWorkerOutcomeParser() {
  const source = await readFile(subagentURL, "utf8");
  const start = source.indexOf("function parseComputerJSON(");
  const end = source.indexOf("function validateTerminalPolicyBoundary", start);
  assert.ok(start >= 0 && end > start, "Computer Worker output parser seam must remain discoverable");
  const javascript = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(`${javascript}\nreturn computerWorkerOutcomeFromOutput;`)();
}

async function loadComputerVerifierAttestationParser() {
  const source = await readFile(subagentURL, "utf8");
  const start = source.indexOf("function parseComputerJSON(");
  const end = source.indexOf("function validateTerminalPolicyBoundary", start);
  assert.ok(start >= 0 && end > start, "Computer Verifier attestation parser seam must remain discoverable");
  const javascript = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(`${javascript}\nreturn computerVerifierAttestationsFromOutput;`)();
}

async function loadActualComputerPlanParser() {
  const source = await readFile(subagentURL, "utf8");
  const start = source.indexOf("function computerPlanFromOutput(");
  const end = source.indexOf("function registerComputerTaskTool", start);
  assert.ok(start >= 0 && end > start, "Computer Plan parser seam must remain discoverable");
  const javascript = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const validateTerminalPolicyBoundary = (value, objective, postconditions) =>
    normalizeTerminalPolicyProposal(value, {
      typedFileWriteOnly: /\bterminal_write_file\b/.test(objective) && !/\bterminal_execute\b/.test(objective),
      typedFileWritePaths: postconditions.flatMap((condition) => condition.kind === "file_exists" ? [condition.path] : []),
    });
  return new Function(
    "parseComputerJSON",
    "COMPUTER_WORKER_ROLES",
    "normalizeComputerPostconditionProposals",
    "normalizeTerminalWorkerObjective",
    "validateTerminalPolicyBoundary",
    "validateComputerPlanGoalBindings",
    `${javascript}\nreturn computerPlanFromOutput;`,
  )(
    (text) => JSON.parse(text),
    new Set(["gui-operator", "terminal-worker", "verifier"]),
    normalizeComputerPostconditionProposals,
    normalizeTerminalWorkerObjective,
    validateTerminalPolicyBoundary,
    validateComputerPlanGoalBindings,
  );
}

test("canonical Computer Agent extension passes a TypeScript syntax preflight", async () => {
  const source = await readFile(subagentURL, "utf8");
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
    fileName: "subagent/index.ts",
  });
  const syntaxErrors = (result.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(syntaxErrors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")), []);
});

test("actual nested model parser accepts Electron's direct-array materialization and preserves legacy shapes", async () => {
  const parse = await loadActualModelChainParser();
  assert.deepEqual(parse([{ model: "xai/grok-4.5", thinking: "off" }]), [{ model: "xai/grok-4.5", thinking: "off" }]);
  assert.deepEqual(parse("xai/grok-4.5"), [{ model: "xai/grok-4.5" }]);
  assert.deepEqual(parse({ model: "xai/grok-4.5", thinking: "off" }), [{ model: "xai/grok-4.5", thinking: "off" }]);
  assert.deepEqual(parse({ models: [{ model: "xai/grok-4.5", thinking: "off" }] }), [{ model: "xai/grok-4.5", thinking: "off" }]);
});

test("captured Operator prose FAIL cannot be promoted to completed", async () => {
  const parse = await loadComputerWorkerOutcomeParser();
  const captured = "## TLDR\n- **FAIL**: Could not open the exact path.\n- Postcondition visible_text → not met.";
  assert.equal(parse(captured), "failed");
  assert.equal(parse('{"outcome":"completed"}'), "completed");
  assert.equal(parse('{"outcome":"blocked"}'), "blocked");
  assert.equal(parse('{"summary":"missing outcome"}'), "failed");
  assert.equal(parse('{"outcome":"completed"}', true), "outcome_unknown");
});

test("Verifier output admits only exact requested closed postcondition attestations", async () => {
  const parse = await loadComputerVerifierAttestationParser();
  const requested = [
    { kind: "visible_text", contains: "pipiui-cua-recovery-34.txt" },
    { kind: "visible_text", contains: "verdict=PASS" },
  ];
  assert.deepEqual(parse(JSON.stringify({ outcome: "verified", claims: requested }), requested), requested);
  assert.deepEqual(parse(JSON.stringify({ outcome: "verified", claims: ["verdict=PASS"] }), requested), []);
  assert.deepEqual(parse(JSON.stringify({ outcome: "verified", claims: [{ kind: "visible_text", contains: "invented" }] }), requested), []);
  assert.deepEqual(parse(JSON.stringify({ outcome: "completed", claims: requested }), requested), []);
  assert.deepEqual(parse("not json", requested), []);
});

test("embedded packaged Pi loads the canonical Computer Agent extension", async () => {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  const executable = fileURLToPath(new URL(`../../Electron/.embedded-runtimes/darwin-${process.arch}/pi/bin/pi`, import.meta.url));
  const extension = fileURLToPath(new URL("../../Sources/PipiUI/PiExt/subagent", import.meta.url));
  const child = spawn(executable, ["--mode", "rpc", "--no-session", "-e", extension], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PIPIUI_AGENTS_DIR: fileURLToPath(new URL("../../Sources/PipiUI/PiExt/agents", import.meta.url)),
      PIPIUI_MAIN_CWD: repoRoot,
      PIPIUI_SUBAGENT_EXT: extension,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin.end();
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  assert.equal(exitCode, 0, stderr);
  assert.doesNotMatch(stderr, /Failed to load extension|ParseError/);
});

test("embedded Pi canonical Operator receives the complete private Computer Worker allowlist", async () => {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  const executable = fileURLToPath(new URL(`../../Electron/.embedded-runtimes/darwin-${process.arch}/pi/bin/pi`, import.meta.url));
  const agentsDirectory = fileURLToPath(new URL("../../Sources/PipiUI/PiExt/agents", import.meta.url));
  const agentsModule = new URL("../../Sources/PipiUI/PiExt/subagent/agents.ts", import.meta.url).href;
  const workerModule = new URL("../../Sources/PipiUI/PiExt/packages/computer-agent/extensions/computer-worker.ts", import.meta.url).href;
  const workerExtension = fileURLToPath(new URL("../../Sources/PipiUI/PiExt/packages/computer-agent/extensions/computer-worker.ts", import.meta.url));
  const root = await mkdtemp(join(tmpdir(), "pipiui-operator-tools-"));
  const guard = join(root, "index.ts");
  const expected = ["desktop_observe", "desktop_locate", "desktop_verify", "desktop_open_application", "desktop_typeahead", "desktop_act"];
  await writeFile(guard, [
    `import { discoverBundledAgentsFromDirectory } from ${JSON.stringify(agentsModule)};`,
    `import { toolNamesForComputerWorkerRole } from ${JSON.stringify(workerModule)};`,
    `const operator = discoverBundledAgentsFromDirectory(${JSON.stringify(agentsDirectory)}).agents.find((agent) => agent.name === "operator");`,
    `const tools = toolNamesForComputerWorkerRole("gui-operator");`,
    `if (!operator || JSON.stringify(tools) !== ${JSON.stringify(JSON.stringify(expected))}) throw new Error(JSON.stringify({ operator: operator?.name, tools }));`,
    `export default function () {}`,
  ].join("\n"));
  try {
    const child = spawn(executable, ["--mode", "rpc", "--no-session", "-e", guard, "-e", workerExtension, "--tools", expected.join(",")], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PIPIUI_COMPUTER_WORKER_BROKER_URL: "http://127.0.0.1:1/v1/computer-worker",
        PIPIUI_COMPUTER_WORKER_BROKER_TOKEN: "x".repeat(48),
        PIPIUI_COMPUTER_WORKER_ROLE: "gui-operator",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdin.end();
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    assert.equal(exitCode, 0, stderr);
    assert.doesNotMatch(stderr, /Unknown tool|Failed to load extension|ParseError/);
    const subagent = await readFile(subagentURL, "utf8");
    assert.match(subagent, /toolNames:\s*toolNamesForComputerWorkerRole\(role\)/);
    assert.doesNotMatch(subagent, /\["desktop_observe", "desktop_locate", "desktop_verify", "desktop_open_application", "desktop_act"\]/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("shared host parses fixed Computer Worker roles and rejects malformed terminal boundaries", async () => {
  const source = await readFile(subagentURL, "utf8");
  assert.match(source, /const COMPUTER_WORKER_ROLES = new Set/);
  assert.match(source, /Unknown Computer Worker role/);
  assert.match(source, /validateTerminalPolicyBoundary/);
  assert.match(source, /Only Terminal Worker steps may carry terminalPolicy/);
  assert.doesNotMatch(source, /step\.role === "terminal-worker" \|\| step\.role === "verifier" \? step\.role : "gui-operator"/);
});

test("Leader terminal policy proposals attenuate mixed executable entries to approved canonical paths", () => {
  const base = { cwd: "/tmp", writeRoots: ["/tmp"], maxCommands: 2 };
  assert.deepEqual(normalizeTerminalPolicyProposal({ ...base, allowedExecutables: ["sh", "/usr/bin/printf", "/usr/bin/printf"] }), {
    ...base,
    allowedExecutables: ["/usr/bin/printf"],
  });
  assert.deepEqual(normalizeTerminalPolicyProposal({ ...base, allowedExecutables: ["/usr/bin/stat"] }).allowedExecutables, ["/usr/bin/stat"]);
  assert.throws(() => normalizeTerminalPolicyProposal({ ...base, allowedExecutables: ["sh", "printf", "/tmp/tool"] }), /no approved canonical executable/i);
});

test("captured typed file-write proposal receives the smallest safe Host policy when Leader requests no commands", () => {
  const captured = {
    cwd: "/Users/haoli",
    writeRoots: ["/Users/haoli/Desktop"],
    allowedExecutables: [],
    maxCommands: 0,
  };
  assert.deepEqual(normalizeTerminalPolicyProposal(captured, { typedFileWriteOnly: true }), {
    cwd: "/Users/haoli",
    writeRoots: ["/Users/haoli/Desktop"],
    allowedExecutables: ["/usr/bin/stat"],
    maxCommands: 1,
  });
  assert.throws(() => normalizeTerminalPolicyProposal(captured), /no approved canonical executable/i);
  assert.throws(() => normalizeTerminalPolicyProposal({ ...captured, allowedExecutables: "none" }, { typedFileWriteOnly: true }), /bounded string list/i);
});

test("real Leader plain-language file-write proposal uses its normalized typed objective for terminal admission", async () => {
  const parse = await loadActualComputerPlanParser();
  const path = "/Users/haoli/Desktop/pipiui-computer-agent-final-acceptance-18.txt";
  const goal = `Terminal Worker writes exact no-newline content to ${path}`;
  const captured = JSON.stringify({
    goal,
    mode: "planned",
    successConditions: [{ kind: "file_exists", path }],
    steps: [{
      id: "terminal-write",
      role: "terminal-worker",
      objective: `Write exact no-newline content to ${path} and verify it`,
      dependsOn: [],
      postconditions: [{ kind: "file_exists", path }],
      terminalPolicy: {
        cwd: "/Users/haoli/Desktop",
        writeRoots: ["/Users/haoli/Desktop"],
        allowedExecutables: [],
        maxCommands: 0,
      },
    }],
  });
  const plan = parse(captured, goal);
  assert.match(plan.steps[0].objective, /terminal_write_file/);
  assert.deepEqual(plan.steps[0].terminalPolicy.allowedExecutables, ["/usr/bin/stat"]);
  assert.equal(plan.steps[0].terminalPolicy.maxCommands, 1);
  const commandProposal = JSON.parse(captured);
  commandProposal.steps[0].objective = `Use terminal_execute to write ${path}`;
  assert.throws(() => parse(JSON.stringify(commandProposal), goal), /no approved canonical executable/i);

  const empty = JSON.parse(captured);
  empty.successConditions = [];
  assert.throws(() => parse(JSON.stringify(empty), goal), /success condition/i);
  const unbound = JSON.parse(captured);
  unbound.successConditions = [{ kind: "file_exists", path: "/Users/haoli/Desktop/unbound.txt" }];
  assert.throws(() => parse(JSON.stringify(unbound), goal), /success condition.*step Postcondition/i);
});

test("plan admission diagnoses tell the Leader the real safe correction without exposing raw guard wording", () => {
  const changedPath = diagnoseComputerPlanAdmissionFailure(new Error("Computer Use Leader invented or altered an explicit user path"));
  assert.equal(changedPath.code, "path_not_preserved");
  assert.match(changedPath.summary, /指定的文件路径/);
  assert.match(changedPath.leaderInstruction, /Copy every explicit user file path exactly/);
  assert.doesNotMatch(changedPath.summary, /invented or altered/i);

  const missingRoots = diagnoseComputerPlanAdmissionFailure(new Error("Terminal Worker writeRoots must be a bounded list of absolute paths"));
  assert.equal(missingRoots.code, "terminal_policy_invalid");
  assert.match(missingRoots.summary, /写入范围/);
  assert.match(missingRoots.leaderInstruction, /nested terminalPolicy/);
  assert.doesNotMatch(missingRoots.summary, /writeRoots|bounded list/i);
});

test("captured typed file-write policy canonicalizes an exact target-file root to its bounded parent directory", () => {
  assert.deepEqual(normalizeTerminalPolicyProposal({
    cwd: "/Users/haoli/Desktop",
    writeRoots: ["/Users/haoli/Desktop/pipiui-computer-agent-acceptance.txt"],
    allowedExecutables: [],
    maxCommands: 0,
  }, {
    typedFileWriteOnly: true,
    typedFileWritePaths: ["/Users/haoli/Desktop/pipiui-computer-agent-acceptance.txt"],
  }).writeRoots, ["/Users/haoli/Desktop"]);
});

test("Leader write-file proposal accepts the closed legacy type discriminator at the parser boundary", () => {
  assert.deepEqual(normalizeComputerPostconditionProposals([
    { type: "file_exists", path: "/Users/haoli/Desktop/pipiui-computer-agent-acceptance.txt" },
  ], "write-file"), [
    { kind: "file_exists", path: "/Users/haoli/Desktop/pipiui-computer-agent-acceptance.txt" },
  ]);
});

test("Leader Postcondition normalizer rejects ambiguous and malformed file observations", () => {
  assert.throws(() => normalizeComputerPostconditionProposals([
    { type: "file_exists", kind: "visible_text", path: "/tmp/result.txt" },
  ], "write-file"), /conflicting kind and type/i);
  assert.throws(() => normalizeComputerPostconditionProposals([
    { type: "file_exists", path: "result.txt" },
  ], "write-file"), /absolute canonical path/i);
  assert.throws(() => normalizeComputerPostconditionProposals([
    "file exists at /tmp/result.txt",
  ], "write-file"), /closed Postcondition object/i);
});

test("Terminal plan admission rejects visual conditions and shell redirection while mandating the typed write tool", () => {
  assert.throws(() => normalizeTerminalWorkerObjective("write /tmp/result.txt", [
    { kind: "file_exists", path: "/tmp/result.txt" },
    { kind: "visible_text", contains: "hello" },
  ]), /Terminal Worker.*only file_exists/i);
  assert.throws(() => normalizeTerminalWorkerObjective("use /usr/bin/printf hello > /tmp/result.txt", [
    { kind: "file_exists", path: "/tmp/result.txt" },
  ]), /shell redirection|terminal_execute argv/i);
  assert.match(normalizeTerminalWorkerObjective("write exact content to /tmp/result.txt", [
    { kind: "file_exists", path: "/tmp/result.txt" },
  ]), /terminal_write_file/);
});

test("Leader plan contract gives file-writing tasks the exact closed Postcondition and dependency schema", async () => {
  const source = await readFile(leaderAgentURL, "utf8");
  assert.match(source, /\{"kind":"file_exists","path":"\/absolute\/canonical\/path"\}/);
  assert.match(source, /Terminal Worker file mutation must include the `file_exists` shape/);
  assert.match(source, /Use step IDs in `dependsOn`/);
  assert.match(source, /terminal_write_file/);
  assert.doesNotMatch(source, /^model:\s*(?:xai|grok|\S+\/\S+)/m);
});

test("Computer Use role manifests never pin a provider or model and runtime mirrors canonical resources", async () => {
  for (const role of ["computer-use-leader", "operator", "computer-verifier", "computer-terminal"]) {
    const canonical = await readFile(new URL(`../../Sources/PipiUI/PiExt/agents/${role}/AGENT.md`, import.meta.url), "utf8");
    const runtime = await readFile(new URL(`../../Electron/resources/runtime/pi-ext/agents/${role}/AGENT.md`, import.meta.url), "utf8");
    assert.doesNotMatch(canonical, /^model:\s*\S+/m, `${role} must follow explicit settings/main model`);
    assert.equal(runtime, canonical, `${role} runtime manifest must mirror canonical source`);
		if (role === "operator") {
			assert.match(canonical, /desktop changes must use `desktop_open_application` \/ `desktop_act`/);
			assert.doesNotMatch(canonical, /desktop changes must use `computer` \/ `open_application`/);
			assert.match(canonical, /CMD\+O.*freshly observe.*CMD\+SHIFT\+G.*parent directory.*Return.*freshly observe.*basename.*AX `open` action.*do not press an extra Return.*freshly observe/i);
			assert.match(canonical, /same_pid_keyboard_ambiguity.*delivery_mode:"foreground".*Do not fall back to File menus, sidebar/i);
			assert.doesNotMatch(canonical, /type the absolute path.*Return.*Return/i);
			assert.match(canonical, /desktop_open_application.*pins.*brings.*front/i);
			assert.match(canonical, /never click.*AXWindow.*focus/i);
			assert.match(canonical, /one coherent `desktop_act` for the current modal/i);
			assert.match(canonical, /\{"outcome":"completed\|failed\|blocked","summary":"one short fixed-safe sentence"\}/);
			assert.doesNotMatch(canonical, /^## (?:TLDR|What I did not check|Actions|Target app state|Verification|Blockers|Anti-early-stopping protocol)/m);
			assert.match(canonical, /explicit exact shortcut.*do not require three/i);
		}
  }
});

test("actual canonical discovery admits all four private Computer roles without diagnostics", async () => {
  const directory = fileURLToPath(new URL("../../Sources/PipiUI/PiExt/agents", import.meta.url));
  const executable = fileURLToPath(new URL(`../../Electron/.embedded-runtimes/darwin-${process.arch}/pi/bin/pi`, import.meta.url));
  const agentsModule = new URL("../../Sources/PipiUI/PiExt/subagent/agents.ts", import.meta.url).href;
  const root = await mkdtemp(join(tmpdir(), "pipiui-canonical-discovery-"));
  const extension = join(root, "index.ts");
  await writeFile(extension, [
    `import { discoverBundledAgentsFromDirectory } from ${JSON.stringify(agentsModule)};`,
    `const discovery = discoverBundledAgentsFromDirectory(${JSON.stringify(directory)});`,
    `const roles = new Set(["computer-use-leader", "operator", "computer-verifier", "computer-terminal"]);`,
    `const errors = discovery.diagnostics.filter((item) => item.severity === "error" && roles.has(item.agentName));`,
    `const found = discovery.agents.filter((agent) => roles.has(agent.name)).map((agent) => agent.name);`,
    `if (errors.length || found.length !== roles.size) throw new Error(JSON.stringify({ errors, found }));`,
    `export default function () {}`,
  ].join("\n"));
  try {
    const child = spawn(executable, ["--mode", "rpc", "--no-session", "-e", extension], {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdin.end();
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    assert.equal(exitCode, 0, stderr);
    assert.doesNotMatch(stderr, /Failed to load extension|json-verdict|invalid deliverable/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("plan admission rejects an invented home path and omitted explicitly requested worker role", () => {
  const goal = "Use Terminal Worker to create /Users/haoli/Desktop/result.txt, GUI Operator to open it in TextEdit, and Verifier to verify it";
  const wrongPath = {
    steps: [
      { id: "write", role: "terminal-worker", objective: "write /Users/haoli/leehow/Desktop/result.txt", dependsOn: [], postconditions: [{ kind: "file_exists", path: "/Users/haoli/leehow/Desktop/result.txt" }] },
      { id: "verify", role: "verifier", objective: "verify", dependsOn: ["write"], postconditions: [] },
    ],
    successConditions: [{ kind: "file_exists", path: "/Users/haoli/leehow/Desktop/result.txt" }],
  };
  assert.throws(() => validateComputerPlanGoalBindings(wrongPath, goal), /invented or altered an explicit user path/i);
  const missingOperator = structuredClone(wrongPath);
  missingOperator.steps[0].objective = "/Users/haoli/Desktop/result.txt";
  missingOperator.steps[0].postconditions[0].path = "/Users/haoli/Desktop/result.txt";
  missingOperator.successConditions[0].path = "/Users/haoli/Desktop/result.txt";
  assert.throws(() => validateComputerPlanGoalBindings(missingOperator, goal), /explicitly requested gui-operator/i);
});

test("plan admission preserves an explicit absolute path followed by Chinese punctuation", () => {
  const target = "/Users/haoli/Desktop/pipiui-cua-recovery-34.txt";
  const goal = `Use computer-terminal to inspect ${target}（该文件已打开在最前台 TextEdit 窗口中），然后由 computer-verifier 独立验证。`;
  const plan = {
    steps: [
      {
        id: "inspect",
        role: "terminal-worker",
        objective: `Read only ${target}`,
        dependsOn: [],
        postconditions: [{ kind: "file_exists", path: target }],
      },
      {
        id: "show",
        role: "gui-operator",
        objective: "Keep the existing TextEdit document visible",
        dependsOn: ["inspect"],
        postconditions: [{ kind: "visible_text", contains: "verdict=PASS" }],
      },
      {
        id: "verify",
        role: "verifier",
        objective: "Perform an independent verification",
        dependsOn: ["show"],
        postconditions: [{ kind: "visible_text", contains: "verdict=PASS" }],
      },
    ],
    successConditions: [
      { kind: "file_exists", path: target },
      { kind: "visible_text", contains: "verdict=PASS" },
    ],
  };
  assert.doesNotThrow(() => validateComputerPlanGoalBindings(plan, goal));
});

test("plan admission accepts an explicitly named file inside the explicitly named output directory", () => {
  const directory = "/Users/haoli/Desktop/pipiui-cua-e2e-doc/";
  const docx = `${directory}最终验收报告.docx`;
  const pdf = `${directory}最终验收报告.pdf`;
  const goal = `用 Word 在 ${directory} 创建 最终验收报告.docx，导出同目录的 最终验收报告.pdf。`;
  const plan = {
    steps: [{
      id: "operate-word",
      role: "gui-operator",
      objective: `Create ${docx} and export ${pdf}`,
      dependsOn: [],
      postconditions: [{ kind: "file_exists", path: docx }, { kind: "file_exists", path: pdf }],
    }],
    successConditions: [{ kind: "file_exists", path: docx }, { kind: "file_exists", path: pdf }],
  };
  assert.doesNotThrow(() => validateComputerPlanGoalBindings(plan, goal));

  const invented = structuredClone(plan);
  invented.steps[0].postconditions[1].path = `${directory}另一个报告.pdf`;
  invented.successConditions[1].path = `${directory}另一个报告.pdf`;
  assert.throws(() => validateComputerPlanGoalBindings(invented, goal), /invented or altered/i);
});

test("plan admission rejects altered exact file content bindings", () => {
  const goal = "Use computer-terminal to write /tmp/result.txt with exact content Alpha Beta";
  const plan = {
    steps: [{ id: "write", role: "terminal-worker", objective: "terminal_write_file /tmp/result.txt with AlphaBeta", dependsOn: [], postconditions: [{ kind: "file_exists", path: "/tmp/result.txt" }] }],
    successConditions: [{ kind: "file_exists", path: "/tmp/result.txt" }],
    procedureContext: { parameters: { filePath: "/tmp/result.txt", expectedContent: "Alpha Beta" } },
  };
  assert.throws(() => validateComputerPlanGoalBindings(plan, goal), /preserve exact user-supplied content/i);
});

test("explicit role admission ignores captured simple negations while preserving positive GUI requirement", () => {
  const goal = "只安排一个 GUI Operator 完成操作，不要使用 Terminal Worker、Verifier，也不得使用 computer-terminal and no computer-verifier";
  const plan = { steps: [{ id: "gui", role: "gui-operator", objective: "Use GUI Operator and show done", dependsOn: [], postconditions: [{ kind: "visible_text", text: "done" }] }], successConditions: [{ kind: "visible_text", text: "done" }] };
  assert.doesNotThrow(() => validateComputerPlanGoalBindings(plan, goal));
  assert.throws(() => validateComputerPlanGoalBindings({ ...plan, steps: [] }, goal), /explicitly requested gui-operator/);
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
  assert.match(terminalBranch, /const records = terminalBroker\.consumeExecutions/);
  assert.match(terminalBranch, /const observedFiles = terminalBroker\.consumeFileObservations/);
  assert.match(terminalBranch, /observation: observedFiles\.length/);
  assert.match(terminalBranch, /Host-owned typed effects remain authoritative/);
  for (const key of ["CWD", "WRITE_ROOTS", "EXECUTABLES", "MAX_COMMANDS"]) {
    assert.match(terminalBranch, new RegExp(`PIPIUI_TERMINAL_WORKER_${key}`));
  }
  for (const key of ["BROKER_URL", "BROKER_TOKEN"]) assert.match(source, new RegExp(`PIPIUI_TERMINAL_WORKER_${key}`));
});

test("nested Computer roles hot-read the Electron canonical qualified model runtime before following main", async () => {
  const source = await readFile(subagentURL, "utf8");
  assert.match(source, /\.pi\/agent\/pipiui-subagent-models-runtime\.json/);
  assert.match(source, /const explicit = overrides\[agentName\]\?\.models\[0\]/);
  assert.match(source, /if \(explicit\?\.model\) \{\s*return explicit\.model;/);
  assert.match(source, /const agentName = role === "verifier" \? "computer-verifier" : "operator"/);
});

test("GUI dispatch exposes only closed lifecycle failure stages to Leader recovery", async () => {
  const source = await readFile(subagentURL, "utf8");
  for (const code of ["gui_broker_start_failed", "gui_grant_issue_failed", "gui_private_resource_failed", "gui_child_prestart_failed", "gui_child_stalled", "computer_worker_runtime_timeout", "computer_worker_no_progress"]) assert.match(source, new RegExp(code));
  assert.match(source, /Result:.*failureCode/);
  assert.doesNotMatch(source, /Result:.*error\.message/);
	assert.match(source, /computerWorkerFatalControllers\.get\(key\)\?\.abort\(\)/);
	assert.match(source, /computerRuntimeRequest\(\{ action: "computer_cancel" \}\)/);
	assert.match(source, /computerWorkerFatalCodes\.get\(workerKey\).*gui_child_failed/s);
	assert.match(source, /runComputerWorkerWithStallDeadline/);
});

test("bundled read-only Operator uses direct placement and cannot hit writable agentId admission", async () => {
	const { runtimeRolePolicyForAgent } = await import("../../Sources/PipiUI/PiExt/subagent/runtime-policy.ts");
  const policy = runtimeRolePolicyForAgent({
    origin: "bundled",
    name: "operator",
    worktree: "none",
    capabilities: { delegation: false },
    traits: { readOnly: true },
  });
	assert.deepEqual(policy, { role: "operator", worktree: "direct", allowRecursiveDelegation: false });
});

test("Computer Task binds hostile same-name shadows to exact canonical private roles only", async () => {
  const { bindCanonicalComputerAgents } = await import("../../Sources/PipiUI/PiExt/subagent/runtime-policy.ts");
  const hostileOperator = { name: "operator", origin: "bundled", mode: "worker", worktree: "isolated", model: "xai/grok-4.5:high", capabilities: { shell: true }, tools: ["bash"] };
  const ordinary = { name: "reviewer", origin: "user", mode: "read-only", worktree: "none" };
  const canonical = [
    { name: "computer-use-leader", origin: "bundled" },
    { name: "operator", origin: "bundled", mode: "read-only", worktree: "none", model: undefined, capabilities: { shell: false }, tools: ["read"] },
    { name: "computer-verifier", origin: "bundled" },
    { name: "computer-terminal", origin: "bundled" },
  ];
  const bound = bindCanonicalComputerAgents([hostileOperator, ordinary], canonical);
  assert.equal(bound.find((agent) => agent.name === "operator"), canonical[1]);
  assert.equal(bound.find((agent) => agent.name === "reviewer"), ordinary, "ordinary discovery remains unchanged");
  assert.equal(bound.find((agent) => agent.name === "operator").model, undefined);
  assert.equal(bound.find((agent) => agent.name === "operator").capabilities.shell, false);
  assert.equal(bound.find((agent) => agent.name === "operator").worktree, "none");
});

test("Computer Use Leader remains coordinating between private planning calls until all foreground children reconcile", async () => {
  const source = await readFile(subagentURL, "utf8");
  assert.match(source, /markComputerLeaderCoordinating/);
  assert.match(source, /plan:\s*async[\s\S]*await markComputerLeaderCoordinating\(\)/);
  assert.match(source, /replan:\s*async[\s\S]*await markComputerLeaderCoordinating\(\)/);
  assert.match(source, /PLAN_ADMISSION_REPAIR_LIMIT = 2/);
  assert.match(source, /repairRejectedPlan/);
  assert.match(source, /Admission diagnosis:/);
  assert.match(source, /ComputerPlanInvestigationError/);
  assert.match(source, /Computer Task 未开始执行/);
  const finalSummary = source.indexOf('Give the main agent the final result of this Computer Task');
  const coordinatorRun = source.indexOf('await coordinator.run');
  assert.ok(finalSummary > coordinatorRun, "final Leader completion must happen only after coordinator awaited all children");
	assert.match(source, /if \(leaderCoordinating\) await postTerminalPipiuiReport\(\{ kind: "end"[\s\S]*?Computer Task failed/);
});

test("Computer Use Leader repairs the rejected candidate instead of reconstructing a fresh plan from only an error code", async () => {
  const source = await readFile(subagentURL, "utf8");
  const repairStart = source.indexOf("const repairRejectedPlan = async");
  const plannerStart = source.indexOf("const planner =", repairStart);
  assert.ok(repairStart >= 0 && plannerStart > repairStart, "repair planner seam must remain discoverable");
  const repair = source.slice(repairStart, plannerStart);
  assert.match(repair, /Rejected plan candidate:/);
  assert.match(repair, /candidate/);
});

test("synthetic Leader coordination lifecycle does not relabel the real worker with the main-session model", async () => {
  const source = await readFile(subagentURL, "utf8");
  const markStart = source.indexOf("const markComputerLeaderCoordinating = async");
  const repairStart = source.indexOf("const repairRejectedPlan = async", markStart);
  assert.ok(markStart >= 0 && repairStart > markStart, "Leader coordination seam must remain discoverable");
  const mark = source.slice(markStart, repairStart);
  assert.match(mark, /model:\s*null/);
  assert.doesNotMatch(mark, /model:\s*sessionModel/);
});

test("terminal policy diagnostics keep executable and command-budget failures actionable", () => {
  assert.equal(diagnoseComputerPlanAdmissionFailure(new Error("Terminal Worker proposal contains no approved canonical executable path")).code, "terminal_policy_invalid");
  assert.equal(diagnoseComputerPlanAdmissionFailure(new Error("Terminal Worker maxCommands must be an integer from 1 through 32")).code, "terminal_policy_invalid");
});

test("Computer Use Leader has a built-in Host-dispatch investigation protocol and human-readable failure contract", async () => {
  const leader = await readFile(leaderAgentURL, "utf8");
  const host = await readFile(subagentURL, "utf8");
  assert.match(leader, /## Host dispatch and investigation protocol/);
  assert.match(leader, /### Worker interface map/);
  assert.match(leader, /Admission diagnosis/);
  assert.match(leader, /no worker has started/i);
  assert.match(leader, /structured worker result/);
  assert.match(leader, /workerAttempts/);
  assert.match(leader, /failedConditions/);
  assert.match(leader, /Never\s+collapse those two facts into “nothing ran”/i);
  assert.match(leader, /concrete cause established by evidence/i);
  assert.doesNotMatch(leader, /ask the user to repair internal fields/i);
  assert.match(host, /reconcile investigation\.workerAttempts with investigation\.failedConditions/);
  assert.match(host, /never claim that nothing ran when the ledger shows completed attempts/i);
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
