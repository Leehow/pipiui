import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type Tool = {
  name: string;
  description?: string;
  promptSnippet?: string;
  parameters?: unknown;
  execute: (id: string, params: any, signal?: unknown, onUpdate?: unknown, ctx?: { cwd: string }) => Promise<any>;
};

async function loadExtension(sessionId = "") {
  vi.resetModules();
  vi.stubEnv("PIPIUI_SESSION_ID", sessionId);
  vi.stubEnv("PIPIUI_BRIDGE_PORT", "");
  vi.stubEnv("PIPIUI_HOST_PROTOCOL", "");
  vi.stubEnv("PIPIUI_SESSION_KEY", "");
  vi.stubEnv("PIPIUI_SESSION_CAPABILITY", "");
  const tools: Tool[] = [];
  const extension = (await import("../../../resources/runtime/extensions/pipiui-plan.ts")).default;
  extension({
    registerTool: (definition: Tool) => { tools.push(definition); },
    on: () => undefined,
  } as never);
  return Object.fromEntries(tools.map((tool) => [tool.name, tool]));
}

function parse(result: any) {
  return JSON.parse(result.content[0].text);
}

function clearSeam() {
  const g = globalThis as typeof globalThis & { __pipiui_plan_adherence_seam__?: unknown };
  delete g.__pipiui_plan_adherence_seam__;
}

async function publishSeam(
  jobs: unknown[],
  recentPlanDrift: unknown[] = [],
) {
  const { publishPlanAdherenceSeam } = await import("../../../resources/runtime/pi-ext/subagent/plan-drift.ts");
  publishPlanAdherenceSeam({
    jobs: () => jobs as never,
    recentPlanDrift: () => recentPlanDrift as never,
  });
}

