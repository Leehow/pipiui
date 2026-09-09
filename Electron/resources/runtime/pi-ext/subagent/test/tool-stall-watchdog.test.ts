import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { decideStallWatchdogAction } from "../runtime-policy.ts";
import { isQuietToolStalled } from "../worker-liveness.ts";
import { LONG_TOOL_NOTICE_MS, claimStallNotification, confirmStallNotification, formatLongToolMessage } from "../stall-notification.ts";
import { classifySupervisorHostAdmission } from "../supervisor/host-seam.ts";
import { SUPERVISOR_SYSTEM_PROMPT } from "../supervisor/session-runtime.ts";

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
	assert.match(source, /abortRunningAgent\(agentId, \{ reportTerminalToSupervisor: true, runId: handle\.runId, abortedBy: "runtime" \}\)/);
	assert.match(source, /createSupervisorOwnedTerminalCloseout/);
	assert.match(source, /LIVENESS_SAMPLE_AFTER_MS/);
});

// --- stall must reach the Boss (2026-09-09) ----------------------------------------------

test("the abort valve counts attempts, so a stall nobody received still ends in an abort", () => {
	const base = { idleMs: 150_000, stallThresholdMs: 120_000, maxNotifies: 3, msSinceLastNotify: 600_000, notifyIntervalMs: 300_000, syncWait: false };
	assert.equal(decideStallWatchdogAction({ ...base, notifyCount: 0, attemptCount: 2 }), "notify");
	assert.equal(decideStallWatchdogAction({ ...base, notifyCount: 0, attemptCount: 3 }), "abort");
	// Attempts also space the retries even when no delivery was confirmed.
	assert.equal(decideStallWatchdogAction({ ...base, notifyCount: 0, attemptCount: 1, msSinceLastNotify: 10_000 }), "ignore");
	// Without attempts the old confirmed-only behaviour is unchanged.
	assert.equal(decideStallWatchdogAction({ ...base, notifyCount: 3 }), "abort");
	// Claiming an attempt records it; confirming counts only real deliveries.
	const handle: { lastStallNotifyAt: number; stallNotifyCount: number; stallAttemptCount?: number } = { lastStallNotifyAt: 0, stallNotifyCount: 0 };
	assert.equal(claimStallNotification(handle, 1_000, 3, 300_000), true);
	confirmStallNotification(handle, false);
	assert.deepEqual([handle.stallAttemptCount, handle.stallNotifyCount], [1, 0]);
	assert.equal(claimStallNotification(handle, 1_000 + 300_000, 3, 300_000), true);
	confirmStallNotification(handle, true);
	assert.deepEqual([handle.stallAttemptCount, handle.stallNotifyCount], [2, 1]);
});

test("a Supervisor decision that woke nobody is absorbed, not accepted", () => {
	assert.equal(classifySupervisorHostAdmission({ outcome: "supervisor", useCurrentPath: false, bossWakes: 0 }), "absorbed");
	assert.equal(classifySupervisorHostAdmission({ outcome: "duplicate", useCurrentPath: false, bossWakes: 0 }), "absorbed");
	assert.equal(classifySupervisorHostAdmission({ outcome: "boss_direct", useCurrentPath: false, bossWakes: 1 }), "accepted");
	assert.equal(classifySupervisorHostAdmission({ outcome: "escalated", useCurrentPath: false, bossWakes: 1 }), "accepted");
	assert.equal(classifySupervisorHostAdmission({ outcome: "pending", useCurrentPath: false }), "pending");
	assert.equal(classifySupervisorHostAdmission({ outcome: "fallback", useCurrentPath: true }), "unhandled");
	const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	// The stall wake treats absorbed as "not delivered" (no notify credit); the heartbeat treats it as handled.
	assert.match(source, /if \(routed === "pending" \|\| routed === "absorbed"\) return false;\s*return deliverStallWakeToBoss\(pi, text\);/);
	assert.match(source, /if \(routed === "accepted" \|\| routed === "absorbed"\) return true;/);
	// The terminal [subagent-blocked] receipt no longer passes through the Supervisor.
	assert.match(source, /void deliverStallWakeToBoss\(pi, formatBlockedMessage\(/);
	// Attempts feed the valve at both watchdog call sites and the Supervisor sequence.
	assert.equal((source.match(/attemptCount: handle\.stallAttemptCount \?\? 0,/g) ?? []).length, 2);
	assert.match(source, /sequence: \(handle\?\.stallAttemptCount \?\? handle\?\.stallNotifyCount \?\? 0\) \+ 1,/);
	// The Supervisor is told what a stall is for.
	assert.match(SUPERVISOR_SYSTEM_PROMPT, /For stall, the Boss holds the brief and the user, and you hold neither: forward the first stall of a run/);
});

test("a measurably busy tool call gets one heads-up after ten minutes, not a stall", () => {
	assert.equal(LONG_TOOL_NOTICE_MS, 600_000);
	const text = formatLongToolMessage({ agentId: "gp-1", runId: "run-9", title: "build it", tool: "bash", forSec: 612, liveness: "cpu +4.2s/30s" });
	assert.match(text, /^\[subagent-long-tool\] agentId=gp-1 runId=run-9 title=build it tool=bash for=612s$/m);
	assert.match(text, /Liveness: cpu \+4\.2s\/30s\./);
	assert.match(text, /subagent_abort\(\{agentId:"gp-1", runId:"run-9"\}\) \(or \/subagent_abort gp-1 run-9\)/);
	const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	assert.match(source, /now - handle\.toolWaitSince >= LONG_TOOL_NOTICE_MS && handle\.longToolNoticedFor !== handle\.toolWaitSince/);
	assert.match(source, /handle\.longToolNoticedFor = handle\.toolWaitSince;\s*void deliverStallWakeToBoss\(pi, formatLongToolMessage\(/);
	// The excusal itself is unchanged: the notice sits before it, never replaces it.
	assert.match(source, /if \(stallInfo\.inTool && !stallInfo\.stalled\) continue;/);
});
