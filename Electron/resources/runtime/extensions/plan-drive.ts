/**
 * Plan continuation driver: keeps a session working while its published plan
 * still has open tasks.
 *
 * Why this exists: the plan store is bookkeeping. Without a driver, a plan with
 * pending tasks is two lines of UI text - nothing stops a turn from ending on
 * "tell me which way to go" while tasks that do not depend on that answer sit
 * untouched, and nothing re-enters the session afterwards.
 *
 * Why this is not pi-goal: /goal already owns an equivalent loop, but its
 * continuation is welded to ActiveGoal - token budgets, safety epochs, tool
 * policy, session-persisted goal state. Reusing that class would mean minting a
 * goal for every plan. This module reuses the *protocol* instead (mark an owned
 * prompt, request it at agent_end, dispatch once the run has settled, fuse on
 * turn count and lack of progress) and stands down whenever a goal is active,
 * so the two drivers can never continue the same turn twice.
 */
import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type DriveTaskState =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "blocked"
  | "skipped";

export type DriveTask = { id: string; title: string; state: DriveTaskState; note?: string; blockedBy?: string[] };

/** Structural subset of the plan store's snapshot; keeps this module free of a store import. */
export type DrivePlan = {
  id: string;
  title: string;
  lifecycle: "draft" | "active" | "approved" | "cancelled";
  tasks: DriveTask[];
};

export const PLAN_CONTINUATION_MARKER_PREFIX = "pipiui-plan-continuation:";
/** Matches pi-goal's default continuation ceiling; a runaway plan costs the same as a runaway goal. */
export const PLAN_AUTOMATIC_TURN_LIMIT = 25;
export const PLAN_NO_PROGRESS_LIMIT = 3;

/**
 * Duplicated from pi-goal/src/auto-resume.ts on purpose: the host sets this for
 * archived sessions and sessions the user manually stopped, and a plan must not
 * resurrect what a goal is forbidden to. Vendored runtime trees stay
 * dependency-isolated from each other, so the literal travels, not an import.
 */
const AUTO_RESUME_ENV = "PIPIUI_GOAL_AUTO_RESUME";
/** Session custom-entry type pi-goal persists its state under; read-only probe, same reason. */
const GOAL_STATE_ENTRY_TYPE = "goal-state";

const MARKER_PATTERN = new RegExp(
  `<!--\\s*${PLAN_CONTINUATION_MARKER_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\s>]+)\\s*-->`,
);

export type HaltReason = "aborted" | "turn_limit" | "no_progress";

export interface DriveContext {
  cwd?: string;
  ui?: { notify: (message: string, level?: "info" | "warning" | "error") => void };
  isIdle?: () => boolean;
  hasPendingMessages?: () => boolean;
  sessionManager?: { getBranch?: () => unknown[]; getEntries?: () => unknown[] };
}

