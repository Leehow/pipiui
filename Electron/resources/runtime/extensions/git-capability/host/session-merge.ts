/**
 * Session-level merge-back: `pipiui/session-<slug>` → canonical checkout HEAD.
 *
 * Host (pi-backend, integration stage — not this module) should call:
 *
 *   mergeSessionWorktree({
 *     canonicalRoot: projectRoot,          // PIPIUI_PROJECT_ROOT
 *     sessionBranch: workspace.branch,     // pipiui/session-<slug>
 *     worktreePath: workspace.worktreePath,
 *   })
 *
 * after secretary commit on the session branch (goal closeout) or a manual
 * worktreeCommand. This module does not schedule fixers; a `needs-fixer`
 * disposition is the signal for the host to dispatch one against the retained
 * session worktree + branch.
 *
 * Reuses the worker FIFO, auto-merge policy, and Git adapter. Unlike worker
 * finalize, a conflicted merge is `git merge --abort`'d so the canonical
 * checkout does not keep MERGE_HEAD.
 */

import { stat } from "node:fs/promises";
import * as path from "node:path";

import { SESSION_WORKTREE_BRANCH_PREFIX } from "./session-worktree.ts";
import type {
	GitOperationResultV1,
	GitWorktreeAdapter,
} from "./worktree/adapter.ts";
import {
	DEFAULT_GIT_TIMEOUT_MS,
	NodeGitWorktreeAdapter,
	runSpawnV1,
} from "./worktree/adapter.ts";
import { evaluateAutoMergeReadinessV1 } from "./worktree/policy.ts";
import type { MainRepoSerialQueueV1 } from "./worktree/queue.ts";
import { sharedPerMainRepoSerialQueueV1 } from "./worktree/queue.ts";
import type {
	WorktreeCleanupDispositionV1,
	WorktreeConflictDispositionV1,
	WorktreeFinalizationInputV1,
	WorktreeFinalizationResultV1,
	WorktreeFinalizationStateV1,
	WorktreeRecoveryContractV1,
} from "./worktree/schema.ts";
import { WORKTREE_FINALIZATION_SCHEMA_VERSION } from "./worktree/schema.ts";
import type { WorktreeFinalizationClockV1 } from "./worktree/service.ts";

export const SESSION_MERGE_RUN_ID = "session-merge";

export type SessionMergeRequest = {
	canonicalRoot: string;
	sessionBranch: string;
	worktreePath: string;
};

export type SessionMergeAdapter = GitWorktreeAdapter & {
	abortMerge?(mainCwd: string): Promise<GitOperationResultV1>;
};

export type SessionMergeOptions = {
	adapter?: SessionMergeAdapter;
	queue?: MainRepoSerialQueueV1;
	clock?: WorktreeFinalizationClockV1;
	previous?: WorktreeFinalizationStateV1;
};

const systemClock: WorktreeFinalizationClockV1 = { now: () => new Date() };

export function isSessionMergeBranch(branch: string): boolean {
	return Boolean(branch.trim())
		&& branch.startsWith(SESSION_WORKTREE_BRANCH_PREFIX)
		&& branch.length > SESSION_WORKTREE_BRANCH_PREFIX.length
		&& !branch.startsWith("-")
		&& !/[\u0000-\u001f]/.test(branch);
}

/**
 * Merge `sessionBranch` into `canonicalRoot`'s current HEAD with `--no-ff`,
 * then non-force-remove the worktree and `git branch -d` only when the branch
 * is `pipiui/session-*` and already an ancestor of HEAD.
 */
