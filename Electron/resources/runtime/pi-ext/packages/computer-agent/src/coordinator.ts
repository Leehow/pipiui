import { randomUUID } from "node:crypto";
import {
  grantsForComputerRole,
  type ComputerWorkerGrant,
  type ComputerWorkerRole,
// @ts-ignore -- the bundled runtime executes TypeScript directly; keep its explicit runtime extension.
} from "./worker-broker.ts";
// @ts-ignore -- the bundled runtime executes TypeScript directly; keep its explicit runtime extension.
import { isComputerWorkerRole } from "./workers.ts";
import type { ComputerTaskEvent } from "./plan.ts";
// @ts-ignore -- the bundled runtime executes TypeScript directly; keep its explicit runtime extension.
import { validateTerminalBoundaryShape, type TerminalStepPolicy } from "./terminal-policy.ts";
// @ts-ignore -- the bundled runtime executes TypeScript directly; keep its explicit runtime extension.
import { validateComputerPlanCuaOnly, type ComputerTaskRecoveryPolicy } from "./plan-proposal.ts";
export type { ComputerTaskRecoveryPolicy } from "./plan-proposal.ts";

export type ComputerPostcondition =
  | { kind: "visible_text"; contains: string }
  | { kind: "element_exists"; name: string }
  | { kind: "file_exists"; path: string }
  | { kind: "visual_judgement"; description: string };

export type ComputerObservation = {
  id: string;
  visibleText?: string[];
  elements?: Array<{ name?: string; value?: string; role?: string }>;
  files?: Array<{ path: string; exists: boolean; type?: string; digest?: string }>;
};

export type ComputerPlanStep = {
  id: string;
  role: "gui-operator" | "terminal-worker" | "verifier";
  objective: string;
  dependsOn: string[];
  postconditions: ComputerPostcondition[];
  terminalPolicy?: Omit<TerminalStepPolicy, "commands">;
};

export type ComputerPlan = {
  goal: string;
  mode: "direct" | "planned";
  successConditions: ComputerPostcondition[];
  steps: ComputerPlanStep[];
  revision?: number;
  procedureContext?: { application: { bundleId: string; appName: string }; parameters: Record<string, string>; qualification?: boolean };
};

export type ComputerTaskRequest = {
  goal: string;
  taskId?: string;
  recoveryPolicy?: ComputerTaskRecoveryPolicy;
};

export type ComputerWorkerDispatch = {
  taskId: string;
  stepId: string;
  role: ComputerWorkerRole;
  objective: string;
  postconditions: ComputerPostcondition[];
  grants: ComputerWorkerGrant[];
  observation?: ComputerObservation;
  terminalPolicy?: Omit<TerminalStepPolicy, "commands">;
  planRevision: number;
};

export type ComputerWorkerResult = {
  outcome: "completed" | "verified" | "failed" | "blocked" | "outcome_unknown";
  summary: string;
  claims?: string[];
  /** Host-filtered, exact requested conditions attested by a fresh multimodal Verifier. */
  attestedPostconditions?: ComputerPostcondition[];
  observation?: ComputerObservation;
  artifactReferences?: Array<{ id: string; kind: "screenshot" | "accessibility" | "terminal" | "trajectory" | "file"; summary: string; digest: string; byteLength: number }>;
  trajectory?: string;
  failureCode?: ComputerWorkerFailureCode;
  /** Closed recovery signal: the worker proved an external target-state mismatch and the task forbids repairing it. */
  recoveryDisposition?: "manual_intervention";
  blockedReason?: "target_state_mismatch";
  nextAction?: "restore_target_state_manually";
};
export type ComputerAgentEpisode = {
  agentId: string;
  runId: string;
  parentId: string | null;
  name: "operator" | "computer-verifier" | "computer-terminal" | "computer-use-leader";
  role: ComputerWorkerRole | "computer-use-leader";
  terminalState: "ok" | "failed" | "aborted" | "interrupted" | "stalled";
  result: {
    outcome: ComputerWorkerResult["outcome"] | "cancelled";
    summary: string;
    failureCode?: ComputerWorkerFailureCode;
  };
};
export const COMPUTER_WORKER_FAILURE_CODES = [
  "gui_broker_start_failed", "gui_grant_issue_failed", "gui_private_resource_failed",
  "gui_child_prestart_failed", "gui_child_failed", "gui_child_stalled", "computer_worker_dispatch_failed",
	"computer_worker_runtime_timeout", "computer_worker_request_cancelled",
	"computer_worker_no_progress",
	"terminal_path_policy_rejected", "terminal_command_policy_rejected",
	"terminal_request_invalid", "terminal_operation_failed",
	"computer_leader_stalled",
] as const;
export type ComputerWorkerFailureCode = typeof COMPUTER_WORKER_FAILURE_CODES[number];

export const COMPUTER_WORKER_STALL_TIMEOUT_MS = 150_000;
export const COMPUTER_LEADER_STALL_TIMEOUT_MS = 120_000;
export const COMPUTER_LEADER_PROGRESS_GRACE_MS = 30_000;
export const COMPUTER_TASK_OPTIONAL_SUMMARY_TIMEOUT_MS = 8_000;
export const COMPUTER_TASK_CHILD_CLEANUP_TIMEOUT_MS = 2_000;

type StallProgressOptions = {
  lastProgressAt: () => number | undefined;
  progressGraceMs: number;
  onExtended?: (deadlineAt: number) => void;
  signal?: AbortSignal;
};

function clearStallTimer(timer: ReturnType<typeof setTimeout> | undefined): undefined {
  if (!timer) return undefined;
  clearTimeout(timer);
  timer.unref?.();
  return undefined;
}

function stallAbortSignal(signal?: AbortSignal | { signal?: AbortSignal }): AbortSignal | undefined {
  return signal instanceof AbortSignal ? signal : signal?.signal;
}

