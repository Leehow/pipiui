/**
 * Boss plan-state tools. Persist under `.pi/plans/` and emit `plan_event` on the
 * existing host bridge so a Plans panel can render from the snapshot.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { encodePlanEventBridgeRequestV1 } from "../pi-ext/subagent/host-bridge.ts";
import { getPlanAdherenceSnapshot, type PlanAdherenceJob } from "../pi-ext/subagent/plan-drift.ts";

export const TASK_STATES = [
  "pending",
  "in_progress",
  "completed",
  "failed",
  "blocked",
  "skipped",
] as const;

export type TaskState = (typeof TASK_STATES)[number];
export type PlanLifecycle = "draft" | "active" | "approved" | "cancelled";

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
      if (!isRecord(plan) || typeof plan.id !== "string") continue;
      const snapshot = plan as PlanSnapshot;
      const legacyProgressedDraft = snapshot.lifecycle === "draft"
        && Array.isArray(snapshot.tasks)
        && snapshot.tasks.some((task) => isRecord(task) && isTaskState(task.state) && task.state !== "pending");
      // Before approvalRequired existed, every plan was persisted as draft even while its
      // tasks advanced. Treat that impossible "awaiting approval + already running" state as
      // ordinary active tracking so old sessions stop showing a retroactive confirmation.
      plans[id] = legacyProgressedDraft ? { ...snapshot, lifecycle: "active" } : snapshot;
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

/** Match the stronger reducer lifecycle: only cancelled or fully completed/skipped plans are terminal. */
function isPlanTerminal(plan: PlanSnapshot): boolean {
  return plan.lifecycle === "cancelled"
    || (plan.tasks.length > 0 && plan.tasks.every((task) => task.state === "completed" || task.state === "skipped"));
}

