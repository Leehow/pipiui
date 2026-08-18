import test from "node:test";
import assert from "node:assert/strict";

import {
	formatUnfilteredOmissionNote,
	selectUnfilteredJobs,
	UNFILTERED_ENDED_CAP,
} from "../job-status-list.ts";

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
