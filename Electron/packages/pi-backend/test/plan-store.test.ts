import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PlanStore, planStorePath, readPlanStore } from "../src/plan-store.js";
import type { PlanSnapshot } from "@pipi/host-api";
import { planIsLive } from "../../host-api/src/plan.js";

const roots: string[] = [];
afterEach(() => { roots.length = 0; });

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pipiui-plan-"));
  roots.push(root);
  return root;
}

function snapshot(overrides: Partial<PlanSnapshot> = {}): PlanSnapshot {
  return {
    id: "plan-1",
    title: "接上 plan 前端",
    lifecycle: "draft",
    createdAt: "2026-08-18T01:00:00.000Z",
    updatedAt: "2026-08-18T01:00:00.000Z",
    tasks: [
      { id: "a", title: "定义契约", state: "pending" },
      { id: "b", title: "实现面板", state: "pending" },
    ],
    ...overrides,
  };
}

describe("PlanStore.accept", () => {
  it("does not treat a superseded inactive draft as live", () => {
    expect(planIsLive(snapshot({ active: false }))).toBe(false);
  });

  it("republishes a publish event and keeps it as the session's plan", () => {
    const store = new PlanStore();
    const event = store.accept({ event: "plan_publish", plan: snapshot() }, "s1");
    expect(event).toMatchObject({ type: "plan", sessionId: "s1", kind: "plan_publish" });
    expect(event!.plan.active).toBe(true);
    expect(store.list("s1")).toHaveLength(1);
    expect(store.list("s2")).toEqual([]);
  });

  it("drops a payload that is not a recognizable plan mutation", () => {
    const store = new PlanStore();
    expect(store.accept({ event: "plan_publish" }, "s1")).toBeNull();
    expect(store.accept({ event: "not_a_plan_event", plan: snapshot() }, "s1")).toBeNull();
    expect(store.accept({ event: "plan_publish", plan: { id: "x" } }, "s1")).toBeNull();
    expect(store.list("s1")).toEqual([]);
  });

  it("replaces the snapshot on a task update instead of appending a second plan", () => {
    const store = new PlanStore();
    store.accept({ event: "plan_publish", plan: snapshot() }, "s1");
    const updated = store.accept({
      event: "plan_task_update",
      plan: snapshot({ updatedAt: "2026-08-18T01:04:00.000Z", tasks: [
        { id: "a", title: "定义契约", state: "completed" },
        { id: "b", title: "实现面板", state: "in_progress", note: "面板接线中" },
      ] }),
    }, "s1");
    expect(updated!.kind).toBe("plan_task_update");
    const plans = store.list("s1");
    expect(plans).toHaveLength(1);
    expect(plans[0].tasks.map(task => task.state)).toEqual(["completed", "in_progress"]);
    expect(plans[0].tasks[1].note).toBe("面板接线中");
  });

  it("clears the active flag on cancel and hands the flag to a newly published plan", () => {
    const store = new PlanStore();
    store.accept({ event: "plan_publish", plan: snapshot() }, "s1");
    const cancelled = store.accept({ event: "plan_cancel", plan: snapshot({ lifecycle: "cancelled", cancelReason: "需求变了", updatedAt: "2026-08-18T01:06:00.000Z" }) }, "s1");
    expect(cancelled!.plan.active).toBe(false);

    store.accept({ event: "plan_publish", plan: snapshot({ id: "plan-2", title: "新计划", updatedAt: "2026-08-18T01:07:00.000Z" }) }, "s1");
    const byId = Object.fromEntries(store.list("s1").map(plan => [plan.id, plan]));
    expect(byId["plan-2"].active).toBe(true);
    expect(byId["plan-1"].active).toBe(false);
    expect(planIsLive(byId["plan-1"])).toBe(false);
  });

  it("sorts unfinished plans above settled ones, newest activity first", () => {
    const store = new PlanStore();
    store.accept({ event: "plan_publish", plan: snapshot({ id: "done", updatedAt: "2026-08-18T09:00:00.000Z", tasks: [{ id: "a", title: "收尾", state: "completed" }] }) }, "s1");
    store.accept({ event: "plan_publish", plan: snapshot({ id: "live", updatedAt: "2026-08-18T02:00:00.000Z" }) }, "s1");
    expect(store.list("s1").map(plan => plan.id)).toEqual(["live", "done"]);
  });

  it("forgets one session without touching another", () => {
    const store = new PlanStore();
    store.accept({ event: "plan_publish", plan: snapshot() }, "s1");
    store.accept({ event: "plan_publish", plan: snapshot({ id: "plan-2" }) }, "s2");
    store.forget("s1");
    expect(store.list("s1")).toEqual([]);
    expect(store.list("s2")).toHaveLength(1);
    expect(store.needsHydration("s1")).toBe(true);
  });
});

