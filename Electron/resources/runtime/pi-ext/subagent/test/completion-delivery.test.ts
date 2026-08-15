import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	completionObservation,
	completionObservationMatches,
	completionPersistenceState,
	queueCompletionAfterCutIn,
	queueCompletionNotification,
} from "../completion-notification.ts";
import { deliveryRetryDue, DeliveryObligationStore } from "../delivery-obligation.ts";

test("completion notification is a quiet exact-run custom message that wakes the Boss", () => {
	const calls: unknown[][] = [];
	const queued = queueCompletionNotification(
		{ sendMessage: (...args: unknown[]) => calls.push(args) },
		{
			sessionId: "session-a",
			agentId: "research-one",
			runId: "run-42",
			obligationId: "obligation-42",
			text: "[subagent-done] exact result",
		},
	);

	assert.equal(queued, true);
	assert.deepEqual(calls, [[
		{
			customType: "pipiui-subagent-complete-v1",
			content: "[subagent-done] exact result",
			display: false,
			details: {
				version: 1,
				sessionId: "session-a",
				agentId: "research-one",
				runId: "run-42",
				obligationId: "obligation-42",
			},
		},
		{ triggerTurn: true, deliverAs: "followUp" },
	]]);
});

test("completion notification rejection is reported for persisted retry", (t) => {
	t.mock.method(console, "error", () => {});
	const queued = queueCompletionNotification(
		{ sendMessage: () => { throw new Error("busy"); } },
		{
			sessionId: "session-a",
			agentId: "research-one",
			runId: "run-42",
			obligationId: "obligation-42",
			text: "done",
		},
	);
	assert.equal(queued, false);
});

test("fire-and-forget harness does not acknowledge before post-message_end persistence", async (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pipiui-completion-fire-forget-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const store = new DeliveryObligationStore(directory, { routingKey: "session-a" });
	const row = store.create("agent-a", "run-a", "done");
	store.beginAttempt(row.id);
	let liveEvent: unknown;
	const persistedEntries: unknown[] = [];
	const input = { sessionId: "session-a", agentId: "agent-a", runId: "run-a", obligationId: row.id, text: "done" };
	const queued = queueCompletionNotification({
		sendMessage(message) {
			queueMicrotask(() => {
				liveEvent = { role: "custom", ...message };
				queueMicrotask(() => persistedEntries.push({ type: "custom_message", ...message }));
			});
		},
	}, input);
	assert.equal(queued, true);
	assert.equal(store.finishAttempt(row.id, queued)?.state, "queued");
	assert.deepEqual(persistedEntries, []);

	await Promise.resolve();
	assert.equal(completionObservationMatches(completionObservation(liveEvent)!, input), true);
	assert.deepEqual(persistedEntries, [], "live message_end fires before SessionManager persistence");
	assert.equal(store.read(row.id)?.state, "queued");

	await Promise.resolve();
	const persisted = completionObservation(persistedEntries[0]);
	assert.equal(persisted && completionObservationMatches(persisted, input), true);
	assert.equal(store.markObserved(row.id)?.state, "observed");
});

test("fire-and-forget enqueue remains recoverable through exact persisted observation", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pipiui-completion-delivery-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	let now = 1_000;
	const first = new DeliveryObligationStore(directory, {
		routingKey: "session-a",
		now: () => now,
		pid: 101,
		ownerToken: "first-owner",
		processAlive: () => false,
	});
	const pending = first.create("research-one", "run-42", "done");
	assert.equal(pending.state, "pending");
	assert.equal(first.beginAttempt(pending.id)?.state, "attempting");

	now += 180_000;
	const restarted = new DeliveryObligationStore(directory, {
		routingKey: "session-a",
		now: () => now,
		pid: 202,
		ownerToken: "second-owner",
		processAlive: () => false,
	});
	assert.deepEqual(restarted.recoverable().map(({ record }) => record.id), [pending.id]);
	assert.equal(restarted.beginAttempt(pending.id)?.attempts, 2);
	assert.equal(restarted.finishAttempt(pending.id, true)?.state, "queued");
	assert.deepEqual(restarted.recoverable().map(({ record }) => record.id), [pending.id]);
	assert.equal(restarted.markObserved(pending.id)?.state, "observed");
	assert.deepEqual(restarted.recoverable().map(({ record }) => record.id), [pending.id]);
});

test("obligation identity dedupes one logical run even if callback text changes", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pipiui-completion-dedupe-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const store = new DeliveryObligationStore(directory, { routingKey: "session-a" });
	const first = store.create("research-one", "run-42", "first formatting");
	const duplicate = store.create("research-one", "run-42", "different retry formatting");
	const nextRun = store.create("research-one", "run-43", "first formatting");

	assert.equal(duplicate.id, first.id);
	assert.equal(duplicate.text, "first formatting");
	assert.notEqual(nextRun.id, first.id);
});

