import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ComputerAgentCoordinator,
  evaluatePostconditions,
  projectComputerWorkerResult,
} from "../../Electron/resources/runtime/pi-ext/packages/computer-agent/src/coordinator.ts";
import {
  COMPUTER_LEADER_STALL_TIMEOUT_MS,
  COMPUTER_WORKER_STALL_TIMEOUT_MS,
  runComputerLeaderWithStallDeadline,
  runComputerWorkerWithStallDeadline,
} from "../../Electron/resources/runtime/pi-ext/packages/computer-agent/src/coordinator.ts";
import { diagnoseComputerPlanAdmissionFailure, normalizeComputerTaskRecoveryPolicy } from "../../Electron/resources/runtime/pi-ext/packages/computer-agent/src/plan-proposal.ts";
import {
  ComputerWorkerBroker,
  grantsForComputerRole,
	mutationSignature,
} from "../../Sources/PipiUI/PiExt/packages/computer-agent/src/worker-broker.ts";
import { ComputerWorkerBrokerServer } from "../../Sources/PipiUI/PiExt/packages/computer-agent/src/worker-broker-server.ts";
import { TerminalWorkerBrokerServer } from "../../Sources/PipiUI/PiExt/packages/computer-agent/src/terminal-broker-server.ts";
import { validateTerminalStep } from "../../Sources/PipiUI/PiExt/packages/computer-agent/src/terminal-policy.ts";
import { skillNamesForComputerRole } from "../../Sources/PipiUI/PiExt/packages/computer-agent/src/workers.ts";
import { registerComputerTerminalTools, toolNamesForTerminalWorkerRole } from "../../Sources/PipiUI/PiExt/packages/computer-agent/extensions/computer-terminal.ts";
import {
	registerComputerWorkerTools,
  toolNamesForComputerWorkerRole,
} from "../../Sources/PipiUI/PiExt/packages/computer-agent/extensions/computer-worker.ts";
import {
  JsonProcedureStore,
  ProcedureReplayEngine,
  ReadOnlyComputerRecipeAdapter,
  compileProcedureCandidate,
  lintProcedure,
} from "../../Sources/PipiUI/PiExt/packages/computer-agent/src/procedures.ts";
import { TaskArtifactStore, compressWorkerTrajectory } from "../../Sources/PipiUI/PiExt/packages/computer-agent/src/artifacts.ts";

const app = { bundleId: "com.apple.TextEdit", appName: "TextEdit" };
const postcondition = { kind: "file_exists", pathParameter: "outputFile" };
const terminalPolicy = { cwd: "/tmp", writeRoots: ["/tmp"], allowedExecutables: ["/usr/bin/stat", "/usr/bin/file", "/usr/bin/printf"], maxCommands: 3 };

test("Electron Computer Use instructions keep application targeting, snapshots, and screenshot evidence honest", async () => {
  const investigation = await readFile(new URL("../../Electron/resources/runtime/pi-ext/packages/computer-agent/skills/desktop-investigation/SKILL.md", import.meta.url), "utf8");
  const operation = await readFile(new URL("../../Electron/resources/runtime/pi-ext/packages/computer-agent/skills/cua-driver-operation/SKILL.md", import.meta.url), "utf8");
  const planning = await readFile(new URL("../../Electron/resources/runtime/pi-ext/packages/computer-agent/skills/computer-task-planning/SKILL.md", import.meta.url), "utf8");
  assert.match(investigation, /observe the desktop first.*exact running application identity/i);
  assert.match(investigation, /failed application-name lookup.*never.*unrelated application/i);
  assert.match(investigation, /one snapshot-bound mutation.*fresh observation.*relocat/i);
  assert.match(investigation, /freshly observed single-action token.*stale.*coordinate fallback/i);
  assert.match(investigation, /screenshotId.*not.*filesystem path/i);
  assert.match(investigation, /absolute screenshot path.*blocked/i);
  assert.match(operation, /collapsible.*(?:thinking|internal notes).*label.*not.*error/i);
  assert.match(operation, /never (?:expand|open).*raw chain-of-thought/i);
  assert.match(operation, /input.*disabled.*stop.*(?:progress|in-progress)/i);
  assert.match(operation, /step.*elapsed.*token.*advance/i);
  assert.match(operation, /bounded wait.*fresh observe.*worker.*deadline/i);
  assert.match(operation, /every wait.*mandatory post-wait observation fence/i);
  assert.match(operation, /must not return.*completed.*verified.*blocked.*failed.*desktop_observe.*fresh:true.*succeeds/is);
  assert.match(operation, /only.*successful post-wait observation.*terminal UI.*Postconditions.*error.*no-progress/is);
  assert.match(operation, /do not issue a wait.*deadline.*required fresh observe/i);
  assert.match(operation, /input.*enabled.*stop.*disappear.*new reply/i);
  assert.match(operation, /must not.*extend|never.*re-arm/i);
  assert.match(operation, /explicit.*RPC.*provider.*error/i);
  assert.match(planning, /procedureContext.*qualified Procedure replay.*omit/i);
  assert.match(planning, /bundleId.*appName.*parameters/i);
  assert.match(planning, /PID.*build path.*bridge port/i);
});

test("generic plan admission recovery does not invent incomplete procedure context", async () => {
  const diagnostic = diagnoseComputerPlanAdmissionFailure(new Error("Computer Plan schema validation failed"));
  assert.equal(diagnostic.code, "plan_schema_invalid");
  assert.match(diagnostic.leaderInstruction, /omit procedureContext/i);
  assert.match(diagnostic.leaderInstruction, /exact application bundleId.*appName.*parameters/i);
  assert.match(diagnostic.leaderInstruction, /PID.*path.*port/i);
});

test("only a closed explicit no-recovery goal clause normalizes to typed fail-fast policy", () => {
  assert.equal(normalizeComputerTaskRecoveryPolicy("不要生成恢复计划；observe失败立即如实停止。"), "fail_fast");
  assert.equal(normalizeComputerTaskRecoveryPolicy("Do not create a recovery plan; if observation fails, stop immediately."), "fail_fast");
  assert.equal(normalizeComputerTaskRecoveryPolicy("如果 observe 失败就修复后重试。"), "auto");
  assert.equal(normalizeComputerTaskRecoveryPolicy("Do not hide failures, but repair and retry if observe fails."), "auto");
  assert.equal(normalizeComputerTaskRecoveryPolicy("ordinary task", "fail_fast"), "fail_fast");
  assert.equal(normalizeComputerTaskRecoveryPolicy("不要生成恢复计划；observe失败立即停止。", "auto"), "auto");
});

