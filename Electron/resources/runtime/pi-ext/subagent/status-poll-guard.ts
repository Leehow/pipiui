/**
 * Mechanical brake on unfiltered `subagent_status` polling.
 *
 * The tool description has said "Do not busy-loop poll; one unfiltered check per
 * turn is enough" since it shipped, and job-status-list already collapses a
 * byte-identical snapshot into one notice. Neither stops the loop this exists
 * for. A Boss waiting on live workers calls status every few seconds; because
 * the workers are genuinely progressing, `turns` and the preview line differ on
 * every read, so the snapshot is never "unchanged" and the prose rule is the
 * only thing holding — which is to say nothing. One measured session spent six
 * consecutive turns announcing "I will stop polling" and calling status again in
 * the same message.
 *
 * What the Boss is waiting for is terminality, not a turn counter. So the key
 * here is coarser than the display key: worker identity and state only. While
 * that is unchanged, another look cannot return anything it can act on, and the
 * call is blocked with `terminate` — which, because Pi ends a turn early only
 * when *every* call in the batch asks for it, cuts short a turn whose sole act
 * was the redundant poll and leaves a turn doing real work alone.
 *
 * Two escapes keep the block from ever being a dead end: a per-worker
 * `subagent_status({agentId})` is never gated (the stall signal asks for exactly
 * that), and the refusal itself carries the current states, so the closeout gate
 * — "do not claim completion until status confirms the goal is terminal" — can
 * still be satisfied from a blocked call.
 */

export interface PollJob {
	agentId: string;
	runId: string;
	state: string;
}

/**
 * True for a status query that asks for the whole board. Per-worker, running-only
 * and archive queries are answering a specific question, so they are never gated.
 */
export function isUnfilteredStatusQuery(input: unknown): boolean {
	if (typeof input !== "object" || input === null) return true;
	const query = input as { agentId?: unknown; onlyRunning?: unknown; full?: unknown };
	return query.agentId === undefined && query.onlyRunning !== true && query.full !== true;
}

/**
 * Identity plus state, nothing else. `turns`, cost, elapsed and preview all churn
 * while a healthy worker runs, and none of them is something the Boss can act on
 * — treating them as news is what let the poll loop call itself justified.
 */
export function actionableStatusKey(jobs: readonly PollJob[]): string {
	return jobs
		.map((job) => `${job.agentId}:${job.runId}:${job.state}`)
		.sort()
		.join("|");
}

function stateSummary(jobs: readonly PollJob[]): string {
	if (jobs.length === 0) return "no workers in this process";
	return jobs.map((job) => `${job.agentId} ${job.state}`).join("; ");
}

export function formatPollRefusal(jobs: readonly PollJob[], repeat: number): string {
	const running = jobs.filter((job) => job.state === "running").length;
	const scope = jobs.length === 0
		? "no worker has appeared"
		: `the same ${jobs.length} worker(s) hold the same states${running > 0 ? `, ${running} still running` : ""}`;
	return [
		`[status-poll-blocked] Nothing actionable has changed since your last unfiltered subagent_status: ${scope}. This is repeat ${repeat}.`,
		`Current states (unchanged): ${stateSummary(jobs)}.`,
		"Worker notifications such as [subagent-done] and [subagent-stalled] wake the Boss only when idle and able to receive them directly. While busy, compacting, or user input is waiting, they do not enter the followUp or steering queue; results remain available through subagent_status, without a notification backlog to replay.",
		"Before ending a turn to wait on subagents, check one unfiltered subagent_status or reuse this turn's latest snapshot. These current states satisfy that check: handle terminal workers and advance the goal; wait only for workers confirmed running, never for an absent notification.",
		"Do not busy-loop or add a polling timer: while worker identity and state are unchanged, do not repeat this query. To read one worker's diagnostics meanwhile, call subagent_status({agentId}) — per-worker queries are never blocked.",
		"If you have nothing else to do this turn and related workers are still running, end the turn without a tool call.",
	].join("\n");
}

export type PollGuardDecision = { allow: true } | { allow: false; reason: string };

/**
 * One guard per session process. Genuine user input opens a fresh window: when
 * the user asks what is going on, a current read is the answer, not a poll.
 */
export class StatusPollGuard {
	private lastKey: string | undefined;
	private repeats = 0;

	reset(): void {
		this.lastKey = undefined;
		this.repeats = 0;
	}

	/** Exposed for tests and diagnostics; the decision itself owns the state. */
	get consecutiveBlocks(): number {
		return this.repeats;
	}

	decide(jobs: readonly PollJob[]): PollGuardDecision {
		const key = actionableStatusKey(jobs);
		if (key !== this.lastKey) {
			this.lastKey = key;
			this.repeats = 0;
			return { allow: true };
		}
		this.repeats += 1;
		return { allow: false, reason: formatPollRefusal(jobs, this.repeats) };
	}
}
