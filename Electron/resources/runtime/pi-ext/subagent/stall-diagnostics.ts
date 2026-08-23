/**
 * Low-overhead stall observability. Metadata only — never records prompt,
 * tool arguments, or stdout/stderr text. Does not change stall/abort policy.
 */

import {
	type AgentFinalizationPhase,
	type FinalizationFields,
	isTerminalFinalizingPhase,
	snapshotFinalizationFields,
} from "./finalization-phase.ts";

export type StallWatchdogDecision =
	| "ignore"
	| "output-recent"
	| "cpu-progress"
	| "tool-quiet-alive"
	| "no-process"
	| "process-exited"
	| "first-stall-notify"
	| "final-abort";

export type StallCpuVerdict = "working" | "no-progress" | "gone" | "unknown";

export interface StallDiagnosticsState extends FinalizationFields {
	processGeneration: string;
	supervisorPid: number;
	eventSeq: number;
	lastOutputAt?: number;
	lastToolStartAt?: number;
	lastToolEndAt?: number;
	lastStdoutAt?: number;
	lastStderrAt?: number;
	stdoutBytes: number;
	stderrBytes: number;
	lastCpuSampleAt?: number;
	lastCpuDeltaMs?: number;
	lastWatchdogDecision?: StallWatchdogDecision;
	lastWatchdogReason?: string;
	abortReason?: string;
	exitReason?: string;
}

export interface AgentDiagnosticsSnapshot extends FinalizationFields {
	agentId: string;
	runId: string;
	eventSeq: number;
	processGeneration: string;
	supervisorPid: number;
	childPid?: number;
	lastActivityAt: number;
	lastOutputAt?: number;
	lastToolAt?: number;
	lastStdoutAt?: number;
	lastStderrAt?: number;
	stdoutBytes: number;
	stderrBytes: number;
	toolWaitName?: string;
	lastCpuSampleAt?: number;
	lastCpuDeltaMs?: number;
	cpuVerdict?: StallCpuVerdict;
	watchdogDecision?: StallWatchdogDecision;
	watchdogReason?: string;
	abortReason?: string;
	exitReason?: string;
}

export function createProcessGeneration(pid = process.pid, startedAt = Date.now()): string {
	return `${pid}:${startedAt}`;
}

export const SUPERVISOR_PROCESS_GENERATION = createProcessGeneration();
export const SUPERVISOR_PID = process.pid;

export function createStallDiagnosticsState(
	generation = SUPERVISOR_PROCESS_GENERATION,
	supervisorPid = SUPERVISOR_PID,
): StallDiagnosticsState {
	return {
		processGeneration: generation,
		supervisorPid,
		eventSeq: 0,
		stdoutBytes: 0,
		stderrBytes: 0,
	};
}

export function bumpDiagnosticsSeq(state: StallDiagnosticsState): number {
	state.eventSeq += 1;
	return state.eventSeq;
}

export function noteDiagnosticsIo(
	state: StallDiagnosticsState,
	stream: "stdout" | "stderr",
	bytes: number,
	at: number,
): void {
	const n = Number.isFinite(bytes) && bytes > 0 ? Math.floor(bytes) : 0;
	if (n <= 0) return;
	if (stream === "stdout") {
		state.stdoutBytes += n;
		state.lastStdoutAt = at;
	} else {
		state.stderrBytes += n;
		state.lastStderrAt = at;
	}
	state.lastOutputAt = at;
	bumpDiagnosticsSeq(state);
}

export function noteDiagnosticsToolStart(state: StallDiagnosticsState, at: number): void {
	state.lastToolStartAt = at;
	bumpDiagnosticsSeq(state);
}

export function noteDiagnosticsToolEnd(state: StallDiagnosticsState, at: number): void {
	state.lastToolEndAt = at;
	bumpDiagnosticsSeq(state);
}

