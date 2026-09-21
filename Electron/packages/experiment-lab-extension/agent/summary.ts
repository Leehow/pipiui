import type { ExperimentRecord, ExperimentSummary, InventoryKind, InventoryPage } from "../contracts.js";
import { sha256 } from "./snapshot.js";

export const INVENTORY_KINDS: InventoryKind[] = ["files", "dirtyPaths", "removedPaths", "omittedUntracked", "excluded", "scopes", "includeUntracked"];
export const SUMMARY_MAX_BYTES = 48 * 1024;
export const INVENTORY_PAGE_BYTES = 24 * 1024;

export function inventoryItems(record: ExperimentRecord, kind: InventoryKind): unknown[] {
  if (kind === "scopes" || kind === "includeUntracked") return record[kind];
  return record.baseline?.[kind] ?? [];
}

export function inventoryPages(record: ExperimentRecord, kind: InventoryKind): InventoryPage[] {
  const items = inventoryItems(record, kind);
  const chunks: unknown[][] = [];
  let chunk: unknown[] = [];
  let bytes = 0;
  for (const item of items) {
    const size = Buffer.byteLength(JSON.stringify(item)) + 1;
    if (chunk.length && bytes + size > INVENTORY_PAGE_BYTES) { chunks.push(chunk); chunk = []; bytes = 0; }
    chunk.push(item); bytes += size;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks.map((values, i) => ({ kind, page: i + 1, pages: chunks.length, count: items.length, items: values }));
}

export function summarizeRecord(record: ExperimentRecord): ExperimentSummary {
  const inventory = Object.fromEntries(INVENTORY_KINDS.map((kind) => [kind, { count: inventoryItems(record, kind).length, pages: inventoryPages(record, kind).length }])) as ExperimentSummary["inventory"];
  const { cases: _cases, ...displayRecord } = record;
  const caseCatalog = record.cases?.map((item) => ({ id: item.id, title: item.title.slice(0, 80), titleTruncated: item.title.length > 80, fingerprint: sha256(JSON.stringify(item)), command: item.command.executable.slice(0, 80), networkDomains: item.allowedDomains.length }));
  for (let preview = 10; preview >= 0; preview = preview ? Math.floor(preview / 2) : -1) {
    const result: ExperimentSummary = {
      ...displayRecord, isSummary: true, recordDigest: sha256(JSON.stringify(record)), inventory,
      ...(caseCatalog?.length ? { caseCatalog } : {}),
      scopes: record.scopes.slice(0, preview), includeUntracked: record.includeUntracked.slice(0, preview),
      previewTruncated: INVENTORY_KINDS.some((kind) => inventory[kind].count > preview),
      ...(record.baseline ? { baseline: {
        ...record.baseline,
        files: record.baseline.files.slice(0, preview), dirtyPaths: record.baseline.dirtyPaths.slice(0, preview),
        removedPaths: record.baseline.removedPaths.slice(0, preview), omittedUntracked: record.baseline.omittedUntracked.slice(0, preview), excluded: record.baseline.excluded.slice(0, preview),
      } } : {}),
    };
    if (Buffer.byteLength(JSON.stringify(result)) <= SUMMARY_MAX_BYTES) return result;
  }
  throw new Error("experiment-summary-too-large");
}