async function runWithStallDeadline<T>(
  run: () => Promise<T>,
  onStalled: () => void,
  timeoutMs: number,
  failureCode: "gui_child_stalled" | "computer_leader_stalled",
  progress?: StallProgressOptions,
  signal?: AbortSignal,
): Promise<T> {
  const operation = Promise.resolve().then(run);
  // Attach settlement handlers immediately so a late resolve/reject cannot
  // become an unhandled rejection after this wrapper has already closed.
  const settled = operation.then(
    (value) => ({ kind: "fulfilled" as const, value }),
    (error) => ({ kind: "rejected" as const, error }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stalled = false;
  let aborted = false;
  let extensionUsed = false;
  const deadline = new Promise<"stalled" | "aborted">((resolve) => {
    const settleAbort = () => {
      if (aborted || stalled) return;
      aborted = true;
      timer = clearStallTimer(timer);
      resolve("aborted");
    };
    const arm = () => {
      timer = setTimeout(() => {
        const now = Date.now();
        let lastProgressAt: number | undefined;
        try {
          lastProgressAt = progress?.lastProgressAt();
        } catch {
          lastProgressAt = undefined;
        }
        if (
          progress
          && typeof progress.lastProgressAt === "function"
          && !extensionUsed
          && lastProgressAt !== undefined
          && lastProgressAt <= now
          && now - lastProgressAt <= Math.max(0, progress.progressGraceMs)
        ) {
          extensionUsed = true;
          try { progress.onExtended?.(now + Math.max(10, timeoutMs)); } catch { /* UI deadline reporting is best-effort. */ }
          arm();
          return;
        }
        stalled = true;
        timer = clearStallTimer(timer);
        try { onStalled(); } catch { /* The closed failure still wins if best-effort abort reporting fails. */ }
        resolve("stalled");
      }, Math.max(10, timeoutMs));
    };
    arm();
    if (!signal) return;
    if (signal.aborted) {
      settleAbort();
      return;
    }
    signal.addEventListener("abort", settleAbort, { once: true });
  });
  try {
    const outcome = await Promise.race([
      settled,
      deadline.then((kind) => ({ kind })),
    ]);
    if (stalled || outcome.kind === "stalled") {
      throw Object.assign(new Error(failureCode), { failureCode });
    }
    if (aborted || outcome.kind === "aborted") {
      throw Object.assign(new Error("computer_worker_request_cancelled"), { failureCode: "computer_worker_request_cancelled" });
    }
    if (outcome.kind === "fulfilled") return outcome.value;
    if (outcome.kind === "rejected") throw outcome.error;
    throw Object.assign(new Error(failureCode), { failureCode });
  } finally {
    timer = clearStallTimer(timer);
  }
}

export async function runComputerWorkerWithStallDeadline<T>(
  run: () => Promise<T>,
  onStalled: () => void,
  timeoutMs = COMPUTER_WORKER_STALL_TIMEOUT_MS,
  signal?: AbortSignal | { signal?: AbortSignal },
): Promise<T> {
  return runWithStallDeadline(run, onStalled, timeoutMs, "gui_child_stalled", undefined, stallAbortSignal(signal));
}

export async function runComputerLeaderWithStallDeadline<T>(
  run: () => Promise<T>,
  onStalled: () => void,
  timeoutMs = COMPUTER_LEADER_STALL_TIMEOUT_MS,
  progress?: StallProgressOptions,
): Promise<T> {
  return runWithStallDeadline(run, onStalled, timeoutMs, "computer_leader_stalled", progress, progress?.signal);
}
export type HostExecutionRecord =
  | { role: "gui-operator"; kind: "open_application" | "click" | "type_parameter"; bundleId?: string; appName?: string; locator?: { role: string; nameLiteral: string }; observationId: string; observedAt: string }
  | { role: "terminal-worker"; kind: "write_parameterized_file"; path: string; byteLength: number; contentDigest: string; observationId: string; observedAt: string };
export type ComputerWorkerDispatchResult = { workerResult: ComputerWorkerResult; hostExecutionRecords: HostExecutionRecord[]; episode?: ComputerAgentEpisode };

export type ComputerTaskResult = {
  outcome: "succeeded" | "blocked" | "failed" | "cancelled";
  summary: string;
  verification: {
    status: "verified" | "not_verified" | "unknown";
    conditionResults: Array<{ conditionId: string; outcome: "verified" | "not_verified" | "unknown" }>;
  };
  planRevisions: number;
  episodes?: ComputerAgentEpisode[];
  investigation?: {
    stage: "task_verification" | "recovery_exhausted" | "recovery_plan" | "plan_dependencies" | "manual_intervention" | "fail_fast" | "cancelled" | "leader_runtime";
    code: "task_conditions_not_verified" | "worker_postconditions_not_verified" | "worker_failed" | "worker_blocked" | "worker_outcome_unknown" | "recovery_plan_invalid" | "unresolved_dependencies" | "target_state_mismatch" | "task_cancelled" | ComputerWorkerFailureCode;
    recoveryAttempts: number;
    failedConditions: Array<{ conditionId: string; kind: ComputerPostcondition["kind"]; outcome: "not_verified" | "unknown" }>;
    workerAttempts: Array<{
      stepId: string;
      role: ComputerWorkerRole;
      outcome: ComputerWorkerResult["outcome"];
      verification: "verified" | "not_verified" | "unknown";
      failureCode?: ComputerWorkerFailureCode;
      agentId?: string;
      runId?: string;
      parentId?: string | null;
      name?: ComputerAgentEpisode["name"];
      terminalState?: ComputerAgentEpisode["terminalState"];
      result?: ComputerAgentEpisode["result"];
    }>;
    blockedReason?: "target_state_mismatch";
    nextAction?: "restore_target_state_manually";
  };
};

/**
 * A final Leader prose pass is presentation-only once the Coordinator has
 * produced a closed result. Its stall or failure must not replace that result
 * (or its worker episodes) or hang the already-finished Computer Task.
 */
export async function finalizeComputerTaskWithOptionalSummary(
  result: ComputerTaskResult,
  summarize: () => Promise<string>,
  timeoutMs = COMPUTER_TASK_OPTIONAL_SUMMARY_TIMEOUT_MS,
): Promise<{ result: ComputerTaskResult; leaderSummary?: string }> {
  if (
    result.outcome === "blocked"
    && result.investigation?.stage === "manual_intervention"
    && result.investigation.blockedReason === "target_state_mismatch"
    && result.investigation.nextAction === "restore_target_state_manually"
  ) return { result };
  try {
    const leaderSummary = await runWithStallDeadline(
      summarize,
      () => {},
      timeoutMs,
      "computer_leader_stalled",
    );
    return { result, leaderSummary };
  } catch {
    if (result.outcome === "succeeded") return { result };
    return { result, leaderSummary: result.summary };
  }
}

export type ClosedComputerUseOutcome = {
  outcome: "succeeded" | "blocked" | "failed" | "cancelled";
  summary: string;
  verification: {
    status: "verified" | "unverified" | "partial";
    claims: Array<{ claim: string; evidenceRef: string }>;
  };
  handoff?: string;
};

const CLOSED_COMPUTER_USE_OUTCOMES = ["succeeded", "blocked", "failed", "cancelled"] as const;

function stripClosedOutcomeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  const firstLineBreak = trimmed.indexOf("\n");
  if (firstLineBreak < 0) return "";
  const body = trimmed.slice(firstLineBreak + 1);
  const closingFence = body.lastIndexOf("```");
  return (closingFence >= 0 ? body.slice(0, closingFence) : body).trim();
}

function asClosedComputerUseOutcome(value: unknown): ClosedComputerUseOutcome | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.steps) || Array.isArray(record.episodeLedger)) return undefined;
  if (!CLOSED_COMPUTER_USE_OUTCOMES.includes(record.outcome as ClosedComputerUseOutcome["outcome"])) return undefined;
  if (typeof record.summary !== "string" || !record.summary.trim()) return undefined;
  const verificationRecord = record.verification && typeof record.verification === "object" && !Array.isArray(record.verification)
    ? record.verification as Record<string, unknown>
    : undefined;
  const status = verificationRecord && ["verified", "unverified", "partial"].includes(String(verificationRecord.status))
    ? verificationRecord.status as ClosedComputerUseOutcome["verification"]["status"]
    : "unverified";
  const claims = Array.isArray(verificationRecord?.claims)
    ? verificationRecord.claims.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const claim = item as Record<string, unknown>;
      if (typeof claim.claim !== "string" || typeof claim.evidenceRef !== "string") return [];
      return [{ claim: claim.claim.slice(0, 500), evidenceRef: claim.evidenceRef.slice(0, 500) }];
    }).slice(0, 32)
    : [];
  return {
    outcome: record.outcome as ClosedComputerUseOutcome["outcome"],
    summary: record.summary.trim().slice(0, 2_000),
    verification: { status, claims },
    ...(typeof record.handoff === "string" && record.handoff.trim() ? { handoff: record.handoff.trim().slice(0, 1_000) } : {}),
  };
}

/** A Computer Use agent's streamed or final JSON verdict. Plans and ledgers stay ignored. */
export function parseClosedComputerUseOutcome(text: string): ClosedComputerUseOutcome | undefined {
  if (!text || text === "(running...)") return undefined;
  const body = stripClosedOutcomeFence(text);
  try {
    const parsed = asClosedComputerUseOutcome(JSON.parse(body));
    if (parsed) return parsed;
  } catch { /* try a surrounding-prose slice next */ }
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return asClosedComputerUseOutcome(JSON.parse(body.slice(start, end + 1)));
  } catch {
    return undefined;
  }
}

export const EARLY_CLOSED_COMPUTER_USE_OUTCOMES = ["blocked", "failed", "cancelled"] as const;

