/** Same cap as the done-message Wave line: one glance, not the whole archive. */
export const UNFILTERED_ENDED_CAP = 8;

export function selectUnfilteredJobs<T extends { state: string }>(
	sorted: T[],
	endedCap = UNFILTERED_ENDED_CAP,
): { listed: T[]; omittedEnded: number } {
	const running = sorted.filter((job) => job.state === "running");
	const ended = sorted.filter((job) => job.state !== "running");
	return {
		listed: [...running, ...ended.slice(0, endedCap)],
		omittedEnded: Math.max(0, ended.length - endedCap),
	};
}

export function formatUnfilteredOmissionNote(omittedEnded: number, historicalCount = 0): string[] {
	const notes: string[] = [];
	if (omittedEnded > 0) {
		notes.push(
			`${omittedEnded} older ended job(s) omitted. Inspect one with subagent_status({agentId, full:true}).`,
		);
	}
	if (historicalCount > 0) {
		notes.push(
			`${historicalCount} historical worker(s) omitted. Inspect one with subagent_status({agentId, full:true}).`,
		);
	}
	return notes.length ? ["", ...notes] : [];
}

/**
 * Resumable workers are an archive, not a snapshot.
 *
 * The list comes from every stored session file under `.pi/agent-sessions`, so it grows for
 * the life of the project, not the life of the wave — and the unfiltered status view is the
 * one the runtime *mandates* on every completion/heartbeat wake. Uncapped, one measured
 * session paid 52k characters per mandated call (824 of them live state, the rest archive)
 * and 3.03M characters total, the single largest consumer of the Boss's context window.
 * The cap keeps the glance; `subagent_status({full:true})` still prints the whole archive.
 */
export const UNFILTERED_RESUMABLE_CAP = 8;

export interface ResumableEntry {
	agentId: string;
	/** Undefined when no persisted slice metadata exists for this id. */
	name?: string;
	state?: string;
	title?: string;
	task?: string;
	resultSummary?: string;
	updatedAt?: number;
}

/**
 * Newest first. Ordering matters more than the cap does: ids arrive sorted alphabetically,
 * so capping them in arrival order would keep an arbitrary slice and hide the worker that
 * was interrupted a minute ago behind one abandoned two weeks ago.
 */
export function selectResumableEntries(
	entries: readonly ResumableEntry[],
	cap = UNFILTERED_RESUMABLE_CAP,
): { listed: ResumableEntry[]; omitted: number } {
	const newestFirst = [...entries].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
	// One worker can leave several stored session files behind (one per run), and every one of
	// them maps back to the same resumable agentId. Uncapped that was a cosmetic repeat; with a
	// cap it costs a slot a different worker needed, so the newest file wins and the rest go.
	const unique: ResumableEntry[] = [];
	const seen = new Set<string>();
	for (const entry of newestFirst) {
		if (seen.has(entry.agentId)) continue;
		seen.add(entry.agentId);
		unique.push(entry);
	}
	return {
		listed: unique.slice(0, cap),
		omitted: Math.max(0, unique.length - cap),
	};
}

function formatResumableRow(entry: ResumableEntry): string {
	if (!entry.name) return `- \`${entry.agentId}\``;
	const summary = (entry.title?.trim() || (entry.task ?? "").replace(/\s+/g, " ").trim()).slice(0, 120);
	const result = entry.resultSummary?.replace(/\s+/g, " ").trim().slice(0, 120);
	const state = entry.state === "running"
		? "state=interrupted (not running in this process); last recorded state=running"
		: `state=${entry.state ?? "unknown"}`;
	return `- \`${entry.agentId}\` (${entry.name}) — ${state}; task=${summary || "(task unavailable)"}${result ? `; result=${result}` : ""}`;
}

/** The whole section, so what truncated the list is stated next to the truncated list. */
export function formatResumableSectionLines(
	entries: readonly ResumableEntry[],
	cap = UNFILTERED_RESUMABLE_CAP,
): string[] {
	if (entries.length === 0) return [];
	const selected = selectResumableEntries(entries, cap);
	return [
		"",
		"Resumable workers (stored context, not running):",
		...selected.listed.map(formatResumableRow),
		...(selected.omitted > 0
			? [`${selected.omitted} older resumable worker(s) omitted, newest kept. List every one with subagent_status({full:true}); inspect one with subagent_status({agentId}).`]
			: []),
		"An interruption is not a failure: inspect the prior task/result before deciding whether to continue or replace the worker.",
		"Re-dispatch one by its agentId to continue with everything it already knows; pass fresh only to throw that context away.",
		"Reuse an id only when the explicit title/task is the same vertical slice; do not infer from fuzzy text similarity.",
	];
}