test("an exhausted failure remains a dedupe tombstone across duplicate callbacks", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pipiui-completion-exhausted-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const store = new DeliveryObligationStore(directory, { routingKey: "session-a", maxAttempts: 1 });
	const row = store.create("research-one", "run-42", "done");
	store.beginAttempt(row.id);
	assert.equal(store.finishAttempt(row.id, false)?.state, "failed");

	const duplicate = store.create("research-one", "run-42", "different callback text");
	assert.equal(duplicate.id, row.id);
	assert.equal(duplicate.attempts, 1);
	assert.equal(store.beginAttempt(row.id), undefined);
});

test("restart treats a legacy delivered row as queued and recoverable", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pipiui-completion-legacy-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const first = new DeliveryObligationStore(directory, { routingKey: "session-a" });
	const row = first.create("research-one", "run-42", "done");
	first.beginAttempt(row.id);
	first.finishAttempt(row.id, true);

	const file = join(directory, `${row.id}.json`);
	const persisted = JSON.parse(readFileSync(file, "utf8")) as { state: string };
	persisted.state = "delivered";
	writeFileSync(file, JSON.stringify(persisted), "utf8");

	const restarted = new DeliveryObligationStore(directory, { routingKey: "session-a" });
	assert.equal(restarted.read(row.id)?.state, "queued");
	assert.deepEqual(restarted.recoverable().map(({ record }) => record.id), [row.id]);
});

test("restart reconciles an exact persisted custom entry before replay", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pipiui-completion-reconcile-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const first = new DeliveryObligationStore(directory, { routingKey: "session-a" });
	const row = first.create("agent-a", "run-a", "done");
	first.beginAttempt(row.id);
	first.finishAttempt(row.id, true);

	const restarted = new DeliveryObligationStore(directory, { routingKey: "session-a" });
	assert.deepEqual(restarted.recoverable().map(({ record }) => record.id), [row.id]);
	const persisted = completionObservation({
		type: "custom_message",
		customType: "pipiui-subagent-complete-v1",
		details: { version: 1, sessionId: "session-a", agentId: "agent-a", runId: "run-a", obligationId: row.id },
	});
	assert.equal(persisted && completionObservationMatches(persisted, {
		sessionId: "session-a", agentId: row.agentId, runId: row.runId, obligationId: row.id,
	}), true);
	restarted.markObserved(row.id);
	assert.deepEqual(restarted.recoverable().map(({ record }) => record.id), [row.id], "custom without a later Boss assistant must replay on restart");
});

test("crash after custom persistence but before Boss assistant replays once on restart", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pipiui-completion-before-assistant-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const first = new DeliveryObligationStore(directory, { routingKey: "session-a", processAlive: () => false });
	const row = first.create("agent-a", "run-a", "done");
	first.beginAttempt(row.id);
	first.finishAttempt(row.id, true);
	const entries = [{
		type: "custom_message",
		customType: "pipiui-subagent-complete-v1",
		details: { version: 1, sessionId: "session-a", agentId: "agent-a", runId: "run-a", obligationId: row.id },
	}];
	assert.equal(completionPersistenceState(entries, {
		sessionId: "session-a", agentId: "agent-a", runId: "run-a", obligationId: row.id,
	}), "observed");
	first.markObserved(row.id);

	const restarted = new DeliveryObligationStore(directory, { routingKey: "session-a", processAlive: () => false });
	assert.deepEqual(restarted.recoverable().map(({ record }) => record.id), [row.id]);
	assert.equal(restarted.beginAttempt(row.id)?.attempts, 2);
	assert.equal(restarted.finishAttempt(row.id, true)?.state, "queued");
});

test("a persisted assistant after the exact custom entry fulfills the obligation", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pipiui-completion-fulfilled-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const store = new DeliveryObligationStore(directory, { routingKey: "session-a" });
	const row = store.create("agent-a", "run-a", "done");
	store.beginAttempt(row.id);
	store.finishAttempt(row.id, true);
	const exact = {
		type: "custom_message",
		customType: "pipiui-subagent-complete-v1",
		details: { version: 1, sessionId: "session-a", agentId: "agent-a", runId: "run-a", obligationId: row.id },
	};
	const entries = [
		{ type: "message", message: { role: "assistant", content: "older", stopReason: "stop" } },
		exact,
		{ type: "message", message: { role: "assistant", content: "Boss summary", stopReason: "stop" } },
	];
	assert.equal(completionPersistenceState(entries, exact.details), "fulfilled");
	assert.equal(store.markFulfilled(row.id)?.state, "fulfilled");
	assert.deepEqual(store.recoverable(), []);
});