export function isEarlyClosedComputerUseOutcome(
  outcome: ClosedComputerUseOutcome | undefined,
): outcome is ClosedComputerUseOutcome & { outcome: typeof EARLY_CLOSED_COMPUTER_USE_OUTCOMES[number] } {
  return !!outcome && (EARLY_CLOSED_COMPUTER_USE_OUTCOMES as readonly string[]).includes(outcome.outcome);
}

export function createClosedOutcomeGate<T>() {
  let value: T | undefined;
  let resolve!: (next: T) => void;
  const seen = new Promise<T>((next) => { resolve = next; });
  return {
    note(next: T | undefined) {
      if (!next || value) return;
      value = next;
      resolve(next);
    },
    get value() { return value; },
    seen,
  };
}

type ComputerTaskUpdateLike = {
  content?: Array<{ type?: string; text?: unknown } | null | undefined>;
} | null | undefined;

export function closedOutcomeTextFromUpdate(update: ComputerTaskUpdateLike): string {
  return (update?.content ?? []).flatMap((part) =>
    part?.type === "text" && typeof part.text === "string" ? [part.text] : [],
  ).join("\n");
}

export function noteEarlyClosedComputerUseOutcome(
  gate: { note: (next: ClosedComputerUseOutcome | undefined) => void },
  text: string,
): ClosedComputerUseOutcome | undefined {
  const parsed = parseClosedComputerUseOutcome(text);
  if (!isEarlyClosedComputerUseOutcome(parsed)) return undefined;
  gate.note(parsed);
  return parsed;
}

export function bindComputerTaskClosedOutcomeFromUpdates() {
  const gate = createClosedOutcomeGate<ClosedComputerUseOutcome>();
  return {
    gate,
    noteFromUpdate(update: ComputerTaskUpdateLike) {
      return noteEarlyClosedComputerUseOutcome(gate, closedOutcomeTextFromUpdate(update));
    },
  };
}

export function projectComputerTaskActiveToolsAborted(
  outcome: ClosedComputerUseOutcome,
  now = Date.now(),
): {
  content: Array<{ type: "text"; text: string }>;
  details: {
    activity: null;
    activityActive: false;
    activityEndedAt: number;
    toolStatus: "aborted";
    outcome: ClosedComputerUseOutcome["outcome"];
  };
} {
  return {
    content: [{ type: "text", text: JSON.stringify(outcome) }],
    details: {
      activity: null,
      activityActive: false,
      activityEndedAt: now,
      toolStatus: "aborted",
      outcome: outcome.outcome,
    },
  };
}

function detachComputerTaskChildCleanup(input: {
  child: Promise<unknown>;
  timeoutMs: number;
  onError?: (error: unknown) => void;
}): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), input.timeoutMs);
    timer.unref?.();
  });
  void Promise.race([
    Promise.resolve(input.child).then(() => "child" as const, () => "child" as const),
    timeout,
  ]).then(() => {
    timer = clearStallTimer(timer);
  }, (error) => {
    timer = clearStallTimer(timer);
    try { input.onError?.(error); } catch { /* diagnostics only; never rewrite the closed result */ }
  });
}

export async function finishComputerTaskOnClosedOutcome<TChild>(input: {
  child: Promise<TChild>;
  closed: Promise<ClosedComputerUseOutcome>;
  abortOnce: () => void;
  cleanupTimeoutMs?: number;
  onAbandoned?: (outcome: ClosedComputerUseOutcome) => void;
  onCleanupError?: (error: unknown) => void;
}): Promise<{
  outcome?: ClosedComputerUseOutcome;
  child?: TChild;
  childError?: unknown;
  finishedVia: "closed_outcome" | "child";
  abortCount: number;
}> {
  let abortCount = 0;
  const abortOnce = () => {
    if (abortCount > 0) return;
    abortCount += 1;
    try { input.abortOnce(); } catch { /* cleanup abort is best-effort */ }
  };
  const settledChild = Promise.resolve(input.child).then(
    (value) => ({ kind: "fulfilled" as const, value }),
    (error) => ({ kind: "rejected" as const, error }),
  );
  const settledClosed = Promise.resolve(input.closed).then(
    (value) => ({ kind: "closed" as const, value }),
    () => ({ kind: "closed_failed" as const }),
  );
  const first = await Promise.race([
    settledChild.then((child) => ({ via: "child" as const, child })),
    settledClosed.then((closed) => closed.kind === "closed"
      ? { via: "closed" as const, outcome: closed.value }
      : { via: "closed_failed" as const }),
  ]);
  if (first.via === "child") {
    return {
      ...(first.child.kind === "fulfilled" ? { child: first.child.value } : { childError: first.child.error }),
      finishedVia: "child",
      abortCount,
    };
  }
  if (first.via === "closed_failed") {
    const child = await settledChild;
    return {
      ...(child.kind === "fulfilled" ? { child: child.value } : { childError: child.error }),
      finishedVia: "child",
      abortCount,
    };
  }
  if (!isEarlyClosedComputerUseOutcome(first.outcome)) {
    const child = await settledChild;
    return {
      ...(child.kind === "fulfilled" ? { child: child.value } : { childError: child.error }),
      finishedVia: "child",
      abortCount,
    };
  }
  abortOnce();
  try { input.onAbandoned?.(first.outcome); } catch { /* activity projection is best-effort */ }
  detachComputerTaskChildCleanup({
    child: settledChild,
    timeoutMs: Math.max(10, input.cleanupTimeoutMs ?? COMPUTER_TASK_CHILD_CLEANUP_TIMEOUT_MS),
    onError: input.onCleanupError,
  });
  return {
    outcome: first.outcome,
    finishedVia: "closed_outcome",
    abortCount,
  };
}

export type ComputerTaskGenerationToken = {
  readonly generation: number;
  readonly taskId: string;
  readonly runId: string;
};

export type ComputerTaskGenerationRegistry = {
  begin(taskId: string, runId: string): ComputerTaskGenerationToken;
  end(token: ComputerTaskGenerationToken): void;
  shouldCancel(token: ComputerTaskGenerationToken): boolean;
  readonly currentGeneration: number;
  readonly active: ComputerTaskGenerationToken | undefined;
};

export function createComputerTaskGenerationRegistry(): ComputerTaskGenerationRegistry {
  let currentGeneration = 0;
  let active: ComputerTaskGenerationToken | undefined;
  return {
    begin(taskId, runId) {
      currentGeneration += 1;
      active = { generation: currentGeneration, taskId, runId };
      return active;
    },
    end(token) {
      if (
        active
        && active.generation === token.generation
        && active.taskId === token.taskId
        && active.runId === token.runId
      ) {
        active = undefined;
      }
    },
    shouldCancel(token) {
      if (currentGeneration !== token.generation) return false;
      if (
        active
        && (
          active.generation !== token.generation
          || active.taskId !== token.taskId
          || active.runId !== token.runId
        )
      ) return false;
      return true;
    },
    get currentGeneration() { return currentGeneration; },
    get active() { return active; },
  };
}

export function detachGenerationScopedComputerCancel(input: {
  cancel: (signal: AbortSignal) => Promise<unknown>;
  shouldCancel: () => boolean;
  timeoutMs?: number;
  onError?: (error: unknown) => void;
}): void {
  const timeoutMs = Math.max(10, input.timeoutMs ?? COMPUTER_TASK_CHILD_CLEANUP_TIMEOUT_MS);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let startTimer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  const operation = new Promise<"skipped" | "cancelled">((resolve, reject) => {
    startTimer = setTimeout(() => {
      startTimer = undefined;
      Promise.resolve().then(() => {
        if (!input.shouldCancel()) return "skipped" as const;
        return Promise.resolve(input.cancel(controller.signal)).then(() => "cancelled" as const);
      }).then(resolve, reject);
    }, 0);
    startTimer.unref?.();
  });
  const settled = operation.then(
    (value) => ({ kind: "done" as const, value }),
    (error) => ({ kind: "error" as const, error }),
  );
  const timeout = new Promise<{ kind: "timeout" }>((resolve) => {
    timer = setTimeout(() => {
      try { controller.abort(); } catch { /* abort is best-effort */ }
      resolve({ kind: "timeout" });
    }, timeoutMs);
    timer.unref?.();
  });
  void Promise.race([settled, timeout]).then((first) => {
    startTimer = clearStallTimer(startTimer);
    timer = clearStallTimer(timer);
    if (first.kind === "error") {
      try { input.onError?.(first.error); } catch { /* diagnostics only; never rewrite the closed result */ }
    }
  }, (error) => {
    startTimer = clearStallTimer(startTimer);
    timer = clearStallTimer(timer);
    try { input.onError?.(error); } catch { /* diagnostics only; never rewrite the closed result */ }
  });
}

