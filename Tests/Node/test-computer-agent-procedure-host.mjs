import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ProcedureHostRuntime } from "../../Sources/PipiUI/PiExt/packages/computer-agent/src/procedure-host.ts";
import { TerminalWorkerBrokerServer } from "../../Sources/PipiUI/PiExt/packages/computer-agent/src/terminal-broker-server.ts";
import { registerComputerTerminalTools } from "../../Sources/PipiUI/PiExt/packages/computer-agent/extensions/computer-terminal.ts";

const application = { bundleId: "com.apple.TextEdit", appName: "TextEdit" };
const policy = { isSensitiveApplication: ({ bundleId }) => /keychain|1password/i.test(bundleId) };
const candidateInput = (evidence) => ({ intent: "write file", application, parameters: [{ name: "outputFile", kind: "file_path", required: true }, { name: "content", kind: "short_text", required: true }], preconditions: [{ kind: "application_available", bundleId: application.bundleId }], steps: [{ id: "write", role: "terminal-worker", action: { kind: "write_parameterized_file", pathParameter: "outputFile", contentParameter: "content" }, postconditions: [{ kind: "file_exists", pathParameter: "outputFile" }], consequential: true }], postconditions: [{ kind: "file_exists", pathParameter: "outputFile" }], recovery: [{ on: "drift", action: "replan" }], evidence });

test("Procedure Host public runtime promotes only via two independent qualified runs and handles fallback, drift suspension, and cancellation", async () => {
  const root = await mkdtemp(join(tmpdir(), "procedure-host-")); let precondition = true; let drift = false; let mutations = 0;
  const runtime = await ProcedureHostRuntime.open({ storePath: join(root, "procedures.json"), policy, suspendAfterFailures: 2, adapters: {
    evaluate: async (_condition, phase, _parameters, observation) => ({ met: phase === "precondition" ? precondition : !drift, observationId: observation?.id ?? "pre:fresh", observedAt: new Date().toISOString() }),
    execute: async (_step, _parameters, signal) => { if (signal?.aborted) return { ok: false }; mutations += 1; return { ok: true, observation: { id: `post:${mutations}`, capturedAt: new Date(Date.now() - 1).toISOString() } }; },
  } });
  const candidate = await runtime.recordVerifiedExploration(candidateInput({ taskId: "explore", runId: "explore-run", verifiedAt: new Date().toISOString() }));
  const parameters = { outputFile: "/tmp/result.txt", content: "hello" };
  assert.equal((await runtime.run({ intent: candidate.intent, bundleId: application.bundleId, parameters, taskId: "q1", runId: "qr1", qualifyCandidate: true })).state, "candidate");
  assert.equal((await runtime.run({ intent: candidate.intent, bundleId: application.bundleId, parameters, taskId: "q2", runId: "qr2", qualifyCandidate: true })).state, "verified");
  assert.equal((await runtime.run({ intent: candidate.intent, bundleId: application.bundleId, parameters, taskId: "fast", runId: "fr" })).outcome, "succeeded");
  const before = mutations; precondition = false; assert.equal((await runtime.run({ intent: candidate.intent, bundleId: application.bundleId, parameters, taskId: "pre", runId: "pr" })).outcome, "fallback_to_agent"); assert.equal(mutations, before);
  precondition = true; drift = true; await runtime.run({ intent: candidate.intent, bundleId: application.bundleId, parameters, taskId: "d1", runId: "dr1" }); await runtime.run({ intent: candidate.intent, bundleId: application.bundleId, parameters, taskId: "d2", runId: "dr2" }); assert.equal((await runtime.get(candidate.id)).state, "suspended");
  const cancelled = new AbortController(); cancelled.abort(); drift = false; assert.equal((await runtime.run({ intent: candidate.intent, bundleId: application.bundleId, parameters, taskId: "cancel", runId: "cr" }, cancelled.signal)).outcome, "fallback_to_agent");
});

