/**
 * Trace classification emits bounded aggregates only — never raw call arrays —
 * and uses per-episode adjacency.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyTrace } from "../eval-lib/trace-classify.mjs";

async function fixtureLog(rows) {
  const root = await mkdtemp(join(tmpdir(), "retrieval-eval-trace-"));
  await mkdir(join(root, ".pi", "agent"), { recursive: true });
  await writeFile(
    join(root, ".pi", "agent", "retrieval-attribution.jsonl"),
    rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf8",
  );
  return root;
}

test("aggregates only: no calls array, no queries/patterns/paths in output", async () => {
  const root = await fixtureLog([
    { kind: "session_toolset", ts: "2026-08-27T00:00:00Z", toolsetHash: "h" },
    {
      kind: "retrieval_tool_call",
      ts: "2026-08-27T00:00:01Z",
      sessionId: "s1",
      runId: "run-1",
      tool: "grep",
      retrieval: { pattern: "/Users/haoli/outside/secret.ts", patternKind: "exact" },
      promptHash: "ph",
    },
    {
      kind: "retrieval_tool_call",
      ts: "2026-08-27T00:00:02Z",
      sessionId: "s1",
      runId: "run-1",
      tool: "read",
    },
    { kind: "tool_result", ts: "2026-08-27T00:00:03Z", result: { ok: true, degraded: true, hitCount: 3 } },
  ]);
  const t = await classifyTrace(root);
  assert.equal(t.available, true);
  const serialized = JSON.stringify(t);
  for (const forbidden of ["/Users/haoli/outside/secret.ts", "secret.ts", "promptHash", '"pattern"', "toolCallId"]) {
    assert.ok(!serialized.includes(forbidden), `output must not contain ${forbidden}`);
  }
  assert.equal(t.callsByTool.grep, 1);
  assert.equal(t.callsByTool.read, 1);
  assert.equal(t.turns, 1);
  assert.equal(t.toolResults.degraded, 1);
  assert.equal(t.episodes, 1);
  // "calls" key must not exist at all.
  assert.equal("calls" in t, false);
});

test("stale-gold... interleaved episodes count pairs within episodes only", async () => {
  const root = await fixtureLog([
    { kind: "retrieval_tool_call", ts: "1", sessionId: "A", runId: "ra", tool: "bash" },
    { kind: "retrieval_tool_call", ts: "2", sessionId: "B", runId: "rb", tool: "grep" },
    { kind: "retrieval_tool_call", ts: "3", sessionId: "A", runId: "ra", tool: "bash" },
  ]);
  const t = await classifyTrace(root);
  assert.deepEqual(t.adjacencyTop, [{ pair: "bash->bash", count: 1 }]);
  assert.equal(t.crossEpisodePairsAGlobalSortWouldHaveAdded, 2);
});

test("missing log ⇒ available:false with reason (no throw)", async () => {
  const root = await fixtureLog([]);
  const t = await classifyTrace(join(root, "elsewhere"));
  assert.equal(t.available, false);
});
