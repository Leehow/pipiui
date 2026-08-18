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
