import type { UnassignedHit } from "./types.js";

export type RecallSource = { queryIndex: number; provider?: string; degraded: boolean; hitCount: number; failed?: boolean };
export type RecallBatch = { hits: UnassignedHit[]; provider?: string; degraded: boolean; failed?: boolean };

export function resultLimit(topK?: number): number {
  return Number.isFinite(topK) ? Math.max(1, Math.min(100, Math.floor(topK!))) : 20;
}

export function queryVariants(query: string, value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 3 || value.some((v) => typeof v !== "string" || !v.trim() || v.length > 512)) {
    throw new Error("queryVariants requires at most three non-empty strings (maximum 512 characters each).");
  }
  return [...new Set(value.map((v: string) => v.trim()))].filter((v) => v !== query);
}

/** At most two in-flight local queries; completion order never changes rank fusion. */
export async function recallQueries<T>(queries: string[], run: (query: string, index: number) => Promise<T>, signal?: AbortSignal): Promise<T[]> {
  const results: T[] = new Array(queries.length);
  let next = 0;
  const worker = async () => {
    while (next < queries.length) {
      signal?.throwIfAborted();
      const index = next++;
      results[index] = await run(queries[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, queries.length) }, worker));
  signal?.throwIfAborted();
  return results;
}

/** Keep one original hit/score. RRF is an internal fusion weight, never a replacement score. */
export function fuseRecall(batches: RecallBatch[], limit: number, protect: (hit: UnassignedHit) => boolean = () => false): { hits: UnassignedHit[]; sources: RecallSource[] } {
  const records = new Map<string, { hit: UnassignedHit; weight: number; primaryRank: number }>();
  for (const [queryIndex, batch] of batches.entries()) {
    const seen = new Set<string>();
    for (const [rank, hit] of batch.hits.entries()) {
      const key = `${hit.path}\0${hit.startLine}\0${hit.endLine}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const record = records.get(key);
      if (record) {
        record.weight += 1 / (60 + rank + 1);
        record.hit.queryIndices!.push(queryIndex);
      } else records.set(key, { hit: { ...hit, queryIndices: [queryIndex] }, weight: 1 / (60 + rank + 1), primaryRank: queryIndex === 0 ? rank : Infinity });
    }
  }
  const ranked = [...records.values()].sort((a, b) => b.weight - a.weight || a.primaryRank - b.primaryRank
    || a.hit.path.localeCompare(b.hit.path) || a.hit.startLine - b.hit.startLine || a.hit.endLine - b.hit.endLine).map((record) => record.hit);
  const hits = [...ranked.filter(protect), ...ranked.filter((hit) => !protect(hit))].slice(0, limit);
  const sources = batches.map((batch, queryIndex) => ({ queryIndex, ...(batch.provider ? { provider: batch.provider } : {}),
    degraded: batch.degraded, hitCount: batch.hits.length, ...(batch.failed ? { failed: true } : {}) }));
  return { hits, sources };
}
