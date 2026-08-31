import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type Tool = {
  name: string;
  description?: string;
  promptSnippet?: string;
  prepareArguments?: (args: unknown) => unknown;
  execute: (id: string, params: any, signal?: unknown, onUpdate?: unknown, ctx?: { cwd: string }) => Promise<any>;
};
type EventHandler = (event: any, ctx: any) => any;
type LoadedTools = Record<string, Tool> & { __handlers: Map<string, EventHandler> };

/**
 * `sessionId` is read at module load (like the bridge env), so a caller that
 * wants a session-scoped store must stub the env before the import. The
 * specifier is a literal on purpose: a variable one is not statically
 * analyzable and fails to resolve under this vite/vitest.
 */
async function loadExtension(sessionId = "", options: { allowBridge?: boolean } = {}) {
  vi.resetModules();
  vi.stubEnv("PIPIUI_SESSION_ID", sessionId);
  if (!options.allowBridge) {
    vi.stubEnv("PIPIUI_BRIDGE_PORT", "");
    vi.stubEnv("PIPIUI_HOST_PROTOCOL", "");
    vi.stubEnv("PIPIUI_SESSION_KEY", "");
    vi.stubEnv("PIPIUI_SESSION_CAPABILITY", "");
  }
  const tools: Tool[] = [];
  const handlers = new Map<string, EventHandler>();
  const extension = (await import("../../../resources/runtime/extensions/pipiui-plan.ts")).default;
  extension({
    registerTool: (definition: Tool) => { tools.push(definition); },
    on: (eventName: string, handler: EventHandler) => { handlers.set(eventName, handler); },
  } as never);
  return Object.assign(Object.fromEntries(tools.map((tool) => [tool.name, tool])), { __handlers: handlers }) as LoadedTools;
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

    const first = await loadExtension("", { allowBridge: true });
    const ctx = { cwd: root };
    const published = parse(await first.plan_publish.execute("1", {
      plan: {
        id: "plan-a",
        title: "Ship plan tools",
        approvalRequired: true,
        tasks: [{ id: "t1", title: "implement" }, { id: "t2", title: "test" }],
      },
    }, undefined, undefined, ctx));
    expect(published.ok).toBe(true);
    expect(published.plan.tasks[0].state).toBe("pending");
    expect(published.plan.lifecycle).toBe("draft");

    const premature = parse(await first.plan_task_update.execute("2", {
      planId: "plan-a",
      taskId: "t1",
      state: "in_progress",
      note: "started",
    }, undefined, undefined, ctx));
    expect(premature).toMatchObject({ ok: false, error: expect.stringMatching(/awaiting user approval/i) });

    const approved = parse(await first.plan_approve.execute("3", { planId: "plan-a" }, undefined, undefined, ctx));
    expect(approved.ok).toBe(true);
    expect(approved.guidance).toMatch(/Never hand the whole plan to a single general-purpose worker/);
    expect(approved.guidance).toMatch(/dispatch one worker per independent task in the SAME turn/);
    expect(approved.guidance).toMatch(/1\. implement/);
    expect(approved.guidance).toMatch(/2\. test/);
    expect(approved.guidance).toMatch(/plan_task_update/);
    expect(approved.guidance).toMatch(/same plan\.id through later phases/);
    expect(approved.guidance).toMatch(/do not publish a stage2\/stage3 replacement plan/);
    expect(approved.plan.lifecycle).toBe("approved");
    expect(approved.plan.approvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const updated = parse(await first.plan_task_update.execute("4", {
      planId: "plan-a",
      taskId: "t1",
      state: "in_progress",
      note: "started",
    }, undefined, undefined, ctx));
    expect(updated.ok).toBe(true);
    expect(updated.plan.tasks[0]).toMatchObject({ state: "in_progress", note: "started" });

    const disk = JSON.parse(await readFile(join(root, ".pi", "plans", "current.json"), "utf8"));
    expect(disk.activePlanId).toBe("plan-a");
    expect(disk.plans["plan-a"].lifecycle).toBe("approved");

    const reloaded = await loadExtension("", { allowBridge: true });
    const again = parse(await reloaded.plan_task_update.execute("5", {
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
    expect(posts[1].body.event.event).toBe("plan_approve");
    expect(posts[1].body.event.plan.lifecycle).toBe("approved");
    expect(posts[2].body.event.event).toBe("plan_task_update");
  });

  it("publishes ordinary tracking plans as active without showing an approval state", async () => {
    root = await mkdtemp(join(tmpdir(), "pipiui-plan-active-"));
    const tools = await loadExtension();
    const ctx = { cwd: root };
    const published = parse(await tools.plan_publish.execute("1", {
      plan: {
        id: "plan-active",
        title: "Track direct work",
        approvalRequired: false,
        tasks: [{ id: "t1", title: "implement" }],
      },
    }, undefined, undefined, ctx));
    expect(published).toMatchObject({ ok: true, plan: { lifecycle: "active" } });

    const updated = parse(await tools.plan_task_update.execute("2", {
      planId: "plan-active", taskId: "t1", state: "in_progress",
    }, undefined, undefined, ctx));
    expect(updated).toMatchObject({ ok: true, plan: { tasks: [{ state: "in_progress" }] } });
    expect(await tools.__handlers.get("tool_call")!(
      { toolName: "bash", input: { command: "echo allowed" } },
      { ...ctx, sessionManager: { getBranch: () => [] } },
    )).toBeUndefined();

    const unnecessaryApproval = parse(await tools.plan_approve.execute("3", {
      planId: "plan-active",
    }, undefined, undefined, ctx));
    expect(unnecessaryApproval).toMatchObject({ ok: false, error: expect.stringMatching(/does not require approval/i) });
  });

  it("blocks execution for a formal draft, including sibling calls in its publish batch", async () => {
    root = await mkdtemp(join(tmpdir(), "pipiui-plan-gate-"));
    const tools = await loadExtension();
    const ctx = { cwd: root, sessionManager: { getBranch: () => [] } };
    const alreadyStarted = parse(await tools.plan_publish.execute("0", {
      plan: {
        id: "plan-started",
        title: "Invalid formal progress",
        approvalRequired: true,
        tasks: [{ id: "t0", title: "already done", state: "completed" }],
      },
    }, undefined, undefined, ctx));
    expect(alreadyStarted).toMatchObject({ ok: false, error: expect.stringMatching(/every task as pending/i) });

    await tools.plan_publish.execute("1", {
      plan: {
        id: "plan-gated",
        title: "Wait for approval",
        approvalRequired: true,
        tasks: [{ id: "t1", title: "implement" }],
      },
    }, undefined, undefined, ctx);

    const gate = tools.__handlers.get("tool_call")!;
    expect(await gate({ toolName: "bash", input: { command: "echo nope" } }, ctx)).toMatchObject({ block: true, terminate: true });
    expect(await gate({ toolName: "plan_check", input: {} }, ctx)).toBeUndefined();

    const emptyRoot = await mkdtemp(join(tmpdir(), "pipiui-plan-batch-gate-"));
    const sameBatchCtx = {
      cwd: emptyRoot,
      sessionManager: {
        getBranch: () => [{
          type: "message",
          message: {
            role: "assistant",
            content: [
              { type: "toolCall", name: "plan_publish", arguments: { plan: { approvalRequired: true } } },
              { type: "toolCall", name: "bash", arguments: { command: "echo nope" } },
            ],
          },
        }],
      },
    };
    expect(await gate({ toolName: "bash", input: { command: "echo nope" } }, sameBatchCtx)).toMatchObject({ block: true });
    await rm(emptyRoot, { recursive: true, force: true });
  });

  it("turns the approval button prompt into persisted approval before the next agent step", async () => {
    root = await mkdtemp(join(tmpdir(), "pipiui-plan-input-approve-"));
    const tools = await loadExtension();
    const ctx = { cwd: root, sessionManager: { getBranch: () => [] } };
    await tools.plan_publish.execute("1", {
      plan: {
        id: "plan-input",
        title: "Approve from UI",
        approvalRequired: true,
        tasks: [{ id: "t1", title: "implement" }],
      },
    }, undefined, undefined, ctx);

    await tools.__handlers.get("input")!({ text: "批准该计划", source: "extension" }, ctx);
    const beforeHumanApproval = JSON.parse(await readFile(join(root, ".pi", "plans", "current.json"), "utf8"));
    expect(beforeHumanApproval.plans["plan-input"].lifecycle).toBe("draft");

    await tools.__handlers.get("input")!({ text: "批准该计划", source: "rpc" }, ctx);
    const disk = JSON.parse(await readFile(join(root, ".pi", "plans", "current.json"), "utf8"));
    expect(disk.plans["plan-input"]).toMatchObject({ lifecycle: "approved", approvedAt: expect.any(String) });
    expect(await tools.__handlers.get("tool_call")!({ toolName: "bash", input: { command: "echo ok" } }, ctx)).toBeUndefined();
  });

  it("migrates a legacy progressed draft to active tracking", async () => {
    root = await mkdtemp(join(tmpdir(), "pipiui-plan-legacy-progress-"));
    await mkdir(join(root, ".pi", "plans"), { recursive: true });
    await writeFile(join(root, ".pi", "plans", "current.json"), JSON.stringify({
      activePlanId: "legacy-plan",
      plans: {
        "legacy-plan": {
          id: "legacy-plan",
          title: "Old mixed state",
          lifecycle: "draft",
          createdAt: "2026-08-30T00:00:00.000Z",
          updatedAt: "2026-08-30T00:01:00.000Z",
          tasks: [{ id: "t1", title: "already running", state: "in_progress" }],
        },
      },
    }), "utf8");
    const tools = await loadExtension();
    const ctx = { cwd: root, sessionManager: { getBranch: () => [] } };
    const checked = parse(await tools.plan_check.execute("1", {}, undefined, undefined, ctx));
    expect(checked.plan.lifecycle).toBe("active");
    expect(await tools.__handlers.get("tool_call")!(
      { toolName: "bash", input: { command: "echo allowed" } }, ctx,
    )).toBeUndefined();
  });

  it("describes plan_publish as a full-spec stable-id tool", async () => {
    const tools = await loadExtension();
    expect(tools.plan_publish.description).toMatch(/full-spec/);
    expect(tools.plan_publish.description).toMatch(/entire spec/);
    expect(tools.plan_publish.description).toMatch(/Do not publish only the current stage/);
    expect(tools.plan_publish.description).toMatch(/do not publish a stage2\/stage3 replacement/);
    expect(tools.plan_publish.promptSnippet).toMatch(/later phases stay on this plan/);
    expect(tools.plan_task_update.description).toMatch(/including when starting the next phase/);
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

  it("rejects a second unfinished plan but preserves history after the first finishes", async () => {
    root = await mkdtemp(join(tmpdir(), "pipiui-plan-lifecycle-"));
    const tools = await loadExtension();
    const ctx = { cwd: root };
    expect(parse(await tools.plan_publish.execute("1", {
      plan: { id: "plan-a", title: "A", tasks: [{ id: "t1", title: "one" }] },
    }, undefined, undefined, ctx)).ok).toBe(true);

    const overlapping = parse(await tools.plan_publish.execute("2", {
      plan: { id: "plan-b", title: "B", tasks: [{ id: "t2", title: "two" }] },
    }, undefined, undefined, ctx));
    expect(overlapping).toMatchObject({ ok: false, error: expect.stringMatching(/active plan in progress/i) });

    expect(parse(await tools.plan_task_update.execute("3", {
      planId: "plan-a", taskId: "t1", state: "completed",
    }, undefined, undefined, ctx)).ok).toBe(true);
    expect(parse(await tools.plan_publish.execute("4", {
      plan: { id: "plan-b", title: "B", tasks: [{ id: "t2", title: "two" }] },
    }, undefined, undefined, ctx)).ok).toBe(true);

    const disk = JSON.parse(await readFile(join(root, ".pi", "plans", "current.json"), "utf8"));
    expect(disk.activePlanId).toBe("plan-b");
    expect(Object.keys(disk.plans)).toEqual(["plan-a", "plan-b"]);
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

    const tools = await loadExtension("", { allowBridge: true });
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

  it("does not post fixture plans through bridge credentials inherited by a no-stub test", async () => {
    root = await mkdtemp(join(tmpdir(), "pipiui-plan-isolation-"));
    const fetchSpy = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("PIPIUI_BRIDGE_PORT", "18766");
    vi.stubEnv("PIPIUI_HOST_PROTOCOL", "1");
    vi.stubEnv("PIPIUI_SESSION_CAPABILITY", "inherited-real-capability");

    const tools = await loadExtension("fixture-session");
    const published = parse(await tools.plan_publish.execute("1", {
      plan: { id: "fixture-plan", title: "test-only fixture", tasks: [{ id: "t1", title: "fixture step" }] },
    }, undefined, undefined, { cwd: root }));

    expect(published.ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
