import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PLAN_AUTOMATIC_TURN_LIMIT,
  PLAN_NO_PROGRESS_LIMIT,
  PlanDriver,
  buildPlanContinuePrompt,
  buildPlanSystemPrompt,
  extractPlanContinuationMarker,
  goalDrivesSession,
  planIsDrivable,
  type DriveContext,
  type DriveDeps,
  type DrivePlan,
} from "../../../resources/runtime/extensions/plan-drive.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

function plan(overrides: Partial<DrivePlan> = {}): DrivePlan {
  return {
    id: "module-pipeline",
    title: "模组构建流水线",
    lifecycle: "active",
    tasks: [
      { id: "t1", title: "宿主无关驱动循环", state: "completed" },
      { id: "t2", title: "B: 多节并发派 subagent", state: "pending" },
      { id: "t3", title: "C: pi-coc-build 入口", state: "pending" },
    ],
    ...overrides,
  };
}

function context(overrides: Partial<DriveContext> = {}): DriveContext & { ui: { notify: ReturnType<typeof vi.fn> } } {
  return {
    cwd: "/workspace",
    ui: { notify: vi.fn() },
    isIdle: () => true,
    hasPendingMessages: () => false,
    sessionManager: { getBranch: () => [] },
    ...overrides,
  } as DriveContext & { ui: { notify: ReturnType<typeof vi.fn> } };
}

function assistant(options: { stopReason?: string; toolCall?: boolean } = {}) {
  return [
    {
      role: "assistant",
      stopReason: options.stopReason ?? "stop",
      content: options.toolCall
        ? [{ type: "toolCall", name: "bash" }]
        : [{ type: "text", text: "done for now" }],
    },
  ];
}

/** Drives one full automatic cycle: end the turn, dispatch, and re-enter with our own prompt. */
function cycle(
  driver: PlanDriver,
  sent: string[],
  ctx: DriveContext,
  deps: DriveDeps,
  messages: unknown[],
) {
  driver.noteAgentEnd(messages, ctx, deps);
  const dispatched = driver.dispatchIfSettled(ctx, deps);
  if (dispatched) driver.noteAgentStart(sent[sent.length - 1]);
  return dispatched;
}

function harness(livePlan: DrivePlan | undefined = plan()) {
  const sent: string[] = [];
  const driver = new PlanDriver((prompt) => {
    sent.push(prompt);
  });
  const deps: DriveDeps = { readActivePlan: () => livePlan };
  return { sent, driver, deps };
}

