import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import {
  buildSubagentEnvironmentV1,
  createSubagentHostServerV1,
  decodeAgentEventV1,
  decodeHostCapabilitiesV1,
  decodeJobsSnapshotV1,
  decodePlanEventV1,
  decodePlanRevisionResponseV1,
  upgradeCurrentBridgeEnvelopeV1,
} from "../../Sources/PipiUI/PiExt/subagent-host/index.ts";

const fixture = (name) => new URL(
  `../../Sources/PipiUI/PiExt/subagent-host/fixtures/${name}`,
  import.meta.url,
);

async function loadFixture(name) {
  return JSON.parse(await readFile(fixture(name), "utf8"));
}

async function post(port, body, headers = { "content-type": "application/json" }) {
  const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function rawPost(port, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = typeof body === "string" ? body : JSON.stringify(body);
    const request = httpRequest({
      host: "127.0.0.1",
      port,
      path: "/rpc",
      method: "POST",
      headers: { "content-length": Buffer.byteLength(payload), ...headers },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        try {
          resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", reject);
    request.end(payload);
  });
}

function postThenDestroy(port, body) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const request = httpRequest({
      host: "127.0.0.1",
      port,
      path: "/rpc",
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
      },
    });
    request.on("error", () => resolve());
    request.end(payload);
    setTimeout(() => {
      request.destroy();
      resolve();
    }, 5);
  });
}

test("v1 fixtures decode every live agent/plan kind and project the portable environment", async () => {
  const [capabilities, agentFixture, planFixture, snapshot] = await Promise.all([
    loadFixture("host-capabilities-v1.json"),
    loadFixture("agent-events-v1.json"),
    loadFixture("plan-events-v1.json"),
    loadFixture("jobs-snapshot-v1.json"),
  ]);

  const decodedCapabilities = decodeHostCapabilitiesV1(capabilities);
  assert.equal(decodedCapabilities.ok, true, JSON.stringify(decodedCapabilities.diagnostics));
  const environment = buildSubagentEnvironmentV1(capabilities);
  assert.equal(environment.ok, true, JSON.stringify(environment.diagnostics));
  assert.equal(environment.value.PIPIUI_BRIDGE_PORT, "43123");
  assert.equal(environment.value.PIPIUI_HOST_PROTOCOL, "1");
  assert.equal(environment.value.PIPIUI_SESSION_CAPABILITY, capabilities.bridge.sessionCapability);
  assert.equal(environment.value.PIPIUI_SESSION_KEY, capabilities.bridge.sessionCapability, "legacy clients receive the same opaque capability alias");
  assert.equal(environment.value.PIPIUI_MAIN_CWD, capabilities.mainCwd);
  assert.equal(environment.value.PIPIUI_SUBAGENT_EXT, capabilities.extensions.subagent);
  assert.equal(environment.value.PIPIUI_PDF_HELPER, capabilities.extensions.pdfHelper);
  assert.equal(environment.value.PIPIUI_SKILL_READ_BLOCK, "1");
  assert.equal(environment.value.PIPIUI_SUBAGENT_MODEL_CAPABILITIES_FILE, capabilities.modelFiles.subagentModelCapabilitiesFile);
  assert.equal(environment.value.PIPIUI_COMPUTER_CAPABILITY, capabilities.platform.computer.routingCapability);
  assert.equal(environment.value.PIPIUI_SEARCH_GRANT_FILE, capabilities.platform.search.grantFile);
  assert.equal(environment.value.PIPIUI_MEMORY_BROKER_ENABLED, "1");
  assert.equal("PIPIUI_COMPUTER_WIDTH" in environment.value, false, "portable contract must not collect geometry");

  const kinds = new Set();
  for (const event of agentFixture.events) {
    const decoded = decodeAgentEventV1(event);
    assert.equal(decoded.ok, true, `${event.kind}: ${JSON.stringify(decoded.diagnostics)}`);
    assert.equal(decoded.value.schemaVersion, 1);
    assert.equal(typeof decoded.value.agentId, "string");
    assert.equal(typeof decoded.value.runId, "string");
    if (decoded.value.kind === "stalled") assert.equal(decoded.value.stalled, true);
    if (decoded.value.kind === "closeout") assert.equal(decoded.value.disposition, "cleaned");
    kinds.add(decoded.value.kind);
  }
  assert.deepEqual([...kinds].sort(), ["closeout", "end", "log", "log_delta", "stalled", "start", "update", "usage"]);

  for (const event of planFixture.events) {
    const decoded = decodePlanEventV1(event);
    assert.equal(decoded.ok, true, `${event.event}: ${JSON.stringify(decoded.diagnostics)}`);
    assert.equal(decoded.value.schemaVersion, 1);
  }
  for (const response of planFixture.responses) {
    const decoded = decodePlanRevisionResponseV1(response);
    assert.equal(decoded.ok, true, JSON.stringify(decoded.diagnostics));
  }
  const decodedSnapshot = decodeJobsSnapshotV1(snapshot);
  assert.equal(decodedSnapshot.ok, true, JSON.stringify(decodedSnapshot.diagnostics));
  assert.equal(decodedSnapshot.value.jobs.length, 3);
  assert.equal(decodedSnapshot.value.jobs.find((job) => job.agentId === "closed-worker")?.closeoutDisposition, "cleaned");

  const absentOptionalCapabilities = structuredClone(capabilities);
  delete absentOptionalCapabilities.extensions.pdfHelper;
  delete absentOptionalCapabilities.session.skillReadBlock;
  const absentEnvironment = buildSubagentEnvironmentV1(absentOptionalCapabilities);
  assert.equal(absentEnvironment.ok, true, JSON.stringify(absentEnvironment.diagnostics));
  assert.equal("PIPIUI_PDF_HELPER" in absentEnvironment.value, false);
  assert.equal("PIPIUI_SKILL_READ_BLOCK" in absentEnvironment.value, false);

  const explicitSkillReadAllow = structuredClone(capabilities);
  explicitSkillReadAllow.session.skillReadBlock = false;
  const allowEnvironment = buildSubagentEnvironmentV1(explicitSkillReadAllow);
  assert.equal(allowEnvironment.ok, true, JSON.stringify(allowEnvironment.diagnostics));
  assert.equal(allowEnvironment.value.PIPIUI_SKILL_READ_BLOCK, "0");

  const invalidPdfHelper = structuredClone(capabilities);
  invalidPdfHelper.extensions.pdfHelper = "relative-helper";
  const invalidCapabilities = decodeHostCapabilitiesV1(invalidPdfHelper);
  assert.equal(invalidCapabilities.ok, false);
  assert.ok(invalidCapabilities.diagnostics.some((entry) => entry.path === "$.extensions.pdfHelper" && entry.code === "invalid_absolute_path"));
});

