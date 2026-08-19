import { createHash, randomUUID } from "node:crypto";
// @ts-ignore -- the bundled Pi runtime executes these TypeScript resources directly.
import { conditionIsMet, reconcileTaskCheckpoint, type DesktopCondition, type TaskCheckpoint } from "./checkpoint.ts";

export type WorkflowMaturity = "cold" | "candidate" | "practiced";
export type StateBarrierReason =
  | "target_lost"
  | "target_drift"
  | "topology_changed"
  | "locator_missing"
  | "locator_ambiguous"
  | "stale_locator"
  | "external_change"
  | "consequential_effect_pending"
  | "outcome_unknown"
  | "human_handoff"
  | "task_satisfied"
  | "technical_failure"
  | "cancelled";

export type SemanticTarget =
  | { by: "accessibility"; role: string; name?: string; value?: string }
  | { by: "visual"; description: string; observationId: string; region: { x: number; y: number; width: number; height: number } }
  | { by: "coordinate"; x: number; y: number; observationId: string };

export type ActionBlockAction = Record<string, unknown> & {
  id: string;
  type: string;
  target?: SemanticTarget;
  consequential?: boolean;
};

export type ActionBlockRequest = {
  intent: string;
  actions: ActionBlockAction[];
  expectedEffects?: DesktopCondition[];
};

export type ActionBlockResult = {
  outcome: "completed" | "stopped" | "outcome_unknown" | "cancelled";
  completedActionIds: string[];
  skippedActionIds: string[];
  stopReason?: StateBarrierReason;
  effects: Array<{ actionId: string; status: "verified" | "not_verified" | "unknown"; evidenceRef?: string }>;
  observation: Record<string, unknown>;
  receiptRef: string;
  checkpoint: TaskCheckpoint;
};

const MUTATION_LIMITS: Record<WorkflowMaturity, number> = {
  cold: 2,
  candidate: 4,
  practiced: 12,
};
const READ_ONLY_ACTIONS = new Set(["wait", "wait_until", "screenshot"]);
const HOST_BINDING_FIELDS = new Set([
  "element_token", "element_index", "snapshot_id", "observationId", "screenshotId",
  "coordinate", "pid", "window_id", "windowID", "computerCapability", "capability",
]);

export function mutationLimitFor(maturity: WorkflowMaturity): number {
  return MUTATION_LIMITS[maturity];
}

function isMutation(action: ActionBlockAction): boolean {
  return !READ_ONLY_ACTIONS.has(action.type);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "id")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function actionEffectSignature(action: ActionBlockAction): string {
  return createHash("sha256").update(stable(action)).digest("hex");
}

export function validateActionBlockRequest(request: ActionBlockRequest, maturity: WorkflowMaturity): void {
  if (!request || typeof request !== "object" || typeof request.intent !== "string" || !request.intent.trim()) {
    throw new Error("action block requires a non-empty intent");
  }
  if (!Array.isArray(request.actions) || request.actions.length < 1 || request.actions.length > 64) {
    throw new Error("action block requires 1...64 actions");
  }
  const ids = new Set<string>();
  for (const action of request.actions) {
    if (!action || typeof action !== "object" || typeof action.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(action.id)) {
      throw new Error("action block action IDs must be bounded identifier tokens");
    }
    if (ids.has(action.id)) throw new Error("action block action IDs must be unique");
    ids.add(action.id);
    const forbidden = Object.keys(action).find((key) => HOST_BINDING_FIELDS.has(key));
    if (forbidden) throw new Error(`Host binding field ${forbidden} is forbidden in an action block; use a semantic target`);
    if (typeof action.type !== "string" || !action.type) throw new Error(`action ${action.id} requires a type`);
    if (action.type === "wait_until") {
      const condition = action.condition;
      if (!condition || typeof condition !== "object" || !Number.isFinite(action.timeoutMs) || Number(action.timeoutMs) < 0 || Number(action.timeoutMs) > 120_000) {
        throw new Error("wait_until requires a condition and bounded timeoutMs");
      }
    }
    if (action.target?.by === "visual") {
      const { observationId: targetObservationId, region } = action.target;
      if (!targetObservationId || !region
        || ![region.x, region.y, region.width, region.height].every((value) => Number.isFinite(value))
        || region.width <= 0 || region.height <= 0) {
        throw new Error("visual targets require a fresh observationId and a finite positive region");
      }
    }
  }
  const mutations = request.actions.filter(isMutation).length;
  const limit = mutationLimitFor(maturity);
  if (mutations > limit) throw new Error(`${maturity} action block permits at most ${limit} mutations`);
  for (const condition of request.expectedEffects ?? []) {
    if (condition.actionId && !ids.has(condition.actionId)) throw new Error(`expected effect references unknown action ${condition.actionId}`);
  }
}

function observationId(observation: Record<string, any>): string | undefined {
  const value = observation.observationId ?? observation.screenshotId ?? observation.id;
  return typeof value === "string" && value ? value : undefined;
}

