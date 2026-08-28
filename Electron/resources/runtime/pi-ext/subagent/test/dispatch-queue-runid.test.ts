import test from "node:test";
import assert from "node:assert/strict";

import {
	DispatchQueueV1,
	formatQueuedDispatches,
	formatQueuedPromptSections,
	type DependencyState,
	type QueuedDispatchV1,
} from "../dispatch-queue.ts";

/**
 * Final-BLOCK fix (semantic-agent-contract): a queued job receives its one-shot runId at
 * acceptance; cancellation is bound to the exact {agentId, runId} pair so a stale holder
 * can never drop a newer queue entry, and the boss-facing text always names the runId.
 *
 * Refill-pointer regression (continuous-worker-refill §9.3/§12.1): the [subagent-blocked]
 * signal carries the fan-out refill scan pointer, and the queue's mechanical scheduling
 * (auto-start on slot release, auto-pump on dependency success, hold on dependency failure,
 * no head-of-line blocking) is unchanged by the new wording.
 */

function makeQueue(limit = 4): DispatchQueueV1 {
	return new DispatchQueueV1({
		limit,
		lookup: () => "unknown",
		notify: () => {},
		now: () => 1_000,
	});
}

function item(agentId: string, runId: string, blockedBy: string[] = ["gate"]): QueuedDispatchV1 {
	return {
		agentId,
		runId,
		role: "general-purpose",
		task: `work for ${agentId}`,
		blockedBy,
		queuedAt: 1_000,
		run: () => new Promise<void>(() => {}),
	};
}

test("queued items carry runId from acceptance and cancel matches the exact pair", () => {
	const q = makeQueue();
	q.enqueueBatch([item("quota-pill", "run-a"), item("doc-panel", "run-b", ["quota-pill", "gate"])]);

	// Wrong runId for a real agentId must not drop anything: a stale holder cannot cancel
	// a newer acceptance, and an unknown pair cancels nothing.
	assert.equal(q.cancel("quota-pill", "run-stale"), false);
	assert.equal(q.cancel("nobody", "run-a"), false);
	assert.equal(q.snapshot().length, 2);

	// Exact pair drops exactly that item; siblings (including dependents) survive.
	assert.equal(q.cancel("quota-pill", "run-a"), true);
	const remaining = q.snapshot().map((entry) => entry.agentId);
	assert.deepEqual(remaining, ["doc-panel"]);

	// The dropped id is gone for good: cancelling the same pair again is a no-op.
	assert.equal(q.cancel("quota-pill", "run-a"), false);
});

test("a re-queued agentId under a new runId is only cancellable by the new runId", () => {
	const q = makeQueue();
	q.enqueueBatch([item("quota-pill", "run-old")]);
	assert.equal(q.cancel("quota-pill", "run-old"), true);
	q.enqueueBatch([item("quota-pill", "run-new")]);
	assert.equal(q.snapshot()[0]?.runId, "run-new");
	// The stale runId from the cancelled acceptance must not touch the new queue entry.
	assert.equal(q.cancel("quota-pill", "run-old"), false);
	assert.equal(q.snapshot().length, 1);
	assert.equal(q.cancel("quota-pill", "run-new"), true);
	assert.equal(q.snapshot().length, 0);
});

test("status and prompt text expose the queued runId for exact abort", () => {
	const q = makeQueue();
	q.enqueueBatch([item("quota-pill", "run-a")]);
	const lines = formatQueuedDispatches(q.snapshot(), 2_000);
	assert.equal(lines.length, 1);
	assert.match(lines[0]!, /agentId=quota-pill runId=run-a /);

	const prompt = formatQueuedPromptSections(q.snapshot()).join("\n");
	assert.match(prompt, /subagent_abort\(\{agentId, runId\}\)/);
});

test("held-item signal names both agentId and runId", () => {
	const notifications: string[] = [];
	const q = new DispatchQueueV1({
		limit: 4,
		lookup: () => "failed",
		notify: (text) => notifications.push(text),
		now: () => 1_000,
	});
	q.enqueueBatch([item("fixer", "run-f", ["gone-dep"])]);
	assert.equal(notifications.length, 1);
	assert.match(notifications[0]!, /\[subagent-blocked\] agentId=fixer/);
	assert.match(notifications[0]!, /subagent_abort\(\{agentId:"fixer", runId:"run-f"\}\)/);
	// Held item stays cancellable by its exact pair.
	assert.equal(q.cancel("fixer", "run-f"), true);
	assert.equal(q.snapshot().length, 0);
});

