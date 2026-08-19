import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type Tool = {
  name: string;
  execute: (id: string, params: any, signal?: unknown, onUpdate?: unknown, ctx?: { cwd: string }) => Promise<any>;
};

/**
 * `sessionId` is read at module load (like the bridge env), so a caller that
 * wants a session-scoped store must stub the env before the import. The
 * specifier is a literal on purpose: a variable one is not statically
 * analyzable and fails to resolve under this vite/vitest.
 */
async function loadExtension(sessionId = "") {
  vi.resetModules();
  vi.stubEnv("PIPIUI_SESSION_ID", sessionId);
  const tools: Tool[] = [];
  const extension = (await import("../../../resources/runtime/extensions/pipiui-plan.ts")).default;
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
    vi.unstubAllEnvs();
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
    expect(approved.guidance).toMatch(/Never hand the whole plan to a single general-purpose worker/);
    expect(approved.guidance).toMatch(/dispatch one worker per independent task in the SAME turn/);
    expect(approved.guidance).toMatch(/1\. implement/);
    expect(approved.guidance).toMatch(/2\. test/);
    expect(approved.guidance).toMatch(/plan_task_update/);
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
  it("keeps two sessions of one work tree in separate stores", async () => {
    root = await mkdtemp(join(tmpdir(), "pipiui-plan-sessions-"));
    const ctx = { cwd: root };
    const publish = (tools: any, id: string, title: string) => tools.plan_publish.execute("1", {
      plan: { id, title, tasks: [{ id: "t1", title: "第一步" }] },
    }, undefined, undefined, ctx);

    const first = await loadExtension("session-a");
    expect(parse(await publish(first, "plan-a", "会话 A 的计划")).ok).toBe(true);
    const second = await loadExtension("session-b");
    expect(parse(await publish(second, "plan-b", "会话 B 的计划")).ok).toBe(true);

    // Each session owns its own file...
    const a = JSON.parse(await readFile(join(root, ".pi", "plans", "session-a.json"), "utf8"));
    const b = JSON.parse(await readFile(join(root, ".pi", "plans", "session-b.json"), "utf8"));
    expect(Object.keys(a.plans)).toEqual(["plan-a"]);
    expect(Object.keys(b.plans)).toEqual(["plan-b"]);
    expect(a.activePlanId).toBe("plan-a");
    expect(b.activePlanId).toBe("plan-b");

    // ...so B's publish never became A's active plan, and B cannot drive A's.
    const crossSession = parse(await second.plan_task_update.execute("2", {
      planId: "plan-a", taskId: "t1", state: "completed",
    }, undefined, undefined, ctx));
    expect(crossSession.ok).toBe(false);
    const ownTask = parse(await second.plan_task_update.execute("3", {
      planId: "plan-b", taskId: "t1", state: "completed",
    }, undefined, undefined, ctx));
    expect(ownTask.ok).toBe(true);
  });

  it("falls back to the legacy single-file store when the host supplies no session id", async () => {
    root = await mkdtemp(join(tmpdir(), "pipiui-plan-legacy-"));
    const tools = await loadExtension("");
    const published = parse(await tools.plan_publish.execute("1", {
      plan: { id: "plan-legacy", title: "无会话 id", tasks: [{ id: "t1", title: "第一步" }] },
    }, undefined, undefined, { cwd: root }));
    expect(published.ok).toBe(true);
    const disk = JSON.parse(await readFile(join(root, ".pi", "plans", "current.json"), "utf8"));
    expect(disk.activePlanId).toBe("plan-legacy");
  });
});