test("a sibling branch assistant cannot fulfill the active completion branch", () => {
	const exact = {
		type: "custom_message",
		customType: "pipiui-subagent-complete-v1",
		details: { version: 1, sessionId: "session-a", agentId: "agent-a", runId: "run-a", obligationId: "row-a" },
	};
	const activeBranch = [exact];
	const siblingBranch = [exact, { type: "message", message: { role: "assistant", stopReason: "stop" } }];
	assert.equal(completionPersistenceState(activeBranch, exact.details), "observed");
	assert.equal(completionPersistenceState(siblingBranch, exact.details), "fulfilled");
});

test("the first assistant failure is retryable and later unrelated success cannot fulfill", () => {
	const exact = {
		type: "custom_message",
		customType: "pipiui-subagent-complete-v1",
		details: { version: 1, sessionId: "session-a", agentId: "agent-a", runId: "run-a", obligationId: "row-a" },
	};
	const branch = [
		exact,
		{ type: "message", message: { role: "assistant", stopReason: "error" } },
		{ type: "message", message: { role: "assistant", stopReason: "stop" } },
	];
	assert.equal(completionPersistenceState(branch, exact.details), "retryable");
});

test("toolUse and tool results stay in-flight until the terminal assistant succeeds", () => {
	const exact = {
		type: "custom_message",
		customType: "pipiui-subagent-complete-v1",
		details: { version: 1, sessionId: "session-a", agentId: "agent-a", runId: "run-a", obligationId: "row-a" },
	};
	const branch = [
		exact,
		{ type: "message", message: { role: "assistant", stopReason: "toolUse" } },
		{ type: "message", message: { role: "toolResult", toolCallId: "tool-1" } },
		{ type: "message", message: { role: "assistant", stopReason: "stop" } },
	];
	assert.equal(completionPersistenceState(branch, exact.details), "fulfilled");
});

test("toolUse without a terminal assistant remains observed and cannot wall-clock retry", () => {
	const exact = {
		type: "custom_message",
		customType: "pipiui-subagent-complete-v1",
		details: { version: 1, sessionId: "session-a", agentId: "agent-a", runId: "run-a", obligationId: "row-a" },
	};
	const branch = [exact, { type: "message", message: { role: "assistant", stopReason: "toolUse" } }];
	assert.equal(completionPersistenceState(branch, exact.details), "observed");
	assert.equal(deliveryRetryDue({ state: "observed", attempts: 1, lastAttemptAt: 1_000 }, 601_000, 60_000, 5), false);
});

test("a replay custom starts a new exact attempt whose first success fulfills", () => {
	const exact = {
		type: "custom_message",
		customType: "pipiui-subagent-complete-v1",
		details: { version: 1, sessionId: "session-a", agentId: "agent-a", runId: "run-a", obligationId: "row-a" },
	};
	const branch = [
		exact,
		{ type: "message", message: { role: "assistant", stopReason: "error" } },
		exact,
		{ type: "message", message: { role: "assistant", stopReason: "stop" } },
	];
	assert.equal(completionPersistenceState(branch, exact.details), "fulfilled");
});

test("a failed Boss assistant transitions to bounded retry eligibility", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pipiui-completion-assistant-failed-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	let now = 1_000;
	const store = new DeliveryObligationStore(directory, { routingKey: "session-a", now: () => now });
	const row = store.create("agent-a", "run-a", "done");
	store.beginAttempt(row.id);
	store.finishAttempt(row.id, true);
	store.markObserved(row.id);
	assert.equal(store.markRetryable(row.id)?.state, "failed");
	assert.equal(deliveryRetryDue(store.read(row.id)!, now + 59_999, 60_000, 5), false);
	now += 60_000;
	assert.equal(deliveryRetryDue(store.read(row.id)!, now, 60_000, 5), true);
});

test("routing key isolates sessions even when agentId and runId match", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pipiui-completion-session-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const sessionA = new DeliveryObligationStore(directory, { routingKey: "session-a" });
	const sessionB = new DeliveryObligationStore(directory, { routingKey: "session-b" });
	const rowA = sessionA.create("research-one", "run-42", "done");

	assert.equal(sessionA.read(rowA.id)?.runId, "run-42");
	assert.equal(sessionB.read(rowA.id), undefined);
	const rowB = sessionB.create("research-one", "run-42", "done");
	assert.notEqual(rowA.id, rowB.id);
});

