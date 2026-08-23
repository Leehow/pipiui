import type { AgentDiagnostics, AgentSummary } from "@pipi/host-api";

const CPU_VERDICTS = new Set(["working", "no-progress", "gone", "unknown"]);

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** Copy only metadata fields. Never retain prompt, args, or output text. */
export function sanitizeAgentDiagnostics(raw: unknown): AgentDiagnostics | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const cpuVerdict = asString(value.cpuVerdict);
  const next: AgentDiagnostics = {
    agentId: asString(value.agentId),
    runId: asString(value.runId),
    eventSeq: asFiniteNumber(value.eventSeq),
    processGeneration: asString(value.processGeneration),
    supervisorPid: asFiniteNumber(value.supervisorPid),
    childPid: asFiniteNumber(value.childPid),
    lastActivityAt: asFiniteNumber(value.lastActivityAt),
    lastOutputAt: asFiniteNumber(value.lastOutputAt),
    lastToolAt: asFiniteNumber(value.lastToolAt),
    lastStdoutAt: asFiniteNumber(value.lastStdoutAt),
    lastStderrAt: asFiniteNumber(value.lastStderrAt),
    stdoutBytes: asFiniteNumber(value.stdoutBytes),
    stderrBytes: asFiniteNumber(value.stderrBytes),
    toolWaitName: asString(value.toolWaitName),
    lastCpuSampleAt: asFiniteNumber(value.lastCpuSampleAt),
    lastCpuDeltaMs: asFiniteNumber(value.lastCpuDeltaMs),
    cpuVerdict: cpuVerdict && CPU_VERDICTS.has(cpuVerdict)
      ? cpuVerdict as AgentDiagnostics["cpuVerdict"]
      : undefined,
    watchdogDecision: asString(value.watchdogDecision),
    watchdogReason: asString(value.watchdogReason),
    abortReason: asString(value.abortReason),
    exitReason: asString(value.exitReason),
  };
  return Object.values(next).some((field) => field !== undefined) ? next : undefined;
}

export function enrichHostDiagnostics(
  incoming: AgentDiagnostics | undefined,
  previous: AgentDiagnostics | undefined,
  host: { receivedAt: number; generation: string },
): AgentDiagnostics | undefined {
  if (!incoming && !previous) return undefined;
  const base = { ...(previous ?? {}), ...(incoming ?? {}) };
  const previousSeq = previous?.eventSeq;
  const nextSeq = incoming?.eventSeq ?? previousSeq;
  const seqGap = incoming?.eventSeq !== undefined && previousSeq !== undefined
    ? incoming.eventSeq - previousSeq
    : undefined;
  const runtimeGeneration = incoming?.processGeneration ?? previous?.processGeneration;
  const previousHostGeneration = previous?.hostGeneration;
  const generationMatch = (runtimeGeneration === undefined || incoming?.processGeneration === undefined
    || incoming.processGeneration === (previous?.processGeneration ?? incoming.processGeneration))
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
    watchdogReason: agent.diagnostics?.watchdogReason ?? "host-generation-mismatch",
    hostReceivedAt: host.receivedAt,
    hostGeneration: host.generation,
  };
}