test("Computer Worker desktop tools are sequential and broker runtime calls are bounded/fail-fast", async () => {
  const tools = [];
  registerComputerWorkerTools({ registerTool: (tool) => tools.push(tool) }, {
    PIPIUI_COMPUTER_WORKER_BROKER_URL: "http://127.0.0.1:1/v1/computer-worker",
    PIPIUI_COMPUTER_WORKER_BROKER_TOKEN: "x".repeat(32),
    PIPIUI_COMPUTER_WORKER_ROLE: "gui-operator",
  }, async () => { throw new Error("not called"); });
  assert.equal(tools.length, 6);
  assert.ok(tools.every((tool) => tool.executionMode === "sequential"));
	const typeaheadTool = tools.find((tool) => tool.name === "desktop_typeahead");
	assert.ok(typeaheadTool, "GUI Operator receives a discoverable dedicated file-list type-ahead tool");
	assert.deepEqual(typeaheadTool.parameters.required, ["basename"]);
	assert.match(typeaheadTool.description, /exact basename.*Open.*Save.*AXList/i);
	assert.deepEqual(Object.keys(typeaheadTool.parameters.properties), ["basename"]);

  const canonicalShapeTools = [];
  registerComputerWorkerTools({ registerTool: (tool) => canonicalShapeTools.push(tool) }, {
    PIPIUI_COMPUTER_WORKER_BROKER_URL: "http://127.0.0.1:1/v1/computer-worker",
    PIPIUI_COMPUTER_WORKER_BROKER_TOKEN: "x".repeat(32),
    PIPIUI_COMPUTER_WORKER_ROLE: "gui-operator",
  }, async () => new Response(JSON.stringify({ observationId: "observation:canonical", base64: "REAL_CANONICAL_SCREENSHOT", mimeType: "image/webp", accessibility: { elements: [] } }), { status: 200, headers: { "content-type": "application/json" } }));
  const canonicalResult = await canonicalShapeTools.find((tool) => tool.name === "desktop_observe").execute("canonical", {}, undefined);
  assert.deepEqual(canonicalResult.content.find((part) => part.type === "image"), { type: "image", data: "REAL_CANONICAL_SCREENSHOT", mimeType: "image/webp" });
  assert.doesNotMatch(canonicalResult.content.find((part) => part.type === "text").text, /REAL_CANONICAL_SCREENSHOT|base64/);
	const actSchema = canonicalShapeTools.find((tool) => tool.name === "desktop_act").parameters.properties.actions;
	assert.equal(JSON.stringify(actSchema.items).includes('"typeahead"'), false, "nested desktop_act no longer exposes the internal type-ahead action");
  assert.match(actSchema.description, /CMD','O'.*fresh observe.*CMD','SHIFT','G'.*parent-directory.*RETURN.*fresh observe.*desktop_typeahead.*exact basename.*immutable document surface.*do not press an extra Return/i);
  assert.match(actSchema.description, /hotkeys.*never attach element_token, element_index, or snapshot_id/i);
  assert.match(actSchema.description, /same_pid_keyboard_ambiguity.*foreground delivery.*never fall back to menus or sidebar/i);
	assert.match(actSchema.description, /desktop_typeahead.*only the exact basename.*ordinary type inserts into a text field.*must not substitute/i);
  assert.doesNotMatch(actSchema.description, /exact\/absolute\/path/);
  assert.ok(actSchema.items.oneOf.length >= 6);

	let dedicatedRequest;
	const dedicatedTools = [];
	registerComputerWorkerTools({ registerTool: (tool) => dedicatedTools.push(tool) }, {
	  PIPIUI_COMPUTER_WORKER_BROKER_URL: "http://127.0.0.1:1/v1/computer-worker",
	  PIPIUI_COMPUTER_WORKER_BROKER_TOKEN: "x".repeat(32),
	  PIPIUI_COMPUTER_WORKER_ROLE: "gui-operator",
	}, async (_url, init) => {
	  dedicatedRequest = JSON.parse(String(init.body));
	  return new Response(JSON.stringify({ observationId: "observation:typeahead", accessibility: { elements: [] } }), { status: 200, headers: { "content-type": "application/json" } });
	});
	await dedicatedTools.find((tool) => tool.name === "desktop_typeahead").execute("typeahead", {
	  basename: "pipiui-computer-agent-final-acceptance-21.txt",
	}, undefined);
	assert.deepEqual(dedicatedRequest.payload.actions, [{
	  type: "typeahead",
	  text: "pipiui-computer-agent-final-acceptance-21.txt",
	}]);

  const locallySerialized = [];
  let activeFetches = 0;
  let maxActiveFetches = 0;
  let localFetchCalls = 0;
  let releaseFirstFetch;
  registerComputerWorkerTools({ registerTool: (tool) => locallySerialized.push(tool) }, {
    PIPIUI_COMPUTER_WORKER_BROKER_URL: "http://127.0.0.1:1/v1/computer-worker",
    PIPIUI_COMPUTER_WORKER_BROKER_TOKEN: "x".repeat(32),
    PIPIUI_COMPUTER_WORKER_ROLE: "gui-operator",
  }, async () => {
    localFetchCalls += 1;
    activeFetches += 1;
    maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
    if (localFetchCalls === 1) await new Promise((resolve) => { releaseFirstFetch = resolve; });
    activeFetches -= 1;
    return new Response(JSON.stringify({ observationId: `observation:${Date.now()}` }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const localObserve = locallySerialized.find((tool) => tool.name === "desktop_observe");
  const localFirst = localObserve.execute("one", {}, undefined);
  const localSecond = localObserve.execute("two", {}, undefined);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(maxActiveFetches, 1);
  releaseFirstFetch();
  await Promise.all([localFirst, localSecond]);
  assert.equal(maxActiveFetches, 1);

  let release;
  const broker = new ComputerWorkerBroker({ requestTimeoutMs: 25, request: () => new Promise((resolve) => { release = resolve; }) });
  const issued = broker.issue({ taskId: "task", stepId: "step", runId: "run", role: "gui-operator" });
  const first = broker.execute(issued.token, { operation: "observe", payload: { fresh: true } });
  await assert.rejects(broker.execute(issued.token, { operation: "observe", payload: { fresh: true } }), /computer_worker_request_in_progress/);
  release({ observationId: "observation:one" });
  await first;

  const timeoutBroker = new ComputerWorkerBroker({ requestTimeoutMs: 20, request: (_request, signal) => new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("raw private runtime error")), { once: true })) });
  const timed = timeoutBroker.issue({ taskId: "task", stepId: "timeout", runId: "run", role: "gui-operator" });
  await assert.rejects(timeoutBroker.execute(timed.token, { operation: "observe", payload: {} }), /^Error: computer_worker_runtime_timeout$/);

  let rejectLate;
  let calls = 0;
  const fatalEvents = [];
  const ignoringBroker = new ComputerWorkerBroker({ requestTimeoutMs: 20, onFatal: (event) => fatalEvents.push(event), request: () => {
    calls += 1;
    if (calls === 1) return new Promise((_resolve, reject) => { rejectLate = reject; });
    return Promise.resolve({ observationId: "observation:after-timeout" });
  } });
  const ignoring = ignoringBroker.issue({ taskId: "task", stepId: "ignores-abort", runId: "run", role: "gui-operator" });
  await assert.rejects(ignoringBroker.execute(ignoring.token, { operation: "mutate", payload: { actions: [{ type: "click", x: 1, y: 2 }], semanticBindings: [] } }), /^Error: computer_worker_runtime_timeout$/);
  assert.deepEqual(ignoringBroker.consumeExecutions("task", "ignores-abort"), []);
  await assert.rejects(ignoringBroker.execute(ignoring.token, { operation: "observe", payload: {} }), /^Error: computer_worker_runtime_timeout$/);
  assert.equal(fatalEvents.length, 1);
  const recovered = ignoringBroker.issue({ taskId: "task", stepId: "fresh-grant", runId: "run-2", role: "gui-operator" });
  await ignoringBroker.execute(recovered.token, { operation: "observe", payload: {} });
  rejectLate(new Error("late raw private runtime rejection"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(ignoringBroker.consumeExecutions("task", "ignores-abort"), []);

  let typedCalls = 0;
  const typedFatalEvents = [];
  const typedTimeoutBroker = new ComputerWorkerBroker({ requestTimeoutMs: 1_000, onFatal: (event) => typedFatalEvents.push(event), request: async () => {
    typedCalls += 1;
    if (typedCalls === 1) throw Object.assign(new Error("private driver timeout detail"), { code: "cua_driver_rpc_timeout" });
    return { observationId: "observation:fresh-transport" };
  } });
  const typed = typedTimeoutBroker.issue({ taskId: "task", stepId: "typed-driver-timeout", runId: "run-3", role: "gui-operator" });
  await assert.rejects(typedTimeoutBroker.execute(typed.token, { operation: "mutate", payload: { actions: [{ type: "click", x: 3, y: 4 }], semanticBindings: [] } }), /^Error: computer_worker_runtime_timeout$/);
  await assert.rejects(typedTimeoutBroker.execute(typed.token, { operation: "observe", payload: {} }), /^Error: computer_worker_runtime_timeout$/);
  assert.equal(typedCalls, 1, "typed timeout poisons the grant before model retry reaches Runtime");
  assert.equal(typedFatalEvents.length, 1);
  assert.deepEqual(typedTimeoutBroker.consumeExecutions("task", "typed-driver-timeout"), []);
  const typedFresh = typedTimeoutBroker.issue({ taskId: "task", stepId: "typed-fresh", runId: "run-4", role: "gui-operator" });
  await typedTimeoutBroker.execute(typedFresh.token, { operation: "observe", payload: {} });

  let observationCalls = 0;
  const progressFatalEvents = [];
  const progressBroker = new ComputerWorkerBroker({ onFatal: (event) => progressFatalEvents.push(event), request: async (request) => ({ observationId: `observation:${++observationCalls}`, accessibility: { elements: [] }, action: request.action }) });
  const observeOnly = progressBroker.issue({ taskId: "task", stepId: "observe-only", runId: "run-5", role: "gui-operator" });
  for (let index = 0; index < 3; index += 1) await progressBroker.execute(observeOnly.token, { operation: "observe", payload: { fresh: true } });
  await assert.rejects(progressBroker.execute(observeOnly.token, { operation: "observe", payload: { fresh: true } }), /^Error: computer_worker_no_progress$/);
  await assert.rejects(progressBroker.execute(observeOnly.token, { operation: "observe", payload: { fresh: true } }), /^Error: computer_worker_no_progress$/);
  assert.equal(observationCalls, 3, "observe-only exhaustion terminates before another Runtime screenshot");
  assert.equal(progressFatalEvents.length, 1);
  assert.equal(progressFatalEvents[0].code, "computer_worker_no_progress");
  assert.deepEqual(progressBroker.consumeExecutions("task", "observe-only"), []);

  const progressing = progressBroker.issue({ taskId: "task", stepId: "observe-act-observe", runId: "run-6", role: "gui-operator" });
  await progressBroker.execute(progressing.token, { operation: "observe", payload: { fresh: true } });
  await progressBroker.execute(progressing.token, { operation: "mutate", payload: { actions: [{ type: "key", key: "ENTER" }], semanticBindings: [] } });
  await progressBroker.execute(progressing.token, { operation: "observe", payload: { fresh: true } });
  assert.equal(progressFatalEvents.length, 1, "a consequential action resets the consecutive-observation budget");

  let temporalCalls = 0;
  const temporalFatalEvents = [];
  const temporalBroker = new ComputerWorkerBroker({ onFatal: (event) => temporalFatalEvents.push(event), request: async () => ({
    observationId: `observation:temporal:${temporalCalls}`,
    accessibility: { elements: [{ role: "AXStaticText", name: "progress", value: `${temporalCalls += 1}` }] },
  }) });
  const longRunning = temporalBroker.issue({ taskId: "task", stepId: "bounded-wait-observe", runId: "run-long", role: "gui-operator" });
  await temporalBroker.execute(longRunning.token, { operation: "observe", payload: { fresh: true } });
  for (let index = 0; index < 5; index += 1) {
    await temporalBroker.execute(longRunning.token, { operation: "mutate", payload: { actions: [{ type: "wait", duration: 15 }], semanticBindings: [] } });
    await temporalBroker.execute(longRunning.token, { operation: "observe", payload: { fresh: true } });
  }
  assert.equal(temporalFatalEvents.length, 0, "bounded wait/fresh-observe cycles remain available for a visibly progressing target");

  let contractRuntimeCalls = 0;
  const contractFatalEvents = [];
  const contractBroker = new ComputerWorkerBroker({ onFatal: (event) => contractFatalEvents.push(event), request: async (request) => {
    contractRuntimeCalls += 1;
    if (request.actions?.[0]?.type === "key" && request.actions[0].key === "FAIL") throw new Error("ordinary runtime failure");
    return { observationId: `observation:contract:${contractRuntimeCalls}`, accessibility: { elements: [] } };
  } });
  const contract = contractBroker.issue({ taskId: "task", stepId: "closed-actions", runId: "run-7", role: "gui-operator" });
  for (const invalid of [
    { type: "raise" },
    { type: "keychord", keys: ["CMD", "O"] },
    { type: "menu_click", path: ["文件", "打开…"] },
  ]) await assert.rejects(contractBroker.execute(contract.token, { operation: "mutate", payload: { actions: [invalid], semanticBindings: [] } }), /unsupported desktop action type/);
	for (const invalid of [
	  { type: "typeahead", text: "/Users/haoli/Desktop/file.txt", element_token: "s00000001:1" },
	]) await assert.rejects(contractBroker.execute(contract.token, { operation: "mutate", payload: { actions: [invalid], semanticBindings: [] } }), /typeahead requires/);
  assert.equal(contractRuntimeCalls, 0, "captured invented actions are rejected before Runtime");
  await contractBroker.execute(contract.token, { operation: "observe", payload: { fresh: true } });
  await contractBroker.execute(contract.token, { operation: "observe", payload: { fresh: true } });
  await assert.rejects(contractBroker.execute(contract.token, { operation: "mutate", payload: { actions: [{ type: "key", key: "FAIL" }], semanticBindings: [] } }), /ordinary runtime failure/);
  await contractBroker.execute(contract.token, { operation: "observe", payload: { fresh: true } });
  await assert.rejects(contractBroker.execute(contract.token, { operation: "observe", payload: { fresh: true } }), /^Error: computer_worker_no_progress$/);
  assert.equal(contractFatalEvents.at(-1).code, "computer_worker_no_progress", "failed mutation does not reset pure-observe progress");

  const validContract = contractBroker.issue({ taskId: "task", stepId: "valid-actions", runId: "run-8", role: "gui-operator" });
  await contractBroker.execute(validContract.token, { operation: "observe", payload: { fresh: true } });
  await contractBroker.execute(validContract.token, { operation: "mutate", payload: { actions: [
    { type: "key", keys: ["CMD", "O"] },
    { type: "type", text: "/Users/haoli/Desktop/exact.txt" },
    { type: "key", key: "RETURN" },
  ], semanticBindings: [] } });
  await contractBroker.execute(validContract.token, { operation: "observe", payload: { fresh: true } });

  const refreshedSameElement = [
    { type: "click", element_index: 28, element_token: "snapshot-one:28", snapshot_id: "snapshot-one" },
    { type: "click", element_index: 28, element_token: "snapshot-two:28", snapshot_id: "snapshot-two" },
  ];
  assert.equal(mutationSignature([refreshedSameElement[0]]), mutationSignature([refreshedSameElement[1]]), "ephemeral snapshot/token refresh must not disguise the same indexed click");
  assert.notEqual(mutationSignature([refreshedSameElement[0]]), mutationSignature([{ ...refreshedSameElement[1], element_index: 29 }]), "different stable element indices remain different actions");
  assert.notEqual(mutationSignature([{ type: "click", element_token: "token-only-a" }]), mutationSignature([{ type: "click", element_token: "token-only-b" }]), "token-only targets are not collapsed without stable identity evidence");
});
const procedurePolicy = {
  isSensitiveApplication(application) {
    return new Set(["com.apple.keychainaccess", "com.1password.1password", "com.apple.systempreferences"]).has(application.bundleId.toLowerCase());
  },
};
const replayReceipts = new Map();
const replayReceiptVerifier = { verify: async (receipt) => replayReceipts.get(receipt) };
const makeStore = (path, options = {}) => new JsonProcedureStore(path, { policy: procedurePolicy, receiptVerifier: replayReceiptVerifier, ...options });
const trajectoryReceipts = new Map();
const trajectoryVerifier = { verify: (receipt) => trajectoryReceipts.get(receipt) };
const testReceiptIssuer = async () => "receipt:test-issued";
let trajectoryReceiptCounter = 0;

function issueReplayReceipt(procedure, taskId, runId) {
  const token = `receipt:${taskId}:${runId}`;
  const replayStartedAt = "2026-08-12T00:00:00.000Z";
  const postconditionEvidence = [];
  for (const step of procedure.steps.filter(({ consequential }) => consequential)) {
    step.postconditions.forEach((_condition, conditionIndex) => postconditionEvidence.push({ scope: "step", stepId: step.id, conditionIndex, observationId: `obs:${taskId}:${step.id}`, observedAt: "2026-08-12T00:00:01.000Z" }));
  }
  procedure.postconditions.forEach((_condition, conditionIndex) => postconditionEvidence.push({ scope: "procedure", conditionIndex, observationId: `obs:${taskId}:final`, observedAt: "2026-08-12T00:00:02.000Z" }));
  replayReceipts.set(token, { procedureId: procedure.id, version: procedure.version, taskId, runId, replayStartedAt, verifiedAt: "2026-08-12T00:00:03.000Z", humanCorrected: false, postconditionEvidence });
  return token;
}

function safeCandidate(overrides = {}) {
  const input = {
    intent: "create a text file and open it",
    application: app,
    parameters: [{ name: "outputFile", kind: "file_path", required: true }, { name: "content", kind: "short_text", required: true }],
    preconditions: [{ kind: "application_available", bundleId: app.bundleId }],
    steps: [{
      id: "write-file",
      role: "terminal-worker",
      action: { kind: "write_parameterized_file", pathParameter: "outputFile", contentParameter: "content" },
      postconditions: [postcondition],
      consequential: true,
    }],
    postconditions: [postcondition],
    recovery: [{ on: "postcondition_failed", action: "fallback_to_agent" }],
    evidence: { taskId: "task-a", runId: "run-a", verifiedAt: "2026-08-11T00:00:00.000Z" },
    ...overrides,
  };
  const receipt = `trajectory:${trajectoryReceiptCounter += 1}`;
  trajectoryReceipts.set(receipt, input);
  return compileProcedureCandidate(receipt, procedurePolicy, trajectoryVerifier);
}

test("Terminal Worker has no desktop grants, environment, tools, or GUI substitution", async () => {
  assert.deepEqual(grantsForComputerRole("terminal-worker"), []);
  assert.deepEqual(toolNamesForComputerWorkerRole("terminal-worker"), []);
  const broker = new ComputerWorkerBroker({ request: async () => ({ ok: true }) });
  assert.throws(() => broker.issue({ taskId: "task", stepId: "terminal", runId: "run", role: "terminal-worker" }), /does not receive a desktop broker capability/i);

  const policyRoot = await mkdtemp(join(tmpdir(), "computer-terminal-policy-"));
  for (const argv of [["/usr/bin/open", policyRoot], ["/usr/bin/osascript", "-e", "tell application"], ["/usr/bin/python3", "-c", "import pyautogui"]]) {
    await assert.rejects(validateTerminalStep({ cwd: policyRoot, writeRoots: [policyRoot], allowedExecutables: [argv[0]], maxCommands: 3, commands: [{ argv }] }), /GUI substitution|forbidden|approved exact canonical/i);
  }

  const definition = await readFile(new URL("../../Sources/PipiUI/PiExt/agents/computer-terminal/AGENT.md", import.meta.url), "utf8");
  assert.match(definition, /filesystem:\s*none/);
  assert.match(definition, /shell:\s*false/);
  assert.match(definition, /desktop:\s*none/);
  assert.match(definition, /AppleScript|osascript/);
  assert.match(definition, /PyAutoGUI/);
  assert.match(definition, /\bopen\b/);
  assert.match(definition, /must not/i);
  assert.deepEqual(toolNamesForTerminalWorkerRole(), ["terminal_read_file", "terminal_write_file", "terminal_file_status", "terminal_execute"]);
  assert.deepEqual(skillNamesForComputerRole("terminal-worker"), ["terminal-investigation"]);
  assert.deepEqual(skillNamesForComputerRole("gui-operator"), ["cua-driver-operation", "desktop-investigation"]);
  assert.deepEqual(skillNamesForComputerRole("verifier"), ["desktop-verification"]);
  const leader = await readFile(new URL("../../Sources/PipiUI/PiExt/agents/computer-use-leader/AGENT.md", import.meta.url), "utf8");
  assert.match(leader, /nested `terminalPolicy`/);
  assert.match(leader, /`cwd`, `writeRoots`, `allowedExecutables`, and `maxCommands`/);
  assert.match(leader, /Never flatten/);
  assert.match(leader, /`\/usr\/bin\/printf`/);
  assert.match(leader, /Never propose a\s+shell, interpreter, basename/);
});

test("a silent GUI child is aborted and returned to Leader recovery as a closed stalled failure", async () => {
  assert.equal(COMPUTER_WORKER_STALL_TIMEOUT_MS, 150_000);
  let aborted = 0;
  let cleanupDone = false;
  let deadlineFired;
  const stalled = new Promise((resolve) => { deadlineFired = resolve; });
  let resolveLate;
  const late = new Promise((resolve) => { resolveLate = resolve; });
  let settled = false;
  const result = runComputerWorkerWithStallDeadline(() => late, () => {
    aborted += 1;
    deadlineFired();
    setTimeout(() => {
      cleanupDone = true;
      resolveLate("late private result");
    }, 20);
  }, 10).then(
    (value) => ({ status: "fulfilled", value }),
    (error) => ({ status: "rejected", error }),
  ).finally(() => { settled = true; });

  await stalled;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "stall wrapper settled before GUI child cleanup");

  const outcome = await result;
  assert.equal(aborted, 1);
  assert.equal(cleanupDone, true);
  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.error?.message, "gui_child_stalled");
  assert.equal(outcome.error?.failureCode, "gui_child_stalled");
});

test("a silent Computer Use Leader is aborted and returned to the Boss as a closed stalled failure", async () => {
  assert.equal(COMPUTER_LEADER_STALL_TIMEOUT_MS, 120_000);
  let aborted = 0;
  let cleanupDone = false;
  let deadlineFired;
  const stalled = new Promise((resolve) => { deadlineFired = resolve; });
  let rejectLate;
  const late = new Promise((_resolve, reject) => { rejectLate = reject; });
  let settled = false;
  const result = runComputerLeaderWithStallDeadline(() => late, () => {
    aborted += 1;
    deadlineFired();
    setTimeout(() => {
      cleanupDone = true;
      rejectLate(new Error("leader child settled after abort"));
    }, 20);
  }, 10).then(
    (value) => ({ status: "fulfilled", value }),
    (error) => ({ status: "rejected", error }),
  ).finally(() => { settled = true; });

  await stalled;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "stall wrapper settled before Computer Use Leader cleanup");

  const outcome = await result;
  assert.equal(aborted, 1);
  assert.equal(cleanupDone, true);
  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.error?.message, "computer_leader_stalled");
  assert.equal(outcome.error?.failureCode, "computer_leader_stalled");
});

