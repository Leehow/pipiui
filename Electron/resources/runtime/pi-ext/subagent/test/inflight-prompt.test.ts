import test from "node:test";
import assert from "node:assert/strict";

import {
	IN_FLIGHT_CLEARED,
	formatInFlightWorkersBlock,
	nextInFlightInjection,
	type InFlightWorkerView,
} from "../inflight-prompt.ts";
import type { QueuedDispatchV1 } from "../dispatch-queue.ts";

const running: InFlightWorkerView = {
	agentId: "exp-1",
	title: "查 drop 样式",
	kind: "running",
};

function queued(partial: Partial<QueuedDispatchV1> & Pick<QueuedDispatchV1, "agentId">): QueuedDispatchV1 {
	return {
		role: "explore",
		task: "look around",
		blockedBy: [],
		queuedAt: 0,
		runId: `run-${partial.agentId}`,
		run: async () => {},
		...partial,
	};
}

test("a still-running worker snapshot has no clocks, so one second later is the same prefix-safe text", () => {
	const first = formatInFlightWorkersBlock([running], []);
	assert.equal(
		first,
		[
			"## Background workers in flight (live this turn)",
			"- `exp-1` (查 drop 样式) — running",
			"All still running. If the user asks about progress, call `subagent_status` rather than answering from memory.",
		].join("\n"),
	);
	assert.doesNotMatch(first ?? "", /\d+[smh]/);
	assert.equal(formatInFlightWorkersBlock([running], []), first);
});

test("stall and vanish are state changes without idle-second noise", () => {
	assert.equal(
		formatInFlightWorkersBlock([{ ...running, kind: "stalled" }], []),
		[
			"## Background workers in flight (live this turn)",
			"- `exp-1` (查 drop 样式) — STALLED",
			"A stalled or vanished worker is NOT fine and NOT \"everything is normal\". Before answering the user or declaring anything done, account for every worker above: call `subagent_status`, then recover each stalled/vanished one (abort + re-dispatch by a materially different route, or continue the same agentId). Do not claim success or normalcy while any worker above is stalled or vanished.",
		].join("\n"),
	);
	assert.match(
		formatInFlightWorkersBlock([{ ...running, kind: "vanished" }], []) ?? "",
		/VANISHED — process gone with no report/,
	);
	assert.doesNotMatch(
		formatInFlightWorkersBlock([{ ...running, kind: "stalled" }], []) ?? "",
		/idle \d+/,
	);
});

test("a worker blocked on ask_boss reads as waiting with its question, and the next action is a reply", () => {
	const block = formatInFlightWorkersBlock(
		[
			{ ...running, kind: "waiting", question: { id: 2, runId: "run-exp-1", text: "Keep the legacy endpoint?" } },
			{ agentId: "gp-2", title: "wire the flag", kind: "running" },
		],
		[],
	);
	assert.equal(
		block,
		[
			"## Background workers in flight (live this turn)",
			"- `exp-1` (查 drop 样式) — WAITING FOR YOUR ANSWER: qid=2 runId=run-exp-1 \"Keep the legacy endpoint?\"",
			"- `gp-2` (wire the flag) — running",
			"A worker waiting on you is blocked, not working, and gives up after its timeout. Answer it with `subagent_reply({ agentId, runId, answer })` before anything else; if the decision is the user's, ask them now and relay it.",
		].join("\n"),
	);
	// Waiting is not a stall, and the generic "all still running" hint yields to the reply hint.
	assert.doesNotMatch(block ?? "", /STALLED|All still running/);
	// No clocks: the same question a minute later is byte-identical.
	assert.equal(
		formatInFlightWorkersBlock([{ ...running, kind: "waiting", question: { id: 2, runId: "run-exp-1", text: "Keep the legacy endpoint?" } }], []),
		formatInFlightWorkersBlock([{ ...running, kind: "waiting", question: { id: 2, runId: "run-exp-1", text: "Keep the legacy endpoint?" } }], []),
	);
	// A stalled sibling still triggers the stall warning alongside the reply hint.
	assert.match(
		formatInFlightWorkersBlock([{ ...running, kind: "waiting" }, { agentId: "gp-3", title: "t", kind: "stalled" }], []) ?? "",
		/WAITING FOR YOUR ANSWER[\s\S]*A stalled or vanished worker is NOT fine/,
	);
});

test("queued-only work still appears, because handed-over tasks are in flight to the boss", () => {
	const text = formatInFlightWorkersBlock([], [
		queued({ agentId: "held-1", title: "fix after review", heldReason: "reviewer failed" }),
	]);
	assert.match(text ?? "", /Held — these will NOT run without a decision from you/);
	assert.match(text ?? "", /`held-1` \(fix after review\)/);
});

test("injection is append-only: same snapshot is silent, a change emits once, emptying emits a clear", () => {
	const snap = formatInFlightWorkersBlock([running], []);
	assert.ok(snap);

	let stored: string | null = null;
	let step = nextInFlightInjection(stored, snap);
	assert.equal(step.text, snap);
	stored = step.stored;

	step = nextInFlightInjection(stored, snap);
	assert.equal(step.text, undefined);
	assert.equal(step.stored, snap);

	const stalled = formatInFlightWorkersBlock([{ ...running, kind: "stalled" }], []);
	step = nextInFlightInjection(stored, stalled);
	assert.equal(step.text, stalled);
	stored = step.stored;

	step = nextInFlightInjection(stored, null);
	assert.equal(step.text, IN_FLIGHT_CLEARED);
	assert.equal(step.stored, null);

	step = nextInFlightInjection(step.stored, null);
	assert.equal(step.text, undefined);
});

test("startup with nothing in flight injects nothing", () => {
	assert.equal(formatInFlightWorkersBlock([], []), null);
	assert.equal(nextInFlightInjection(null, null).text, undefined);
});
