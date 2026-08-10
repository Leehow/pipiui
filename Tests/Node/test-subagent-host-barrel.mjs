import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import * as host from "../../Sources/PipiUI/PiExt/subagent-host/index.ts";

test("public barrel exposes stable v1 modules and the executable Electron-main helper", async () => {
  assert.equal(host.SUBAGENT_HOST_VERSION, 1);
  assert.equal(host.HOST_PROTOCOL_SCHEMA_VERSION, 1);
  assert.equal(host.SUBAGENT_HOST_RUNTIME_VERSION, 1);
  assert.equal(typeof host.createSubagentHostServerV1, "function");
  assert.equal(typeof host.buildSubagentEnvironmentV1, "function");
  assert.equal(typeof host.selectJobsSnapshotV1, "function");
  assert.equal(typeof host.WorktreeFinalizationServiceV1, "function");
  assert.equal(typeof host.createSubagentHostRuntimeV1, "function");
  assert.equal(typeof host.createElectronMainSubagentHostV1, "function");

  const directory = await mkdtemp(join(tmpdir(), "pipiui-host-barrel-"));
  const projections = [];
  const adapter = host.createElectronMainSubagentHostV1({
    sessionCapability: "0123456789abcdef0123456789abcdef",
    runtime: {
      persistence: {
        storage: host.createNodeFsStorageAdapterV1(),
        agentProjectionPath: join(directory, "agents.json"),
        planPath: join(directory, "plan.json"),
      },
    },
    capabilities: {
      bridge: { host: "127.0.0.1" },
      session: { id: "electron-main-test", agentDepth: 0, maxAgentDepth: 1 },
      mainCwd: "/tmp/electron-main-test",
      extensions: { subagent: "/tmp/PiExt/subagent", agentsDir: "/tmp/PiExt/agents" },
      modelFiles: {},
    },
    spawn: {
      command: process.execPath,
      args: ["--version"],
      cwd: "/tmp/electron-main-test",
      env: { ELECTRON_CALLER_VALUE: "kept", PIPIUI_BRIDGE_PORT: "must-be-overridden" },
    },
  });
  adapter.subscribe({ onJobsSnapshot: (notification) => projections.push(notification) });
  try {
    await assert.rejects(
      () => adapter.start({ host: "::1" }),
      /conflicts with capabilities\.bridge\.host/,
      "the advertised host must be the actual loopback bind",
    );
    const started = await adapter.start();
    assert.equal(started.capabilities.schemaVersion, 1);
    assert.equal(started.capabilities.bridge.sessionCapability, adapter.sessionCapability);
    assert.equal(started.capabilities.bridge.host, started.bridge.host);
    assert.equal(started.environment.PIPIUI_BRIDGE_PORT, String(started.bridge.port));
    assert.equal(started.environment.PIPIUI_HOST_PROTOCOL, "1");
    assert.equal(started.environment.PIPIUI_SESSION_CAPABILITY, adapter.sessionCapability);
    assert.equal(started.environment.PIPIUI_SESSION_KEY, adapter.sessionCapability, "legacy siblings get the same compatibility alias");
    assert.equal(started.spawn.env.PIPIUI_BRIDGE_PORT, String(started.bridge.port));
    assert.equal(started.spawn.env.PIPIUI_HOST_PROTOCOL, "1");
    assert.equal(started.spawn.env.PIPIUI_SESSION_CAPABILITY, adapter.sessionCapability);
    assert.equal(started.spawn.env.PIPIUI_SESSION_KEY, adapter.sessionCapability);
    assert.equal(started.spawn.env.ELECTRON_CALLER_VALUE, "kept");
    assert.deepEqual(started.spawn.args, ["--version"]);
    assert.ok(projections.some((entry) => entry.source === "load"));
  } finally {
    await adapter.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