test("an incrementally producing Computer Use Leader receives one bounded completion window", async () => {
  let lastProgressAt = Date.now();
  let aborted = 0;
  const operation = new Promise((resolve) => {
    setTimeout(() => { lastProgressAt = Date.now(); }, 12);
    setTimeout(() => resolve("compact-plan"), 28);
  });
  const result = await runComputerLeaderWithStallDeadline(
    () => operation,
    () => { aborted += 1; },
    20,
    { lastProgressAt: () => lastProgressAt, progressGraceMs: 15 },
  );
  assert.equal(result, "compact-plan");
  assert.equal(aborted, 0);
});

test("Computer Use Leader progress can extend the deadline only once", async () => {
  let lastProgressAt = Date.now();
  let aborted = 0;
  let crossedFirstDeadline = false;
  let rejectLate;
  const operation = new Promise((_resolve, reject) => { rejectLate = reject; });
  const progress = setInterval(() => { lastProgressAt = Date.now(); }, 5);
  const firstDeadlineWitness = setTimeout(() => { crossedFirstDeadline = true; }, 25);
  await assert.rejects(
    runComputerLeaderWithStallDeadline(
      () => operation,
      () => {
        aborted += 1;
        clearInterval(progress);
        rejectLate(new Error("leader stopped after bounded extension"));
      },
      20,
      { lastProgressAt: () => lastProgressAt, progressGraceMs: 15 },
    ),
    (error) => error?.message === "computer_leader_stalled"
      && error?.failureCode === "computer_leader_stalled",
  );
  clearTimeout(firstDeadlineWitness);
  assert.equal(crossedFirstDeadline, true);
  assert.equal(aborted, 1);
});

