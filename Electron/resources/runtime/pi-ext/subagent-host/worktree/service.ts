/** Portable host service that performs safe finalization after an agent terminal event. */

import type {
	WorktreeCleanupDispositionV1,
	WorktreeFinalizationInputV1,
	WorktreeFinalizationResultV1,
	WorktreeFinalizationStateV1,
	WorktreeRecoveryContractV1,
	WorktreeVerifyDispositionV1,
} from "./schema.ts";
import {
	WORKTREE_FINALIZATION_SCHEMA_VERSION,
	decodeWorktreeFinalizationInputV1,
	decodeWorktreeFinalizationStateV1,
	terminalVerifyDispositionV1,
	verifyDisplayCommandV1,
} from "./schema.ts";
import type {
	GitBranchCleanupResultV1,
	GitOperationResultV1,
	GitWorktreeAdapter,
} from "./adapter.ts";
import {
	DEFAULT_GIT_TIMEOUT_MS,
	DEFAULT_SPAWN_TERMINATION_GRACE_MS,
	DEFAULT_VERIFY_TIMEOUT_MS,
	NodeGitWorktreeAdapter,
	runSpawnV1,
} from "./adapter.ts";
import type { MainRepoSerialQueueV1 } from "./queue.ts";
import { PerMainRepoSerialQueueV1 } from "./queue.ts";
import { evaluateAutoMergeReadinessV1 } from "./policy.ts";
import {
	sweepLeftoverWorktreesV1,
	type LeftoverWorktreeSweepInputV1,
	type LeftoverWorktreeSweepSummaryV1,
} from "./sweep.ts";

export type WorktreeFinalizationClockV1 = {
	now(): Date;
};

export type WorktreeFinalizationLoggerV1 = {
	debug?(event: string, fields?: Record<string, unknown>): void;
	info?(event: string, fields?: Record<string, unknown>): void;
	warn?(event: string, fields?: Record<string, unknown>): void;
	error?(event: string, fields?: Record<string, unknown>): void;
};

export type PostMergeVerifyRequestV1 = {
	mainCwd: string;
	agentId: string;
	runId: string;
	command?: string;
	argv?: string[];
	/** Injected runners can honor this without the service touching their children. */
	signal?: AbortSignal;
	timeoutMs?: number;
};

export type PostMergeVerifyResultV1 = {
	ok: boolean;
	exitCode?: number | null;
	outputTail?: string;
	timedOut?: boolean;
	aborted?: boolean;
	error?: string;
};

export type PostMergeVerifyRunnerV1 = (
	request: PostMergeVerifyRequestV1,
) => Promise<PostMergeVerifyResultV1> | PostMergeVerifyResultV1;

export type WorktreeFinalizationServiceOptionsV1 = {
	adapter?: GitWorktreeAdapter;
	queue?: MainRepoSerialQueueV1;
	clock?: WorktreeFinalizationClockV1;
	logger?: WorktreeFinalizationLoggerV1;
	/** Applied to the default Node Git adapter; defaults to 30 seconds. */
	gitTimeoutMs?: number;
	/** Applied to the default direct-argv verifier and injected-runner deadline; defaults to 120 seconds. */
	verifyTimeoutMs?: number;
	/** Requests cancellation of service-owned children and is forwarded to injected runners. */
	abortSignal?: AbortSignal;
	/** SIGTERM-to-SIGKILL grace for service-owned direct-argv children; defaults to one second. */
	terminationGraceMs?: number;
	/**
	 * Host-owned callback for legacy string commands or a custom verifier. The
	 * default runner only executes `verify.argv` directly with no shell.
	 */
	postMergeVerify?: PostMergeVerifyRunnerV1;
	/**
	 * Optional host hook after `result.merge === "merged"` and before cleanup.
	 * Failures here must never fail finalization.
	 */
	onMerged?: (event: WorktreeMergedEventV1) => void | Promise<void>;
};

export type WorktreeMergedEventV1 = {
	agentId: string;
	runId: string;
	mainCwd: string;
	branch: string;
	preMergeHead?: string;
	landedFiles: string[];
};

