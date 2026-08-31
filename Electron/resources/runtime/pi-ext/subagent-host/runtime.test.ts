import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { requestGitWorktreeServiceProviderV1 } from "../../extensions/git-capability/host/worktree/provider.ts";
import type { WorktreeFinalizationInputV1, WorktreeFinalizationStateV1 } from "../../extensions/git-capability/host/worktree/schema.ts";
import type { WorktreeFinalizationServiceV1 } from "../../extensions/git-capability/host/worktree/service.ts";
import { createSubagentHostRuntimeV1 } from "./runtime.ts";
import { createNodeFsStorageAdapterV1 } from "./state/node-fs-storage.ts";

const PROVIDER_KEY = Symbol.for("pipiui.git-capability.worktree-provider.v1");
const SESSION = "runtime-test-session-capability";

function clearMountedProvider(): void {
	delete (globalThis as Record<PropertyKey, unknown>)[PROVIDER_KEY];
}

function persistence(root: string) {
	return {
		storage: createNodeFsStorageAdapterV1(),
		agentProjectionPath: join(root, "agents.json"),
		planPath: join(root, "plan.json"),
		worktreeFinalizationsPath: join(root, "finalizations.json"),
	};
}

function startEvent(agentId: string, runId: string, worktreePath: string, branch: string) {
	return {
		schemaVersion: 1,
		kind: "start",
		agentId,
		runId,
		name: "general-purpose",
		task: "finalize host worktree",
		depth: 1,
		worktreePath,
		worktreeBranch: branch,
	};
}

function endEvent(agentId: string, runId: string, worktreePath: string, branch: string) {
	return {
		schemaVersion: 1,
		kind: "end",
		agentId,
		runId,
		ok: true,
		aborted: false,
		worktreePath,
		worktreeBranch: branch,
	};
}

function fakeState(input: WorktreeFinalizationInputV1): WorktreeFinalizationStateV1 {
	return {
		schemaVersion: 1,
		attempt: 1,
		createdAt: "t",
		updatedAt: "t",
		phase: "completed",
		input,
		result: {
			schemaVersion: 1,
			agentId: input.agentId,
			runId: input.runId,
			mainCwd: input.mainCwd,
			worktree: { path: input.worktree.path, branch: input.worktree.branch },
			terminal: "ok",
			disposition: "merged",
			ownership: "verified",
			dirty: "clean",
			conflict: "none",
			merge: "merged",
			recovery: { disposition: "none", nextAction: "none", retryable: false, reason: "", actionable: [] },
			cleanup: "cleaned",
			verify: { terminal: "none", postMerge: "not-requested" },
			messages: ["injected"],
			updatedAt: "t",
		},
	};
}

test("runtime finalizes from an injected service when the global provider is missing", async (t) => {
	const previous = requestGitWorktreeServiceProviderV1();
	clearMountedProvider();
	const root = mkdtempSync(join(tmpdir(), "pipiui-host-runtime-inject-"));
	t.after(() => {
		rmSync(root, { recursive: true, force: true });
		if (previous) (globalThis as Record<PropertyKey, unknown>)[PROVIDER_KEY] = previous;
		else clearMountedProvider();
	});

	const calls: WorktreeFinalizationInputV1[] = [];
	const service = {
		finalize: async (input: WorktreeFinalizationInputV1) => {
			calls.push(input);
			return fakeState(input);
		},
	} as WorktreeFinalizationServiceV1;

	const runtime = createSubagentHostRuntimeV1({
		sessionCapability: SESSION,
		persistence: persistence(root),
		worktreeFinalization: {
			enabled: true,
			mainCwd: root,
			ownership: { mode: "isolated", role: "worker" },
			service,
		},
	});

	const agentId = "inject-ok";
	const runId = "inject-ok-run";
	const worktreePath = join(root, ".pi", "worktrees", agentId);
	const branch = `pipiui/${agentId}`;
	assert.equal((await runtime.applyAgentEvent(startEvent(agentId, runId, worktreePath, branch))).applied, true);
	const ended = await runtime.applyAgentEvent(endEvent(agentId, runId, worktreePath, branch));
	assert.equal(ended.applied, true);
	assert.equal(calls.length, 1);
	assert.equal(ended.finalization?.result.messages.includes("injected"), true);
	assert.equal(ended.diagnostics.some((entry) => entry.code === "git_worktree_provider_unavailable"), false);
	assert.equal(requestGitWorktreeServiceProviderV1(), undefined);
});

test("runtime fail-closes when neither injected service nor mounted provider exists", async (t) => {
	const previous = requestGitWorktreeServiceProviderV1();
	clearMountedProvider();
	const root = mkdtempSync(join(tmpdir(), "pipiui-host-runtime-fail-closed-"));
	t.after(() => {
		rmSync(root, { recursive: true, force: true });
		if (previous) (globalThis as Record<PropertyKey, unknown>)[PROVIDER_KEY] = previous;
		else clearMountedProvider();
	});

	const runtime = createSubagentHostRuntimeV1({
		sessionCapability: SESSION,
		persistence: persistence(root),
		worktreeFinalization: {
			enabled: true,
			mainCwd: root,
			ownership: { mode: "isolated", role: "worker" },
		},
	});

	const agentId = "fail-closed";
	const runId = "fail-closed-run";
	const worktreePath = join(root, ".pi", "worktrees", agentId);
	const branch = `pipiui/${agentId}`;
	assert.equal((await runtime.applyAgentEvent(startEvent(agentId, runId, worktreePath, branch))).applied, true);
	const ended = await runtime.applyAgentEvent(endEvent(agentId, runId, worktreePath, branch));
	assert.equal(ended.finalization, undefined);
	assert.ok(ended.diagnostics.some((entry) => entry.code === "git_worktree_provider_unavailable"));
});
