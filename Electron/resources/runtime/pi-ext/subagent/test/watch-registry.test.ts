import test from "node:test";
import assert from "node:assert/strict";

import {
	DEFAULT_WATCH_INTERVAL_SECS,
	MAX_WATCH_RETAINED_SEQUENCES,
	MAX_WATCH_SUBSCRIPTIONS,
	WATCH_ACTIONS,
	WATCH_INTERVAL_MAX_SECS,
	WATCH_INTERVAL_MIN_SECS,
	buildWatchFingerprint,
	createWatchRegistry,
	sanitizeWatchIntervalSecs,
	sanitizeWatchTarget,
} from "../watch-registry.ts";
import type { WatchRegistry, WatchStartResult, WatchSubscriptionView, WatchUpdateResult } from "../watch-registry.ts";

const T0 = 1_000_000;

function subscriptionOf(result: WatchStartResult | WatchUpdateResult): WatchSubscriptionView {
	if (!result.ok) {
		assert.fail(result.problem);
	}
	return (result as { ok: true; subscription: WatchSubscriptionView }).subscription;
}

function problemOf(result: { ok: boolean; problem?: string }): string {
	assert.equal(result.ok, false);
	return result.problem ?? "";
}

test("watch cadence bounds match the shared watchdog window and dispatch heartbeat bounds", () => {
	assert.deepEqual([...WATCH_ACTIONS], ["start", "update", "stop", "list"]);
	assert.equal(WATCH_INTERVAL_MIN_SECS, 30);
	assert.equal(WATCH_INTERVAL_MAX_SECS, 3600);
	assert.equal(DEFAULT_WATCH_INTERVAL_SECS, 60);
	assert.deepEqual(sanitizeWatchIntervalSecs(undefined), { secs: DEFAULT_WATCH_INTERVAL_SECS });
	assert.deepEqual(sanitizeWatchIntervalSecs(30), { secs: 30 });
	assert.deepEqual(sanitizeWatchIntervalSecs(3600), { secs: 3600 });
	for (const bad of [29, 3601, 30.5, Number.NaN]) {
		const result = sanitizeWatchIntervalSecs(bad);
		assert.match(("problem" in result && result.problem) || "", /intervalSecs/);
	}
	assert.deepEqual(sanitizeWatchTarget("  quota-pill ", " run-1 "), { value: { agentId: "quota-pill", runId: "run-1" } });
	const blankAgent = sanitizeWatchTarget("   ", "r");
	assert.match(("problem" in blankAgent && blankAgent.problem) || "", /agentId/);
	const blankRun = sanitizeWatchTarget("a", "");
	assert.match(("problem" in blankRun && blankRun.problem) || "", /runId/);
});

test("start establishes the baseline and arms the cadence; the first unchanged tick stays silent", () => {
	const registry = createWatchRegistry();
	const started = subscriptionOf(registry.start({
		agentId: "quota-pill",
		runId: "run-a",
		now: T0,
		fingerprint: buildWatchFingerprint({ state: "running", phase: "generating" }),
	}));
	assert.equal(started.intervalSecs, DEFAULT_WATCH_INTERVAL_SECS);
	assert.equal(started.nextSampleAt, T0 + DEFAULT_WATCH_INTERVAL_SECS * 1000);
	assert.equal(started.startedAt, T0);
	assert.equal(started.lastEventSeq, 0);
	assert.equal(started.inFlight, false);
	assert.equal(started.pendingChange, false);
	assert.equal(registry.size, 1);

	assert.deepEqual(
		registry.tick({ now: T0 + 60_000, observe: () => buildWatchFingerprint({ state: "running", phase: "generating" }) }),
		[],
	);
	assert.equal(subscriptionOf(registry.update({ agentId: "quota-pill", runId: "run-a", now: T0 + 60_000 })).lastEventSeq, 0);
});