export async function publishPlan(
  cwd: string,
  input: { id: string; title: string; approvalRequired?: boolean; tasks: Array<{ id: string; title: string; state?: string }> },
  emit: typeof emitPlanEvent = emitPlanEvent,
): Promise<{ ok: true; plan: PlanSnapshot } | { ok: false; error: string }> {
  if (!input.id?.trim() || !input.title?.trim()) return { ok: false, error: "plan.id and plan.title are required" };
  if (!Array.isArray(input.tasks) || input.tasks.length === 0) return { ok: false, error: "plan.tasks must be a non-empty array" };
  const store = loadStore(cwd);
  if (store.plans[input.id]) return { ok: false, error: `duplicate plan id "${input.id}"` };
  const activePlan = store.activePlanId ? store.plans[store.activePlanId] : undefined;
  if (activePlan && !isPlanTerminal(activePlan)) {
    return { ok: false, error: "active plan in progress; finish it before publishing a new plan" };
  }
  const tasks: PlanTask[] = [];
  for (const task of input.tasks) {
    if (!task?.id?.trim() || !task.title?.trim()) return { ok: false, error: "each task needs id and title" };
    if (task.state !== undefined && !isTaskState(task.state)) return { ok: false, error: `invalid task state "${task.state}"` };
    tasks.push({ id: task.id, title: task.title, state: isTaskState(task.state) ? task.state : "pending" });
  }
  if (input.approvalRequired === true && tasks.some((task) => task.state !== "pending")) {
    return { ok: false, error: "a plan awaiting approval must publish every task as pending" };
  }
  const stamp = now();
  const plan: PlanSnapshot = {
    id: input.id,
    title: input.title,
    lifecycle: input.approvalRequired === true ? "draft" : "active",
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
  if (active.plan.lifecycle === "draft") {
    return { ok: false, error: `plan "${input.planId}" is awaiting user approval` };
  }
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
  if (active.plan.lifecycle === "active") {
    return { ok: false, error: `plan "${planId}" does not require approval` };
  }
  if (active.plan.lifecycle === "approved") return { ok: true, plan: active.plan };
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

const LIVE_JOB_STATES = new Set<PlanAdherenceJob["state"]>(["running", "queued"]);

export type PlanCheckWorkerTag = "plan-drift:missing" | "plan-drift:unknown-task" | "scope-drift";

export type PlanCheckTaskWorker = {
  agentId: string;
  runId: string;
  state: PlanAdherenceJob["state"];
  title?: string;
};

export type PlanCheckTask = {
  id: string;
  title: string;
  state: TaskState;
  note?: string;
  workers: PlanCheckTaskWorker[];
};

export type PlanCheckWorker = {
  agentId: string;
  runId: string;
  state: PlanAdherenceJob["state"];
  title?: string;
  planTask?: string;
  tags: PlanCheckWorkerTag[];
  scopeDrift?: string[];
};

export type PlanCheckCounts = {
  live: number;
  bound: number;
  unbound: number;
  planDrift: number;
  scopeDrift: number;
};

export type PlanCheckResult = {
  ok: true;
  plan: {
    id: string;
    title: string;
    lifecycle: PlanLifecycle;
    tasks: PlanCheckTask[];
    updatedAt: string;
    approvedAt?: string;
  } | null;
  counts: PlanCheckCounts;
  workers: PlanCheckWorker[];
  recentPlanDrift: ReturnType<typeof getPlanAdherenceSnapshot>["recentPlanDrift"];
};

function isOpenTask(task: PlanTask): boolean {
  return task.state === "pending" || task.state === "in_progress";
}

function isLiveJob(job: PlanAdherenceJob): boolean {
  return LIVE_JOB_STATES.has(job.state);
}

/**
 * Read-only join of the session plan store and the plan-adherence seam.
 * Never writes the store, never signals, never changes dispatch.
 */
export function checkPlan(cwd: string): PlanCheckResult {
  const store = loadStore(cwd);
  const snapshot = getPlanAdherenceSnapshot();
  const plan = store.activePlanId ? store.plans[store.activePlanId] ?? null : null;
  const openTaskIds = new Set(
    plan && (plan.lifecycle === "approved" || plan.lifecycle === "active")
      ? plan.tasks.filter(isOpenTask).map((task) => task.id)
      : [],
  );

  const latestDriftByAgent = new Map<string, (typeof snapshot.recentPlanDrift)[number]>();
  for (const signal of snapshot.recentPlanDrift) {
    latestDriftByAgent.set(signal.agentId, signal);
  }

  const workers: PlanCheckWorker[] = snapshot.jobs.map((job) => {
    const tags: PlanCheckWorkerTag[] = [];
    const drift = latestDriftByAgent.get(job.agentId);
    if (drift) tags.push(`plan-drift:${drift.reason}`);
    if (job.scopeDrift && job.scopeDrift.length > 0) tags.push("scope-drift");
    return {
      agentId: job.agentId,
      runId: job.runId,
      state: job.state,
      ...(job.title ? { title: job.title } : {}),
      ...(job.planTask ? { planTask: job.planTask } : {}),
      tags,
      ...(job.scopeDrift ? { scopeDrift: job.scopeDrift } : {}),
    };
  });

  const liveJobs = snapshot.jobs.filter(isLiveJob);
  let bound = 0;
  for (const job of liveJobs) {
    if (job.planTask && openTaskIds.has(job.planTask)) bound += 1;
  }

  const tasks: PlanCheckTask[] = plan
    ? plan.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        state: task.state,
        ...(task.note ? { note: task.note } : {}),
        workers: liveJobs
          .filter((job) => job.planTask === task.id)
          .map((job) => ({
            agentId: job.agentId,
            runId: job.runId,
            state: job.state,
            ...(job.title ? { title: job.title } : {}),
          })),
      }))
    : [];

  return {
    ok: true,
    plan: plan
      ? {
          id: plan.id,
          title: plan.title,
          lifecycle: plan.lifecycle,
          tasks,
          updatedAt: plan.updatedAt,
          ...(plan.approvedAt ? { approvedAt: plan.approvedAt } : {}),
        }
      : null,
    counts: {
      live: liveJobs.length,
      bound,
      unbound: liveJobs.length - bound,
      planDrift: snapshot.recentPlanDrift.length,
      scopeDrift: snapshot.jobs.filter((job) => (job.scopeDrift?.length ?? 0) > 0).length,
    },
    workers,
    recentPlanDrift: snapshot.recentPlanDrift,
  };
}

function cwdOf(ctx: { cwd?: string } | undefined): string {
  return ctx?.cwd || process.env.PIPIUI_MAIN_CWD || process.cwd();
}

export const PLAN_APPROVE_PROMPT = "批准该计划";
const DRAFT_CONTROL_TOOLS = new Set(["plan_publish", "plan_approve", "plan_cancel", "plan_check"]);

function toolCallFromPart(part: unknown): { name: string; arguments: Record<string, unknown> } | undefined {
  if (!isRecord(part)) return undefined;
  const nested = isRecord(part.toolCall) ? part.toolCall
    : isRecord(part.functionCall) ? part.functionCall
      : isRecord(part.function) ? part.function
        : undefined;
  const name = typeof part.name === "string" ? part.name : typeof nested?.name === "string" ? nested.name : undefined;
  if (!name) return undefined;
  const raw = part.arguments ?? part.input ?? part.args ?? nested?.arguments ?? nested?.input ?? nested?.args;
  if (isRecord(raw)) return { name, arguments: raw };
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return { name, arguments: isRecord(parsed) ? parsed : {} };
    } catch {
      return { name, arguments: {} };
    }
  }
  return { name, arguments: {} };
}

