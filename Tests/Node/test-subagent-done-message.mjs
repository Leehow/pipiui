import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSubagentDoneMessage } from "../../Sources/PipiUI/PiExt/subagent/done-message.ts";

const HANDLING_SUBSTRING = "do not end the turn silently";

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

test("successful done message preserves its structure, TLDR slice, and handling instruction", () => {
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
	}));

	assert.match(message, /^\[subagent-done\] agentId=done-message-test /);
	assert.match(message, /\nTitle: Done-message research\n/);
	assert.match(message, /\nResult:\n/);
	assert.match(message, /\nFull report: subagent_status\(\{agentId:"done-message-test", full:true\}\)\n/);
	assert.match(message, new RegExp(HANDLING_SUBSTRING));
	assert.match(message, /## TLDR\nThe requested research is complete\./);
	assert.match(message, /## What I did not check\nLive production behavior\./);
	assert.doesNotMatch(message, /Preamble that must not be delivered|## Evidence|## Follow-up/);
});

test("error and aborted done messages both instruct the boss to report the outcome", () => {
	const failed = formatSubagentDoneMessage(result({
		exitCode: 1,
		errorMessage: "Research worker failed after collecting partial evidence.",
	}));
	const aborted = formatSubagentDoneMessage(result({
		stopReason: "aborted",
		stderr: "Research worker was aborted.",
	}));

	assert.match(failed, new RegExp(HANDLING_SUBSTRING));
	assert.match(aborted, new RegExp(HANDLING_SUBSTRING));
});