test("duplicate start for the same exact run re-arms and re-baselines without rewinding the sequence", () => {
	const registry = createWatchRegistry();
	registry.start({ agentId: "w", runId: "r1", now: T0, fingerprint: "phase=generating" });
	const events = registry.tick({ now: T0 + 60_000, observe: () => "phase=tool-active" });
	assert.equal(events.length, 1);

	const again = registry.start({ agentId: "w", runId: "r1", now: T0 + 90_000, fingerprint: "phase=tool-active", intervalSecs: 30 });
	assert.equal(again.ok, true);
	if (!again.ok) return;
	assert.equal(again.created, false);
	assert.equal(again.subscription.intervalSecs, 30);
	assert.equal(again.subscription.nextSampleAt, T0 + 90_000 + 30_000);
	assert.equal(again.subscription.lastEventSeq, 1);
	assert.equal(again.subscription.inFlight, true);

	// The fresh baseline suppresses the next tick even though the phase changed
	// relative to the pre-restart observation.
	assert.deepEqual(registry.tick({ now: T0 + 120_000, observe: () => "phase=tool-active" }), []);
});

test("start rejects invalid identity and cadence and enforces the subscription cap", () => {
	const registry = createWatchRegistry();
	assert.match(problemOf(registry.start({ agentId: " ", runId: "r", now: T0, fingerprint: "x" })), /agentId/);
	assert.match(problemOf(registry.start({ agentId: "w", runId: "", now: T0, fingerprint: "x" })), /runId/);
	assert.match(problemOf(registry.start({ agentId: "w", runId: "r", now: T0, fingerprint: "x", intervalSecs: 29 })), /intervalSecs/);

	for (let index = 0; index < MAX_WATCH_SUBSCRIPTIONS; index += 1) {
		const started = registry.start({ agentId: `agent-${index}`, runId: "r", now: T0, fingerprint: "x" });
		assert.equal(started.ok, true);
	}
	assert.match(
		problemOf(registry.start({ agentId: "overflow", runId: "r", now: T0, fingerprint: "x" })),
		/cap reached \(128\)/,
	);
	// An existing subscription may still re-start at the cap, and stopping one
	// run frees its slot.
	const reStarted = registry.start({ agentId: "agent-0", runId: "r", now: T0 + 1, fingerprint: "x" });
	assert.ok(reStarted.ok);
	if (reStarted.ok) assert.equal(reStarted.created, false);
	assert.deepEqual(registry.stop({ agentId: "agent-0", runId: "r" }), { removed: true });
	const freed = registry.start({ agentId: "overflow", runId: "r", now: T0 + 2, fingerprint: "x" });
	assert.ok(freed.ok);
	if (freed.ok) assert.equal(freed.created, true);
});

test("update re-arms the cadence and never switches identity, baseline, or receipt sequence", () => {
	const registry = createWatchRegistry();
	registry.start({ agentId: "w", runId: "r1", now: T0, fingerprint: "state=running" });

	registry.update({ agentId: "w", runId: "r1", now: T0 + 1_000, intervalSecs: 3600 });
	assert.equal(registry.list({ agentId: "w", runId: "r1" })[0]?.nextSampleAt, T0 + 1_000 + 3_600_000);
	// Omitting intervalSecs re-arms on the existing cadence.
	registry.update({ agentId: "w", runId: "r1", now: T0 + 2_000 });
	assert.equal(registry.list({ agentId: "w", runId: "r1" })[0]?.nextSampleAt, T0 + 2_000 + 3_600_000);
	registry.update({ agentId: "w", runId: "r1", now: T0 + 3_000, intervalSecs: 30 });
	assert.equal(registry.list({ agentId: "w", runId: "r1" })[0]?.intervalSecs, 30);
	assert.equal(registry.list({ agentId: "w", runId: "r1" })[0]?.nextSampleAt, T0 + 3_000 + 30_000);

	// A rejected update leaves the subscription untouched.
	assert.match(problemOf(registry.update({ agentId: "w", runId: "r1", now: T0 + 4_000, intervalSecs: 3601 })), /intervalSecs/);
	assert.equal(registry.list({ agentId: "w", runId: "r1" })[0]?.intervalSecs, 30);

	// Identity cannot be switched: a different runId is a different key.
	assert.match(problemOf(registry.update({ agentId: "w", runId: "r2", now: T0 + 5_000 })), /No watch subscription for agentId=w runId=r2/);
	assert.equal(registry.size, 1);

	// Baseline untouched: the first due tick after the re-arm still sees the
	// original fingerprint as the baseline and emits on change.
	const events = registry.tick({ now: T0 + 33_000, observe: () => "state=stalled" });
	assert.deepEqual(events, [{ agentId: "w", runId: "r1", sequence: 1, fingerprint: "state=stalled" }]);
});

