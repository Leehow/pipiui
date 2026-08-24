/**
 * External no-progress detector for Boss-direct desktop sessions.
 *
 * Hard signals only trigger a check or enforce a safety cap. Semantic judgment
 * is injectable; the default is a conservative deterministic fallback. This
 * module never grants desktop access, never wraps execute(), and never confirms
 * a dangerous action. Callers feed `DirectDriveResult` through `stepFromDirectDriveResult`.
 */

// @ts-ignore -- the bundled runtime executes TypeScript directly; keep its explicit runtime extension.
import type { DirectDriveResult } from "./direct-drive.ts";

export const DIRECT_DRIVE_PROGRESS_VERDICTS = ["progressing", "looping", "stuck"] as const;
export type DirectDriveProgressVerdict = (typeof DIRECT_DRIVE_PROGRESS_VERDICTS)[number];

export const DIRECT_DRIVE_INJECTION_KINDS = ["change_interaction", "change_strategy"] as const;
export type DirectDriveInjectionKind = (typeof DIRECT_DRIVE_INJECTION_KINDS)[number];

export const DIRECT_DRIVE_PROGRESS_EVENT_KIND = "direct_drive_escalation" as const;

export const DIRECT_DRIVE_PAUSED_CODE = "direct_drive_paused" as const;

export const DEFAULT_TRAJECTORY_WINDOW = 8;
export const DEFAULT_STEP_BUDGET = 32;
export const DEFAULT_REPEAT_THRESHOLD = 2;
export const DEFAULT_UNCHANGED_THRESHOLD = 2;
export const DEFAULT_ERROR_THRESHOLD = 2;

export const CHANGE_INTERACTION_PROMPT =
  "change_interaction: the last actions did not move the UI; try a different interaction (locator, control, or input method), not the same click or key rephrased.";

export const CHANGE_STRATEGY_PROMPT =
  "change_strategy: still no progress after a different interaction; switch the overall strategy or call recovery rather than repeating this loop.";

const SAFETY_ERROR_CODES = [
  "desktop_grant_required",
  "desktop_grant_unavailable",
  "desktop_grant_invalid",
  "desktop_grant_denied",
  "dangerous_action_confirmation_required",
  "confirmation_required",
] as const;

export type TrajectoryStep = {
  action: Record<string, unknown>;
  result?: unknown;
  screenChanged: boolean | null;
  error: string | null;
  observationRef?: string;
  screenshotRef?: string;
};

export type HardSignals = {
  repeatedAction: boolean;
  consecutiveUnchanged: number;
  consecutiveErrors: number;
  stepsUsed: number;
  stepBudget: number;
  budgetExceeded: boolean;
  triggered: boolean;
};

export type DetectorJudgment = {
  verdict: DirectDriveProgressVerdict;
  reason: string;
  evidence: {
    hardSignals: HardSignals;
    steps: TrajectoryStep[];
    observationRefs: string[];
  };
};

export type SemanticProgressDetector = {
  judge(input: {
    sessionId: string;
    steps: readonly TrajectoryStep[];
    hardSignals: HardSignals;
  }): DetectorJudgment | Promise<DetectorJudgment>;
};

export type DirectDriveInjection = {
  kind: DirectDriveInjectionKind;
  prompt: string;
};

export type DirectDriveProgressEvent = {
  kind: typeof DIRECT_DRIVE_PROGRESS_EVENT_KIND;
  eventId: string;
  sessionId: string;
  verdict: "stuck";
  reason: string;
  recommendedAction: "pause";
  evidenceRefs: string[];
  hardSignals: HardSignals;
  safetyBoundary: boolean;
};

export type StuckGuardOptions = {
  sessionId: string;
  windowSize?: number;
  stepBudget?: number;
  repeatThreshold?: number;
  unchangedThreshold?: number;
  errorThreshold?: number;
  detector?: SemanticProgressDetector;
};

export type StuckGuardRecord = {
  verdict: DirectDriveProgressVerdict;
  reason: string;
  evidence: DetectorJudgment["evidence"];
  injection?: DirectDriveInjection;
  event?: DirectDriveProgressEvent;
  paused: boolean;
};

const REF_KEYS = new Set(["screenshotId", "observationId", "snapshot_id", "observationRef", "screenshotRef"]);

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .filter((key) => !REF_KEYS.has(key))
        .sort()
        .map((key) => [key, normalize(record[key])]),
    );
  }
  return value;
}

export function actionFingerprint(action: Record<string, unknown> | null | undefined): string {
  if (!action) return "";
  return JSON.stringify(normalize(action));
}

export function isSafetyBoundaryError(error: string | null | undefined): boolean {
  if (!error) return false;
  const text = error.trim();
  if (SAFETY_ERROR_CODES.some((code) => text === code || text.startsWith(`${code}:`) || text.includes(code))) {
    return true;
  }
  return /desktop_grant|dangerous_action|confirmation_required/i.test(text);
}