describe("plan_check", () => {
  let root = "";
  afterEach(async () => {
    clearSeam();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });

  it("registers as a short advisory read tool without changing existing plan_* schemas", async () => {
    const tools = await loadExtension();
    expect(Object.keys(tools).sort()).toEqual([
      "plan_approve",
      "plan_cancel",
      "plan_check",
      "plan_publish",
      "plan_task_update",
    ]);
    expect(tools.plan_check.description).toMatch(/read-only/i);
    expect(tools.plan_check.description).toMatch(/advisory/i);
    expect(tools.plan_check.description).toMatch(/never changes dispatch/i);
    expect(tools.plan_check.description!.length).toBeLessThan(240);
    expect(tools.plan_check.promptSnippet).toMatch(/snapshot/i);
    expect(tools.plan_publish.description).toMatch(/full-spec/);
    expect(tools.plan_task_update.description).toMatch(/including when starting the next phase/);
    expect(tools.plan_approve.description).toMatch(/Mark the published plan approved/);
    expect(tools.plan_cancel.description).toMatch(/Cancel the published plan/);
  });

  it("returns an empty snapshot when there is no plan and no seam", async () => {
    root = await mkdtemp(join(tmpdir(), "pipiui-plan-check-"));
    const tools = await loadExtension();
    const checked = parse(await tools.plan_check.execute("1", {}, undefined, undefined, { cwd: root }));
    expect(checked).toMatchObject({
      ok: true,
      plan: null,
      counts: { live: 0, bound: 0, unbound: 0, planDrift: 0, scopeDrift: 0 },
      workers: [],
      recentPlanDrift: [],
    });
    expect(checked.isError).toBeUndefined();
  });

  it("joins plan status, binding/drift counts, and per-worker drift tags without writing the store", async () => {
    root = await mkdtemp(join(tmpdir(), "pipiui-plan-check-"));
    const tools = await loadExtension();
    const ctx = { cwd: root };
    expect(parse(await tools.plan_publish.execute("1", {
      plan: {
        id: "plan-alpha",
        title: "Alpha",
        approvalRequired: true,
        tasks: [
          { id: "task-open", title: "Open" },
          { id: "task-active", title: "Active" },
          { id: "task-done", title: "Done" },
        ],
      },
    }, undefined, undefined, ctx)).ok).toBe(true);
    expect(parse(await tools.plan_approve.execute("2", { planId: "plan-alpha" }, undefined, undefined, ctx)).ok).toBe(true);
    expect(parse(await tools.plan_task_update.execute("3", {
      planId: "plan-alpha", taskId: "task-active", state: "in_progress",
    }, undefined, undefined, ctx)).ok).toBe(true);
    expect(parse(await tools.plan_task_update.execute("4", {
      planId: "plan-alpha", taskId: "task-done", state: "completed",
    }, undefined, undefined, ctx)).ok).toBe(true);

    const before = await readFile(join(root, ".pi", "plans", "current.json"), "utf8");

    await publishSeam(
      [
        { agentId: "bound-open", runId: "r1", title: "do open", state: "running", planTask: "task-open" },
        { agentId: "queued-active", runId: "r2", state: "queued", planTask: "task-active", scope: ["src/"] },
        { agentId: "unbound-live", runId: "r3", state: "running" },
        {
          agentId: "finished-drift",
          runId: "r4",
          state: "ok",
          planTask: "task-done",
          scope: ["src/"],
          scopeDrift: ["docs/notes.md"],
        },
        { agentId: "unknown-task", runId: "r5", state: "running", planTask: "no-such-task" },
      ],
      [
        { at: "2026-08-29T00:00:00.000Z", agentId: "unbound-live", reason: "missing" },
        { at: "2026-08-29T00:00:01.000Z", agentId: "unknown-task", planTask: "no-such-task", reason: "unknown-task" },
      ],
    );

    const checked = parse(await tools.plan_check.execute("5", {}, undefined, undefined, ctx));
    expect(checked.ok).toBe(true);
    expect(checked.plan).toMatchObject({
      id: "plan-alpha",
      title: "Alpha",
      lifecycle: "approved",
    });
    expect(checked.plan.tasks.map((task: { id: string; state: string }) => [task.id, task.state])).toEqual([
      ["task-open", "pending"],
      ["task-active", "in_progress"],
      ["task-done", "completed"],
    ]);
    expect(checked.plan.tasks[0].workers).toEqual([
      { agentId: "bound-open", runId: "r1", state: "running", title: "do open" },
    ]);
    expect(checked.plan.tasks[1].workers).toEqual([
      { agentId: "queued-active", runId: "r2", state: "queued" },
    ]);
    expect(checked.plan.tasks[2].workers).toEqual([]);

    expect(checked.counts).toEqual({
      live: 4,
      bound: 2,
      unbound: 2,
      planDrift: 2,
      scopeDrift: 1,
    });

    expect(checked.workers).toEqual([
      { agentId: "bound-open", runId: "r1", title: "do open", state: "running", planTask: "task-open", tags: [] },
      { agentId: "queued-active", runId: "r2", state: "queued", planTask: "task-active", tags: [] },
      { agentId: "unbound-live", runId: "r3", state: "running", tags: ["plan-drift:missing"] },
      {
        agentId: "finished-drift",
        runId: "r4",
        state: "ok",
        planTask: "task-done",
        tags: ["scope-drift"],
        scopeDrift: ["docs/notes.md"],
      },
      {
        agentId: "unknown-task",
        runId: "r5",
        state: "running",
        planTask: "no-such-task",
        tags: ["plan-drift:unknown-task"],
      },
    ]);
    expect(checked.recentPlanDrift).toEqual([
      { at: "2026-08-29T00:00:00.000Z", agentId: "unbound-live", reason: "missing" },
      { at: "2026-08-29T00:00:01.000Z", agentId: "unknown-task", planTask: "no-such-task", reason: "unknown-task" },
    ]);

    const after = await readFile(join(root, ".pi", "plans", "current.json"), "utf8");
    expect(after).toBe(before);
  });

  it("treats a draft plan as unbound and still shows live workers", async () => {
    root = await mkdtemp(join(tmpdir(), "pipiui-plan-check-draft-"));
    const tools = await loadExtension();
    const ctx = { cwd: root };
    expect(parse(await tools.plan_publish.execute("1", {
      plan: { id: "plan-draft", title: "Draft", approvalRequired: true, tasks: [{ id: "t1", title: "one" }] },
    }, undefined, undefined, ctx)).ok).toBe(true);

    await publishSeam([
      { agentId: "early", runId: "r1", state: "running", planTask: "t1" },
    ]);

    const checked = parse(await tools.plan_check.execute("2", {}, undefined, undefined, ctx));
    expect(checked.plan.lifecycle).toBe("draft");
    expect(checked.plan.tasks[0].workers).toEqual([
      { agentId: "early", runId: "r1", state: "running" },
    ]);
    expect(checked.counts).toMatchObject({ live: 1, bound: 0, unbound: 1, planDrift: 0, scopeDrift: 0 });
  });

  it("passes through an empty measured scopeDrift without tagging it", async () => {
    root = await mkdtemp(join(tmpdir(), "pipiui-plan-check-none-"));
    const tools = await loadExtension();
    await publishSeam([
      { agentId: "clean", runId: "r1", state: "ok", planTask: "t1", scopeDrift: [] },
    ]);
    const checked = parse(await tools.plan_check.execute("1", {}, undefined, undefined, { cwd: root }));
    expect(checked.counts.scopeDrift).toBe(0);
    expect(checked.workers[0]).toEqual({
      agentId: "clean",
      runId: "r1",
      state: "ok",
      planTask: "t1",
      tags: [],
      scopeDrift: [],
    });
  });
});