/** An item that records the moment the queue starts it; never settles on its own. */
function recordingItem(
	agentId: string,
	runId: string,
	started: string[],
	blockedBy: string[] = [],
): QueuedDispatchV1 {
	return {
		agentId,
		runId,
		role: "general-purpose",
		task: `work for ${agentId}`,
		blockedBy,
		queuedAt: 1_000,
		run: () => {
			started.push(agentId);
			return new Promise<void>(() => {});
		},
	};
}

/** A dependency-free item whose terminal state the test controls from outside. */
function gateItem(
	agentId: string,
	runId: string,
	started: string[],
	terminal: Map<string, DependencyState>,
	outcome: DependencyState,
): { item: QueuedDispatchV1; finish: () => void } {
	let settle: () => void = () => {};
	const item: QueuedDispatchV1 = {
		agentId,
		runId,
		role: "general-purpose",
		task: `work for ${agentId}`,
		blockedBy: [],
		queuedAt: 1_000,
		run: () =>
			new Promise<void>((resolve) => {
				started.push(agentId);
				settle = () => {
					terminal.set(agentId, outcome);
					resolve();
				};
			}),
	};
	return { item, finish: () => settle() };
}

const drain = () => new Promise((resolve) => setTimeout(resolve, 0));

test("cross-call pending dependency waits without a false never-dispatched signal", () => {
	const started: string[] = [];
	const notifications: string[] = [];
	let producerPending = true;
	const q = new DispatchQueueV1({
		limit: 4,
		lookup: (agentId) => (agentId === "producer" && producerPending ? "running" : "unknown"),
		notify: (text) => notifications.push(text),
		now: () => 1_000,
	});

	q.enqueueBatch([recordingItem("consumer", "run-c", started, ["producer"])]);
	assert.deepEqual(started, []);
	assert.equal(notifications.length, 0, "an accepting dependency is running-like, never unknown");
	assert.equal(q.snapshot()[0]?.heldReason, undefined);

	// Acceptance succeeds into the ordinary atomic queue registration; no notification was emitted
	// during the cross-call window and the consumer remains dependency-gated.
	producerPending = false;
	q.enqueueBatch([recordingItem("producer", "run-p", started)]);
	assert.deepEqual(started, ["producer"]);
	assert.equal(notifications.length, 0);
});

test("pending acceptance release re-pumps dependents into one genuine held notification", () => {
	const notifications: string[] = [];
	let producerPending = true;
	const q = new DispatchQueueV1({
		limit: 4,
		lookup: (agentId) => (agentId === "producer" && producerPending ? "running" : "unknown"),
		notify: (text) => notifications.push(text),
		now: () => 1_000,
	});
	q.enqueueBatch([item("consumer", "run-c", ["producer"])]);
	assert.equal(notifications.length, 0);

	producerPending = false; // acceptance failed/released before the producer was enqueued
	q.onDependencyStateChanged();
	assert.equal(notifications.length, 1);
	assert.match(notifications[0]!, /dependency producer was never dispatched/);
	assert.equal(q.snapshot()[0]?.heldReason, "dependency producer was never dispatched");
	q.onDependencyStateChanged();
	assert.equal(notifications.length, 1, "re-pumps must not duplicate the held signal");
});

test("a genuinely unknown dependency is held and notified immediately", () => {
	const notifications: string[] = [];
	const q = new DispatchQueueV1({
		limit: 4,
		lookup: () => "unknown",
		notify: (text) => notifications.push(text),
		now: () => 1_000,
	});
	q.enqueueBatch([item("consumer", "run-c", ["missing"])]);
	assert.equal(notifications.length, 1);
	assert.match(notifications[0]!, /dependency missing was never dispatched/);
});

test("[subagent-blocked] signal carries the refill scan pointer after the abort instruction", () => {
	const notifications: string[] = [];
	const q = new DispatchQueueV1({
		limit: 4,
		lookup: () => "failed",
		notify: (text) => notifications.push(text),
		now: () => 1_000,
	});
	q.enqueueBatch([item("fixer", "run-f", ["gone-dep"])]);
	assert.equal(notifications.length, 1);
	assert.match(
		notifications[0]!,
		/Before any wait or final closeout after this event, run the fan-out refill scan\./,
	);
	// The pointer routes the boss only after the dependency/abort decision it already had.
	const text = notifications[0]!;
	assert.ok(text.indexOf("Before any wait") > text.indexOf("subagent_abort("));
});

