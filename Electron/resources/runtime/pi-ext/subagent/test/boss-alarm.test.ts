import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	acknowledgeBossAlarm,
	formatBossAlarmMessage,
	shouldArmBossAlarmForJobState,
} from "../boss-alarm.ts";
import { completionPersistenceState } from "../completion-notification.ts";
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

test("alarm message and terminal-state gate carry the explicit exact-run contract", () => {
	const text = formatBossAlarmMessage({ text: "[subagent-done] ok=false", agentId: "worker-a", runId: "run-a" });
	assert.match(text, /subagent_alarm_ack\(\{agentId:"worker-a", runId:"run-a"/);
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