function observationRefsFrom(steps: readonly TrajectoryStep[]): string[] {
  const refs: string[] = [];
  for (const step of steps) {
    for (const ref of [step.observationRef, step.screenshotRef]) {
      if (ref && !refs.includes(ref)) refs.push(ref);
    }
  }
  return refs;
}

export function computeHardSignals(
  steps: readonly TrajectoryStep[],
  options: {
    stepsUsed?: number;
    windowSize?: number;
    stepBudget?: number;
    repeatThreshold?: number;
    unchangedThreshold?: number;
    errorThreshold?: number;
  } = {},
): HardSignals {
  const windowSize = options.windowSize ?? DEFAULT_TRAJECTORY_WINDOW;
  const stepBudget = options.stepBudget ?? DEFAULT_STEP_BUDGET;
  const repeatThreshold = options.repeatThreshold ?? DEFAULT_REPEAT_THRESHOLD;
  const unchangedThreshold = options.unchangedThreshold ?? DEFAULT_UNCHANGED_THRESHOLD;
  const errorThreshold = options.errorThreshold ?? DEFAULT_ERROR_THRESHOLD;
  const window = steps.slice(-windowSize);
  const stepsUsed = options.stepsUsed ?? steps.length;

  let consecutiveUnchanged = 0;
  for (let index = window.length - 1; index >= 0; index -= 1) {
    if (window[index].screenChanged !== false) break;
    consecutiveUnchanged += 1;
  }

  let consecutiveErrors = 0;
  for (let index = window.length - 1; index >= 0; index -= 1) {
    if (!window[index].error) break;
    consecutiveErrors += 1;
  }

  let repeatedRun = 0;
  if (window.length > 0) {
    const last = actionFingerprint(window[window.length - 1].action);
    if (last) {
      for (let index = window.length - 1; index >= 0; index -= 1) {
        if (actionFingerprint(window[index].action) !== last) break;
        repeatedRun += 1;
      }
    }
  }

  const repeatedAction = repeatedRun >= repeatThreshold;
  const budgetExceeded = stepsUsed >= stepBudget;
  const triggered =
    repeatedAction
    || consecutiveUnchanged >= unchangedThreshold
    || consecutiveErrors >= errorThreshold;

  return {
    repeatedAction,
    consecutiveUnchanged,
    consecutiveErrors,
    stepsUsed,
    stepBudget,
    budgetExceeded,
    triggered,
  };
}

function judgment(
  verdict: DirectDriveProgressVerdict,
  reason: string,
  hardSignals: HardSignals,
  steps: readonly TrajectoryStep[],
): DetectorJudgment {
  const window = steps.slice(-DEFAULT_TRAJECTORY_WINDOW);
  return {
    verdict,
    reason,
    evidence: {
      hardSignals,
      steps: window.map((step) => ({ ...step })),
      observationRefs: observationRefsFrom(window),
    },
  };
}

export function createConservativeProgressDetector(): SemanticProgressDetector {
  return {
    judge({ steps, hardSignals }) {
      if (hardSignals.budgetExceeded) {
        return judgment("stuck", "step_budget_exceeded", hardSignals, steps);
      }
      if (!hardSignals.triggered) {
        return judgment("progressing", "no_hard_signal", hardSignals, steps);
      }
      const parts = [
        hardSignals.repeatedAction ? "repeated_action" : "",
        hardSignals.consecutiveUnchanged >= DEFAULT_UNCHANGED_THRESHOLD ? "screen_unchanged" : "",
        hardSignals.consecutiveErrors >= DEFAULT_ERROR_THRESHOLD ? "consecutive_errors" : "",
      ].filter(Boolean);
      return judgment("looping", parts.join("+") || "hard_signal", hardSignals, steps);
    },
  };
}

const conservativeFallback = createConservativeProgressDetector();

function clampJudgment(input: DetectorJudgment, lastError: string | null): DetectorJudgment {
  if (!isSafetyBoundaryError(lastError)) return input;
  if (input.verdict !== "progressing") {
    return { ...input, reason: `${input.reason};safety_boundary` };
  }
  return {
    ...input,
    verdict: "looping",
    reason: "safety_boundary_not_overridable",
  };
}

export function summarizeTrajectory(
  steps: readonly TrajectoryStep[],
  options?: { windowSize?: number },
): TrajectoryStep[] {
  const windowSize = options?.windowSize ?? DEFAULT_TRAJECTORY_WINDOW;
  return steps.slice(-windowSize).map((step) => ({
    action: { ...step.action },
    result: step.result,
    screenChanged: step.screenChanged,
    error: step.error,
    ...(step.observationRef ? { observationRef: step.observationRef } : {}),
    ...(step.screenshotRef ? { screenshotRef: step.screenshotRef } : {}),
  }));
}

