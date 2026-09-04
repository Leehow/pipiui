import test from "node:test";
import assert from "node:assert/strict";

import {
	formatOrphanRecoveryNotice,
	selectOrphanedSlices,
	type OrphanCandidateSlice,
} from "../orphan-recovery.ts";

const SESSION = "512a97e0-80ea-4277-8fc4-54426f125647";

/** The two workers the host stopped mid-flight; their slices never got a terminal write. */
const leftovers: OrphanCandidateSlice[] = [
	{
		agentId: "market-package",
		runId: "mtma0xjb-82c8b7609a189f01",
		title: "Marketplace 协议+CLI+站点",
		state: "running",
		sessionId: SESSION,
		worktreePath: "/repo/.pi/worktrees/market-package",
	},
	{
		agentId: "client-overlay",
		runId: "mtma0xly-e439afa07d89ba70",
		state: "running",
		sessionId: SESSION,
	},
];

const finished: OrphanCandidateSlice = {
	agentId: "ext-market-recon",
	runId: "mtm96vnq-f27664508628ea7e",
	state: "ok",
	sessionId: SESSION,
};

test("a fresh process claims its own session's still-running slices", () => {
	const found = selectOrphanedSlices([...leftovers, finished], {
		sessionId: SESSION,
		liveAgentIds: new Set(),
	});
	assert.deepEqual(found.map((slice) => slice.agentId), ["market-package", "client-overlay"]);
});

test("a worker this process is actually running is not a leftover", () => {
	const found = selectOrphanedSlices(leftovers, {
		sessionId: SESSION,
		liveAgentIds: new Set(["market-package"]),
	});
	assert.deepEqual(found.map((slice) => slice.agentId), ["client-overlay"]);
});

test("another conversation's leftovers are not this Boss's business", () => {
	const found = selectOrphanedSlices(
		leftovers.map((slice) => ({ ...slice, sessionId: "some-other-session" })),
		{ sessionId: SESSION, liveAgentIds: new Set() },
	);
	assert.deepEqual(found, []);
});

test("rows written before the sessionId field are skipped, not announced to whoever opens next", () => {
	const legacy = leftovers.map(({ sessionId: _sessionId, ...rest }) => rest);
	assert.deepEqual(selectOrphanedSlices(legacy, { sessionId: SESSION, liveAgentIds: new Set() }), []);
});

test("a process with no session id claims nothing", () => {
	assert.deepEqual(selectOrphanedSlices(leftovers, { sessionId: undefined, liveAgentIds: new Set() }), []);
	assert.deepEqual(selectOrphanedSlices(leftovers, { sessionId: "  ", liveAgentIds: new Set() }), []);
});

test("the notice says the signal is never coming and what to do instead", () => {
	const text = formatOrphanRecoveryNotice(leftovers);
	assert.match(text, /\[subagent-orphaned\] 2 worker\(s\)/);
	assert.match(text, /No completion signal exists for them and none will arrive/);
	assert.match(text, /do not keep waiting/);
	assert.match(text, /subagent_status\(\{agentId, full:true\}\)/);
	assert.match(text, /re-dispatch that agentId/);
	assert.match(text, /subagent_resolve\(\{agentId, runId\}\)/);
	// Runtime status is data, never an instruction channel.
	assert.match(text, /not a new user request/);
});

test("the notice carries identities and retained work", () => {
	const text = formatOrphanRecoveryNotice(leftovers);
	assert.match(text, /market-package "Marketplace 协议\+CLI\+站点" \(runId mtma0xjb-82c8b7609a189f01\)/);
	assert.match(text, /worktree is retained at \/repo\/\.pi\/worktrees\/market-package/);
	// The one without a worktree must not claim it has one.
	assert.equal(/client-overlay.*worktree is retained/.test(text), false);
});

test("nothing to report renders nothing", () => {
	assert.equal(formatOrphanRecoveryNotice([]), "");
	assert.deepEqual(selectOrphanedSlices([finished], { sessionId: SESSION, liveAgentIds: new Set() }), []);
});