type CleanupOutcome = {
	disposition: WorktreeCleanupDispositionV1;
	messages: string[];
	needsFixer: boolean;
	needsUser?: boolean;
};

type VerifyOutcome = {
	postMerge: WorktreeVerifyDispositionV1["postMerge"];
	outputTail?: string;
	exitCode?: number;
	timedOut?: boolean;
	aborted?: boolean;
	reason?: string;
	kind: "none" | "passed" | "failed" | "not-run";
};

const systemClock: WorktreeFinalizationClockV1 = { now: () => new Date() };

function iso(clock: WorktreeFinalizationClockV1): string {
	return clock.now().toISOString();
}

function baseRecovery(
	disposition: WorktreeRecoveryContractV1["disposition"],
	nextAction: WorktreeRecoveryContractV1["nextAction"],
	reason: string,
	actionable: string[] = [],
): WorktreeRecoveryContractV1 {
	return {
		disposition,
		nextAction,
		retryable: nextAction !== "none",
		reason,
		actionable,
	};
}

function phaseFor(result: WorktreeFinalizationResultV1): WorktreeFinalizationStateV1["phase"] {
	if (result.disposition === "merged") return "completed";
	return result.disposition === "needs-user" ? "blocked" : "recovery";
}

function appendMessages(result: WorktreeFinalizationResultV1, messages: readonly string[]): void {
	for (const message of messages) {
		if (message && !result.messages.includes(message)) result.messages.push(message);
	}
}

function operationDetail(result: GitOperationResultV1): string {
	if (result.timedOut || result.aborted) {
		return (result.error || (result.timedOut ? "Git command timed out" : "Git command was aborted")).trim();
	}
	return (result.stderr || result.stdout || result.error || `git exited ${result.exitCode ?? "without a status"}`).trim();
}

function cleanupMessage(result: GitBranchCleanupResultV1): string {
	return result.message || `branch cleanup disposition: ${result.disposition}`;
}

function verifyRequested(input: WorktreeFinalizationInputV1): boolean {
	return Boolean(input.verify?.command || input.verify?.argv?.length);
}

function makeResult(
	input: WorktreeFinalizationInputV1,
	now: string,
): WorktreeFinalizationResultV1 {
	const terminalVerify = terminalVerifyDispositionV1(input.verify);
	const display = verifyDisplayCommandV1(input.verify);
	return {
		schemaVersion: WORKTREE_FINALIZATION_SCHEMA_VERSION,
		agentId: input.agentId,
		runId: input.runId,
		mainCwd: input.mainCwd,
		worktree: { path: input.worktree.path, branch: input.worktree.branch },
		terminal: input.terminal.state,
		disposition: "retained",
		ownership: "unknown",
		dirty: "unknown",
		conflict: "unknown",
		merge: "not-attempted",
		recovery: baseRecovery("retained", "none", "finalization has not run"),
		cleanup: "not-attempted",
		verify: {
			terminal: terminalVerify,
			postMerge: "not-requested",
			...(display ? { command: display } : {}),
			...(input.verify?.argv ? { argv: [...input.verify.argv] } : {}),
			...(input.verify?.exitCode !== undefined ? { exitCode: input.verify.exitCode } : {}),
		},
		messages: [],
		updatedAt: now,
	};
}

/**
 * A reusable Electron-main/Node service. It does not create or reuse a
 * worktree, supervise agents, or mutate any caller state store.
 */
export class WorktreeFinalizationServiceV1 {
	private readonly adapter: GitWorktreeAdapter;
	private readonly queue: MainRepoSerialQueueV1;
	private readonly clock: WorktreeFinalizationClockV1;
	private readonly logger: WorktreeFinalizationLoggerV1;
	private readonly postMergeVerify?: PostMergeVerifyRunnerV1;
	private readonly onMerged?: WorktreeFinalizationServiceOptionsV1["onMerged"];
	private readonly verifyTimeoutMs: number;
	private readonly abortSignal?: AbortSignal;
	private readonly terminationGraceMs: number;