export function stepFromDirectDriveResult(result: DirectDriveResult): TrajectoryStep | null {
  const type = typeof result.action?.type === "string" ? result.action.type : "";
  if (type === "session" || type === "close") return null;
  const observation = result.observation;
  const observationRef = observation && typeof observation === "object"
    ? String(observation.observationId ?? observation.screenshotId ?? "")
    : "";
  return {
    action: { ...result.action },
    result: result.error ? { error: result.error } : { ok: true },
    screenChanged: result.screenChanged ?? null,
    error: result.error ?? null,
    ...(observationRef ? { observationRef } : {}),
  };
}

export function toBossEscalationInput(event: DirectDriveProgressEvent): {
  eventId: string;
  agentId: string;
  runId: string;
  kind: "escalate";
  reason: string;
  evidenceRefs: string[];
  recommendedAction: string;
} {
  return {
    eventId: event.eventId,
    agentId: `boss-direct-${event.sessionId}`,
    runId: event.sessionId,
    kind: "escalate",
    reason: event.reason,
    evidenceRefs: [...event.evidenceRefs],
    recommendedAction: event.recommendedAction,
  };
}

export function createDirectDriveStuckGuard(options: StuckGuardOptions): {
  readonly sessionId: string;
  readonly paused: boolean;
  record(step: TrajectoryStep): Promise<StuckGuardRecord>;
} {
  const sessionId = options.sessionId;
  const windowSize = options.windowSize ?? DEFAULT_TRAJECTORY_WINDOW;
  const stepBudget = options.stepBudget ?? DEFAULT_STEP_BUDGET;
  const detector = options.detector ?? conservativeFallback;
  const steps: TrajectoryStep[] = [];
  let phase: "clear" | "change_interaction" | "change_strategy" | "paused" = "clear";
  let lastEvent: DirectDriveProgressEvent | undefined;

  const pause = (reason: string, judged: DetectorJudgment, lastError: string | null): StuckGuardRecord => {
    phase = "paused";
    lastEvent ??= {
      kind: DIRECT_DRIVE_PROGRESS_EVENT_KIND,
      eventId: `direct-drive-escalation-${sessionId}`,
      sessionId,
      verdict: "stuck",
      reason,
      recommendedAction: "pause",
      evidenceRefs: judged.evidence.observationRefs,
      hardSignals: judged.evidence.hardSignals,
      safetyBoundary: isSafetyBoundaryError(lastError),
    };
    return {
      verdict: "stuck",
      reason,
      evidence: judged.evidence,
      event: lastEvent,
      paused: true,
    };
  };

  return {
    get sessionId() {
      return sessionId;
    },
    get paused() {
      return phase === "paused";
    },
    async record(step) {
      steps.push({ ...step, action: { ...step.action } });
      const window = steps.slice(-windowSize);
      const hardSignals = computeHardSignals(window, {
        stepsUsed: steps.length,
        windowSize,
        stepBudget,
        repeatThreshold: options.repeatThreshold,
        unchangedThreshold: options.unchangedThreshold,
        errorThreshold: options.errorThreshold,
      });
      const raw = hardSignals.triggered || hardSignals.budgetExceeded
        ? await detector.judge({ sessionId, steps: window, hardSignals })
        : conservativeFallback.judge({ sessionId, steps: window, hardSignals });
      const judged = clampJudgment({
        ...raw,
        evidence: {
          hardSignals,
          steps: window.map((item) => ({ ...item })),
          observationRefs: observationRefsFrom(window),
        },
      }, step.error);

      if (phase === "paused") {
        return {
          verdict: "stuck",
          reason: lastEvent?.reason ?? judged.reason,
          evidence: judged.evidence,
          event: lastEvent,
          paused: true,
        };
      }

      if (hardSignals.budgetExceeded || judged.verdict === "stuck") {
        return pause(hardSignals.budgetExceeded ? "step_budget_exceeded" : judged.reason, judged, step.error);
      }

      if (judged.verdict === "progressing") {
        phase = "clear";
        return {
          verdict: "progressing",
          reason: judged.reason,
          evidence: judged.evidence,
          paused: false,
        };
      }

      if (phase === "clear") {
        phase = "change_interaction";
        return {
          verdict: "looping",
          reason: judged.reason,
          evidence: judged.evidence,
          injection: { kind: "change_interaction", prompt: CHANGE_INTERACTION_PROMPT },
          paused: false,
        };
      }

      if (phase === "change_interaction") {
        phase = "change_strategy";
        return {
          verdict: "looping",
          reason: judged.reason,
          evidence: judged.evidence,
          injection: { kind: "change_strategy", prompt: CHANGE_STRATEGY_PROMPT },
          paused: false,
        };
      }

      return pause(judged.reason, judged, step.error);
    },
  };
}
