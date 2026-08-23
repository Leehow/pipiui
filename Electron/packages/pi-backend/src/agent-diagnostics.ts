import type { AgentDiagnostics, AgentFinalizationPhase, AgentSummary } from "@pipi/host-api";

const CPU_VERDICTS = new Set(["working", "no-progress", "gone", "unknown"]);
const FINALIZATION_PHASE_ORDER: AgentFinalizationPhase[] = [
  "generating",
  "tool-active",
  "final-received",
  "verifying",
  "reconciling",
  "merging",
  "cleaning",
  "post-verify",
  "done-await-host",
];
const FINALIZATION_PHASES = new Set<AgentFinalizationPhase>(FINALIZATION_PHASE_ORDER);

function finalizationPhaseRank(phase: AgentFinalizationPhase | undefined): number {
  return phase ? FINALIZATION_PHASE_ORDER.indexOf(phase) : -1;
}

/** `pid:startedAt` from createProcessGeneration. Missing or unparseable → undefined. */
function generationStartedAt(generation: string | undefined): number | undefined {
  if (!generation) return undefined;
  const sep = generation.lastIndexOf(":");
  if (sep < 0) return undefined;
  const startedAt = Number(generation.slice(sep + 1));
  return Number.isFinite(startedAt) ? startedAt : undefined;
}

type ProcessGenerationRelation = "same" | "incoming-new" | "incoming-old" | "legacy";

/** Generation identity first. Do not rank lifecycles by phaseSince across gens. */
function classifyProcessGeneration(
  incoming?: AgentDiagnostics,
  previous?: AgentDiagnostics,
): ProcessGenerationRelation {
  const incomingGen = incoming?.processGeneration;
  const previousGen = previous?.processGeneration;
  if (!incomingGen || !previousGen) return "legacy";
  if (incomingGen === previousGen) return "same";
  const incomingStartedAt = generationStartedAt(incomingGen);
  const previousStartedAt = generationStartedAt(previousGen);
  if (incomingStartedAt !== undefined && previousStartedAt !== undefined) {
    return incomingStartedAt < previousStartedAt ? "incoming-old" : "incoming-new";
  }
  // Different but unparseable: treat as a new lifecycle rather than guessing clocks.
  return "incoming-new";
}

function incomingPhaseRollback(
  incoming: AgentDiagnostics,
  previous: AgentDiagnostics,
): boolean {
  const incomingRank = finalizationPhaseRank(incoming.finalizationPhase);
  const previousRank = finalizationPhaseRank(previous.finalizationPhase);
  // Missing phase is not a rollback: legacy cpu-only updates and explicit-null
  // phase clears must still apply. A named lower rank is a rewind.
  return incomingRank >= 0 && previousRank >= 0 && incomingRank < previousRank;
}

/** Late replay: older seq in the same/legacy generation, a same-gen phase rewind, or any event from an older generation. */
function incomingDiagnosticsStale(
  incoming: AgentDiagnostics | undefined,
  previous: AgentDiagnostics | undefined,
): boolean {
  if (!incoming || !previous) return false;
  const relation = classifyProcessGeneration(incoming, previous);
  if (relation === "incoming-old") return true;
  if (relation === "incoming-new") return false;
  if (incoming.eventSeq !== undefined
    && previous.eventSeq !== undefined
    && incoming.eventSeq < previous.eventSeq) {
    return true;
  }
  // Same/legacy generation: a lower phase is a rewind even when eventSeq is newer.
  return incomingPhaseRollback(incoming, previous);
}

function shouldKeepPreviousPhase(incoming: AgentDiagnostics, previous: AgentDiagnostics): boolean {
  if (classifyProcessGeneration(incoming, previous) === "incoming-new") return false;
  const incomingRank = finalizationPhaseRank(incoming.finalizationPhase);
  const previousRank = finalizationPhaseRank(previous.finalizationPhase);
  if (incomingRank < 0 || previousRank < 0) return false;
  if (incomingRank < previousRank) return true;
  return incomingRank === previousRank
    && incoming.phaseSince !== undefined
    && previous.phaseSince !== undefined
    && incoming.phaseSince < previous.phaseSince;
}

const STRING_KEYS = [
  "agentId",
  "runId",
  "processGeneration",
  "toolWaitName",
  "watchdogDecision",
  "watchdogReason",
  "abortReason",
  "exitReason",
  "lastPhaseError",
  "hostGeneration",
] as const;

const NUMBER_KEYS = [
  "eventSeq",
  "supervisorPid",
  "childPid",
  "lastActivityAt",
  "lastOutputAt",
  "lastToolAt",
  "lastStdoutAt",
  "lastStderrAt",
  "stdoutBytes",
  "stderrBytes",
  "lastCpuSampleAt",
  "lastCpuDeltaMs",
  "phaseSince",
  "childExitedAt",
  "verifyPid",
  "verifyElapsedMs",
  "reconcileElapsedMs",
  "mergeElapsedMs",
  "cleanupElapsedMs",
  "doneEventSeq",
] as const;

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function asPhase(value: unknown): AgentFinalizationPhase | undefined {
  return typeof value === "string" && FINALIZATION_PHASES.has(value as AgentFinalizationPhase)
    ? value as AgentFinalizationPhase
    : undefined;
}