export async function raceComputerTaskToolToClosedOutcome<TChild>(input: {
  runChild: (onUpdate: (update: ComputerTaskUpdateLike) => void) => Promise<TChild>;
  abortOnce: () => void;
  signal?: AbortSignal;
  onUpdate?: (update: ComputerTaskUpdateLike) => void;
  onClosedLatch?: (outcome: ClosedComputerUseOutcome) => void;
  stallTimeoutMs?: number;
  cleanupTimeoutMs?: number;
  onAbandoned?: (outcome: ClosedComputerUseOutcome) => void;
  onCleanupError?: (error: unknown) => void;
}): Promise<{
  outcome?: ClosedComputerUseOutcome;
  child?: TChild;
  childError?: unknown;
  finishedVia: "closed_outcome" | "child";
  abortCount: number;
}> {
  const binding = bindComputerTaskClosedOutcomeFromUpdates();
  const childUpdate = (update: ComputerTaskUpdateLike) => {
    if (binding.gate.value) return;
    input.onUpdate?.(update);
    const closed = binding.noteFromUpdate(update);
    if (closed) input.onClosedLatch?.(closed);
  };
  return finishComputerTaskOnClosedOutcome({
    child: runComputerWorkerWithStallDeadline(
      () => input.runChild(childUpdate),
      input.abortOnce,
      input.stallTimeoutMs ?? COMPUTER_WORKER_STALL_TIMEOUT_MS,
      input.signal,
    ),
    closed: binding.gate.seen,
    abortOnce: input.abortOnce,
    cleanupTimeoutMs: input.cleanupTimeoutMs,
    onAbandoned: input.onAbandoned,
    onCleanupError: input.onCleanupError,
  });
}

export async function runRegisteredComputerTaskLifecycle<TChild>(input: {
  runChild: (onUpdate: (update: ComputerTaskUpdateLike) => void) => Promise<TChild>;
  abortOnce: () => void;
  signal?: AbortSignal;
  onUpdate?: (update: ComputerTaskUpdateLike) => void;
  onClosedLatch?: (outcome: ClosedComputerUseOutcome) => void;
  stallTimeoutMs?: number;
  cleanupTimeoutMs?: number;
  onAbandoned?: (outcome: ClosedComputerUseOutcome) => void;
  onCleanupError?: (error: unknown) => void;
  generation: ComputerTaskGenerationToken;
  generationRegistry: ComputerTaskGenerationRegistry;
  cancelRuntime?: (signal: AbortSignal) => Promise<unknown>;
  onCancelError?: (error: unknown) => void;
}): Promise<{
  outcome?: ClosedComputerUseOutcome;
  child?: TChild;
  childError?: unknown;
  finishedVia: "closed_outcome" | "child";
  abortCount: number;
}> {
  try {
    return await raceComputerTaskToolToClosedOutcome({
      runChild: input.runChild,
      abortOnce: input.abortOnce,
      signal: input.signal,
      onUpdate: input.onUpdate,
      onClosedLatch: input.onClosedLatch,
      stallTimeoutMs: input.stallTimeoutMs,
      cleanupTimeoutMs: input.cleanupTimeoutMs,
      onAbandoned: input.onAbandoned,
      onCleanupError: input.onCleanupError,
    });
  } finally {
    input.generationRegistry.end(input.generation);
    if (input.signal?.aborted && input.cancelRuntime) {
      detachGenerationScopedComputerCancel({
        cancel: input.cancelRuntime,
        shouldCancel: () => input.generationRegistry.shouldCancel(input.generation),
        timeoutMs: input.cleanupTimeoutMs ?? COMPUTER_TASK_CHILD_CLEANUP_TIMEOUT_MS,
        onError: input.onCancelError,
      });
    }
  }
}

type Planner = {
  plan(goal: string): Promise<ComputerPlan>;
  replan(input: {
    plan: ComputerPlan;
    failedStep: ComputerPlanStep;
    result: ComputerWorkerResult;
    observation?: ComputerObservation;
  }): Promise<ComputerPlan>;
};

type Dispatcher = {
  dispatch(request: ComputerWorkerDispatch, signal?: AbortSignal): Promise<ComputerWorkerResult | ComputerWorkerDispatchResult>;
};

type ProcedureLearning = {
  recordVerifiedExecution(input: {
    taskId: string;
    runId: string;
    goal: string;
    plan: ComputerPlan;
    steps: Array<{ stepId: string; role: ComputerWorkerRole; outcome: string; artifactReferences: ComputerWorkerResult["artifactReferences"]; hostExecutionRecords: HostExecutionRecord[] }>;
    verificationObservationIds: string[];
  }): Promise<void>;
};

const WORKER_SUMMARY: Record<ComputerWorkerResult["outcome"], string> = { completed: "Worker completed", verified: "Verifier completed", failed: "Worker failed", blocked: "Worker blocked", outcome_unknown: "Worker outcome unknown" };
const ARTIFACT_SUMMARY: Record<NonNullable<ComputerWorkerResult["artifactReferences"]>[number]["kind"], string> = { screenshot: "Screenshot artifact", accessibility: "Accessibility artifact", terminal: "Terminal artifact", trajectory: "Trajectory artifact", file: "File artifact" };

function closedPostcondition(value: unknown): ComputerPostcondition | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (item.kind === "visible_text" && Object.keys(item).every((key) => ["kind", "contains"].includes(key)) && typeof item.contains === "string" && item.contains.length > 0 && item.contains.length <= 4_096) return { kind: "visible_text", contains: item.contains };
  if (item.kind === "element_exists" && Object.keys(item).every((key) => ["kind", "name"].includes(key)) && typeof item.name === "string" && item.name.length > 0 && item.name.length <= 4_096) return { kind: "element_exists", name: item.name };
  if (item.kind === "file_exists" && Object.keys(item).every((key) => ["kind", "path"].includes(key)) && typeof item.path === "string" && item.path.startsWith("/") && item.path.length <= 4_096) return { kind: "file_exists", path: item.path };
  if (item.kind === "visual_judgement" && Object.keys(item).every((key) => ["kind", "description"].includes(key)) && typeof item.description === "string" && item.description.length > 0 && item.description.length <= 4_096) return { kind: "visual_judgement", description: item.description };
  return undefined;
}

