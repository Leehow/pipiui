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
	deliverStallWake,
	formatBlockedMessage,
	formatStallMessage,
	planHeldSignalFlush,
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

test("index.ts routes stall signals through the extracted helpers", () => {
	// Kept as a cheap wiring check. The behavior these used to pin by regex — channel choice,
	// one-delivery-per-flush, quiet handling, message shape — is covered by the tests below.
	const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	assert.match(source, /from "\.\/stall-notification\.ts"/);
	assert.match(source, /planHeldSignalFlush\(/);
	assert.match(source, /formatStallMessage\(/);
	assert.match(source, /formatBlockedMessage\(/);
});

function sender() {
	const calls: unknown[][] = [];
	return { pi: { sendMessage: (...args: unknown[]) => calls.push(args) }, calls };
}

test("a stall signal takes the wake channel; anything else takes the user-message channel", () => {
	const plan = planHeldSignalFlush({
		held: ["[subagent-stalled] agentId=a"],
		classify: () => "stall",
		admit: () => "send",
	});
	assert.equal(plan.deliver?.channel, "stall-wake");
	assert.equal(plan.deliver?.confirmsStallDelivery, true);

	const blocked = planHeldSignalFlush({
		held: ["[subagent-blocked] agentId=a"],
		classify: () => "blocked",
		admit: () => "send",
	});
	// A blocked signal wakes the same way, but is not the stall whose delivery gets confirmed.
	assert.equal(blocked.deliver?.channel, "stall-wake");
	assert.equal(blocked.deliver?.confirmsStallDelivery, false);

	const other = planHeldSignalFlush({
		held: ["[subagent-done] agentId=a"],
		classify: () => "done",
		admit: () => "send",
	});
	assert.equal(other.deliver?.channel, "user-message");
});

test("one flush delivers at most one signal and re-holds the rest in order", () => {
	const plan = planHeldSignalFlush({
		held: ["first", "second", "third"],
		classify: () => "stall",
		admit: () => "send",
	});
	// Several stalls coming due together must not fire a burst of turns at the Boss.
	assert.equal(plan.deliver?.text, "first");
	assert.deepEqual(plan.rehold, ["second", "third"]);
});

test("held signals come back, dropped and unclassified ones do not", () => {
	const plan = planHeldSignalFlush({
		held: ["keep", "drop-me", "not-a-signal", "also-keep"],
		classify: (text) => (text === "not-a-signal" ? undefined : "stall"),
		admit: ({ text }) => (text === "drop-me" ? "drop" : "hold"),
	});
	assert.equal(plan.deliver, undefined);
	assert.deepEqual(plan.rehold, ["keep", "also-keep"]);
});

test("a duplicate in the held queue is re-held once, not twice", () => {
	const plan = planHeldSignalFlush({
		held: ["same", "same"],
		classify: () => "stall",
		admit: () => "hold",
	});
	assert.deepEqual(plan.rehold, ["same"]);
});

test("the wake never fires while the host asked for quiet, including quiet that lands mid-wait", async () => {
	const before = sender();
	assert.equal(
		await deliverStallWake(before.pi, "[subagent-stalled] a", {
			quiet: () => true,
			waitForCutIn: async () => {},
			admit: () => true,
		}),
		false,
	);
	assert.deepEqual(before.calls, []);

	// Quiet arrives while awaiting the cut-in hold: the second check is what catches it.
	const during = sender();
	let quiet = false;
	assert.equal(
		await deliverStallWake(during.pi, "[subagent-stalled] a", {
			quiet: () => quiet,
			waitForCutIn: async () => { quiet = true; },
			admit: () => true,
		}),
		false,
	);
	assert.deepEqual(during.calls, []);
});

test("the wake respects admission re-checked after the cut-in wait, and uses triggerTurn", async () => {
	const refused = sender();
	assert.equal(
		await deliverStallWake(refused.pi, "[subagent-stalled] a", {
			quiet: () => false,
			waitForCutIn: async () => {},
			admit: () => false,
		}),
		false,
	);
	assert.deepEqual(refused.calls, []);

	const ok = sender();
	assert.equal(
		await deliverStallWake(ok.pi, "[subagent-stalled] a", {
			quiet: () => false,
			waitForCutIn: async () => {},
			admit: () => true,
		}),
		true,
	);
	// The load-bearing negative: this must be the extension-message wake, never a user message,
	// or a settled Boss never starts the turn the stall exists to trigger.
	assert.equal((ok.calls[0]?.[0] as { customType: string }).customType, SUBAGENT_STALL_CUSTOM_TYPE);
	assert.deepEqual(ok.calls[0]?.[1], { triggerTurn: true, deliverAs: "followUp" });
});

test("the wake waits for the cut-in hold before sending", async () => {
	const { pi, calls } = sender();
	const order: string[] = [];
	await deliverStallWake(pi, "[subagent-stalled] a", {
		quiet: () => false,
		waitForCutIn: async () => { order.push("cut-in released"); },
		admit: () => { order.push("admitted"); return true; },
	});
	assert.deepEqual(order, ["cut-in released", "admitted"]);
	assert.equal(calls.length, 1);
});

test("the stall message carries identity, liveness, and the one-of-three instruction", () => {
	const text = formatStallMessage({
		agentId: "research-one",
		title: "recon",
		idleSec: 120,
		lastLine: "grep src",
		inTool: { names: ["read", "grep"], forSec: 45 },
		liveness: "12% cpu over 30s",
	});
	const lines = text.split("\n");
	assert.equal(lines[0], "[subagent-stalled] agentId=research-one title=recon idle=120s in=read+grep for=45s last=grep src");
	assert.equal(lines[1], "Liveness: 12% cpu over 30s.");
	assert.match(text, /choose exactly one/);
	assert.match(text, /subagent_resolve\(\{agentId, runId\}\)/);
});

test("a stall with no tool and no CPU measurement says so rather than omitting the line", () => {
	const text = formatStallMessage({ agentId: "a", title: "t", idleSec: 9, lastLine: "x" });
	const lines = text.split("\n");
	assert.equal(lines[0], "[subagent-stalled] agentId=a title=t idle=9s last=x");
	// "Keep waiting" must always have to answer to a liveness line, even an absent measurement.
	assert.equal(lines[1], "Liveness: no CPU measurement available for this worker.");
});

test("the blocked message states the auto-abort and tells the Boss to confirm terminal state", () => {
	const text = formatBlockedMessage({ agentId: "a", title: "t", idleSec: 300, lastLine: "x" });
	assert.match(text, /^\[subagent-blocked\] agentId=a title=t idle=300s last=x auto-aborted after stall$/m);
	assert.match(text, /Query subagent_status\(\{agentId:"a"\}\) to confirm the terminal state/);
	assert.match(text, /Do not treat this message as a new user request\./);
});
