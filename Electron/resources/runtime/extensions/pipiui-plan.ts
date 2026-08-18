/**
 * Boss plan-state tools. Persist under `.pi/plans/` and emit `plan_event` on the
 * existing host bridge so a Plans panel can render from the snapshot.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { encodePlanEventBridgeRequestV1 } from "../pi-ext/subagent/host-bridge.ts";

export const TASK_STATES = [
  "pending",
  "in_progress",
  "completed",
  "failed",
  "blocked",
  "skipped",
] as const;

export type TaskState = (typeof TASK_STATES)[number];
export type PlanLifecycle = "draft" | "approved" | "cancelled";

export type PlanTask = {
  id: string;
  title: string;
  state: TaskState;
  note?: string;
};

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
};

type Store = {
  activePlanId: string | null;
  plans: Record<string, PlanSnapshot>;
};

const STORE_NAME = "current.json";
const SESSION_ID = process.env.PIPIUI_SESSION_ID;
const PORT = process.env.PIPIUI_BRIDGE_PORT;
const SESSION_KEY = process.env.PIPIUI_SESSION_KEY;
const CAPABILITY = process.env.PIPIUI_SESSION_CAPABILITY;
const HOST_PROTOCOL = process.env.PIPIUI_HOST_PROTOCOL;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTaskState(value: unknown): value is TaskState {
  return typeof value === "string" && (TASK_STATES as readonly string[]).includes(value);
}

export function plansDir(cwd: string): string {
  return join(cwd, ".pi", "plans");
}

/**
 * A plan belongs to one conversation, so the store is keyed by session id.
 * Every session of a project shares its work tree; a single `current.json`
 * would make two chats overwrite each other's active plan and let one show the
 * other's steps. A host that supplies no session id (bare pi, older host) keeps
 * the legacy single-file name.
 */
export function storeFileName(sessionId: string | undefined = SESSION_ID): string {
  const safe = (sessionId ?? "").replace(/[^A-Za-z0-9._-]/g, "");
  return safe ? `${safe}.json` : STORE_NAME;
}

export function storePath(cwd: string, sessionId?: string): string {
  return join(plansDir(cwd), storeFileName(sessionId));
}

function emptyStore(): Store {
  return { activePlanId: null, plans: {} };
}

export function loadStore(cwd: string): Store {
  try {
    const raw = JSON.parse(readFileSync(storePath(cwd), "utf8")) as unknown;
    if (!isRecord(raw) || !isRecord(raw.plans)) return emptyStore();
    const plans: Record<string, PlanSnapshot> = {};
    for (const [id, plan] of Object.entries(raw.plans)) {
      if (isRecord(plan) && typeof plan.id === "string") plans[id] = plan as PlanSnapshot;
    }
    const active = typeof raw.activePlanId === "string" ? raw.activePlanId : null;
    return { activePlanId: active && plans[active] ? active : null, plans };
  } catch {
    return emptyStore();
  }
}

export function saveStore(cwd: string, store: Store): void {
  const file = storePath(cwd);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function now(): string {
  return new Date().toISOString();
}

function result(value: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    details: value,
    ...(isError ? { isError: true } : {}),
  };
}

