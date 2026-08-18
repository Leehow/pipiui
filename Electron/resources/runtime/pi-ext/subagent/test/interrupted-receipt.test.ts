import test from "node:test";
import assert from "node:assert/strict";

import { formatSubagentInterruptedMessage } from "../done-message.ts";
import { admitSignal, classifyRuntimeSignal } from "../signal-admission.ts";

const base = {
	agentId: "explore-1",
	runId: "run-9",
	name: "explore",
	title: "调查DM顶部变黑原因",
	reason: "process gone after 46s, no result reported",
};

test("a vanished worker's receipt is a terminal [subagent-done], not a heartbeat", () => {
	const text = formatSubagentInterruptedMessage(base);
	assert.equal(classifyRuntimeSignal(text), "done");
	assert.match(text, /^\[subagent-done\] agentId=explore-1 runId=run-9 name=explore ok=false interrupted=true/);
});

test("the last worker's interruption still tells the Boss the wave reached zero", () => {
	// The 2026-08-15 hang: the interrupted worker WAS the only one running, so a
	// heartbeat-classified notice was dropped by admission and the Boss waited forever.
	const text = formatSubagentInterruptedMessage({ ...base, wave: { workers: [] } });
	assert.match(text, /Wave: 0 other workers still running/);
	assert.match(text, /final closeout/);
	assert.match(text, /Do not stay silent waiting for a further event from this worker/);
	// A done receipt is admitted on an idle session without any worker still running.
	assert.equal(
		admitSignal({ kind: "done", activity: "idle", workerRunning: false, alreadyDelivered: false }),
		"send",
	);
});

test("an interruption while siblings run keeps the Boss silent and offers resume/resolve", () => {
	const text = formatSubagentInterruptedMessage({
		...base,
		wave: { workers: [{ agentId: "builder-2", name: "general-purpose", elapsed: "2m10s" }] },
	});
	assert.match(text, /Wave: 1 other worker\(s\) still running \(general-purpose 2m10s\)/);
	assert.match(text, /re-dispatch the same agentId/);
	assert.match(text, /subagent_resolve\(\{agentId:"explore-1", runId:"run-9"\}\)/);
});

test("heartbeat admission still keys off a live worker", () => {
	assert.equal(admitSignal({ kind: "heartbeat", activity: "idle", workerRunning: false }), "drop");
	assert.equal(admitSignal({ kind: "heartbeat", activity: "idle", workerRunning: true }), "send");
});