test("a stall deadline keeps its typed failure when abort synchronously settles the operation", async () => {
  let aborted = 0;
  let rejectOperation;
  const operation = {
    then(_resolve, reject) {
      rejectOperation = reject;
    },
  };

  await assert.rejects(
    runComputerLeaderWithStallDeadline(() => operation, () => {
      aborted += 1;
      rejectOperation(new Error("abort settlement must stay private"));
    }, 10),
    (error) => error?.message === "computer_leader_stalled"
      && error?.failureCode === "computer_leader_stalled",
  );
  assert.equal(aborted, 1);
});

test("Verifier cannot override the authoritative broker envelope to execute mutation", async () => {
  const calls = [];
  const broker = new ComputerWorkerBroker({ request: async (request) => { calls.push(request); return { ok: true }; } });
  const issued = broker.issue({ taskId: "task-safe", stepId: "verify-safe", runId: "run-safe", role: "verifier" });
  await assert.rejects(broker.execute(issued.token, {
    operation: "observe",
    payload: {
      action: "computer_batch",
      actions: [{ type: "click", x: 10, y: 10 }],
      taskId: "task-attacker",
      stepId: "step-attacker",
      runId: "run-attacker",
    },
  }), /forbidden broker envelope field/i);
  assert.equal(calls.length, 0);
});

test("loopback broker rejects every observe envelope override before Runtime", async () => {
  const calls = [];
  const broker = new ComputerWorkerBroker({ request: async (request) => { calls.push(request); return { ok: true }; } });
  const server = new ComputerWorkerBrokerServer(broker);
  await server.start();
  try {
    const issued = server.issue({ taskId: "task-loop", stepId: "verify-loop", runId: "run-loop", role: "verifier" });
    for (const [key, value] of Object.entries({ action: "computer_open_application", actions: [{ type: "click", x: 1, y: 2 }], taskId: "evil", stepId: "evil", runId: "evil", computerCapability: "evil", sessionKey: "evil", bundle_identifier: "com.apple.Terminal" })) {
      const response = await fetch(issued.environment.PIPIUI_COMPUTER_WORKER_BROKER_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: issued.token, operation: "observe", payload: { [key]: value } }) });
      assert.equal(response.status, 403, key);
    }
    assert.equal(calls.length, 0);
  } finally { await server.stop(); }
});

test("Terminal extension registers no tools and cannot mutate without an authenticated host broker", async () => {
  const outside = join(await mkdtemp(join(tmpdir(), "computer-terminal-no-broker-")), "untouched.txt");
  await writeFile(outside, "unchanged");
  const registered = [];
  registerComputerTerminalTools({ registerTool: (tool) => registered.push(tool) }, {
    PIPIUI_TERMINAL_WORKER_CWD: "/tmp",
    PIPIUI_COMPUTER_CAPABILITY: "must-be-ignored",
  });
  assert.deepEqual(registered, []);
  assert.equal(await readFile(outside, "utf8"), "unchanged");
});

test("Terminal extension proxies every operation to its authenticated host broker", async () => {
  const registered = [];
  const calls = [];
  const transport = async (input) => {
    calls.push(input);
    const artifactId = `artifact:${input.request.operation}`;
    if (input.request.operation === "read") return { operation: "read", artifactId, digest: "a".repeat(64), byteLength: 5, truncated: false };
    if (input.request.operation === "write") return { operation: "write", artifactId, digest: "b".repeat(64), byteLength: 5, written: true };
    if (input.request.operation === "status") return { operation: "status", artifactId, exists: true, kind: "file", byteLength: 5, digest: "c".repeat(64) };
    return { operation: "execute", artifactId, exitCode: 0, stdoutDigest: "d".repeat(64), truncated: false };
  };
  registerComputerTerminalTools({ registerTool: (tool) => registered.push(tool) }, {
    PIPIUI_TERMINAL_WORKER_BROKER_URL: "http://127.0.0.1:43123/terminal",
    PIPIUI_TERMINAL_WORKER_BROKER_TOKEN: "0123456789abcdef0123456789abcdef",
  }, transport);
  assert.deepEqual(registered.map(({ name }) => name), toolNamesForTerminalWorkerRole());
  await registered.find(({ name }) => name === "terminal_read_file").execute("read", { path: "/bounded/a", maxBytes: 5 });
  await registered.find(({ name }) => name === "terminal_write_file").execute("write", { path: "/bounded/a", content: "hello" });
  await registered.find(({ name }) => name === "terminal_file_status").execute("status", { path: "/bounded/a" });
  await registered.find(({ name }) => name === "terminal_execute").execute("execute", { argv: ["/usr/bin/stat", "/bounded/a"] });
  assert.deepEqual(calls.map(({ request }) => request.operation), ["read", "write", "status", "execute"]);
  assert.ok(calls.every(({ token }) => token === "0123456789abcdef0123456789abcdef"));
});

test("Terminal host broker turns read/status evidence into coordinator-consumable file observations", async () => {
  const root = await mkdtemp(join(tmpdir(), "computer-terminal-observation-"));
  const file = join(root, "result.txt");
  await writeFile(file, "hello");
  const server = new TerminalWorkerBrokerServer();
  await server.start();
  try {
    const issued = server.issue({ taskId: "task", stepId: "terminal", runId: "run", policy: { cwd: root, writeRoots: [root], allowedExecutables: [], maxCommands: 1 } });
    for (const request of [{ operation: "read", path: file, maxBytes: 32 }, { operation: "status", path: file }]) {
      const response = await fetch(issued.environment.PIPIUI_TERMINAL_WORKER_BROKER_URL, { method: "POST", headers: { authorization: `Bearer ${issued.token}`, "content-type": "application/json" }, body: JSON.stringify(request) });
      assert.equal(response.ok, true);
    }
    assert.deepEqual(server.consumeFileObservations("task", "terminal").map(({ path, exists }) => ({ path, exists })), [{ path: file, exists: true }]);
  } finally { await server.stop(); }
});

test("live-shaped terminal_write_file receipt remains observable after execution records are consumed", async () => {
  const root = await mkdtemp(join(tmpdir(), "computer-terminal-live-write-"));
  const file = join(root, "pipiui-computer-agent-final-acceptance-3.txt");
  const server = new TerminalWorkerBrokerServer();
  await server.start();
  try {
    const issued = server.issue({ taskId: "live-task", stepId: "terminal-write", runId: "live-run", policy: { cwd: root, writeRoots: [root], allowedExecutables: [], maxCommands: 1 } });
    const response = await fetch(issued.environment.PIPIUI_TERMINAL_WORKER_BROKER_URL, { method: "POST", headers: { authorization: `Bearer ${issued.token}`, "content-type": "application/json" }, body: JSON.stringify({ operation: "write", path: file, content: "PipiUI Computer Agent final acceptance 3" }) });
    assert.equal(response.ok, true);
    const records = server.consumeExecutions("live-task", "terminal-write");
    const files = server.consumeFileObservations("live-task", "terminal-write");
    assert.equal(records.length, 1);
    assert.deepEqual(files.map(({ path, exists, digest }) => ({ path, exists, digest })), [{ path: file, exists: true, digest: records[0].contentDigest }]);
    assert.equal(evaluatePostconditions([{ kind: "file_exists", path: file }], { id: records[0].observationId, files }).status, "verified");
  } finally { await server.stop(); }
});

