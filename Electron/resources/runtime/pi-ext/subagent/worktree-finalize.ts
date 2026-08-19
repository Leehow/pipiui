/**
 * Optional pi-side worktree finalization: merge, cleanup, and the disposition that follows.
 *
 * Creating a worker's worktree has always been pi's job (`worktree.ts`). Finishing with it —
 * auto-merge, removing the tree, safely deleting the branch, post-merge verify, and deciding
 * `retained` / `needs-fixer` / `needs-user` — was not: other hosts may carry their own
 * implementation, and a portable one with the same semantics has been sitting unused in
 * `subagent-host/worktree/`. This is the wire between that portable service and the extension's
 * terminal path, so a frontend does not have to own Git in order to run workers.
 *
 * Off unless `PIPIUI_WORKTREE_FINALIZER=pi`. Two finalizers racing on one repository is worse
 * than either one alone, and another host may still be a finalizer, so the default has to
 * mean "the host owns this". The opt-in is how a host declares it has stopped.
 *
 * The Git implementation is imported lazily for the same reason it is off by default: a host
 * that never opts in must not pay for loading it, and the extension must stay loadable on its
 * own — several test harnesses copy only this directory.
 */

import type {
	WorktreeFinalizationStateV1,
	WorktreeOwnerRoleV1,
	WorktreeTerminalStateV1,
} from "../subagent-host/worktree/schema.ts";
import type {
	PostMergeVerifyRequestV1,
	PostMergeVerifyResultV1,
	WorktreeMergedEventV1,
} from "../subagent-host/worktree/index.ts";

let onMergedHook: ((event: WorktreeMergedEventV1) => void | Promise<void>) | undefined;

/** Host binds the post-merge swarm broadcast here so the service stays Git-only. */
export function bindWorktreeMergedHook(
	hook: ((event: WorktreeMergedEventV1) => void | Promise<void>) | undefined,
): void {
	onMergedHook = hook;
}

/** Env value that hands finalization to pi. Anything else, including unset, leaves it to the host. */
const PI_OWNED = "pi";

export function piOwnsWorktreeFinalization(
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	return (env.PIPIUI_WORKTREE_FINALIZER ?? "").trim().toLowerCase() === PI_OWNED;
}

/**
 * The host service runs `verify.argv` shell-less by design; worker briefs carry legacy string
 * commands, so pi supplies the shell half: `bash -lc` in the main checkout, own process group
 * (Swift PostMergeVerifyRunner parity), bounded by the service's deadline and abort signal.
 * Without this runner an attested verify finalizes as `not-run`, which reads needs-user.
 */
export async function piPostMergeVerifyRunner(
	request: PostMergeVerifyRequestV1,
): Promise<PostMergeVerifyResultV1> {
	const command = (request.command ?? "").trim();
	if (!command) {
		return { ok: false, error: "no verify command to run" };
	}
	// Lazy: hosts that never opt in pay nothing; several test harnesses copy only this dir.
	const { runSpawnV1 } = await import("../subagent-host/worktree/index.ts");
	const outcome = await runSpawnV1("bash", ["-lc", command], {
		cwd: request.mainCwd,
		timeoutMs: request.timeoutMs,
		...(request.signal ? { signal: request.signal } : {}),
	});
	const tail = (outcome.stdout || outcome.stderr || outcome.error || "").slice(-2_000);
	return {
		ok: outcome.ok,
		exitCode: outcome.exitCode ?? null,
		...(tail ? { outputTail: tail } : {}),
		...(outcome.timedOut ? { timedOut: true } : {}),
		...(outcome.aborted ? { aborted: true } : {}),
		...(!outcome.ok && outcome.error ? { error: outcome.error } : {}),
	};
}