test("a ready queued item starts by itself once a slot frees up", async () => {
	const started: string[] = [];
	const terminal = new Map<string, DependencyState>();
	const gate = gateItem("alpha", "run-a", started, terminal, "ok");
	const beta = recordingItem("beta", "run-b", started);
	const q = new DispatchQueueV1({
		limit: 1,
		lookup: (id) => terminal.get(id) ?? "unknown",
		notify: () => {},
		now: () => 1_000,
	});
	q.enqueueBatch([gate.item, beta]);
	// limit 1: alpha runs, beta waits purely for a slot.
	assert.deepEqual(started, ["alpha"]);
	assert.equal(q.snapshot().length, 1);

	gate.finish();
	await drain();
	assert.deepEqual(started, ["alpha", "beta"]);
	assert.equal(q.snapshot().length, 0);
});

test("dependency success still auto-pumps its dependent", async () => {
	const started: string[] = [];
	const terminal = new Map<string, DependencyState>();
	const gate = gateItem("gate", "run-g", started, terminal, "ok");
	const dependent = recordingItem("fixer", "run-x", started, ["gate"]);
	const q = new DispatchQueueV1({
		limit: 4,
		lookup: (id) => terminal.get(id) ?? "unknown",
		notify: () => {},
		now: () => 1_000,
	});
	q.enqueueBatch([gate.item, dependent]);
	// While gate runs, its dependent waits; nothing is held.
	assert.deepEqual(started, ["gate"]);
	assert.equal(q.snapshot().length, 1);
	assert.equal(q.snapshot()[0]?.heldReason, undefined);

	gate.finish();
	await drain();
	assert.deepEqual(started, ["gate", "fixer"]);
	assert.equal(q.snapshot().length, 0);
});

test("dependency failure still holds its dependent and notifies exactly once", async () => {
	const started: string[] = [];
	const notifications: string[] = [];
	const terminal = new Map<string, DependencyState>();
	const gate = gateItem("gate", "run-g", started, terminal, "failed");
	const dependent = recordingItem("fixer", "run-x", started, ["gate"]);
	const q = new DispatchQueueV1({
		limit: 4,
		lookup: (id) => terminal.get(id) ?? "unknown",
		notify: (text) => notifications.push(text),
		now: () => 1_000,
	});
	q.enqueueBatch([gate.item, dependent]);
	assert.deepEqual(started, ["gate"]);

	gate.finish();
	await drain();
	// Held: it never ran, stays queued, and produced exactly one blocked signal.
	assert.deepEqual(started, ["gate"]);
	assert.equal(notifications.length, 1);
	assert.match(notifications[0]!, /dependency gate did not succeed/);
	assert.equal(q.snapshot().length, 1);
	assert.equal(q.snapshot()[0]?.heldReason, "dependency gate did not succeed");

	// A later unrelated terminal event must not re-notify or start the held item.
	q.onAgentTerminal("someone-else");
	assert.equal(notifications.length, 1);
	assert.deepEqual(started, ["gate"]);

	// Still exactly-cancellable by its pair while held.
	assert.equal(q.cancel("fixer", "run-x"), true);
	assert.equal(q.snapshot().length, 0);
});

/**
 * Regression (final-review critical): an agentId reservation is a running-like dependency
 * state that lives OUTSIDE this queue, in the extension layer. Whatever releases it must end
 * in a pump, or a dependent whose producer settled, failed, or was exact-aborted keeps
 * waiting on a reservation nobody holds anymore. These two tests model that lifecycle
 * contract around the queue; the seam suite covers the real wiring.
 */
test("releasing a settled producer's reservation repumps its dependent into starting", async () => {
	const started: string[] = [];
	const notifications: string[] = [];
	let producerReserved = true;
	const terminal = new Map<string, DependencyState>([["producer", "ok"]]);
	const q = new DispatchQueueV1({
		limit: 4,
		lookup: (agentId) => {
			// The extension's reservation keeps answering running even after the job went terminal.
			if (agentId === "producer" && producerReserved) return "running";
			return terminal.get(agentId) ?? "unknown";
		},
		notify: (text) => notifications.push(text),
		now: () => 1_000,
	});
	q.enqueueBatch([recordingItem("fixer", "run-x", started, ["producer"])]);
	assert.deepEqual(started, [], "reservation still answers running; the dependent must wait");

	// jobFinalize already pumped while the reservation masked the terminal state; the
	// centralized reservation release (delete first, then re-evaluate) must start the
	// dependent now — not leave it waiting forever.
	producerReserved = false;
	q.onDependencyStateChanged();
	await drain();
	assert.deepEqual(started, ["fixer"]);
	assert.equal(notifications.length, 0, "a satisfied dependency is never a blocked signal");
});

