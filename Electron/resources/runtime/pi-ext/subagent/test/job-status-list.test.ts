import test from "node:test";
import assert from "node:assert/strict";

import {
	decideAdjacentStatusSnapshot,
	formatResumableSectionLines,
	formatUnfilteredOmissionNote,
	selectResumableEntries,
	selectUnfilteredJobs,
	UNCHANGED_STATUS_NOTICE,
	UNFILTERED_ENDED_CAP,
	UNFILTERED_RESUMABLE_CAP,
} from "../job-status-list.ts";

const runningSnapshot = (elapsed: string, state = "running") => [
	"| agentId | runId | name | state | turns | cost | elapsed | preview |",
	"| --- | --- | --- | --- | --- | --- | --- | --- |",
	`| worker-a | run-1 | general-purpose | ${state} | 2 | $0.0100 | ${elapsed} | editing tests |`,
	"",
	"3 older resumable worker(s) omitted, newest kept.",
].join("\n");

test("adjacent semantically unchanged status snapshots emit once", () => {
	const first = decideAdjacentStatusSnapshot(undefined, runningSnapshot("4s", "running (in bash for 2s)"), {});
	assert.equal(first.text, runningSnapshot("4s", "running (in bash for 2s)"));

	const adjacent = decideAdjacentStatusSnapshot(
		first.semanticKey,
		runningSnapshot("11s", "running (in bash for 9s)"),
		{},
	);
	assert.equal(adjacent.text, UNCHANGED_STATUS_NOTICE);
});

test("a real transition is emitted and a later repeat is not merged across it", () => {
	const running = decideAdjacentStatusSnapshot(undefined, runningSnapshot("1s"), {});
	const failedText = runningSnapshot("2s", "failed");
	const failed = decideAdjacentStatusSnapshot(running.semanticKey, failedText, {});
	assert.equal(failed.text, failedText, "terminal state changes must remain visible");

	const runningAgainText = runningSnapshot("3s");
	const runningAgain = decideAdjacentStatusSnapshot(failed.semanticKey, runningAgainText, {});
	assert.equal(runningAgain.text, runningAgainText, "only adjacent equal snapshots collapse");
});

test("identity and omission changes always emit a fresh snapshot", () => {
	const first = decideAdjacentStatusSnapshot(undefined, runningSnapshot("1s"), {});
	for (const changed of [
		runningSnapshot("2s").replace("run-1", "run-2"),
		runningSnapshot("2s").replace("worker-a", "worker-b"),
		runningSnapshot("2s").replace("3 older resumable", "4 older resumable"),
	]) {
		assert.equal(decideAdjacentStatusSnapshot(first.semanticKey, changed, {}).text, changed);
	}
});

test("explicit status queries bypass suppression and preserve the default snapshot", () => {
	const first = decideAdjacentStatusSnapshot(undefined, runningSnapshot("1s"), {});
	for (const query of [{ full: true }, { agentId: "worker-a" }, { agentId: "" }, { onlyRunning: true }]) {
		const explicitText = runningSnapshot("2s");
		const explicit = decideAdjacentStatusSnapshot(first.semanticKey, explicitText, query);
		assert.equal(explicit.text, explicitText);
		assert.equal(explicit.semanticKey, first.semanticKey);
	}

	const nextDefault = decideAdjacentStatusSnapshot(first.semanticKey, runningSnapshot("3s"), {});
	assert.equal(nextDefault.text, UNCHANGED_STATUS_NOTICE);
});

