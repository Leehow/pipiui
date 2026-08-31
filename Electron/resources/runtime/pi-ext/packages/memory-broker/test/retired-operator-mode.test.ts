import assert from "node:assert/strict";
import test from "node:test";

import { memoryBrokerClientEnvironment } from "../src/client.ts";
import { memoryBrokerMode } from "../src/extension.ts";

const legacyOperatorEnvironment = {
  PIPIUI_MEMORY_BROKER_MODE: "operator",
  PIPIUI_AGENT_ROLE: "operator",
  PIPIUI_MEMORY_BROKER_URL: "http://127.0.0.1:43210/v1/memory",
  PIPIUI_MEMORY_BROKER_TOKEN: "t".repeat(43),
  PIPIUI_MEMORY_BROKER_CAPABILITY: "c".repeat(32),
  PIPIUI_AGENT_ID: "retired-operator",
  PIPIUI_AGENT_RUN_ID: "legacy-run",
  PIPIUI_MEMORY_PROJECT_ROOT: "/repo",
};

test("a legacy operator environment cannot reactivate the retired privileged client", () => {
  assert.equal(memoryBrokerMode(legacyOperatorEnvironment), "worker");
  assert.equal(memoryBrokerClientEnvironment(legacyOperatorEnvironment), undefined);
});

test("the current worker environment remains a bounded child client", () => {
  const worker = {
    ...legacyOperatorEnvironment,
    PIPIUI_MEMORY_BROKER_MODE: "worker",
    PIPIUI_AGENT_ROLE: "worker",
  };
  assert.equal(memoryBrokerMode(worker), "worker");
  assert.deepEqual(memoryBrokerClientEnvironment(worker), {
    mode: "worker",
    url: worker.PIPIUI_MEMORY_BROKER_URL,
    token: worker.PIPIUI_MEMORY_BROKER_TOKEN,
    capability: worker.PIPIUI_MEMORY_BROKER_CAPABILITY,
    agentID: worker.PIPIUI_AGENT_ID,
    runID: worker.PIPIUI_AGENT_RUN_ID,
    projectRoot: worker.PIPIUI_MEMORY_PROJECT_ROOT,
  });
});
