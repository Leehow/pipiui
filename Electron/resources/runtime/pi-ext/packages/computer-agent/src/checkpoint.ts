export type DesktopCondition =
  | { actionId?: string; kind: "visible_text"; contains: string }
  | { actionId?: string; kind: "element_exists"; role?: string; name: string }
  | { actionId?: string; kind: "element_value"; role?: string; name: string; value: string }
  | { actionId?: string; kind: "application"; bundleId: string };

export type VerifiedFact = {
  description: string;
  evidenceRef: string;
  verifiedAt: string;
};

export type PendingEffect = {
  actionId: string;
  signature: string;
  consequential: boolean;
  recordedAt: string;
};

export type TaskCheckpoint = {
  taskId: string;
  goal: string;
  constraints: string[];
  successConditions: DesktopCondition[];
  verifiedFacts: VerifiedFact[];
  pendingUnknownEffects: PendingEffect[];
  activeApplication?: { bundleId: string; appName: string };
  activeWorkflow?: { id: string; version: number; state: "candidate" | "practiced" | "suspended" };
  lastObservationRef?: string;
  lastReceiptRef?: string;
  updatedAt: string;
};

type Observation = Record<string, any>;

function observationId(observation: Observation): string | undefined {
  const value = observation.observationId ?? observation.screenshotId ?? observation.id;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizedRole(value: unknown): string {
  return String(value ?? "").replace(/^AX/i, "").toLowerCase();
}

function elements(observation: Observation): Array<Record<string, unknown>> {
  return Array.isArray(observation.accessibility?.elements)
    ? observation.accessibility.elements
    : Array.isArray(observation.elements)
      ? observation.elements
      : [];
}

export function conditionDescription(condition: DesktopCondition): string {
  if (condition.kind === "visible_text") return `visible text contains ${condition.contains}`;
  if (condition.kind === "element_exists") return `element ${condition.role ?? "*"}:${condition.name} exists`;
  if (condition.kind === "element_value") return `element ${condition.role ?? "*"}:${condition.name} has value ${condition.value}`;
  return `application ${condition.bundleId} is active`;
}

export function conditionIsMet(condition: DesktopCondition, observation: Observation): boolean {
  if (condition.kind === "application") {
    const target = observation.target ?? observation.screenshotTarget ?? {};
    return [target.bundleId, target.bundle_identifier, target.bundleID]
      .some((value) => String(value ?? "").toLowerCase() === condition.bundleId.toLowerCase());
  }
  const candidates = elements(observation);
  if (condition.kind === "visible_text") {
    return candidates.some((element) => [element.name, element.value, element.text]
      .some((value) => String(value ?? "").includes(condition.contains)));
  }
  return candidates.some((element) => {
    if (condition.role && normalizedRole(element.role) !== normalizedRole(condition.role)) return false;
    const name = String(element.name ?? element.label ?? element.title ?? element.text ?? "");
    if (name !== condition.name) return false;
    return condition.kind !== "element_value" || String(element.value ?? "") === condition.value;
  });
}

export function createTaskCheckpoint(input: {
  taskId: string;
  goal: string;
  constraints?: string[];
  successConditions?: DesktopCondition[];
  now?: string;
}): TaskCheckpoint {
  if (!input.taskId.trim() || !input.goal.trim()) throw new Error("Task Checkpoint requires taskId and goal");
  const now = input.now ?? new Date().toISOString();
  return {
    taskId: input.taskId,
    goal: input.goal.trim(),
    constraints: [...(input.constraints ?? [])],
    successConditions: structuredClone(input.successConditions ?? []),
    verifiedFacts: [],
    pendingUnknownEffects: [],
    updatedAt: now,
  };
}

export function reconcileTaskCheckpoint(
  checkpoint: TaskCheckpoint,
  observation: Observation,
  now = new Date().toISOString(),
): TaskCheckpoint {
  const reconciled = structuredClone(checkpoint);
  const reference = observationId(observation);
  if (reference) reconciled.lastObservationRef = reference;
  const existing = new Set(reconciled.verifiedFacts.map((fact) => fact.description));
  for (const condition of reconciled.successConditions) {
    if (!reference || !conditionIsMet(condition, observation)) continue;
    const description = conditionDescription(condition);
    if (existing.has(description)) continue;
    existing.add(description);
    reconciled.verifiedFacts.push({ description, evidenceRef: reference, verifiedAt: now });
  }
  const target = observation.target ?? observation.screenshotTarget;
  const bundleId = target?.bundleId ?? target?.bundle_identifier ?? target?.bundleID;
  const appName = target?.appName ?? target?.application_name ?? target?.applicationName;
  if (typeof bundleId === "string" && bundleId && typeof appName === "string" && appName) {
    reconciled.activeApplication = { bundleId, appName };
  }
  reconciled.updatedAt = now;
  Object.assign(checkpoint, structuredClone(reconciled));
  return reconciled;
}