test("Terminal Worker accepts the standard macOS /tmp alias through its authenticated broker", async (t) => {
  if (process.platform !== "darwin") return t.skip("macOS /tmp alias contract");
  const root = await mkdtemp("/tmp/pipiui-terminal-alias-");
  const file = join(root, "result.txt");
  const server = new TerminalWorkerBrokerServer();
  await server.start();
  try {
    const issued = server.issue({ taskId: "tmp-alias", stepId: "write", runId: "run", policy: { cwd: "/tmp", writeRoots: ["/tmp"], allowedExecutables: ["/usr/bin/stat"], maxCommands: 1 } });
    const tools = [];
    registerComputerTerminalTools({ registerTool: (tool) => tools.push(tool) }, issued.environment);
    const result = await tools.find(({ name }) => name === "terminal_write_file").execute("write", { path: file, content: "exact-no-newline" });
    assert.deepEqual(result.details, { operation: "write", artifactId: result.details.artifactId, digest: result.details.digest, byteLength: 16, written: true });
    assert.equal(await readFile(file, "utf8"), "exact-no-newline");
  } finally {
    await server.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("Terminal Worker receives a closed path-policy failure code instead of an opaque HTTP 400", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipiui-terminal-boundary-"));
  const outside = join(tmpdir(), `pipiui-terminal-outside-${Date.now()}.txt`);
  const server = new TerminalWorkerBrokerServer();
  await server.start();
  try {
    const issued = server.issue({ taskId: "closed-error", stepId: "write", runId: "run", policy: { cwd: root, writeRoots: [root], allowedExecutables: ["/usr/bin/stat"], maxCommands: 1 } });
    const tools = [];
    registerComputerTerminalTools({ registerTool: (tool) => tools.push(tool) }, issued.environment);
    await assert.rejects(
      tools.find(({ name }) => name === "terminal_write_file").execute("write", { path: outside, content: "must-not-write" }),
      (error) => error?.message === "terminal_path_policy_rejected" && error?.code === "terminal_path_policy_rejected",
    );
  } finally {
    await server.stop();
    await rm(root, { recursive: true, force: true });
    await rm(outside, { force: true });
  }
});

test("Terminal Worker rejects arbitrary symlink roots while retaining only the standard macOS /tmp alias", async () => {
  const parent = await mkdtemp(join(tmpdir(), "pipiui-terminal-symlink-root-"));
  const target = await mkdtemp(join(parent, "target-"));
  const linkedRoot = join(parent, "linked-root");
  await symlink(target, linkedRoot);
  const server = new TerminalWorkerBrokerServer();
  await server.start();
  try {
    const issued = server.issue({ taskId: "symlink-root", stepId: "write", runId: "run", policy: { cwd: linkedRoot, writeRoots: [linkedRoot], allowedExecutables: ["/usr/bin/stat"], maxCommands: 1 } });
    const tools = [];
    registerComputerTerminalTools({ registerTool: (tool) => tools.push(tool) }, issued.environment);
    await assert.rejects(
      tools.find(({ name }) => name === "terminal_write_file").execute("write", { path: join(linkedRoot, "forbidden.txt"), content: "must-not-write" }),
      (error) => error?.code === "terminal_path_policy_rejected",
    );
  } finally {
    await server.stop();
    await rm(parent, { recursive: true, force: true });
  }
});

test("Computer Task coordinator rejects Terminal Worker before any dispatch", async () => {
  const dispatches = [];
  const coordinator = new ComputerAgentCoordinator({
    planner: {
      plan: async (goal) => ({
        goal,
        mode: "planned",
        successConditions: [{ kind: "visible_text", contains: "hello" }],
        steps: [
          { id: "terminal-1", role: "terminal-worker", objective: "Create the requested file", dependsOn: [], postconditions: [{ kind: "file_exists", path: "/tmp/example.txt" }], terminalPolicy },
          { id: "gui-1", role: "gui-operator", objective: "Open the file in TextEdit", dependsOn: ["terminal-1"], postconditions: [{ kind: "visible_text", contains: "hello" }] },
        ],
      }),
      replan: async () => { throw new Error("happy path does not replan"); },
    },
    dispatcher: { dispatch: async (request) => { dispatches.push(request); throw new Error("must not dispatch"); } },
  });

  await assert.rejects(coordinator.run({ goal: "Create a file and open it" }), /Computer Task accepts only Cua desktop actions/);
  assert.deepEqual(dispatches, []);
});

test("file-evidence plans fail closed before any Computer Worker dispatch", async () => {
  const roles = [];
  const coordinator = new ComputerAgentCoordinator({
    maxReplans: 0,
    planner: {
      plan: async (goal) => ({
        goal,
        mode: "planned",
        successConditions: [{ kind: "file_exists", path: "/tmp/missing.txt" }],
        steps: [{ id: "terminal", role: "terminal-worker", objective: "write file", dependsOn: [], postconditions: [{ kind: "file_exists", path: "/tmp/missing.txt" }], terminalPolicy }],
      }),
      replan: async () => { throw new Error("replan budget is zero"); },
    },
    dispatcher: { dispatch: async (request) => { roles.push(request.role); return { outcome: "completed", summary: "no host file evidence" }; } },
  });
  await assert.rejects(coordinator.run({ goal: "write missing file" }), /Computer Task accepts only Cua desktop actions/);
  assert.deepEqual(roles, []);
});

test("invalid recovery Leader output preserves the real worker failure as a bounded terminal result", async () => {
  const events = [];
  const coordinator = new ComputerAgentCoordinator({
    planner: {
      plan: async (goal) => ({
        goal,
        mode: "direct",
        successConditions: [{ kind: "visible_text", contains: "target" }],
        steps: [{ id: "gui", role: "gui-operator", objective: "Open the target", dependsOn: [], postconditions: [{ kind: "visible_text", contains: "target" }] }],
      }),
      replan: async () => { throw new Error("Computer Agent child returned no JSON object: raw private output"); },
    },
    dispatcher: { dispatch: async () => ({ outcome: "blocked", summary: "real GUI step failed" }) },
    onEvent: (event) => events.push(event),
  });
  const result = await coordinator.run({ goal: "Open the target" });
  assert.equal(result.outcome, "blocked");
  assert.equal(result.summary, "Computer Task recovery plan was invalid after worker failure");
  assert.equal(JSON.stringify(result).includes("raw private output"), false);
  assert.deepEqual(events.at(-1), { type: "task_finished", taskId: events[0].taskId, outcome: "blocked" });
});

test("typed fail-fast policy closes the exact first failed verifier episode without recovery dispatch", async () => {
  const condition = { kind: "visible_text", contains: "战役界面" };
  let replans = 0;
  let dispatches = 0;
  const coordinator = new ComputerAgentCoordinator({
    planner: {
      plan: async (goal) => ({
        goal,
        mode: "direct",
        successConditions: [condition],
        steps: [{ id: "verify-campaign", role: "verifier", objective: "freshly observe the campaign", dependsOn: [], postconditions: [condition] }],
      }),
      replan: async () => {
        replans += 1;
        throw new Error("fail-fast must not ask a Leader for recovery");
      },
    },
    dispatcher: {
      dispatch: async () => {
        dispatches += 1;
        return {
          workerResult: { outcome: "failed", summary: "target window was obscured" },
          hostExecutionRecords: [],
          episode: {
            agentId: "agent-verifier",
            runId: "run-verifier",
            parentId: "root-leader",
            name: "computer-verifier",
            role: "verifier",
            terminalState: "failed",
            result: { outcome: "failed", summary: "target window was obscured" },
          },
        };
      },
    },
  });

  const result = await coordinator.run({
    goal: "不要生成恢复计划；observe失败立即如实停止。",
    taskId: "fail-fast-task",
    recoveryPolicy: "fail_fast",
  });

  assert.equal(dispatches, 1);
  assert.equal(replans, 0);
  assert.equal(result.outcome, "blocked");
  assert.equal(result.summary, "Computer Task blocked");
  assert.equal(result.planRevisions, 0);
  assert.deepEqual(result.investigation, {
    stage: "fail_fast",
    code: "worker_failed",
    recoveryAttempts: 0,
    failedConditions: [{ conditionId: "task:condition:0", kind: "visible_text", outcome: "not_verified" }],
    workerAttempts: [{
      stepId: "verify-campaign",
      role: "verifier",
      outcome: "failed",
      verification: "unknown",
      agentId: "agent-verifier",
      runId: "run-verifier",
      parentId: "root-leader",
      name: "computer-verifier",
      terminalState: "failed",
      result: { outcome: "failed", summary: "Worker failed" },
    }],
  });
  assert.deepEqual(result.episodes, [{
    agentId: "agent-verifier",
    runId: "run-verifier",
    parentId: "root-leader",
    name: "computer-verifier",
    role: "verifier",
    terminalState: "failed",
    result: { outcome: "failed", summary: "Worker failed" },
  }]);
});

test("task success conditions are nonempty, step-bound, and verified from fresh observation rather than verifier prose", async () => {
  for (const plan of [
    { goal: "empty", mode: "direct", successConditions: [], steps: [{ id: "gui", role: "gui-operator", objective: "show target", dependsOn: [], postconditions: [{ kind: "visible_text", contains: "target" }] }] },
    { goal: "unbound", mode: "direct", successConditions: [{ kind: "visible_text", contains: "invented" }], steps: [{ id: "gui", role: "gui-operator", objective: "show target", dependsOn: [], postconditions: [{ kind: "visible_text", contains: "target" }] }] },
  ]) {
    let dispatches = 0;
    const coordinator = new ComputerAgentCoordinator({
      planner: { plan: async () => plan, replan: async () => { throw new Error("not reached"); } },
      dispatcher: { dispatch: async () => { dispatches += 1; throw new Error("invalid plan must not dispatch"); } },
    });
    await assert.rejects(coordinator.run({ goal: plan.goal }), /success condition/i);
    assert.equal(dispatches, 0);
  }

  const boundPlan = {
    goal: "show target", mode: "direct",
    successConditions: [{ kind: "visible_text", contains: "target" }],
    steps: [{ id: "verify", role: "verifier", objective: "freshly verify target", dependsOn: [], postconditions: [{ kind: "visible_text", contains: "target" }] }],
  };
  const passed = new ComputerAgentCoordinator({
    planner: { plan: async () => boundPlan, replan: async () => { throw new Error("not reached"); } },
    dispatcher: { dispatch: async () => ({ outcome: "verified", summary: "untrusted prose", observation: { id: "fresh-visible", visibleText: ["target"] } }) },
  });
  const passedResult = await passed.run({ goal: "show target" });
  assert.equal(passedResult.outcome, "succeeded");
  assert.deepEqual(passedResult.verification, { status: "verified", conditionResults: [{ conditionId: "task:condition:0", outcome: "verified" }] });

  const proseOnly = new ComputerAgentCoordinator({
    maxReplans: 0,
    planner: { plan: async () => boundPlan, replan: async () => { throw new Error("not reached"); } },
    dispatcher: { dispatch: async () => ({ outcome: "verified", summary: "target is visible", observation: { id: "fresh-empty", visibleText: [] } }) },
  });
  const proseResult = await proseOnly.run({ goal: "show target" });
  assert.equal(proseResult.outcome, "blocked");
  assert.equal(proseResult.verification.status, "not_verified");

  const screenshotOnly = new ComputerAgentCoordinator({
    maxReplans: 0,
    planner: { plan: async () => boundPlan, replan: async () => { throw new Error("not reached"); } },
    dispatcher: { dispatch: async () => ({
      outcome: "verified",
      summary: "untrusted prose",
      observation: { id: "fresh-screenshot-only", visibleText: [] },
      attestedPostconditions: [{ kind: "visible_text", contains: "target" }],
    }) },
  });
  const screenshotResult = await screenshotOnly.run({ goal: "show target" });
  assert.equal(screenshotResult.outcome, "succeeded", "a fresh multimodal Verifier may attest only exact requested closed postconditions");
  assert.deepEqual(screenshotResult.verification, { status: "verified", conditionResults: [{ conditionId: "task:condition:0", outcome: "verified" }] });

  for (const unsafeResult of [
    { outcome: "verified", summary: "target is visible", observation: { id: "fresh-string-claim", visibleText: [] }, claims: ["target is visible"] },
    { outcome: "verified", summary: "unbound", observation: { id: "fresh-unbound", visibleText: [] }, attestedPostconditions: [{ kind: "visible_text", contains: "invented" }] },
    { outcome: "verified", summary: "no fresh observation", attestedPostconditions: [{ kind: "visible_text", contains: "target" }] },
  ]) {
    const unsafe = new ComputerAgentCoordinator({
      maxReplans: 0,
      planner: { plan: async () => boundPlan, replan: async () => { throw new Error("not reached"); } },
      dispatcher: { dispatch: async () => unsafeResult },
    });
    assert.equal((await unsafe.run({ goal: "show target" })).outcome, "blocked");
  }
});

test("task verification aggregates authoritative GUI evidence across dependent workers", async () => {
  const titleCondition = { kind: "visible_text", contains: "Acceptance Window" };
  const textCondition = { kind: "visible_text", contains: "acceptance 28" };
  const plan = {
    goal: "open and verify", mode: "planned", successConditions: [titleCondition, textCondition],
    steps: [
      { id: "operator", role: "gui-operator", objective: "open", dependsOn: [], postconditions: [titleCondition, textCondition] },
      { id: "verifier", role: "verifier", objective: "fresh verify", dependsOn: ["operator"], postconditions: [titleCondition, textCondition] },
    ],
  };
  const coordinator = new ComputerAgentCoordinator({
    planner: { plan: async () => plan, replan: async () => { throw new Error("not reached"); } },
    dispatcher: { dispatch: async ({ role }) => role === "gui-operator"
        ? { outcome: "completed", summary: "opened", observation: { id: "gui-fresh", visibleText: [titleCondition.contains, textCondition.contains] } }
        : { outcome: "verified", summary: "untrusted verifier prose", observation: { id: "verifier-fresh", visibleText: [titleCondition.contains, textCondition.contains] } } },
  });
  const result = await coordinator.run({ goal: "open and verify" });
  assert.equal(result.outcome, "succeeded");
  assert.deepEqual(result.verification.conditionResults, [
    { conditionId: "task:condition:0", outcome: "verified" },
    { conditionId: "task:condition:1", outcome: "verified" },
  ]);

  const missingEvidence = new ComputerAgentCoordinator({
    maxReplans: 0,
    planner: { plan: async () => plan, replan: async () => { throw new Error("not reached"); } },
    dispatcher: { dispatch: async ({ role }) => ({ outcome: role === "verifier" ? "verified" : "completed", summary: "claimed only", observation: { id: `${role}-fresh`, visibleText: [] } }) },
  });
  const missingResult = await missingEvidence.run({ goal: "open and verify" });
  assert.equal(missingResult.outcome, "blocked");
});

test("blocked Computer Task preserves a closed investigation ledger instead of erasing subordinate evidence", async () => {
  const textCondition = { kind: "visible_text", contains: "acceptance evidence" };
  const coordinator = new ComputerAgentCoordinator({
    maxReplans: 0,
    planner: {
      plan: async () => ({
        goal: "show acceptance evidence",
        mode: "direct",
        successConditions: [textCondition],
        steps: [{ id: "operator", role: "gui-operator", objective: "show the target", dependsOn: [], postconditions: [textCondition] }],
      }),
      replan: async () => { throw new Error("not reached"); },
    },
    dispatcher: {
      dispatch: async () => ({ outcome: "completed", summary: "untrusted worker prose", observation: { id: "fresh-but-missing", visibleText: [] } }),
    },
  });

  const result = await coordinator.run({ goal: "show acceptance evidence" });
  assert.equal(result.outcome, "blocked");
  assert.deepEqual(result.verification.conditionResults, [
    { conditionId: "task:condition:0", outcome: "not_verified" },
  ]);
  assert.deepEqual(result.investigation, {
    stage: "recovery_exhausted",
    code: "worker_postconditions_not_verified",
    recoveryAttempts: 0,
    failedConditions: [{ conditionId: "task:condition:0", kind: "visible_text", outcome: "not_verified" }],
    workerAttempts: [{ stepId: "operator", role: "gui-operator", outcome: "completed", verification: "not_verified" }],
  });
  assert.equal(JSON.stringify(result).includes("untrusted worker prose"), false);
});

test("a failed Operator can be investigated and replaced without losing successful subordinate evidence", async () => {
  const valueCondition = { kind: "visible_text", contains: "value=23" };
  const doubleCondition = { kind: "visible_text", contains: "double=46" };
  const statusCondition = { kind: "visible_text", contains: "status=VERIFIED" };
  const titleCondition = { kind: "visible_text", contains: "pipiui-cua-complex-acceptance-32" };
  const initialPlan = {
    goal: "create, open, and independently verify the file",
    mode: "planned",
    successConditions: [valueCondition, doubleCondition, statusCondition, titleCondition],
    steps: [
      { id: "open-file", role: "gui-operator", objective: "open the file in TextEdit", dependsOn: [], postconditions: [valueCondition, doubleCondition, statusCondition] },
      { id: "verify-file", role: "verifier", objective: "freshly verify title and content", dependsOn: ["open-file"], postconditions: [titleCondition, valueCondition, doubleCondition, statusCondition] },
    ],
  };
  const recoveryPlan = {
    ...initialPlan,
    revision: 1,
    steps: [
      { id: "open-file-recovery", role: "gui-operator", objective: "open with a corrected GUI strategy", dependsOn: [], postconditions: [valueCondition, doubleCondition, statusCondition] },
      { id: "verify-file-recovery", role: "verifier", objective: "freshly verify title and content", dependsOn: ["open-file-recovery"], postconditions: [titleCondition, valueCondition, doubleCondition, statusCondition] },
    ],
  };
  const dispatches = [];
  let firstOperator = true;
  const coordinator = new ComputerAgentCoordinator({
    planner: { plan: async () => initialPlan, replan: async () => recoveryPlan },
    dispatcher: {
      dispatch: async (request) => {
        dispatches.push(`${request.role}:${request.stepId}`);
        if (request.role === "gui-operator" && firstOperator) {
          firstOperator = false;
          return { outcome: "failed", summary: "worker failed", failureCode: "computer_worker_request_cancelled" };
        }
        const observation = { id: `desktop:${request.stepId}`, visibleText: ["pipiui-cua-complex-acceptance-32.txt", "value=23", "double=46", "status=VERIFIED"] };
        return { outcome: request.role === "verifier" ? "verified" : "completed", summary: "closed result", observation };
      },
    },
  });

  const result = await coordinator.run({ goal: initialPlan.goal });
  assert.equal(result.outcome, "succeeded");
  assert.deepEqual(result.verification.conditionResults, initialPlan.successConditions.map((_condition, index) => ({ conditionId: `task:condition:${index}`, outcome: "verified" })));
  assert.deepEqual(dispatches, [
    "gui-operator:open-file",
    "gui-operator:open-file-recovery",
    "verifier:verify-file-recovery",
  ]);
});

test("cancelling the root Computer Task after a worker returns stops recovery and replanning", async () => {
  const controller = new AbortController();
  let replans = 0;
  const events = [];
  const coordinator = new ComputerAgentCoordinator({
    planner: {
      plan: async (goal) => ({
        goal,
        mode: "direct",
        successConditions: [{ kind: "visible_text", contains: "done" }],
        steps: [{ id: "operator", role: "gui-operator", objective: "finish the task", dependsOn: [], postconditions: [{ kind: "visible_text", contains: "done" }] }],
      }),
      replan: async () => {
        replans += 1;
        throw new Error("cancelled task must not replan");
      },
    },
    dispatcher: {
      dispatch: async () => {
        controller.abort();
        return { outcome: "failed", summary: "active worker stopped" };
      },
    },
    onEvent: (event) => events.push(event),
  });

  const result = await coordinator.run({ goal: "finish the task", taskId: "cancel-whole-task" }, controller.signal);
  assert.equal(result.outcome, "cancelled");
  assert.equal(result.investigation?.code, "task_cancelled");
  assert.equal(replans, 0);
  assert.deepEqual(events.at(-1), { type: "task_finished", taskId: "cancel-whole-task", outcome: "cancelled" });
});

test("subjective task evidence rejects a verifier observation reused from an earlier worker", async () => {
  const visualCondition = { kind: "visual_judgement", description: "document layout is correct" };
  const plan = {
    goal: "inspect layout", mode: "planned", successConditions: [visualCondition],
    steps: [
      { id: "operator", role: "gui-operator", objective: "show document", dependsOn: [], postconditions: [{ kind: "visible_text", contains: "document" }] },
      { id: "verifier", role: "verifier", objective: "freshly judge layout", dependsOn: ["operator"], postconditions: [visualCondition] },
    ],
  };
  const coordinator = new ComputerAgentCoordinator({
    maxReplans: 0,
    planner: { plan: async () => plan, replan: async () => { throw new Error("not reached"); } },
    dispatcher: { dispatch: async ({ role }) => role === "gui-operator"
      ? { outcome: "completed", summary: "shown", observation: { id: "reused-observation", visibleText: ["document"] } }
      : { outcome: "verified", summary: "untrusted verifier prose", observation: { id: "reused-observation", visibleText: ["document"] } } },
  });
  const result = await coordinator.run({ goal: "inspect layout" });
  assert.equal(result.outcome, "blocked");
  assert.equal(result.verification.status, "not_verified");
});

test("artifact references and recipe retrieval keep raw evidence and broker internals out of cross-context slices", async () => {
  const artifacts = new TaskArtifactStore(await mkdtemp(join(tmpdir(), "computer-artifacts-")));
  const reference = await artifacts.put("terminal", "raw terminal output with many details", "file metadata checked");
  const compressed = compressWorkerTrajectory({ outcome: "completed", summary: "s".repeat(2_000), artifactReferences: [reference] });
  assert.equal(compressed.summary.length, 1_000);
  assert.equal(JSON.stringify(compressed).includes("raw terminal output"), false);

  let queried;
  const recipes = new ReadOnlyComputerRecipeAdapter({
    queryComputerRecipes: async (query) => {
      queried = query;
      return [{ id: "recipe-1", intent: "open file", application: "TextEdit", successRate: 0.9, stepSummary: "open parameterized file", parameters: ["path"], capability: "must-not-cross" }];
    },
  });
  const result = await recipes.retrieve({ intent: "open file", bundleId: app.bundleId });
  assert.deepEqual(queried, { intent: "open file", bundleId: app.bundleId, limit: 5 });
  assert.equal(JSON.stringify(result).includes("capability"), false);
});

test("Leader dispatch accepts fixed roles only and emits leader-owned hierarchy metadata", async () => {
  const events = [];
  const coordinator = new ComputerAgentCoordinator({
    planner: {
      plan: async (goal) => ({ goal, mode: "planned", successConditions: [{ kind: "visible_text", contains: "done" }], steps: [{ id: "bad", role: "peer-agent", objective: "talk laterally", dependsOn: [], postconditions: [{ kind: "visible_text", contains: "done" }] }] }),
      replan: async () => { throw new Error("not reached"); },
    },
    dispatcher: { dispatch: async () => { throw new Error("invalid role must not dispatch"); } },
    onEvent: (event) => events.push(event),
  });
  await assert.rejects(coordinator.run({ goal: "invalid plan" }), /fixed Computer Worker role/);
  assert.equal(events.some(({ type }) => type === "worker_started"), false);

  const terminal = new ComputerAgentCoordinator({
    planner: { plan: async (goal) => ({ goal, mode: "planned", successConditions: [{ kind: "file_exists", path: "/tmp/a" }], steps: [{ id: "terminal", role: "terminal-worker", objective: "inspect", dependsOn: [], postconditions: [{ kind: "file_exists", path: "/tmp/a" }], cwd: "/tmp", writeRoots: ["/tmp"], allowedExecutables: ["/usr/bin/stat"], maxCommands: 1 }] }), replan: async () => { throw new Error("not reached"); } },
    dispatcher: { dispatch: async () => { throw new Error("flattened policy must not dispatch"); } },
  });
  await assert.rejects(terminal.run({ goal: "terminal plan" }), /Computer Task accepts only Cua desktop actions/);

  const validEvents = [];
  const valid = new ComputerAgentCoordinator({
    planner: {
      plan: async (goal) => ({ goal, mode: "planned", successConditions: [{ kind: "visible_text", contains: "ready" }], steps: [{ id: "operator", role: "gui-operator", objective: "show the target", dependsOn: [], postconditions: [{ kind: "visible_text", contains: "ready" }] }] }),
      replan: async () => { throw new Error("not reached"); },
    },
    dispatcher: { dispatch: async () => ({ outcome: "completed", summary: "ok", observation: { id: "desktop", visibleText: ["ready"] } }) },
    onEvent: (event) => validEvents.push(event),
  });
  await valid.run({ goal: "inspect" });
  const worker = validEvents.find(({ type }) => type === "worker_started");
  assert.deepEqual({ role: worker.role, parentRole: worker.parentRole, depth: worker.depth }, { role: "gui-operator", parentRole: "computer-use-leader", depth: 1 });
});

test("first verified exploration creates only a candidate", async () => {
  const directory = await mkdtemp(join(tmpdir(), "computer-procedure-"));
  const store = makeStore(join(directory, "procedures.json"));
  const candidate = safeCandidate();
  assert.equal(candidate.state, "candidate");
  await store.saveCandidate(candidate);
  assert.equal((await store.get(candidate.id)).state, "candidate");
});

test("planner-authored Procedure draft cannot compile without a host executed-trajectory receipt", () => {
  assert.throws(() => compileProcedureCandidate({ intent: "planner draft", steps: [] }, procedurePolicy, trajectoryVerifier), /executed-trajectory receipt is invalid/i);
});

test("verified computer_task sends only sanitized executed trajectory to the host learning seam and ignores planner drafts", async () => {
  const draft = safeCandidate();
  let learned;
  const coordinator = new ComputerAgentCoordinator({
    planner: {
      plan: async (goal) => ({
        goal, mode: "direct", successConditions: [{ kind: "visible_text", contains: "done" }],
        steps: [{ id: "gui", role: "gui-operator", objective: "finish", dependsOn: [], postconditions: [{ kind: "visible_text", contains: "done" }] }],
        procedureCandidate: {
          intent: draft.intent, application: draft.application, parameters: draft.parameters,
          preconditions: draft.preconditions, steps: draft.steps, postconditions: draft.postconditions, recovery: draft.recovery,
        },
      }),
      replan: async () => { throw new Error("not reached"); },
    },
    dispatcher: { dispatch: async () => ({ outcome: "completed", summary: "done", observation: { id: "obs", visibleText: ["done"] }, artifactReferences: [{ id: "artifact:trace-1", kind: "trajectory", summary: "executed", digest: "a".repeat(64), byteLength: 12 }] }) },
    procedureLearning: { recordVerifiedExecution: async (value) => { learned = value; } },
  });
  const result = await coordinator.run({ goal: "finish", taskId: "task-explore" });
  assert.equal(result.outcome, "succeeded");
  assert.deepEqual(learned.steps.map(({ stepId, role, outcome }) => ({ stepId, role, outcome })), [{ stepId: "gui", role: "gui-operator", outcome: "completed" }]);
  assert.equal(JSON.stringify(learned).includes(draft.intent), false);
  assert.equal(JSON.stringify(learned).includes("procedureCandidate"), false);
  assert.doesNotMatch(JSON.stringify(result), /procedure:|independentSuccesses|steps/i);
});

test("procedure lint rejects coordinates, element tokens, PID, capability, and real typed content", () => {
  const forbidden = [
    { locator: { x: 10, y: 20 } },
    { locator: { elementToken: "s0001" } },
    { target: { pid: 991 } },
    { capability: "secret-capability" },
    { action: { kind: "type", text: "the user's real text" } },
  ];
  for (const fragment of forbidden) {
    const candidate = { ...safeCandidate(), steps: [{ id: "unsafe", role: "gui-operator", consequential: true, postconditions: [postcondition], ...fragment }] };
    assert.equal(lintProcedure(candidate, procedurePolicy).ok, false, JSON.stringify(fragment));
  }
});

test("Procedure admission rejects semantic aliases, array-carried input, nested tokens, URLs, and secrets", () => {
  const unsafe = { ...safeCandidate(), steps: [{
    id: "unsafe", role: "gui-operator", consequential: true, postconditions: [postcondition],
    locator: { point: [10, 20], bounds: [0, 0, 40, 20], targetPid: 123, element: { token: "s0001" } },
    action: { kind: "type", args: ["real private input"], payload: { url: "https://example.com/?secret=value", apiKey: "secret" } },
  }] };
  assert.equal(lintProcedure(unsafe, procedurePolicy).ok, false);
});

test("two independent successes promote a candidate to verified", async () => {
  const store = makeStore(join(await mkdtemp(join(tmpdir(), "computer-procedure-")), "procedures.json"));
  const candidate = safeCandidate();
  await store.saveCandidate(candidate);
  assert.equal((await store.recordIndependentSuccess(candidate.id, issueReplayReceipt(candidate, "task-b", "run-b"))).state, "candidate");
  assert.equal((await store.recordIndependentSuccess(candidate.id, issueReplayReceipt(candidate, "task-c", "run-c"))).state, "verified");
});

test("Replay engine issues host receipt only after fresh bound Postconditions and Store consumes that opaque receipt", async () => {
  const candidate = safeCandidate();
  const store = makeStore(join(await mkdtemp(join(tmpdir(), "computer-procedure-receipt-")), "procedures.json"));
  await store.saveCandidate(candidate);
  const replay = new ProcedureReplayEngine({
    policy: procedurePolicy,
    evaluate: async (_condition, _phase, _parameters, observation) => ({ met: true, observationId: observation?.id ?? "precondition-observation", observedAt: new Date().toISOString() }),
    executeStep: async () => ({ ok: true, observation: { id: "fresh-post-action", capturedAt: new Date(Date.now() - 1_000).toISOString() } }),
    issueReceipt: async (evidence) => {
      const token = "receipt:engine-issued";
      replayReceipts.set(token, evidence);
      return token;
    },
  });
  const replayed = await replay.replay(candidate, { outputFile: "/tmp/a.txt", content: "hello" }, undefined, { taskId: "task-engine", runId: "run-engine" });
  assert.equal(replayed.outcome, "succeeded");
  assert.equal((await store.recordIndependentSuccess(candidate.id, replayed.receipt)).state, "candidate");
});

test("Store revalidates persisted replay receipts and rejects tampering on load", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "computer-procedure-tamper-")), "procedures.json");
  const store = makeStore(path);
  const candidate = safeCandidate();
  await store.saveCandidate(candidate);
  await store.recordIndependentSuccess(candidate.id, issueReplayReceipt(candidate, "task-tamper", "run-tamper"));
  const document = JSON.parse(await readFile(path, "utf8"));
  document.procedures[0].evidence.independentSuccesses[0].receipt = "receipt:forged";
  await writeFile(path, JSON.stringify(document));
  await assert.rejects(store.get(candidate.id), /receipt failed host verification/i);
});

