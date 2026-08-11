import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  ComputerWorkerBroker,
  grantsForComputerRole,
} from "../../Sources/PipiUI/PiExt/packages/computer-agent/src/worker-broker.ts";
import {
  ComputerAgentCoordinator,
} from "../../Sources/PipiUI/PiExt/packages/computer-agent/src/coordinator.ts";
import {
  ComputerWorkerBrokerServer,
} from "../../Sources/PipiUI/PiExt/packages/computer-agent/src/worker-broker-server.ts";
import {
  registerComputerWorkerTools,
  toolNamesForComputerWorkerRole,
} from "../../Sources/PipiUI/PiExt/packages/computer-agent/extensions/computer-worker.ts";

test("worker broker attenuates grants per role and revokes a completed step", async () => {
  const calls = [];
  const broker = new ComputerWorkerBroker({
    request: async (request) => {
      calls.push(request);
      return { ok: true, action: request.action };
    },
    tokenFactory: () => "t".repeat(48),
  });

  assert.deepEqual(grantsForComputerRole("gui-operator"), [
    "observe",
    "mutate",
    "openApplication",
  ]);
  assert.deepEqual(grantsForComputerRole("verifier"), ["observe"]);

  const verifier = broker.issue({
    taskId: "task-1",
    stepId: "verify-1",
    runId: "run-1",
    role: "verifier",
  });
  assert.deepEqual(verifier.environment, {
    PIPIUI_COMPUTER_WORKER_BROKER_TOKEN: "t".repeat(48),
    PIPIUI_COMPUTER_WORKER_TASK_ID: "task-1",
    PIPIUI_COMPUTER_WORKER_STEP_ID: "verify-1",
    PIPIUI_COMPUTER_WORKER_ROLE: "verifier",
  });
  assert.equal("PIPIUI_COMPUTER_CAPABILITY" in verifier.environment, false);
  assert.equal("PIPIUI_SESSION_KEY" in verifier.environment, false);

  const observed = await broker.execute(verifier.token, {
    operation: "observe",
    payload: { fresh: true },
  });
  assert.equal(observed.ok, true);
  assert.equal(calls.length, 1);

  await assert.rejects(
    broker.execute(verifier.token, {
      operation: "mutate",
      payload: { actions: [{ type: "click", x: 1, y: 2 }] },
    }),
    /does not grant mutate/,
  );

  broker.revokeStep("task-1", "verify-1");
  await assert.rejects(
    broker.execute(verifier.token, { operation: "observe", payload: {} }),
    /unknown or revoked/,
  );
});

test("direct task uses one GUI worker and deterministic postcondition without verifier model", async () => {
  const dispatches = [];
  const coordinator = new ComputerAgentCoordinator({
    planner: {
      plan: async (goal) => ({
        goal,
        mode: "direct",
        successConditions: [{ kind: "visible_text", contains: "周会记录" }],
        steps: [{
          id: "gui-1",
          role: "gui-operator",
          objective: "Open TextEdit and enter the requested title",
          dependsOn: [],
          postconditions: [{ kind: "visible_text", contains: "周会记录" }],
        }],
      }),
      replan: async () => {
        throw new Error("direct happy path must not replan");
      },
    },
    dispatcher: {
      dispatch: async (request) => {
        dispatches.push(request);
        return {
          outcome: "completed",
          summary: "TextEdit shows 周会记录",
          observation: {
            id: "obs-2",
            visibleText: ["周会记录"],
          },
        };
      },
    },
  });

  const result = await coordinator.run({ goal: "在 TextEdit 输入周会记录" });
  assert.equal(result.outcome, "succeeded");
  assert.equal(result.verification.status, "verified");
  assert.deepEqual(dispatches.map((item) => item.role), ["gui-operator"]);
  assert.equal(result.planRevisions, 0);
});

test("unknown mutation outcome observes before a materially revised GUI retry", async () => {
  const dispatches = [];
  let replans = 0;
  const coordinator = new ComputerAgentCoordinator({
    planner: {
      plan: async (goal) => ({
        goal,
        mode: "direct",
        successConditions: [{ kind: "element_exists", name: "Saved" }],
        steps: [{
          id: "gui-1",
          role: "gui-operator",
          objective: "Save the document with the primary route",
          dependsOn: [],
          postconditions: [{ kind: "element_exists", name: "Saved" }],
        }],
      }),
      replan: async ({ plan }) => {
        replans += 1;
        return {
          ...plan,
          revision: 1,
          steps: [{
            ...plan.steps[0],
            id: "gui-2",
            objective: "Use the File menu after observing current state",
          }],
        };
      },
    },
    dispatcher: {
      dispatch: async (request) => {
        dispatches.push(request);
        if (request.role === "verifier") {
          return {
            outcome: "completed",
            summary: "Fresh observation shows the document is not saved",
            observation: { id: "obs-fresh", elements: [] },
          };
        }
        if (dispatches.filter((item) => item.role === "gui-operator").length === 1) {
          return { outcome: "outcome_unknown", summary: "driver timed out" };
        }
        return {
          outcome: "completed",
          summary: "Saved is visible",
          observation: {
            id: "obs-success",
            elements: [{ name: "Saved" }],
          },
        };
      },
    },
  });

  const result = await coordinator.run({ goal: "保存当前文档" });
  assert.equal(result.outcome, "succeeded");
  assert.equal(replans, 1);
  assert.deepEqual(dispatches.map((item) => item.role), [
    "gui-operator",
    "verifier",
    "gui-operator",
  ]);
  assert.match(dispatches[1].objective, /fresh observation/i);
  assert.notEqual(dispatches[0].objective, dispatches[2].objective);
});