test("stop removes only the exact run and repeated stop is an idempotent no-op", () => {
	const registry = createWatchRegistry();
	registry.start({ agentId: "w", runId: "r1", now: T0, fingerprint: "a" });
	registry.start({ agentId: "w", runId: "r2", now: T0, fingerprint: "a" });

	assert.deepEqual(registry.stop({ agentId: "w", runId: "nope" }), { removed: false });
	assert.deepEqual(registry.stop({ agentId: " ", runId: "r1" }), { removed: false });
	assert.deepEqual(registry.stop({ agentId: "w", runId: "r1" }), { removed: true });
	assert.deepEqual(registry.stop({ agentId: "w", runId: "r1" }), { removed: false });
	assert.deepEqual(registry.list().map((sub) => sub.runId), ["r2"]);
});

test("list supports all and exact filtering in deterministic order", () => {
	const registry = createWatchRegistry();
	registry.start({ agentId: "c", runId: "b", now: T0, fingerprint: "x" });
	registry.start({ agentId: "a", runId: "z", now: T0, fingerprint: "x" });
	registry.start({ agentId: "a", runId: "y", now: T0, fingerprint: "x" });

	assert.deepEqual(registry.list().map((sub) => `${sub.agentId}/${sub.runId}`), ["a/y", "a/z", "c/b"]);
	assert.deepEqual(registry.list({ agentId: "a", runId: "z" }).map((sub) => sub.runId), ["z"]);
	assert.deepEqual(registry.list({ agentId: "a" }).map((sub) => sub.runId), ["y", "z"]);
	assert.deepEqual(registry.list({ agentId: "missing" }), []);
	assert.deepEqual(registry.list({ agentId: "a", runId: "missing" }), []);
});

test("only due subscriptions sample; missed intervals never burst", () => {
	const registry: WatchRegistry = createWatchRegistry();
	registry.start({ agentId: "w", runId: "fast", now: T0, fingerprint: "same", intervalSecs: 30 });
	registry.start({ agentId: "w", runId: "slow", now: T0, fingerprint: "same", intervalSecs: 3600 });

	const sampled: string[] = [];
	const observe = (target: { agentId: string; runId: string }): string => {
		sampled.push(target.runId);
		return "same";
	};

	assert.deepEqual(registry.tick({ now: T0 + 29_999, observe }), []);
	assert.deepEqual(sampled, []);

	assert.deepEqual(registry.tick({ now: T0 + 30_000, observe }), []);
	assert.deepEqual(sampled, ["fast"]);

	// ~119 fast intervals were missed: exactly one sample each, no catch-up.
	assert.deepEqual(registry.tick({ now: T0 + 30_000 + 3_600_000, observe }), []);
	assert.deepEqual(sampled, ["fast", "fast", "slow"]);
	assert.deepEqual(
		registry.list({ agentId: "w", runId: "fast" }).map((sub) => sub.nextSampleAt),
		[T0 + 30_000 + 3_600_000 + 30_000],
	);
});

test("changed snapshots emit exactly one bounded event; unchanged ticks emit nothing", () => {
	const registry = createWatchRegistry();
	registry.start({ agentId: "w", runId: "r1", now: T0, fingerprint: "state=running phase=generating" });

	assert.deepEqual(registry.tick({ now: T0 + 60_000, observe: () => "state=running phase=generating" }), []);
	const events = registry.tick({ now: T0 + 120_000, observe: () => "state=running phase=tool-active" });
	assert.deepEqual(events, [{ agentId: "w", runId: "r1", sequence: 1, fingerprint: "state=running phase=tool-active" }]);

	// Emission re-armed the cadence: an immediate follow-up tick is not due.
	assert.deepEqual(registry.tick({ now: T0 + 120_001, observe: () => "state=running phase=verifying" }), []);

	// Still in flight: later changes coalesce into the single pending slot.
	assert.deepEqual(registry.tick({ now: T0 + 180_000, observe: () => "state=running phase=verifying" }), []);
	let view = registry.list({ agentId: "w", runId: "r1" })[0];
	assert.equal(view?.inFlight, true);
	assert.equal(view?.pendingChange, true);
	assert.equal(view?.lastEventSeq, 1);

	// A third change replaces the pending slot instead of queueing.
	assert.deepEqual(registry.tick({ now: T0 + 240_000, observe: () => "state=running phase=verifying verify=running" }), []);
	view = registry.list({ agentId: "w", runId: "r1" })[0];
	assert.equal(view?.pendingChange, true);
	assert.equal(view?.lastEventSeq, 1);
});