test("validators fail closed for required/dangerous fields and preserve ordinary unknown fields diagnostically", async () => {
  const missingRun = decodeAgentEventV1({
    schemaVersion: 1,
    kind: "update",
    agentId: "agent-a",
  });
  assert.equal(missingRun.ok, false);
  assert.ok(missingRun.diagnostics.some((entry) => entry.code === "missing_required_field" && entry.path === "$.runId"));

  const dangerous = decodeAgentEventV1(JSON.parse(`{
    "schemaVersion":1,"kind":"update","agentId":"agent-a","runId":"run-a","__proto__":{"polluted":true}
  }`));
  assert.equal(dangerous.ok, false);
  assert.ok(dangerous.diagnostics.some((entry) => entry.code === "dangerous_key"));

  const forwardCompatible = decodeAgentEventV1({
    schemaVersion: 1,
    kind: "update",
    agentId: "agent-a",
    runId: "run-a",
    futureTelemetry: "kept",
  });
  assert.equal(forwardCompatible.ok, true);
  assert.equal(forwardCompatible.value.extensions.futureTelemetry, "kept");
  assert.ok(forwardCompatible.diagnostics.some((entry) => entry.code === "unknown_field_preserved"));

  const [currentBridge, planFixture, snapshot] = await Promise.all([
    loadFixture("current-bridge-compat-v0.json"),
    loadFixture("plan-events-v1.json"),
    loadFixture("jobs-snapshot-v1.json"),
  ]);
  const currentLegacy = upgradeCurrentBridgeEnvelopeV1(currentBridge.currentAgentUpdate);
  assert.equal(currentLegacy.ok, true, JSON.stringify(currentLegacy.diagnostics));
  assert.equal(currentLegacy.value.event.runId, "run-a");
  const historicalLegacy = upgradeCurrentBridgeEnvelopeV1(currentBridge.historicalAgentUpdateWithoutRunId, {
    runId: "bound-by-trusted-adapter",
  });
  assert.equal(historicalLegacy.ok, true, JSON.stringify(historicalLegacy.diagnostics));
  assert.equal(historicalLegacy.value.event.runId, "bound-by-trusted-adapter");
  const unboundHistorical = upgradeCurrentBridgeEnvelopeV1(currentBridge.historicalAgentUpdateWithoutRunId);
  assert.equal(unboundHistorical.ok, false, "a host must not infer a reusable runId from bare agentId");
  const lifecycle = upgradeCurrentBridgeEnvelopeV1(currentBridge.currentPlanApprove);
  assert.equal(lifecycle.ok, true, JSON.stringify(lifecycle.diagnostics));
  assert.equal(lifecycle.value.event.schemaVersion, 1);

  const unsupportedLegacy = upgradeCurrentBridgeEnvelopeV1({
    sessionKey: currentBridge.currentAgentUpdate.sessionKey,
    action: "abort",
    agentId: "agent-a",
  });
  assert.equal(unsupportedLegacy.ok, false);
  assert.ok(unsupportedLegacy.diagnostics.some((entry) => entry.code === "unsupported_legacy_action"));

  const invalidCloseout = decodeAgentEventV1({
    schemaVersion: 1,
    kind: "closeout",
    agentId: "agent-a",
    runId: "run-a",
    disposition: "retained",
  });
  assert.equal(invalidCloseout.ok, false);
  assert.ok(invalidCloseout.diagnostics.some((entry) => entry.code === "invalid_closeout_disposition"));

  const duplicateTaskPlan = structuredClone(planFixture.events[0]);
  duplicateTaskPlan.plan.tasks.push(structuredClone(duplicateTaskPlan.plan.tasks[0]));
  const duplicateTask = decodePlanEventV1(duplicateTaskPlan);
  assert.equal(duplicateTask.ok, false);
  assert.ok(duplicateTask.diagnostics.some((entry) => entry.code === "duplicate_task_id"));

  const duplicateJobs = structuredClone(snapshot);
  duplicateJobs.jobs.push(structuredClone(duplicateJobs.jobs[0]));
  const duplicateJob = decodeJobsSnapshotV1(duplicateJobs);
  assert.equal(duplicateJob.ok, false);
  assert.ok(duplicateJob.diagnostics.some((entry) => entry.code === "duplicate_job"));
});