function currentAssistantPublishesApprovalRequiredPlan(ctx: { sessionManager?: { getBranch?: () => unknown[] } }): boolean {
  const branch = ctx.sessionManager?.getBranch?.();
  if (!Array.isArray(branch)) return false;
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index] as { type?: unknown; message?: unknown };
    if (entry?.type !== "message") continue;
    const message = entry.message as { role?: unknown; content?: unknown } | undefined;
    if (message?.role !== "assistant" || !Array.isArray(message.content)) return false;
    return message.content.some((part) => {
      const call = toolCallFromPart(part);
      const plan = call?.arguments.plan;
      return call?.name === "plan_publish" && isRecord(plan) && plan.approvalRequired === true;
    });
  }
  return false;
}

export function draftPlanToolCallBlockReason(
  cwd: string,
  toolName: string,
  currentBatchPublishesDraft = false,
): string | undefined {
  if (DRAFT_CONTROL_TOOLS.has(toolName)) return undefined;
  const store = loadStore(cwd);
  const active = store.activePlanId ? store.plans[store.activePlanId] : undefined;
  if (!currentBatchPublishesDraft && active?.lifecycle !== "draft") return undefined;
  const planLabel = active ? `plan "${active.id}"` : "the plan being published";
  return `${planLabel} is awaiting user approval. Do not execute tools until the user approves it; only plan_approve, plan_cancel, and plan_check are allowed.`;
}

export default function (pi: ExtensionAPI) {
  pi.on("input", async (event, ctx) => {
    if (event.source === "extension" || event.text.trim() !== PLAN_APPROVE_PROMPT) return;
    const store = loadStore(ctx.cwd);
    const active = store.activePlanId ? store.plans[store.activePlanId] : undefined;
    if (active?.lifecycle === "draft") await approvePlan(ctx.cwd, active.id);
  });

  pi.on("tool_call", (event, ctx) => {
    const reason = draftPlanToolCallBlockReason(
      ctx.cwd,
      event.toolName,
      currentAssistantPublishesApprovalRequiredPlan(ctx),
    );
    if (reason) return { block: true, reason, terminate: true };
  });

  pi.registerTool({
    name: "plan_publish",
    label: "Plan Publish",
    description: "Publish one full-spec structured execution plan with a stable plan.id. Set approvalRequired=false for ordinary progress tracking (the plan becomes active immediately); set approvalRequired=true only for a formal plan that must wait for explicit user approval. Cover the entire spec. Do not publish only the current stage; do not publish a stage2/stage3 replacement. Keep the same plan.id through later phases.",
    promptSnippet: "Publish a full task list, explicitly say whether approval is required, and ensure later phases stay on this plan",
    parameters: Type.Object({
      plan: Type.Object({
        id: Type.String({ minLength: 1 }),
        title: Type.String({ minLength: 1 }),
        approvalRequired: Type.Boolean({ description: "true only for a formal plan that must stop until the user approves; false for ordinary progress tracking" }),
        tasks: Type.Array(Type.Object({
          id: Type.String({ minLength: 1 }),
          title: Type.String({ minLength: 1 }),
          state: Type.Optional(Type.String()),
        }), { minItems: 1 }),
      }),
    }),
    prepareArguments(args) {
      if (!isRecord(args) || !isRecord(args.plan) || typeof args.plan.approvalRequired === "boolean") return args;
      return { ...args, plan: { ...args.plan, approvalRequired: false } };
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const outcome = await publishPlan(cwdOf(ctx), params.plan);
      return result(outcome, !outcome.ok);
    },
  });

  pi.registerTool({
    name: "plan_task_update",
    label: "Plan Task Update",
    description: "Update one task on the active plan. Always pass the same planId published earlier; never invent a new plan id mid-execution, including when starting the next phase.",
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
    promptSnippet: "Approve the published plan after the user clicks 批准 or clearly approves",
    parameters: Type.Object({
      planId: Type.String({ minLength: 1 }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const outcome = await approvePlan(cwdOf(ctx), params.planId);
      if (!outcome.ok) return result(outcome, true);
      const listed = outcome.plan.tasks
        .map((task, index) => `${index + 1}. ${task.title}`)
        .join("\n");
      return result({
        ...outcome,
        guidance: [
          "Never hand the whole plan to a single general-purpose worker.",
          "dispatch one worker per independent task in the SAME turn.",
          "Drive plan_task_update as each task's worker starts and ends.",
          "Keep this same plan.id through later phases; do not publish a stage2/stage3 replacement plan.",
          "Refine leftover slices with worker briefs and dependencies, not a new plan.",
          "Tasks:",
          listed,
        ].join(" "),
      });
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

  pi.registerTool({
    name: "plan_check",
    label: "Plan Check",
    description: "Read-only snapshot of the active plan: task status, bound workers, recent plan-drift and scope-drift. Advisory; never changes dispatch.",
    promptSnippet: "Read-only plan × worker × drift snapshot",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      return result(checkPlan(cwdOf(ctx)));
    },
  });
}