test("only exact custom completion details can acknowledge an obligation", () => {
	const exact = {
		type: "custom_message",
		customType: "pipiui-subagent-complete-v1",
		details: { version: 1, sessionId: "session-a", agentId: "agent-a", runId: "run-a", obligationId: "row-a" },
	};
	assert.deepEqual(completionObservation(exact), exact.details);
	const observed = completionObservation(exact)!;
	assert.equal(completionObservationMatches(observed, exact.details), true);
	assert.equal(completionObservationMatches(observed, { ...exact.details, sessionId: "session-b" }), false);
	assert.equal(completionObservationMatches(observed, { ...exact.details, obligationId: "row-b" }), false);
	assert.equal(completionObservation({ ...exact, customType: "other" }), undefined);
	assert.equal(completionObservation({ ...exact, details: { ...exact.details, obligationId: "" } }), undefined);
});

test("session switch during cut-in prevents enqueue and leaves recovery intact", async () => {
	let session = "session-a";
	let calls = 0;
	const queued = await queueCompletionAfterCutIn(
		{ sendMessage: () => { calls += 1; } },
		{ sessionId: "session-a", agentId: "agent-a", runId: "run-a", obligationId: "row-a", text: "done" },
		{
			async waitForCutIn() { session = "session-b"; },
			currentSessionId: () => session,
		},
	);
	assert.equal(queued, false);
	assert.equal(calls, 0);
});

test("repeated settle events respect one retry interval", () => {
	const record = {
		state: "failed" as const,
		attempts: 1,
		lastAttemptAt: 1_000,
	};
	assert.equal(deliveryRetryDue(record, 1_001, 60_000, 5), false);
	assert.equal(deliveryRetryDue(record, 60_999, 60_000, 5), false);
	assert.equal(deliveryRetryDue(record, 61_000, 60_000, 5), true);
	assert.equal(deliveryRetryDue({ ...record, attempts: 5 }, 100_000, 60_000, 5), false);
	assert.equal(deliveryRetryDue({ ...record, state: "observed" }, 100_000, 60_000, 5), false);
});

test("a long Boss turn never requeues the same live-process followUp, but restart replays once", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pipiui-completion-long-turn-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	let now = 1_000;
	const live = new DeliveryObligationStore(directory, {
		routingKey: "session-a", now: () => now, pid: 101, ownerToken: "live", processAlive: () => false,
	});
	const row = live.create("agent-a", "run-a", "done");
	live.beginAttempt(row.id);
	const queued = live.finishAttempt(row.id, true)!;
	assert.equal(queued.state, "queued");
	for (const elapsed of [60_000, 120_000, 300_000, 600_000]) {
		now = queued.lastAttemptAt + elapsed;
		assert.equal(deliveryRetryDue(queued, now, 60_000, 5), false);
		assert.equal(live.read(row.id)?.attempts, 1);
	}

	const restarted = new DeliveryObligationStore(directory, {
		routingKey: "session-a", now: () => now, pid: 202, ownerToken: "restart", processAlive: () => false,
	});
	assert.deepEqual(restarted.recoverable().map(({ record }) => record.id), [row.id]);
	assert.equal(restarted.beginAttempt(row.id)?.attempts, 2, "session_start recovery replays exactly once");
	assert.equal(restarted.finishAttempt(row.id, true)?.state, "queued");
	assert.equal(deliveryRetryDue(restarted.read(row.id)!, now + 600_000, 60_000, 5), false);
	assert.equal(restarted.markObserved(row.id)?.state, "observed");
	assert.deepEqual(restarted.recoverable().map(({ record }) => record.id), [row.id]);
	assert.equal(restarted.markFulfilled(row.id)?.state, "fulfilled");
	assert.deepEqual(restarted.recoverable(), []);
});

test("runtime finalizes status before using the custom completion channel", () => {
	const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	const sender = source.slice(
		source.indexOf("function sendDoneWithConfirmation("),
		source.indexOf("function deliverConfirmedDone("),
	);
	assert.match(sender, /queueCompletionAfterCutIn\([\s\S]*?pi,/);
	assert.doesNotMatch(sender, /trySendUserMessage|sendUserMessage/);

	const notify = source.slice(
		source.indexOf("function notifySubagentDone("),
		source.indexOf("function truncateParallelOutput("),
	);
	assert.ok(notify.indexOf("ensureJobTerminalFromResult") < notify.indexOf("deliverConfirmedDone"));
	assert.match(source, /pi\.on\("message_end"[\s\S]*?setTimeout\([\s\S]*?sessionManager\.getBranch\(\)/);
	assert.doesNotMatch(source.slice(source.indexOf('pi.on("session_start"'), source.indexOf("registerSessionRecallTool")), /sessionManager\.getEntries\(\)/);
	assert.match(source, /retryPendingDoneAfterSessionSettled[\s\S]*?deliveryRetryDue\(/);
	assert.match(source, /const existing = pendingDone\.get\(obligation\.id\);[\s\S]*?deliveryRetryDue\(\s*existing\.obligation/);
});