test("reference server accepts only authenticated POST /rpc, serializes callbacks, and serves reconnect snapshots", async () => {
  const [rpcCases, snapshot, planFixture] = await Promise.all([
    loadFixture("rpc-cases-v1.json"),
    loadFixture("jobs-snapshot-v1.json"),
    loadFixture("plan-events-v1.json"),
  ]);
  const sequence = [];
  const actions = [];
  const currentPlanResponse = structuredClone(planFixture.responses[0]);
  delete currentPlanResponse.schemaVersion;
  const currentSnapshot = structuredClone(snapshot);
  delete currentSnapshot.schemaVersion;
  const host = createSubagentHostServerV1({
    sessionCapability: rpcCases.sessionCapability,
    maxBodyBytes: 512,
    maxQueue: 8,
    handlers: {
      async onAgentEvent(event) {
        sequence.push(`start:${event.agentId}`);
        await new Promise((resolve) => setTimeout(resolve, 15));
        sequence.push(`end:${event.agentId}`);
        return { message: "projected" };
      },
      onPlanEvent(event) {
        actions.push(`plan:${event.event}`);
        return currentPlanResponse;
      },
      onAbort(command) {
        actions.push(`abort:${command.agentId}:${command.runId}`);
        return { accepted: true, message: "extension command requested" };
      },
      onRecover(command) {
        actions.push(`recover:${command.agentId}:${command.fresh}`);
        return { accepted: true };
      },
      onSnapshot() {
        actions.push("snapshot");
        return currentSnapshot;
      },
    },
  });
  const { port } = await host.listen();
  try {
    const first = structuredClone(rpcCases.validAgentEventRequest);
    first.event.agentId = "first";
    const second = structuredClone(rpcCases.validAgentEventRequest);
    second.requestId = "rpc-agent-002";
    second.event.agentId = "second";
    const [firstResponse, secondResponse] = await Promise.all([post(port, first), post(port, second)]);
    assert.equal(firstResponse.status, 200);
    assert.equal(firstResponse.body.ok, true);
    assert.equal(firstResponse.body.requestId, "rpc-agent-001");
    assert.equal(secondResponse.status, 200);
    assert.deepEqual(sequence, ["start:first", "end:first", "start:second", "end:second"], "callbacks must be FIFO, not concurrently dispatched");

    const plan = await post(port, {
      schemaVersion: 1,
      sessionCapability: rpcCases.sessionCapability,
      action: "plan_event",
      requestId: "plan-001",
      event: planFixture.events[0],
    });
    assert.equal(plan.status, 200);
    assert.deepEqual({ schemaVersion: plan.body.schemaVersion, ok: plan.body.ok, applied: plan.body.applied, revision: plan.body.revision }, {
      schemaVersion: 1, ok: true, applied: true, revision: 7,
    });
    assert.equal(plan.body.action, "plan_event");

    const snapshotResponse = await post(port, rpcCases.snapshotRequest);
    assert.equal(snapshotResponse.status, 200);
    assert.equal(snapshotResponse.body.action, "snapshot");
    assert.equal(snapshotResponse.body.ok, true);
    assert.equal(snapshotResponse.body.jobs[0].runId, "run-001");

    const abort = await post(port, rpcCases.abortRequest);
    const recover = await post(port, rpcCases.recoverRequest);
    const recoverFresh = await post(port, rpcCases.recoverFreshRequest);
    assert.equal(abort.body.accepted, true);
    assert.equal(recover.body.accepted, true);
    assert.equal(recoverFresh.body.accepted, true);
    assert.ok(actions.includes("abort:host-contract:run-001"));
    assert.ok(actions.includes("recover:host-contract:false"));
    assert.ok(actions.includes("recover:host-contract:true"));

    const badKey = await post(port, rpcCases.badCapabilityRequest);
    assert.equal(badKey.status, 401);
    assert.equal(badKey.body.ok, false);
    assert.equal(badKey.body.diagnostics[0].code, "unauthorized_session_capability");

    const unknown = await post(port, rpcCases.unknownActionRequest);
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.ok, false);
    assert.ok(unknown.body.diagnostics.some((entry) => entry.code === "unknown_action"));

    const badBody = await post(port, rpcCases.badBody);
    assert.equal(badBody.status, 400);
    assert.equal(badBody.body.diagnostics[0].code, "invalid_json_body");

    const missingContentType = await rawPost(port, rpcCases.snapshotRequest);
    assert.equal(missingContentType.status, 415);
    assert.equal(missingContentType.body.diagnostics[0].code, "unsupported_media_type");

    const oversize = await post(port, JSON.stringify({
      schemaVersion: 1,
      sessionCapability: rpcCases.sessionCapability,
      action: "prompt",
      message: "x".repeat(rpcCases.oversizeBytes),
    }));
    assert.equal(oversize.status, 413);
    assert.equal(oversize.body.diagnostics[0].code, "body_too_large");
  } finally {
    await host.close();
  }
});