export interface DriveDeps {
  /** Reads the session's active plan from the plan store. */
  readActivePlan: (ctx: DriveContext) => DrivePlan | undefined;
  /**
   * Whether dispatched workers are still running or queued. A session waiting on
   * its own workers already has a wake-up (their completion alarm); driving it
   * meanwhile would only burn turns that can report nothing new.
   */
  hasLiveWorkers?: () => boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function openTasks(plan: DrivePlan): DriveTask[] {
  return plan.tasks.filter((task) => task.state === "pending" || task.state === "in_progress");
}

/** Only a published, non-draft plan with work left is worth re-entering the session for. */
export function planIsDrivable(plan: DrivePlan | undefined): plan is DrivePlan {
  if (!plan) return false;
  if (plan.lifecycle !== "active" && plan.lifecycle !== "approved") return false;
  return openTasks(plan).length > 0;
}

/** Task-state signature; a change between two turn boundaries is what "progress" means here. */
export function planFingerprint(plan: DrivePlan): string {
  return `${plan.id} ${plan.tasks.map((task) => `${task.id}:${task.state}`).join("|")}`;
}

export function extractPlanContinuationMarker(text: string): string | undefined {
  return MARKER_PATTERN.exec(text)?.[1];
}

function markerFor(planId: string, iteration: number): string {
  const safeId = planId.replace(/[^A-Za-z0-9._-]/g, "-");
  return `${safeId}.${iteration}.${randomUUID().slice(0, 8)}`;
}

function taskLines(plan: DrivePlan): string {
  return plan.tasks
    .map((task, index) => {
      const note = task.note ? ` - ${task.note.replace(/\s+/gu, " ").trim()}` : "";
      const deps = task.blockedBy?.length ? ` (after ${task.blockedBy.join(", ")})` : "";
      return `${index + 1}. [${task.state}] ${task.id}: ${task.title}${deps}${note}`;
    })
    .join("\n");
}

/** Pending tasks whose blockers are all completed or skipped. Mirrors readyTaskIds in the store. */
export function readyTasks(plan: DrivePlan): DriveTask[] {
  const settled = new Set(plan.tasks.filter((task) => task.state === "completed" || task.state === "skipped").map((task) => task.id));
  return plan.tasks.filter((task) => task.state === "pending" && (task.blockedBy ?? []).every((dep) => settled.has(dep)));
}

function planStatusBlock(plan: DrivePlan): string {
  const settled = plan.tasks.length - openTasks(plan).length;
  const ready = readyTasks(plan).map((task) => task.id);
  const readyLine = ready.length > 0 ? `Ready now (blockers settled): ${ready.join(", ")}` : "Ready now: none";
  return `<plan_status>\nPlan "${plan.title}" (id ${plan.id}) - ${settled}/${plan.tasks.length} tasks settled.\n${taskLines(plan)}\n${readyLine}\n</plan_status>`;
}

/**
 * What the driver itself does — stated as facts about this runtime, not as
 * working method. How to work a plan (per-task blocking, what counts as
 * evidence, when to hand control back) is the philosophy planning layer's job.
 */
function planDriveFacts(): string {
  return [
    "Plan continuation (runtime facts):",
    `- While the active plan has tasks in pending or in_progress, this session is re-entered automatically after each turn; it stops after ${PLAN_AUTOMATIC_TURN_LIMIT} automatic turns, or after ${PLAN_NO_PROGRESS_LIMIT} consecutive automatic turns that changed no task state.`,
    "- Tasks in blocked, failed, completed or skipped are settled for the driver: a plan whose remaining tasks are all settled is not re-entered, and a blocked task waits for the user rather than for this loop.",
    "- Ready now = pending tasks whose blockedBy list is fully completed or skipped.",
  ].join("\n");
}

export function buildPlanSystemPrompt(plan: DrivePlan): string {
  return `Active plan:\n${planStatusBlock(plan)}\n\n${planDriveFacts()}`;
}

export function buildPlanContinuePrompt(plan: DrivePlan, marker: string, iteration: number): string {
  const blocked = plan.tasks.filter((task) => task.state === "blocked");
  const blockedLine = blocked.length
    ? `\n\n${blocked.length} task(s) are marked blocked and are waiting on the user; they are outside this continuation.`
    : "";
  return [
    "Continue the active plan until every task is settled:",
    "",
    planStatusBlock(plan),
    "",
    `This is automatic plan continuation #${iteration}. The open tasks above are still yours; pick up the ready ones and do the work.${blockedLine}`,
    "",
    planDriveFacts(),
    "",
    `<!-- ${PLAN_CONTINUATION_MARKER_PREFIX}${marker} -->`,
  ].join("\n");
}

function autoResumeBlocked(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[AUTO_RESUME_ENV] === "blocked";
}

/**
 * True while pi-goal holds an active goal. The goal engine continues the same
 * turn boundary, so the plan driver must stay quiet rather than send a second
 * follow-up. Read-only, newest entry wins.
 */
export function goalDrivesSession(ctx: DriveContext): boolean {
  const entries = ctx.sessionManager?.getBranch?.() ?? ctx.sessionManager?.getEntries?.() ?? [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!isRecord(entry) || entry.type !== "custom" || entry.customType !== GOAL_STATE_ENTRY_TYPE) {
      continue;
    }
    const data = entry.data;
    if (!isRecord(data)) return false;
    const goal = data.goal;
    return isRecord(goal) && goal.status === "active";
  }
  return false;
}

