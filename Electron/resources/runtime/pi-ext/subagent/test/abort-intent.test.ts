import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatBossAlarmMessage } from "../boss-alarm.ts";
import { SupervisorWaveIdentityTracker, summarizeSupervisorRuntimeWave } from "../supervisor/wave-identity.ts";

const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

/**
 * Who decided an abort decides what follows. The Boss's own abort (tool, slash command,
 * panel, stop sweep, a stopped Boss turn) owes the Boss nothing but one receipt; only the
 * runtime's aborts (stall watchdog, timeout, usage budget, Supervisor) are news it must
 * acknowledge. These pins keep every entry point labelled and the receipt path split.
 */
test("every abort entry point declares its intent", () => {
	// Boss-decided: the tool, the slash/panel command, and the stop sweep.
	assert.match(source, /const abortResult = abortRunningAgent\(target, \{ runId, abortedBy: "boss" \}\);/);
	assert.match(source, /const result = abortRunningAgent\(agentId, \{ runId, abortedBy: "boss" \}\);/);
	assert.match(source, /if \(abortRunningAgent\(agentId, \{ runId, abortedBy: "boss" \}\)\.ok\) aborted\.push\(agentId\);/);
	// Runtime-decided: the stall watchdog and the Supervisor-owned closeout.
	assert.match(source, /abortRunningAgent\(agentId, \{ reportTerminalToSupervisor: true, runId: handle\.runId, abortedBy: "runtime" \}\)/);
	assert.match(source, /abortRunningAgent\(id\.agentId, \{ runId: id\.runId, abortedBy: "runtime" \}\)/);
	// No call site is left without an intent: the option is mandatory in the signature.
	assert.match(source, /options: \{ reportTerminalToSupervisor\?: boolean; runId: string; abortedBy: AbortIntent \}/);
	const calls = source.match(/abortRunningAgent\([^)]*\)/g) ?? [];
	for (const call of calls) {
		if (call.startsWith("abortRunningAgent(\n")) continue;
		assert.match(call, /abortedBy: "(boss|runtime)"/, `call without intent: ${call}`);
	}
});

test("intent is recorded before the signal fires and survives into the result and the job record", () => {
	assert.match(source, /handle\.abortedBy = options\.abortedBy;\s*noteDiagnosticsAbort\(handle\.diagnostics, options\.abortedBy === "boss" \? "user" : "stall"\);/);
	// A stopped Boss turn (the tool's own signal) is principal-initiated; a bare controller abort is the runtime's.
	assert.match(source, /if \(intentHandle && !intentHandle\.abortedBy\) intentHandle\.abortedBy = signal\?\.aborted \? "boss" : "runtime";/);
	assert.match(source, /if \(wasAborted\) currentResult\.abortedBy = handleForRun\(pipiuiAgentId, runId\)\?\.abortedBy \?\? "runtime";/);
	assert.match(source, /\.\.\.\(result\.abortedBy \? \{ abortedBy: result\.abortedBy \} : \{\}\),/);
});

test("a Boss-decided abort finalizes as handled and sends one receipt without an alarm", () => {
	// jobFinalize closes the episode itself, so no interrupted reminder is ever scheduled.
	assert.match(source, /fields\.state === "aborted" && fields\.abortedBy === "boss"\s*\?\s*\{[\s\S]*?closeoutDisposition: "cleaned" as const,\s*closeoutReason: "aborted at the Boss's request",/);
	// notifySubagentDone: the Boss path returns before the Supervisor closeout, with armAlarm=false.
	const notify = source.slice(source.indexOf("function notifySubagentDone("), source.indexOf("logCloseoutProbe(\"findings\""));
	assert.match(notify, /const bossAborted = result\.abortedBy === "boss";/);
	assert.match(notify, /if \(bossAborted && terminalAgentId && runId\) \{\s*[\s\S]*?deliverConfirmedDoneToBossAsync\(pi, terminalAgentId, runId, text, undefined, false\);\s*return;\s*\}/);
	assert.match(notify, /aborted at your request and now terminal\. No alarm or reminder follows; the episode is marked handled\./);
	// The abort receipt tells the Boss the truth about what follows, in both directions.
	assert.match(source, /Because you asked for this, one \[subagent-aborted\] receipt arrives when the process is gone and nothing else follows/);
	assert.match(source, /A \[subagent-aborted\] receipt with a Boss alarm follows once the process is gone\./);
	assert.doesNotMatch(source, /Aborted jobs do not push a \[subagent-done\] follow-up/);
});

test("resolve acknowledges the run's alarm and ack marks the episode handled: one act, either door", () => {
	const resolve = source.slice(source.indexOf("function resolveSubagentEpisode("), source.indexOf("function acknowledgeAlarmsForRun("));
	assert.match(resolve, /const acked = acknowledgeAlarmsForRun\(agentId, runId, reason\);/);
	const ack = source.slice(source.indexOf("function acknowledgeSubagentAlarm("), source.indexOf("function acknowledgeAlarmsForRun("));
	assert.match(ack, /current\.closeoutDisposition = "cleaned";/);
	assert.match(ack, /cancelInterruptedReminders\(current\.agentId, current\.runId\);/);
	// The alarm text names the resolve door, keeping the opaque runId out of model-facing text.
	const text = formatBossAlarmMessage({ text: "[subagent-done] ok=false", agentId: "worker-a", alarmId: "worker-a.1" });
	assert.match(text, /Closing the episode with subagent_resolve for this agentId and the run subagent_status shows acknowledges this alarm in the same call\./);
	assert.doesNotMatch(text, /remains separate/);
	assert.doesNotMatch(text, /runId/, "the alarm keeps the opaque run identity out of model-facing text");
});

test("a Boss-handled episode is terminal for the wave but not a failure the Supervisor may raise", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pipiui-abort-intent-wave-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const tracker = new SupervisorWaveIdentityTracker(directory, "session-intent");
	const jobs = [
		{ agentId: "kept", runId: "r1", state: "ok" },
		{ agentId: "boss-stopped", runId: "r2", state: "aborted", handled: true },
		{ agentId: "runtime-stopped", runId: "r3", state: "aborted" },
	];
	const wave = summarizeSupervisorRuntimeWave(tracker, jobs);
	assert.equal(wave.running, 0);
	assert.equal(wave.completed, 1);
	assert.equal(wave.failed, 1, "only the runtime's abort counts as a failure");
	assert.deepEqual(wave.agentIds, ["boss-stopped", "kept", "runtime-stopped"]);
	assert.match(source, /handled: isHandledJob\(job\)/);
});
