/**
 * Optional pi-side worktree finalization: merge, cleanup, and the disposition that follows.
 *
 * Creating a worker's worktree has always been pi's job (`worktree.ts`). Finishing with it —
 * auto-merge, removing the tree, safely deleting the branch, post-merge verify, and deciding
 * `retained` / `needs-fixer` / `needs-user` — was not: the Swift app carries its own
 * implementation, and a portable one with the same semantics has been sitting unused in
 * `subagent-host/worktree/`. This is the wire between that portable service and the extension's
 * terminal path, so a frontend does not have to own Git in order to run workers.
 *
 * Off unless `PIPIUI_WORKTREE_FINALIZER=pi`. Two finalizers racing on one repository is worse
 * than either one alone, and today the Swift app is still a finalizer, so the default has to
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

/** Env value that hands finalization to pi. Anything else, including unset, leaves it to the host. */
const PI_OWNED = "pi";

export function piOwnsWorktreeFinalization(
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	return (env.PIPIUI_WORKTREE_FINALIZER ?? "").trim().toLowerCase() === PI_OWNED;
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

	// Lazy: the audited Git service loads only for a host that asked pi to run it.
	const { finalizeWorktreeV1 } = await import("../subagent-host/worktree/index.ts");
	return finalizeWorktreeV1({
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
