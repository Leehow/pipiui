import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";

import type { SessionPerformance, TurnTelemetryRendererSample } from "@pipi/host-api";

/** Current host-owned replacement for the stale historical turns.jsonl writer. */
export const TURN_TELEMETRY_DIRECTORY = "telemetry";
export const TURN_TELEMETRY_FILENAME = "turns.jsonl";
export const TURN_TELEMETRY_BACKUP_SUFFIX = ".1";
export const TURN_TELEMETRY_VERSION = 2 as const;
/** One live file plus one rotation are retained. */
export const TURN_TELEMETRY_MAX_BYTES = 5 * 1024 * 1024;
/** Close must never hang host shutdown on a telemetry filesystem failure. */
export const TURN_TELEMETRY_CLOSE_TIMEOUT_MS = 250;
/** Maximum performance samples retained for one session in memory. */
export const TURN_TELEMETRY_MAX_PERFORMANCE_SAMPLES = 32;
/** Maximum inactive session aggregates retained by one host process. */
export const TURN_TELEMETRY_MAX_PERFORMANCE_SESSIONS = 128;
/** Maximum terminal records waiting behind one in-flight filesystem write. */
export const TURN_TELEMETRY_MAX_PENDING_WRITES = 256;

const MAX_TURN_ID_LENGTH = 64;
const MAX_OPEN_SUBMISSIONS = 256;
/** The allowlisted record is far smaller; this protects rotation from old huge files. */
const MAX_RECORD_BYTES = 4 * 1024;

type PhaseName =
  | "renderer_submit"
  | "renderer_preflight_start"
  | "renderer_preflight_end"
  | "host_received"
  | "host_queued"
  | "host_preparation_start"
  | "host_preparation_end"
  | "pi_dispatch"
  | "pi_dispatch_accepted"
  | "pi_agent_start"
  | "first_stream"
  | "first_thinking"
  | "first_text"
  | "first_assistant"
  | "tool_activity"
  | "settled"
  | "stopped"
  | "error";

export type TurnTelemetryPhase = { name: PhaseName; at: number };
export type TurnResourceSample = { rssBytes?: number; childCount?: number };
export type TurnTelemetryMetrics = {
  promptBytes?: number;
  attachmentCount?: number;
  attachmentBytes?: number;
  documentCount?: number;
  piRpcBytes?: number;
  assistantMessageCount?: number;
  toolResultCount?: number;
  /** Exact first provider response usage only; later tool-loop steps are counted, not merged into a false rate. */
  inputTokens?: number;
  outputTokens?: number;
  contextTokens?: number;
  contextWindow?: number;
};
export type TurnTelemetryDurations = {
  rendererPreflightMs?: number;
  hostQueueMs?: number;
  hostPreparationMs?: number;
  piDispatchMs?: number;
  ttftMs?: number;
  generationMs?: number;
  turnMs?: number;
};
export type TurnTelemetryRecord = {
  v: typeof TURN_TELEMETRY_VERSION;
  turnId: string;
  outcome: "settled" | "stopped" | "error";
  phases: TurnTelemetryPhase[];
  durations?: TurnTelemetryDurations;
  metrics?: TurnTelemetryMetrics;
  resources?: { start?: TurnResourceSample; end?: TurnResourceSample };
  performance?: { ttftMs?: number; tokensPerSecond?: number };
};

export type TurnTelemetryOptions = {
  agentDir: string;
  now?: () => number;
  /** Host-owned sample only. FD count is deliberately omitted: Node has no portable truthful API. */
  resourceSample?: () => TurnResourceSample | undefined;
  append?: (file: string, line: string) => Promise<void>;
  stat?: (file: string) => Promise<{ size: number }>;
  rotate?: (file: string, backup: string) => Promise<void>;
  maxBytes?: number;
  closeTimeoutMs?: number;
  /** Test/host override for the process-wide inactive-session cap. */
  maxPerformanceSessions?: number;
  debug?: boolean | (() => boolean);
};

type OpenTurn = {
  sessionId: string;
  turnId: string;
  phases: TurnTelemetryPhase[];
  hostReceivedAt: number;
  queuedAt?: number;
  preparationStartedAt?: number;
  preparationEndedAt?: number;
  piDispatchAt?: number;
  piDispatchAcceptedAt?: number;
  /** First provider stream event; textual output is tracked separately below. */
  firstStreamAt?: number;
  firstTextAt?: number;
  firstAssistantAt?: number;
  terminalAt?: number;
  outcome?: TurnTelemetryRecord["outcome"];
  metrics: TurnTelemetryMetrics;
  startResources?: TurnResourceSample;
  endResources?: TurnResourceSample;
};