test("trusted coordinator compilation rejects forged application and ambiguous bindings", async () => {
  const root = await mkdtemp(join(tmpdir(), "procedure-trust-"));
  const runtime = await ProcedureHostRuntime.open({ storePath: join(root, "procedures.json"), policy, adapters: { evaluate: async () => ({ met: false, observationId: "x", observedAt: new Date().toISOString() }), execute: async () => ({ ok: false }) } });
  const content = "hello"; const record = { role: "terminal-worker", kind: "write_parameterized_file", path: "/tmp/result.txt", byteLength: 5, contentDigest: createHash("sha256").update(content).digest("hex"), observationId: "file:1", observedAt: new Date().toISOString() };
  const base = { taskId: "task", runId: "run", goal: "write file", plan: { goal: "write file", mode: "planned", successConditions: [{ kind: "file_exists", path: record.path }], steps: [{ id: "open", role: "gui-operator", objective: "open", dependsOn: [], postconditions: [] }, { id: "write", role: "terminal-worker", objective: "write", dependsOn: ["open"], postconditions: [{ kind: "file_exists", path: record.path }], terminalPolicy: { cwd: "/tmp", writeRoots: ["/tmp"], allowedExecutables: [], maxCommands: 1 } }], procedureContext: { application, parameters: { outputFile: record.path, content } } }, steps: [{ stepId: "open", hostExecutionRecords: [{ role: "gui-operator", kind: "open_application", bundleId: application.bundleId, appName: application.appName, observationId: "gui:1", observedAt: new Date().toISOString() }] }, { stepId: "write", hostExecutionRecords: [record] }], verificationObservationIds: ["file:1"] };
  await assert.rejects(runtime.recordCoordinatorExecution({ ...base, plan: { ...base.plan, procedureContext: { ...base.plan.procedureContext, application: { bundleId: "com.evil.Forge", appName: "TextEdit" } } } }), /does not match authoritative/i);
  await assert.rejects(runtime.recordCoordinatorExecution({ ...base, plan: { ...base.plan, procedureContext: { ...base.plan.procedureContext, parameters: { outputFile: record.path, duplicatePath: record.path, content } } } }), /ambiguous/i);
  assert.equal((await runtime.recordCoordinatorExecution(base)).state, "candidate");
});

test("registered Electron computer_task exposes only a goal and one Computer Use Agent episode", async () => {
  const source = await readFile(new URL("../../Electron/resources/runtime/pi-ext/subagent/index.ts", import.meta.url), "utf8");
  const start = source.indexOf("function registerComputerTaskTool(");
  const end = source.indexOf("function registerLedgerNoteTool", start);
  const normalPath = source.slice(start, end);
  assert.match(normalPath, /Type\.Object\(\{\s*goal: Type\.String/);
  assert.doesNotMatch(normalPath, /agentId: Type\.Optional|recoveryPolicy|procedureContext/);
  assert.match(normalPath, /runSingleAgent\(ctx\.cwd, computerAgents, "computer-use"/);
  assert.match(normalPath, /episodeCount: 1/);
  assert.match(normalPath, /runningComputerTasks\.set\(taskId, \{ runId, controller \}\)/);
  assert.match(source, /const computerTask = runningComputerTasks\.get\(agentId\)[\s\S]{0,160}computerTask\.controller\.abort\(\)/);
  assert.match(normalPath, /taskSignal\.aborted[\s\S]{0,200}outcome: "cancelled"/);
  assert.match(normalPath, /runningComputerTasks\.get\(taskId\)\?\.runId === runId[\s\S]{0,120}runningComputerTasks\.delete\(taskId\)/);
});

test("real Terminal child tools proxy to one-run Host execution and authoritative audit", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminal-host-broker-")); const output = join(root, "result.txt"); await writeFile(output, "before");
  const server = new TerminalWorkerBrokerServer(); await server.start();
  try {
    const issued = server.issue({ taskId: "task", stepId: "step", runId: "run", policy: { cwd: root, writeRoots: [root], allowedExecutables: ["/usr/bin/printf"], maxCommands: 1 } });
    const tools = []; registerComputerTerminalTools({ registerTool: (tool) => tools.push(tool) }, issued.environment);
    await tools.find(({ name }) => name === "terminal_write_file").execute("write", { path: output, content: "after" });
    assert.equal(await readFile(output, "utf8"), "after");
    const records = server.consumeExecutions("task", "step"); assert.equal(records.length, 1); assert.equal(records[0].path, output); assert.doesNotMatch(JSON.stringify(records), /after/);
    server.revokeStep("task", "step");
    await assert.rejects(
      tools.find(({ name }) => name === "terminal_file_status").execute("status", { path: output }),
      (error) => error?.message === "terminal_operation_failed" && error?.code === "terminal_operation_failed",
    );
  } finally { await server.stop(); }
});