export async function emitPlanEvent(
  event: string,
  plan: PlanSnapshot,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!PORT) return;
  const payload = { event, plan };
  const body = encodePlanEventBridgeRequestV1(payload, {
    PIPIUI_HOST_PROTOCOL: HOST_PROTOCOL,
    PIPIUI_SESSION_KEY: SESSION_KEY,
    PIPIUI_SESSION_CAPABILITY: CAPABILITY,
  });
  if (!body) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  timer.unref?.();
  try {
    await fetchImpl(`http://127.0.0.1:${PORT}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    // Bridge is observability; persisted plan state is the source of truth.
  } finally {
    clearTimeout(timer);
  }
}

function requireActivePlan(store: Store, planId: string): { ok: true; plan: PlanSnapshot } | { ok: false; error: string } {
  if (!store.activePlanId) return { ok: false, error: "no active plan" };
  if (planId !== store.activePlanId) {
    return { ok: false, error: `planId "${planId}" is not the active plan "${store.activePlanId}"` };
  }
  const plan = store.plans[planId];
  if (!plan) return { ok: false, error: `unknown plan "${planId}"` };
  return { ok: true, plan };
}

export async function publishPlan(
  cwd: string,
  input: { id: string; title: string; tasks: Array<{ id: string; title: string; state?: string }> },
  emit: typeof emitPlanEvent = emitPlanEvent,
): Promise<{ ok: true; plan: PlanSnapshot } | { ok: false; error: string }> {
  if (!input.id?.trim() || !input.title?.trim()) return { ok: false, error: "plan.id and plan.title are required" };
  if (!Array.isArray(input.tasks) || input.tasks.length === 0) return { ok: false, error: "plan.tasks must be a non-empty array" };
  const store = loadStore(cwd);
  if (store.plans[input.id]) return { ok: false, error: `duplicate plan id "${input.id}"` };
  const tasks: PlanTask[] = [];
  for (const task of input.tasks) {
    if (!task?.id?.trim() || !task.title?.trim()) return { ok: false, error: "each task needs id and title" };
    if (task.state !== undefined && !isTaskState(task.state)) return { ok: false, error: `invalid task state "${task.state}"` };
    tasks.push({ id: task.id, title: task.title, state: isTaskState(task.state) ? task.state : "pending" });
  }
  const stamp = now();
  const plan: PlanSnapshot = {
    id: input.id,
    title: input.title,
    lifecycle: "draft",
    tasks,
    createdAt: stamp,
    updatedAt: stamp,
  };
  store.plans[plan.id] = plan;
  store.activePlanId = plan.id;
  saveStore(cwd, store);
  await emit("plan_publish", plan);
  return { ok: true, plan };
}

export async function updateTask(
  cwd: string,
  input: { planId: string; taskId: string; state: string; note?: string },
  emit: typeof emitPlanEvent = emitPlanEvent,
): Promise<{ ok: true; plan: PlanSnapshot } | { ok: false; error: string }> {
  if (!isTaskState(input.state)) return { ok: false, error: `invalid task state "${input.state}"` };
  const store = loadStore(cwd);
  const active = requireActivePlan(store, input.planId);
  if (!active.ok) return active;
  const task = active.plan.tasks.find((item) => item.id === input.taskId);
  if (!task) return { ok: false, error: `unknown task "${input.taskId}"` };
  task.state = input.state;
  if (input.note !== undefined) task.note = input.note;
  active.plan.updatedAt = now();
  saveStore(cwd, store);
  await emit("plan_task_update", active.plan);
  return { ok: true, plan: active.plan };
}

export async function approvePlan(
  cwd: string,
  planId: string,
  emit: typeof emitPlanEvent = emitPlanEvent,
): Promise<{ ok: true; plan: PlanSnapshot } | { ok: false; error: string }> {
  const store = loadStore(cwd);
  const active = requireActivePlan(store, planId);
  if (!active.ok) return active;
  const stamp = now();
  active.plan.lifecycle = "approved";
  active.plan.approvedAt = stamp;
  active.plan.updatedAt = stamp;
  saveStore(cwd, store);
  await emit("plan_approve", active.plan);
  return { ok: true, plan: active.plan };
}

export async function cancelPlan(
  cwd: string,
  planId: string,
  reason: string | undefined,
  emit: typeof emitPlanEvent = emitPlanEvent,
): Promise<{ ok: true; plan: PlanSnapshot } | { ok: false; error: string }> {
  const store = loadStore(cwd);
  const active = requireActivePlan(store, planId);
  if (!active.ok) return active;
  const stamp = now();
  active.plan.lifecycle = "cancelled";
  active.plan.cancelledAt = stamp;
  active.plan.updatedAt = stamp;
  if (reason !== undefined) active.plan.cancelReason = reason;
  store.activePlanId = null;
  saveStore(cwd, store);
  await emit("plan_cancel", active.plan);
  return { ok: true, plan: active.plan };
}

function cwdOf(ctx: { cwd?: string } | undefined): string {
  return ctx?.cwd || process.env.PIPIUI_MAIN_CWD || process.cwd();
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "plan_publish",
    label: "Plan Publish",
    description: "Publish a structured execution plan with a stable unique plan.id and ordered tasks. Replaces transcript-only planning when formal planning is required.",
    promptSnippet: "Publish a structured plan with stable plan.id and tasks",
    parameters: Type.Object({
      plan: Type.Object({
        id: Type.String({ minLength: 1 }),
        title: Type.String({ minLength: 1 }),
        tasks: Type.Array(Type.Object({
          id: Type.String({ minLength: 1 }),
          title: Type.String({ minLength: 1 }),
          state: Type.Optional(Type.String()),
        }), { minItems: 1 }),
      }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const outcome = await publishPlan(cwdOf(ctx), params.plan);
      return result(outcome, !outcome.ok);
    },
  });

  pi.registerTool({
    name: "plan_task_update",
    label: "Plan Task Update",
    description: "Update one task on the active plan. Always pass the same planId published earlier; never invent a new plan id mid-execution.",
    promptSnippet: "Update a published plan task state",
    parameters: Type.Object({
      planId: Type.String({ minLength: 1 }),
      taskId: Type.String({ minLength: 1 }),
      state: Type.String({ description: TASK_STATES.join(" | ") }),
      note: Type.Optional(Type.String()),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const outcome = await updateTask(cwdOf(ctx), params);
      return result(outcome, !outcome.ok);
    },
  });

  pi.registerTool({
    name: "plan_approve",
    label: "Plan Approve",
    description: "Mark the published plan approved after the user accepts it. Call with the same plan.id from plan_publish.",
    promptSnippet: "Approve the published plan after user Execute",
    parameters: Type.Object({
      planId: Type.String({ minLength: 1 }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const outcome = await approvePlan(cwdOf(ctx), params.planId);
      return result(outcome, !outcome.ok);
    },
  });

  pi.registerTool({
    name: "plan_cancel",
    label: "Plan Cancel",
    description: "Cancel the published plan (Adjust or Ignore). Optionally record a reason.",
    promptSnippet: "Cancel the published plan",
    parameters: Type.Object({
      planId: Type.String({ minLength: 1 }),
      reason: Type.Optional(Type.String()),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const outcome = await cancelPlan(cwdOf(ctx), params.planId, params.reason);
      return result(outcome, !outcome.ok);
    },
  });
}
