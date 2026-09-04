import test from "node:test";
import assert from "node:assert/strict";

import {
	ALARM_MAX_WAKE_ATTEMPTS,
	alarmRetryDue,
	alarmWakeExhausted,
	formatUnacknowledgedAlarmLines,
} from "../delivery-obligation.ts";

const armed = {
	acknowledgementRequired: true,
	state: "observed" as const,
	attempts: 1,
	lastAttemptAt: 0,
	alarmId: "market-package.1",
	agentId: "market-package",
	runId: "run-1",
};

test("an armed alarm keeps waking the Boss inside its budget", () => {
	const now = 10 * 60_000;
	for (let attempts = 1; attempts < ALARM_MAX_WAKE_ATTEMPTS; attempts += 1) {
		assert.equal(alarmRetryDue({ ...armed, attempts }, now), true, `attempt ${attempts}`);
	}
});

test("it goes quiet once the budget is spent", () => {
	const now = 10 * 60_000;
	assert.equal(alarmRetryDue({ ...armed, attempts: ALARM_MAX_WAKE_ATTEMPTS }, now), false);
	assert.equal(alarmRetryDue({ ...armed, attempts: ALARM_MAX_WAKE_ATTEMPTS + 3 }, now), false);
});

test("going quiet is not being handled: the row stays unacknowledged", () => {
	assert.equal(alarmWakeExhausted({ ...armed, attempts: ALARM_MAX_WAKE_ATTEMPTS }), true);
	assert.equal(alarmWakeExhausted({ ...armed, attempts: 2 }), false);
	// An answered alarm is finished, not exhausted.
	assert.equal(
		alarmWakeExhausted({ ...armed, state: "acknowledged", attempts: 99 }),
		false,
	);
	// A non-armed obligation has no wake budget to spend.
	assert.equal(
		alarmWakeExhausted({ ...armed, acknowledgementRequired: false, attempts: 99 }),
		false,
	);
});

test("the cadence still applies below the ceiling", () => {
	// Second repeat is due after 2m, not before.
	assert.equal(alarmRetryDue({ ...armed, attempts: 2, lastAttemptAt: 0 }, 119_000), false);
	assert.equal(alarmRetryDue({ ...armed, attempts: 2, lastAttemptAt: 0 }, 120_000), true);
});

test("status keeps a quiet alarm findable, and says it will not repeat", () => {
	const lines = formatUnacknowledgedAlarmLines([
		{ ...armed, attempts: ALARM_MAX_WAKE_ATTEMPTS },
		{ ...armed, agentId: "client-overlay", alarmId: "client-overlay.1", attempts: 2 },
	]);
	assert.match(lines[0], /2 Boss alarm\(s\) still unacknowledged/);
	assert.match(lines[1], /market-package alarmId=market-package\.1 \(no longer re-waking you/);
	assert.match(lines[1], /subagent_alarm_ack\(\{alarmId:"market-package\.1"\}\)/);
	// The one still inside its budget must not claim it went quiet.
	assert.equal(/no longer re-waking/.test(lines[2]), false);
});

test("nothing armed or everything answered renders no section", () => {
	assert.deepEqual(formatUnacknowledgedAlarmLines([]), []);
	assert.deepEqual(formatUnacknowledgedAlarmLines([{ ...armed, state: "acknowledged" }]), []);
	assert.deepEqual(formatUnacknowledgedAlarmLines([{ ...armed, acknowledgementRequired: false }]), []);
});