export async function mergeSessionWorktree(
	request: SessionMergeRequest,
	options: SessionMergeOptions = {},
): Promise<WorktreeFinalizationStateV1> {
	const canonicalRoot = path.resolve(request.canonicalRoot);
	const worktreePath = path.resolve(request.worktreePath);
	const sessionBranch = request.sessionBranch;
	const adapter = options.adapter ?? new NodeGitWorktreeAdapter();
	const queue = options.queue ?? sharedPerMainRepoSerialQueueV1();
	const clock = options.clock ?? systemClock;
	const previous = options.previous;
	const input = sessionMergeInput(canonicalRoot, sessionBranch, worktreePath);

	if (!isSessionMergeBranch(sessionBranch)) {
		return blockedState(input, previous, clock, {
			disposition: "needs-user",
			ownership: "mismatch",
			dirty: "unknown",
			conflict: "none",
			merge: "not-attempted",
			cleanup: "not-attempted",
			recovery: recovery(
				"needs-user",
				"retry-finalization",
				"session merge only accepts pipiui/session-* branches",
				["pass the session worktree branch", "do not delete a non-session branch"],
			),
			messages: [`session merge refused: branch is not ${SESSION_WORKTREE_BRANCH_PREFIX}* (${sessionBranch || "(empty)"})`],
		});
	}

	let repositoryKey: string;
	try {
		repositoryKey = await adapter.repositoryKey(canonicalRoot);
	} catch (error) {
		return blockedState(input, previous, clock, {
			disposition: "needs-user",
			ownership: "unknown",
			dirty: "unknown",
			conflict: "unknown",
			merge: "not-attempted",
			cleanup: "not-attempted",
			recovery: recovery("needs-user", "retry-finalization", "main repository queue key could not be resolved", ["restore Git repository access and retry"]),
			messages: [`main repository key lookup failed: ${errorMessage(error)}`],
		});
	}

	return queue.run(repositoryKey, () => mergeSerialized(adapter, input, previous, clock));
}

async function mergeSerialized(
	adapter: SessionMergeAdapter,
	input: WorktreeFinalizationInputV1,
	previous: WorktreeFinalizationStateV1 | undefined,
	clock: WorktreeFinalizationClockV1,
): Promise<WorktreeFinalizationStateV1> {
	const already = await alreadyIntegratedWithoutWorktree(input);
	if (already) return alreadyIntegratedState(adapter, input, previous, clock, already);

	let inspection;
	try {
		inspection = await adapter.inspect(input);
	} catch (error) {
		return blockedState(input, previous, clock, {
			disposition: "needs-user",
			ownership: "unknown",
			dirty: "unknown",
			conflict: "unknown",
			merge: "not-attempted",
			cleanup: "not-attempted",
			recovery: recovery("needs-user", "retry-finalization", "Git inspection threw before session merge", ["restore a readable Git adapter and retry"]),
			messages: [`Git inspection failed: ${errorMessage(error)}`],
		});
	}

	const readiness = evaluateAutoMergeReadinessV1(input, inspection);
	if (!readiness.ready) {
		return blockedState(input, previous, clock, {
			disposition: readiness.disposition,
			ownership: readiness.ownership,
			dirty: readiness.dirty,
			conflict: readiness.conflict,
			merge: "not-attempted",
			cleanup: "not-attempted",
			recovery: readiness.recovery,
			messages: readiness.messages,
		});
	}

	if (inspection.branchIsAncestorOfMain) {
		const cleanup = await cleanupSession(adapter, input);
		return completeIntegrated(input, previous, clock, {
			ownership: readiness.ownership,
			dirty: readiness.dirty,
			merge: "already-integrated",
			cleanup,
			messages: [
				...readiness.messages,
				"session branch is already reachable from main HEAD; only safe cleanup remains",
				...cleanup.messages,
			],
		});
	}

	let merged: GitOperationResultV1;
	try {
		merged = await adapter.merge(input.mainCwd, input.worktree.branch, {
			agentId: input.agentId,
			runId: input.runId,
		});
	} catch (error) {
		return blockedState(input, previous, clock, {
			disposition: "needs-user",
			ownership: readiness.ownership,
			dirty: readiness.dirty,
			conflict: "unknown",
			merge: "failed",
			cleanup: "not-attempted",
			recovery: recovery(
				"needs-user",
				"retry-finalization",
				"Git adapter threw while requesting merge",
				["preserve the worktree and branch", "restore the adapter and retry"],
			),
			messages: [`Git adapter merge request failed: ${errorMessage(error)}`],
		});
	}

	if (!merged.ok) {
		return retainAfterConflict(adapter, input, previous, clock, readiness, merged);
	}

	const cleanup = await cleanupSession(adapter, input);
	return completeIntegrated(input, previous, clock, {
		ownership: readiness.ownership,
		dirty: readiness.dirty,
		merge: "merged",
		cleanup,
		messages: [
			...readiness.messages,
			"session branch merged into main with PipiUI-Agent / PipiUI-Run trailers",
			...cleanup.messages,
		],
	});
}

