import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	acknowledgeBossAlarm,
	formatBossAlarmMessage,
	shouldArmBossAlarmForJobState,
	VolatileBossAlarmStore,
} from "../boss-alarm.ts";
import { completionPersistenceState, queueCompletionAfterCutIn } from "../completion-notification.ts";
import {
	alarmRetryDue,
	alarmRetryIntervalMs,
	DeliveryObligationStore,
} from "../delivery-obligation.ts";

function tempStore(
	t: TestContext,
	options: ConstructorParameters<typeof DeliveryObligationStore>[1] = {},
): DeliveryObligationStore {
	const directory = mkdtempSync(join(tmpdir(), "pipiui-boss-alarm-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	return new DeliveryObligationStore(directory, { routingKey: "session-a", ...options });
}

function alarm(store: DeliveryObligationStore, agentId = "worker-a", runId = "run-a", text = "done") {
	return store.create(agentId, runId, text, undefined, true);
}

test("a normal Boss assistant response observes but never disarms an exact-run alarm", (t) => {
	let now = 1_000;
	const store = tempStore(t, { now: () => now });
	const row = alarm(store);
	store.beginAttempt(row.id);
	store.finishAttempt(row.id, true);
	const message = {
		type: "custom_message",
		customType: "pipiui-subagent-complete-v1",
		details: { version: 1, sessionId: "session-a", agentId: row.agentId, runId: row.runId, obligationId: row.id },
	};
	assert.equal(completionPersistenceState([
		message,
		{ type: "message", message: { role: "assistant", stopReason: "stop" } },
	], { ...message.details, acknowledgementRequired: true }), "observed");
	const observed = store.markObserved(row.id)!;
	assert.equal(observed.state, "observed");
	assert.equal(alarmRetryDue(observed, now + 59_999), false);
	assert.equal(alarmRetryDue(observed, now + 60_000), true);
});

test("alarm cadence is one minute, two minutes, then five minutes without an attempt cap", () => {
	assert.equal(alarmRetryIntervalMs(1), 60_000);
	assert.equal(alarmRetryIntervalMs(2), 120_000);
	assert.equal(alarmRetryIntervalMs(3), 300_000);
	assert.equal(alarmRetryIntervalMs(400), 300_000);
	assert.equal(alarmRetryDue({ acknowledgementRequired: true, state: "observed", attempts: 400, lastAttemptAt: 1_000 }, 301_000), true);
});

test("exact terminal-run acknowledgement is durable and idempotent", (t) => {
	let now = 1_000;
	const store = tempStore(t, { now: () => now, processAlive: () => false });
	const row = alarm(store);
	const first = acknowledgeBossAlarm(store, {
		agentId: "worker-a",
		runId: "run-a",
		note: "integrated",
		currentJob: { runId: "run-a", state: "ok" },
	});
	assert.equal(first.ok, true);
	assert.equal(first.idempotent, false);
	assert.equal(store.read(row.id)?.state, "acknowledged");

	now += 10_000;
	const restarted = new DeliveryObligationStore(store.directory, {
		routingKey: "session-a",
		now: () => now,
		processAlive: () => false,
	});
	assert.deepEqual(restarted.recoverable(), []);
	const again = acknowledgeBossAlarm(restarted, { agentId: "worker-a", runId: "run-a" });
	assert.equal(again.ok, true);
	assert.equal(again.idempotent, true);
});

test("model-visible alarm identity is a semantic per-agent alias, never the opaque runId", (t) => {
	const store = tempStore(t);
	const first = alarm(store, "quota-pill", "mtfa1b2-3c4d5e6f7a8b");
	const second = alarm(store, "quota-pill", "mtfa1b2-3c4d5e6f7a8c");
	assert.equal(first.alarmId, "quota-pill.1");
	assert.equal(second.alarmId, "quota-pill.2");
	const text = formatBossAlarmMessage({
		text: "[subagent-done] ok=true",
		agentId: first.agentId,
		runId: first.runId,
		alarmId: first.alarmId,
	} as Parameters<typeof formatBossAlarmMessage>[0]);
	assert.match(text, /subagent_alarm_ack\(\{alarmId:"quota-pill\.1"/);
	assert.doesNotMatch(text, /mtfa1b2-3c4d5e6f7a8b/);
	assert.equal(acknowledgeBossAlarm(store, {
		alarmId: "quota-pill.1",
		currentJob: { runId: "mtfa1b2-3c4d5e6f7a8c", state: "running" },
	} as Parameters<typeof acknowledgeBossAlarm>[1]).ok, true);
});

test("persisted history observation can never revive an acknowledged alarm", (t) => {
	const store = tempStore(t);
	const row = alarm(store);
	store.markAcknowledged(row.id, "handled");
	assert.equal(store.markObserved(row.id)?.state, "acknowledged");
	assert.equal(store.markRetryable(row.id)?.state, "acknowledged");
	assert.deepEqual(store.recoverable(), []);
});

test("an exact old run remains acknowledgeable after the agentId is re-dispatched", (t) => {
	const store = tempStore(t);
	const old = alarm(store, "worker-a", "run-old");
	const result = acknowledgeBossAlarm(store, {
		agentId: "worker-a",
		runId: "run-old",
		currentJob: { runId: "run-new", state: "running" },
	});
	assert.equal(result.ok, true);
	assert.equal(store.read(old.id)?.state, "acknowledged");
	assert.equal(acknowledgeBossAlarm(store, {
		agentId: "worker-a",
		runId: "missing-old-run",
		currentJob: { runId: "run-new", state: "running" },
	}).ok, false, "a stale id with no stored exact alarm remains rejected");
});

test("stale, unknown, and still-running acknowledgement cannot silence an alarm", (t) => {
	const store = tempStore(t);
	const row = alarm(store, "worker-a", "run-current");
	assert.equal(acknowledgeBossAlarm(store, {
		agentId: "worker-a",
		runId: "run-old",
		currentJob: { runId: "run-current", state: "ok" },
	}).ok, false);
	assert.equal(acknowledgeBossAlarm(store, { agentId: "missing", runId: "run-x" }).ok, false);
	assert.equal(acknowledgeBossAlarm(store, {
		agentId: "worker-a",
		runId: "run-current",
		currentJob: { runId: "run-current", state: "running" },
	}).ok, false);
	assert.notEqual(store.read(row.id)?.state, "acknowledged");
});

test("unacknowledged alarms survive age and row-cap pruning", (t) => {
	let now = 1_000;
	const store = tempStore(t, { now: () => now, maxRows: 1, maxAgeMs: 10, deliveredRetentionMs: 10 });
	const active = alarm(store, "worker-active", "run-active", "active");
	now += 100;
	const oldAck = alarm(store, "worker-old", "run-old", "old");
	store.markAcknowledged(oldAck.id, "handled");
	now += 100;
	const recent = alarm(store, "worker-new", "run-new", "new");
	assert.equal(store.read(active.id)?.state, "pending");
	assert.equal(store.read(recent.id)?.state, "pending");
	assert.equal(store.read(oldAck.id), undefined);
	assert.deepEqual(store.recoverable().map(({ record }) => record.agentId).sort(), ["worker-active", "worker-new"]);
});

test("hard alarm caps fold overflow into one explicit ackable durable rollup", (t) => {
	let now = 1_000;
	const store = tempStore(t, {
		now: () => now,
		maxUnacknowledgedAlarms: 2,
		maxUnacknowledgedAlarmsPerAgent: 1,
		maxAgeMs: 10,
	});
	const first = alarm(store, "worker-a", "run-a1", "first");
	now += 1;
	const overflowA = alarm(store, "worker-a", "run-a2", "second");
	now += 1;
	const secondExact = alarm(store, "worker-b", "run-b1", "third");
	now += 1;
	const overflowGlobal = alarm(store, "worker-c", "run-c1", "fourth");

	assert.equal(store.read(first.id)?.runId, "run-a1", "old exact alarm is retained");
	assert.equal(overflowA.id, secondExact.id);
	assert.equal(overflowA.id, overflowGlobal.id, "all overflow updates one non-recursive rollup row");
	assert.equal(overflowGlobal.agentId, "alarm-overflow");
	assert.equal(overflowGlobal.runId, "alarm-overflow");
	assert.equal(overflowGlobal.alarmRollup?.count, 3);
	assert.equal(overflowGlobal.alarmRollup?.latestAgentId, "worker-c");
	assert.match(overflowGlobal.alarmRollup?.digest ?? "", /^[a-f0-9]{64}$/);
	assert.match(overflowGlobal.text, /subagent_alarm_ack\(\{alarmId:"alarm-overflow\.1"/);
	assert.equal(readdirSync(store.directory).filter((name) => /^[a-f0-9]{64}\.json$/u.test(name)).length, 2);

	now += 10_000;
	alarm(store, "worker-d", "run-d1", "fifth");
	assert.equal(store.read(first.id)?.state, "pending", "age pruning never drops retained exact alarms");
	const rollup = store.readAlarmEpisode("alarm-overflow", "alarm-overflow")!;
	assert.equal(alarmRetryDue(rollup, rollup.lastAttemptAt + 300_000), true);
	assert.equal(acknowledgeBossAlarm(store, { alarmId: "alarm-overflow.1" }).ok, true);
});

test("legacy fulfilled upgrade refreshes alarm text and payload integrity", (t) => {
	const store = tempStore(t);
	const legacy = store.create("worker-a", "run-a", "old text");
	store.markFulfilled(legacy.id);
	const upgraded = store.create("worker-a", "run-a", "new exact alarm text", undefined, true);
	assert.equal(upgraded.state, "pending");
	assert.equal(upgraded.text, "new exact alarm text");
	assert.notEqual(upgraded.payloadHash, legacy.payloadHash);
	assert.equal(store.read(upgraded.id)?.text, "new exact alarm text");
});

test("volatile persistence fallback has stable identity and remains explicitly acknowledgeable", () => {
	const store = new VolatileBossAlarmStore({ now: () => 1_000 });
	const first = store.create("worker-a", "run-a", "first", "supervisor-escalation");
	const duplicate = store.create("worker-a", "run-a", "updated", "supervisor-escalation");
	assert.equal(duplicate.id, first.id);
	assert.equal(duplicate.text, "updated");
	assert.equal(acknowledgeBossAlarm(store, {
		agentId: "worker-a",
		runId: "run-a",
		currentJob: { runId: "run-a", state: "failed" },
	}).ok, true);
	assert.equal(store.readAlarmEpisode("worker-a", "run-a")?.state, "acknowledged");
});

test("acknowledgement that lands during cut-in wins before enqueue", async () => {
	let armed = true;
	let sends = 0;
	const queued = await queueCompletionAfterCutIn(
		{ sendMessage: () => { sends += 1; } },
		{ sessionId: "session-a", agentId: "worker-a", runId: "run-a", obligationId: "row-a", text: "done" },
		{
			async waitForCutIn() { armed = false; },
			currentSessionId: () => "session-a",
			shouldSend: () => armed,
		},
	);
	assert.equal(queued, false);
	assert.equal(sends, 0);
});

test("acknowledgement during the completion batch window also wins before enqueue", async () => {
	let checks = 0;
	let sends = 0;
	const queued = await queueCompletionAfterCutIn(
		{ sendMessage: () => { sends += 1; } },
		{ sessionId: "session-a", agentId: "worker-a", runId: "run-a", obligationId: "row-a", text: "done" },
		{
			async waitForCutIn() {},
			currentSessionId: () => "session-a",
			shouldSend: () => ++checks === 1,
		},
		{ batchWindowMs: 1 },
	);
	assert.equal(queued, false);
	assert.equal(sends, 0);
	assert.equal(checks, 2);
});

test("alarm message and terminal-state gate carry the explicit semantic alarm contract", () => {
	const text = formatBossAlarmMessage({ text: "[subagent-done] ok=false", agentId: "worker-a", alarmId: "worker-a.1" });
	assert.match(text, /subagent_alarm_ack\(\{alarmId:"worker-a\.1"/);
	assert.doesNotMatch(text, /runId/);
	assert.match(text, /text-only reply does not stop/i);
	for (const state of ["ok", "failed", "aborted", "interrupted"]) {
		assert.equal(shouldArmBossAlarmForJobState(state), true, state);
	}
	assert.equal(shouldArmBossAlarmForJobState("running"), false);
});

test("nested non-Boss delivery keeps the existing assistant-fulfillment contract", (t) => {
	const store = tempStore(t);
	const row = store.create("nested-worker", "nested-run", "done");
	assert.equal(row.acknowledgementRequired, false);
	assert.equal(store.markFulfilled(row.id)?.state, "fulfilled");
});