test("dropping an exact queued producer hands its dependent a held signal, not an eternal wait", () => {
	const notifications: string[] = [];
	let producerReserved = true;
	const q = new DispatchQueueV1({
		limit: 4,
		lookup: (agentId) => {
			if (agentId === "producer" && producerReserved) return "running";
			if (agentId === "gate") return "running"; // keeps the producer queued, like a busy slot
			return "unknown";
		},
		notify: (text) => notifications.push(text),
		now: () => 1_000,
	});
	// The producer itself is a queued entry (waiting on gate); the consumer waits on it.
	q.enqueueBatch([item("producer", "run-p"), item("consumer", "run-c", ["producer"])]);
	assert.equal(notifications.length, 0, "a reserved/queued producer is running-like, never unknown");

	// Exact queued abort, in the extension's real order: the queue entry is dropped first
	// (cancel pumps; the reservation still answers running), then the reservation release
	// must re-evaluate the queue against the producer's true post-cancel state.
	assert.equal(q.cancel("producer", "run-p"), true);
	producerReserved = false;
	q.onDependencyStateChanged();
	assert.equal(notifications.length, 1);
	assert.match(notifications[0]!, /dependency producer was never dispatched/);
	assert.equal(q.snapshot()[0]?.heldReason, "dependency producer was never dispatched");
	q.onDependencyStateChanged();
	assert.equal(notifications.length, 1, "re-pumps must not duplicate the held signal");
});

test("a waiting or held head of line does not block later ready items", () => {
	const started: string[] = [];
	const notifications: string[] = [];
	const states = new Map<string, DependencyState>([
		["slow-dep", "running"],
		["dead-dep", "failed"],
	]);
	const q = new DispatchQueueV1({
		limit: 4,
		lookup: (id) => states.get(id) ?? "unknown",
		notify: (text) => notifications.push(text),
		now: () => 1_000,
	});
	const waiting = item("waiter", "run-w", ["slow-dep"]); // head: waiting on a running dep
	const held = item("holder", "run-h", ["dead-dep"]); // second: held on a failed dep
	const ready = recordingItem("runner", "run-r", started);
	q.enqueueBatch([waiting, held, ready]);
	// Head items are skipped, not blocking: the ready item starts in the same pump.
	assert.deepEqual(started, ["runner"]);
	assert.equal(notifications.length, 1);
	assert.equal(q.snapshot().length, 2);
});

/**
 * Regression (acceptance-ownership review): pending dispatch acceptances are multi-owner.
 * Overlapping acceptances of one agentId each hold their own token, so releasing ONE
 * claimant (e.g. a denied duplicate) must never flip the id to unknown — and with it a
 * false "never dispatched" held signal — while another claimant is still pending.
 */
test("releasing one overlapping pending claimant keeps a second claimant running-like", () => {
	const notifications: string[] = [];
	// Models the extension's pendingDispatchAcceptances: one id, two pending tokens.
	const pendingClaimants = new Map<string, number>([["shared", 2]]);
	const q = new DispatchQueueV1({
		limit: 4,
		lookup: (agentId) => (pendingClaimants.get(agentId) ? "running" : "unknown"),
		notify: (text) => notifications.push(text),
		now: () => 1_000,
	});
	q.enqueueBatch([item("consumer", "run-c", ["shared"])]);
	assert.equal(notifications.length, 0, "an overlapping pending acceptance is running-like, never unknown");

	// One claimant denied and released: the OTHER claimant still holds the id, so the
	// dependent keeps waiting — no held signal, no phantom never-dispatched flip.
	pendingClaimants.set("shared", 1);
	q.onDependencyStateChanged();
	assert.equal(notifications.length, 0);
	assert.equal(q.snapshot()[0]?.heldReason, undefined);

	// Only releasing the LAST token (the original claimant denied too) makes the id
	// genuinely unknown — exactly one held signal.
	pendingClaimants.delete("shared");
	q.onDependencyStateChanged();
	assert.equal(notifications.length, 1);
	assert.match(notifications[0]!, /dependency shared was never dispatched/);
	assert.equal(q.snapshot()[0]?.heldReason, "dependency shared was never dispatched");
	q.onDependencyStateChanged();
	assert.equal(notifications.length, 1, "re-pumps must not duplicate the held signal");
});
