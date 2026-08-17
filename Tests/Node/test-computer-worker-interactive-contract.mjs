import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerComputerWorkerTools } from "../../Electron/resources/runtime/pi-ext/packages/computer-agent/extensions/computer-worker.ts";
import { ComputerWorkerBroker } from "../../Electron/resources/runtime/pi-ext/packages/computer-agent/src/worker-broker.ts";

test("Operator resolves an interactive control instead of clicking same-name container text", async () => {
  const calls = [];
  const tools = [];
  const elements = [
    { element_index: 10, element_token: "container-token", role: "AXGroup", name: "直接开始" },
    { element_index: 11, element_token: "text-token", role: "AXStaticText", name: "直接开始" },
    { element_index: 12, element_token: "button-token", role: "AXButton", name: "直接开始", actions: ["press"] },
  ];
  registerComputerWorkerTools({ registerTool: (tool) => tools.push(tool) }, {
    PIPIUI_COMPUTER_WORKER_BROKER_URL: "http://127.0.0.1:1/v1/computer-worker",
    PIPIUI_COMPUTER_WORKER_BROKER_TOKEN: "x".repeat(32),
    PIPIUI_COMPUTER_WORKER_ROLE: "gui-operator",
  }, async (_url, init) => {
    const request = JSON.parse(String(init.body));
    calls.push(request);
    const result = request.operation === "locate"
      ? { status: "resolved", bindingId: "binding-button", match: elements[2] }
      : { observationId: `observation-${calls.length}`, accessibility: { snapshot_id: "snapshot-1", elements } };
    return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
  });
  const observe = tools.find((tool) => tool.name === "desktop_observe");
  const locate = tools.find((tool) => tool.name === "desktop_locate");
  const act = tools.find((tool) => tool.name === "desktop_act");
  await observe.execute("observe", { fresh: true });
  await assert.rejects(
    act.execute("bad", { actions: [{ type: "click", element_token: "container-token" }], semanticBindings: [] }),
    /interactive_control_requires_exact_binding/,
  );
  assert.equal(calls.filter(({ operation }) => operation === "mutate").length, 0);
  const located = await locate.execute("locate", { role: "AXButton", name: "直接开始" });
  assert.equal(located.details.bindingId, "binding-button");
  await act.execute("good", {
    actions: [{ type: "click", element_token: "button-token", snapshot_id: "snapshot-1" }],
    semanticBindings: [{ kind: "click", bindingId: "binding-button" }],
  });
  assert.equal(calls.filter(({ operation }) => operation === "mutate").length, 1);

  const skill = await readFile(new URL("../../Electron/resources/runtime/pi-ext/packages/computer-agent/skills/cua-driver-operation/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /AXButton.*same-name.*container.*static text.*desktop_locate/is);
  assert.match(skill, /blocking.*onboarding.*modal.*interstitial.*non-destructive.*fresh.*observe.*never.*blind.*scroll.*hotkey/is);
});

test("every state mutation requires a separate fresh observation before another mutation", async () => {
  const runtimeCalls = [];
  const broker = new ComputerWorkerBroker({ request: async (request) => {
    runtimeCalls.push(request);
    return { screenshotId: `shot-${runtimeCalls.length}`, base64: `PNG-${runtimeCalls.length}`, accessibility: { elements: [] } };
  } });
  const grant = broker.issue({ taskId: "task", stepId: "step", runId: "run", role: "gui-operator" });
  await broker.execute(grant.token, { operation: "openApplication", payload: { bundle_identifier: "org.example.app" } });
  await assert.rejects(
    broker.execute(grant.token, { operation: "mutate", payload: { actions: [{ type: "key", key: "CMD+," }], semanticBindings: [] } }),
    /fresh_observation_required_after_mutation.*desktop_observe/,
  );
  await broker.execute(grant.token, { operation: "observe", payload: { fresh: true } });
  await assert.rejects(
    broker.execute(grant.token, { operation: "mutate", payload: { actions: [{ type: "click", coordinate: [1, 1] }, { type: "scroll", direction: "down" }], semanticBindings: [] } }),
    /one_state_mutation_per_observation/,
  );
  await broker.execute(grant.token, { operation: "mutate", payload: { actions: [{ type: "click", coordinate: [1, 1] }, { type: "wait", duration: 0.1 }], semanticBindings: [] } });
  const callsAfterMutation = runtimeCalls.length;
  await assert.rejects(
    broker.execute(grant.token, { operation: "mutate", payload: { actions: [{ type: "scroll", direction: "down" }], semanticBindings: [] } }),
    /fresh_observation_required_after_mutation.*desktop_observe/,
  );
  assert.equal(runtimeCalls.length, callsAfterMutation);
  await broker.execute(grant.token, { operation: "observe", payload: { fresh: false } });
  await assert.rejects(
    broker.execute(grant.token, { operation: "mutate", payload: { actions: [{ type: "key", key: "END" }], semanticBindings: [] } }),
    /fresh_observation_required_after_mutation/,
  );
  await broker.execute(grant.token, { operation: "observe", payload: { fresh: true } });
  await broker.execute(grant.token, { operation: "mutate", payload: { actions: [{ type: "scroll", direction: "down" }], semanticBindings: [] } });
});

test("native menu invocation stays an exact pinned-target action without coordinate fallback", async () => {
  const runtimeCalls = [];
  const broker = new ComputerWorkerBroker({ request: async (request) => {
    runtimeCalls.push(request);
    return { screenshotId: `shot-${runtimeCalls.length}`, base64: "PNG", accessibility: { elements: [] } };
  } });
  const grant = broker.issue({ taskId: "task", stepId: "menu", runId: "run", role: "gui-operator" });
  await broker.execute(grant.token, {
    operation: "mutate",
    payload: { actions: [{ type: "invoke_menu", path: ["Example App", "Settings…"] }], semanticBindings: [] },
  });
  assert.deepEqual(runtimeCalls[0].actions, [
    { type: "invoke_menu", path: ["Example App", "Settings…"] },
  ]);
  await broker.execute(grant.token, { operation: "observe", payload: { fresh: true } });
  await assert.rejects(
    broker.execute(grant.token, {
      operation: "mutate",
      payload: { actions: [{ type: "invoke_menu", path: ["Example App", "Settings…"], coordinate: [90, -1065] }], semanticBindings: [] },
    }),
    /invoke_menu accepts only an exact menu path/,
  );
  assert.equal(runtimeCalls.length, 2);
});
