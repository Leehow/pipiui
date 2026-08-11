/** Pure, side-effect-free automatic-finalization policy. */

import type {
	WorktreeConflictDispositionV1,
	WorktreeDirtyDispositionV1,
	WorktreeFinalizationDispositionV1,
	WorktreeFinalizationInputV1,
	WorktreeOwnershipDispositionV1,
	WorktreeRecoveryContractV1,
} from "./schema.ts";
import { terminalVerifyDispositionV1 } from "./schema.ts";
import type { GitWorktreeInspectionV1 } from "./adapter.ts";
import { overlappingGitPathsV1 } from "./adapter.ts";

export type AutoMergeReadinessV1 = {
	ready: boolean;
	disposition: WorktreeFinalizationDispositionV1;
	ownership: WorktreeOwnershipDispositionV1;
	dirty: WorktreeDirtyDispositionV1;
	conflict: WorktreeConflictDispositionV1;
	recovery: WorktreeRecoveryContractV1;
	messages: string[];
};

function recovery(
	disposition: WorktreeRecoveryContractV1["disposition"],
	nextAction: WorktreeRecoveryContractV1["nextAction"],
	reason: string,
	actionable: string[],
	retryable = nextAction !== "none",
): WorktreeRecoveryContractV1 {
	return { disposition, nextAction, reason, actionable, retryable };
}

function blocked(
	disposition: WorktreeFinalizationDispositionV1,
	ownership: WorktreeOwnershipDispositionV1,
	dirty: WorktreeDirtyDispositionV1,
	conflict: WorktreeConflictDispositionV1,
	recoveryContract: WorktreeRecoveryContractV1,
	messages: string[],
): AutoMergeReadinessV1 {
	return { ready: false, disposition, ownership, dirty, conflict, recovery: recoveryContract, messages };
}

function mainDirtyPaths(inspection: GitWorktreeInspectionV1): string[] {
	return [
		...inspection.main.stagedPaths,
		...inspection.main.unstagedPaths,
		...inspection.main.untrackedPaths,
	];
}

function worktreeIsDirty(inspection: GitWorktreeInspectionV1): boolean {
	return inspection.worktree.stagedPaths.length > 0
		|| inspection.worktree.unstagedPaths.length > 0
		|| inspection.worktree.untrackedPaths.length > 0;
}

/**
 * Decide whether a terminal worker may be automatically merged. The function
 * intentionally has no Git calls so callers/tests can audit every rejection
 * independently of scheduling and process execution.
 */
