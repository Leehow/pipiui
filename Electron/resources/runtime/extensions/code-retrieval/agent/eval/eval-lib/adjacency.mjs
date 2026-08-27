/**
 * Per-episode adjacency over retrieval attribution rows (review remediation).
 *
 * The old classifier timestamp-sorted ALL calls into one global sequence and
 * counted adjacent pairs across run/session boundaries, contaminating
 * bash→bash, read→read and indexed-conversion counts with neighbors that were
 * never in the same episode.
 *
 * Episode identity here: (sessionId, runId). Calls are grouped first; pair
 * counting happens strictly inside each group. The number of cross-episode
 * adjacencies a naive global sort WOULD have produced is reported separately
 * so old numbers can be reconciled honestly.
 */

export function episodeKey(record) {
  const sid = typeof record?.sessionId === "string" && record.sessionId ? record.sessionId : "(main)";
  const rid = typeof record?.runId === "string" && record.runId ? record.runId : "(no-run)";
  return `${sid}\u0000${rid}`;
}

function sortKey(a, b) {
  return String(a.ts ?? "").localeCompare(String(b.ts ?? ""));
}

/**
 * @param {Array<{tool:string, ts?:string, sessionId?:string, runId?:string}>} calls
 */
export function adjacencyPerEpisode(calls) {
  const groups = new Map();
  for (const c of calls) {
    if (!c || typeof c.tool !== "string" || !c.tool) continue;
    const key = episodeKey(c);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }

  const pairCounts = new Map();
  let episodesWithPairableCalls = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    episodesWithPairableCalls += 1;
    const ordered = [...group].sort(sortKey);
    for (let i = 1; i < ordered.length; i++) {
      const pair = `${ordered[i - 1].tool}->${ordered[i].tool}`;
      pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
    }
  }

  // Diagnostic only: how many pairs the old global-sort bug would have added.
  const globalOrdered = [...calls]
    .filter((c) => c && typeof c.tool === "string" && c.tool)
    .sort(sortKey);
  let crossEpisodePairs = 0;
  for (let i = 1; i < globalOrdered.length; i++) {
    if (episodeKey(globalOrdered[i - 1]) !== episodeKey(globalOrdered[i])) crossEpisodePairs += 1;
  }

  return {
    episodes: groups.size,
    episodesWithPairableCalls,
    crossEpisodePairsAGlobalSortWouldHaveAdded: crossEpisodePairs,
    pairCounts,
  };
}

export function topPairs(pairCounts, n = 8) {
  return [...pairCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([pair, count]) => ({ pair, count }));
}
