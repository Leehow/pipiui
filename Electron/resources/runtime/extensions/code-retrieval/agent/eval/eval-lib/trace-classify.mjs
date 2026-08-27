/**
 * Bounded aggregation of `.pi/agent/retrieval-attribution.jsonl`.
 *
 * Privacy / boundedness contract (shared decision: telemetry stores bounded
 * project-relative metadata only):
 * - Reads the log but NEVER returns raw call records. Queries, patterns,
 *   paths, toolCallIds, promptHashes and layer ids stay on disk.
 * - Everything emitted is counts, rates, or per-episode adjacency pairs.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { adjacencyPerEpisode, topPairs } from "./adjacency.mjs";

export async function classifyTrace(projectRoot, sinceIso) {
  const file = join(projectRoot, ".pi", "agent", "retrieval-attribution.jsonl");
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return { available: false, reason: `no attribution log at ${join(".pi", "agent", "retrieval-attribution.jsonl")}` };
  }
  const since = sinceIso ? Date.parse(sinceIso) : NaN;
  const calls = [];
  let totalRecords = 0;
  let toolResults = { ok: 0, error: 0, degraded: 0, withHits: 0 };
  let turns = 0;

  for (const line of text.split("\n")) {
    if (!line) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue; // malformed lines are skipped, never exported
    }
    totalRecords += 1;
    if (!Number.isNaN(since) && typeof r.ts === "string" && Date.parse(r.ts) < since) continue;
    if (r.kind === "retrieval_tool_call" && typeof r.tool === "string") {
      calls.push({ tool: r.tool, ts: r.ts, sessionId: r.sessionId, runId: r.runId });
    } else if (r.kind === "tool_result") {
      const s = r.result ?? {};
      if (s.ok === false) toolResults.error += 1;
      else toolResults.ok += 1;
      if (s.degraded === true) toolResults.degraded += 1;
      if (typeof s.hitCount === "number" && s.hitCount > 0) toolResults.withHits += 1;
    } else if (r.kind === "session_toolset") {
      turns += 1;
    }
  }

  const callsByTool = {};
  for (const c of calls) callsByTool[c.tool] = (callsByTool[c.tool] ?? 0) + 1;

  const adj = adjacencyPerEpisode(calls);
  const csTotal = callsByTool.code_search ?? 0;
  const csToSpans = adj.pairCounts.get("code_search->read_spans") ?? 0;

  return {
    available: true,
    window: { since: sinceIso ?? "all-time", totalRecords },
    turns,
    totalCalls: calls.length,
    episodes: adj.episodes,
    episodesWithPairableCalls: adj.episodesWithPairableCalls,
    crossEpisodePairsAGlobalSortWouldHaveAdded: adj.crossEpisodePairsAGlobalSortWouldHaveAdded,
    callsByTool,
    indexedConversion:
      csTotal > 0
        ? { code_search: csTotal, immediatelyFollowedByReadSpans: csToSpans }
        : null,
    adjacencyTop: topPairs(adj.pairCounts, 8),
    toolResults,
    // No raw call array is ever attached to this object.
  };
}
