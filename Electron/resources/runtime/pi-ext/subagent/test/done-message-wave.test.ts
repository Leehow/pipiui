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
		"Wave: 2 other worker(s) still running (auth-refactor 3m12s, quota-pill 45s) — the goal is not terminal: do not give the final closeout or claim completion yet; continue orchestration and wait for their [subagent-done] events. If the user directly asks what is going on, answer briefly and factually from this line; never fabricate results, never emit one update per done event, and never send an empty assistant message just to comply with the wait.",
	);
	assert.match(
		text,
		/The Wave line above is the runtime snapshot of still-running workers taken at this completion; use it to decide whether the whole related goal is terminal yet\./,
	);
});

test("waiting instructions gate the final closeout, never impose total silence", () => {
	// Regression: the old wave/handling text ("do NOT give the user any conclusion,
	// summary, or progress update" / "keep progress and summaries silent") made the Boss
	// answer a direct user question with an empty assistant message.
	const text = formatSubagentDoneMessage(minimalResult(), {
		runId: "run-1",
		wave: { workers: [{ agentId: "a1", name: "auth-refactor", elapsed: "3m12s" }] },
	});
	assert.doesNotMatch(text, /progress[^.]*silent/i);
	assert.doesNotMatch(text, /do NOT give the user any conclusion, summary, or progress update/);
	assert.doesNotMatch(text, /do NOT give the user a status update, progress report/);
	assert.match(text, /do not give the final closeout or claim completion/);
	assert.match(text, /do not give a final closeout or present the goal as complete/);
	assert.match(text, /If the user directly asks what is going on, answer briefly and factually/);
	assert.match(text, /never send an empty assistant message/i);
	assert.match(text, /never fabricate results/i);
	assert.match(text, /never emit one update per done event/i);
	// The terminal gate itself stays: exactly one final closeout, only after terminal.
	assert.match(text, /ONLY after status confirms every related worker is terminal/);
	assert.match(text, /exactly one complete final closeout in their language/);
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