async function retainAfterConflict(
	adapter: SessionMergeAdapter,
	input: WorktreeFinalizationInputV1,
	previous: WorktreeFinalizationStateV1 | undefined,
	clock: WorktreeFinalizationClockV1,
	readiness: ReturnType<typeof evaluateAutoMergeReadinessV1>,
	merged: GitOperationResultV1,
): Promise<WorktreeFinalizationStateV1> {
	let conflict: WorktreeConflictDispositionV1 = "none";
	let mergeInProgress = false;
	try {
		const after = await adapter.inspect(input);
		mergeInProgress = after.main.dangerousOperations.includes("merge");
		if (after.main.conflictPaths.length > 0 || mergeInProgress) conflict = "merge-conflict";
	} catch {
		conflict = "unknown";
		mergeInProgress = true;
	}

	const messages = [`merge failed; worktree and branch were retained: ${operationDetail(merged)}`];
	if (conflict === "merge-conflict" || mergeInProgress) {
		const aborted = await abortMergeIfPresent(adapter, input.mainCwd);
		if (aborted.ok) {
			messages.push("in-progress merge aborted; main checkout restored");
		} else {
			messages.push(`merge --abort failed: ${operationDetail(aborted)}`);
		}
	}

	return blockedState(input, previous, clock, {
		disposition: "needs-fixer",
		ownership: readiness.ownership,
		dirty: readiness.dirty,
		conflict,
		merge: conflict === "merge-conflict" ? "conflicted" : "failed",
		cleanup: "not-attempted",
		recovery: recovery(
			"needs-fixer",
			conflict === "merge-conflict" ? "resolve-conflict" : "retry-finalization",
			`main merge failed: ${operationDetail(merged)}`,
			conflict === "merge-conflict"
				? ["do not overwrite conflict files", "dispatch or resume a fixer with this branch/worktree"]
				: ["retain the worktree and branch", "inspect the Git failure before retrying"],
		),
		messages,
	});
}

async function abortMergeIfPresent(adapter: SessionMergeAdapter, mainCwd: string): Promise<GitOperationResultV1> {
	if (typeof adapter.abortMerge === "function") {
		return adapter.abortMerge(mainCwd);
	}
	return runSpawnV1("git", ["-C", mainCwd, "merge", "--abort"], { timeoutMs: DEFAULT_GIT_TIMEOUT_MS });
}

async function alreadyIntegratedWithoutWorktree(
	input: WorktreeFinalizationInputV1,
): Promise<{ branchGone: boolean } | undefined> {
	if (await isInsideWorkTree(input.worktree.path)) return undefined;
	const branchRef = await git(input.mainCwd, ["show-ref", "--verify", "--quiet", `refs/heads/${input.worktree.branch}`]);
	if (branchRef.ok) {
		const ancestor = await git(input.mainCwd, ["merge-base", "--is-ancestor", input.worktree.branch, "HEAD"]);
		if (!ancestor.ok) return undefined;
		return { branchGone: false };
	}
	if (branchRef.exitCode === 1) return { branchGone: true };
	return undefined;
}

async function alreadyIntegratedState(
	adapter: SessionMergeAdapter,
	input: WorktreeFinalizationInputV1,
	previous: WorktreeFinalizationStateV1 | undefined,
	clock: WorktreeFinalizationClockV1,
	already: { branchGone: boolean },
): Promise<WorktreeFinalizationStateV1> {
	const cleanup: CleanupOutcome = already.branchGone
		? {
			disposition: "cleaned",
			needsFixer: false,
			messages: ["session worktree and branch are already absent"],
		}
		: await cleanupSessionBranchOnly(adapter, input);
	return completeIntegrated(input, previous, clock, {
		ownership: "verified",
		dirty: "clean",
		merge: "already-integrated",
		cleanup,
		messages: [
			"session branch is already integrated; merge is idempotent",
			...cleanup.messages,
		],
	});
}