test("ack settles only the exact in-flight sequence and surfaces the coalesced change", () => {
	const registry = createWatchRegistry();
	registry.start({ agentId: "w", runId: "r1", now: T0, fingerprint: "f0" });
	assert.deepEqual(registry.tick({ now: T0 + 60_000, observe: () => "f1" }), [
		{ agentId: "w", runId: "r1", sequence: 1, fingerprint: "f1" },
	]);
	// Coalesce one later change while the first event is still in flight.
	assert.deepEqual(registry.tick({ now: T0 + 120_000, observe: () => "f2" }), []);

	assert.match(problemOf(registry.ack({ agentId: "w", runId: "nope", sequence: 1 })), /No watch subscription/);
	assert.match(problemOf(registry.ack({ agentId: "w", runId: "r1", sequence: 2 })), /sequence=2 is not the in-flight event \(sequence=1\)/);

	const settled = registry.ack({ agentId: "w", runId: "r1", sequence: 1 });
	assert.deepEqual(settled, { ok: true, pending: true });
	assert.match(problemOf(registry.ack({ agentId: "w", runId: "r1", sequence: 1 })), /\(none\)/);
	assert.equal(registry.list({ agentId: "w", runId: "r1" })[0]?.inFlight, false);

	// The pending slot was surfaced by the ack, so the next due tick compares
	// fresh state against the last emitted fingerprint.
	const events = registry.tick({ now: T0 + 180_000, observe: () => "f2" });
	assert.deepEqual(events, [{ agentId: "w", runId: "r1", sequence: 2, fingerprint: "f2" }]);
});

test("a flap back to the last emitted fingerprint emits nothing even after a coalesced change", () => {
	const registry = createWatchRegistry();
	registry.start({ agentId: "w", runId: "r1", now: T0, fingerprint: "A" });
	assert.equal(registry.tick({ now: T0 + 60_000, observe: () => "B" }).length, 1);
	assert.deepEqual(registry.tick({ now: T0 + 120_000, observe: () => "C" }), []);
	assert.deepEqual(registry.ack({ agentId: "w", runId: "r1", sequence: 1 }), { ok: true, pending: true });

	// Current state returned to the last emitted fingerprint: no change, no
	// event, and the stale pending record does not resurrect one.
	assert.deepEqual(registry.tick({ now: T0 + 180_000, observe: () => "B" }), []);
	assert.equal(registry.list({ agentId: "w", runId: "r1" })[0]?.pendingChange, false);
});

test("event sequences are monotonic per exact pair across emissions, acks, and re-starts", () => {
	const registry = createWatchRegistry();
	registry.start({ agentId: "w", runId: "r1", now: T0, fingerprint: "f0" });
	registry.start({ agentId: "w", runId: "r2", now: T0, fingerprint: "f0" });

	let seqs = registry.tick({ now: T0 + 60_000, observe: (target) => (target.runId === "r1" ? "f1" : "f0") }).map((event) => event.sequence);
	assert.deepEqual(seqs, [1]);
	registry.ack({ agentId: "w", runId: "r1", sequence: 1 });

	seqs = registry.tick({ now: T0 + 120_000, observe: (target) => (target.runId === "r1" ? "f2" : "f1") }).map((event) => event.sequence);
	assert.deepEqual(seqs.sort((a, b) => a - b), [1, 2]);
	registry.ack({ agentId: "w", runId: "r1", sequence: 2 });
	registry.ack({ agentId: "w", runId: "r2", sequence: 1 });

	// Duplicate start preserves the pair's receipt cursor.
	registry.start({ agentId: "w", runId: "r1", now: T0 + 180_000, fingerprint: "f2" });
	assert.equal(registry.list({ agentId: "w", runId: "r1" })[0]?.lastEventSeq, 2);
	seqs = registry.tick({ now: T0 + 240_000, observe: (target) => (target.runId === "r1" ? "f3" : "f1") }).map((event) => event.sequence);
	assert.deepEqual(seqs, [3]);
});

