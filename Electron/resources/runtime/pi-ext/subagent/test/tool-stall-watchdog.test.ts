import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { decideStallWatchdogAction } from "../runtime-policy.ts";
import { isQuietToolStalled } from "../worker-liveness.ts";

test("a silent tool stall still uses notify then abort/closeout policy", () => {
	const idleMs = 150_000;
	assert.equal(
		isQuietToolStalled({
			quiet: true,
			idleMs,
			stallThresholdMs: 120_000,
			sampleGraceMs: 30_000,
		}),
		true,
		"silent in-tool wait must become stalled so the watchdog can act",
	);
	const base = {
		stallThresholdMs: 120_000,
		maxNotifies: 3,
		notifyIntervalMs: 300_000,
		msSinceLastNotify: 300_000,
		idleMs,
	};
	assert.equal(decideStallWatchdogAction({ ...base, notifyCount: 0, syncWait: false }), "notify");
	assert.equal(decideStallWatchdogAction({ ...base, notifyCount: 3, syncWait: false }), "abort");
	assert.equal(decideStallWatchdogAction({ ...base, notifyCount: 0, syncWait: true }), "abort");
});

test("watchdog stall abort keeps Supervisor terminal closeout wiring", () => {
	const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	assert.match(source, /isQuietToolStalled\(/);
	assert.match(source, /if \(stallInfo\.inTool && !stallInfo\.stalled\) continue;/);
	assert.match(source, /abortRunningAgent\(agentId, \{ reportTerminalToSupervisor: true, runId: handle\.runId \}\)/);
	assert.match(source, /createSupervisorOwnedTerminalCloseout/);
	assert.match(source, /LIVENESS_SAMPLE_AFTER_MS/);
});
