import test from "node:test";
import assert from "node:assert/strict";

import type { WorktreeFinalizationStateV1 } from "../../../extensions/git-capability/host/worktree/schema.ts";
import {
	SESSION_MERGE_FAILED_PREFIX,
	maybeMergeBoundSessionAfterSecretary,
} from "../session-merge-trigger.ts";

const BOUND_ENV = {
	PIPIUI_PROJECT_ROOT: "/proj",
	PIPIUI_MAIN_CWD: "/proj/.pi/worktrees/session-foo",
};

function fakeState(disposition: WorktreeFinalizationStateV1["result"]["disposition"]): WorktreeFinalizationStateV1 {
	const now = "2026-01-01T00:00:00.000Z";
	return {
		schemaVersion: 1,
		input: {
			schemaVersion: 1,
			agentId: "session-foo",
			runId: "session-merge",
			mainCwd: "/proj",
			worktree: {
				path: "/proj/.pi/worktrees/session-foo",
				branch: "pipiui/session-foo",
				ownership: { mode: "isolated", role: "worker", agentId: "session-foo", runId: "session-merge" },
			},
			terminal: { state: "ok" },
		},
		attempt: 1,
		createdAt: now,
		updatedAt: now,
		phase: disposition === "merged" ? "completed" : "recovery",
		result: {
			schemaVersion: 1,
			agentId: "session-foo",
			runId: "session-merge",
			mainCwd: "/proj",
			worktree: { path: "/proj/.pi/worktrees/session-foo", branch: "pipiui/session-foo" },
			terminal: "ok",
			disposition,
			ownership: "verified",
			dirty: "clean",
			conflict: disposition === "needs-fixer" ? "merge-conflict" : "none",
			merge: disposition === "needs-fixer" ? "conflicted" : "merged",
			recovery: {
				disposition: disposition === "needs-fixer" ? "needs-fixer" : "none",
				retryable: disposition === "needs-fixer",
				nextAction: disposition === "needs-fixer" ? "resolve-conflict" : "none",
				reason: disposition === "needs-fixer" ? "conflict on README.md" : "ok",
				actionable: [],
			},
			cleanup: disposition === "merged" ? "cleaned" : "not-attempted",
			verify: { terminal: "none", postMerge: "not-requested" },
			messages: [],
			updatedAt: now,
		},
	};
}

test("bound closeout-secretary ok calls mergeSessionWorktree", async () => {
	const calls: unknown[] = [];
	const state = await maybeMergeBoundSessionAfterSecretary({
		isCloseoutSecretary: true,
		terminalOk: true,
		env: BOUND_ENV,
		existsSync: () => true,
		merge: async (request) => {
			calls.push(request);
			return fakeState("merged");
		},
	});
	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0], {
		canonicalRoot: "/proj",
		sessionBranch: "pipiui/session-foo",
		worktreePath: "/proj/.pi/worktrees/session-foo",
	});
	assert.equal(state?.result.disposition, "merged");
});

test("unbound session does not call merge", async () => {
	const calls: unknown[] = [];
	const state = await maybeMergeBoundSessionAfterSecretary({
		isCloseoutSecretary: true,
		terminalOk: true,
		env: { PIPIUI_PROJECT_ROOT: "/proj", PIPIUI_MAIN_CWD: "/proj" },
		existsSync: () => true,
		merge: async (request) => {
			calls.push(request);
			return fakeState("merged");
		},
	});
	assert.equal(state, undefined);
	assert.equal(calls.length, 0);
});

test("non-secretary worker does not call merge", async () => {
	const calls: unknown[] = [];
	const state = await maybeMergeBoundSessionAfterSecretary({
		isCloseoutSecretary: false,
		terminalOk: true,
		env: BOUND_ENV,
		existsSync: () => true,
		merge: async (request) => {
			calls.push(request);
			return fakeState("merged");
		},
	});
	assert.equal(state, undefined);
	assert.equal(calls.length, 0);
});

test("needs-fixer emits a Boss-visible session-merge-failed signal", async () => {
	const signals: string[] = [];
	const state = await maybeMergeBoundSessionAfterSecretary({
		isCloseoutSecretary: true,
		terminalOk: true,
		env: BOUND_ENV,
		existsSync: () => true,
		escalate: (text) => {
			signals.push(text);
		},
		merge: async () => fakeState("needs-fixer"),
	});
	assert.equal(state?.result.disposition, "needs-fixer");
	assert.equal(signals.length, 1);
	assert.equal(signals[0].startsWith(SESSION_MERGE_FAILED_PREFIX), true);
	assert.match(signals[0], /pipiui\/session-foo/);
	assert.match(signals[0], /conflict on README\.md/);
});