test("terminal and stale runs drop their subscriptions via tick observation and prune", () => {
	const registry = createWatchRegistry();
	registry.start({ agentId: "w", runId: "live", now: T0, fingerprint: "same" });
	registry.start({ agentId: "w", runId: "dead", now: T0, fingerprint: "same" });
	registry.start({ agentId: "gone", runId: "r", now: T0, fingerprint: "same" });

	// An undefined observation means the exact run is gone: the subscription is
	// dropped and never emits, while live siblings keep sampling.
	const events = registry.tick({
		now: T0 + 60_000,
		observe: (target) => (target.runId === "dead" || target.agentId === "gone" ? undefined : "same"),
	});
	assert.deepEqual(events, []);
	assert.deepEqual(registry.list().map((sub) => `${sub.agentId}/${sub.runId}`), ["w/live"]);

	assert.deepEqual(registry.prune((target) => target.agentId !== "gone"), []);
	assert.deepEqual(registry.prune((target) => target.runId !== "live"), [{ agentId: "w", runId: "live" }]);
	assert.deepEqual(registry.list(), []);

	registry.start({ agentId: "w", runId: "r1", now: T0, fingerprint: "x" });
	registry.clear();
	assert.equal(registry.size, 0);
	assert.deepEqual(registry.tick({ now: T0 + 60_000, observe: () => "x" }), []);
});

test("sibling runs under one agentId never affect each other", () => {
	const registry = createWatchRegistry();
	registry.start({ agentId: "w", runId: "stale-run", now: T0, fingerprint: "A" });
	registry.start({ agentId: "w", runId: "fresh-run", now: T0, fingerprint: "A" });

	const events = registry.tick({
		now: T0 + 60_000,
		observe: (target) => (target.runId === "stale-run" ? undefined : "B"),
	});
	assert.deepEqual(events, [{ agentId: "w", runId: "fresh-run", sequence: 1, fingerprint: "B" }]);
	assert.deepEqual(registry.list().map((sub) => sub.runId), ["fresh-run"]);

	// Stopping the stale run never touches the fresh one, and vice versa.
	assert.deepEqual(registry.stop({ agentId: "w", runId: "stale-run" }), { removed: false });
	assert.deepEqual(registry.stop({ agentId: "w", runId: "fresh-run" }), { removed: true });
	assert.deepEqual(registry.list(), []);
});

test("buildWatchFingerprint is canonical across key order and skips undefined fields", () => {
	const a = buildWatchFingerprint({ state: "running", phase: "verifying", verify: "passed" });
	const b = buildWatchFingerprint({ verify: "passed", phase: "verifying", state: "running" });
	assert.equal(a, b);
	assert.notEqual(a, buildWatchFingerprint({ phase: "verifying", verify: "passed", state: "running", childAlive: true }));
	assert.notEqual(a, buildWatchFingerprint({ phase: "verifying", verify: "passed" }));
	assert.notEqual(buildWatchFingerprint({ delta: 1 }), buildWatchFingerprint({ delta: 2 }));
	assert.equal(buildWatchFingerprint({ state: undefined, phase: "generating" }), buildWatchFingerprint({ phase: "generating" }));
});