test("subjective postcondition dispatches an observe-only verifier", async () => {
  const dispatches = [];
  const coordinator = new ComputerAgentCoordinator({
    planner: {
      plan: async (goal) => ({
        goal,
        mode: "planned",
        successConditions: [{ kind: "visual_judgement", description: "layout is readable" }],
        steps: [{
          id: "gui-1",
          role: "gui-operator",
          objective: "Apply the requested layout",
          dependsOn: [],
          postconditions: [{ kind: "visual_judgement", description: "layout is readable" }],
        }],
      }),
      replan: async () => {
        throw new Error("verification succeeds");
      },
    },
    dispatcher: {
      dispatch: async (request) => {
        dispatches.push(request);
        return request.role === "gui-operator"
          ? { outcome: "completed", summary: "layout applied", observation: { id: "obs-1" } }
          : {
              outcome: "verified",
              summary: "layout is readable",
              claims: ["The requested layout is visibly readable"],
              observation: { id: "obs-2" },
            };
      },
    },
  });

  const result = await coordinator.run({ goal: "把版式调整得清楚易读" });
  assert.equal(result.outcome, "succeeded");
  assert.deepEqual(dispatches.map((item) => item.role), ["gui-operator", "verifier"]);
  assert.deepEqual(dispatches[1].grants, ["observe"]);
});

test("loopback worker broker enforces attenuated capability server-side", async () => {
  const runtimeCalls = [];
  const broker = new ComputerWorkerBroker({
    request: async (request) => {
      runtimeCalls.push(request);
      return { ok: true, screenshotId: "screen-1" };
    },
    tokenFactory: () => "v".repeat(48),
  });
  const server = new ComputerWorkerBrokerServer(broker);
  await server.start();
  try {
    const issued = server.issue({
      taskId: "task-loopback",
      stepId: "verify-loopback",
      runId: "run-loopback",
      role: "verifier",
    });
    assert.match(issued.environment.PIPIUI_COMPUTER_WORKER_BROKER_URL, /^http:\/\/127\.0\.0\.1:\d+\/v1\/computer-worker$/);

    const mutate = await fetch(issued.environment.PIPIUI_COMPUTER_WORKER_BROKER_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: issued.token,
        operation: "mutate",
        payload: { actions: [{ type: "click", x: 4, y: 5 }] },
      }),
    });
    assert.equal(mutate.status, 403);
    assert.equal(runtimeCalls.length, 0);

    const observe = await fetch(issued.environment.PIPIUI_COMPUTER_WORKER_BROKER_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: issued.token,
        operation: "observe",
        payload: { fresh: true },
      }),
    });
    assert.equal(observe.status, 200);
    assert.deepEqual(await observe.json(), { ok: true, screenshotId: "screen-1" });
    assert.equal(runtimeCalls[0].action, "computer_batch");
  } finally {
    await server.stop();
  }
});

test("verifier child extension registers observation tools but no mutation tools", async () => {
  assert.deepEqual(toolNamesForComputerWorkerRole("verifier"), [
    "desktop_observe",
    "desktop_locate",
    "desktop_verify",
  ]);
  const registered = [];
  const requests = [];
  registerComputerWorkerTools({
    registerTool(tool) {
      registered.push(tool);
    },
  }, {
    PIPIUI_COMPUTER_WORKER_BROKER_URL: "http://127.0.0.1:9876/v1/computer-worker",
    PIPIUI_COMPUTER_WORKER_BROKER_TOKEN: "z".repeat(48),
    PIPIUI_COMPUTER_WORKER_ROLE: "verifier",
  }, async (_url, init) => {
    requests.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({
      ok: true,
      screenshotId: "shot-1",
      accessibility: { elements: [{ role: "button", name: "Save" }] },
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.deepEqual(registered.map((tool) => tool.name), [
    "desktop_observe",
    "desktop_locate",
    "desktop_verify",
  ]);
  assert.equal(registered.some((tool) => tool.name === "desktop_act"), false);
  await registered.find((tool) => tool.name === "desktop_observe")
    .execute("call-1", { fresh: true });
  assert.equal(requests[0].operation, "observe");
  assert.equal(requests[0].token, "z".repeat(48));
});

test("subagent runtime mounts scoped worker extension and exposes one computer_task interface", async () => {
  const root = new URL("../../Sources/PipiUI/PiExt/", import.meta.url);
  const [subagent, leader, operator, verifier, packageJSON] = await Promise.all([
    readFile(new URL("subagent/index.ts", root), "utf8"),
    readFile(new URL("agents/computer-use-leader/AGENT.md", root), "utf8"),
    readFile(new URL("agents/operator/AGENT.md", root), "utf8"),
    readFile(new URL("agents/computer-verifier/AGENT.md", root), "utf8"),
    readFile(new URL("packages/computer-agent/package.json", root), "utf8"),
  ]);
  assert.match(subagent, /name:\s*"computer_task"/);
  assert.match(subagent, /ComputerAgentCoordinator/);
  assert.match(subagent, /PIPIUI_COMPUTER_WORKER_BROKER_URL/);
  assert.match(subagent, /computer-worker\.ts/);
  assert.match(subagent, /delete env\.PIPIUI_COMPUTER_WORKER_BROKER_TOKEN/);
  assert.match(leader, /name: computer-use-leader/);
  assert.match(leader, /desktop: none/);
  assert.match(leader, /delegation: false/);
  assert.match(operator, /desktop_observe/);
  assert.match(operator, /desktop_act/);
  assert.match(verifier, /name: computer-verifier/);
  assert.match(verifier, /desktop_verify/);
  assert.doesNotMatch(verifier, /desktop_act/);
  const manifest = JSON.parse(packageJSON);
  assert.ok(manifest.files.includes("skills/**"));
});
