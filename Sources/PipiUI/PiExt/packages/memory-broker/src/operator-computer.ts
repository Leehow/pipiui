import {
  computerCandidateFromDraft,
  type MemoryComputerActionKind,
  type MemoryComputerDurationBucket,
  type MemoryExperienceCandidate,
} from "#memory-broker-contract";

/** Safe app identity retained only after contract validation. */
export type OperatorComputerApplicationScope = {
  bundleID: string;
  appName: string;
};

/**
 * Stable projection from a Pi `computer` tool result. It deliberately has no
 * screenshot, AX, text, coordinates, token, process, window, or URL field.
 */
export type ComputerCandidateInput = {
  bundleID?: string;
  appName?: string;
  actionKinds: MemoryComputerActionKind[];
  outcome: "success" | "failure";
  errorCode?: string;
  focusDrift?: boolean;
  durationBucket?: MemoryComputerDurationBucket;
};

export type OperatorComputerObservation = {
  application: OperatorComputerApplicationScope;
  candidate: MemoryExperienceCandidate;
};

const recoverableErrorCodes = new Set([
  "computer_target_lost",
  "computer_outcome_unknown",
  "cua_driver_error",
  "user_handoff_required",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function actionKind(raw: unknown): MemoryComputerActionKind | undefined {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (["click", "left_click", "right_click", "middle_click", "double_click", "triple_click", "left_mouse_down", "left_mouse_up", "drag", "left_click_drag"].includes(value)) return "click";
  if (value === "type") return "type";
  if (value === "key" || value === "keypress") return "keyPress";
  if (value === "scroll") return "scroll";
  if (value === "mouse_move") return "focus";
  return undefined;
}

function actionKinds(input: unknown): MemoryComputerActionKind[] {
  if (!isRecord(input)) return [];
  const rawActions = Array.isArray(input.actions)
    ? input.actions
    : [input];
  const values: MemoryComputerActionKind[] = [];
  const seen = new Set<MemoryComputerActionKind>();
  for (const action of rawActions) {
    if (!isRecord(action)) continue;
    const kind = actionKind(action.type ?? action.action);
    if (kind && seen.add(kind)) values.push(kind);
  }
  // The shared contract permits at most four compact action categories.
  return values.slice(0, 4);
}

function durationBucket(details: Record<string, unknown>): MemoryComputerDurationBucket | undefined {
  const value = details.durationMs ?? details.duration_ms;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  if (value < 1_000) return "instant";
  if (value < 5_000) return "short";
  if (value < 20_000) return "medium";
  return "long";
}

function fixedRecoverableErrorCode(details: Record<string, unknown>, focusDrift: boolean, batchOK: boolean | undefined): string | undefined {
  // Never inspect or retain batchError/raw messages. Only exact stable classes
  // from a future bridge shape can pass, otherwise derive fixed local classes.
  const explicit = typeof details.errorCode === "string" ? details.errorCode.trim().toLowerCase() : "";
  if (recoverableErrorCodes.has(explicit)) return explicit;
  if (focusDrift) return "focus_drift";
  if (batchOK === false) return "computer_batch_failed";
  return undefined;
}

/**
 * Projects only a completed real `computer` result into the shared contract.
 * It returns undefined for every other tool, unfinished/error result, unknown
 * outcome, invalid/sensitive app, or unsupported action category.
 */
export function operatorComputerObservationFromToolResult(event: {
  toolName?: unknown;
  input?: unknown;
  details?: unknown;
  isError?: unknown;
}): OperatorComputerObservation | undefined {
  if (event.toolName !== "computer" || event.isError === true || !isRecord(event.details)) return undefined;
  const details = event.details;
  const foreground = isRecord(details.foregroundApp) ? details.foregroundApp : undefined;
  const bundleID = foreground?.bundleID;
  const appName = foreground?.name;
  const kinds = actionKinds(event.input);
  if (kinds.length === 0) return undefined;
  const batchOK = typeof details.batchOK === "boolean" ? details.batchOK : undefined;
  const focusDrift = details.focusDrift === true;
  const errorCode = fixedRecoverableErrorCode(details, focusDrift, batchOK);
  const bucket = durationBucket(details);
  const input: ComputerCandidateInput | undefined = !focusDrift && batchOK === true
    ? {
      bundleID: typeof bundleID === "string" ? bundleID : undefined,
      appName: typeof appName === "string" ? appName : undefined,
      actionKinds: kinds,
      outcome: "success",
      ...(bucket ? { durationBucket: bucket } : {}),
    }
    : errorCode
      ? {
        bundleID: typeof bundleID === "string" ? bundleID : undefined,
        appName: typeof appName === "string" ? appName : undefined,
        actionKinds: kinds,
        outcome: "failure",
        errorCode,
        ...(focusDrift ? { focusDrift: true } : {}),
        ...(bucket ? { durationBucket: bucket } : {}),
      }
      : undefined;
  if (!input) return undefined;
  const candidate = computerCandidateFromDraft({
    claimKind: input.outcome === "success" ? "computer_recipe" : "computer_failure",
    ...(input.bundleID ? { bundleID: input.bundleID } : {}),
    ...(input.appName ? { appName: input.appName } : {}),
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    actionKinds: input.actionKinds,
    ...(input.focusDrift !== undefined ? { focusDrift: input.focusDrift } : {}),
    ...(input.durationBucket ? { durationBucket: input.durationBucket } : {}),
    outcome: input.outcome,
  });
  const computer = candidate?.evidence[0]?.computer;
  if (!candidate || !computer?.bundleID || !computer.appName) return undefined;
  return {
    application: { bundleID: computer.bundleID, appName: computer.appName },
    candidate,
  };
}
