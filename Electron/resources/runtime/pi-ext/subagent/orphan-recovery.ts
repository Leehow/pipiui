/**
 * Workers this session dispatched that never reached a terminal state, detected
 * from the durable slice store on the next process.
 *
 * `rememberAgentSlice` writes `state: "running"` at dispatch and
 * `rememberAgentSliceTerminal` flips it when the worker finishes. A worker that
 * dies with its parent — the host stopping the session's Pi child for a hot
 * reload is the observed case — never gets the second write, so its slice sits
 * at "running" forever and no completion signal is ever minted. The Boss keeps
 * waiting for a sender that no longer exists.
 *
 * The condition is already named elsewhere in this extension: a persisted
 * "running" slice read from a different process is reported as "interrupted (not
 * running in this process); persisted-running leftover; process generation
 * mismatch". What was missing is that nothing volunteers it — the Boss only ever
 * saw it if it happened to query that exact agentId. This module turns the same
 * evidence into a message on the next turn.
 *
 * Scoping is by session: `.pi/agent-slices.json` is project-wide, so a leftover
 * from another conversation is not this Boss's business. Slices written before
 * the sessionId field existed carry no owner and are skipped rather than
 * announced to whoever opens a session next.
 */

export const SUBAGENT_ORPHANED_CUSTOM_TYPE = "pipiui-subagent-orphaned-v1";

export interface OrphanCandidateSlice {
	agentId: string;
	runId?: string;
	state?: string;
	title?: string;
	name?: string;
	sessionId?: string;
	worktreePath?: string;
	updatedAt?: number;
}

export interface OrphanScanInput {
	/** This process's session; a slice belonging to another conversation is not ours to report. */
	sessionId: string | undefined;
	/** agentIds this process is currently running — never leftovers, whatever the slice says. */
	liveAgentIds: ReadonlySet<string>;
}

/**
 * Slices this session persisted as running that no live job in this process
 * owns. On a fresh child the live set is empty, which is exactly the case this
 * exists for; on a session switch inside one process it keeps real workers out.
 */
export function selectOrphanedSlices(
	slices: readonly OrphanCandidateSlice[],
	input: OrphanScanInput,
): OrphanCandidateSlice[] {
	const sessionId = input.sessionId?.trim();
	if (!sessionId) return [];
	return slices.filter(
		(slice) =>
			slice.state === "running" &&
			slice.sessionId === sessionId &&
			slice.agentId.trim().length > 0 &&
			!input.liveAgentIds.has(slice.agentId),
	);
}

function describe(slice: OrphanCandidateSlice): string {
	const title = slice.title ? ` "${slice.title}"` : "";
	const run = slice.runId ? ` (runId ${slice.runId})` : "";
	const tree = slice.worktreePath ? ` Its worktree is retained at ${slice.worktreePath}.` : "";
	return `- ${slice.agentId}${title}${run} — last persisted state: running, in a process that is gone.${tree}`;
}

export function formatOrphanRecoveryNotice(slices: readonly OrphanCandidateSlice[]): string {
	if (slices.length === 0) return "";
	return [
		`[subagent-orphaned] ${slices.length} worker(s) this session dispatched did not reach a terminal state before their process ended. No completion signal exists for them and none will arrive:`,
		...slices.map(describe),
		"Whatever each wrote is still on disk, but nothing further is coming, so do not keep waiting on them.",
		`Read what one left with subagent_status({agentId, full:true}), then either re-dispatch that agentId to continue it or ask the user. Close a stale episode with subagent_resolve({agentId, runId}). This is runtime status, not a new user request.`,
	].join("\n");
}
