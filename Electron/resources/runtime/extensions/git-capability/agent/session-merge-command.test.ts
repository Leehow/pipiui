import test from "node:test";
import assert from "node:assert/strict";

import type { WorktreeFinalizationStateV1 } from "../host/worktree/schema.ts";
import { runSessionMergeCommand } from "./session-merge-command.ts";

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
		phase: disposition === "merged" ? "completed" : "blocked",
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
			conflict: "none",
			merge: disposition === "merged" ? "merged" : "not-attempted",
			recovery: {
				disposition: "none",
				retryable: false,
				nextAction: "none",
				reason: "ok",
				actionable: [],
			},
			cleanup: disposition === "merged" ? "cleaned" : "not-attempted",
			verify: { terminal: "none", postMerge: "not-requested" },
			messages: [],
			updatedAt: now,
		},
	};
}

test("session_merge calls the merge service when the session is bound", async () => {
	const calls: unknown[] = [];
	const result = await runSessionMergeCommand({
		env: BOUND_ENV,
		existsSync: () => true,
		merge: async (request) => {
			calls.push(request);
			return fakeState("merged");
		},
	});
	assert.equal(result.ok, true);
	assert.match(result.text, /disposition=merged/);
	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0], {
		canonicalRoot: "/proj",
		sessionBranch: "pipiui/session-foo",
		worktreePath: "/proj/.pi/worktrees/session-foo",
	});
});

test("session_merge gives a friendly prompt when unbound and does not call merge", async () => {
	const calls: unknown[] = [];
	const result = await runSessionMergeCommand({
		env: { PIPIUI_PROJECT_ROOT: "/proj", PIPIUI_MAIN_CWD: "/proj" },
		existsSync: () => true,
		merge: async (request) => {
			calls.push(request);
			return fakeState("merged");
		},
	});
	assert.equal(result.ok, false);
	assert.match(result.text, /No bound session worktree/);
	assert.equal(calls.length, 0);
});