test("malformed replay receipt causes zero Procedure state mutation", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "computer-procedure-malformed-receipt-")), "procedures.json");
  const candidate = safeCandidate();
  const token = "receipt:empty-identities";
  const otherwiseValid = replayReceipts.get(issueReplayReceipt(candidate, "temporary-task", "temporary-run"));
  replayReceipts.set(token, { ...otherwiseValid, taskId: "", runId: "" });
  const store = makeStore(path);
  await store.saveCandidate(candidate);
  const before = await readFile(path, "utf8");
  await assert.rejects(store.recordIndependentSuccess(candidate.id, token), /receipt.*identity|taskId|runId/i);
  assert.equal(await readFile(path, "utf8"), before);
  const after = await store.get(candidate.id);
  assert.equal(after.evidence.independentSuccesses.length, 0);
  assert.equal(after.evidence.consecutiveFailures, 0);
});

test("Replay requires a receipt issuer and nonempty caller task/run identity", async () => {
  const common = {
    policy: procedurePolicy,
    evaluate: async (_condition, _phase, _parameters, observation) => ({ met: true, observationId: observation?.id ?? "pre", observedAt: new Date().toISOString() }),
    executeStep: async () => ({ ok: true, observation: { id: "post", capturedAt: new Date(Date.now() - 1000).toISOString() } }),
  };
  assert.throws(() => new ProcedureReplayEngine(common), /receipt issuer/i);
  const replay = new ProcedureReplayEngine({ ...common, issueReceipt: async () => "receipt:issued" });
  await assert.rejects(replay.replay(safeCandidate(), { outputFile: "/tmp/a", content: "x" }, undefined, { taskId: "", runId: "" }), /task.*run.*identity/i);
});