type PerformanceSample = { ttftMs?: number; tokensPerSecond?: number };

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const nonNegativeInteger = (value: unknown): number | undefined =>
  isFiniteNumber(value) && value >= 0 ? Math.floor(value) : undefined;
const timestamp = (value: unknown): number | undefined =>
  isFiniteNumber(value) && value >= 0 ? Math.floor(value) : undefined;
const boundedId = (value: unknown): value is string =>
  typeof value === "string"
  && value.length > 0
  && value.length <= MAX_TURN_ID_LENGTH
  && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
const nonNegativeDuration = (start: number | undefined, end: number | undefined): number | undefined =>
  start !== undefined && end !== undefined && end >= start ? end - start : undefined;
const nonEmpty = <T extends object>(value: T): T | undefined =>
  Object.keys(value).length ? value : undefined;

function debugOn(value: TurnTelemetryOptions["debug"]): boolean {
  return typeof value === "function" ? value() : value === true;
}

function logDebug(options: TurnTelemetryOptions, error: unknown): void {
  if (!debugOn(options.debug)) return;
  console.debug(`[turn-telemetry] ${error instanceof Error ? error.message : String(error)}`);
}

function sampleResources(value: TurnResourceSample | undefined): TurnResourceSample | undefined {
  if (!value) return undefined;
  const rssBytes = nonNegativeInteger(value.rssBytes);
  const childCount = nonNegativeInteger(value.childCount);
  return nonEmpty({ ...(rssBytes !== undefined ? { rssBytes } : {}), ...(childCount !== undefined ? { childCount } : {}) });
}

/**
 * Reject malformed/unbounded renderer input rather than letting a remote client
 * turn telemetry into a payload channel. Only measurements travel beyond this
 * boundary; message, attachment, document, and tool bodies have no field here.
 */
export function sanitizeRendererTurnTelemetry(value: unknown): TurnTelemetryRendererSample | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (!boundedId(raw.turnId)) return undefined;
  const submittedAt = timestamp(raw.submittedAt);
  if (submittedAt === undefined) return undefined;
  const preflightStartedAt = timestamp(raw.preflightStartedAt);
  const preflightEndedAt = timestamp(raw.preflightEndedAt);
  // A partial or unordered phase is not a measurement. Keep the valid submit
  // timestamp but omit the malformed renderer-preflight pair.
  const preflightValid = preflightStartedAt !== undefined
    && preflightEndedAt !== undefined
    && preflightStartedAt >= submittedAt
    && preflightEndedAt >= preflightStartedAt;
  const promptBytes = nonNegativeInteger(raw.promptBytes);
  const attachmentCount = nonNegativeInteger(raw.attachmentCount);
  const attachmentBytes = nonNegativeInteger(raw.attachmentBytes);
  const documentCount = nonNegativeInteger(raw.documentCount);
  return {
    turnId: raw.turnId,
    submittedAt,
    ...(preflightValid ? { preflightStartedAt, preflightEndedAt } : {}),
    ...(promptBytes !== undefined ? { promptBytes } : {}),
    ...(attachmentCount !== undefined ? { attachmentCount } : {}),
    ...(attachmentBytes !== undefined ? { attachmentBytes } : {}),
    ...(documentCount !== undefined ? { documentCount } : {}),
  };
}

export function turnTelemetryPath(agentDir: string): string {
  return join(agentDir, TURN_TELEMETRY_DIRECTORY, TURN_TELEMETRY_FILENAME);
}

export function turnTelemetryBackupPath(agentDir: string): string {
  return turnTelemetryPath(agentDir) + TURN_TELEMETRY_BACKUP_SUFFIX;
}

/** Explicit allowlist prevents future RPC fields from becoming telemetry by accident. */
export function serializeTurnTelemetryRecord(record: TurnTelemetryRecord): string {
  const safe: Record<string, unknown> = {
    v: TURN_TELEMETRY_VERSION,
    turnId: record.turnId,
    outcome: record.outcome,
    phases: record.phases.map((phase) => ({ name: phase.name, at: phase.at })),
  };
  if (record.durations && Object.keys(record.durations).length) safe.durations = record.durations;
  if (record.metrics && Object.keys(record.metrics).length) safe.metrics = record.metrics;
  if (record.resources && Object.keys(record.resources).length) safe.resources = record.resources;
  if (record.performance && Object.keys(record.performance).length) safe.performance = record.performance;
  return JSON.stringify(safe) + "\n";
}

