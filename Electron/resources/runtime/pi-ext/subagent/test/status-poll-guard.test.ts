import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
	actionableStatusKey,
	formatPollRefusal,
	isUnfilteredStatusQuery,
	StatusPollGuard,
	type PollJob,
} from "../status-poll-guard.ts";

const running: PollJob[] = [
	{ agentId: "ext-market-recon", runId: "mtm96vnq-f27664", state: "running" },
	{ agentId: "deepwood-stack-recon", runId: "mtm97ttu-168abb", state: "running" },
];

test("only the whole-board query is gated", () => {
	assert.equal(isUnfilteredStatusQuery({}), true);
	assert.equal(isUnfilteredStatusQuery(undefined), true);
	assert.equal(isUnfilteredStatusQuery({ onlyRunning: false, full: false }), true);
	// The stall signal tells the Boss to call subagent_status({agentId}); that must never block.
	assert.equal(isUnfilteredStatusQuery({ agentId: "ext-market-recon" }), false);
	assert.equal(isUnfilteredStatusQuery({ onlyRunning: true }), false);
	assert.equal(isUnfilteredStatusQuery({ full: true }), false);
});

test("the key ignores everything a progressing worker churns", () => {
	// Same identities and states; only turn counters and previews would differ.
	assert.equal(actionableStatusKey(running), actionableStatusKey([...running].reverse()));
});

test("a second look at an unchanged board is blocked", () => {
	const guard = new StatusPollGuard();
	assert.deepEqual(guard.decide(running), { allow: true });

	const second = guard.decide(running);
	assert.equal(second.allow, false);
	assert.match(second.allow === false ? second.reason : "", /status-poll-blocked/);
	// The block must carry enough state to satisfy the closeout gate on its own.
	assert.match(second.allow === false ? second.reason : "", /ext-market-recon running/);
	assert.match(second.allow === false ? second.reason : "", /deepwood-stack-recon running/);
	assert.match(second.allow === false ? second.reason : "", /end the turn without a tool call/);
});

test("the observed loop stops at one call instead of eight", () => {
	const guard = new StatusPollGuard();
	let allowed = 0;
	for (let call = 0; call < 8; call += 1) {
		if (guard.decide(running).allow) allowed += 1;
	}
	assert.equal(allowed, 1);
	assert.equal(guard.consecutiveBlocks, 7);
});

test("a terminal state re-opens the board even without a delivered notification", () => {
	for (const state of ["ok", "failed", "aborted", "interrupted"]) {
		const guard = new StatusPollGuard();
		guard.decide(running);
		assert.equal(guard.decide(running).allow, false);

		const oneDone: PollJob[] = [
			running[0],
			{ ...running[1], state },
		];
		assert.equal(guard.decide(oneDone).allow, true, `${state} must be discoverable through status`);
		const repeated = guard.decide(oneDone);
		assert.equal(repeated.allow, false, "but only once");
		assert.ok(repeated.allow === false && repeated.reason.includes(`deepwood-stack-recon ${state}`));
	}
});

test("a newly dispatched worker re-opens the board", () => {
	const guard = new StatusPollGuard();
	guard.decide(running);
	assert.equal(guard.decide(running).allow, false);
	const withNew = [...running, { agentId: "third", runId: "r3", state: "running" }];
	assert.equal(guard.decide(withNew).allow, true);
});

test("a re-dispatch of the same agentId is a new run, not the same board", () => {
	const guard = new StatusPollGuard();
	guard.decide(running);
	const redispatched: PollJob[] = [running[0], { ...running[1], runId: "mtm99xxx-newrun" }];
	assert.equal(guard.decide(redispatched).allow, true);
});

test("user input opens a fresh window", () => {
	const guard = new StatusPollGuard();
	guard.decide(running);
	assert.equal(guard.decide(running).allow, false);
	// "怎么样了?" deserves a current read, not a refusal.
	guard.reset();
	assert.equal(guard.decide(running).allow, true);
	assert.equal(guard.consecutiveBlocks, 0);
});

test("an empty board is still gated, and says so plainly", () => {
	const guard = new StatusPollGuard();
	assert.equal(guard.decide([]).allow, true);
	const blocked = guard.decide([]);
	assert.equal(blocked.allow, false);
	assert.match(blocked.allow === false ? blocked.reason : "", /no worker has appeared/);
	assert.match(blocked.allow === false ? blocked.reason : "", /no workers in this process/);
});

test("the refusal names the per-worker escape hatch", () => {
	const reason = formatPollRefusal(running, 3);
	assert.match(reason, /repeat 3/);
	assert.match(reason, /subagent_status\(\{agentId\}\)/);
	assert.match(reason, /never blocked/);
	assert.match(reason, /\[subagent-done\]/);
});

test("the refusal describes idle-only delivery without promising a queued wake-up", () => {
	const reason = formatPollRefusal(running, 1);
	assert.match(reason, /only when idle and able to receive them directly/);
	assert.match(reason, /busy, compacting, or user input is waiting/);
	assert.match(reason, /do not enter the followUp or steering queue/);
	assert.match(reason, /results remain available through subagent_status/);
	assert.match(reason, /without a notification backlog to replay/);
	assert.doesNotMatch(reason, /Polling cannot surface a completion|both start a turn|misses nothing/);
});

test("the refusal supplies the pre-wait check instead of requiring another poll", () => {
	const reason = formatPollRefusal([{ ...running[0], state: "ok" }], 2);
	assert.match(reason, /Current states \(unchanged\): ext-market-recon ok/);
	assert.match(reason, /Before ending a turn to wait on subagents, check one unfiltered subagent_status/);
	assert.match(reason, /reuse this turn's latest snapshot/);
	assert.match(reason, /These current states satisfy that check/);
	assert.match(reason, /handle terminal workers and advance the goal/);
	assert.match(reason, /wait only for workers confirmed running/);
	assert.match(reason, /Do not busy-loop or add a polling timer/);
	assert.match(reason, /while worker identity and state are unchanged, do not repeat this query/);
	assert.match(reason, /and related workers are still running, end the turn/);
});

test("Boss layers require a current status check before waiting, without notification guarantees", () => {
	const orchestration = readFileSync(new URL("../layers/30-orchestration.md", import.meta.url), "utf8");
	const fanout = readFileSync(new URL("../layers/40-fanout.md", import.meta.url), "utf8");
	assert.match(orchestration, /Before ending a turn to wait on subagents, check one unfiltered \{\{delegate_status\}\}/);
	assert.match(orchestration, /Reuse this turn's latest snapshot/);
	assert.match(orchestration, /poll-guard refusal also carries\s+current states and satisfies this check/);
	assert.match(orchestration, /Handle terminal workers and advance the goal now/);
	assert.match(orchestration, /rest only when the snapshot confirms related workers are still running/);
	assert.match(orchestration, /unchanged state calls for no\s+repeat query, not a polling timer/);
	assert.match(orchestration, /terminal result in \{\{delegate_status\}\} is actionable without a completion receipt/);
	assert.match(fanout, /Notifications wake the Boss only when idle/);
	assert.match(fanout, /busy, compacting, or has user input waiting/);
	assert.match(fanout, /do not enter its followUp or steering queue/);
	assert.match(fanout, /no backlog of long messages to replay/);
	assert.match(fanout, /Results, status and findings remain available through \{\{delegate_status\}\}/);
	assert.match(fanout, /Before ending the\s+turn to wait, follow orchestration's status check/);
	for (const layer of [orchestration, fanout]) {
		assert.doesNotMatch(layer, /signals arrive on their own|they still\s+report when they finish|completion receipt stay the only terminal word/);
	}
});
