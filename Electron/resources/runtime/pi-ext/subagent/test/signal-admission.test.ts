import test from "node:test";
import assert from "node:assert/strict";

import {
	admitSignal,
	classifyRuntimeSignal,
	sessionActivity,
	runtimeSignalKey,
	watchSignalIdentity,
} from "../signal-admission.ts";

test("watch samples use busy/quiet admission and coalesce only the same exact run", () => {
	const sample = (agentId: string, runId: string, seq: number) => `[subagent-watch] ${agentId} (Map title) — state=running\nrunId=${runId} seq=${seq}.`;
	const first = sample("maps-baseline", "run-one", 1);
	assert.equal(classifyRuntimeSignal(first), "watch");
	assert.deepEqual(watchSignalIdentity(first), { agentId: "maps-baseline", runId: "run-one" });
	assert.equal(admitSignal({ kind: "watch", activity: "busy", workerRunning: true }), "hold");
	assert.equal(admitSignal({ kind: "watch", activity: "quiet", workerRunning: true }), "drop");
	assert.equal(admitSignal({ kind: "watch", activity: "idle", workerRunning: true }), "send");
	assert.equal(admitSignal({ kind: "watch", activity: "idle", workerRunning: false }), "drop");
	assert.equal(runtimeSignalKey(first), runtimeSignalKey(sample("maps-baseline", "run-one", 11)));
	assert.notEqual(runtimeSignalKey(first), runtimeSignalKey(sample("maps-baseline", "run-two", 11)));
	assert.notEqual(runtimeSignalKey(first), runtimeSignalKey(sample("maps-pdf", "run-one", 11)));
	assert.equal(watchSignalIdentity("[subagent-watch] malformed"), undefined);
	const done = "[subagent-done] agentId=maps-baseline runId=run-one ok=true";
	assert.equal(runtimeSignalKey(done), done, "completion identity/delivery stays unchanged");
});

test("stale stall or heartbeat is dropped even when the session is idle", () => {
	assert.equal(
		admitSignal({ kind: "stall", activity: "idle", workerRunning: false }),
		"drop",
	);
	assert.equal(
		admitSignal({ kind: "heartbeat", activity: "idle", workerRunning: false }),
		"drop",
	);
});

test("a live stall is held during a boss turn and sent only when idle", () => {
	assert.equal(
		admitSignal({ kind: "stall", activity: "busy", workerRunning: true }),
		"hold",
	);
	assert.equal(
		admitSignal({ kind: "stall", activity: "idle", workerRunning: true }),
		"send",
	);
});

test("quiet drops watchdog signals and holds an undelivered done receipt", () => {
	assert.equal(
		admitSignal({ kind: "stall", activity: "quiet", workerRunning: true }),
		"drop",
	);
	assert.equal(
		admitSignal({ kind: "heartbeat", activity: "quiet", workerRunning: true }),
		"drop",
	);
	assert.equal(
		admitSignal({ kind: "reminder", activity: "quiet", episodeOpen: true }),
		"drop",
	);
	assert.equal(
		admitSignal({ kind: "done", activity: "quiet", alreadyDelivered: false }),
		"hold",
	);
});

test("done is held while the boss turn is live so it cannot sit in Pi's follow-up queue", () => {
	assert.equal(
		admitSignal({ kind: "done", activity: "busy", alreadyDelivered: false }),
		"hold",
	);
	assert.equal(
		admitSignal({ kind: "done", activity: "idle", alreadyDelivered: false }),
		"send",
	);
	assert.equal(
		admitSignal({ kind: "done", activity: "idle", alreadyDelivered: true }),
		"drop",
	);
});

test("sessionActivity prefers quiet over a live turn", () => {
	assert.equal(sessionActivity({ quiet: true, busy: true }), "quiet");
	assert.equal(sessionActivity({ quiet: false, busy: true }), "busy");
	assert.equal(sessionActivity({ quiet: false, busy: false }), "idle");
});

test("classifyRuntimeSignal reads the on-the-wire prefixes", () => {
	assert.equal(classifyRuntimeSignal("[subagent-stalled] agentId=settings-list title=x"), "stall");
	assert.equal(classifyRuntimeSignal("[subagent-heartbeat] outstanding=1"), "heartbeat");
	assert.equal(classifyRuntimeSignal("[subagent-done] agentId=a1 ok=true"), "done");
	assert.equal(classifyRuntimeSignal("[subagent-interrupted-reminder] agentId=a1"), "reminder");
	assert.equal(classifyRuntimeSignal("[subagent-blocked] agentId=a1"), "blocked");
	assert.equal(classifyRuntimeSignal("继续"), undefined);
});