describe("plan drive decisions", () => {
  it("only drives a published plan that still has open tasks", () => {
    expect(planIsDrivable(plan())).toBe(true);
    expect(planIsDrivable(plan({ lifecycle: "approved" }))).toBe(true);
    expect(planIsDrivable(plan({ lifecycle: "draft" }))).toBe(false);
    expect(planIsDrivable(plan({ lifecycle: "cancelled" }))).toBe(false);
    expect(
      planIsDrivable(
        plan({
          tasks: [
            { id: "t1", title: "a", state: "completed" },
            { id: "t2", title: "b", state: "skipped" },
          ],
        }),
      ),
    ).toBe(false);
    // A plan whose remaining work is all blocked/failed is the user's turn, not ours.
    expect(
      planIsDrivable(
        plan({
          tasks: [
            { id: "t1", title: "a", state: "blocked" },
            { id: "t2", title: "b", state: "failed" },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("continues the session when a turn ends with open tasks", () => {
    const { sent, driver, deps } = harness();
    const ctx = context();

    driver.noteAgentStart("finish the pipeline");
    driver.noteAgentEnd(assistant(), ctx, deps);
    expect(driver.dispatchIfSettled(ctx, deps)).toBe(true);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Continue the active plan until every task is settled");
    expect(sent[0]).toContain("B: 多节并发派 subagent");
    expect(sent[0]).toContain("C: pi-coc-build 入口");
    expect(extractPlanContinuationMarker(sent[0])).toBeTruthy();
  });

  it("stays quiet once every task is settled", () => {
    const settled = plan({
      tasks: [
        { id: "t1", title: "a", state: "completed" },
        { id: "t2", title: "b", state: "completed" },
      ],
    });
    const { sent, driver, deps } = harness(settled);
    const ctx = context();

    driver.noteAgentEnd(assistant(), ctx, deps);
    expect(driver.dispatchIfSettled(ctx, deps)).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("stands down while a goal is driving the same session", () => {
    const { sent, driver, deps } = harness();
    const ctx = context({
      sessionManager: {
        getBranch: () => [
          { type: "custom", customType: "goal-state", data: { goal: { id: "g1", status: "active" } } },
        ],
      },
    });
    expect(goalDrivesSession(ctx)).toBe(true);

    driver.noteAgentEnd(assistant(), ctx, deps);
    expect(driver.dispatchIfSettled(ctx, deps)).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("resumes driving after a goal completes", () => {
    const { sent, driver, deps } = harness();
    const ctx = context({
      sessionManager: {
        getBranch: () => [
          { type: "custom", customType: "goal-state", data: { goal: { id: "g1", status: "active" } } },
          { type: "custom", customType: "goal-state", data: { goal: null } },
        ],
      },
    });
    expect(goalDrivesSession(ctx)).toBe(false);

    driver.noteAgentEnd(assistant(), ctx, deps);
    expect(driver.dispatchIfSettled(ctx, deps)).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("never revives a session the host marked auto-resume blocked", () => {
    vi.stubEnv("PIPIUI_GOAL_AUTO_RESUME", "blocked");
    const { sent, driver, deps } = harness();
    const ctx = context();

    driver.noteAgentEnd(assistant(), ctx, deps);
    expect(driver.dispatchIfSettled(ctx, deps)).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("does not dispatch while the agent is busy or messages are queued", () => {
    const { sent, driver, deps } = harness();
    const busy = context({ isIdle: () => false });
    driver.noteAgentEnd(assistant(), busy, deps);
    expect(driver.dispatchIfSettled(busy, deps)).toBe(false);

    const queued = context({ hasPendingMessages: () => true });
    expect(driver.dispatchIfSettled(queued, deps)).toBe(false);
    expect(sent).toHaveLength(0);

    // The intent survives: once the run really settles it goes out.
    expect(driver.dispatchIfSettled(context(), deps)).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("waits on its own workers instead of driving turns that can report nothing", () => {
    const sent: string[] = [];
    const driver = new PlanDriver((prompt) => sent.push(prompt));
    let workersRunning = true;
    const deps: DriveDeps = { readActivePlan: () => plan(), hasLiveWorkers: () => workersRunning };
    const ctx = context();

    for (let turn = 0; turn < PLAN_NO_PROGRESS_LIMIT + 2; turn += 1) {
      driver.noteAgentStart("worker finished, here is the report");
      driver.noteAgentEnd(assistant(), ctx, deps);
      expect(driver.dispatchIfSettled(ctx, deps)).toBe(false);
    }
    // A worker wait must not spend the no-progress budget.
    expect(driver.state.haltReason).toBeUndefined();
    expect(sent).toHaveLength(0);

    workersRunning = false;
    driver.noteAgentEnd(assistant(), ctx, deps);
    expect(driver.dispatchIfSettled(ctx, deps)).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("drops a queued continuation when the plan was cancelled mid-flight", () => {
    let livePlan: DrivePlan | undefined = plan();
    const sent: string[] = [];
    const driver = new PlanDriver((prompt) => sent.push(prompt));
    const deps: DriveDeps = { readActivePlan: () => livePlan };
    const ctx = context();

    driver.noteAgentEnd(assistant(), ctx, deps);
    livePlan = undefined;
    expect(driver.dispatchIfSettled(ctx, deps)).toBe(false);
    expect(sent).toHaveLength(0);
  });
});

describe("plan drive fuses", () => {
  it("halts after the user presses stop, until the plan moves again", () => {
    const livePlan = plan();
    const sent: string[] = [];
    const driver = new PlanDriver((prompt) => sent.push(prompt));
    const deps: DriveDeps = { readActivePlan: () => livePlan };
    const ctx = context();

    driver.noteAgentEnd(assistant(), ctx, deps);
    expect(driver.dispatchIfSettled(ctx, deps)).toBe(true);
    driver.noteAgentStart(sent[0]);

    driver.noteAgentEnd(assistant({ stopReason: "aborted" }), ctx, deps);
    expect(driver.state.haltReason).toBe("aborted");
    expect(driver.dispatchIfSettled(ctx, deps)).toBe(false);

    // Typing again does not by itself re-arm the loop: a turn that leaves the
    // plan where it was stays quiet.
    driver.noteAgentStart("先放着吧");
    driver.noteAgentEnd(assistant(), ctx, deps);
    expect(driver.state.haltReason).toBe("aborted");
    expect(driver.dispatchIfSettled(ctx, deps)).toBe(false);
    expect(sent).toHaveLength(1);

    // Real plan movement means work resumed, and that re-arms the driver.
    const moved: DriveDeps = {
      readActivePlan: () => ({
        ...livePlan,
        tasks: [livePlan.tasks[0], { ...livePlan.tasks[1], state: "in_progress" }, livePlan.tasks[2]],
      }),
    };
    driver.noteAgentStart("继续做 B");
    driver.noteAgentEnd(assistant({ toolCall: true }), ctx, moved);
    expect(driver.state.haltReason).toBeUndefined();
    expect(driver.dispatchIfSettled(ctx, moved)).toBe(true);
    expect(sent).toHaveLength(2);
  });

  it("stops after consecutive automatic turns that change nothing", () => {
    const { sent, driver, deps } = harness();
    const ctx = context();

    driver.noteAgentEnd(assistant(), ctx, deps);
    driver.dispatchIfSettled(ctx, deps);
    driver.noteAgentStart(sent[0]);

    for (let turn = 0; turn < PLAN_NO_PROGRESS_LIMIT; turn += 1) {
      cycle(driver, sent, ctx, deps, assistant());
    }

    expect(driver.state.haltReason).toBe("no_progress");
    expect(sent).toHaveLength(PLAN_NO_PROGRESS_LIMIT);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("changed nothing"), "warning");
  });

  it("treats tool work as progress so long turns are not cut short", () => {
    const { sent, driver, deps } = harness();
    const ctx = context();

    driver.noteAgentEnd(assistant(), ctx, deps);
    driver.dispatchIfSettled(ctx, deps);
    driver.noteAgentStart(sent[0]);

    for (let turn = 0; turn < PLAN_NO_PROGRESS_LIMIT + 2; turn += 1) {
      cycle(driver, sent, ctx, deps, assistant({ toolCall: true }));
    }

    expect(driver.state.haltReason).toBeUndefined();
    expect(driver.state.noProgressTurns).toBe(0);
  });

  it("stops at the automatic turn ceiling even while work keeps happening", () => {
    const { sent, driver, deps } = harness();
    const ctx = context();

    driver.noteAgentEnd(assistant(), ctx, deps);
    driver.dispatchIfSettled(ctx, deps);
    driver.noteAgentStart(sent[0]);

    for (let turn = 0; turn < PLAN_AUTOMATIC_TURN_LIMIT + 5; turn += 1) {
      if (!cycle(driver, sent, ctx, deps, assistant({ toolCall: true }))) break;
    }

    expect(driver.state.haltReason).toBe("turn_limit");
    expect(sent).toHaveLength(PLAN_AUTOMATIC_TURN_LIMIT);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining(`${PLAN_AUTOMATIC_TURN_LIMIT} automatic turns`),
      "warning",
    );
  });

  it("caps what it can send even if the turn boundary never comes back", () => {
    // Simulates a lost before_agent_start: the driver never learns its own
    // prompts started a turn, so only the dispatch-side ceiling can stop it.
    const { sent, driver, deps } = harness();
    const ctx = context();

    for (let turn = 0; turn < PLAN_AUTOMATIC_TURN_LIMIT + 5; turn += 1) {
      driver.noteAgentEnd(assistant(), ctx, deps);
      if (!driver.dispatchIfSettled(ctx, deps)) break;
    }

    expect(sent).toHaveLength(PLAN_AUTOMATIC_TURN_LIMIT);
    expect(driver.state.haltReason).toBe("turn_limit");
  });

  it("a user message clears the fuses and supersedes a queued continuation", () => {
    const { sent, driver, deps } = harness();
    const ctx = context();

    driver.noteAgentEnd(assistant(), ctx, deps);
    driver.dispatchIfSettled(ctx, deps);
    driver.noteAgentStart(sent[0]);
    for (let turn = 0; turn < PLAN_NO_PROGRESS_LIMIT; turn += 1) {
      cycle(driver, sent, ctx, deps, assistant());
    }
    expect(driver.state.haltReason).toBe("no_progress");

    driver.noteAgentStart("继续做 B 和 C");
    expect(driver.state.haltReason).toBeUndefined();
    expect(driver.state.automaticTurns).toBe(0);
    expect(driver.state.pending).toBeUndefined();

    driver.noteAgentEnd(assistant(), ctx, deps);
    expect(driver.dispatchIfSettled(ctx, deps)).toBe(true);
  });

  it("forgets everything across sessions", () => {
    const { sent, driver, deps } = harness();
    const ctx = context();
    driver.noteAgentEnd(assistant(), ctx, deps);
    driver.reset();
    expect(driver.state.pending).toBeUndefined();
    expect(driver.dispatchIfSettled(ctx, deps)).toBe(false);
    expect(sent).toHaveLength(0);
  });
});

describe("plan drive prompts", () => {
  it("teaches per-task blocking rather than stopping the whole plan", () => {
    const text = buildPlanSystemPrompt(plan());
    expect(text).toContain("A blocker belongs to the task it blocks");
    expect(text).toContain('plan_task_update with state "blocked"');
    expect(text).toContain("keep working every task that does not depend on that answer");
    expect(text).toContain("Hand control back only when every remaining task is completed, skipped, failed, or blocked");
    expect(text).toContain("1/3 tasks settled");
  });

  it("lists open tasks with their state so a wake-up is never information-free", () => {
    const text = buildPlanSystemPrompt(plan());
    expect(text).toContain("[completed] 宿主无关驱动循环");
    expect(text).toContain("[pending] B: 多节并发派 subagent");
  });

  it("tells the model not to re-ask about tasks already marked blocked", () => {
    const blocked = plan({
      tasks: [
        { id: "t1", title: "提交方向", state: "blocked", note: "需要用户拍板 gated commit 落在哪个 worktree" },
        { id: "t2", title: "B: 多节并发派 subagent", state: "pending" },
      ],
    });
    const text = buildPlanContinuePrompt(blocked, "m1", 4);
    expect(text).toContain("automatic plan continuation #4");
    expect(text).toContain("1 task(s) are marked blocked");
    expect(text).toContain("Do not re-ask about them");
    expect(text).toContain("需要用户拍板");
    expect(extractPlanContinuationMarker(text)).toBe("m1");
  });
});

describe("plan extension wiring", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("drives a plan published through the real tools", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "plan-drive-"));
    dirs.push(cwd);
    vi.resetModules();
    vi.stubEnv("PIPIUI_SESSION_ID", "session-a");
    vi.stubEnv("PIPIUI_PROJECT_ROOT", cwd);
    vi.stubEnv("PIPIUI_BRIDGE_PORT", "");
    vi.stubEnv("PIPIUI_GOAL_AUTO_RESUME", "");

    const tools: Record<string, { execute: (...args: any[]) => Promise<any> }> = {};
    const handlers = new Map<string, (event: any, ctx: any) => any>();
    const sent: string[] = [];
    const extension = (await import("../../../resources/runtime/extensions/pipiui-plan.ts")).default;
    extension({
      registerTool: (definition: any) => {
        tools[definition.name] = definition;
      },
      on: (name: string, handler: (event: any, ctx: any) => any) => {
        handlers.set(name, handler);
      },
      sendUserMessage: (prompt: string) => {
        sent.push(prompt);
      },
    } as never);

    const ctx = context({ cwd });
    await tools.plan_publish.execute("1", {
      plan: {
        id: "p1",
        title: "两步计划",
        approvalRequired: false,
        tasks: [
          { id: "a", title: "第一步" },
          { id: "b", title: "第二步" },
        ],
      },
    }, undefined, undefined, ctx);

    const injected = handlers.get("before_agent_start")?.(
      { prompt: "开工", systemPrompt: "BASE" },
      ctx,
    );
    expect(injected.systemPrompt).toContain("BASE");
    expect(injected.systemPrompt).toContain("[pending] 第二步");

    handlers.get("agent_end")?.({ messages: assistant() }, ctx);
    handlers.get("agent_settled")?.({}, ctx);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("第二步");

    await tools.plan_task_update.execute("2", { planId: "p1", taskId: "a", state: "completed" }, undefined, undefined, ctx);
    await tools.plan_task_update.execute("3", { planId: "p1", taskId: "b", state: "completed" }, undefined, undefined, ctx);

    handlers.get("before_agent_start")?.({ prompt: sent[0], systemPrompt: "BASE" }, ctx);
    handlers.get("agent_end")?.({ messages: assistant() }, ctx);
    handlers.get("agent_settled")?.({}, ctx);
    expect(sent).toHaveLength(1);
  });
});