function snapshotId(observation: Record<string, any>): string | undefined {
  const value = observation.accessibility?.snapshot_id ?? observation.snapshot_id;
  return typeof value === "string" && value ? value : undefined;
}

function normalizedRole(value: unknown): string {
  return String(value ?? "").replace(/^AX/i, "").toLowerCase();
}

function accessibilityNames(element: Record<string, any>): string[] {
  return [element.name, element.description, element.label, element.title, element.text]
    .filter((value) => typeof value === "string" && value.length > 0);
}

function topologySignature(observation: Record<string, any>): string {
  const accessibility = observation.accessibility ?? {};
  const windows = Array.isArray(accessibility.windows)
    ? accessibility.windows.map((window: any) => ({ id: window.id ?? window.window_id, role: window.role, modal: window.modal })).sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)))
    : [];
  return stable({
    modalWindow: accessibility.modal_window_id ?? null,
    focusedWindow: accessibility.focused_window_id ?? null,
    windows,
  });
}

function targetSignature(observation: Record<string, any>): string {
  const target = observation.target ?? observation.screenshotTarget ?? {};
  return stable({
    bundleId: target.bundleId ?? target.bundle_identifier ?? target.bundleID,
    pid: target.pid,
    windowId: target.window_id ?? target.windowID,
  });
}

type ResolvedAction = { action?: Record<string, unknown>; barrier?: StateBarrierReason };

function resolveAction(action: ActionBlockAction, observation: Record<string, any>): ResolvedAction {
  const { id: _id, target, consequential: _consequential, condition: _condition, timeoutMs: _timeoutMs, ...wire } = action;
  if (!target) return { action: wire };
  if (target.by === "visual") {
    if (target.observationId !== observationId(observation)) return { barrier: "stale_locator" };
    const { x, y, width, height } = target.region;
    if (![x, y, width, height].every((value) => Number.isFinite(value)) || width <= 0 || height <= 0) return { barrier: "stale_locator" };
    return { action: { ...wire, coordinate: [x + width / 2, y + height / 2] } };
  }
  if (target.by === "coordinate") {
    if (target.observationId !== observationId(observation)) return { barrier: "stale_locator" };
    if (![target.x, target.y].every((value) => typeof value === "number" && Number.isFinite(value))) return { barrier: "stale_locator" };
    return { action: { ...wire, coordinate: [target.x, target.y] } };
  }
  const elements = Array.isArray(observation.accessibility?.elements) ? observation.accessibility.elements : [];
  const matches = elements.filter((element: any) =>
    normalizedRole(element.role) === normalizedRole(target.role)
    && (target.name === undefined || accessibilityNames(element).includes(target.name))
    && (target.value === undefined || String(element.value ?? "") === target.value));
  if (matches.length === 0) return { barrier: "locator_missing" };
  if (matches.length > 1) return { barrier: "locator_ambiguous" };
  const match = matches[0];
  const binding = typeof match.element_token === "string" && match.element_token
    ? { element_token: match.element_token }
    : Number.isInteger(match.element_index)
      ? { element_index: match.element_index }
      : undefined;
  if (!binding) return { barrier: "locator_missing" };
  const snapshot = snapshotId(observation);
  return { action: { ...wire, ...binding, ...(snapshot ? { snapshot_id: snapshot } : {}) } };
}

function barrierFromRuntime(result: Record<string, any>, before: Record<string, any>): StateBarrierReason | undefined {
  if (result.outcomeUnknown === true || result.runtimeError?.code === "mutation_outcome_unknown") return "outcome_unknown";
  const code = String(result.runtimeError?.code ?? result.errorCode ?? "");
  if (/cancel/.test(code)) return "cancelled";
  if (/target_(?:missing|lost|unavailable)|computer_target_(?:missing|lost)/.test(code)) return "target_lost";
  if (/stale|snapshot/.test(code)) return "stale_locator";
  if (/handoff|captcha|authentication|protected/.test(code)) return "human_handoff";
  if (result.ok === false) return "technical_failure";
  if (result.batchInterrupted === true) {
    return result.interruptionReason === "snapshot_changed" ? "stale_locator" : "topology_changed";
  }
  if (targetSignature(before) !== targetSignature(result)) return "target_drift";
  if (topologySignature(before) !== topologySignature(result)) return "topology_changed";
  return undefined;
}

function actionEffects(request: ActionBlockRequest, actionId: string): DesktopCondition[] {
  return (request.expectedEffects ?? []).filter((condition) => !condition.actionId || condition.actionId === actionId);
}