test("arbitrary replay assertions cannot promote and suspended state is monotonic", async () => {
  const store = makeStore(join(await mkdtemp(join(tmpdir(), "computer-procedure-")), "procedures.json"), { suspendAfterFailures: 1 });
  const candidate = safeCandidate();
  await store.saveCandidate(candidate);
  await assert.rejects(store.recordIndependentSuccess(candidate.id, { taskId: "fake", runId: candidate.evidence.exploration.runId, verifiedAt: "not-a-date" }), /receipt|evidence|independent/i);
  const suspended = await store.recordFailure(candidate.id, { kind: "drift" });
  assert.equal(suspended.state, "suspended");
  await assert.rejects(store.recordIndependentSuccess(candidate.id, { taskId: "fake-2", runId: "fake-2", verifiedAt: new Date().toISOString() }), /suspended|candidate|receipt/i);
  assert.equal((await store.get(candidate.id)).state, "suspended");
});

test("failed Preconditions cause replay to fall back before mutation", async () => {
  let mutations = 0;
  const replay = new ProcedureReplayEngine({
    policy: procedurePolicy,
    evaluate: async () => ({ met: false, observationId: "pre", observedAt: "2026-08-12T00:00:00.000Z" }),
    executeStep: async () => { mutations += 1; return { ok: true, observation: { id: "post", capturedAt: "2026-08-12T00:00:01.000Z" } }; },
    issueReceipt: testReceiptIssuer,
  });
  const result = await replay.replay(safeCandidate(), { outputFile: "/tmp/a.txt", content: "hello" }, undefined, { taskId: "task-precondition", runId: "run-precondition" });
  assert.equal(result.outcome, "fallback_to_agent");
  assert.equal(mutations, 0);
});

