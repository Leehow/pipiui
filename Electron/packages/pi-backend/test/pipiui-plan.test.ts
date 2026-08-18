import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const EXTENSION = "../../../resources/runtime/extensions/pipiui-plan.ts";

type Tool = {
  name: string;
  execute: (id: string, params: any, signal?: unknown, onUpdate?: unknown, ctx?: { cwd: string }) => Promise<any>;
};

async function loadExtension() {
  vi.resetModules();
  const tools: Tool[] = [];
  const extension = (await import(EXTENSION)).default;
  extension({
    registerTool: (definition: Tool) => { tools.push(definition); },
  } as never);
  return Object.fromEntries(tools.map((tool) => [tool.name, tool]));
}

function parse(result: any) {
  return JSON.parse(result.content[0].text);
}

describe("pipiui plan tools", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("publishes, updates a task, and approves, persisting across reload", async () => {
    root = await mkdtemp(join(tmpdir(), "pipiui-plan-"));
    const posts: Array<{ url: string; body: any }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      posts.push({ url, body: JSON.parse(String(init?.body)) });
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
    }));
    vi.stubEnv("PIPIUI_BRIDGE_PORT", "18765");
    vi.stubEnv("PIPIUI_HOST_PROTOCOL", "1");
    vi.stubEnv("PIPIUI_SESSION_CAPABILITY", "cap-1");

    const first = await loadExtension();
    const ctx = { cwd: root };
    const published = parse(await first.plan_publish.execute("1", {
      plan: {
        id: "plan-a",
        title: "Ship plan tools",
        tasks: [{ id: "t1", title: "implement" }, { id: "t2", title: "test" }],
      },
    }, undefined, undefined, ctx));
    expect(published.ok).toBe(true);
    expect(published.plan.tasks[0].state).toBe("pending");
    expect(published.plan.lifecycle).toBe("draft");

    const updated = parse(await first.plan_task_update.execute("2", {
      planId: "plan-a",
      taskId: "t1",
      state: "in_progress",
      note: "started",
    }, undefined, undefined, ctx));
    expect(updated.ok).toBe(true);
    expect(updated.plan.tasks[0]).toMatchObject({ state: "in_progress", note: "started" });

    const approved = parse(await first.plan_approve.execute("3", { planId: "plan-a" }, undefined, undefined, ctx));
    expect(approved.ok).toBe(true);
    expect(approved.plan.lifecycle).toBe("approved");
    expect(approved.plan.approvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const disk = JSON.parse(await readFile(join(root, ".pi", "plans", "current.json"), "utf8"));
    expect(disk.activePlanId).toBe("plan-a");
    expect(disk.plans["plan-a"].lifecycle).toBe("approved");

    const reloaded = await loadExtension();
    const again = parse(await reloaded.plan_task_update.execute("4", {
      planId: "plan-a",
      taskId: "t1",
      state: "completed",
    }, undefined, undefined, ctx));
    expect(again.ok).toBe(true);
    expect(again.plan.tasks[0].state).toBe("completed");

    expect(posts).toHaveLength(4);
    expect(posts[0].url).toBe("http://127.0.0.1:18765/rpc");
    expect(posts[0].body).toMatchObject({
      schemaVersion: 1,
      sessionCapability: "cap-1",
      action: "plan_event",
      event: { event: "plan_publish", schemaVersion: 1 },
    });
    expect(posts[0].body.event.plan).toMatchObject({ id: "plan-a", title: "Ship plan tools" });
    expect(posts[1].body.event.event).toBe("plan_task_update");
    expect(posts[2].body.event.event).toBe("plan_approve");
    expect(posts[2].body.event.plan.lifecycle).toBe("approved");
  });

  it("rejects duplicate plan ids, wrong planId, and unknown taskId", async () => {
    root = await mkdtemp(join(tmpdir(), "pipiui-plan-"));
    const tools = await loadExtension();
    const ctx = { cwd: root };
    await tools.plan_publish.execute("1", {
      plan: { id: "plan-a", title: "A", tasks: [{ id: "t1", title: "one" }] },
    }, undefined, undefined, ctx);

    const dup = parse(await tools.plan_publish.execute("2", {
      plan: { id: "plan-a", title: "Again", tasks: [{ id: "t9", title: "nine" }] },
    }, undefined, undefined, ctx));
    expect(dup).toMatchObject({ ok: false, error: expect.stringMatching(/duplicate plan id/i) });

    const wrongPlan = parse(await tools.plan_task_update.execute("3", {
      planId: "invented",
      taskId: "t1",
      state: "completed",
    }, undefined, undefined, ctx));
    expect(wrongPlan.ok).toBe(false);
    expect(wrongPlan.error).toMatch(/not the active plan/);

    const unknownTask = parse(await tools.plan_task_update.execute("4", {
      planId: "plan-a",
      taskId: "missing",
      state: "completed",
    }, undefined, undefined, ctx));
    expect(unknownTask.ok).toBe(false);
    expect(unknownTask.error).toMatch(/unknown task/);
  });

  it("cancels the active plan and records a reason", async () => {
    root = await mkdtemp(join(tmpdir(), "pipiui-plan-"));
    const posts: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      posts.push(JSON.parse(String(init?.body)));
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }));
    vi.stubEnv("PIPIUI_BRIDGE_PORT", "18765");
    vi.stubEnv("PIPIUI_HOST_PROTOCOL", "1");
    vi.stubEnv("PIPIUI_SESSION_CAPABILITY", "cap-1");

    const tools = await loadExtension();
    const ctx = { cwd: root };
    await tools.plan_publish.execute("1", {
      plan: { id: "plan-b", title: "B", tasks: [{ id: "t1", title: "one" }] },
    }, undefined, undefined, ctx);
    const cancelled = parse(await tools.plan_cancel.execute("2", {
      planId: "plan-b",
      reason: "user ignored",
    }, undefined, undefined, ctx));
    expect(cancelled.ok).toBe(true);
    expect(cancelled.plan.lifecycle).toBe("cancelled");
    expect(cancelled.plan.cancelReason).toBe("user ignored");
    expect(cancelled.plan.cancelledAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(posts.at(-1).event).toMatchObject({ event: "plan_cancel" });
    expect(posts.at(-1).event.plan.lifecycle).toBe("cancelled");

    const after = parse(await tools.plan_task_update.execute("3", {
      planId: "plan-b",
      taskId: "t1",
      state: "completed",
    }, undefined, undefined, ctx));
    expect(after.ok).toBe(false);
  });
});