export function evaluateAutoMergeReadinessV1(
	input: WorktreeFinalizationInputV1,
	inspection: GitWorktreeInspectionV1,
): AutoMergeReadinessV1 {
	const ownership = input.worktree.ownership;
	if (ownership.role === "secretary") {
		return blocked(
			"retained",
			"secretary",
			"unknown",
			"none",
			recovery("retained", "none", "secretary work is main-session owned and is never auto-merged", ["retain the recorded terminal state"] , false),
			["automatic merge skipped: secretary role"],
		);
	}
	if (ownership.mode === "main-session") {
		return blocked(
			"retained",
			"main-session",
			"unknown",
			"none",
			recovery("retained", "none", "main-session work is already in the main checkout", ["do not create a second merge operation"], false),
			["automatic merge skipped: main-session ownership"],
		);
	}
	if (ownership.mode !== "isolated" || ownership.agentId !== input.agentId || ownership.runId !== input.runId) {
		return blocked(
			"needs-user",
			"mismatch",
			"unknown",
			"none",
			recovery("needs-user", "retry-finalization", "worktree ownership does not exactly match this agent/run", ["confirm the worktree owner before any merge"]),
			["automatic merge skipped: ownership mismatch"],
		);
	}
	if (input.terminal.state !== "ok") {
		const nextAction = input.terminal.state === "aborted" || input.terminal.state === "interrupted"
			? "resume-worker"
			: "retry-finalization";
		return blocked(
			"retained",
			"verified",
			"unknown",
			"none",
			recovery("retained", nextAction, `terminal state is ${input.terminal.state}`, ["retain the worktree and branch for review or continuation"]),
			[`automatic merge skipped: terminal state ${input.terminal.state}`],
		);
	}
	if (terminalVerifyDispositionV1(input.verify) === "failed") {
		return blocked(
			"needs-fixer",
			"verified",
			"unknown",
			"none",
			recovery("needs-fixer", "resume-worker", "the worker's attested verify command failed", ["keep the worktree", "resume the same worker or dispatch a fixer"]),
			["automatic merge skipped: terminal verify failed"],
		);
	}

	if (!inspection.main.isRepo || !inspection.main.pathsKnown || inspection.main.errors.length > 0) {
		return blocked(
			"needs-user",
			"unknown",
			"unknown",
			"unknown",
			recovery("needs-user", "retry-finalization", "main repository state cannot be established safely", ["resolve the main repository state before retrying"]),
			[...inspection.main.errors, "automatic merge skipped: main repository state is unknown"],
		);
	}
	if (!inspection.worktree.isRepo || !inspection.worktree.pathsKnown || inspection.worktree.errors.length > 0) {
		return blocked(
			"needs-fixer",
			"unknown",
			"unknown",
			"unknown",
			recovery("needs-fixer", "resume-worker", "worker worktree state cannot be established safely", ["retain the worktree", "repair or recreate only with explicit ownership evidence"]),
			[...inspection.worktree.errors, "automatic merge skipped: worker worktree state is unknown"],
		);
	}
	if (!inspection.branchExists || !inspection.branchHead || !inspection.registeredWorktreePath
		|| inspection.worktree.branch !== input.worktree.branch
		|| inspection.worktree.head !== inspection.branchHead) {
		return blocked(
			"needs-user",
			"mismatch",
			"unknown",
			"none",
			recovery("needs-user", "retry-finalization", "recorded path/branch does not match Git's registered worktree and HEAD", ["confirm path and branch ownership before merge"]),
			["automatic merge skipped: registered path, branch, or HEAD mismatch"],
		);
	}
	if (inspection.worktree.conflictPaths.length > 0) {
		return blocked(
			"needs-fixer",
			"verified",
			"worktree-dirty",
			"worktree-conflict",
			recovery("needs-fixer", "resolve-conflict", "worker worktree has unresolved conflicts", ["keep the worktree", "resolve conflicts in the worker worktree"]),
			["automatic merge skipped: worker worktree has unresolved conflicts"],
		);
	}
	if (worktreeIsDirty(inspection)) {
		return blocked(
			"needs-fixer",
			"verified",
			"worktree-dirty",
			"none",
			recovery("needs-fixer", "resume-worker", "worker worktree has uncommitted changes", ["keep the dirty worktree", "do not auto-commit or remove it"]),
			["automatic merge skipped: dirty worker worktree is retained"],
		);
	}
	if (inspection.main.conflictPaths.length > 0) {
		return blocked(
			"needs-user",
			"verified",
			"unknown",
			"main-conflict",
			recovery("needs-user", "resolve-conflict", "main checkout already has unresolved conflicts", ["resolve main conflicts before retrying"]),
			["automatic merge skipped: main checkout has unresolved conflicts"],
		);
	}
	if (inspection.main.dangerousOperations.length > 0) {
		return blocked(
			"needs-user",
			"verified",
			"unknown",
			"dangerous-main-state",
			recovery("needs-user", "retry-finalization", "main checkout has an in-progress Git operation", ["finish or explicitly recover the main Git operation"]),
			[`automatic merge skipped: main Git operation in progress (${inspection.main.dangerousOperations.join(", ")})`],
		);
	}
	if (inspection.main.stagedPaths.length > 0) {
		return blocked(
			"needs-user",
			"verified",
			"main-staged",
			"none",
			recovery("waiting-for-main", "resolve-main-wip", "main checkout has a pre-existing staged index", ["preserve the staged index", "finish or unstage user work before retrying"]),
			["automatic merge skipped: main checkout has a pre-existing staged index"],
		);
	}
	if (inspection.workerBranchChangedPaths === undefined || inspection.branchIsAncestorOfMain === undefined || inspection.errors.length > 0) {
		return blocked(
			"needs-user",
			"unknown",
			"unknown",
			"unknown",
			recovery("needs-user", "retry-finalization", "worker branch change set cannot be established safely", ["recheck the branch graph before merge"]),
			[...inspection.errors, "automatic merge skipped: branch change set is unknown"],
		);
	}

	const dirtyPaths = mainDirtyPaths(inspection);
	if (dirtyPaths.length > 0) {
		const overlaps = overlappingGitPathsV1(inspection.workerBranchChangedPaths, dirtyPaths);
		if (overlaps.length > 0) {
			return blocked(
				"needs-user",
				"verified",
				"main-overlap",
				"none",
				recovery("waiting-for-main", "resolve-main-wip", "main work in progress overlaps worker paths", ["preserve main work in progress", `resolve overlapping paths: ${overlaps.join(", ")}`]),
				[`automatic merge skipped: main work overlaps ${overlaps.join(", ")}`],
			);
		}
		return {
			ready: true,
			disposition: "merged",
			ownership: "verified",
			dirty: "disjoint-main-wip",
			conflict: "none",
			recovery: recovery("none", "none", "main work in progress is known and disjoint", [], false),
			messages: ["main work in progress is known and disjoint from worker changes"],
		};
	}
	return {
		ready: true,
		disposition: "merged",
		ownership: "verified",
		dirty: "clean",
		conflict: "none",
		recovery: recovery("none", "none", "ready for serialized merge", [], false),
		messages: ["safe automatic merge preflight passed"],
	};
}
