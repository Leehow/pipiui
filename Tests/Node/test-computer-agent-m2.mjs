import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ComputerAgentCoordinator,
  projectComputerWorkerResult,
} from "../../Sources/PipiUI/PiExt/packages/computer-agent/src/coordinator.ts";
import {
  ComputerWorkerBroker,
  grantsForComputerRole,
} from "../../Sources/PipiUI/PiExt/packages/computer-agent/src/worker-broker.ts";
import { ComputerWorkerBrokerServer } from "../../Sources/PipiUI/PiExt/packages/computer-agent/src/worker-broker-server.ts";
import { validateTerminalStep } from "../../Sources/PipiUI/PiExt/packages/computer-agent/src/terminal-policy.ts";
import { skillNamesForComputerRole } from "../../Sources/PipiUI/PiExt/packages/computer-agent/src/workers.ts";
import { registerComputerTerminalTools, toolNamesForTerminalWorkerRole } from "../../Sources/PipiUI/PiExt/packages/computer-agent/extensions/computer-terminal.ts";
import {
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

test("planned task dispatches Terminal Worker before dependent GUI and keeps worker reports compressed", async () => {
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
    dispatcher: {
      dispatch: async (request) => {
        dispatches.push(request);
        if (request.role === "terminal-worker") {
          assert.deepEqual(request.grants, []);
          assert.deepEqual(request.terminalPolicy, terminalPolicy);
          return { outcome: "completed", summary: "file created", observation: { id: "artifact:file-1", files: [{ path: "/tmp/example.txt", exists: true }] }, artifactReferences: [{ id: "artifact:terminal-1", kind: "terminal", summary: "file created" }], trajectory: "x".repeat(20_000) };
        }
        return { outcome: "completed", summary: "TextEdit shows hello", observation: { id: "obs-2", visibleText: ["hello"] } };
      },
    },
  });

  const result = await coordinator.run({ goal: "Create a file and open it" });
  assert.equal(result.outcome, "succeeded");
  assert.deepEqual(dispatches.map(({ role }) => role), ["terminal-worker", "gui-operator"]);
  assert.doesNotMatch(JSON.stringify(result), /x{100}|screenshot|accessibility|base64/i);
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
      plan: async (goal) => ({ goal, mode: "planned", successConditions: [], steps: [{ id: "bad", role: "peer-agent", objective: "talk laterally", dependsOn: [], postconditions: [] }] }),
      replan: async () => { throw new Error("not reached"); },
    },
    dispatcher: { dispatch: async () => { throw new Error("invalid role must not dispatch"); } },
    onEvent: (event) => events.push(event),
  });
  await assert.rejects(coordinator.run({ goal: "invalid plan" }), /fixed Computer Worker role/);
  assert.equal(events.some(({ type }) => type === "worker_started"), false);

  const flattened = new ComputerAgentCoordinator({
    planner: { plan: async (goal) => ({ goal, mode: "planned", successConditions: [{ kind: "file_exists", path: "/tmp/a" }], steps: [{ id: "terminal", role: "terminal-worker", objective: "inspect", dependsOn: [], postconditions: [{ kind: "file_exists", path: "/tmp/a" }], cwd: "/tmp", writeRoots: ["/tmp"], allowedExecutables: ["/usr/bin/stat"], maxCommands: 1 }] }), replan: async () => { throw new Error("not reached"); } },
    dispatcher: { dispatch: async () => { throw new Error("flattened policy must not dispatch"); } },
  });
  await assert.rejects(flattened.run({ goal: "flattened" }), /requires a bounded terminal policy/);
  const relativePolicy = new ComputerAgentCoordinator({
    planner: { plan: async (goal) => ({ goal, mode: "planned", successConditions: [{ kind: "file_exists", path: "/tmp/a" }], steps: [{ id: "terminal", role: "terminal-worker", objective: "inspect", dependsOn: [], postconditions: [{ kind: "file_exists", path: "/tmp/a" }], terminalPolicy: { cwd: ".", writeRoots: ["."], allowedExecutables: ["stat"], maxCommands: 1 } }] }), replan: async () => { throw new Error("not reached"); } },
    dispatcher: { dispatch: async () => { throw new Error("invalid boundary must not dispatch"); } },
  });
  await assert.rejects(relativePolicy.run({ goal: "relative policy" }), /absolute|approved exact canonical/);

  const validEvents = [];
  const valid = new ComputerAgentCoordinator({
    planner: {
      plan: async (goal) => ({ goal, mode: "planned", successConditions: [], steps: [{ id: "terminal", role: "terminal-worker", objective: "inspect", dependsOn: [], postconditions: [{ kind: "file_exists", path: "/tmp/a" }], terminalPolicy }] }),
      replan: async () => { throw new Error("not reached"); },
    },
    dispatcher: { dispatch: async () => ({ outcome: "completed", summary: "ok", observation: { id: "file", files: [{ path: "/tmp/a", exists: true }] } }) },
    onEvent: (event) => validEvents.push(event),
  });
  await valid.run({ goal: "inspect" });
  const worker = validEvents.find(({ type }) => type === "worker_started");
  assert.deepEqual({ role: worker.role, parentRole: worker.parentRole, depth: worker.depth }, { role: "terminal-worker", parentRole: "computer-use-leader", depth: 1 });
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
  const result = await coordinator.run({ goal: raw });
  assert.notEqual(result.outcome, "succeeded");
  assert.doesNotMatch(JSON.stringify({ result, events }), /RAW_SCREENSHOT_AX|base64|capability=secret|x=10/i);
});

