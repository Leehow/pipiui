/**
 * Boss-visible in-flight worker reminder.
 *
 * Live clocks must never go in the system prompt: `before_agent_start` receives
 * the base prompt every turn, so appending `running 3m12s, idle 5s` rewrites the
 * cached prefix on every user turn while workers are flying — the most expensive
 * moment in a session. This module emits a *quantized* snapshot (running / stalled
 * / vanished / finalizing, no seconds) meant for a custom message at the tail,
 * and only when the snapshot actually changed. See pipiui-git.ts for the same
 * cache discipline.
 */

import {
	formatQueuedPromptSections,
	type QueuedDispatchV1,
} from "./dispatch-queue.ts";

export type InFlightWorkerKind = "running" | "finalizing" | "stalled" | "vanished" | "waiting";

/** A pending ask_boss question, quantized: id and bounded text only, no clocks. */
export type InFlightWorkerQuestion = {
	id: number;
	runId: string;
	text: string;
};

export type InFlightWorkerView = {
	agentId: string;
	title: string;
	kind: InFlightWorkerKind;
	/** Present while the worker is blocked on the Boss; `kind` is then `waiting`. */
	question?: InFlightWorkerQuestion;
};

const WAITING_HINT =
	"A worker waiting on you is blocked, not working, and gives up after its timeout. Answer it with `subagent_reply({ agentId, runId, answer })` before anything else; if the decision is the user's, ask them now and relay it.";

export const IN_FLIGHT_HEADING = "## Background workers in flight (live this turn)";

export const IN_FLIGHT_CLEARED = `${IN_FLIGHT_HEADING}\nNone. Earlier reminders in this session are stale.`;

const STALL_VANISH_WARNING =
	"A stalled or vanished worker is NOT fine and NOT \"everything is normal\". Before answering the user or declaring anything done, account for every worker above: call `subagent_status`, then recover each stalled/vanished one (abort + re-dispatch by a materially different route, or continue the same agentId). Do not claim success or normalcy while any worker above is stalled or vanished.";

const RUNNING_HINT =
	"All still running. If the user asks about progress, call `subagent_status` rather than answering from memory.";

function stateLabel(kind: InFlightWorkerKind): string {
	switch (kind) {
		case "finalizing":
			return "finalizing closeout";
		case "vanished":
			return "VANISHED — process gone with no report";
		case "stalled":
			return "STALLED";
		case "waiting":
			return "WAITING FOR YOUR ANSWER";
		default:
			return "running";
	}
}

function questionSuffix(question: InFlightWorkerQuestion | undefined): string {
	if (!question) return "";
	return `: qid=${question.id} runId=${question.runId} "${question.text}"`;
}

/** Compact live snapshot. Null when nothing is running or queued. */
export function formatInFlightWorkersBlock(
	workers: ReadonlyArray<InFlightWorkerView>,
	queued: ReadonlyArray<Readonly<QueuedDispatchV1>>,
): string | null {
	if (workers.length === 0 && queued.length === 0) return null;
	const lines: string[] = [IN_FLIGHT_HEADING];
	let anyStalledOrVanished = false;
	let anyWaiting = false;
	for (const worker of workers) {
		if (worker.kind === "stalled" || worker.kind === "vanished") anyStalledOrVanished = true;
		if (worker.kind === "waiting") anyWaiting = true;
		lines.push(`- \`${worker.agentId}\` (${worker.title}) — ${stateLabel(worker.kind)}${questionSuffix(worker.question)}`);
	}
	// Waiting outranks the running hint: the next action is a reply, not a status call.
	if (anyWaiting) lines.push(WAITING_HINT);
	if (anyStalledOrVanished) {
		lines.push(STALL_VANISH_WARNING);
	} else if (workers.length > 0 && !anyWaiting) {
		lines.push(RUNNING_HINT);
	}
	lines.push(...formatQueuedPromptSections(queued));
	return lines.join("\n");
}

/**
 * Decide whether this turn should inject a new tail message.
 * `stored` is the last snapshot we injected (null after a clear / at startup).
 */
export function nextInFlightInjection(
	stored: string | null,
	snapshot: string | null,
): { stored: string | null; text?: string } {
	if (snapshot === stored) return { stored };
	if (snapshot === null) return { stored: null, text: IN_FLIGHT_CLEARED };
	return { stored: snapshot, text: snapshot };
}