/** Copy only metadata fields. Never retain prompt, args, or output text. Missing keys stay missing. */
export function sanitizeAgentDiagnostics(raw: unknown): AgentDiagnostics | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const next: AgentDiagnostics = {};
  for (const key of STRING_KEYS) {
    if (!hasOwn(value, key) || value[key] === null) continue;
    const parsed = asString(value[key]);
    if (parsed !== undefined) next[key] = parsed;
  }
  for (const key of NUMBER_KEYS) {
    if (!hasOwn(value, key) || value[key] === null) continue;
    const parsed = asFiniteNumber(value[key]);
    if (parsed !== undefined) next[key] = parsed;
  }
  if (hasOwn(value, "cpuVerdict") && value.cpuVerdict !== null) {
    const cpuVerdict = asString(value.cpuVerdict);
    if (cpuVerdict && CPU_VERDICTS.has(cpuVerdict)) next.cpuVerdict = cpuVerdict as AgentDiagnostics["cpuVerdict"];
  }
  if (hasOwn(value, "finalizationPhase") && value.finalizationPhase !== null) {
    const phase = asPhase(value.finalizationPhase);
    if (phase) next.finalizationPhase = phase;
  }
  if (hasOwn(value, "generationMatch") && typeof value.generationMatch === "boolean") {
    next.generationMatch = value.generationMatch;
  }
  if (hasOwn(value, "persistedRunning") && typeof value.persistedRunning === "boolean") {
    next.persistedRunning = value.persistedRunning;
  }
  if (value.reconciliation === "interrupted" || value.reconciliation === "none") {
    next.reconciliation = value.reconciliation;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

/** Keys present as JSON null on the wire. Missing keys are not listed. */
export function explicitNullDiagnosticKeys(raw: unknown): string[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const value = raw as Record<string, unknown>;
  const keys = [
    ...STRING_KEYS,
    ...NUMBER_KEYS,
    "cpuVerdict",
    "finalizationPhase",
    "generationMatch",
    "persistedRunning",
    "reconciliation",
  ] as const;
  return keys.filter((key) => hasOwn(value, key) && value[key] === null);
}

export function enrichHostDiagnostics(
  incoming: AgentDiagnostics | undefined,
  previous: AgentDiagnostics | undefined,
  host: { receivedAt: number; generation: string },
  cleared: readonly string[] = [],
): AgentDiagnostics | undefined {
  if (!incoming && !previous && cleared.length === 0) return undefined;
  const stale = incomingDiagnosticsStale(incoming, previous);
  // Stale/rejected packets must not LWW diagnostics, host receipt, or vanished marks.
  if (stale) return previous ? { ...previous } : undefined;
  const relation = classifyProcessGeneration(incoming, previous);
  const base: AgentDiagnostics = relation === "incoming-new"
    ? { ...(incoming ?? {}) }
    : { ...(previous ?? {}), ...(incoming ?? {}) };
  if (incoming && previous && shouldKeepPreviousPhase(incoming, previous)) {
    if (previous.finalizationPhase) base.finalizationPhase = previous.finalizationPhase;
    if (previous.phaseSince !== undefined) base.phaseSince = previous.phaseSince;
  }
  for (const key of cleared) {
    delete (base as Record<string, unknown>)[key];
  }
  // Accepted live (same-gen new event or new generation): drop vanished remnants.
  // Keep a restated lastPhaseError, and never drop a real non-vanished error.
  if (incoming && incoming.lastPhaseError === undefined && base.lastPhaseError === "process-missing") {
    delete (base as Record<string, unknown>).lastPhaseError;
  }
  const previousSeq = previous?.eventSeq;
  const nextSeq = incoming?.eventSeq ?? previousSeq;
  const seqGap = incoming?.eventSeq !== undefined && previousSeq !== undefined
    ? incoming.eventSeq - previousSeq
    : undefined;
  const runtimeGeneration = incoming?.processGeneration ?? previous?.processGeneration;
  const previousHostGeneration = previous?.hostGeneration;
  const processGenerationMatch = relation === "incoming-new"
    || runtimeGeneration === undefined
    || incoming?.processGeneration === undefined
    || incoming.processGeneration === (previous?.processGeneration ?? incoming.processGeneration);
  const generationMatch = processGenerationMatch
    && (previousHostGeneration === undefined || previousHostGeneration === host.generation);
  return {
    ...base,
    hostReceivedAt: incoming ? host.receivedAt : previous?.hostReceivedAt,
    hostEventSeq: nextSeq,
    lastHostEventSeq: previousSeq,
    ...(seqGap !== undefined ? { seqGap } : {}),
    generationMatch,
    hostGeneration: host.generation,
    persistedRunning: previous?.persistedRunning === true && incoming === undefined ? true : undefined,
    reconciliation: incoming ? undefined : previous?.reconciliation,
  };
}

export function markPersistedRunningReconciliation(
  agent: AgentSummary,
  host: { receivedAt: number; generation: string },
): AgentDiagnostics {
  return {
    ...(agent.diagnostics ?? {}),
    agentId: agent.agentId,
    runId: agent.runId,
    persistedRunning: true,
    generationMatch: false,
    reconciliation: "interrupted",
    lastPhaseError: agent.diagnostics?.lastPhaseError ?? "process-missing",
    watchdogReason: agent.diagnostics?.watchdogReason ?? "host-generation-mismatch",
    hostReceivedAt: host.receivedAt,
    hostGeneration: host.generation,
  };
}

export function applyTerminalHostReceipt(
  diagnostics: AgentDiagnostics | undefined,
  host: { receivedAt: number; generation: string },
): AgentDiagnostics {
  const next: AgentDiagnostics = {
    ...(diagnostics ?? {}),
    hostReceivedAt: host.receivedAt,
    hostGeneration: host.generation,
  };
  if (next.doneEventSeq === undefined && next.eventSeq !== undefined) next.doneEventSeq = next.eventSeq;
  return next;
}
