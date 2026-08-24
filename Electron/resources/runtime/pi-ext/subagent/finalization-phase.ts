/**
 * Metadata-only finalization phases. Never records prompt, tool args,
 * stdout/stderr, or the assistant summary body.
 */

export const AGENT_FINALIZATION_PHASES = [
	"generating",
	"tool-active",
	"final-received",
	"verifying",
	"queue-wait",
	"reconciling",
	"merging",
	"on-merged",
	"cleaning",
	"post-verify",
	"done-await-host",
] as const;

export type AgentFinalizationPhase = (typeof AGENT_FINALIZATION_PHASES)[number];

export type FinalizationFields = {
	finalizationPhase?: AgentFinalizationPhase;
	phaseSince?: number;
	lastPhaseError?: string;
	childExitedAt?: number;
	verifyPid?: number;
	verifyElapsedMs?: number;
	queueWaitElapsedMs?: number;
	reconcileElapsedMs?: number;
	mergeElapsedMs?: number;
	onMergedElapsedMs?: number;
	cleanupElapsedMs?: number;
	postVerifyElapsedMs?: number;
	doneEventSeq?: number;
};

export type FinalizationTransitionExtras = {
	error?: string;
	childExitedAt?: number;
	verifyPid?: number;
	doneEventSeq?: number;
};

const PHASE_RANK = new Map<AgentFinalizationPhase, number>(
	AGENT_FINALIZATION_PHASES.map((phase, index) => [phase, index]),
);

const ELAPSED_ON_LEAVE: Partial<Record<AgentFinalizationPhase, keyof Pick<
	FinalizationFields,
	"verifyElapsedMs" | "queueWaitElapsedMs" | "reconcileElapsedMs" | "mergeElapsedMs" | "onMergedElapsedMs" | "cleanupElapsedMs" | "postVerifyElapsedMs"
>>> = {
	verifying: "verifyElapsedMs",
	"queue-wait": "queueWaitElapsedMs",
	reconciling: "reconcileElapsedMs",
	merging: "mergeElapsedMs",
	"on-merged": "onMergedElapsedMs",
	cleaning: "cleanupElapsedMs",
	"post-verify": "postVerifyElapsedMs",
};

export function isAgentFinalizationPhase(value: unknown): value is AgentFinalizationPhase {
	return typeof value === "string" && PHASE_RANK.has(value as AgentFinalizationPhase);
}

export function finalizationPhaseRank(phase: AgentFinalizationPhase): number {
	return PHASE_RANK.get(phase) ?? -1;
}

/** Summary is in, or a later closeout step has started. */
export function isTerminalFinalizingPhase(phase: AgentFinalizationPhase | undefined): boolean {
	return phase !== undefined && finalizationPhaseRank(phase) >= finalizationPhaseRank("final-received");
}

export function canTransitionFinalizationPhase(
	from: AgentFinalizationPhase | undefined,
	to: AgentFinalizationPhase,
): boolean {
	if (!from || from === to) return true;
	const fromRank = finalizationPhaseRank(from);
	const toRank = finalizationPhaseRank(to);
	const finalRank = finalizationPhaseRank("final-received");
	if (fromRank < finalRank && toRank < finalRank) return true;
	return toRank > fromRank;
}

function applyExtras(state: FinalizationFields, extras?: FinalizationTransitionExtras): void {
	if (!extras) return;
	if (extras.error !== undefined) {
		const trimmed = extras.error.trim();
		if (trimmed) state.lastPhaseError = trimmed.slice(0, 80);
	}
	if (extras.childExitedAt !== undefined && Number.isFinite(extras.childExitedAt)) {
		state.childExitedAt = extras.childExitedAt;
	}
	if (extras.verifyPid !== undefined && Number.isFinite(extras.verifyPid)) {
		state.verifyPid = extras.verifyPid;
	}
	if (extras.doneEventSeq !== undefined && Number.isFinite(extras.doneEventSeq)) {
		state.doneEventSeq = extras.doneEventSeq;
	}
}

function recordElapsed(state: FinalizationFields, leaving: AgentFinalizationPhase, now: number): void {
	const field = ELAPSED_ON_LEAVE[leaving];
	if (!field || state.phaseSince === undefined) return;
	const elapsed = Math.max(0, now - state.phaseSince);
	if (state[field] === undefined) state[field] = elapsed;
}

export function applyFinalizationTransition(
	state: FinalizationFields,
	next: AgentFinalizationPhase,
	now: number,
	extras?: FinalizationTransitionExtras,
): boolean {
	const current = state.finalizationPhase;
	if (current === next) {
		applyExtras(state, extras);
		return false;
	}
	if (!canTransitionFinalizationPhase(current, next)) {
		applyExtras(state, extras);
		return false;
	}
	if (current) recordElapsed(state, current, now);
	state.finalizationPhase = next;
	state.phaseSince = now;
	if (!extras?.error) delete state.lastPhaseError;
	if (next !== "verifying" && extras?.verifyPid === undefined) delete state.verifyPid;
	applyExtras(state, extras);
	return true;
}

export function noteFinalizationDetails(
	state: FinalizationFields,
	extras: FinalizationTransitionExtras,
): void {
	applyExtras(state, extras);
}

export function resetFinalizationFields(state: FinalizationFields): void {
	delete state.finalizationPhase;
	delete state.phaseSince;
	delete state.lastPhaseError;
	delete state.childExitedAt;
	delete state.verifyPid;
	delete state.verifyElapsedMs;
	delete state.queueWaitElapsedMs;
	delete state.reconcileElapsedMs;
	delete state.mergeElapsedMs;
	delete state.onMergedElapsedMs;
	delete state.cleanupElapsedMs;
	delete state.postVerifyElapsedMs;
	delete state.doneEventSeq;
}

export function snapshotFinalizationFields(state: FinalizationFields): FinalizationFields {
	const next: FinalizationFields = {};
	if (state.finalizationPhase) next.finalizationPhase = state.finalizationPhase;
	if (state.phaseSince !== undefined) next.phaseSince = state.phaseSince;
	if (state.lastPhaseError) next.lastPhaseError = state.lastPhaseError;
	if (state.childExitedAt !== undefined) next.childExitedAt = state.childExitedAt;
	if (state.verifyPid !== undefined) next.verifyPid = state.verifyPid;
	if (state.verifyElapsedMs !== undefined) next.verifyElapsedMs = state.verifyElapsedMs;
	if (state.queueWaitElapsedMs !== undefined) next.queueWaitElapsedMs = state.queueWaitElapsedMs;
	if (state.reconcileElapsedMs !== undefined) next.reconcileElapsedMs = state.reconcileElapsedMs;
	if (state.mergeElapsedMs !== undefined) next.mergeElapsedMs = state.mergeElapsedMs;
	if (state.onMergedElapsedMs !== undefined) next.onMergedElapsedMs = state.onMergedElapsedMs;
	if (state.cleanupElapsedMs !== undefined) next.cleanupElapsedMs = state.cleanupElapsedMs;
	if (state.postVerifyElapsedMs !== undefined) next.postVerifyElapsedMs = state.postVerifyElapsedMs;
	if (state.doneEventSeq !== undefined) next.doneEventSeq = state.doneEventSeq;
	return next;
}