test("handler timeouts preserve FIFO, handler failures stay structured, and destroyed responses do not stop the host", async () => {
  const [rpcCases, planFixture] = await Promise.all([
    loadFixture("rpc-cases-v1.json"),
    loadFixture("plan-events-v1.json"),
  ]);
  let resolveHangStarted;
  const hangStarted = new Promise((resolve) => { resolveHangStarted = resolve; });
  let resolveDestroyedHandled;
  const destroyedHandled = new Promise((resolve) => { resolveDestroyedHandled = resolve; });
  const calls = [];
  const host = createSubagentHostServerV1({
    sessionCapability: rpcCases.sessionCapability,
    maxQueue: 2,
    handlerTimeoutMs: 50,
    handlers: {
      async onAgentEvent(event) {
        if (event.agentId === "hang") {
          calls.push("hang-start");
          resolveHangStarted();
          await new Promise(() => {});
        }
        if (event.agentId === "destroyed") {
          calls.push("destroyed-start");
          await new Promise((resolve) => setTimeout(resolve, 20));
          calls.push("destroyed-end");
          resolveDestroyedHandled();
          return { accepted: true };
        }
        calls.push(`handled:${event.agentId}`);
        return { accepted: true };
      },
      onAbort() {
        throw new Error("abort callback exploded");
      },
      onPlanEvent() {
        // The adapter may stamp the omitted schemaVersion, but it must still
        // reject the malformed revision type.
        return { ok: true, applied: true, revision: "not-an-integer" };
      },
    },
  });
  const { port } = await host.listen();
  try {
    const hanging = structuredClone(rpcCases.validAgentEventRequest);
    hanging.event.agentId = "hang";
    const hangingResponse = post(port, hanging);
    await hangStarted;

    const after = structuredClone(rpcCases.validAgentEventRequest);
    after.requestId = "after-timeout";
    after.event.agentId = "after-timeout";
    const afterResponse = post(port, after);
    const [timedOut, continued] = await Promise.all([hangingResponse, afterResponse]);
    assert.equal(timedOut.status, 200);
    assert.equal(timedOut.body.ok, false);
    assert.equal(timedOut.body.diagnostics[0].code, "handler_timeout");
    assert.equal(continued.status, 200);
    assert.equal(continued.body.ok, true);
    assert.deepEqual(calls.slice(0, 2), ["hang-start", "handled:after-timeout"], "a timeout must release FIFO before the queued event runs");

    const thrown = await post(port, rpcCases.abortRequest);
    assert.equal(thrown.status, 200);
    assert.equal(thrown.body.ok, false);
    assert.equal(thrown.body.diagnostics[0].code, "handler_failed");

    const malformedPlan = await post(port, {
      schemaVersion: 1,
      sessionCapability: rpcCases.sessionCapability,
      action: "plan_event",
      event: planFixture.events[0],
    });
    assert.equal(malformedPlan.status, 200);
    assert.equal(malformedPlan.body.ok, false);
    assert.ok(malformedPlan.body.diagnostics.some((entry) => entry.code === "invalid_integer"));

    const destroyed = structuredClone(rpcCases.validAgentEventRequest);
    destroyed.event.agentId = "destroyed";
    await postThenDestroy(port, destroyed);
    await destroyedHandled;
    const healthy = structuredClone(rpcCases.validAgentEventRequest);
    healthy.event.agentId = "healthy-after-disconnect";
    const healthyResponse = await post(port, healthy);
    assert.equal(healthyResponse.status, 200);
    assert.equal(healthyResponse.body.ok, true);
    assert.ok(calls.includes("handled:healthy-after-disconnect"));
  } finally {
    await host.close();
  }
});

test("queue limit rejects after a known active handler without reordering", async () => {
  const rpcCases = await loadFixture("rpc-cases-v1.json");
  let resolveActive;
  const active = new Promise((resolve) => { resolveActive = resolve; });
  const host = createSubagentHostServerV1({
    sessionCapability: rpcCases.sessionCapability,
    maxQueue: 1,
    handlerTimeoutMs: 50,
    handlers: {
      async onAgentEvent() {
        resolveActive();
        await new Promise(() => {});
      },
    },
  });
  const { port } = await host.listen();
  try {
    const first = post(port, rpcCases.validAgentEventRequest);
    await active;
    const rejected = await post(port, {
      ...rpcCases.validAgentEventRequest,
      requestId: "queue-full",
      event: { ...rpcCases.validAgentEventRequest.event, agentId: "queue-full" },
    });
    assert.equal(rejected.status, 429);
    assert.equal(rejected.body.diagnostics[0].code, "queue_full");
    const firstResult = await first;
    assert.equal(firstResult.body.diagnostics[0].code, "handler_timeout");
  } finally {
    await host.close();
  }
});