type CleanupOutcome = {
	disposition: WorktreeCleanupDispositionV1;
	needsFixer: boolean;
	needsUser?: boolean;
	messages: string[];
};

async function cleanupSession(adapter: SessionMergeAdapter, input: WorktreeFinalizationInputV1): Promise<CleanupOutcome> {
	let removed: GitOperationResultV1;
	try {
		removed = await adapter.removeWorktree(input.mainCwd, input.worktree.path);
	} catch (error) {
		return {
			disposition: "failed",
			needsFixer: false,
			needsUser: true,
			messages: [`integration succeeded, but Git adapter worktree removal rejected: ${errorMessage(error)}`],
		};
	}
	if (!removed.ok) {
		return {
			disposition: "retained-worktree",
			needsFixer: true,
			messages: [`integration succeeded, but non-force worktree removal failed: ${operationDetail(removed)}`],
		};
	}
	return cleanupSessionBranchOnly(adapter, input);
}

async function cleanupSessionBranchOnly(adapter: SessionMergeAdapter, input: WorktreeFinalizationInputV1): Promise<CleanupOutcome> {
	const branch = input.worktree.branch;
	if (!isSessionMergeBranch(branch)) {
		return {
			disposition: "retained-branch",
			needsFixer: true,
			messages: [`integration succeeded; branch retained: not a pipiui/session-* branch (${branch})`],
		};
	}
	let result;
	try {
		result = await adapter.cleanupMergedBranch({
			mainCwd: input.mainCwd,
			branch,
			expectedWorktreePath: input.worktree.path,
		});
	} catch (error) {
		return {
			disposition: "failed",
			needsFixer: false,
			needsUser: true,
			messages: [`integration succeeded, but Git adapter branch cleanup rejected: ${errorMessage(error)}`],
		};
	}
	switch (result.disposition) {
		case "deleted":
		case "already-absent":
			return { disposition: "cleaned", needsFixer: false, messages: [result.message] };
		case "retained-non-internal":
		case "retained-registered-worktree":
		case "retained-unique-commits":
			return { disposition: "retained-branch", needsFixer: true, messages: [`integration succeeded; branch retained: ${result.message}`] };
		case "blocked":
		case "failed":
			return { disposition: "failed", needsFixer: true, messages: [`integration succeeded; branch cleanup needs attention: ${result.message}`] };
	}
}

function completeIntegrated(
	input: WorktreeFinalizationInputV1,
	previous: WorktreeFinalizationStateV1 | undefined,
	clock: WorktreeFinalizationClockV1,
	fields: {
		ownership: WorktreeFinalizationResultV1["ownership"];
		dirty: WorktreeFinalizationResultV1["dirty"];
		merge: "merged" | "already-integrated";
		cleanup: CleanupOutcome;
		messages: string[];
	},
): WorktreeFinalizationStateV1 {
	const { cleanup } = fields;
	let disposition: WorktreeFinalizationResultV1["disposition"] = "merged";
	let recoveryContract = recovery("none", "none", "merged and safely cleaned", []);
	if (cleanup.needsUser) {
		disposition = "needs-user";
		recoveryContract = recovery("needs-user", "retry-cleanup", "Git adapter rejected safe mechanical cleanup", ["preserve integration state", "restore the adapter and retry cleanup"]);
	} else if (cleanup.needsFixer) {
		disposition = "needs-fixer";
		recoveryContract = recovery("needs-fixer", "retry-cleanup", "integration succeeded but safe mechanical cleanup remains", ["retain the reported branch/worktree", "retry non-force cleanup after resolving the cause"]);
	}
	return state(input, previous, clock, {
		disposition,
		ownership: fields.ownership,
		dirty: fields.dirty,
		conflict: "none",
		merge: fields.merge,
		cleanup: cleanup.disposition,
		recovery: recoveryContract,
		messages: fields.messages,
	});
}

