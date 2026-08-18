import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSummary } from "@pipi/host-api";
import type { HostBridge } from "../src/bridge.js";
import { createPiHostBackend } from "../src/index.js";

let root = "";
let backend: ReturnType<typeof createPiHostBackend> | undefined;

afterEach(async () => {
  await backend?.close();
  backend = undefined;
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

async function reporter(target: ReturnType<typeof createPiHostBackend>, sessionId: string) {
  const bridge = (target as unknown as { bridge: HostBridge }).bridge;
  const port = await bridge.listen();
  const sessionCapability = bridge.register(sessionId);
  return async (event: Record<string, unknown>) => {
    const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, sessionCapability, action: "agent_event", event }),
    });
    expect(response.status).toBe(200);
  };
}

it("preserves every run of one agent as durable, independently queryable history", async () => {
  root = await mkdtemp(join(tmpdir(), "pipi-agent-run-history-"));
  const options = { agentDir: join(root, "agent"), sessionsRoot: join(root, "sessions") };
  backend = createPiHostBackend(options);
  const report = await reporter(backend, "session-1");

  await report({ kind: "start", agentId: "operator-1", runId: "run-old", name: "operator", task: "first attempt", createdAt: 100 });
  await report({ kind: "log_delta", agentId: "operator-1", runId: "run-old", itemType: "text", text: "old evidence", contentIndex: 0 });
  await report({ kind: "end", agentId: "operator-1", runId: "run-old", name: "operator", ok: false, output: "old failure", at: "2026-08-16T15:00:00.000Z" });
  await report({ kind: "start", agentId: "operator-1", runId: "run-new", name: "operator", task: "second attempt", createdAt: 200 });
  await report({ kind: "log_delta", agentId: "operator-1", runId: "run-new", itemType: "text", text: "new evidence", contentIndex: 0 });
  await expect(backend.handle("checkAgent", ["operator-1"])).resolves.toMatchObject({ runId: "run-new", state: "running" });
  await report({ kind: "end", agentId: "operator-1", runId: "run-new", name: "operator", ok: true, output: JSON.stringify({ outcome: "completed" }), at: "2026-08-16T15:01:00.000Z" });
  await report({ kind: "update", agentId: "operator-1", runId: "run-old", output: "late old update", activity: "stale" });

  const liveRows = await backend.handle("listAgents", ["session-1", "history"]) as AgentSummary[];
  expect(liveRows).toHaveLength(2);
  expect(liveRows.find(row => row.runId === "run-old")).toMatchObject({ state: "failed", finalResult: "old failure" });
  expect(liveRows.find(row => row.runId === "run-new")).toMatchObject({ state: "ok", task: "second attempt" });

  await backend.close();
  backend = createPiHostBackend(options);

  const restartedRows = await backend.handle("listAgents", ["session-1", "history"]) as AgentSummary[];
  expect(restartedRows.map(row => row.runId)).toEqual(["run-old", "run-new"]);
  await expect(backend.handle("getAgentLogs", ["operator-1", "session-1", "run-old"])).resolves.toMatchObject([{ text: "old evidence" }]);
  await expect(backend.handle("getAgentLogs", ["operator-1", "session-1", "run-new"])).resolves.toMatchObject([{ text: "new evidence" }]);
  await expect(backend.handle("getAgentLogs", ["operator-1", "session-1", "run-new", "agent"])).resolves.toMatchObject([
    { text: "old evidence" },
    { text: "new evidence" },
  ]);
  await expect(backend.handle("checkAgent", ["operator-1"])).resolves.toMatchObject({ runId: "run-new" });
});