test("stop followed by start preserves sequence monotonicity and avoids receipt collision", () => {
	const registry = createWatchRegistry();
	registry.start({ agentId: "worker-a", runId: "run-1", now: T0, fingerprint: "phase=generating" });

	// Emit event 1 and settle it
	const events1 = registry.tick({ now: T0 + 60_000, observe: () => "phase=tool-active" });
	assert.deepEqual(events1, [{ agentId: "worker-a", runId: "run-1", sequence: 1, fingerprint: "phase=tool-active" }]);
	assert.deepEqual(registry.ack({ agentId: "worker-a", runId: "run-1", sequence: 1 }), { ok: true, pending: false });

	// Stop subscription
	assert.deepEqual(registry.stop({ agentId: "worker-a", runId: "run-1" }), { removed: true });
	assert.equal(registry.size, 0);

	// Start again for the exact same target
	const restarted = subscriptionOf(registry.start({
		agentId: "worker-a",
		runId: "run-1",
		now: T0 + 120_000,
		fingerprint: "phase=tool-active",
	}));
	assert.equal(restarted.lastEventSeq, 1);
	assert.equal(restarted.inFlight, false);
	assert.equal(restarted.pendingChange, false);

	// Unchanged observation stays silent
	assert.deepEqual(registry.tick({ now: T0 + 180_000, observe: () => "phase=tool-active" }), []);

	// Next change emits sequence 2, not sequence 1
	const events2 = registry.tick({ now: T0 + 240_000, observe: () => "phase=verifying" });
	assert.deepEqual(events2, [{ agentId: "worker-a", runId: "run-1", sequence: 2, fingerprint: "phase=verifying" }]);
	assert.deepEqual(registry.ack({ agentId: "worker-a", runId: "run-1", sequence: 2 }), { ok: true, pending: false });
});

test("prune followed by start preserves sequence monotonicity", () => {
	const registry = createWatchRegistry();
	registry.start({ agentId: "worker-b", runId: "run-x", now: T0, fingerprint: "f0" });

	const events1 = registry.tick({ now: T0 + 60_000, observe: () => "f1" });
	assert.deepEqual(events1, [{ agentId: "worker-b", runId: "run-x", sequence: 1, fingerprint: "f1" }]);
	assert.deepEqual(registry.ack({ agentId: "worker-b", runId: "run-x", sequence: 1 }), { ok: true, pending: false });

	// Prune removes the subscription
	const pruned = registry.prune((target) => target.runId !== "run-x");
	assert.deepEqual(pruned, [{ agentId: "worker-b", runId: "run-x" }]);
	assert.equal(registry.size, 0);

	// Restart same target
	const restarted = subscriptionOf(registry.start({
		agentId: "worker-b",
		runId: "run-x",
		now: T0 + 120_000,
		fingerprint: "f1",
	}));
	assert.equal(restarted.lastEventSeq, 1);
	assert.equal(restarted.inFlight, false);

	// Next change emits sequence 2
	const events2 = registry.tick({ now: T0 + 180_000, observe: () => "f2" });
	assert.deepEqual(events2, [{ agentId: "worker-b", runId: "run-x", sequence: 2, fingerprint: "f2" }]);
});

test("stale ack from previous lifecycle never settles a restarted subscription", () => {
	const registry = createWatchRegistry();
	registry.start({ agentId: "worker-c", runId: "run-1", now: T0, fingerprint: "f0" });

	// Emit sequence 1 (in-flight)
	const events1 = registry.tick({ now: T0 + 60_000, observe: () => "f1" });
	assert.deepEqual(events1, [{ agentId: "worker-c", runId: "run-1", sequence: 1, fingerprint: "f1" }]);
	assert.equal(registry.list({ agentId: "worker-c", runId: "run-1" })[0]?.inFlight, true);

	// Stop without acking sequence 1
	registry.stop({ agentId: "worker-c", runId: "run-1" });

	// Late ack while stopped is rejected
	assert.match(problemOf(registry.ack({ agentId: "worker-c", runId: "run-1", sequence: 1 })), /No watch subscription/);

	// Restart target: inFlight must be false and eventSeq retained as 1
	const restarted = subscriptionOf(registry.start({
		agentId: "worker-c",
		runId: "run-1",
		now: T0 + 90_000,
		fingerprint: "f1",
	}));
	assert.equal(restarted.lastEventSeq, 1);
	assert.equal(restarted.inFlight, false);

	// Stale ack for sequence 1 arriving after restart before new emission is rejected
	assert.match(
		problemOf(registry.ack({ agentId: "worker-c", runId: "run-1", sequence: 1 })),
		/sequence=1 is not the in-flight event \(none\)/,
	);
	assert.equal(registry.list({ agentId: "worker-c", runId: "run-1" })[0]?.inFlight, false);

	// New tick emits sequence 2 (inFlightSeq = 2)
	const events2 = registry.tick({ now: T0 + 150_000, observe: () => "f2" });
	assert.deepEqual(events2, [{ agentId: "worker-c", runId: "run-1", sequence: 2, fingerprint: "f2" }]);
	assert.equal(registry.list({ agentId: "worker-c", runId: "run-1" })[0]?.inFlight, true);

	// Stale ack for sequence 1 arriving while sequence 2 is in-flight is rejected
	assert.match(
		problemOf(registry.ack({ agentId: "worker-c", runId: "run-1", sequence: 1 })),
		/sequence=1 is not the in-flight event \(sequence=2\)/,
	);
	assert.equal(registry.list({ agentId: "worker-c", runId: "run-1" })[0]?.inFlight, true);

	// Correct ack for sequence 2 settles properly
	assert.deepEqual(registry.ack({ agentId: "worker-c", runId: "run-1", sequence: 2 }), { ok: true, pending: false });
	assert.equal(registry.list({ agentId: "worker-c", runId: "run-1" })[0]?.inFlight, false);
});