function sessionMergeInput(canonicalRoot: string, sessionBranch: string, worktreePath: string): WorktreeFinalizationInputV1 {
	const slug = sessionBranch.startsWith(SESSION_WORKTREE_BRANCH_PREFIX)
		? sessionBranch.slice("pipiui/".length)
		: sessionBranch;
	const agentId = slug || "session";
	return {
		schemaVersion: WORKTREE_FINALIZATION_SCHEMA_VERSION,
		agentId,
		runId: SESSION_MERGE_RUN_ID,
		mainCwd: canonicalRoot,
		worktree: {
			path: worktreePath,
			branch: sessionBranch,
			ownership: {
				mode: "isolated",
				role: "worker",
				agentId,
				runId: SESSION_MERGE_RUN_ID,
			},
		},
		terminal: { state: "ok" },
	};
}

function recovery(
	disposition: WorktreeRecoveryContractV1["disposition"],
	nextAction: WorktreeRecoveryContractV1["nextAction"],
	reason: string,
	actionable: string[],
): WorktreeRecoveryContractV1 {
	return { disposition, nextAction, reason, actionable, retryable: nextAction !== "none" };
}

function blockedState(
	input: WorktreeFinalizationInputV1,
	previous: WorktreeFinalizationStateV1 | undefined,
	clock: WorktreeFinalizationClockV1,
	fields: Pick<
		WorktreeFinalizationResultV1,
		"disposition" | "ownership" | "dirty" | "conflict" | "merge" | "cleanup" | "recovery" | "messages"
	>,
): WorktreeFinalizationStateV1 {
	return state(input, previous, clock, fields);
}

function state(
	input: WorktreeFinalizationInputV1,
	previous: WorktreeFinalizationStateV1 | undefined,
	clock: WorktreeFinalizationClockV1,
	fields: Pick<
		WorktreeFinalizationResultV1,
		"disposition" | "ownership" | "dirty" | "conflict" | "merge" | "cleanup" | "recovery" | "messages"
	>,
): WorktreeFinalizationStateV1 {
	const updatedAt = clock.now().toISOString();
	const result: WorktreeFinalizationResultV1 = {
		schemaVersion: WORKTREE_FINALIZATION_SCHEMA_VERSION,
		agentId: input.agentId,
		runId: input.runId,
		mainCwd: input.mainCwd,
		worktree: { path: input.worktree.path, branch: input.worktree.branch },
		terminal: input.terminal.state,
		disposition: fields.disposition,
		ownership: fields.ownership,
		dirty: fields.dirty,
		conflict: fields.conflict,
		merge: fields.merge,
		recovery: fields.recovery,
		cleanup: fields.cleanup,
		verify: { terminal: "none", postMerge: "not-requested" },
		messages: [...fields.messages],
		updatedAt,
	};
	return {
		schemaVersion: WORKTREE_FINALIZATION_SCHEMA_VERSION,
		input,
		attempt: (previous?.attempt ?? 0) + 1,
		createdAt: previous?.createdAt ?? updatedAt,
		updatedAt,
		phase: result.disposition === "merged" ? "completed" : result.disposition === "needs-user" ? "blocked" : "recovery",
		result,
	};
}

function git(cwd: string, args: string[]): Promise<GitOperationResultV1> {
	return runSpawnV1("git", ["-C", cwd, ...args], { timeoutMs: DEFAULT_GIT_TIMEOUT_MS });
}

async function isInsideWorkTree(cwd: string): Promise<boolean> {
	try {
		if (!(await isDirectory(cwd))) return false;
	} catch {
		return false;
	}
	const probe = await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
	// runGit keeps stdout raw (trailing newline); trim at the consumer.
	return probe.ok && probe.stdout.trim() === "true";
}

async function isDirectory(value: string): Promise<boolean> {
	try {
		return (await stat(value)).isDirectory();
	} catch {
		return false;
	}
}

function operationDetail(result: GitOperationResultV1): string {
	if (result.timedOut || result.aborted) {
		return (result.error || (result.timedOut ? "Git command timed out" : "Git command was aborted")).trim();
	}
	return (result.stderr || result.stdout || result.error || `git exited ${result.exitCode ?? "without a status"}`).trim();
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
