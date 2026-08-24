import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  ComputerWorkerBroker,
  grantsForComputerRole,
} from "../../Electron/resources/runtime/pi-ext/packages/computer-agent/src/worker-broker.ts";
import {
  ComputerWorkerBrokerServer,
} from "../../Electron/resources/runtime/pi-ext/packages/computer-agent/src/worker-broker-server.ts";
import {
  registerComputerWorkerTools,
  toolNamesForComputerWorkerRole,
} from "../../Electron/resources/runtime/pi-ext/packages/computer-agent/extensions/computer-worker.ts";

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

