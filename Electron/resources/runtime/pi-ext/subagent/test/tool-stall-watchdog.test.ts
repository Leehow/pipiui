import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { decideStallWatchdogAction } from "../runtime-policy.ts";
import { isQuietToolStalled } from "../worker-liveness.ts";
import { LONG_TOOL_NOTICE_MS, claimStallNotification, confirmStallNotification, formatFinalizingMessage, formatLongToolMessage, formatStallAbortReason } from "../stall-notification.ts";
import { admitSignal, classifyRuntimeSignal } from "../signal-admission.ts";
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
	assert.match(source, /abortRunningAgent\(agentId, \{\s*reportTerminalToSupervisor: true,\s*runId: handle\.runId,\s*abortedBy: "runtime",/);
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

// --- the three leftovers (2026-09-09) ----------------------------------------------------

test("run-scoped strikes survive the activity reset, so a flapping worker still terminates", () => {
	const base = { idleMs: 150_000, stallThresholdMs: 120_000, maxNotifies: 3, maxRunStrikes: 6, msSinceLastNotify: 600_000, notifyIntervalMs: 300_000, syncWait: false };
	// The per-stretch counters are zero (a byte of output just reset them) but the run remembers.
	assert.equal(decideStallWatchdogAction({ ...base, notifyCount: 0, attemptCount: 0, runStrikes: 5 }), "notify");
	assert.equal(decideStallWatchdogAction({ ...base, notifyCount: 0, attemptCount: 0, runStrikes: 6 }), "abort");
	// A long healthy run with a couple of quiet stretches is not aborted by the run ceiling.
	assert.equal(decideStallWatchdogAction({ ...base, notifyCount: 0, attemptCount: 0, runStrikes: 2 }), "notify");
	// Omitting the ceiling keeps the previous behaviour exactly.
	assert.equal(decideStallWatchdogAction({ idleMs: 150_000, stallThresholdMs: 120_000, notifyCount: 0, runStrikes: 99, maxNotifies: 3, msSinceLastNotify: 600_000, notifyIntervalMs: 300_000, syncWait: false }), "notify");
	// claim() bumps the run total; activity resets the stretch counters but must not clear it.
	const handle: { lastStallNotifyAt: number; stallNotifyCount: number; stallAttemptCount?: number; stallStrikesTotal?: number } = { lastStallNotifyAt: 0, stallNotifyCount: 0 };
	claimStallNotification(handle, 1_000, 3, 300_000);
	confirmStallNotification(handle, true);
	assert.equal(handle.stallStrikesTotal, 1);
	const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	const reset = source.slice(source.indexOf("function noteAgentActivity("), source.indexOf("/** The worker asked for tools;"));
	assert.match(reset, /handle\.stallAttemptCount = 0;/);
	assert.doesNotMatch(reset, /handle\.stallStrikesTotal = 0;/, "run-scoped strikes must survive an activity reset");
	assert.equal((source.match(/maxRunStrikes: STALL_RUN_STRIKE_MAX,/g) ?? []).length, 2, "both watchdog decision sites consult the run ceiling");
});

test("a foreground worker gets a real grace before the unannounced kill, and the result says why", () => {
	const base = { idleMs: 150_000, stallThresholdMs: 120_000, notifyCount: 0, maxNotifies: 3, msSinceLastNotify: 0, notifyIntervalMs: 300_000, syncWait: true };
	// 120s of silence no longer kills a sync worker; one slow model turn is not a wedge.
	assert.equal(decideStallWatchdogAction({ ...base, syncRecoveryGraceMs: 600_000 }), "ignore");
	assert.equal(decideStallWatchdogAction({ ...base, idleMs: 601_000, syncRecoveryGraceMs: 600_000 }), "abort");
	const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	assert.equal((source.match(/syncRecoveryGraceMs: SYNC_STALL_GRACE_MS,/g) ?? []).length, 2);
	assert.match(source, /const SYNC_STALL_GRACE_MS = envPositiveSecs\("PIPIUI_SYNC_STALL_SECS", 10 \* 60\) \* 1000;/);
	// The abort reason reaches the blocked caller through the result, its only channel.
	assert.match(source, /reason: formatStallAbortReason\(\{/);
	assert.match(source, /if \(abortHandle\?\.abortReason && !currentResult\.errorMessage\) \{\s*currentResult\.errorMessage = abortHandle\.abortReason;/);
	const sync = formatStallAbortReason({ idleSec: 640, syncWait: true, runStrikes: 0, lastLine: "read: src/a.ts" });
	assert.match(sync, /^runtime_stall: aborted because no output for 640s while you waited on it in the foreground\./);
	assert.match(sync, /re-dispatch the same agentId to continue/);
	const flapping = formatStallAbortReason({ idleSec: 130, syncWait: false, runStrikes: 6, lastLine: "(no activity)" });
	assert.match(flapping, /it went quiet 6 times in this run \(last stretch 130s\) without finishing/);
});

test("a wedged closeout is noticed, then forced terminal through the durable receipt channel", () => {
	const notice = formatFinalizingMessage({ agentId: "gp-1", runId: "run-3", title: "ship it", phase: "merging", elapsedSec: 320, forced: false });
	assert.match(notice, /^\[subagent-finalizing\] agentId=gp-1 runId=run-3 title=ship it phase=merging for=320s$/m);
	assert.match(notice, /this is a heads-up, not a stall/);
	assert.match(notice, /Do not re-dispatch this agentId while closeout is in flight/);
	const forced = formatFinalizingMessage({ agentId: "gp-1", runId: "run-3", title: "ship it", phase: "merging", elapsedSec: 960, forced: true });
	assert.match(forced, /recorded the run as interrupted so it stops occupying a worker slot/);
	assert.match(forced, /worktree and branch are NOT cleaned up/);
	// Advisory notices are classified, so they are held during a live turn instead of barging in.
	assert.equal(classifyRuntimeSignal("[subagent-finalizing] agentId=a"), "notice");
	assert.equal(classifyRuntimeSignal("[subagent-long-tool] agentId=a"), "notice");
	assert.equal(admitSignal({ kind: "notice", activity: "busy", workerRunning: true }), "hold");
	assert.equal(admitSignal({ kind: "notice", activity: "idle", workerRunning: true }), "send");
	assert.equal(admitSignal({ kind: "notice", activity: "idle", workerRunning: false }), "drop");
	const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	// The pass runs over finalizing handles only, which every other pass skips.
	assert.match(source, /for \(const \[agentId, handle\] of \[\.\.\.runningAgents\]\) \{\s*if \(!handle\.finalizing\) continue;/);
	assert.match(source, /if \(elapsedMs < FINALIZE_NOTICE_MS\) continue;/);
	// Forcing goes through markWorkerInterrupted (provisional, correctable) and the durable channel.
	assert.match(source, /if \(!markWorkerInterrupted\(agentId, reason\)\) continue;/);
	assert.match(source, /deliverConfirmedDoneToBoss\(pi, agentId, runId, formatFinalizingMessage\(\{[\s\S]*?forced: true,/);
	// The notice fires once per closeout, not once per tick.
	assert.match(source, /if \(handle\.finalizeNoticedAt !== undefined\) continue;\s*handle\.finalizeNoticedAt = now;/);
});