export function noteDiagnosticsCpuSample(
	state: StallDiagnosticsState,
	at: number,
	deltaMs: number | undefined,
): void {
	state.lastCpuSampleAt = at;
	if (deltaMs !== undefined && Number.isFinite(deltaMs)) state.lastCpuDeltaMs = Math.round(deltaMs);
	bumpDiagnosticsSeq(state);
}

export function noteDiagnosticsAbort(state: StallDiagnosticsState, reason: string): void {
	state.abortReason = reason;
	bumpDiagnosticsSeq(state);
}

export function isGenericChildClose(reason: string): boolean {
	return reason === "child-close";
}

export function isSpecificChildClose(reason: string | undefined): boolean {
	return typeof reason === "string" && /^child-close:.+/.test(reason);
}

/** Keep a coded child-close over a later generic `child-close`. */
export function preferSpecificExitReason(existing: string | undefined, incoming: string): string {
	if (existing && existing !== incoming && isSpecificChildClose(existing) && isGenericChildClose(incoming)) {
		return existing;
	}
	return incoming;
}

export function noteDiagnosticsExit(state: StallDiagnosticsState, reason: string): void {
	const next = preferSpecificExitReason(state.exitReason, reason);
	if (state.exitReason === next) return;
	state.exitReason = next;
	bumpDiagnosticsSeq(state);
}

/** Child/worker is known gone. Returns true when the watchdog decision changed. */
export function noteDiagnosticsChildExit(state: StallDiagnosticsState, reason: string): boolean {
	const kept = preferSpecificExitReason(state.exitReason, reason);
	noteDiagnosticsExit(state, kept);
	return recordWatchdogDecision(state, "process-exited", kept);
}

/** Returns true when the structured decision actually changed. */
export function recordWatchdogDecision(
	state: StallDiagnosticsState,
	decision: StallWatchdogDecision,
	reason: string,
): boolean {
	const changed = state.lastWatchdogDecision !== decision || state.lastWatchdogReason !== reason;
	if (!changed) return false;
	state.lastWatchdogDecision = decision;
	state.lastWatchdogReason = reason;
	bumpDiagnosticsSeq(state);
	return true;
}

export function classifyWatchdogProbe(input: {
	inTool: boolean;
	stalled: boolean;
	stallAction: "ignore" | "notify" | "abort";
	stallNotifyCount: number;
	childPid?: number;
	finalizing: boolean;
	finalizationPhase?: AgentFinalizationPhase;
	cpuVerdict?: StallCpuVerdict;
	lastOutputAt?: number;
	lastActivityAt: number;
	now: number;
	outputRecentMs?: number;
}): { decision: StallWatchdogDecision; reason: string } {
	if (input.stallAction === "abort") {
		return { decision: "final-abort", reason: "watchdog-abort" };
	}
	if (input.finalizing || isTerminalFinalizingPhase(input.finalizationPhase) || input.cpuVerdict === "gone") {
		return {
			decision: "process-exited",
			reason: input.finalizing || isTerminalFinalizingPhase(input.finalizationPhase)
				? (input.finalizationPhase ? `child-finalizing:${input.finalizationPhase}` : "child-finalizing")
				: "cpu-tree-gone",
		};
	}
	if (input.childPid === undefined) {
		return { decision: "no-process", reason: "no-child-pid" };
	}
	if (input.stallAction === "notify" && input.stallNotifyCount === 0 && input.stalled) {
		return { decision: "first-stall-notify", reason: "watchdog-notify" };
	}
	const recentMs = input.outputRecentMs ?? 15_000;
	if (input.lastOutputAt !== undefined && input.now - input.lastOutputAt < recentMs) {
		return { decision: "output-recent", reason: "child-io" };
	}
	if (input.inTool && !input.stalled && input.cpuVerdict === "working") {
		return { decision: "cpu-progress", reason: "tool-quiet-cpu-advancing" };
	}
	if (input.inTool && !input.stalled) {
		return { decision: "tool-quiet-alive", reason: "tool-quiet-not-stalled" };
	}
	return { decision: "ignore", reason: "below-threshold" };
}

