/**
 * Adjacency must be computed per episode/run, never across globally
 * interleaved attribution rows.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { adjacencyPerEpisode, topPairs, episodeKey } from "../eval-lib/adjacency.mjs";

test("interleaved episodes produce zero cross-run pairs", () => {
  // Two episodes alternating by timestamp — the old global sort counted
  // read->grep/read->read transitions BETWEEN them.
  const calls = [
    { tool: "bash", ts: "2026-08-27T00:00:01Z", sessionId: "sA", runId: "rA" },
    { tool: "read", ts: "2026-08-27T00:00:02Z", sessionId: "sB", runId: "rB" },
    { tool: "bash", ts: "2026-08-27T00:00:03Z", sessionId: "sA", runId: "rA" },
    { tool: "read", ts: "2026-08-27T00:00:04Z", sessionId: "sB", runId: "rB" },
    { tool: "bash", ts: "2026-08-27T00:00:05Z", sessionId: "sA", runId: "rA" },
  ];
  const res = adjacencyPerEpisode(calls);
  assert.equal(res.episodes, 2);
  assert.equal(res.pairCounts.get("bash->bash"), 2); // within sA/rA only
  assert.equal(res.pairCounts.get("read->read"), 1); // within sB/rB only
  assert.equal(res.crossEpisodePairsAGlobalSortWouldHaveAdded, 4);
});

test("main-session rows without runId form their own episode per sessionId", () => {
  const calls = [
    { tool: "grep", ts: "1", sessionId: "main", runId: "" },
    { tool: "read", ts: "2", sessionId: "main", runId: "" },
  ];
  const res = adjacencyPerEpisode(calls);
  assert.equal(episodeKey(calls[0]), episodeKey(calls[1]));
  assert.equal(res.pairCounts.get("grep->read"), 1);
});

test("empty runId vs missing fields do not collapse distinct sessions", () => {
  const a = { tool: "grep", ts: "1", sessionId: "x" };
  const b = { tool: "grep", ts: "2", sessionId: "y", runId: "rr" };
  assert.notEqual(episodeKey(a), episodeKey(b));
});

test("indexed conversion pairs are per-episode only", () => {
  const calls = [
    { tool: "code_search", ts: "1", sessionId: "w", runId: "impl" },
    { tool: "bash", ts: "2", sessionId: "other", runId: "other-run" }, // interleaved noise
    { tool: "read_spans", ts: "3", sessionId: "w", runId: "impl" },
  ];
  const res = adjacencyPerEpisode(calls);
  assert.equal(res.pairCounts.get("code_search->read_spans"), 1);
});

test("topPairs sorts descending and caps length", () => {
  const res = adjacencyPerEpisode([
    { tool: "x", ts: "1", sessionId: "s", runId: "r" },
    { tool: "x", ts: "2", sessionId: "s", runId: "r" },
    { tool: "x", ts: "3", sessionId: "s", runId: "r" },
    { tool: "y", ts: "4", sessionId: "s", runId: "r" },
  ]);
  const top = topPairs(res.pairCounts, 1);
  assert.equal(top.length, 1);
  assert.equal(top[0].pair, "x->x");
  assert.equal(top[0].count, 2);
});

test("malformed rows are ignored", () => {
  const res = adjacencyPerEpisode([{ tool: "" }, null, { tool: "read", ts: "9", sessionId: "s", runId: "r" }]);
  assert.equal(res.episodes, 1);
});