describe("readPlanStore", () => {
  it("reads the extension's store and marks the active plan", async () => {
    const cwd = await project();
    await mkdir(join(cwd, ".pi", "plans"), { recursive: true });
    await writeFile(planStorePath(cwd), JSON.stringify({
      activePlanId: "plan-1",
      plans: { "plan-1": snapshot(), "plan-0": snapshot({ id: "plan-0", lifecycle: "cancelled" }) },
    }), "utf8");

    const plans = await readPlanStore(cwd);
    expect(plans).toHaveLength(2);
    expect(plans.find(plan => plan.id === "plan-1")!.active).toBe(true);
    expect(plans.find(plan => plan.id === "plan-0")!.active).toBe(false);
  });

  it("treats a missing or malformed store as no plans rather than an error", async () => {
    const cwd = await project();
    expect(await readPlanStore(cwd)).toEqual([]);
    await mkdir(join(cwd, ".pi", "plans"), { recursive: true });
    await writeFile(planStorePath(cwd), "{ not json", "utf8");
    expect(await readPlanStore(cwd)).toEqual([]);
    await writeFile(planStorePath(cwd), JSON.stringify({ plans: { bad: { id: "bad" } } }), "utf8");
    expect(await readPlanStore(cwd)).toEqual([]);
  });

  it("keeps an unknown task state out of the panel by falling back to pending", async () => {
    const cwd = await project();
    await mkdir(join(cwd, ".pi", "plans"), { recursive: true });
    await writeFile(planStorePath(cwd), JSON.stringify({
      activePlanId: "plan-1",
      plans: { "plan-1": { ...snapshot(), tasks: [{ id: "a", title: "定义契约", state: "wat" }] } },
    }), "utf8");
    expect((await readPlanStore(cwd))[0].tasks[0].state).toBe("pending");
  });
});

describe("PlanStore.merge", () => {
  it("backfills from disk without rolling back a newer live event", async () => {
    const store = new PlanStore();
    store.accept({ event: "plan_task_update", plan: snapshot({ updatedAt: "2026-08-18T05:00:00.000Z", tasks: [{ id: "a", title: "定义契约", state: "completed" }] }) }, "s1");
    store.merge("s1", [
      snapshot({ updatedAt: "2026-08-18T01:00:00.000Z" }),
      snapshot({ id: "plan-old", title: "上一轮的计划", updatedAt: "2026-08-17T01:00:00.000Z" }),
    ]);

    const plans = store.list("s1");
    expect(plans).toHaveLength(2);
    const live = plans.find(plan => plan.id === "plan-1")!;
    expect(live.tasks[0].state).toBe("completed");
    expect(live.updatedAt).toBe("2026-08-18T05:00:00.000Z");
    expect(plans.find(plan => plan.id === "plan-old")!.sessionId).toBe("s1");
  });

  it("hydrates only once per session", () => {
    const store = new PlanStore();
    expect(store.needsHydration("s1")).toBe(true);
    store.markHydrated("s1");
    expect(store.needsHydration("s1")).toBe(false);
  });
});