export function snapshotStallDiagnostics(input: {
	agentId: string;
	runId: string;
	state: StallDiagnosticsState;
	lastActivityAt: number;
	childPid?: number;
	toolWaitName?: string;
	cpuVerdict?: StallCpuVerdict;
}): AgentDiagnosticsSnapshot {
	const lastToolAt = input.state.lastToolEndAt ?? input.state.lastToolStartAt;
	return {
		agentId: input.agentId,
		runId: input.runId,
		eventSeq: input.state.eventSeq,
		processGeneration: input.state.processGeneration,
		supervisorPid: input.state.supervisorPid,
		...(input.childPid !== undefined ? { childPid: input.childPid } : {}),
		lastActivityAt: input.lastActivityAt,
		...(input.state.lastOutputAt !== undefined ? { lastOutputAt: input.state.lastOutputAt } : {}),
		...(lastToolAt !== undefined ? { lastToolAt } : {}),
		...(input.state.lastStdoutAt !== undefined ? { lastStdoutAt: input.state.lastStdoutAt } : {}),
		...(input.state.lastStderrAt !== undefined ? { lastStderrAt: input.state.lastStderrAt } : {}),
		stdoutBytes: input.state.stdoutBytes,
		stderrBytes: input.state.stderrBytes,
		...(input.toolWaitName ? { toolWaitName: input.toolWaitName } : {}),
		...(input.state.lastCpuSampleAt !== undefined ? { lastCpuSampleAt: input.state.lastCpuSampleAt } : {}),
		...(input.state.lastCpuDeltaMs !== undefined ? { lastCpuDeltaMs: input.state.lastCpuDeltaMs } : {}),
		...(input.cpuVerdict ? { cpuVerdict: input.cpuVerdict } : {}),
		...(input.state.lastWatchdogDecision ? { watchdogDecision: input.state.lastWatchdogDecision } : {}),
		...(input.state.lastWatchdogReason ? { watchdogReason: input.state.lastWatchdogReason } : {}),
		...(input.state.abortReason ? { abortReason: input.state.abortReason } : {}),
		...(input.state.exitReason ? { exitReason: input.state.exitReason } : {}),
		...snapshotFinalizationFields(input.state),
	};
}

export function formatDiagnosticsCompactLine(snapshot: AgentDiagnosticsSnapshot): string {
	const parts = [
		`seq=${snapshot.eventSeq}`,
		`gen=${snapshot.processGeneration}`,
		`supervisor=${snapshot.supervisorPid}`,
		snapshot.childPid !== undefined ? `child=${snapshot.childPid}` : "child=-",
		snapshot.toolWaitName ? `tool=${snapshot.toolWaitName}` : undefined,
		snapshot.lastCpuDeltaMs !== undefined ? `cpuDeltaMs=${snapshot.lastCpuDeltaMs}` : undefined,
		snapshot.cpuVerdict ? `cpu=${snapshot.cpuVerdict}` : undefined,
		snapshot.watchdogDecision ? `decision=${snapshot.watchdogDecision}` : undefined,
		snapshot.watchdogReason ? `reason=${snapshot.watchdogReason}` : undefined,
		`io=${snapshot.stdoutBytes}+${snapshot.stderrBytes}`,
	];
	return parts.filter((part): part is string => Boolean(part)).join(" ");
}

export function logStallProbe(event: string, fields: Record<string, string | number | undefined>): void {
	const parts = Object.entries(fields)
		.filter(([, value]) => value !== undefined && value !== "")
		.map(([key, value]) => `${key}=${value}`);
	console.error(`[pipiui-stall] event=${event}${parts.length ? ` ${parts.join(" ")}` : ""}`);
}

export function ioByteLength(data: unknown): number {
	if (typeof data === "string") return Buffer.byteLength(data);
	if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) return data.length;
	if (data instanceof Uint8Array) return data.byteLength;
	return 0;
}