test("sequence monotonicity is strictly preserved across stop, prune, terminal drop, clear, and restarts", () => {
	const registry = createWatchRegistry();

	// 1. Initial start -> tick emits seq 1
	registry.start({ agentId: "w", runId: "r1", now: T0, fingerprint: "f0" });
	assert.deepEqual(
		registry.tick({ now: T0 + 60_000, observe: () => "f1" }),
		[{ agentId: "w", runId: "r1", sequence: 1, fingerprint: "f1" }],
	);
	registry.ack({ agentId: "w", runId: "r1", sequence: 1 });

	// 2. Stop -> restart -> tick emits seq 2
	registry.stop({ agentId: "w", runId: "r1" });
	registry.start({ agentId: "w", runId: "r1", now: T0 + 100_000, fingerprint: "f1" });
	assert.deepEqual(
		registry.tick({ now: T0 + 160_000, observe: () => "f2" }),
		[{ agentId: "w", runId: "r1", sequence: 2, fingerprint: "f2" }],
	);
	registry.ack({ agentId: "w", runId: "r1", sequence: 2 });

	// 3. Prune -> restart -> tick emits seq 3
	registry.prune(() => false);
	registry.start({ agentId: "w", runId: "r1", now: T0 + 200_000, fingerprint: "f2" });
	assert.deepEqual(
		registry.tick({ now: T0 + 260_000, observe: () => "f3" }),
		[{ agentId: "w", runId: "r1", sequence: 3, fingerprint: "f3" }],
	);
	registry.ack({ agentId: "w", runId: "r1", sequence: 3 });

	// 4. Terminal drop via undefined observe -> restart -> tick emits seq 4
	assert.deepEqual(registry.tick({ now: T0 + 320_000, observe: () => undefined }), []);
	assert.equal(registry.size, 0);
	registry.start({ agentId: "w", runId: "r1", now: T0 + 350_000, fingerprint: "f3" });
	assert.deepEqual(
		registry.tick({ now: T0 + 410_000, observe: () => "f4" }),
		[{ agentId: "w", runId: "r1", sequence: 4, fingerprint: "f4" }],
	);
	registry.ack({ agentId: "w", runId: "r1", sequence: 4 });

	// 5. Clear -> restart -> tick emits seq 5
	registry.clear();
	assert.equal(registry.size, 0);
	registry.start({ agentId: "w", runId: "r1", now: T0 + 500_000, fingerprint: "f4" });
	assert.deepEqual(
		registry.tick({ now: T0 + 560_000, observe: () => "f5" }),
		[{ agentId: "w", runId: "r1", sequence: 5, fingerprint: "f5" }],
	);
	registry.ack({ agentId: "w", runId: "r1", sequence: 5 });
});

