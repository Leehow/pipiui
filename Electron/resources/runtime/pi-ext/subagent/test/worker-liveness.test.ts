import test from "node:test";
import assert from "node:assert/strict";

import {
	classifyCpuProgress,
	formatCpuEvidence,
	parseCpuTime,
	parsePsRows,
	sumSubtreeCpu,
} from "../worker-liveness.ts";

test("parseCpuTime reads every ps TIME shape", () => {
	assert.equal(parseCpuTime("0:03.45"), 3.45);       // macOS MM:SS.ff
	assert.equal(parseCpuTime("00:00:03"), 3);          // Linux HH:MM:SS
	assert.equal(parseCpuTime("2-03:00:00"), 2 * 86_400 + 3 * 3_600);
	assert.equal(parseCpuTime(""), undefined);
	assert.equal(parseCpuTime("garbage"), undefined);
});

test("subtree CPU counts the descendants, because the worker's own pi process is idle", () => {
	// pi(100) is quiet while the bash(200) it spawned and that bash's npm(300) burn CPU.
	const rows = parsePsRows([
		"  100     1   0:01.00",
		"  200   100   0:10.00",
		"  300   200   1:00.00",
		"  400     1   9:99.00",
	].join("\n"));
	assert.deepEqual(sumSubtreeCpu(rows, 100), { seconds: 71, processes: 3 });
	// An unrelated process must not be counted, and a gone subtree reports zero.
	assert.deepEqual(sumSubtreeCpu(rows, 999), { seconds: 0, processes: 0 });
});

test("a ppid cycle cannot spin the walk", () => {
	const rows = parsePsRows(["  100   100   0:01.00", "  200   100   0:02.00", "  100   200   0:01.00"].join("\n"));
	assert.equal(sumSubtreeCpu(rows, 100).processes <= 2, true);
});

test("progress verdicts separate a busy build from a wedge", () => {
	const before = { at: 1_000, seconds: 10, processes: 3 };
	assert.equal(classifyCpuProgress(before, { at: 61_000, seconds: 42, processes: 3 }), "working");
	assert.equal(classifyCpuProgress(before, { at: 61_000, seconds: 10.01, processes: 3 }), "no-progress");
	assert.equal(classifyCpuProgress(before, { at: 61_000, seconds: 10, processes: 0 }), "gone");
	// One sample proves nothing; a delta needs two.
	assert.equal(classifyCpuProgress(undefined, { at: 61_000, seconds: 10, processes: 3 }), "unknown");
});

test("evidence is a measurement, or it says nothing at all", () => {
	const before = { at: 1_000, seconds: 10, processes: 3 };
	const busy = { at: 61_000, seconds: 42.5, processes: 3 };
	assert.equal(formatCpuEvidence("working", before, busy), "busy — CPU +32.5s over last 60s across 3 process(es)");
	assert.match(formatCpuEvidence("no-progress", before, { ...busy, seconds: 10 })!, /^no measurable progress/);
	assert.match(formatCpuEvidence("gone", before, { ...busy, processes: 0 })!, /process tree gone/);
	assert.equal(formatCpuEvidence("unknown", undefined, busy), undefined);
});