	constructor(options: WorktreeFinalizationServiceOptionsV1 = {}) {
		this.verifyTimeoutMs = options.verifyTimeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
		this.abortSignal = options.abortSignal;
		this.terminationGraceMs = options.terminationGraceMs ?? DEFAULT_SPAWN_TERMINATION_GRACE_MS;
		this.adapter = options.adapter ?? new NodeGitWorktreeAdapter({
			timeoutMs: options.gitTimeoutMs ?? DEFAULT_GIT_TIMEOUT_MS,
			...(options.abortSignal ? { signal: options.abortSignal } : {}),
			terminationGraceMs: this.terminationGraceMs,
		});
		this.queue = options.queue ?? new PerMainRepoSerialQueueV1();
		this.clock = options.clock ?? systemClock;
		this.logger = options.logger ?? {};
		this.postMergeVerify = options.postMergeVerify;
		this.onMerged = options.onMerged;
	}

	/** Reap settled leftover `.pi/worktrees` entries without racing a live finalization. */
	async sweepLeftovers(
		input: Omit<LeftoverWorktreeSweepInputV1, "adapter" | "logger">,
	): Promise<LeftoverWorktreeSweepSummaryV1> {
		let repositoryKey: string;
		try {
			repositoryKey = await this.adapter.repositoryKey(input.mainCwd);
		} catch (error) {
			this.logger.warn?.("worktree-leftover-sweep", {
				pruned: 0,
				kept: 0,
				dirty: 0,
				error: error instanceof Error ? error.message : String(error),
			});
			return { pruned: 0, kept: 0, dirty: 0, items: [] };
		}
		return this.queue.run(repositoryKey, () => sweepLeftoverWorktreesV1({
			...input,
			adapter: this.adapter,
			logger: this.logger,
		}));
	}

	/** Validate, serialize by canonical main repository, then either merge or return an actionable retained state. */
	async finalize(
		rawInput: WorktreeFinalizationInputV1 | unknown,
		previous?: WorktreeFinalizationStateV1,
	): Promise<WorktreeFinalizationStateV1> {
		const decoded = decodeWorktreeFinalizationInputV1(rawInput);
		if (!decoded.ok) {
			throw new TypeError(`invalid worktree finalization input: ${decoded.diagnostics.map((entry) => `${entry.path}: ${entry.message}`).join("; ")}`);
		}
		const input = decoded.value;
		let repositoryKey: string;
		try {
			repositoryKey = await this.adapter.repositoryKey(input.mainCwd);
		} catch (error) {
			return this.failedToQueue(input, previous, error);
		}
		return this.queue.run(repositoryKey, () => this.finalizeSerialized(input, previous));
	}

	/**
	 * Re-run the exact durable record. Integrated records retry post-merge verify
	 * or mechanical cleanup without requiring a now-removed worker worktree.
	 */
	async retry(rawState: WorktreeFinalizationStateV1 | unknown): Promise<WorktreeFinalizationStateV1> {
		const decoded = decodeWorktreeFinalizationStateV1(rawState);
		if (!decoded.ok) {
			throw new TypeError(`invalid worktree finalization state: ${decoded.diagnostics.map((entry) => `${entry.path}: ${entry.message}`).join("; ")}`);
		}
		const previous = decoded.value;
		if (previous.result.merge === "merged" || previous.result.merge === "already-integrated") {
			let repositoryKey: string;
			try {
				repositoryKey = await this.adapter.repositoryKey(previous.input.mainCwd);
			} catch (error) {
				return this.failedToQueue(previous.input, previous, error);
			}
			return this.queue.run(repositoryKey, () => this.retryIntegratedSerialized(previous));
		}
		return this.finalize(previous.input, previous);
	}