async function defaultAppend(file: string, line: string): Promise<void> {
  await fs.mkdir(dirname(file), { recursive: true });
  await fs.appendFile(file, line, "utf8");
}

async function defaultStat(file: string): Promise<{ size: number }> {
  try {
    return await fs.stat(file);
  } catch (error) {
    if ((error as { code?: unknown })?.code === "ENOENT") return { size: 0 };
    throw error;
  }
}

async function defaultRotate(file: string, backup: string): Promise<void> {
  await fs.rm(backup, { force: true });
  try {
    await fs.rename(file, backup);
  } catch (error) {
    if ((error as { code?: unknown })?.code !== "ENOENT") throw error;
  }
}

function waitWithTimeout(promise: Promise<void>, timeoutMs: number): Promise<void> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    void promise.then(
      () => { clearTimeout(timer); resolve(); },
      () => { clearTimeout(timer); resolve(); },
    );
  });
}

function exactUsage(value: unknown): { inputTokens?: number; outputTokens?: number } {
  if (!value || typeof value !== "object") return {};
  const usage = value as Record<string, unknown>;
  const inputTokens = nonNegativeInteger(usage.input);
  const outputTokens = nonNegativeInteger(usage.output);
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
  };
}

/**
 * Records one UI-originated main turn at a time per session. It intentionally
 * knows nothing about prompt bodies or arbitrary RPC payloads: callers supply
 * only event shape and the explicitly measurable request byte length.
 */