export function projectComputerWorkerResult(value: ComputerWorkerResult): ComputerWorkerResult {
  const observation = value.observation && typeof value.observation.id === "string" ? {
    id: /^[A-Za-z0-9:_-]{1,160}$/.test(value.observation.id) ? value.observation.id : "observation:redacted",
    visibleText: (value.observation.visibleText ?? []).slice(0, 32),
    elements: (value.observation.elements ?? []).slice(0, 128).map((item) => ({
      role: item.role,
      name: item.name,
      value: item.value,
    })),
    files: (value.observation.files ?? []).slice(0, 32),
  } : undefined;
  const artifactReferences = (value.artifactReferences ?? []).filter((item: any) =>
    item && typeof item.id === "string" && /^artifact:[A-Za-z0-9:-]{1,160}$/.test(item.id)
    && ["screenshot", "accessibility", "terminal", "trajectory", "file"].includes(item.kind)
    && typeof item.digest === "string" && /^[a-f0-9]{64}$/i.test(item.digest)
    && Number.isInteger(item.byteLength) && item.byteLength >= 0
  ).slice(0, 12).map((item: any) => ({ id: item.id, kind: item.kind, summary: ARTIFACT_SUMMARY[item.kind as keyof typeof ARTIFACT_SUMMARY], digest: item.digest.toLowerCase(), byteLength: item.byteLength }));
  const outcome = ["completed", "verified", "failed", "blocked", "outcome_unknown"].includes(value.outcome) ? value.outcome : "failed";
  const failureCode = COMPUTER_WORKER_FAILURE_CODES.includes(value.failureCode as ComputerWorkerFailureCode) ? value.failureCode as ComputerWorkerFailureCode : undefined;
  const attestedPostconditions = (value.attestedPostconditions ?? []).flatMap((item) => {
    const condition = closedPostcondition(item);
    return condition ? [condition] : [];
  }).slice(0, 32);
  const manualBlock = outcome === "blocked"
    && value.recoveryDisposition === "manual_intervention"
    && value.blockedReason === "target_state_mismatch"
    && value.nextAction === "restore_target_state_manually";
  return {
    outcome,
    summary: WORKER_SUMMARY[outcome],
    ...(failureCode ? { failureCode } : {}),
    ...(attestedPostconditions.length ? { attestedPostconditions } : {}),
    ...(observation ? { observation } : {}),
    ...(artifactReferences.length ? { artifactReferences } : {}),
    ...(manualBlock ? {
      recoveryDisposition: "manual_intervention" as const,
      blockedReason: "target_state_mismatch" as const,
      nextAction: "restore_target_state_manually" as const,
    } : {}),
  };
}

function projectComputerAgentEpisode(value: unknown, workerResult: ComputerWorkerResult): ComputerAgentEpisode | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const episode = value as Partial<ComputerAgentEpisode>;
  if (typeof episode.agentId !== "string" || !/^[A-Za-z0-9_-]{2,160}$/.test(episode.agentId)) return undefined;
  if (typeof episode.runId !== "string" || !/^[A-Za-z0-9_-]{2,160}$/.test(episode.runId)) return undefined;
  if (episode.parentId !== null && (typeof episode.parentId !== "string" || !/^[A-Za-z0-9_-]{2,160}$/.test(episode.parentId))) return undefined;
  if (!["operator", "computer-verifier", "computer-terminal"].includes(String(episode.name))) return undefined;
  if (!isComputerWorkerRole(episode.role)) return undefined;
  if (!["ok", "failed", "aborted", "interrupted", "stalled"].includes(String(episode.terminalState))) return undefined;
  return {
    agentId: episode.agentId,
    runId: episode.runId,
    parentId: episode.parentId,
    name: episode.name as ComputerAgentEpisode["name"],
    role: episode.role,
    terminalState: episode.terminalState as ComputerAgentEpisode["terminalState"],
    result: {
      outcome: workerResult.outcome,
      summary: WORKER_SUMMARY[workerResult.outcome],
      ...(workerResult.failureCode ? { failureCode: workerResult.failureCode } : {}),
    },
  };
}

export function computerTaskDetails(
  result: ComputerTaskResult,
  root: ComputerAgentEpisode,
  leaderEpisodes: ComputerAgentEpisode[],
  leaderSummary?: string,
): ComputerTaskResult & { leaderSummary?: string; hierarchy: { root: Pick<ComputerAgentEpisode, "agentId" | "runId" | "parentId" | "name" | "role">; episodes: ComputerAgentEpisode[] } } {
  const episodes = [root, ...leaderEpisodes, ...(result.episodes ?? [])].map((episode) => structuredClone(episode));
  return {
    ...result,
    episodes,
    ...(leaderSummary ? { leaderSummary } : {}),
    hierarchy: {
      root: { agentId: root.agentId, runId: root.runId, parentId: root.parentId, name: root.name, role: root.role },
      episodes: structuredClone(episodes),
    },
  };
}

export function computerTaskContent(
  details: Pick<ComputerTaskResult, "summary" | "verification" | "planRevisions"> & {
    episodes?: ReadonlyArray<Omit<ComputerAgentEpisode, "name" | "role" | "terminalState" | "result"> & {
      name: string;
      role: string;
      terminalState: string;
      result: { outcome: string; summary: string; failureCode?: ComputerWorkerFailureCode };
    }>;
    investigation?: ComputerTaskResult["investigation"] | Record<string, unknown>;
  },
  summary = details.summary,
  plan?: ComputerPlan,
): string {
  const episodeLedger = (details.episodes ?? []).map((episode) => ({
    ...episode,
    result: {
      outcome: episode.result.outcome,
      summary: episode.name === "computer-use-leader"
        ? episode.result.outcome === "completed" ? "Computer Task completed" : episode.result.outcome === "cancelled" ? "Computer Task cancelled" : "Computer Task blocked"
        : WORKER_SUMMARY[episode.result.outcome as ComputerWorkerResult["outcome"]] ?? "Worker failed",
      ...(episode.result.failureCode ? { failureCode: episode.result.failureCode } : {}),
    },
  }));
  // `episodeLedger` stays the first key for stable prose-side consumers; the
  // trailing fields give the main agent (and the UI card renderer) the plan /
  // verification / investigation view that the tool `details` side-channel
  // carried but never survived the host RPC hop.
  return `${summary}\n\nEpisode ledger:\n${JSON.stringify({
    episodeLedger,
    ...(plan ? { plan } : {}),
    verification: details.verification,
    planRevisions: details.planRevisions,
    ...(details.investigation ? { investigation: details.investigation } : {}),
  })}`;
}

export function computerTaskRootTerminalState(
  result: { outcome: string; failureCode?: string },
): ComputerAgentEpisode["terminalState"] {
  if (result.failureCode === "computer_leader_stalled") return "stalled";
  if (result.outcome === "succeeded") return "ok";
  if (result.outcome === "cancelled") return "aborted";
  return "failed";
}

export function computerOperatorContextOptions(
  request: Pick<ComputerWorkerDispatch, "role" | "planRevision">,
  agentId: string,
): { agentId: string; retainContext: true; fresh: boolean } {
  return { agentId, retainContext: true, fresh: request.planRevision > 0 };
}

function isSubjective(condition: ComputerPostcondition): boolean {
  return condition.kind === "visual_judgement";
}

function verifiedConditionResults(conditions: ComputerPostcondition[], prefix: string) {
  return { status: "verified" as const, conditionResults: conditions.map((_condition, index) => ({ conditionId: `${prefix}:${index}`, outcome: "verified" as const })) };
}

export function evaluatePostconditions(
  conditions: ComputerPostcondition[],
  observation: ComputerObservation | undefined,
  conditionPrefix = "condition",
): { status: "verified" | "not_verified" | "unknown"; conditionResults: Array<{ conditionId: string; outcome: "verified" | "not_verified" | "unknown" }> } {
  const unknown = conditions.map((_condition, index) => ({ conditionId: `${conditionPrefix}:${index}`, outcome: "unknown" as const }));
  if (!observation || conditions.length === 0 || conditions.some(isSubjective)) return { status: "unknown", conditionResults: unknown };
  const conditionResults: Array<{ conditionId: string; outcome: "verified" | "not_verified" }> = [];
  for (let index = 0; index < conditions.length; index += 1) {
    const condition = conditions[index];
    const conditionId = `${conditionPrefix}:${index}`;
    if (condition.kind === "visible_text") {
      const present = (observation.visibleText ?? []).some((text) => text.includes(condition.contains));
      conditionResults.push({ conditionId, outcome: present ? "verified" : "not_verified" });
      if (!present) return { status: "not_verified", conditionResults };
    } else if (condition.kind === "element_exists") {
      const present = (observation.elements ?? []).some((element) => element.name === condition.name);
      conditionResults.push({ conditionId, outcome: present ? "verified" : "not_verified" });
      if (!present) return { status: "not_verified", conditionResults };
    } else if (condition.kind === "file_exists") {
      const present = (observation.files ?? []).some((file) => file.path === condition.path && file.exists);
      conditionResults.push({ conditionId, outcome: present ? "verified" : "not_verified" });
      if (!present) return { status: "not_verified", conditionResults };
    }
  }
  return { status: "verified", conditionResults };
}