test("zero-Precondition or corrupt Procedure is rejected before replay mutation", async () => {
  let mutations = 0;
  const replay = new ProcedureReplayEngine({
    policy: procedurePolicy,
    evaluate: async () => ({ met: true, observationId: "obs", observedAt: "2026-08-12T00:00:02.000Z" }),
    executeStep: async () => { mutations += 1; return { ok: true, observation: { id: "obs", capturedAt: "2026-08-12T00:00:01.000Z" } }; },
    issueReceipt: testReceiptIssuer,
  });
  const unsafe = safeCandidate();
  unsafe.preconditions = [];
  await assert.rejects(replay.replay(unsafe, { outputFile: "/tmp/a.txt", content: "hello" }), /precondition|lint|schema/i);
  assert.equal(mutations, 0);

  const path = join(await mkdtemp(join(tmpdir(), "computer-procedure-corrupt-")), "procedures.json");
  await writeFile(path, JSON.stringify({ schemaVersion: 1, procedures: [unsafe] }));
  const store = makeStore(path);
  await assert.rejects(store.get(unsafe.id), /admission|precondition|schema/i);
  assert.equal(mutations, 0);
});

test("replay verifies every consequential step Postcondition", async () => {
  const checked = [];
  const replay = new ProcedureReplayEngine({
    policy: procedurePolicy,
    evaluate: async (condition, phase, _parameters, observation) => { checked.push([condition.kind, phase]); return { met: true, observationId: observation?.id ?? "pre", observedAt: "2026-08-12T00:00:02.000Z" }; },
    executeStep: async () => ({ ok: true, observation: { id: "post", capturedAt: "2026-08-12T00:00:01.000Z" } }),
    issueReceipt: testReceiptIssuer,
  });
  const result = await replay.replay(safeCandidate(), { outputFile: "/tmp/a.txt", content: "hello" }, undefined, { taskId: "task-success", runId: "run-success" });
  assert.equal(result.outcome, "succeeded");
  assert.ok(checked.some(([, phase]) => phase === "precondition"));
  assert.ok(checked.some(([, phase]) => phase === "step_postcondition"));
  assert.ok(checked.some(([, phase]) => phase === "procedure_postcondition"));
});

test("replay rejects cached Postcondition evidence not bound to the fresh post-action observation", async () => {
  const replay = new ProcedureReplayEngine({
    policy: procedurePolicy,
    evaluate: async (_condition, phase) => ({ met: true, observationId: phase === "precondition" ? "pre" : "cached-before-action", observedAt: "2026-08-12T00:00:02.000Z" }),
    executeStep: async () => ({ ok: true, observation: { id: "fresh-after-action", capturedAt: "2026-08-12T00:00:01.000Z" } }),
    issueReceipt: testReceiptIssuer,
  });
  const result = await replay.replay(safeCandidate(), { outputFile: "/tmp/a", content: "x" }, undefined, { taskId: "task-cached", runId: "run-cached" });
  assert.equal(result.outcome, "drift");
  assert.match(result.reason, /step_postcondition_failed/);
});

test("drift creates a versioned repair candidate without overwriting verified", async () => {
  const store = makeStore(join(await mkdtemp(join(tmpdir(), "computer-procedure-")), "procedures.json"));
  const candidate = safeCandidate();
  await store.saveCandidate(candidate);
  await store.recordIndependentSuccess(candidate.id, issueReplayReceipt(candidate, "task-b", "run-b"));
  const verified = await store.recordIndependentSuccess(candidate.id, issueReplayReceipt(candidate, "task-c", "run-c"));
  const repair = await store.createRepairCandidate(verified.id, { steps: verified.steps, evidence: { taskId: "task-d", runId: "run-d", verifiedAt: "2026-08-14T00:00:00.000Z" } });
  assert.equal(repair.version, verified.version + 1);
  assert.equal(repair.state, "candidate");
  assert.equal((await store.get(verified.id)).state, "verified");
  assert.notEqual(repair.id, verified.id);
});

test("repeated failures suspend a Procedure", async () => {
  const store = makeStore(join(await mkdtemp(join(tmpdir(), "computer-procedure-")), "procedures.json"), { suspendAfterFailures: 2 });
  const candidate = safeCandidate();
  await store.saveCandidate(candidate);
  await store.recordFailure(candidate.id, { kind: "drift" });
  assert.equal((await store.recordFailure(candidate.id, { kind: "drift" })).state, "suspended");
});

test("sensitive applications never create Procedure candidates", () => {
  assert.throws(() => safeCandidate({ application: { bundleId: "com.apple.keychainaccess", appName: "Keychain Access" } }), /sensitive application/i);
  assert.throws(() => safeCandidate({ application: { bundleId: "com.1password.1password", appName: "1Password" } }), /sensitive application/i);
});

test("canonical sensitive policy is rechecked on Store lookup and Replay", async () => {
  let denied = false;
  const dynamicPolicy = { isSensitiveApplication: () => denied };
  const trajectory = {
    intent: "safe then denied", application: app,
    parameters: [{ name: "outputFile", kind: "file_path", required: true }, { name: "content", kind: "short_text", required: true }],
    preconditions: [{ kind: "application_available", bundleId: app.bundleId }],
    steps: [{ id: "write", role: "terminal-worker", action: { kind: "write_parameterized_file", pathParameter: "outputFile", contentParameter: "content" }, postconditions: [postcondition], consequential: true }],
    postconditions: [postcondition], recovery: [], evidence: { taskId: "explore-policy", runId: "run-policy", verifiedAt: "2026-08-11T00:00:00.000Z" },
  };
  const receipt = "trajectory:dynamic-policy";
  trajectoryReceipts.set(receipt, trajectory);
  const candidate = compileProcedureCandidate(receipt, dynamicPolicy, trajectoryVerifier);
  const store = new JsonProcedureStore(join(await mkdtemp(join(tmpdir(), "computer-procedure-policy-")), "procedures.json"), { policy: dynamicPolicy, receiptVerifier: replayReceiptVerifier });
  await store.saveCandidate(candidate);
  denied = true;
  await assert.rejects(store.get(candidate.id), /sensitive application/i);
  const replay = new ProcedureReplayEngine({ policy: dynamicPolicy, evaluate: async () => ({ met: false, observationId: "none", observedAt: new Date().toISOString() }), executeStep: async () => ({ ok: false }), issueReceipt: testReceiptIssuer });
  await assert.rejects(replay.replay(candidate, { outputFile: "/tmp/a", content: "x" }), /sensitive application/i);
});

test("Terminal self-report cannot verify a false Postcondition or leak raw context into results/events", async () => {
  const events = [];
  const raw = "data:image/png;base64,RAW_SCREENSHOT_AX capability=secret x=10 y=20";
  const coordinator = new ComputerAgentCoordinator({
    planner: {
      plan: async (goal) => ({ goal, mode: "planned", successConditions: [{ kind: "file_exists", path: "/tmp/never" }], steps: [{ id: "terminal", role: "terminal-worker", objective: raw, dependsOn: [], postconditions: [{ kind: "file_exists", path: "/tmp/never" }], terminalPolicy }] }),
      replan: async ({ plan }) => ({ ...plan, revision: 1 }),
    },
    dispatcher: { dispatch: async () => ({ outcome: "verified", summary: raw, claims: [raw] }) },
    maxReplans: 0,
    onEvent: (event) => events.push(event),
  });
  await assert.rejects(coordinator.run({ goal: raw }), /Computer Task accepts only Cua desktop actions/);
  assert.equal(events.some(({ type }) => type === "worker_started"), false);
});

test("closed coordinator projection drops standalone base64, coordinates, passwords, and arbitrary prose", async () => {
  const events = [];
  const rawValues = ["QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo", "10, 20", "hunter2", "arbitrary worker prose that must not cross"];
  const coordinator = new ComputerAgentCoordinator({
    planner: { plan: async (goal) => ({ goal, mode: "direct", successConditions: [{ kind: "visible_text", contains: "done" }], steps: [{ id: "gui", role: "gui-operator", objective: "Inspect", dependsOn: [], postconditions: [{ kind: "visible_text", contains: "done" }] }] }), replan: async ({ plan }) => plan },
    dispatcher: { dispatch: async () => ({ outcome: "completed", summary: rawValues[0], claims: rawValues, observation: { id: "obs-safe", visibleText: ["done"] }, artifactReferences: [{ id: "artifact:test", kind: "trajectory", summary: rawValues[3], digest: "a".repeat(64), byteLength: 12, rawPayload: rawValues, nested: { secret: "hunter2" } }] }) },
    maxReplans: 0,
    onEvent: (event) => events.push(event),
  });
  const result = await coordinator.run({ goal: "Run bounded inspection" });
  const serialized = JSON.stringify({ result, events });
  for (const raw of rawValues) assert.equal(serialized.includes(raw), false, raw);
  assert.deepEqual(result.verification, { status: "verified", conditionResults: [{ conditionId: "task:condition:0", outcome: "verified" }] });
  assert.deepEqual(events.find(({ type }) => type === "verification")?.conditionResults, [{ conditionId: "task:condition:0", outcome: "verified" }]);
  const projected = projectComputerWorkerResult({ outcome: "completed", summary: rawValues[0], claims: rawValues, artifactReferences: [{ id: "artifact:test", kind: "trajectory", summary: rawValues[3], digest: "a".repeat(64), byteLength: 12, rawPayload: rawValues, nested: { secret: "hunter2" } }] });
  assert.deepEqual(Object.keys(projected.artifactReferences[0]).sort(), ["byteLength", "digest", "id", "kind", "summary"]);
  assert.equal(projected.summary, "Worker completed");
  assert.equal("claims" in projected, false);
});

test("closed worker failure projection retains only an allowlisted GUI stage code", () => {
  const raw = "secret=/Users/example/Desktop/private.txt token=abc123 coordinates=400,500";
  const projected = projectComputerWorkerResult({ outcome: "failed", summary: raw, failureCode: "gui_private_resource_failed" });
  assert.deepEqual(projected, { outcome: "failed", summary: "Worker failed", failureCode: "gui_private_resource_failed" });
  assert.equal(projectComputerWorkerResult({ outcome: "failed", summary: raw, failureCode: "computer_worker_runtime_timeout" }).failureCode, "computer_worker_runtime_timeout");
  assert.equal(projectComputerWorkerResult({ outcome: "blocked", summary: raw, failureCode: "terminal_path_policy_rejected" }).failureCode, "terminal_path_policy_rejected");
  assert.equal(JSON.stringify(projected).includes("private.txt"), false);
  assert.equal(projectComputerWorkerResult({ outcome: "failed", summary: raw, failureCode: raw }).failureCode, undefined);
});