test("unfiltered status keeps every running job and only the newest ended cap", () => {
	const jobs = [
		{ id: "r1", state: "running" },
		{ id: "r2", state: "running" },
		...Array.from({ length: UNFILTERED_ENDED_CAP + 3 }, (_, index) => ({
			id: `ended-${index}`,
			state: "ok",
		})),
	];
	const selected = selectUnfilteredJobs(jobs);
	assert.deepEqual(selected.listed.map((job) => job.id), [
		"r1",
		"r2",
		...Array.from({ length: UNFILTERED_ENDED_CAP }, (_, index) => `ended-${index}`),
	]);
	assert.equal(selected.omittedEnded, 3);
	assert.deepEqual(formatUnfilteredOmissionNote(selected.omittedEnded, 12), [
		"",
		"3 older ended job(s) omitted. Inspect one with subagent_status({agentId, full:true}).",
		"12 historical worker(s) omitted. Inspect one with subagent_status({agentId, full:true}).",
	]);
});

test("resumable workers are capped newest-first, with the omission stated in place", () => {
	const entries = Array.from({ length: UNFILTERED_RESUMABLE_CAP + 4 }, (_, index) => ({
		agentId: `worker-${index}`,
		name: "general-purpose",
		state: "aborted",
		title: `slice ${index}`,
		task: "do the thing",
		// Arrival order is alphabetical; recency runs the other way on purpose.
		updatedAt: index,
	}));
	const lines = formatResumableSectionLines(entries);
	const rows = lines.filter((line) => line.startsWith("- `"));
	assert.equal(rows.length, UNFILTERED_RESUMABLE_CAP);
	assert.match(rows[0], /`worker-11`/);
	assert.match(rows[UNFILTERED_RESUMABLE_CAP - 1], /`worker-4`/);
	assert.ok(
		lines.some((line) => line.startsWith("4 older resumable worker(s) omitted, newest kept.")),
		"the omission note belongs next to the list it truncated",
	);
	assert.ok(lines.some((line) => line.includes("subagent_status({full:true})")));
	// The guidance the Boss acts on must survive the cap.
	assert.ok(lines.some((line) => line.startsWith("An interruption is not a failure")));
});

test("an uncapped resumable listing keeps every row and drops the omission note", () => {
	const entries = Array.from({ length: 12 }, (_, index) => ({
		agentId: `worker-${index}`,
		name: "explore",
		state: "ok",
		task: "read the thing",
		updatedAt: index,
	}));
	const lines = formatResumableSectionLines(entries, entries.length);
	assert.equal(lines.filter((line) => line.startsWith("- `")).length, 12);
	assert.ok(!lines.some((line) => line.includes("omitted")));
});

test("a resumable id with no stored metadata still lists as a bare row", () => {
	const lines = formatResumableSectionLines([{ agentId: "orphan" }]);
	assert.ok(lines.includes("- `orphan`"));
});

test("a still-running recorded state reads as interrupted, not as running", () => {
	const [row] = formatResumableSectionLines([
		{ agentId: "toolbox", name: "general-purpose", state: "running", task: "commit", updatedAt: 1 },
	]).filter((line) => line.startsWith("- `"));
	assert.match(row, /state=interrupted \(not running in this process\); last recorded state=running/);
});

test("selectResumableEntries treats missing timestamps as oldest", () => {
	const selected = selectResumableEntries(
		[{ agentId: "no-mtime" }, { agentId: "fresh", updatedAt: 10 }],
		1,
	);
	assert.deepEqual(selected.listed.map((entry) => entry.agentId), ["fresh"]);
	assert.equal(selected.omitted, 1);
});

test("several stored runs of one worker collapse to its newest entry", () => {
	const selected = selectResumableEntries(
		[
			{ agentId: "pdf", name: "general-purpose", task: "old run", updatedAt: 1 },
			{ agentId: "pdf", name: "general-purpose", task: "new run", updatedAt: 9 },
			{ agentId: "ui", name: "general-purpose", task: "other", updatedAt: 5 },
		],
		8,
	);
	assert.deepEqual(selected.listed.map((entry) => entry.agentId), ["pdf", "ui"]);
	assert.equal(selected.listed[0].task, "new run");
	assert.equal(selected.omitted, 0, "a collapsed duplicate is not an omitted worker");
});