export interface FinalizeWorktreeRequest {
	agentId: string;
	runId: string;
	mainCwd: string | undefined;
	worktreePath: string | undefined;
	worktreeBranch: string | undefined;
	/** `secretary` runs in the main checkout and is never merged; the policy layer enforces that. */
	role: WorktreeOwnerRoleV1;
	terminalState: WorktreeTerminalStateV1;
	/** The worker's attested verify, kept for audit. `argv` is the only form the runner executes. */
	verify?: { command?: string; argv?: string[]; exitCode?: number };
	/** Boss/runtime re-entry after accept/resolve. Reuses the same ownership/readiness checks. */
	acceptance?: { source: "boss" };
}

const rememberedFinalizations = new Map<string, FinalizeWorktreeRequest>();
const rememberedStates = new Map<string, WorktreeFinalizationStateV1>();

function rememberKey(agentId: string, runId: string): string {
	return `${agentId}\0${runId}`;
}

function rememberFinalization(request: FinalizeWorktreeRequest): void {
	rememberedFinalizations.set(rememberKey(request.agentId, request.runId), request);
}

export function rememberedFinalizationFor(agentId: string, runId: string): FinalizeWorktreeRequest | undefined {
	return rememberedFinalizations.get(rememberKey(agentId, runId));
}

/** Test-only: drop remembered re-entry requests. */
export function resetRememberedFinalizationsForTests(): void {
	rememberedFinalizations.clear();
	rememberedStates.clear();
}

/**
 * Finalize one terminal run, or return undefined when this process is not the finalizer.
 *
 * Undefined is also the answer when there is nothing to finalize — a read-only role that never
 * got a worktree, or a dispatch whose isolation failed — so a caller can treat undefined as
 * "the host's problem, not mine" without inspecting why.
 */
export async function finalizeWorktreeIfOwned(
	request: FinalizeWorktreeRequest,
	env: NodeJS.ProcessEnv = process.env,
): Promise<WorktreeFinalizationStateV1 | undefined> {
	if (!piOwnsWorktreeFinalization(env)) return undefined;
	const { mainCwd, worktreePath, worktreeBranch } = request;
	if (!mainCwd || !worktreePath || !worktreeBranch) return undefined;
	rememberFinalization(request);

	// Lazy: the audited Git service loads only for a host that asked pi to run it.
	const { finalizeWorktreeV1 } = await import("../subagent-host/worktree/index.ts");
	const {
		inspectAgentLease,
		reapStaleAgentLease,
		claimAgentCleanupLease,
		releaseAgentCleanupLease,
	} = await import("./agent-lease.ts");
	const previous = rememberedStates.get(rememberKey(request.agentId, request.runId));
	const options = {
		postMergeVerify: piPostMergeVerifyRunner,
		...(onMergedHook ? { onMerged: onMergedHook } : {}),
		lease: {
			inspect(agentId: string) {
				return inspectAgentLease(mainCwd, agentId).status;
			},
			reapStale(agentId: string) {
				return reapStaleAgentLease(mainCwd, agentId);
			},
			claimCleanup(agentId: string) {
				const claimed = claimAgentCleanupLease(mainCwd, agentId, request.runId);
				if (!claimed.lease) {
					const status = inspectAgentLease(mainCwd, agentId).status;
					return { ok: false as const, status, message: claimed.problem };
				}
				return {
					ok: true as const,
					claim: {
						releaseOnEnd: claimed.created,
						release() {
							releaseAgentCleanupLease(claimed);
						},
					},
				};
			},
		},
	};
	if (
		previous &&
		(previous.result.merge === "merged" || previous.result.merge === "already-integrated")
	) {
		const { WorktreeFinalizationServiceV1 } = await import("../subagent-host/worktree/index.ts");
		const state = await new WorktreeFinalizationServiceV1(options).retry(previous);
		rememberedStates.set(rememberKey(request.agentId, request.runId), state);
		return state;
	}
	const state = await finalizeWorktreeV1(
		{
			schemaVersion: 1,
			agentId: request.agentId,
			runId: request.runId,
			mainCwd,
			worktree: {
				path: worktreePath,
				branch: worktreeBranch,
				ownership: {
					mode: "isolated",
					role: request.role,
					agentId: request.agentId,
					runId: request.runId,
				},
			},
			terminal: { state: request.terminalState },
			...(request.verify ? { verify: request.verify } : {}),
			...(request.acceptance ? { acceptance: request.acceptance } : {}),
		},
		// The attested verify must also run AFTER integration, in main, or a broken merge can
		// silently land. The runner executes legacy string commands; argv-only hosts keep the
		// service's own shell-less path.
		options,
	);
	rememberedStates.set(rememberKey(request.agentId, request.runId), state);
	return state;
}