	private async finalizeSerialized(
		input: WorktreeFinalizationInputV1,
		previous?: WorktreeFinalizationStateV1,
	): Promise<WorktreeFinalizationStateV1> {
		const now = iso(this.clock);
		const result = makeResult(input, now);
		const attempt = (previous?.attempt ?? 0) + 1;
		this.logger.debug?.("worktree-finalization-preflight", { agentId: input.agentId, runId: input.runId, attempt });
		let inspection;
		try {
			inspection = await this.adapter.inspect(input);
		} catch (error) {
			return this.state(input, previous, {
				...result,
				disposition: "needs-user",
				ownership: "unknown",
				dirty: "unknown",
				conflict: "unknown",
				recovery: baseRecovery("needs-user", "retry-finalization", "Git inspection threw before finalization", ["restore a readable Git adapter and retry"]),
				messages: [`Git inspection failed: ${error instanceof Error ? error.message : String(error)}`],
				updatedAt: iso(this.clock),
			});
		}
		const readiness = evaluateAutoMergeReadinessV1(input, inspection);
		result.disposition = readiness.disposition;
		result.ownership = readiness.ownership;
		result.dirty = readiness.dirty;
		result.conflict = readiness.conflict;
		result.recovery = readiness.recovery;
		appendMessages(result, readiness.messages);
		if (!readiness.ready) {
			result.updatedAt = iso(this.clock);
			this.logger.info?.("worktree-finalization-retained", {
				agentId: input.agentId,
				runId: input.runId,
				disposition: result.disposition,
				recovery: result.recovery.disposition,
			});
			return this.state(input, previous, result);
		}

		if (inspection.branchIsAncestorOfMain) {
			result.merge = "already-integrated";
			appendMessages(result, ["worker branch is already reachable from main HEAD; only safe cleanup remains"]);
			return this.completeIntegrated(input, previous, result);
		}

		this.logger.info?.("worktree-finalization-merge", { agentId: input.agentId, runId: input.runId, branch: input.worktree.branch });
		let preMergeHead: string | undefined;
		try {
			const head = await runSpawnV1("git", ["-C", input.mainCwd, "rev-parse", "--verify", "HEAD"], {
				timeoutMs: DEFAULT_GIT_TIMEOUT_MS,
				...(this.abortSignal ? { signal: this.abortSignal } : {}),
				terminationGraceMs: this.terminationGraceMs,
			});
			if (head.ok && head.stdout.trim()) preMergeHead = head.stdout.trim();
		} catch (error) {
			appendMessages(result, [`pre-merge HEAD capture failed: ${error instanceof Error ? error.message : String(error)}`]);
		}
		let merged: GitOperationResultV1;
		try {
			merged = await this.adapter.merge(input.mainCwd, input.worktree.branch);
		} catch (error) {
			result.disposition = "needs-user";
			result.merge = "failed";
			result.recovery = baseRecovery(
				"needs-user",
				"retry-finalization",
				"Git adapter threw while requesting merge",
				["preserve the worktree and branch", "restore the adapter and retry finalization"],
			);
			appendMessages(result, [`Git adapter merge request failed: ${error instanceof Error ? error.message : String(error)}`]);
			result.updatedAt = iso(this.clock);
			return this.state(input, previous, result);
		}
		if (!merged.ok) {
			let conflict = "none" as WorktreeFinalizationResultV1["conflict"];
			try {
				const after = await this.adapter.inspect(input);
				if (after.main.conflictPaths.length > 0 || after.main.dangerousOperations.includes("merge")) conflict = "merge-conflict";
			} catch {
				conflict = "unknown";
			}
			result.disposition = "needs-fixer";
			result.merge = conflict === "merge-conflict" ? "conflicted" : "failed";
			result.conflict = conflict;
			result.recovery = baseRecovery(
				"needs-fixer",
				conflict === "merge-conflict" ? "resolve-conflict" : "retry-finalization",
				`main merge failed: ${operationDetail(merged)}`,
				conflict === "merge-conflict"
					? ["do not overwrite conflict files", "dispatch or resume a fixer with this branch/worktree"]
					: ["retain the worktree and branch", "inspect the Git failure before retrying"],
			);
			appendMessages(result, [`merge failed; worktree and branch were retained: ${operationDetail(merged)}`]);
			result.updatedAt = iso(this.clock);
			this.logger.warn?.("worktree-finalization-merge-failed", { agentId: input.agentId, runId: input.runId, conflict });
			return this.state(input, previous, result);
		}
		result.merge = "merged";
		appendMessages(result, ["worker branch merged into main using git merge --no-edit"]);
		await this.notifyMerged(input, result, preMergeHead);
		return this.completeIntegrated(input, previous, result);
	}

