import test from "node:test";
import assert from "node:assert/strict";

import {
	formatSubagentDoneMessage,
	getResultOutput,
	isFailedResult,
	isHostEndOk,
	type DoneMessageResult,
} from "../done-message.ts";

function minimalResult(overrides: Partial<DoneMessageResult> = {}): DoneMessageResult {
	return {
		agent: "explore",
		task: "look around",
		title: "scan workspace",
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: { cost: 0, turns: 1 },
		agentId: "agent-done",
		...overrides,
	};
}

test("host endOk and done-message ok share the same predicate", () => {
	const clean = minimalResult();
	assert.equal(isHostEndOk(clean), true);
	assert.equal(isFailedResult(clean), false);

	const errorMessageOnly = minimalResult({ errorMessage: "runtime_timeout: no progress" });
	assert.equal(isHostEndOk(errorMessageOnly), false);
	assert.equal(isFailedResult(errorMessageOnly), true);
	assert.equal(isHostEndOk(errorMessageOnly, { aborted: false }), false);

	const aborted = minimalResult({ stopReason: "aborted" });
	assert.equal(isHostEndOk(aborted), false);
	assert.equal(isHostEndOk(clean, { aborted: true }), false);

	const nonzero = minimalResult({ exitCode: 1 });
	assert.equal(isHostEndOk(nonzero), false);
	assert.equal(isFailedResult(nonzero), true);
});

test("exitCode=0 with a non-empty errorMessage emits ok=false", () => {
	const text = formatSubagentDoneMessage(
		minimalResult({ errorMessage: "runtime_timeout: exceeded 600s runtime budget" }),
		{ runId: "run-timeout" },
	);
	assert.match(text, /\[subagent-done\][^\n]* ok=false /);
	assert.doesNotMatch(text, /\[subagent-done\][^\n]* ok=true /);
	assert.match(text, /runtime_timeout: exceeded 600s runtime budget/);
});

test("clean exitCode=0 without errorMessage emits ok=true", () => {
	const text = formatSubagentDoneMessage(minimalResult(), { runId: "run-ok" });
	assert.match(text, /\[subagent-done\][^\n]* ok=true /);
	assert.doesNotMatch(text, /\[subagent-done\][^\n]* ok=false /);
});

test("failed result prefers assistant text over session-start stderr", () => {
	const stderr = [
		"Warning: No project session found with id 'pipiui-asset-card-openai'; creating a new session with that id.",
		"[pipiui-mid-turn-compaction] AgentSession not found; mid-turn guard not installed",
	].join("\n");
	const result = minimalResult({
		exitCode: 1,
		stderr,
		messages: [
			{
				role: "assistant",
				content: [{ type: "text", text: "I edited the asset card renderer" }],
			} as DoneMessageResult["messages"][number],
		],
	});
	assert.equal(getResultOutput(result), "I edited the asset card renderer");
});
