import test from "node:test";
import assert from "node:assert/strict";

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

test("a worker reaching a terminal state re-opens the board", () => {
	const guard = new StatusPollGuard();
	guard.decide(running);
	assert.equal(guard.decide(running).allow, false);

	const oneDone: PollJob[] = [
		running[0],
		{ ...running[1], state: "ok" },
	];
	assert.equal(guard.decide(oneDone).allow, true, "a completion is exactly what status is for");
	assert.equal(guard.decide(oneDone).allow, false, "but only once");
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
