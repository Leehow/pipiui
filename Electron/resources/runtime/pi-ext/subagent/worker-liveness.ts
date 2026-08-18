/**
 * Objective liveness evidence for a quiet worker.
 *
 * The stall detector can only see silence, and silence is what a healthy long
 * tool call looks like from the outside — a `npm run build` prints nothing on
 * the worker's stdout until it returns. That made `stalled` fire on every tool
 * call over the threshold, so the Boss learned to discount it and had to go
 * gather its own evidence from a terminal.
 *
 * Consumed CPU time is the measurement that separates "busy" from "wedged", and
 * it has to cover the whole process subtree: the worker's pi process is idle
 * while the `bash` it spawned burns the cycles.
 */

import { spawnSync } from "node:child_process";

export interface CpuSample {
	at: number;
	/** Cumulative CPU seconds consumed by the subtree, root included. */
	seconds: number;
	/** Processes counted; 0 means the subtree is gone. */
	processes: number;
}

/** `ps` TIME/cputime: `MM:SS.ff`, `HH:MM:SS`, or `DD-HH:MM:SS`. */
export function parseCpuTime(value: string): number | undefined {
	const raw = value.trim();
	if (!raw) return undefined;
	const [dayPart, clockPart] = raw.includes("-") ? raw.split("-", 2) : ["0", raw];
	const days = Number(dayPart);
	const parts = clockPart.split(":");
	if (!Number.isFinite(days) || parts.length < 2 || parts.length > 3) return undefined;
	const numbers = parts.map(Number);
	if (numbers.some((part) => !Number.isFinite(part))) return undefined;
	const [hours, minutes, seconds] = parts.length === 3
		? numbers
		: [0, numbers[0], numbers[1]];
	return days * 86_400 + hours * 3_600 + minutes * 60 + seconds;
}

interface PsRow {
	pid: number;
	ppid: number;
	seconds: number;
}

/** Rows from `ps -eo pid=,ppid=,time=`. Unparsable lines are skipped, not guessed at. */
export function parsePsRows(output: string): PsRow[] {
	const rows: PsRow[] = [];
	for (const line of output.split("\n")) {
		const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s*$/.exec(line);
		if (!match) continue;
		const seconds = parseCpuTime(match[3]);
		if (seconds === undefined) continue;
		rows.push({ pid: Number(match[1]), ppid: Number(match[2]), seconds });
	}
	return rows;
}

/**
 * Sum CPU seconds over `rootPid` and every descendant. Walks children rather
 * than trusting process-group membership: a tool may `setsid`, and the question
 * asked here is only "is anything under this worker still doing work".
 */
export function sumSubtreeCpu(rows: readonly PsRow[], rootPid: number): { seconds: number; processes: number } {
	const children = new Map<number, number[]>();
	const byPid = new Map<number, PsRow>();
	for (const row of rows) {
		byPid.set(row.pid, row);
		const siblings = children.get(row.ppid);
		if (siblings) siblings.push(row.pid);
		else children.set(row.ppid, [row.pid]);
	}
	if (!byPid.has(rootPid)) return { seconds: 0, processes: 0 };
	let seconds = 0;
	let processes = 0;
	const pending = [rootPid];
	const seen = new Set<number>();
	while (pending.length > 0) {
		const pid = pending.pop()!;
		if (seen.has(pid)) continue;
		seen.add(pid);
		const row = byPid.get(pid);
		if (!row) continue;
		seconds += row.seconds;
		processes += 1;
		// A pid that reports itself as its own parent (or a recycled ppid loop)
		// must not spin here; `seen` already guards, this keeps the walk bounded.
		for (const child of children.get(pid) ?? []) if (child !== pid) pending.push(child);
	}
	return { seconds, processes };
}

/** One `ps` call for the whole table; callers sample several workers from it. */
export function readProcessTable(run = defaultPs): PsRow[] {
	const output = run();
	return output === undefined ? [] : parsePsRows(output);
}

function defaultPs(): string | undefined {
	try {
		const result = spawnSync("ps", ["-eo", "pid=,ppid=,time="], { encoding: "utf8", timeout: 5_000 });
		if (result.error || result.status !== 0 || typeof result.stdout !== "string") return undefined;
		return result.stdout;
	} catch {
		return undefined;
	}
}

export function sampleSubtreeCpu(rows: readonly PsRow[], pid: number, now: number): CpuSample {
	const { seconds, processes } = sumSubtreeCpu(rows, pid);
	return { at: now, seconds, processes };
}

export type LivenessVerdict = "working" | "no-progress" | "gone" | "unknown";

/**
 * Compare two samples of the same subtree. `minCpuSeconds` is the floor that
 * separates real work from scheduler noise and accounting granularity; below it
 * a subtree that is merely blocked on a socket reads as no progress, which is
 * the honest answer for a worker nobody can see making progress.
 */
export function classifyCpuProgress(
	previous: CpuSample | undefined,
	current: CpuSample,
	minCpuSeconds = 0.5,
): LivenessVerdict {
	if (current.processes === 0) return "gone";
	if (!previous || previous.at >= current.at || previous.processes === 0) return "unknown";
	return current.seconds - previous.seconds >= minCpuSeconds ? "working" : "no-progress";
}

/** Boss-facing evidence line; `undefined` when there is nothing truthful to say. */
export function formatCpuEvidence(
	verdict: LivenessVerdict,
	previous: CpuSample | undefined,
	current: CpuSample,
): string | undefined {
	if (verdict === "gone") return "process tree gone (no surviving process for this worker)";
	if (verdict === "unknown" || !previous) return undefined;
	const windowSec = Math.max(1, Math.round((current.at - previous.at) / 1000));
	const delta = Math.max(0, current.seconds - previous.seconds);
	const detail = `CPU +${delta.toFixed(1)}s over last ${windowSec}s across ${current.processes} process(es)`;
	return verdict === "working" ? `busy — ${detail}` : `no measurable progress — ${detail}`;
}