export function finalAssistantStopReason(messages: readonly unknown[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isRecord(message) || message.role !== "assistant") continue;
    return typeof message.stopReason === "string" ? message.stopReason : undefined;
  }
  return undefined;
}

export function hasAssistantToolCall(messages: readonly unknown[]): boolean {
  for (const message of messages) {
    if (!isRecord(message) || message.role !== "assistant" || !Array.isArray(message.content)) {
      continue;
    }
    if (message.content.some((block) => isRecord(block) && block.type === "toolCall")) return true;
  }
  return false;
}

type Ticket = { planId: string; marker: string; prompt: string };

export class PlanDriver {
  private intent?: Ticket;
  private delivery?: Ticket;
  /** Whether the turn that is ending was started by our own continuation prompt. */
  private turnIsOurs = false;
  private automaticTurns = 0;
  /**
   * Prompts actually sent since the last user turn. `automaticTurns` counts the
   * turns we can *see* start; this counts what we sent whether or not the start
   * boundary came back, so a lost before_agent_start can never leave the loop
   * unbounded.
   */
  private sentSinceUserTurn = 0;
  private noProgressTurns = 0;
  private iteration = 0;
  private lastFingerprint?: string;
  private haltReason?: HaltReason;

  constructor(private readonly send: (prompt: string) => void) {}

  reset(): void {
    this.intent = undefined;
    this.delivery = undefined;
    this.turnIsOurs = false;
    this.automaticTurns = 0;
    this.sentSinceUserTurn = 0;
    this.noProgressTurns = 0;
    this.iteration = 0;
    this.lastFingerprint = undefined;
    this.haltReason = undefined;
  }

  /** Exposed so tests and status rendering can read the fuses without poking privates. */
  get state() {
    return {
      automaticTurns: this.automaticTurns,
      sentSinceUserTurn: this.sentSinceUserTurn,
      noProgressTurns: this.noProgressTurns,
      haltReason: this.haltReason,
      pending: this.intent?.marker,
    };
  }

  /**
   * A prompt we did not mint is a fresh, user-owned boundary: it supersedes any
   * queued continuation and gives the fuses a clean budget, the same way genuine
   * user input resets a goal's safety epoch. A Stop is not a fuse and does not
   * clear here — "stop" would mean nothing if the next message the user typed
   * re-armed the loop by itself. Only the plan moving lifts that one.
   */
  noteAgentStart(prompt: string): void {
    const marker = extractPlanContinuationMarker(prompt);
    if (marker && this.delivery?.marker === marker) {
      this.turnIsOurs = true;
      this.delivery = undefined;
      return;
    }
    this.turnIsOurs = false;
    this.intent = undefined;
    this.delivery = undefined;
    this.automaticTurns = 0;
    this.sentSinceUserTurn = 0;
    this.noProgressTurns = 0;
    if (this.haltReason !== "aborted") this.haltReason = undefined;
  }

