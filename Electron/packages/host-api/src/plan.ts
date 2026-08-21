/**
 * Boss plan state, as produced by the bundled `pipiui-plan` Pi extension.
 *
 * The extension owns the durable copy (`<cwd>/.pi/plans/current.json`) and
 * posts every mutation to the host bridge; the host re-publishes it on the
 * `plan` channel so a Plan panel can render without reading the project's
 * files. Both sides normalize through `normalizePlanSnapshot` so a hand-edited
 * or older store never reaches the UI as a half-typed object.
 */

export const PLAN_TASK_STATES = ["pending", "in_progress", "completed", "failed", "blocked", "skipped"] as const;
export type PlanTaskState = (typeof PLAN_TASK_STATES)[number];
export const PLAN_LIFECYCLES = ["draft", "approved", "cancelled"] as const;
export type PlanLifecycle = (typeof PLAN_LIFECYCLES)[number];
export type PlanTask = { id: string; title: string; state: PlanTaskState; note?: string };
export type PlanSnapshot = {
  id: string;
  title: string;
  lifecycle: PlanLifecycle;
  tasks: PlanTask[];
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  /** Host-attached: the session whose runtime published this plan. */
  sessionId?: string;
  /** Host-attached: true while this is the store's `activePlanId`. */
  active?: boolean;
};

export const PLAN_EVENT_KINDS = ["plan_publish", "plan_task_update", "plan_approve", "plan_cancel"] as const;
export type PlanEventKind = (typeof PLAN_EVENT_KINDS)[number];
export type PlanEvent = { type: "plan"; sessionId: string; kind: PlanEventKind; plan: PlanSnapshot };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function isPlanTaskState(value: unknown): value is PlanTaskState {
  return typeof value === "string" && (PLAN_TASK_STATES as readonly string[]).includes(value);
}

export function planEventKind(value: unknown): PlanEventKind | null {
  return typeof value === "string" && (PLAN_EVENT_KINDS as readonly string[]).includes(value) ? (value as PlanEventKind) : null;
}

function normalizeTask(value: unknown): PlanTask | null {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  const title = text(value.title);
  if (!id || !title) return null;
  // The publisher defaults a missing/unknown state to "pending"; mirror it rather
  // than dropping the task, so one bad field never hides a step from the user.
  const task: PlanTask = { id, title, state: isPlanTaskState(value.state) ? value.state : "pending" };
  const note = text(value.note);
  if (note) task.note = note;
  return task;
}

/** Structural parse of one plan snapshot. Returns null when the payload is not a plan. */
export function normalizePlanSnapshot(value: unknown): PlanSnapshot | null {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  const title = text(value.title);
  if (!id || !title || !Array.isArray(value.tasks)) return null;
  const tasks: PlanTask[] = [];
  for (const entry of value.tasks) {
    const task = normalizeTask(entry);
    if (task) tasks.push(task);
  }
  const lifecycle = typeof value.lifecycle === "string" && (PLAN_LIFECYCLES as readonly string[]).includes(value.lifecycle)
    ? (value.lifecycle as PlanLifecycle)
    : "draft";
  const stamp = text(value.updatedAt) ?? text(value.createdAt) ?? new Date(0).toISOString();
  const plan: PlanSnapshot = {
    id,
    title,
    lifecycle,
    tasks,
    createdAt: text(value.createdAt) ?? stamp,
    updatedAt: stamp,
  };
  const approvedAt = text(value.approvedAt);
  const cancelledAt = text(value.cancelledAt);
  const cancelReason = text(value.cancelReason);
  const sessionId = text(value.sessionId);
  if (approvedAt) plan.approvedAt = approvedAt;
  if (cancelledAt) plan.cancelledAt = cancelledAt;
  if (cancelReason) plan.cancelReason = cancelReason;
  if (sessionId) plan.sessionId = sessionId;
  if (typeof value.active === "boolean") plan.active = value.active;
  return plan;
}

export type PlanProgress = Record<PlanTaskState, number> & {
  total: number;
  /** completed + skipped + failed: steps that will not run again. */
  settled: number;
  /** settled / total, 0 for an empty plan. */
  ratio: number;
};

export function planProgress(plan: Pick<PlanSnapshot, "tasks">): PlanProgress {
  const counts = { pending: 0, in_progress: 0, completed: 0, failed: 0, blocked: 0, skipped: 0 };
  for (const task of plan.tasks) counts[task.state] += 1;
  const total = plan.tasks.length;
  const settled = counts.completed + counts.skipped + counts.failed;
  return { ...counts, total, settled, ratio: total ? settled / total : 0 };
}

/** A plan the user still has to watch: published, not cancelled, and not finished. */
export function planIsLive(plan: PlanSnapshot): boolean {
  if (plan.active === false) return false;
  if (plan.lifecycle === "cancelled") return false;
  return planProgress(plan).settled < plan.tasks.length;
}

/** Newest activity first; a live plan always sorts above a settled one. */
export function sortPlans(plans: readonly PlanSnapshot[]): PlanSnapshot[] {
  return [...plans].sort((left, right) => {
    const liveGap = Number(planIsLive(right)) - Number(planIsLive(left));
    if (liveGap) return liveGap;
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}
