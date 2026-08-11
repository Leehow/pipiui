import type { MemoryEvidence, MemoryProvenance } from "./types.ts";

/** Versioned host-neutral durable learning catalog. `global` is intentionally absent. */
export const MEMORY_RECORD_V2_VERSION = 2 as const;
export type MemoryRecordKind = "semantic" | "episodic" | "procedural";
export type MemoryRecordScope = "project" | "app";
export type MemoryRecordStatus = "candidate" | "active" | "superseded" | "stale" | "rejected" | "deleted";

export interface MemoryRecordV2Scope {
  kind: MemoryRecordScope;
  /** Canonical project identity, required for every record including app scope. */
  project: string;
  /** Required only for app scope; normally a canonical bundle identifier. */
  app?: string;
}

export interface MemoryRecordV2Evidence extends MemoryEvidence {
  sourceRun?: string;
  observedAt?: number;
}

export interface MemoryRecordV2Provenance {
  source: string;
  reason?: string;
  provenance?: MemoryProvenance;
  importedFrom?: string;
}

export interface MemoryRecordUsageStats { reads: number; helpful: number; lastUsedAt?: number; }

export interface MemoryRecordV2 {
  version: typeof MEMORY_RECORD_V2_VERSION;
  id: string;
  kind: MemoryRecordKind;
  claim: string;
  summary: string;
  applicability?: string;
  scope: MemoryRecordV2Scope;
  evidence: MemoryRecordV2Evidence[];
  provenance: MemoryRecordV2Provenance[];
  confidence: number;
  firstSeenAt: number;
  lastSeenAt: number;
  lastVerifiedAt?: number;
  expiresAt?: number;
  status: MemoryRecordStatus;
  supersedes?: string[];
  supersededBy?: string;
  contentHash: string;
  hermesID?: string;
  /** Durable transaction marker: still candidate until Hermes verification succeeds. */
  pendingPromotion?: boolean;
  usage: MemoryRecordUsageStats;
  sourceRuns: string[];
}

/** Every append-only event emitted by MemoryCatalog; consumers must preserve these values during replay. */
export type MemoryLifecycleEventType = "upsert" | "status" | "merge" | "supersede" | "promotion-pending" | "hermes-mapped" | "usage";
export interface MemoryLifecycleEvent {
  version: typeof MEMORY_RECORD_V2_VERSION;
  sequence: number;
  at: number;
  type: MemoryLifecycleEventType;
  record: MemoryRecordV2;
}
export interface MemoryCatalogSnapshot {
  version: typeof MEMORY_RECORD_V2_VERSION;
  sequence: number;
  records: MemoryRecordV2[];
}

export interface MemoryRecordDraft {
  kind: MemoryRecordKind;
  claim: string;
  summary?: string;
  applicability?: string;
  scope: MemoryRecordV2Scope;
  evidence?: MemoryRecordV2Evidence[];
  provenance?: MemoryRecordV2Provenance[];
  confidence?: number;
  expiresAt?: number;
  sourceRuns?: string[];
}