test("closed coordinator projection drops standalone base64, coordinates, passwords, and arbitrary prose", async () => {
  const events = [];
  const rawValues = ["QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo", "10, 20", "hunter2", "arbitrary worker prose that must not cross"];
  const coordinator = new ComputerAgentCoordinator({
    planner: { plan: async (goal) => ({ goal, mode: "direct", successConditions: [{ kind: "file_exists", path: "/bounded/done" }], steps: [{ id: "gui", role: "gui-operator", objective: "Inspect", dependsOn: [], postconditions: [{ kind: "file_exists", path: "/bounded/done" }] }] }), replan: async ({ plan }) => plan },
    dispatcher: { dispatch: async () => ({ outcome: "completed", summary: rawValues[0], claims: rawValues, observation: { id: "obs-safe", files: [{ path: "/bounded/done", exists: true }] }, artifactReferences: [{ id: "artifact:test", kind: "trajectory", summary: rawValues[3], digest: "a".repeat(64), byteLength: 12, rawPayload: rawValues, nested: { secret: "hunter2" } }] }) },
    maxReplans: 0,
    onEvent: (event) => events.push(event),
  });
  const result = await coordinator.run({ goal: "Run bounded inspection" });
  const serialized = JSON.stringify({ result, events });
  for (const raw of rawValues) assert.equal(serialized.includes(raw), false, raw);
  assert.deepEqual(result.verification, { status: "verified", conditionResults: [{ conditionId: "gui:condition:0", outcome: "verified" }] });
  assert.deepEqual(events.find(({ type }) => type === "verification")?.conditionResults, [{ conditionId: "gui:condition:0", outcome: "verified" }]);
  const projected = projectComputerWorkerResult({ outcome: "completed", summary: rawValues[0], claims: rawValues, artifactReferences: [{ id: "artifact:test", kind: "trajectory", summary: rawValues[3], digest: "a".repeat(64), byteLength: 12, rawPayload: rawValues, nested: { secret: "hunter2" } }] });
  assert.deepEqual(Object.keys(projected.artifactReferences[0]).sort(), ["byteLength", "digest", "id", "kind", "summary"]);
  assert.equal(projected.summary, "Worker completed");
  assert.equal("claims" in projected, false);
});

