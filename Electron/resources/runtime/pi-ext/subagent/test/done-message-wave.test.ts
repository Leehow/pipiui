import test from "node:test";
import assert from "node:assert/strict";

import { formatSubagentDoneMessage, type DoneMessageResult } from "../done-message.ts";

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

test("wave with 2 running workers renders the Wave line right after Title", () => {
	const text = formatSubagentDoneMessage(minimalResult(), {
		runId: "run-1",
		wave: {
			workers: [
				{ agentId: "a1", name: "auth-refactor", elapsed: "3m12s" },
				{ agentId: "a2", name: "quota-pill", elapsed: "45s" },
			],
		},
	});
	const lines = text.split("\n");
	const titleIdx = lines.findIndex((l) => l.startsWith("Title:"));
	assert.ok(titleIdx >= 0);
	assert.equal(
		lines[titleIdx + 1],
		"Wave: 2 other worker(s) still running (auth-refactor 3m12s, quota-pill 45s) — do NOT give the user any conclusion, summary, or progress update yet; continue orchestration and wait for their [subagent-done] events.",
	);
	assert.match(
		text,
		/The Wave line above is the runtime snapshot of still-running workers taken at this completion; use it to decide whether to speak or stay silent\./,
	);
});

test("empty wave renders the 0-workers directive line", () => {
	const text = formatSubagentDoneMessage(minimalResult(), {
		runId: "run-1",
		wave: { workers: [] },
	});
	const lines = text.split("\n");
	const titleIdx = lines.findIndex((l) => l.startsWith("Title:"));
	assert.equal(
		lines[titleIdx + 1],
		"Wave: 0 other workers still running — every dispatched worker is terminal; if no further work is needed, give the user exactly one complete final closeout now (in their language).",
	);
});

test("absent wave renders no Wave line", () => {
	const text = formatSubagentDoneMessage(minimalResult(), { runId: "run-1" });
	assert.equal(text.includes("\nWave:"), false);
	assert.doesNotMatch(text, /^Wave:/m);
});