	private async notifyMerged(
		input: WorktreeFinalizationInputV1,
		result: WorktreeFinalizationResultV1,
		preMergeHead: string | undefined,
	): Promise<void> {
		if (!this.onMerged || result.merge !== "merged") return;
		let landedFiles: string[] = [];
		try {
			if (preMergeHead) {
				const diff = await runSpawnV1(
					"git",
				["-C", input.mainCwd, "diff", "--name-only", `${preMergeHead}..HEAD`],
				{
					timeoutMs: DEFAULT_GIT_TIMEOUT_MS,
					...(this.abortSignal ? { signal: this.abortSignal } : {}),
					terminationGraceMs: this.terminationGraceMs,
				},
				);
				if (diff.ok) {
					landedFiles = [...new Set(diff.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))].sort();
				} else {
					appendMessages(result, [`landed-files diff failed: ${diff.error || diff.stderr || `exit ${diff.exitCode ?? "?"}`}`]);
				}
			}
			await this.onMerged({
				agentId: input.agentId,
				runId: input.runId,
				mainCwd: input.mainCwd,
				branch: input.worktree.branch,
				...(preMergeHead ? { preMergeHead } : {}),
				landedFiles,
			});
		} catch (error) {
			appendMessages(result, [`onMerged hook failed: ${error instanceof Error ? error.message : String(error)}`]);
		}
	}

	private async completeIntegrated(
		input: WorktreeFinalizationInputV1,
		previous: WorktreeFinalizationStateV1 | undefined,
		result: WorktreeFinalizationResultV1,
	): Promise<WorktreeFinalizationStateV1> {
		const cleanup = await this.cleanupAfterIntegration(input);
		result.cleanup = cleanup.disposition;
		appendMessages(result, cleanup.messages);
		const verification = await this.runPostMergeVerify(input);
		result.verify.postMerge = verification.postMerge;
		if (verification.outputTail) result.verify.outputTail = verification.outputTail;
		if (verification.exitCode !== undefined) result.verify.postMergeExitCode = verification.exitCode;
		if (verification.timedOut) result.verify.postMergeTimedOut = true;
		if (verification.aborted) result.verify.postMergeAborted = true;

		if (verification.aborted) {
			result.disposition = "needs-user";
			result.recovery = baseRecovery("needs-user", "retry-finalization", "post-merge verify was aborted", ["retry only after the caller's cancellation scope is resolved"]);
			appendMessages(result, [`post-merge verify aborted: ${verification.reason ?? "AbortSignal"}`]);
		} else if (verification.kind === "failed") {
			const mainDirty = await this.mainIsDirty(input);
			result.disposition = mainDirty ? "needs-user" : "needs-fixer";
			result.recovery = mainDirty
				? baseRecovery("needs-user", "retry-finalization", "post-merge verify failed while main contains work in progress", ["attribute the failure before touching main work in progress"])
				: baseRecovery("post-merge-verify", "rerun-post-merge-verify", "post-merge verify failed", ["dispatch a fixer on main", "rerun the same verification after the fix"]);
			appendMessages(result, [`post-merge verify failed: ${verification.reason ?? "non-zero exit"}`]);
		} else if (verification.kind === "not-run") {
			result.disposition = "needs-user";
			result.recovery = baseRecovery("needs-user", "rerun-post-merge-verify", "an attested verify command has no safe direct-argv runner", ["provide verify.argv or a host-owned postMergeVerify callback", "do not claim finalization is complete"]);
			appendMessages(result, ["post-merge verify was not run because no safe runner was configured"]);
		} else if (cleanup.needsUser) {
			result.disposition = "needs-user";
			result.recovery = baseRecovery("needs-user", "retry-cleanup", "Git adapter rejected safe mechanical cleanup", ["preserve integration state", "restore the adapter and retry cleanup"]);
		} else if (cleanup.needsFixer) {
			result.disposition = "needs-fixer";
			result.recovery = baseRecovery("needs-fixer", "retry-cleanup", "integration succeeded but safe mechanical cleanup remains", ["retain the reported branch/worktree", "retry non-force cleanup after resolving the cause"]);
		} else {
			result.disposition = "merged";
			result.recovery = baseRecovery("none", "none", "merged, verified when requested, and safely cleaned", [],);
		}
		result.updatedAt = iso(this.clock);
		this.logger.info?.("worktree-finalization-integrated", {
			agentId: input.agentId,
			runId: input.runId,
			disposition: result.disposition,
			merge: result.merge,
			cleanup: result.cleanup,
			postMergeVerify: result.verify.postMerge,
		});
		return this.state(input, previous, result);
	}

	private async cleanupAfterIntegration(input: WorktreeFinalizationInputV1): Promise<CleanupOutcome> {
		let removed: GitOperationResultV1;
		try {
			removed = await this.adapter.removeWorktree(input.mainCwd, input.worktree.path);
		} catch (error) {
			return {
				disposition: "failed",
				needsFixer: false,
				needsUser: true,
				messages: [`integration succeeded, but Git adapter worktree removal rejected: ${error instanceof Error ? error.message : String(error)}`],
			};
		}
		if (!removed.ok) {
			return {
				disposition: "retained-worktree",
				needsFixer: true,
				messages: [`integration succeeded, but non-force worktree removal failed: ${operationDetail(removed)}`],
			};
		}
		return this.cleanupBranchAfterRemoval(input);
	}

	private async cleanupBranchAfterRemoval(input: WorktreeFinalizationInputV1): Promise<CleanupOutcome> {
		let branch: GitBranchCleanupResultV1;
		try {
			branch = await this.adapter.cleanupMergedBranch({
				mainCwd: input.mainCwd,
				branch: input.worktree.branch,
				expectedWorktreePath: input.worktree.path,
			});
		} catch (error) {
			return {
				disposition: "failed",
				needsFixer: false,
				needsUser: true,
				messages: [`integration succeeded, but Git adapter branch cleanup rejected: ${error instanceof Error ? error.message : String(error)}`],
			};
		}
		switch (branch.disposition) {
			case "deleted":
			case "already-absent":
				return { disposition: "cleaned", needsFixer: false, messages: [cleanupMessage(branch)] };
			case "retained-non-internal":
			case "retained-registered-worktree":
			case "retained-unique-commits":
				return { disposition: "retained-branch", needsFixer: true, messages: [`integration succeeded; branch retained: ${cleanupMessage(branch)}`] };
			case "blocked":
			case "failed":
				return { disposition: "failed", needsFixer: true, messages: [`integration succeeded; branch cleanup needs attention: ${cleanupMessage(branch)}`] };
		}
	}

	private async runPostMergeVerify(input: WorktreeFinalizationInputV1): Promise<VerifyOutcome> {
		if (!verifyRequested(input)) return { kind: "none", postMerge: "not-requested" };
		const request: PostMergeVerifyRequestV1 = {
			mainCwd: input.mainCwd,
			agentId: input.agentId,
			runId: input.runId,
			...(input.verify?.command ? { command: input.verify.command } : {}),
			...(input.verify?.argv ? { argv: [...input.verify.argv] } : {}),
		};
		try {
			let checked: PostMergeVerifyResultV1 | undefined;
			if (this.postMergeVerify) {
				checked = await this.runInjectedPostMergeVerify(request);
			} else if (request.argv?.length) {
				const spawned = await runSpawnV1(request.argv[0], request.argv.slice(1), {
					cwd: input.mainCwd,
					timeoutMs: this.verifyTimeoutMs,
					...(this.abortSignal ? { signal: this.abortSignal } : {}),
					terminationGraceMs: this.terminationGraceMs,
				});
				checked = {
					ok: spawned.ok,
					exitCode: spawned.exitCode,
					outputTail: (spawned.stdout || spawned.stderr || spawned.error || "").slice(-2_000),
					...(spawned.timedOut ? { timedOut: true } : {}),
					...(spawned.aborted ? { aborted: true } : {}),
					...(spawned.error ? { error: spawned.error } : {}),
				};
			} else {
				return { kind: "not-run", postMerge: "not-run", reason: "verify.argv or postMergeVerify callback is required" };
			}
			if (checked?.ok) {
				return {
					kind: "passed",
					postMerge: "passed",
					...(checked.exitCode !== undefined && checked.exitCode !== null ? { exitCode: checked.exitCode } : {}),
					...(checked.outputTail ? { outputTail: checked.outputTail.slice(-2_000) } : {}),
				};
			}
			return {
				kind: "failed",
				postMerge: "failed",
				...(checked?.exitCode !== undefined && checked?.exitCode !== null ? { exitCode: checked.exitCode } : {}),
				...(checked?.outputTail ? { outputTail: checked.outputTail.slice(-2_000) } : {}),
				...(checked?.timedOut ? { timedOut: true } : {}),
				...(checked?.aborted ? { aborted: true } : {}),
				reason: checked?.error || checked?.outputTail || "verify returned failure",
			};
		} catch (error) {
			return { kind: "failed", postMerge: "failed", reason: error instanceof Error ? error.message : String(error) };
		}
	}

	/** An injected runner is never killed by this service; deadline/abort only releases the queue and signals it. */
	private async runInjectedPostMergeVerify(request: PostMergeVerifyRequestV1): Promise<PostMergeVerifyResultV1> {
		if (!this.postMergeVerify) return { ok: false, error: "postMergeVerify runner is unavailable" };
		if (!Number.isSafeInteger(this.verifyTimeoutMs) || this.verifyTimeoutMs < 1) {
			return { ok: false, error: "verifyTimeoutMs must be a positive safe integer" };
		}
		if (this.abortSignal?.aborted) return { ok: false, aborted: true, error: "post-merge verify aborted before runner start" };
		const controller = new AbortController();
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let resolveAbort: ((result: PostMergeVerifyResultV1) => void) | undefined;
		const aborted = new Promise<PostMergeVerifyResultV1>((resolve) => { resolveAbort = resolve; });
		const onAbort = (): void => {
			controller.abort();
			resolveAbort?.({ ok: false, aborted: true, error: "post-merge verify aborted by AbortSignal" });
		};
		this.abortSignal?.addEventListener("abort", onAbort, { once: true });
		const deadline = new Promise<PostMergeVerifyResultV1>((resolve) => {
			timeout = setTimeout(() => {
				controller.abort();
				resolve({ ok: false, timedOut: true, error: `post-merge verify timed out after ${this.verifyTimeoutMs}ms` });
			}, this.verifyTimeoutMs);
		});
		const runner = Promise.resolve().then(() => this.postMergeVerify!({
			...request,
			timeoutMs: this.verifyTimeoutMs,
			signal: controller.signal,
		}));
		try {
			return await Promise.race([runner, deadline, aborted]);
		} catch (error) {
			return { ok: false, error: error instanceof Error ? error.message : String(error) };
		} finally {
			if (timeout) clearTimeout(timeout);
			this.abortSignal?.removeEventListener("abort", onAbort);
		}
	}

	private async mainIsDirty(input: WorktreeFinalizationInputV1): Promise<boolean> {
		try {
			const snapshot = await this.adapter.inspect(input);
			return snapshot.main.stagedPaths.length > 0
				|| snapshot.main.unstagedPaths.length > 0
				|| snapshot.main.untrackedPaths.length > 0;
		} catch {
			return true;
		}
	}

	private async retryIntegratedSerialized(previous: WorktreeFinalizationStateV1): Promise<WorktreeFinalizationStateV1> {
		const input = previous.input;
		const result: WorktreeFinalizationResultV1 = {
			...previous.result,
			worktree: { ...previous.result.worktree },
			verify: { ...previous.result.verify, ...(previous.result.verify.argv ? { argv: [...previous.result.verify.argv] } : {}) },
			recovery: { ...previous.result.recovery, actionable: [...previous.result.recovery.actionable] },
			messages: [...previous.result.messages, "retrying integrated finalization"],
			updatedAt: iso(this.clock),
		};
		if (result.cleanup !== "cleaned") {
			const cleanup = result.cleanup === "retained-worktree" || result.cleanup === "not-attempted"
				? await this.cleanupAfterIntegration(input)
				: await this.cleanupBranchAfterRemoval(input);
			result.cleanup = cleanup.disposition;
			appendMessages(result, cleanup.messages);
			if (cleanup.needsUser) {
				result.disposition = "needs-user";
				result.recovery = baseRecovery("needs-user", "retry-cleanup", "Git adapter rejected cleanup retry", ["preserve integration state", "restore the adapter and retry cleanup"]);
				result.updatedAt = iso(this.clock);
				return this.state(input, previous, result);
			}
			if (cleanup.needsFixer) {
				result.disposition = "needs-fixer";
				result.recovery = baseRecovery("needs-fixer", "retry-cleanup", "safe cleanup is still incomplete", ["retain unresolved cleanup state", "retry only after resolving its cause"]);
				result.updatedAt = iso(this.clock);
				return this.state(input, previous, result);
			}
		}
		const verification = await this.runPostMergeVerify(input);
		delete result.verify.postMergeTimedOut;
		delete result.verify.postMergeAborted;
		result.verify.postMerge = verification.postMerge;
		if (verification.outputTail) result.verify.outputTail = verification.outputTail;
		if (verification.exitCode !== undefined) result.verify.postMergeExitCode = verification.exitCode;
		if (verification.timedOut) result.verify.postMergeTimedOut = true;
		if (verification.aborted) result.verify.postMergeAborted = true;
		if (verification.aborted) {
			result.disposition = "needs-user";
			result.recovery = baseRecovery("needs-user", "retry-finalization", "post-merge verify retry was aborted", ["retry only after the caller's cancellation scope is resolved"]);
		} else if (verification.kind === "failed") {
			const mainDirty = await this.mainIsDirty(input);
			result.disposition = mainDirty ? "needs-user" : "needs-fixer";
			result.recovery = mainDirty
				? baseRecovery("needs-user", "retry-finalization", "post-merge verify still fails while main contains work in progress", ["attribute the failure before touching main work in progress"])
				: baseRecovery("post-merge-verify", "rerun-post-merge-verify", "post-merge verify still fails", ["fix main and rerun verification"]);
		} else if (verification.kind === "not-run") {
			result.disposition = "needs-user";
			result.recovery = baseRecovery("needs-user", "rerun-post-merge-verify", "no safe post-merge verifier is configured", ["provide verify.argv or a callback"]);
		} else {
			result.disposition = "merged";
			result.recovery = baseRecovery("none", "none", "integrated finalization retry completed", []);
		}
		result.updatedAt = iso(this.clock);
		return this.state(input, previous, result);
	}

	private failedToQueue(
		input: WorktreeFinalizationInputV1,
		previous: WorktreeFinalizationStateV1 | undefined,
		error: unknown,
	): WorktreeFinalizationStateV1 {
		const result = makeResult(input, iso(this.clock));
		result.disposition = "needs-user";
		result.recovery = baseRecovery("needs-user", "retry-finalization", "main repository queue key could not be resolved", ["restore Git repository access and retry"]);
		result.messages = [`main repository key lookup failed: ${error instanceof Error ? error.message : String(error)}`];
		return this.state(input, previous, result);
	}

	private state(
		input: WorktreeFinalizationInputV1,
		previous: WorktreeFinalizationStateV1 | undefined,
		result: WorktreeFinalizationResultV1,
	): WorktreeFinalizationStateV1 {
		const updatedAt = iso(this.clock);
		result.updatedAt = updatedAt;
		return {
			schemaVersion: WORKTREE_FINALIZATION_SCHEMA_VERSION,
			input,
			attempt: (previous?.attempt ?? 0) + 1,
			createdAt: previous?.createdAt ?? updatedAt,
			updatedAt,
			phase: phaseFor(result),
			result,
		};
	}
}

/** Convenience one-shot entry point for Electron main adapters that do not need to retain a service instance. */
export async function finalizeWorktreeV1(
	input: WorktreeFinalizationInputV1 | unknown,
	options: WorktreeFinalizationServiceOptionsV1 = {},
): Promise<WorktreeFinalizationStateV1> {
	return new WorktreeFinalizationServiceV1(options).finalize(input);
}
