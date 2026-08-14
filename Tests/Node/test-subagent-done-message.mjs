import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSubagentDoneMessage } from "../../Sources/PipiUI/PiExt/subagent/done-message.ts";

const STATUS_CHECK = "if this turn has no unfiltered subagent_status() yet, call it once without agentId";
const PENDING_WORKERS_SILENCE = "do NOT give the user a status update, progress report, partial conclusion, or summary";
const FINAL_CLOSEOUT = "exactly one complete final closeout";
const CLOSE_LOOP_SUBSTRING = 'Never reply "already completed" without a status snapshot this turn';

function result(overrides = {}) {
	return {
		agent: "researcher",
		task: "Investigate the done-message delivery flow.",
		title: "Done-message research",
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: { cost: 0.0123, turns: 2 },
		agentId: "done-message-test",
		...overrides,
	};
}

function assistantText(text) {
	return [{ role: "assistant", content: [{ type: "text", text }] }];
}

test("successful done message preserves its structure, TLDR slice, and completion handling contract", () => {
	const message = formatSubagentDoneMessage(result({
		messages: assistantText([
			"Preamble that must not be delivered.",
			"## TLDR",
			"The requested research is complete.",
			"## Evidence",
			"This section must not be delivered.",
			"## What I did not check",
			"Live production behavior.",
			"## Follow-up",
			"This section must not be delivered either.",
		].join("\n")),
	}), { runId: "run-done-message" });

	assert.match(message, /^\[subagent-done\] agentId=done-message-test runId=run-done-message /);
	assert.match(message, /\nTitle: Done-message research\n/);
	assert.match(message, /\nResult:\n/);
	assert.match(message, /\nFull report: subagent_status\(\{agentId:"done-message-test", full:true\}\)\n/);
	assert.ok(message.includes(STATUS_CHECK));
	assert.ok(message.includes(PENDING_WORKERS_SILENCE));
	assert.ok(message.includes(FINAL_CLOSEOUT));
	assert.match(message, new RegExp(CLOSE_LOOP_SUBSTRING));
	assert.match(message, /subagent_abort\(\{agentId\}\)/);
	assert.match(message, /subagent_resolve\(\{agentId, runId\}\)/);
	assert.ok(
		message.indexOf(STATUS_CHECK) < message.indexOf(PENDING_WORKERS_SILENCE),
		"completion handling must require a once-per-turn status snapshot before deciding whether user output is allowed",
	);
	assert.ok(
		message.indexOf(PENDING_WORKERS_SILENCE) < message.indexOf(FINAL_CLOSEOUT),
		"a same-goal worker still running/stalled must suppress a user summary until all related work is terminal",
	);
	assert.match(message, /## TLDR\nThe requested research is complete\./);
	assert.match(message, /## What I did not check\nLive production behavior\./);
	assert.doesNotMatch(message, /Preamble that must not be delivered|## Evidence|## Follow-up/);
});

test("error and aborted done messages retain the status-first, no-partial-summary rule", () => {
	const failed = formatSubagentDoneMessage(result({
		exitCode: 1,
		errorMessage: "Research worker failed after collecting partial evidence.",
	}));
	const aborted = formatSubagentDoneMessage(result({
		stopReason: "aborted",
		stderr: "Research worker was aborted.",
	}));

	for (const message of [failed, aborted]) {
		assert.ok(message.includes(STATUS_CHECK));
		assert.ok(message.includes(PENDING_WORKERS_SILENCE));
		assert.ok(message.includes(FINAL_CLOSEOUT));
		assert.match(message, new RegExp(CLOSE_LOOP_SUBSTRING));
	}
});
