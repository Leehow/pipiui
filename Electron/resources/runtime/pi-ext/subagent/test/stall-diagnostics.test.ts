import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
	classifyWatchdogProbe,
	createProcessGeneration,
	createStallDiagnosticsState,
	formatDiagnosticsCompactLine,
	noteDiagnosticsChildExit,
	noteDiagnosticsCpuSample,
	noteDiagnosticsIo,
	preferSpecificExitReason,
	recordWatchdogDecision,
	snapshotStallDiagnostics,
} from "../stall-diagnostics.ts";

test("silent long tool with CPU progress is not diagnosed as a real stall", () => {
	const now = 180_000;
	const probe = classifyWatchdogProbe({
		inTool: true,
		stalled: false,
		stallAction: "notify",
		stallNotifyCount: 0,
		childPid: 4242,
		finalizing: false,
		cpuVerdict: "working",
		lastActivityAt: 1_000,
		now,
	});
	assert.equal(probe.decision, "cpu-progress");
	assert.equal(probe.reason, "tool-quiet-cpu-advancing");
	assert.notEqual(probe.decision, "first-stall-notify");
	assert.notEqual(probe.decision, "final-abort");
});

test("tool-quiet without CPU still stays alive until watchdog actually stalls", () => {
	const probe = classifyWatchdogProbe({
		inTool: true,
		stalled: false,
		stallAction: "ignore",
		stallNotifyCount: 0,
		childPid: 7,
		finalizing: false,
		cpuVerdict: "unknown",
		lastActivityAt: 1_000,
		now: 40_000,
	});
	assert.equal(probe.decision, "tool-quiet-alive");
});

test("process generation and seq mismatch remain metadata, not stall", () => {
	const first = createStallDiagnosticsState(createProcessGeneration(11, 100), 11);
	noteDiagnosticsIo(first, "stdout", 12, 1_000);
	noteDiagnosticsCpuSample(first, 2_000, 800);
	const changed = recordWatchdogDecision(first, "cpu-progress", "tool-quiet-cpu-advancing");
	assert.equal(changed, true);
	const snapshot = snapshotStallDiagnostics({
		agentId: "builder",
		runId: "run-1",
		state: first,
		lastActivityAt: 1_000,
		childPid: 99,
		toolWaitName: "bash",
		cpuVerdict: "working",
	});
	assert.equal(snapshot.processGeneration, "11:100");
	assert.ok(snapshot.eventSeq >= 3);
	assert.match(formatDiagnosticsCompactLine(snapshot), /seq=\d+ gen=11:100/);
	assert.doesNotMatch(formatDiagnosticsCompactLine(snapshot), /prompt|argv|stdout=/);

	const otherGen = createStallDiagnosticsState(createProcessGeneration(12, 200), 12);
	assert.notEqual(otherGen.processGeneration, first.processGeneration);
	assert.notEqual(snapshot.eventSeq, otherGen.eventSeq);
});

test("gone child and first stall notify stay distinct from cpu-progress", () => {
	assert.equal(classifyWatchdogProbe({
		inTool: true,
		stalled: true,
		stallAction: "notify",
		stallNotifyCount: 0,
		childPid: 1,
		finalizing: false,
		cpuVerdict: "gone",
		lastActivityAt: 1,
		now: 200_000,
	}).decision, "process-exited");
	assert.equal(classifyWatchdogProbe({
		inTool: false,
		stalled: true,
		stallAction: "notify",
		stallNotifyCount: 0,
		childPid: 1,
		finalizing: false,
		lastActivityAt: 1,
		now: 200_000,
	}).decision, "first-stall-notify");
});

test("child exit snapshot replaces cpu-progress with process-exited", () => {
	const state = createStallDiagnosticsState();
	recordWatchdogDecision(state, "cpu-progress", "tool-quiet-cpu-advancing");
	const changed = noteDiagnosticsChildExit(state, "child-close:0");
	assert.equal(changed, true);
	const snapshot = snapshotStallDiagnostics({
		agentId: "builder",
		runId: "run-1",
		state,
		lastActivityAt: 1_000,
		childPid: 99,
		toolWaitName: "bash",
		cpuVerdict: "working",
	});
	assert.equal(snapshot.exitReason, "child-close:0");
	assert.equal(snapshot.watchdogDecision, "process-exited");
	assert.notEqual(snapshot.watchdogDecision, "cpu-progress");
});

test("finalizing and vanished project exit diagnostics before handle teardown", () => {
	const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	assert.match(source, /function projectChildExitDiagnostics/);
	assert.match(source, /function markAgentFinalizing[\s\S]*?projectChildExitDiagnostics\(/);
	assert.match(source, /function markWorkerInterrupted[\s\S]*?projectChildExitDiagnostics\(/);
	assert.match(source, /function markWorkerInterrupted[\s\S]*?diagnostics: exitSnapshot/);
	assert.match(source, /preferSpecificExitReason/);
	assert.match(source, /finishActiveTool/);
	assert.match(source, /kind:\s*"stalled"[\s\S]*?activity:\s*null[\s\S]*?activityActive:\s*false/);
	assert.doesNotMatch(source, /activity:\s*`auto-aborted after stall/);
	assert.doesNotMatch(source, /activity:\s*lastLine/);
});

test("zero-byte output chunks do not move lastOutputAt or seq", () => {
	const state = createStallDiagnosticsState();
	noteDiagnosticsIo(state, "stdout", 12, 1_000);
	const seq = state.eventSeq;
	const lastOutputAt = state.lastOutputAt;
	noteDiagnosticsIo(state, "stdout", 0, 2_000);
	noteDiagnosticsIo(state, "stderr", 0, 3_000);
	assert.equal(state.eventSeq, seq);
	assert.equal(state.lastOutputAt, lastOutputAt);
	assert.equal(state.lastStdoutAt, 1_000);
});

test("a coded child-close is not overwritten by a generic child-close", () => {
	const state = createStallDiagnosticsState();
	noteDiagnosticsChildExit(state, "child-close:0");
	const seq = state.eventSeq;
	const changed = noteDiagnosticsChildExit(state, "child-close");
	assert.equal(preferSpecificExitReason("child-close:0", "child-close"), "child-close:0");
	assert.equal(changed, false);
	assert.equal(state.exitReason, "child-close:0");
	assert.equal(state.eventSeq, seq);
});

test("finalizing phases do not classify as tool-quiet or cpu-progress", () => {
	const probe = classifyWatchdogProbe({
		inTool: true,
		stalled: false,
		stallAction: "notify",
		stallNotifyCount: 0,
		childPid: 4242,
		finalizing: false,
		finalizationPhase: "verifying",
		cpuVerdict: "working",
		lastActivityAt: 1_000,
		now: 180_000,
	});
	assert.equal(probe.decision, "process-exited");
	assert.match(probe.reason, /child-finalizing/);
	assert.notEqual(probe.decision, "cpu-progress");
	assert.notEqual(probe.decision, "tool-quiet-alive");
});