export function createTurnTelemetry(options: TurnTelemetryOptions) {
  const now = options.now ?? (() => Date.now());
  const resourceSample = options.resourceSample;
  const append = options.append ?? defaultAppend;
  const stat = options.stat ?? defaultStat;
  const rotate = options.rotate ?? defaultRotate;
  const maxBytes = options.maxBytes ?? TURN_TELEMETRY_MAX_BYTES;
  const closeTimeoutMs = options.closeTimeoutMs ?? TURN_TELEMETRY_CLOSE_TIMEOUT_MS;
  const file = turnTelemetryPath(options.agentDir);
  const backup = turnTelemetryBackupPath(options.agentDir);
  const requestedPerformanceSessions = options.maxPerformanceSessions;
  const maxPerformanceSessions = requestedPerformanceSessions !== undefined
    && Number.isSafeInteger(requestedPerformanceSessions)
    && requestedPerformanceSessions > 0
    ? requestedPerformanceSessions
    : TURN_TELEMETRY_MAX_PERFORMANCE_SESSIONS;
  const pending = new Map<string, OpenTurn>();
  const active = new Map<string, OpenTurn>();
  /** Teardown fence: late events cannot recreate an OpenTurn for this session. */
  const fenced = new Set<string>();
  /** Insertion order is the deterministic least-recently-used order. */
  const performance = new Map<string, PerformanceSample[]>();
  const pendingLines: string[] = [];
  let writing = false;
  let chain = Promise.resolve();

  const clock = (): number => {
    try {
      const value = timestamp(now());
      return value ?? Date.now();
    } catch {
      return Date.now();
    }
  };

  const resources = (): TurnResourceSample | undefined => {
    try {
      return sampleResources(resourceSample?.());
    } catch {
      return undefined;
    }
  };

  const generatedId = (): string => `turn-${randomUUID().replace(/-/g, "").slice(0, 24)}`;

  function addPhase(turn: OpenTurn, name: PhaseName, at = clock()): void {
    if (turn.phases.some((phase) => phase.name === name) || turn.phases.length >= 18) return;
    turn.phases.push({ name, at });
  }

  function makeTurn(sessionId: string, renderer?: TurnTelemetryRendererSample): OpenTurn {
    const hostReceivedAt = clock();
    const turn: OpenTurn = {
      sessionId,
      turnId: renderer?.turnId ?? generatedId(),
      phases: [],
      hostReceivedAt,
      metrics: {
        ...(renderer?.promptBytes !== undefined ? { promptBytes: renderer.promptBytes } : {}),
        ...(renderer?.attachmentCount !== undefined ? { attachmentCount: renderer.attachmentCount } : {}),
        ...(renderer?.attachmentBytes !== undefined ? { attachmentBytes: renderer.attachmentBytes } : {}),
        ...(renderer?.documentCount !== undefined ? { documentCount: renderer.documentCount } : {}),
      },
    };
    // Renderer and host clocks may differ for a remote client. Do not invent a
    // cross-process ordering: retain its safe counts/id but omit timing unless
    // its measured submit precedes this host receipt on the same wall clock.
    const rendererTimingValid = renderer
      && renderer.submittedAt <= hostReceivedAt
      && (renderer.preflightEndedAt === undefined || renderer.preflightEndedAt <= hostReceivedAt);
    if (renderer && rendererTimingValid) {
      addPhase(turn, "renderer_submit", renderer.submittedAt);
      if (renderer.preflightStartedAt !== undefined && renderer.preflightEndedAt !== undefined) {
        addPhase(turn, "renderer_preflight_start", renderer.preflightStartedAt);
        addPhase(turn, "renderer_preflight_end", renderer.preflightEndedAt);
      }
    }
    addPhase(turn, "host_received", hostReceivedAt);
    return turn;
  }

  function trimPending(): void {
    while (pending.size > MAX_OPEN_SUBMISSIONS) {
      const oldest = pending.keys().next().value as string | undefined;
      if (!oldest) return;
      pending.delete(oldest);
    }
  }

  async function drainWrites(): Promise<void> {
    while (pendingLines.length) {
      const line = pendingLines.shift();
      if (!line) continue;
      try {
        await persist(line);
      } catch (error) {
        logDebug(options, error);
      }
    }
    writing = false;
  }

  function enqueue(line: string): void {
    if (pendingLines.length >= TURN_TELEMETRY_MAX_PENDING_WRITES) {
      // Keep the newest observations when storage is slower than the turn
      // stream; the in-flight write is never interrupted. Drop the queued
      // backlog as one bounded batch so the newest record does not wait behind
      // every stale line before it reaches storage.
      pendingLines.length = 0;
      logDebug(options, new Error("pending telemetry write cap reached; queued backlog dropped"));
    }
    pendingLines.push(line);
    if (writing) return;
    writing = true;
    chain = chain.then(drainWrites, drainWrites);
  }

  function trimPerformance(): void {
    while (performance.size > maxPerformanceSessions) {
      let evicted = false;
      for (const sessionId of performance.keys()) {
        // A session with an in-flight turn may still need its prior aggregate
        // when the turn settles; never evict it during that turn.
        if (active.has(sessionId)) continue;
        performance.delete(sessionId);
        evicted = true;
        break;
      }
      // All retained sessions are active. The cap applies to inactive history;
      // defer eviction until one of those turns becomes inactive.
      if (!evicted) return;
    }
  }

  function touchPerformance(sessionId: string, samples: PerformanceSample[]): void {
    performance.delete(sessionId);
    performance.set(sessionId, samples);
  }

  async function persist(line: string): Promise<void> {
    const size = (await stat(file)).size;
    if (size >= maxBytes) {
      // A normal rotated file is bounded by maxBytes plus one fixed-size record.
      // If an old writer left a huge append-only file, drop it instead of moving
      // an unbounded payload into the backup slot.
      if (size <= maxBytes + MAX_RECORD_BYTES) await rotate(file, backup);
      else {
        await fs.rm(file, { force: true });
        await fs.rm(backup, { force: true });
      }
    }
    await append(file, line);
  }

  function rendererSubmission(sessionId: string, input: unknown): TurnTelemetryRendererSample | undefined {
    if (fenced.has(sessionId)) return undefined;
    const renderer = sanitizeRendererTurnTelemetry(input);
    if (!renderer) return undefined;
    const collision = pending.get(renderer.turnId);
    const existing = active.get(sessionId);
    if (collision || existing?.turnId === renderer.turnId) return undefined;
    pending.set(renderer.turnId, makeTurn(sessionId, renderer));
    trimPending();
    return { ...renderer };
  }

  /** Drop a queued renderer sample after its message payload has been edited. */
  function discardRendererSubmission(turnId: string): void {
    pending.delete(turnId);
  }

  /** Drop pending/active state without inventing TTFT/TPS. */
  function dropSession(sessionId: string): void {
    for (const [turnId, turn] of pending) {
      if (turn.sessionId === sessionId) pending.delete(turnId);
    }
    const turn = active.get(sessionId);
    if (turn && turn.terminalAt === undefined) {
      turn.terminalAt = clock();
      turn.endResources = resources();
      if (turn.outcome !== "error") turn.outcome = "stopped";
      addPhase(turn, turn.outcome === "error" ? "error" : "stopped", turn.terminalAt);
    }
    if (active.has(sessionId)) flushTerminal(sessionId);
    performance.delete(sessionId);
  }

  /** Synchronous teardown fence: terminalize/drop and refuse late recreation. */
  function fenceSession(sessionId: string): void {
    fenced.add(sessionId);
    dropSession(sessionId);
  }

  /** Clear session state at the host's runtime teardown boundary. */
  function clearSession(sessionId: string): void {
    dropSession(sessionId);
  }

  /** Drop the fence after protected work has drained so a new session can start. */
  function reclaimSession(sessionId: string): void {
    fenced.delete(sessionId);
  }

  function hasActive(sessionId: string): boolean {
    return active.has(sessionId);
  }

  function retainedState(): { pending: number; active: number; fenced: number; performance: number } {
    return {
      pending: pending.size,
      active: active.size,
      fenced: fenced.size,
      performance: performance.size,
    };
  }

  function markQueued(renderer: TurnTelemetryRendererSample | undefined): void {
    if (!renderer) return;
    const turn = pending.get(renderer.turnId);
    if (!turn || turn.queuedAt !== undefined) return;
    turn.queuedAt = clock();
    addPhase(turn, "host_queued", turn.queuedAt);
  }

  function beginDispatch(sessionId: string, input: unknown): void {
    if (fenced.has(sessionId)) return;
    const renderer = sanitizeRendererTurnTelemetry(input);
    let turn = renderer ? pending.get(renderer.turnId) : undefined;
    if (!turn || turn.sessionId !== sessionId) turn = makeTurn(sessionId, renderer);
    pending.delete(turn.turnId);
    // Queue semantics prevent concurrent prompt dispatches. If a broken/old
    // client violates that invariant, retain the active measurement rather than
    // falsely assigning later events to a second turn.
    if (active.has(sessionId)) return;
    turn.preparationStartedAt = clock();
    addPhase(turn, "host_preparation_start", turn.preparationStartedAt);
    active.set(sessionId, turn);
  }

  function preparationComplete(sessionId: string, piRpcBytes: unknown): void {
    const turn = active.get(sessionId);
    if (!turn || turn.terminalAt !== undefined) return;
    const bytes = nonNegativeInteger(piRpcBytes);
    if (bytes !== undefined) turn.metrics.piRpcBytes = bytes;
    turn.preparationEndedAt = clock();
    addPhase(turn, "host_preparation_end", turn.preparationEndedAt);
  }

  function dispatchStarted(sessionId: string): void {
    const turn = active.get(sessionId);
    if (!turn || turn.terminalAt !== undefined) return;
    turn.piDispatchAt = clock();
    addPhase(turn, "pi_dispatch", turn.piDispatchAt);
  }

  function dispatchAccepted(sessionId: string): void {
    const turn = active.get(sessionId);
    if (!turn || turn.terminalAt !== undefined) return;
    turn.piDispatchAcceptedAt = clock();
    addPhase(turn, "pi_dispatch_accepted", turn.piDispatchAcceptedAt);
  }

  function observeRpc(sessionId: string, event: unknown): void {
    const turn = active.get(sessionId);
    if (!turn || turn.terminalAt !== undefined || !event || typeof event !== "object") return;
    const rpc = event as Record<string, unknown>;
    const at = clock();
    if (rpc.type === "agent_start") {
      turn.startResources = resources();
      addPhase(turn, "pi_agent_start", at);
      return;
    }
    if (rpc.type === "agent_error") {
      addPhase(turn, "error", at);
      turn.outcome = "error";
      return;
    }
    if (rpc.type === "message_update") {
      const update = rpc.assistantMessageEvent;
      if (!update || typeof update !== "object") return;
      const kind = (update as { type?: unknown }).type;
      const delta = (update as { delta?: unknown }).delta;
      turn.firstStreamAt ??= at;
      addPhase(turn, "first_stream", at);
      if (kind === "thinking_delta" && typeof delta === "string" && delta.length > 0)
        addPhase(turn, "first_thinking", at);
      if (kind === "text_delta" && typeof delta === "string" && delta.length > 0) {
        turn.firstTextAt ??= at;
        addPhase(turn, "first_text", at);
      }
      if (kind === "toolcall_start" || kind === "toolcall_delta" || kind === "toolcall_end") addPhase(turn, "tool_activity", at);
      return;
    }
    if (rpc.type === "tool_execution_start") {
      addPhase(turn, "tool_activity", at);
      return;
    }
    if (rpc.type === "tool_execution_end") {
      turn.metrics.toolResultCount = (turn.metrics.toolResultCount ?? 0) + 1;
      addPhase(turn, "tool_activity", at);
      return;
    }
    if (rpc.type !== "message_end") return;
    const message = rpc.message;
    if (!message || typeof message !== "object") return;
    const assistant = message as Record<string, unknown>;
    if (assistant.role !== "assistant") return;
    turn.metrics.assistantMessageCount = (turn.metrics.assistantMessageCount ?? 0) + 1;
    const firstAssistant = turn.firstAssistantAt === undefined;
    turn.firstAssistantAt ??= at;
    addPhase(turn, "first_assistant", at);
    // A tool loop can contain many provider responses. Combining a later
    // response's token count with this first response's time span would invent
    // a rate, so SessionPerformance intentionally samples only this first one.
    if (firstAssistant) Object.assign(turn.metrics, exactUsage(assistant.usage));
    if (assistant.stopReason === "error") {
      addPhase(turn, "error", at);
      turn.outcome = "error";
    }
  }

  function observeSessionStats(sessionId: string, sample: { contextTokens?: unknown; contextWindow?: unknown }): void {
    const turn = active.get(sessionId);
    if (!turn) return;
    const contextTokens = nonNegativeInteger(sample.contextTokens);
    const contextWindow = nonNegativeInteger(sample.contextWindow);
    if (contextTokens !== undefined) turn.metrics.contextTokens = contextTokens;
    if (contextWindow !== undefined) turn.metrics.contextWindow = contextWindow;
  }

  function terminal(sessionId: string, requested: "settled" | "stopped"): void {
    const turn = active.get(sessionId);
    if (!turn || turn.terminalAt !== undefined) return;
    turn.terminalAt = clock();
    turn.endResources = resources();
    const outcome = turn.outcome === "error" ? "error" : requested;
    turn.outcome = outcome;
    addPhase(turn, outcome === "settled" ? "settled" : outcome === "stopped" ? "stopped" : "error", turn.terminalAt);
  }

  function failDispatch(sessionId: string): void {
    const turn = active.get(sessionId);
    if (!turn || turn.terminalAt !== undefined) return;
    turn.outcome = "error";
    turn.terminalAt = clock();
    turn.endResources = resources();
    addPhase(turn, "error", turn.terminalAt);
    flushTerminal(sessionId);
  }

  function buildRecord(turn: OpenTurn): TurnTelemetryRecord | undefined {
    if (turn.terminalAt === undefined || !turn.outcome) return undefined;
    const rendererPreflightMs = nonNegativeDuration(
      turn.phases.find((phase) => phase.name === "renderer_preflight_start")?.at,
      turn.phases.find((phase) => phase.name === "renderer_preflight_end")?.at,
    );
    const hostQueueMs = nonNegativeDuration(turn.queuedAt, turn.preparationStartedAt);
    const hostPreparationMs = nonNegativeDuration(turn.preparationStartedAt, turn.preparationEndedAt);
    const piDispatchMs = nonNegativeDuration(turn.piDispatchAt, turn.piDispatchAcceptedAt);
    // TTFT measures the first provider stream response. `first_text` remains
    // separate in the record so reasoning/tool-first providers are not relabeled
    // as text output, while total provider output is timed over its full stream.
    const ttftMs = nonNegativeDuration(turn.piDispatchAt, turn.firstStreamAt);
    const generationMs = nonNegativeDuration(turn.firstStreamAt, turn.firstAssistantAt ?? turn.terminalAt);
    const turnMs = nonNegativeDuration(turn.hostReceivedAt, turn.terminalAt);
    const rate = turn.metrics.outputTokens !== undefined
      && turn.metrics.outputTokens > 0
      && generationMs !== undefined
      && generationMs > 0
      ? turn.metrics.outputTokens / (generationMs / 1_000)
      : undefined;
    const tokensPerSecond = rate !== undefined && Number.isFinite(rate) ? rate : undefined;
    const durations = nonEmpty({
      ...(rendererPreflightMs !== undefined ? { rendererPreflightMs } : {}),
      ...(hostQueueMs !== undefined ? { hostQueueMs } : {}),
      ...(hostPreparationMs !== undefined ? { hostPreparationMs } : {}),
      ...(piDispatchMs !== undefined ? { piDispatchMs } : {}),
      ...(ttftMs !== undefined ? { ttftMs } : {}),
      ...(generationMs !== undefined ? { generationMs } : {}),
      ...(turnMs !== undefined ? { turnMs } : {}),
    });
    const resources = nonEmpty({
      ...(turn.startResources ? { start: turn.startResources } : {}),
      ...(turn.endResources ? { end: turn.endResources } : {}),
    });
    const record: TurnTelemetryRecord = {
      v: TURN_TELEMETRY_VERSION,
      turnId: turn.turnId,
      outcome: turn.outcome,
      phases: [...turn.phases].sort((left, right) => left.at - right.at),
      ...(durations ? { durations } : {}),
      ...(nonEmpty({ ...turn.metrics }) ? { metrics: { ...turn.metrics } } : {}),
      ...(resources ? { resources } : {}),
      ...(ttftMs !== undefined || tokensPerSecond !== undefined
        ? { performance: {
            ...(ttftMs !== undefined ? { ttftMs } : {}),
            ...(tokensPerSecond !== undefined ? { tokensPerSecond } : {}),
          } }
        : {}),
    };
    if (ttftMs !== undefined || tokensPerSecond !== undefined) {
      const samples = performance.get(turn.sessionId) ?? [];
      samples.push({
        ...(ttftMs !== undefined ? { ttftMs } : {}),
        ...(tokensPerSecond !== undefined ? { tokensPerSecond } : {}),
      });
      if (samples.length > TURN_TELEMETRY_MAX_PERFORMANCE_SAMPLES) {
        samples.splice(0, samples.length - TURN_TELEMETRY_MAX_PERFORMANCE_SAMPLES);
      }
      touchPerformance(turn.sessionId, samples);
      trimPerformance();
    }
    return record;
  }

  function flushTerminal(sessionId: string): void {
    const turn = active.get(sessionId);
    if (!turn || turn.terminalAt === undefined) return;
    active.delete(sessionId);
    const record = buildRecord(turn);
    if (!record) return;
    const line = serializeTurnTelemetryRecord(record);
    enqueue(line);
  }

  function sessionPerformance(sessionId: string): SessionPerformance | undefined {
    const samples = performance.get(sessionId);
    if (!samples?.length) return undefined;
    const average = (key: keyof PerformanceSample): number | undefined => {
      const values = samples
        .map((sample) => sample[key])
        .filter((value): value is number => value !== undefined);
      return values.length
        ? values.reduce((total, value) => total + value, 0) / values.length
        : undefined;
    };
    const ttftMs = average("ttftMs");
    const tokensPerSecond = average("tokensPerSecond");
    // Reads keep recently used inactive sessions warm, while the aggregate
    // remains bounded by the same deterministic eviction policy.
    touchPerformance(sessionId, samples);
    trimPerformance();
    return {
      ...(ttftMs !== undefined ? { ttftMs } : {}),
      ...(tokensPerSecond !== undefined ? { tokensPerSecond } : {}),
      sampleCount: samples.length,
    };
  }

  function dispose(): void {
    for (const sessionId of [...active.keys()]) flushTerminal(sessionId);
    pending.clear();
    fenced.clear();
    for (const sessionId of performance.keys()) {
      if (!active.has(sessionId)) performance.delete(sessionId);
    }
  }

  async function close(timeoutMs = closeTimeoutMs): Promise<void> {
    dispose();
    await waitWithTimeout(chain, timeoutMs);
  }

  return {
    file,
    backup,
    rendererSubmission,
    discardRendererSubmission,
    fenceSession,
    clearSession,
    reclaimSession,
    hasActive,
    retainedState,
    markQueued,
    beginDispatch,
    preparationComplete,
    dispatchStarted,
    dispatchAccepted,
    observeRpc,
    observeSessionStats,
    terminal,
    failDispatch,
    flushTerminal,
    sessionPerformance,
    dispose,
    close,
    pending: () => chain,
  };
}

export type TurnTelemetry = ReturnType<typeof createTurnTelemetry>;