/** Re-run the same owned finalizer after Boss accept/resolve. Idempotent. */
export async function reenterFinalizeOnBossAccept(input: {
	agentId: string;
	runId: string;
	mainCwd?: string;
	worktreePath?: string;
	worktreeBranch?: string;
	role?: WorktreeOwnerRoleV1;
	terminalState?: WorktreeTerminalStateV1;
	verify?: FinalizeWorktreeRequest["verify"];
}): Promise<WorktreeFinalizationStateV1 | undefined> {
	const remembered = rememberedFinalizationFor(input.agentId, input.runId);
	return finalizeWorktreeIfOwned({
		agentId: input.agentId,
		runId: input.runId,
		mainCwd: input.mainCwd ?? remembered?.mainCwd,
		worktreePath: input.worktreePath ?? remembered?.worktreePath,
		worktreeBranch: input.worktreeBranch ?? remembered?.worktreeBranch,
		role: input.role ?? remembered?.role ?? "worker",
		terminalState: input.terminalState ?? remembered?.terminalState ?? "ok",
		...(input.verify ?? remembered?.verify ? { verify: input.verify ?? remembered?.verify } : {}),
		acceptance: { source: "boss" },
	});
}

/** Map the extension's own terminal vocabulary onto the finalization contract's. */
export function terminalStateForFinalization(input: {
	ok: boolean;
	aborted: boolean;
	interrupted?: boolean;
}): WorktreeTerminalStateV1 {
	if (input.aborted) return "aborted";
	if (input.interrupted) return "interrupted";
	return input.ok ? "ok" : "failed";
}

/** The ledger's closeout vocabulary for a finalization outcome. */
export function closeoutDispositionFor(
	state: WorktreeFinalizationStateV1,
): "cleaned" | "retained" | "needs-fixer" | "needs-user" {
	switch (state.result.disposition) {
		case "merged":
			// Integrated, and the service removed the worktree and its merged branch.
			return "cleaned";
		case "needs-fixer":
			return "needs-fixer";
		case "needs-user":
			return "needs-user";
		default:
			return "retained";
	}
}

/** One line for the transcript: what Git actually did, without pulling the full record in. */
export function summarizeFinalization(state: WorktreeFinalizationStateV1): string {
	const { result } = state;
	return `disposition=${result.disposition} merge=${result.merge} cleanup=${result.cleanup} phase=${state.phase}`;
}

export type WorktreeLifecycleProjectionV1 =
	| "active"
	| "pendingReview"
	| "merged"
	| "mergedCleanupPending"
	| "discarded";

/** Map a settled finalization onto the host worktree lifecycle. */
export function lifecycleForFinalization(state: WorktreeFinalizationStateV1): WorktreeLifecycleProjectionV1 {
	const merged = state.result.merge === "merged" || state.result.merge === "already-integrated";
	if (merged && state.result.cleanup === "cleaned" && state.result.disposition === "merged") {
		return "merged";
	}
	if (merged && (state.result.cleanup === "retained-worktree" || state.result.cleanup === "failed")) {
		return "mergedCleanupPending";
	}
	if (merged && state.result.disposition === "merged") return "merged";
	return "pendingReview";
}