test("clear and session lifecycle invalidates old epoch while preserving sequence monotonicity", () => {
	const registry = createWatchRegistry();

	// Session 1: start subscription, emit seq 1
	registry.start({ agentId: "worker-d", runId: "run-s1", now: T0, fingerprint: "session1_base" });
	const events1 = registry.tick({ now: T0 + 60_000, observe: () => "session1_change" });
	assert.deepEqual(events1, [{ agentId: "worker-d", runId: "run-s1", sequence: 1, fingerprint: "session1_change" }]);

	// Session shutdown / new session start calls clear()
	registry.clear();
	assert.equal(registry.size, 0);
	assert.deepEqual(registry.list(), []);

	// Stale late ack from session 1 before session 2 starts is rejected
	assert.match(problemOf(registry.ack({ agentId: "worker-d", runId: "run-s1", sequence: 1 })), /No watch subscription/);

	// Session 2 starts subscription for same target
	const startedS2 = subscriptionOf(registry.start({
		agentId: "worker-d",
		runId: "run-s1",
		now: T0 + 100_000,
		fingerprint: "session2_base",
	}));
	assert.equal(startedS2.lastEventSeq, 1);
	assert.equal(startedS2.inFlight, false);

	// Stale late ack from session 1 cannot settle session 2's subscription
	assert.match(
		problemOf(registry.ack({ agentId: "worker-d", runId: "run-s1", sequence: 1 })),
		/sequence=1 is not the in-flight event \(none\)/,
	);

	// Session 2 emits sequence 2
	const events2 = registry.tick({ now: T0 + 160_000, observe: () => "session2_change" });
	assert.deepEqual(events2, [{ agentId: "worker-d", runId: "run-s1", sequence: 2, fingerprint: "session2_change" }]);
	assert.equal(registry.list({ agentId: "worker-d", runId: "run-s1" })[0]?.inFlight, true);

	// Stale late ack from session 1 (seq 1) cannot settle session 2's in-flight event (seq 2)
	assert.match(
		problemOf(registry.ack({ agentId: "worker-d", runId: "run-s1", sequence: 1 })),
		/sequence=1 is not the in-flight event \(sequence=2\)/,
	);
	assert.equal(registry.list({ agentId: "worker-d", runId: "run-s1" })[0]?.inFlight, true);

	// Correct ack for session 2 settles properly
	assert.deepEqual(registry.ack({ agentId: "worker-d", runId: "run-s1", sequence: 2 }), { ok: true, pending: false });
	assert.equal(registry.list({ agentId: "worker-d", runId: "run-s1" })[0]?.inFlight, false);
});

test("retained sequence tombstones enforce bounded memory cap without dropping active subscriptions", () => {
	const registry = createWatchRegistry();

	// Create and emit for an active subscription
	registry.start({ agentId: "active-worker", runId: "live", now: T0, fingerprint: "f0" });
	registry.tick({ now: T0 + 60_000, observe: () => "f1" });
	registry.ack({ agentId: "active-worker", runId: "live", sequence: 1 });

	// Cycle through MAX_WATCH_RETAINED_SEQUENCES + 10 distinct stopped subscriptions
	const count = MAX_WATCH_RETAINED_SEQUENCES + 10;
	for (let i = 0; i < count; i += 1) {
		registry.start({ agentId: `tmp-worker-${i}`, runId: "run-tmp", now: T0, fingerprint: "f0" });
		registry.stop({ agentId: `tmp-worker-${i}`, runId: "run-tmp" });
	}

	// Active subscription was never evicted from sequence memory or subscription map
	assert.equal(registry.list({ agentId: "active-worker", runId: "live" }).length, 1);
	const eventsLive = registry.tick({ now: T0 + 120_000, observe: () => "f2" });
	assert.deepEqual(eventsLive, [{ agentId: "active-worker", runId: "live", sequence: 2, fingerprint: "f2" }]);

	// Recent stopped worker still retains sequence (seq 0 if no emission)
	const recent = subscriptionOf(registry.start({
		agentId: `tmp-worker-${count - 1}`,
		runId: "run-tmp",
		now: T0 + 130_000,
		fingerprint: "f0",
	}));
	assert.equal(recent.lastEventSeq, 0);
});