  noteAgentEnd(messages: readonly unknown[], ctx: DriveContext, deps: DriveDeps): void {
    const wasAutomatic = this.turnIsOurs;
    this.turnIsOurs = false;
    if (autoResumeBlocked()) {
      this.intent = undefined;
      return;
    }

    const plan = deps.readActivePlan(ctx);
    const fingerprint = plan ? planFingerprint(plan) : undefined;
    const planMoved =
      fingerprint !== undefined &&
      this.lastFingerprint !== undefined &&
      fingerprint !== this.lastFingerprint;
    this.lastFingerprint = fingerprint;
    // A plan that moved is live work: it re-arms the driver after any halt,
    // including the one a user's Stop installed.
    if (planMoved) {
      this.haltReason = undefined;
      this.noProgressTurns = 0;
    }

    const stopReason = finalAssistantStopReason(messages);
    if (stopReason === "aborted") {
      // The user pressed Stop. Staying halted until the plan itself moves again
      // keeps "stop" meaningful without forcing them to cancel the plan.
      this.haltReason = "aborted";
      this.intent = undefined;
      return;
    }
    if (stopReason === "error") {
      this.intent = undefined;
      return;
    }

    if (!planIsDrivable(plan)) return;
    if (goalDrivesSession(ctx)) return;
    if (this.haltReason) return;
    if (deps.hasLiveWorkers?.()) {
      // Their alarm is the wake-up. Not counted against the fuses: nothing was
      // attempted, so a long worker run must not spend the no-progress budget.
      this.intent = undefined;
      return;
    }

    if (wasAutomatic) {
      this.automaticTurns += 1;
      const madeProgress = planMoved || hasAssistantToolCall(messages);
      this.noProgressTurns = madeProgress ? 0 : this.noProgressTurns + 1;
      if (this.automaticTurns >= PLAN_AUTOMATIC_TURN_LIMIT) {
        this.halt(ctx, "turn_limit");
        return;
      }
      if (this.noProgressTurns >= PLAN_NO_PROGRESS_LIMIT) {
        this.halt(ctx, "no_progress");
        return;
      }
    }

    this.iteration += 1;
    const marker = markerFor(plan.id, this.iteration);
    this.intent = {
      planId: plan.id,
      marker,
      prompt: buildPlanContinuePrompt(plan, marker, this.iteration),
    };
  }

  /**
   * Runs at agent_settled, where the queue is empty and sendUserMessage will not
   * be rejected. Returns whether a continuation was actually sent.
   */
  dispatchIfSettled(ctx: DriveContext, deps: DriveDeps): boolean {
    const intent = this.intent;
    if (!intent) return false;
    if (autoResumeBlocked()) {
      this.intent = undefined;
      return false;
    }
    const plan = deps.readActivePlan(ctx);
    if (!planIsDrivable(plan) || plan.id !== intent.planId) {
      this.intent = undefined;
      return false;
    }
    if (this.sentSinceUserTurn >= PLAN_AUTOMATIC_TURN_LIMIT) {
      this.halt(ctx, "turn_limit");
      return false;
    }
    if (ctx.isIdle?.() !== true || ctx.hasPendingMessages?.() === true) return false;

    this.intent = undefined;
    this.delivery = intent;
    this.sentSinceUserTurn += 1;
    try {
      this.send(intent.prompt);
      return true;
    } catch (error) {
      this.delivery = undefined;
      this.intent = intent;
      this.sentSinceUserTurn -= 1;
      ctx.ui?.notify(
        `Plan continuation failed: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
      return false;
    }
  }

  private halt(ctx: DriveContext, reason: HaltReason): void {
    this.haltReason = reason;
    this.intent = undefined;
    ctx.ui?.notify(
      reason === "turn_limit"
        ? `Plan continuation stopped after ${PLAN_AUTOMATIC_TURN_LIMIT} automatic turns with tasks still open. Send a message to continue.`
        : `Plan continuation stopped after ${PLAN_NO_PROGRESS_LIMIT} automatic turns that changed nothing. Send a message to continue.`,
      "warning",
    );
  }
}

export function registerPlanDrive(pi: ExtensionAPI, deps: DriveDeps): PlanDriver {
  const driver = new PlanDriver((prompt) => {
    pi.sendUserMessage(prompt, { deliverAs: "followUp" });
  });

  pi.on("session_start", () => {
    driver.reset();
  });
  pi.on("session_shutdown", () => {
    driver.reset();
  });

  pi.on("before_agent_start", (event, ctx) => {
    // Pi ≥1.2 also fires this for extension-triggered custom-message runs, which carry
    // no prompt. Leave the drive's ownership state alone for them, as before 1.2.
    if ((event as { messageType?: string }).messageType === "custom") return;
    driver.noteAgentStart(event.prompt);
    const plan = deps.readActivePlan(ctx as DriveContext);
    if (!planIsDrivable(plan)) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${buildPlanSystemPrompt(plan)}` };
  });

  pi.on("agent_end", (event, ctx) => {
    driver.noteAgentEnd(event.messages, ctx as DriveContext, deps);
  });

  pi.on("agent_settled", (_event, ctx) => {
    driver.dispatchIfSettled(ctx as DriveContext, deps);
  });

  return driver;
}