async function executeWaitUntil(
  action: ActionBlockAction,
  current: Record<string, any>,
  execute: (actions: Record<string, unknown>[], signal?: AbortSignal) => Promise<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<Record<string, any>> {
  const condition = action.condition as DesktopCondition;
  if (conditionIsMet(condition, current)) return current;
  let remaining = Number(action.timeoutMs);
  let observation = current;
  while (remaining > 0) {
    const duration = Math.min(10_000, remaining);
    observation = await execute([{ type: "wait", duration_ms: duration }], signal) as Record<string, any>;
    if (conditionIsMet(condition, observation)) return observation;
    remaining -= duration;
  }
  return { ...observation, ok: false, runtimeError: { code: "wait_until_timeout", requiresObservation: true } };
}

export async function runGuardedActionBlock(
  request: ActionBlockRequest,
  context: {
    taskId: string;
    runId: string;
    maturity: WorkflowMaturity;
    checkpoint: TaskCheckpoint;
    observation: Record<string, unknown>;
    execute(actions: Record<string, unknown>[], signal?: AbortSignal): Promise<Record<string, unknown>>;
    signal?: AbortSignal;
    now?: () => string;
    receiptFactory?: () => string;
  },
): Promise<ActionBlockResult> {
  validateActionBlockRequest(request, context.maturity);
  const now = context.now ?? (() => new Date().toISOString());
  const receiptRef = context.receiptFactory?.() ?? `receipt:${randomUUID()}`;
  const completedActionIds: string[] = [];
  const skippedActionIds: string[] = [];
  const effects: ActionBlockResult["effects"] = [];
  let current = structuredClone(context.observation) as Record<string, any>;
  let outcome: ActionBlockResult["outcome"] = "completed";
  let stopReason: StateBarrierReason | undefined;

  for (let index = 0; index < request.actions.length; index += 1) {
    const action = request.actions[index];
    if (context.signal?.aborted) {
      outcome = "cancelled";
      stopReason = "cancelled";
      skippedActionIds.push(...request.actions.slice(index).map(({ id }) => id));
      break;
    }
    const expected = actionEffects(request, action.id);
    if (expected.length > 0 && expected.every((condition) => conditionIsMet(condition, current))) {
      skippedActionIds.push(action.id);
      effects.push({ actionId: action.id, status: "verified", ...(observationId(current) ? { evidenceRef: observationId(current) } : {}) });
      continue;
    }
    const signature = actionEffectSignature(action);
    if (isMutation(action) && action.consequential !== false && context.checkpoint.pendingUnknownEffects.some((pending) => pending.signature === signature)) {
      outcome = "stopped";
      stopReason = "consequential_effect_pending";
      skippedActionIds.push(...request.actions.slice(index).map(({ id }) => id));
      break;
    }
    const resolved = resolveAction(action, current);
    if (!resolved.action && action.type !== "wait_until") {
      outcome = "stopped";
      stopReason = resolved.barrier ?? "locator_missing";
      skippedActionIds.push(...request.actions.slice(index).map(({ id }) => id));
      break;
    }
    const before = current;
    try {
      current = action.type === "wait_until"
        ? await executeWaitUntil(action, current, context.execute, context.signal)
        : await context.execute([resolved.action!], context.signal) as Record<string, any>;
    } catch (error) {
      const errorCode = error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : undefined;
      const consequentialTimeout = errorCode === "computer_worker_runtime_timeout"
        && isMutation(action)
        && action.consequential !== false;
      current = {
        ...current,
        ok: false,
        ...(consequentialTimeout ? { outcomeUnknown: true } : {}),
        runtimeError: {
          code: consequentialTimeout ? "mutation_outcome_unknown" : errorCode ?? "runtime_error",
          message: error instanceof Error ? error.message : String(error),
          requiresObservation: true,
        },
      };
    }
    const barrier = barrierFromRuntime(current, before);
    if (barrier === "outcome_unknown") {
      const recordedAt = now();
      if (action.consequential !== false) {
        context.checkpoint.pendingUnknownEffects.push({ actionId: action.id, signature, consequential: true, recordedAt });
      }
      effects.push({ actionId: action.id, status: "unknown", ...(observationId(current) ? { evidenceRef: observationId(current) } : {}) });
      outcome = "outcome_unknown";
      stopReason = "outcome_unknown";
      skippedActionIds.push(...request.actions.slice(index + 1).map(({ id }) => id));
      break;
    }
    if (barrier && barrier !== "topology_changed") {
      outcome = barrier === "cancelled" ? "cancelled" : "stopped";
      stopReason = barrier;
      skippedActionIds.push(...request.actions.slice(index).map(({ id }) => id));
      break;
    }
    completedActionIds.push(action.id);
    const verified = expected.length > 0 && expected.every((condition) => conditionIsMet(condition, current));
    effects.push({ actionId: action.id, status: verified ? "verified" : "not_verified", ...(observationId(current) ? { evidenceRef: observationId(current) } : {}) });
    if (barrier === "topology_changed") {
      outcome = "stopped";
      stopReason = barrier;
      skippedActionIds.push(...request.actions.slice(index + 1).map(({ id }) => id));
      break;
    }
  }

  reconcileTaskCheckpoint(context.checkpoint, current, now());
  context.checkpoint.lastReceiptRef = receiptRef;
  context.checkpoint.updatedAt = now();
  return {
    outcome,
    completedActionIds,
    skippedActionIds,
    ...(stopReason ? { stopReason } : {}),
    effects,
    observation: current,
    receiptRef,
    checkpoint: structuredClone(context.checkpoint),
  };
}