export class ComputerAgentCoordinator {
  readonly #planner: Planner;
  readonly #dispatcher: Dispatcher;
  readonly #maxReplans: number;
  readonly #onEvent?: (event: ComputerTaskEvent) => void;
  readonly #procedureLearning?: ProcedureLearning;

  constructor(input: {
    planner: Planner;
    dispatcher: Dispatcher;
    maxReplans?: number;
    onEvent?: (event: ComputerTaskEvent) => void;
    procedureLearning?: ProcedureLearning;
  }) {
    this.#planner = input.planner;
    this.#dispatcher = input.dispatcher;
    this.#maxReplans = input.maxReplans ?? 2;
    this.#onEvent = input.onEvent;
    this.#procedureLearning = input.procedureLearning;
  }

  async run(request: ComputerTaskRequest, signal?: AbortSignal): Promise<ComputerTaskResult> {
    const goal = request.goal?.trim();
    if (!goal) throw new Error("computer_task requires a non-empty goal");
    const taskId = request.taskId ?? randomUUID();
    const runId = randomUUID();
    this.#emit({ type: "task_started", taskId, summary: "Computer Task started" });
    let plan = await this.#planner.plan(goal);
    this.#validatePlan(plan);
    let revisions = plan.revision ?? 0;
    const completed = new Set<string>();
    const executed: Array<{ stepId: string; role: ComputerWorkerRole; outcome: string; artifactReferences: ComputerWorkerResult["artifactReferences"]; hostExecutionRecords: HostExecutionRecord[] }> = [];
    const verificationObservationIds = new Set<string>();
    const verifiedTaskConditions = new Set<string>();
    const workerAttempts: NonNullable<ComputerTaskResult["investigation"]>["workerAttempts"] = [];
    const episodes: ComputerAgentEpisode[] = [];
    const recordEpisode = (dispatched: ComputerWorkerDispatchResult, attempt: NonNullable<ComputerTaskResult["investigation"]>["workerAttempts"][number]) => {
      if (!dispatched.episode) return;
      episodes.push(structuredClone(dispatched.episode));
      Object.assign(attempt, {
        agentId: dispatched.episode.agentId,
        runId: dispatched.episode.runId,
        parentId: dispatched.episode.parentId,
        name: dispatched.episode.name,
        terminalState: dispatched.episode.terminalState,
        result: structuredClone(dispatched.episode.result),
      });
    };
    const hasPendingDownstreamVerifier = (stepId: string) => {
      const dependsOn = (candidateId: string): boolean => {
        const pending = [candidateId];
        const seen = new Set<string>();
        while (pending.length) {
          const current = pending.pop()!;
          if (seen.has(current)) continue;
          seen.add(current);
          const dependencies = plan.steps.find((item) => item.id === current)?.dependsOn ?? [];
          if (dependencies.includes(stepId)) return true;
          pending.push(...dependencies);
        }
        return false;
      };
      return plan.steps.some((candidate) => candidate.role === "verifier" && !completed.has(candidate.id) && dependsOn(candidate.id));
    };

    const taskVerification = () => {
      const conditionResults = plan.successConditions.map((condition, index) => ({
        conditionId: `task:condition:${index}`,
        outcome: verifiedTaskConditions.has(JSON.stringify(condition)) ? "verified" as const : "not_verified" as const,
      }));
      return {
        status: conditionResults.every((condition) => condition.outcome === "verified") ? "verified" as const : "not_verified" as const,
        conditionResults,
      };
    };
    const recordTaskEvidence = (step: ComputerPlanStep, observation: ComputerObservation | undefined, verifiedByFreshVerifier: boolean, attestedPostconditions: ComputerPostcondition[] = []) => {
      const boundStepConditions = new Set(step.postconditions.map((condition) => JSON.stringify(condition)));
      const attested = new Set(attestedPostconditions.map((condition) => JSON.stringify(condition)));
      for (const condition of plan.successConditions) {
        const key = JSON.stringify(condition);
        if (!boundStepConditions.has(key)) continue;
        if (isSubjective(condition)) {
          if (verifiedByFreshVerifier) verifiedTaskConditions.add(key);
        } else if (verifiedByFreshVerifier && attested.has(key)) {
          verifiedTaskConditions.add(key);
        } else if (evaluatePostconditions([condition], observation, "task:evidence").status === "verified") {
          verifiedTaskConditions.add(key);
        }
      }
    };
    const investigation = (
      stage: NonNullable<ComputerTaskResult["investigation"]>["stage"],
      code: NonNullable<ComputerTaskResult["investigation"]>["code"],
      verification = taskVerification(),
    ): NonNullable<ComputerTaskResult["investigation"]> => ({
      stage,
      code,
      recoveryAttempts: revisions,
      failedConditions: verification.conditionResults.flatMap((condition, index) => condition.outcome === "verified" ? [] : [{
        conditionId: condition.conditionId,
        kind: plan.successConditions[index]?.kind ?? "visual_judgement",
        outcome: condition.outcome,
      }]),
      workerAttempts: workerAttempts.slice(-16).map((attempt) => ({ ...attempt })),
    });
    const finishBlocked = (
      stage: NonNullable<ComputerTaskResult["investigation"]>["stage"],
      code: NonNullable<ComputerTaskResult["investigation"]>["code"],
      verification = taskVerification(),
      summary = "Computer Task blocked",
    ) => {
      const blocked = this.#result("blocked", summary, revisions, verification, investigation(stage, code, verification), episodes);
      this.#emit({ type: "task_finished", taskId, outcome: blocked.outcome });
      return blocked;
    };
    const finishCancelled = () => {
      const verification = taskVerification();
      const cancelled = this.#result("cancelled", "Computer Task cancelled", revisions, verification, investigation("cancelled", "task_cancelled", verification), episodes);
      this.#emit({ type: "task_finished", taskId, outcome: cancelled.outcome });
      return cancelled;
    };

    while (true) {
      if (signal?.aborted) return finishCancelled();
      const step = plan.steps.find((candidate) =>
        !completed.has(candidate.id)
        && candidate.dependsOn.every((dependency) => completed.has(dependency))
      );
      if (!step) {
        if (plan.steps.every((candidate) => completed.has(candidate.id))) {
          const verification = taskVerification();
          if (verification.status !== "verified") {
            return finishBlocked("task_verification", "task_conditions_not_verified", verification, "Task-level success conditions are not freshly verified");
          }
          return await this.#succeeded(taskId, runId, goal, plan, executed, verificationObservationIds, {
            outcome: "succeeded",
            summary: "Computer Task completed",
            verification,
            planRevisions: revisions,
            ...(episodes.length ? { episodes: structuredClone(episodes) } : {}),
          });
        }
        return finishBlocked("plan_dependencies", "unresolved_dependencies", taskVerification(), "Computer Task plan has unresolved dependencies");
      }

