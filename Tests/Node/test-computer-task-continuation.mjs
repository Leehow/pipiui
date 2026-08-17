import assert from "node:assert/strict";
import test from "node:test";

import {
	COMPUTER_TASK_CONTINUATION_TIMEOUT_MS,
	COMPUTER_TASK_CONTINUATION_CUSTOM_TYPE,
	createComputerTaskContinuationWatchdog,
	queueComputerTaskContinuation,
	stripComputerTaskContinuationTrigger,
} from "../../Electron/resources/runtime/pi-ext/subagent/computer-task-continuation.ts";

test("post-computer_task silence aborts at 60 seconds, not before", () => {
	let now = 0;
	let scheduled;
	let aborts = 0;
	const watchdog = createComputerTaskContinuationWatchdog({
		deadlineMs: COMPUTER_TASK_CONTINUATION_TIMEOUT_MS,
		schedule(callback, delayMs) {
			scheduled = { callback, dueAt: now + delayMs };
			return { unref() {} };
		},
		cancel() { scheduled = undefined; },
		onContinue() {},
	});
	watchdog.arm(() => { aborts += 1; });
	const advance = (milliseconds) => {
		now += milliseconds;
		if (scheduled && scheduled.dueAt <= now) {
			const { callback } = scheduled;
			scheduled = undefined;
			callback();
		}
	};
	advance(59_999);
	assert.equal(aborts, 0);
	advance(1);
	assert.equal(aborts, 1);
});

function harness() {
	let scheduled;
	let cancelled = 0;
	let aborts = 0;
	let continuations = 0;
	const watchdog = createComputerTaskContinuationWatchdog({
		deadlineMs: 25,
		schedule(callback, delayMs) {
			assert.equal(delayMs, 25);
			scheduled = callback;
			return { unref() {} };
		},
		cancel() {
			cancelled += 1;
		},
		onContinue() {
			continuations += 1;
		},
	});
	return {
		watchdog,
		fireDeadline() {
			assert.ok(scheduled);
			scheduled();
		},
		arm() {
			watchdog.arm(() => {
				aborts += 1;
			});
		},
		counts() {
			return { aborts, continuations, cancelled };
		},
	};
}

test("terminal computer_task result aborts a silent provider wait, then continues exactly once after settle", () => {
	const subject = harness();
	subject.arm();
	subject.fireDeadline();
	assert.deepEqual(subject.counts(), { aborts: 1, continuations: 0, cancelled: 0 });

	subject.watchdog.noteSettled();
	subject.watchdog.noteSettled();
	assert.deepEqual(subject.counts(), { aborts: 1, continuations: 1, cancelled: 0 });
});

test("the first real assistant activity cancels the deadline even if its stale callback later fires", () => {
	const subject = harness();
	subject.arm();
	subject.watchdog.noteAssistantActivity();
	subject.fireDeadline();
	assert.deepEqual(subject.counts(), { aborts: 0, continuations: 0, cancelled: 1 });
	subject.watchdog.noteSettled();
	assert.deepEqual(subject.counts(), { aborts: 0, continuations: 0, cancelled: 1 });
});

test("a naturally settled turn never creates a synthetic continuation", () => {
	const subject = harness();
	subject.arm();
	subject.watchdog.noteSettled();
	assert.deepEqual(subject.counts(), { aborts: 0, continuations: 0, cancelled: 1 });
});

test("continuation uses a hidden custom trigger while the provider context still ends at the original tool result", () => {
	const sent = [];
	assert.equal(queueComputerTaskContinuation({ sendMessage: (...args) => sent.push(args) }, "call-42"), true);
	assert.deepEqual(sent, [[
		{
			customType: COMPUTER_TASK_CONTINUATION_CUSTOM_TYPE,
			content: [],
			display: false,
			details: { version: 1, obligationId: "call-42" },
		},
		{ triggerTurn: true },
	]]);

	const toolResult = { role: "toolResult", toolName: "computer_task", content: [{ type: "text", text: "FAIL" }] };
	const aborted = { role: "assistant", stopReason: "aborted", content: [] };
	const trigger = { role: "custom", customType: COMPUTER_TASK_CONTINUATION_CUSTOM_TYPE, content: [], details: { version: 1, obligationId: "call-42" } };
	assert.deepEqual(
		stripComputerTaskContinuationTrigger([{ role: "user", content: "goal" }, toolResult, aborted, trigger], "call-42"),
		[{ role: "user", content: "goal" }, toolResult],
	);
	assert.equal(
		stripComputerTaskContinuationTrigger([toolResult, aborted, trigger], "another-call").length,
		3,
	);
});
