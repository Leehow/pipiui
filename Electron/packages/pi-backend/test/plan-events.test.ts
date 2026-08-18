import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostEvent, PlanEvent, PlanSnapshot } from "@pipi/host-api";
import { createPiHostBackend } from "../src/index.js";

/**
 * End-to-end of the host half of the plan surface: the payload shape here is
 * what `pipiui-plan.ts` posts to the bridge (`{ event, plan }`), so a field the
 * host drops is a field the Plan panel never renders.
 */
let root = "";
let backends: ReturnType<typeof createPiHostBackend>[] = [];

afterEach(async () => {
  await Promise.all(backends.map(backend => backend.close()));
  backends = [];
  if (root) await rm(root, { recursive: true, force: true }).catch(() => undefined);
  root = "";
});

function plan(overrides: Partial<PlanSnapshot> = {}): PlanSnapshot {
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

async function harness() {
  root = await mkdtemp(join(tmpdir(), "pipi-plan-events-"));
  const backend = createPiHostBackend({ agentDir: join(root, "agent"), sessionsRoot: join(root, "sessions") });
  backends.push(backend);
  const events: PlanEvent[] = [];
  backend.subscribe((frame: HostEvent) => { if (frame.channel === "plan") events.push(frame.event) });
  const deliver = (payload: Record<string, unknown>, sessionId = "session-1") =>
    (backend as unknown as { planEvent(raw: Record<string, unknown>, sessionId: string): void }).planEvent(payload, sessionId);
  return { backend, events, deliver };
}

describe("plan events → Plan panel", () => {
  it("republishes a published plan on the plan channel", async () => {
    const { events, deliver } = await harness();
    deliver({ event: "plan_publish", plan: plan(), schemaVersion: 1 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "plan", kind: "plan_publish", sessionId: "session-1" });
    expect(events[0].plan.tasks.map(task => task.title)).toEqual(["定义契约", "实现面板"]);
    expect(events[0].plan.active).toBe(true);
  });

  it("carries a task's new state and note through to the event", async () => {
    const { events, deliver } = await harness();
    deliver({ event: "plan_publish", plan: plan() });
    deliver({ event: "plan_task_update", plan: plan({ updatedAt: "2026-08-18T01:02:00.000Z", tasks: [
      { id: "a", title: "定义契约", state: "completed" },
      { id: "b", title: "实现面板", state: "in_progress", note: "正在接线" },
    ] }) });
    expect(events).toHaveLength(2);
    expect(events[1].kind).toBe("plan_task_update");
    expect(events[1].plan.tasks[1]).toMatchObject({ state: "in_progress", note: "正在接线" });
  });

  it("stays silent on a payload that is not a plan mutation", async () => {
    const { events, deliver } = await harness();
    deliver({ event: "plan_publish" });
    deliver({ event: "something_else", plan: plan() });
    expect(events).toEqual([]);
  });

  it("serves the live plan back through getPlans, scoped to its session", async () => {
    const { backend, deliver } = await harness();
    deliver({ event: "plan_publish", plan: plan() });
    await expect(backend.handle("getPlans", ["session-1"])).resolves.toMatchObject([
      expect.objectContaining({ id: "plan-1", sessionId: "session-1", active: true }),
    ]);
    await expect(backend.handle("getPlans", ["other-session"])).resolves.toEqual([]);
  });

  it("hydrates a cold session from its own plan file", async () => {
    const { backend } = await harness();
    const cwd = join(root, "project");
    await mkdir(join(cwd, ".pi", "plans"), { recursive: true });
    await writeFile(join(cwd, ".pi", "plans", "cold-session.json"), JSON.stringify({
      activePlanId: "plan-1",
      plans: { "plan-1": plan({ lifecycle: "approved" }) },
    }), "utf8");
    // A resumed session has no live process; the host resolves its work tree
    // from the JSONL header, so stand that lookup in for the spawn.
    (backend as unknown as { findSession(id: string): Promise<{ header: { cwd: string } }> }).findSession =
      async () => ({ header: { cwd } });

    await expect(backend.handle("getPlans", ["cold-session"])).resolves.toMatchObject([
      expect.objectContaining({ id: "plan-1", lifecycle: "approved", active: true }),
    ]);
  });

  it("never shows a sibling session's plan from the same work tree", async () => {
    const { backend } = await harness();
    const cwd = join(root, "project");
    await mkdir(join(cwd, ".pi", "plans"), { recursive: true });
    // Another chat in this project published a plan, and a pre-session-scoping
    // store may still sit beside it. Neither belongs to this session.
    await writeFile(join(cwd, ".pi", "plans", "other-session.json"), JSON.stringify({
      activePlanId: "plan-other", plans: { "plan-other": plan({ id: "plan-other", title: "别的会话" }) },
    }), "utf8");
    await writeFile(join(cwd, ".pi", "plans", "current.json"), JSON.stringify({
      activePlanId: "plan-legacy", plans: { "plan-legacy": plan({ id: "plan-legacy", title: "旧的单文件" }) },
    }), "utf8");
    (backend as unknown as { findSession(id: string): Promise<{ header: { cwd: string } }> }).findSession =
      async () => ({ header: { cwd } });

    await expect(backend.handle("getPlans", ["my-session"])).resolves.toEqual([]);
  });

  it("advertises the plan capability only when the plan runtime is really installed", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-plan-caps-"));
    const runtimeRoot = join(root, "runtime");
    await mkdir(join(runtimeRoot, "extensions"), { recursive: true });
    const spawn = (suffix: string) => createPiHostBackend({
      agentDir: join(root, `agent-${suffix}`),
      sessionsRoot: join(root, `sessions-${suffix}`),
      runtimeRoot,
    });

    // An installed tree without the extension must not offer a Plan surface that
    // can never receive an event.
    const missing = spawn("missing");
    backends.push(missing);
    await expect(missing.handle("capabilities", [])).resolves.toMatchObject({ plan: false });

    await writeFile(join(runtimeRoot, "extensions", "pipiui-plan-runtime.ts"), "export default () => undefined\n", "utf8");
    const mounted = spawn("mounted");
    backends.push(mounted);
    await expect(mounted.handle("capabilities", [])).resolves.toMatchObject({ plan: true });
  });

  it("reports no plan capability when the feature is off", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-plan-off-"));
    const runtimeRoot = join(root, "runtime");
    await mkdir(join(runtimeRoot, "extensions"), { recursive: true });
    await writeFile(join(runtimeRoot, "extensions", "pipiui-plan-runtime.ts"), "export default () => undefined\n", "utf8");
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot,
      features: { plan: false } as never,
    });
    backends.push(backend);
    await expect(backend.handle("capabilities", [])).resolves.toMatchObject({ plan: false });
  });
});
