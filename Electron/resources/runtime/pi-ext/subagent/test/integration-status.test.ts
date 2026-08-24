import test from "node:test";
import assert from "node:assert/strict";

import {
	dependentStepIntegrationProblem,
	formatSubagentIntegrationStatus,
	integrationDependencyAdmission,
} from "../integration-status.ts";

test("a successful worker with an unmerged isolated worktree exposes the delivery boundary", () => {
	const lines = formatSubagentIntegrationStatus({
		workerState: "ok",
		integrationState: "pendingReview",
		worktreePath: "/tmp/project/.pi/worktrees/memory-pack",
		worktreeBranch: "pipiui/memory-pack",
	});

	assert.deepEqual(lines.slice(0, 4), [
		"workerState: ok",
		"integrationState: pendingReview",
		"worktreePath: /tmp/project/.pi/worktrees/memory-pack",
		"worktreeBranch: pipiui/memory-pack",
	]);
	assert.match(lines.join("\n"), /Do not read a relative path from the main cwd/i);
	assert.match(lines.join("\n"), /\/tmp\/project\/\.pi\/worktrees\/memory-pack/);
});

test("confirmed integration and workers without a worktree do not emit a false delivery warning", () => {
	const merged = formatSubagentIntegrationStatus({
		workerState: "ok",
		integrationState: "merged",
		worktreePath: "/tmp/project/.pi/worktrees/landed",
		worktreeBranch: "pipiui/landed",
	});
	assert.doesNotMatch(merged.join("\n"), /Delivery warning/);

	const readOnly = formatSubagentIntegrationStatus({ workerState: "ok" });
	assert.deepEqual(readOnly, ["workerState: ok"]);
});

test("an ordered dependent step cannot advance on worker success alone", () => {
	assert.match(
		dependentStepIntegrationProblem({
			workerState: "ok",
			integrationState: "pendingReview",
			worktreePath: "/tmp/project/.pi/worktrees/memory-pack",
			worktreeBranch: "pipiui/memory-pack",
		}) ?? "",
		/integrationState=pendingReview/,
	);
	assert.equal(
		dependentStepIntegrationProblem({
			workerState: "ok",
			integrationState: "merged",
			worktreePath: "/tmp/project/.pi/worktrees/landed",
			worktreeBranch: "pipiui/landed",
		}),
		null,
	);
	assert.equal(dependentStepIntegrationProblem({ workerState: "ok" }), null);
});

test("dependency admission distinguishes in-flight integration from terminal non-delivery", () => {
	const worktree = {
		workerState: "ok",
		worktreePath: "/tmp/project/.pi/worktrees/memory-pack",
		worktreeBranch: "pipiui/memory-pack",
	} as const;
	assert.equal(integrationDependencyAdmission({ ...worktree, integrationState: "active" }), "waiting");
	assert.equal(integrationDependencyAdmission({ ...worktree, integrationState: "pendingReview" }), "blocked");
	assert.equal(integrationDependencyAdmission({ ...worktree, integrationState: "discarded" }), "blocked");
	assert.equal(integrationDependencyAdmission({ ...worktree, integrationState: "merged" }), "ready");
	assert.equal(integrationDependencyAdmission({ ...worktree, integrationState: "mergedCleanupPending" }), "ready");
	assert.equal(integrationDependencyAdmission({ workerState: "ok" }), "ready");
});
