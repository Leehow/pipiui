import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { admitSignal } from "../signal-admission.ts";
import {
	claimStallNotification,
	confirmStallNotification,
	isStallWakeSignal,
	queueStallAfterCutIn,
	queueStallNotification,
	SUBAGENT_STALL_CUSTOM_TYPE,
	type StallNotifyState,
} from "../stall-notification.ts";

function emptyClaim(): StallNotifyState {
	return { lastStallNotifyAt: 0, stallNotifyCount: 0 };
}

test("settled Boss stall notification triggers a turn", () => {
	const calls: unknown[][] = [];
	const queued = queueStallNotification(
		{ sendMessage: (...args: unknown[]) => calls.push(args) },
		"[subagent-stalled] agentId=research-one title=x idle=120s last=(no activity)",
	);

	assert.equal(queued, true);
	assert.deepEqual(calls, [[
		{
			customType: SUBAGENT_STALL_CUSTOM_TYPE,
			content: "[subagent-stalled] agentId=research-one title=x idle=120s last=(no activity)",
			display: true,
			details: { version: 1 },
		},
		{ triggerTurn: true, deliverAs: "followUp" },
	]]);
});

test("post-stall recovery uses the same triggerTurn wake", () => {
	const calls: unknown[][] = [];
	const queued = queueStallNotification(
		{ sendMessage: (...args: unknown[]) => calls.push(args) },
		"[subagent-blocked] agentId=research-one auto-aborted after stall",
	);
	assert.equal(queued, true);
	assert.deepEqual(calls[0]?.[1], { triggerTurn: true, deliverAs: "followUp" });
	assert.equal(isStallWakeSignal("stall"), true);
	assert.equal(isStallWakeSignal("blocked"), true);
	assert.equal(isStallWakeSignal("heartbeat"), false);
	assert.equal(isStallWakeSignal("done"), false);
});

test("stall notification rejection is reported and does not count as delivered", (t) => {
	t.mock.method(console, "error", () => {});
	const queued = queueStallNotification(
		{ sendMessage: () => { throw new Error("busy"); } },
		"[subagent-stalled] agentId=research-one",
	);
	assert.equal(queued, false);
});

test("stall notify count is confirmed only after a successful enqueue", () => {
	const handle = emptyClaim();
	const max = 3;
	const interval = 300_000;
	const now = 1_000;

	assert.equal(claimStallNotification(handle, now, max, interval), true);
	assert.equal(handle.stallNotifyCount, 0, "claim must not spend the budget");
	assert.equal(handle.lastStallNotifyAt, now);
	assert.equal(handle.stallNotifyInFlight, true);
	assert.equal(claimStallNotification(handle, now + 1, max, interval), false, "in-flight blocks a second claim");

	confirmStallNotification(handle, false);
	assert.equal(handle.stallNotifyCount, 0, "hold/fail must not consume a notify");
	assert.equal(handle.stallNotifyInFlight, false);
	assert.equal(claimStallNotification(handle, now + 1, max, interval), false, "interval still spaces failed attempts");

	assert.equal(claimStallNotification(handle, now + interval, max, interval), true);
	confirmStallNotification(handle, true);
	assert.equal(handle.stallNotifyCount, 1);
	assert.equal(handle.stallNotifyInFlight, false);

	assert.equal(claimStallNotification(handle, now + interval * 2, max, interval), true);
	confirmStallNotification(handle, true);
	assert.equal(claimStallNotification(handle, now + interval * 3, max, interval), true);
	confirmStallNotification(handle, true);
	assert.equal(handle.stallNotifyCount, 3);
	assert.equal(claimStallNotification(handle, now + interval * 4, max, interval), false, "cap is on delivered count");
});

test("busy/quiet admission still holds or drops a live stall before the wake is queued", async () => {
	assert.equal(admitSignal({ kind: "stall", activity: "busy", workerRunning: true }), "hold");
	assert.equal(admitSignal({ kind: "stall", activity: "quiet", workerRunning: true }), "drop");
	assert.equal(admitSignal({ kind: "blocked", activity: "busy" }), "hold");
	assert.equal(admitSignal({ kind: "blocked", activity: "quiet" }), "drop");
	assert.equal(admitSignal({ kind: "stall", activity: "idle", workerRunning: true }), "send");

	const calls: unknown[][] = [];
	const held = await queueStallAfterCutIn(
		{ sendMessage: (...args: unknown[]) => calls.push(args) },
		"[subagent-stalled] agentId=research-one",
		{ waitForCutIn: async () => {}, shouldSend: () => false },
	);
	assert.equal(held, false);
	assert.deepEqual(calls, []);

	const sent = await queueStallAfterCutIn(
		{ sendMessage: (...args: unknown[]) => calls.push(args) },
		"[subagent-stalled] agentId=research-one",
		{ waitForCutIn: async () => {}, shouldSend: () => true },
	);
	assert.equal(sent, true);
	assert.deepEqual(calls[0]?.[1], { triggerTurn: true, deliverAs: "followUp" });
});

test("Electron stall watchdog wakes a settled Boss and confirms count after enqueue", () => {
	const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	assert.match(source, /from "\.\/stall-notification\.ts"/);
	assert.match(source, /queueStallAfterCutIn\(/);
	assert.match(source, /confirmStallNotification\(/);

	const flush = source.slice(
		source.indexOf("function flushHeldRuntimeSignals("),
		source.indexOf("async function deliverStallWake("),
	);
	assert.match(flush, /isStallWakeSignal\(kind\)/);
	assert.match(flush, /deliverStallWake\(/);

	const wake = source.slice(
		source.indexOf("async function deliverStallWake("),
		source.indexOf("function logDonePersistenceFailure("),
	);
	assert.match(wake, /admitOrHoldRuntimeSignal\(text\)/);
	assert.match(wake, /queueStallAfterCutIn\(/);
	assert.doesNotMatch(wake, /trySendUserMessage|sendUserMessage/);

	const watchdog = source.slice(
		source.indexOf("// (3) stall 推送 / 复推 / 预裁决 abort"),
		source.indexOf("// (4) wall-clock check-in:"),
	);
	assert.match(watchdog, /deliverStallWake\(/);
	assert.match(watchdog, /confirmStallNotification\(handle, ok\)/);
	assert.match(watchdog, /\[subagent-blocked\].*auto-aborted after stall/);
	assert.doesNotMatch(watchdog, /deliverSubagentDone\(/);
	assert.doesNotMatch(watchdog, /trySendUserMessage|sendUserMessage/);
});