      this.#emit({ type: "worker_started", taskId, stepId: step.id, role: step.role, parentRole: "computer-use-leader", depth: 1 });
      const dispatched = await this.#dispatch({
        taskId,
        stepId: step.id,
        role: step.role,
        objective: step.objective,
        postconditions: step.postconditions,
        ...(step.terminalPolicy ? { terminalPolicy: step.terminalPolicy } : {}),
        grants: grantsForComputerRole(step.role),
        planRevision: revisions,
      }, signal);
      if (signal?.aborted) return finishCancelled();
      const result = dispatched.workerResult;
      executed.push({ stepId: step.id, role: step.role, outcome: result.outcome, artifactReferences: result.artifactReferences, hostExecutionRecords: dispatched.hostExecutionRecords });
      const attempt: NonNullable<ComputerTaskResult["investigation"]>["workerAttempts"][number] = {
        stepId: step.id,
        role: step.role,
        outcome: result.outcome,
        verification: "unknown",
        ...(result.failureCode ? { failureCode: result.failureCode } : {}),
      };
      recordEpisode(dispatched, attempt);
      workerAttempts.push(attempt);
      this.#emit({ type: "worker_finished", taskId, stepId: step.id, role: step.role, outcome: result.outcome, parentRole: "computer-use-leader", depth: 1 });
      if (result.outcome === "completed" || result.outcome === "verified") {
        const resultObservationIsFresh = Boolean(result.observation?.id && !verificationObservationIds.has(result.observation.id));
        let taskObservation = result.observation;
        let taskAttestations = result.attestedPostconditions ?? [];
        let verifiedByFreshVerifier = step.role === "verifier" && result.outcome === "verified" && resultObservationIsFresh;
        let verification = step.role === "verifier" && result.outcome === "verified" && resultObservationIsFresh
          ? verifiedConditionResults(step.postconditions, `${step.id}:condition`)
          : evaluatePostconditions(step.postconditions, result.observation, `${step.id}:condition`);
        if (verification.status === "verified" && result.observation?.id) verificationObservationIds.add(result.observation.id);
        if (
          verification.status === "unknown" &&
          step.role !== "verifier" &&
          step.postconditions.every((condition) => condition.kind !== "file_exists") &&
          hasPendingDownstreamVerifier(step.id)
        ) {
          completed.add(step.id);
          continue;
        }
        if (verification.status === "unknown" && step.postconditions.every((condition) => condition.kind !== "file_exists")) {
          if (signal?.aborted) return finishCancelled();
          const verified = await this.#dispatch({
            taskId,
            stepId: `${step.id}-verify`,
            role: "verifier",
            objective: `Obtain a fresh observation and verify: ${step.postconditions.map((condition) => JSON.stringify(condition)).join("; ")}`,
            postconditions: step.postconditions,
            grants: grantsForComputerRole("verifier"),
            observation: result.observation,
            planRevision: revisions,
          }, signal);
          if (signal?.aborted) return finishCancelled();
          const verifierAttempt: NonNullable<ComputerTaskResult["investigation"]>["workerAttempts"][number] = {
            stepId: `${step.id}-verify`,
            role: "verifier",
            outcome: verified.workerResult.outcome,
            verification: "unknown",
            ...(verified.workerResult.failureCode ? { failureCode: verified.workerResult.failureCode } : {}),
          };
          recordEpisode(verified, verifierAttempt);
          workerAttempts.push(verifierAttempt);
          verification = verified.workerResult.outcome === "verified" && verified.workerResult.observation?.id && verified.workerResult.observation.id !== result.observation?.id
            ? verifiedConditionResults(step.postconditions, `${step.id}:condition`)
            : evaluatePostconditions(step.postconditions, verified.workerResult.observation, `${step.id}:condition`);
          verifierAttempt.verification = verification.status;
          taskObservation = verified.workerResult.observation;
          taskAttestations = verified.workerResult.attestedPostconditions ?? [];
          verifiedByFreshVerifier = Boolean(
            verified.workerResult.outcome === "verified" &&
            verified.workerResult.observation?.id &&
            verified.workerResult.observation.id !== result.observation?.id &&
            !verificationObservationIds.has(verified.workerResult.observation.id)
          );
          if (verification.status === "verified" && verified.workerResult.observation?.id) verificationObservationIds.add(verified.workerResult.observation.id);
        }
        attempt.verification = verification.status;
        if (verification.status === "verified") {
          recordTaskEvidence(step, taskObservation, verifiedByFreshVerifier, taskAttestations);
          completed.add(step.id);
          if (plan.steps.every((candidate) => completed.has(candidate.id))) {
            const verification = taskVerification();
            if (verification.status !== "verified") {
              return finishBlocked("task_verification", "task_conditions_not_verified", verification, "Task-level success conditions are not freshly verified");
            }
            return await this.#succeeded(taskId, runId, goal, plan, executed, verificationObservationIds, {
              outcome: "succeeded",
              summary: "Computer Task completed",
              verification,
              planRevisions: revisions,
              ...(episodes.length ? { episodes: structuredClone(episodes) } : {}),
            });
          }
          continue;
        }
      }

      if (request.recoveryPolicy === "fail_fast") {
        const failedAttempt = workerAttempts.at(-1) ?? attempt;
        const code = failedAttempt.failureCode
          ?? (failedAttempt.outcome === "outcome_unknown" ? "worker_outcome_unknown"
            : failedAttempt.verification === "not_verified" ? "worker_postconditions_not_verified"
              : failedAttempt.outcome === "blocked" ? "worker_blocked" : "worker_failed");
        return finishBlocked(
          "fail_fast",
          code,
          taskVerification(),
          "Computer Task stopped after the first failed attempt by fail-fast policy",
        );
      }

      let recoveryObservation = result.observation;
      if (result.outcome === "outcome_unknown") {
        if (signal?.aborted) return finishCancelled();
        const observed = await this.#dispatch({
          taskId,
          stepId: `${step.id}-observe-after-unknown`,
          role: "verifier",
          objective: "Obtain a fresh observation before any mutation retry",
          postconditions: step.postconditions,
          grants: grantsForComputerRole("verifier"),
          planRevision: revisions,
        }, signal);
        if (signal?.aborted) return finishCancelled();
        const verifierAttempt: NonNullable<ComputerTaskResult["investigation"]>["workerAttempts"][number] = {
          stepId: `${step.id}-observe-after-unknown`,
          role: "verifier",
          outcome: observed.workerResult.outcome,
          verification: "unknown",
          ...(observed.workerResult.failureCode ? { failureCode: observed.workerResult.failureCode } : {}),
        };
        recordEpisode(observed, verifierAttempt);
        workerAttempts.push(verifierAttempt);
        recoveryObservation = observed.workerResult.observation;
        const recovered = evaluatePostconditions(step.postconditions, recoveryObservation, `${step.id}:condition`);
        verifierAttempt.verification = recovered.status;
        attempt.verification = recovered.status;
        if (recovered.status === "verified") {
          if (recoveryObservation?.id) verificationObservationIds.add(recoveryObservation.id);
          recordTaskEvidence(step, recoveryObservation, false);
          completed.add(step.id);
          if (plan.steps.every((candidate) => completed.has(candidate.id))) {
            const verification = taskVerification();
            if (verification.status !== "verified") {
              return finishBlocked("task_verification", "task_conditions_not_verified", verification, "Task-level success conditions are not freshly verified");
            }
            return await this.#succeeded(taskId, runId, goal, plan, executed, verificationObservationIds, {
              outcome: "succeeded",
              summary: "Computer Task completed",
              verification,
              planRevisions: revisions,
              ...(episodes.length ? { episodes: structuredClone(episodes) } : {}),
            });
          }
          continue;
        }
      }

      if (attempt.verification === "unknown" && result.observation) {
        attempt.verification = evaluatePostconditions(step.postconditions, result.observation, `${step.id}:condition`).status;
      }

      if (
        result.outcome === "blocked"
        && result.recoveryDisposition === "manual_intervention"
        && result.blockedReason === "target_state_mismatch"
        && result.nextAction === "restore_target_state_manually"
      ) {
        const verification = taskVerification();
        const blocked: ComputerTaskResult = {
          outcome: "blocked",
          summary: "Target state requires manual restoration before retry",
          verification,
          planRevisions: revisions,
          investigation: {
            ...investigation("manual_intervention", "target_state_mismatch", verification),
            blockedReason: result.blockedReason,
            nextAction: result.nextAction,
          },
          ...(episodes.length ? { episodes: structuredClone(episodes) } : {}),
        };
        this.#emit({ type: "task_finished", taskId, outcome: blocked.outcome });
        return blocked;
      }

      if (revisions >= this.#maxReplans) {
        const code = result.failureCode
          ?? (result.outcome === "outcome_unknown" ? "worker_outcome_unknown"
            : attempt.verification === "not_verified" ? "worker_postconditions_not_verified"
              : result.outcome === "blocked" ? "worker_blocked" : "worker_failed");
        return finishBlocked("recovery_exhausted", code, taskVerification(), "Computer Task replan budget exhausted");
      }
      if (signal?.aborted) return finishCancelled();
      try {
        plan = await this.#planner.replan({
          plan,
          failedStep: step,
          result,
          observation: recoveryObservation,
        });
        if (signal?.aborted) return finishCancelled();
        this.#validatePlan(plan);
      } catch (error) {
        if (signal?.aborted) return finishCancelled();
        const failureCode = error && typeof error === "object" && COMPUTER_WORKER_FAILURE_CODES.includes((error as { failureCode?: unknown }).failureCode as ComputerWorkerFailureCode)
          ? (error as { failureCode: ComputerWorkerFailureCode }).failureCode
          : undefined;
        const verification = taskVerification();
        if (failureCode) {
          const blocked: ComputerTaskResult = {
            outcome: "blocked",
            summary: failureCode === "computer_leader_stalled"
              ? "Computer Task recovery Leader stalled"
              : "Computer Task recovery Leader failed",
            verification,
            planRevisions: revisions,
            investigation: investigation("leader_runtime", failureCode, verification),
            ...(episodes.length ? { episodes: structuredClone(episodes) } : {}),
          };
          this.#emit({ type: "task_finished", taskId, outcome: blocked.outcome });
          return blocked;
        }
        const blocked: ComputerTaskResult = {
          outcome: "blocked",
          summary: "Computer Task recovery plan was invalid after worker failure",
          verification,
          planRevisions: revisions,
          investigation: investigation("recovery_plan", "recovery_plan_invalid", verification),
          ...(episodes.length ? { episodes: structuredClone(episodes) } : {}),
        };
        this.#emit({ type: "task_finished", taskId, outcome: blocked.outcome });
        return blocked;
      }
      revisions += 1;
      this.#emit({ type: "plan_revised", taskId, revision: revisions, stepSummaries: plan.steps.map(({ id, role }) => `${role}:${id}`.slice(0, 240)) });
    }
  }

  #validatePlan(plan: ComputerPlan): void {
    if (!Array.isArray(plan.steps) || plan.steps.length === 0) throw new Error("Computer Plan requires at least one step");
    validateComputerPlanCuaOnly(plan);
    if (!Array.isArray(plan.successConditions) || plan.successConditions.length === 0) throw new Error("Computer Plan requires at least one task success condition");
    const stepPostconditions = plan.steps.flatMap((step) => step.postconditions.map((condition) => JSON.stringify(condition)));
    if (plan.successConditions.some((condition) => !stepPostconditions.includes(JSON.stringify(condition)))) {
      throw new Error("Every Computer Plan success condition must exactly match a step Postcondition");
    }
    const ids = new Set(plan.steps.map(({ id }) => id));
    if (ids.size !== plan.steps.length) throw new Error("Computer Plan step IDs must be unique");
    for (const step of plan.steps) {
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(step.id)) throw new Error("Computer Plan step IDs must be trusted identifier tokens");
      if (!isComputerWorkerRole(step.role)) throw new Error(`Leader may dispatch only a fixed Computer Worker role: ${String(step.role)}`);
      if (step.role === "terminal-worker") {
        if (!step.terminalPolicy) throw new Error(`Terminal Worker step ${step.id} requires a bounded terminal policy`);
        validateTerminalBoundaryShape(step.terminalPolicy);
        if (!step.postconditions.some((condition) => condition.kind === "file_exists")) {
          throw new Error(`Terminal Worker step ${step.id} requires an observable file Postcondition`);
        }
      } else if (step.terminalPolicy) {
        throw new Error(`Only Terminal Worker step ${step.id} may carry a terminal policy`);
      }
      if (step.dependsOn.some((dependency) => !ids.has(dependency) || dependency === step.id)) {
        throw new Error(`Computer Plan step ${step.id} has an invalid dependency`);
      }
    }
  }

  async #dispatch(request: ComputerWorkerDispatch, signal?: AbortSignal): Promise<ComputerWorkerDispatchResult> {
    try {
      const dispatched = await this.#dispatcher.dispatch(request, signal);
      if ("workerResult" in dispatched && Array.isArray(dispatched.hostExecutionRecords)) {
        const workerResult = projectComputerWorkerResult(dispatched.workerResult);
        const episode = projectComputerAgentEpisode(dispatched.episode, workerResult);
        return { workerResult, hostExecutionRecords: structuredClone(dispatched.hostExecutionRecords), ...(episode ? { episode } : {}) };
      }
      return { workerResult: projectComputerWorkerResult(dispatched as ComputerWorkerResult), hostExecutionRecords: [] };
    } catch (error) {
      const failureCode = error && typeof error === "object" && COMPUTER_WORKER_FAILURE_CODES.includes((error as any).failureCode)
        ? (error as any).failureCode as ComputerWorkerFailureCode
        : "computer_worker_dispatch_failed";
      const workerResult = projectComputerWorkerResult({ outcome: "failed", summary: error instanceof Error ? error.message : "Computer Worker failed", failureCode });
      const episode = projectComputerAgentEpisode((error as { episode?: unknown })?.episode, workerResult);
      return { workerResult, hostExecutionRecords: [], ...(episode ? { episode } : {}) };
    }
  }

  async #succeeded(taskId: string, runId: string, goal: string, plan: ComputerPlan, steps: Array<{ stepId: string; role: ComputerWorkerRole; outcome: string; artifactReferences: ComputerWorkerResult["artifactReferences"]; hostExecutionRecords: HostExecutionRecord[] }>, observationIds: Set<string>, result: ComputerTaskResult): Promise<ComputerTaskResult> {
    const trustedPlan: ComputerPlan = {
      goal: String(plan.goal), mode: plan.mode,
      successConditions: structuredClone(plan.successConditions),
      steps: plan.steps.map((step) => ({ id: step.id, role: step.role, objective: step.objective, dependsOn: [...step.dependsOn], postconditions: structuredClone(step.postconditions), ...(step.terminalPolicy ? { terminalPolicy: structuredClone(step.terminalPolicy) } : {}) })),
      ...(Number.isInteger(plan.revision) ? { revision: plan.revision } : {}),
      ...(plan.procedureContext ? { procedureContext: structuredClone(plan.procedureContext) } : {}),
    };
    await this.#procedureLearning?.recordVerifiedExecution({ taskId, runId, goal, plan: trustedPlan, steps: structuredClone(steps), verificationObservationIds: [...observationIds] }).catch(() => {});
    result.summary = "Computer Task completed";
    this.#emit({ type: "verification", taskId, status: result.verification.status, conditionResults: result.verification.conditionResults });
    this.#emit({ type: "task_finished", taskId, outcome: result.outcome });
    return result;
  }

  #emit(event: ComputerTaskEvent): void {
    try { this.#onEvent?.(event); } catch { /* UI observation cannot alter task semantics. */ }
  }

  #result(
    outcome: "blocked" | "failed" | "cancelled",
    summary: string,
    planRevisions: number,
    verification: ComputerTaskResult["verification"] = { status: "not_verified", conditionResults: [] },
    investigation?: ComputerTaskResult["investigation"],
    episodes: ComputerAgentEpisode[] = [],
  ): ComputerTaskResult {
    return {
      outcome,
      summary: outcome === "cancelled" ? "Computer Task cancelled" : outcome === "blocked" ? "Computer Task blocked" : "Computer Task failed",
      verification,
      planRevisions,
      ...(episodes.length ? { episodes: structuredClone(episodes) } : {}),
      ...(investigation ? { investigation } : {}),
    };
  }
}
