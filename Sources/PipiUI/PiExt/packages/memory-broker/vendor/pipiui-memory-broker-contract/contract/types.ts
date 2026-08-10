/**
 * Versioned wire contract shared by native and future Node/Electron hosts.
 * This module deliberately contains no Pi or PipiUI UI imports.
 */

export const MEMORY_PROTOCOL_VERSION = 1 as const;

export const MEMORY_LIMITS = {
  defaultQueryBudget: 400,
  maximumQueryBudget: 1_200,
  maximumQueryTextUTF8Bytes: 1_024,
  maximumQueryResults: 8,
  maximumApplicationQueryBudget: 240,
  maximumApplicationBundleIDUTF8Bytes: 255,
  maximumApplicationNameUTF8Bytes: 128,
  maximumResultClaimUTF8Bytes: 900,
  maximumClaimUTF8Bytes: 1_800,
  maximumEvidenceItems: 4,
  maximumEvidenceUTF8Bytes: 1_200,
  maximumSourceRuns: 32,
  minimumCandidateTTLSeconds: 30,
  maximumCandidateTTLSeconds: 7 * 24 * 60 * 60,
  computerSuccessTTLSeconds: 900,
  computerFailureTTLSeconds: 300,
} as const;

export type MemoryRole = "main" | "worker" | "operator";
export type MemoryDesktopGrant = "user-requested" | "ui-verify";
export type MemoryCapability = "query" | "submitExperience" | "durableWrite" | "promote";
export type MemoryOperation = "memory.query" | "experience.submit" | "memory.status";
export type MemoryScope = "project" | "session";
export type MemoryExperienceKind = "experience" | "computer";
export type MemoryClaimKind =
  | "task"
  | "outcome"
  | "verification"
  | "failure"
  | "observation"
  | "computer_recipe"
  | "computer_failure"
  | "computer_preference";
export type MemoryProvenance = "observation" | "outcome" | "brief" | "hypothesis";
export type MemoryOutcome = "success" | "failure" | "neutral";
export type MemoryComputerActionKind = "click" | "type" | "keyPress" | "scroll" | "openApplication" | "focus";
export type MemoryComputerDurationBucket = "instant" | "short" | "medium" | "long";

export interface MemoryComputerEvidence {
  bundleID?: string;
  appName?: string;
  errorCode?: string;
  actionKinds: MemoryComputerActionKind[];
  focusDrift?: boolean;
  durationBucket?: MemoryComputerDurationBucket;
}

export interface MemoryEvidence {
  summary: string;
  computer?: MemoryComputerEvidence;
}

export interface MemoryExperienceCandidate {
  kind: MemoryExperienceKind;
  claimKind: MemoryClaimKind;
  claim: string;
  scope: MemoryScope;
  provenance: MemoryProvenance;
  outcome: MemoryOutcome;
  evidence: MemoryEvidence[];
  sourceRuns: string[];
  ttlSeconds?: number;
}

export interface MemoryQuery {
  text: string;
  budget: number;
  scope: MemoryScope;
  bundleID?: string;
  appName?: string;
}

export interface MemoryBrokerRequest {
  version: typeof MEMORY_PROTOCOL_VERSION;
  operation: MemoryOperation;
  query?: MemoryQuery;
  candidate?: MemoryExperienceCandidate;
  promote?: boolean;
}

export interface MemoryQueryResult {
  claim: string;
  score: number;
}

export interface MemoryBrokerStatus {
  ready: boolean;
  detail?: string;
}

export interface MemoryBrokerResponse {
  version: typeof MEMORY_PROTOCOL_VERSION;
  operation: MemoryOperation;
  results?: MemoryQueryResult[];
  acceptedDedupeKey?: string;
  duplicate?: boolean;
  status?: MemoryBrokerStatus;
}

/**
 * Only a host constructs this context from its authenticated session/dispatch
 * state. It is never decoded from a memory request.
 */
export interface MemoryActorContext {
  projectRoot: string;
  chatSessionID: string;
  bridgeRoutingKey: string;
  agentID: string;
  runID: string;
  role: MemoryRole;
  /** Host-issued dispatch state; memory payloads never carry this field. */
  desktopGrant?: MemoryDesktopGrant;
}

export interface MemoryActorContextInput {
  projectRoot: string;
  chatSessionID: string;
  bridgeRoutingKey: string;
  agentID: string;
  runID: string;
  role: MemoryRole;
  /**
   * Trusted host dispatch input only. Memory request decoding rejects this
   * field, so a request cannot create a desktop grant.
   */
  hostIssuedDesktopGrant?: MemoryDesktopGrant;
  worktreeCWD?: string;
}

export interface MemoryWorkerGrantInput {
  capability: string;
  agentID: string;
  runID: string;
  role?: "worker" | "operator";
  /** Existing host dispatch state; this registry never mints grants. */
  hostIssuedDesktopGrant?: MemoryDesktopGrant;
}

export interface ComputerMemoryDraft {
  claimKind: "computer_recipe" | "computer_failure" | "computer_preference";
  bundleID?: string;
  appName?: string;
  errorCode?: string;
  actionKinds: MemoryComputerActionKind[];
  focusDrift?: boolean;
  durationBucket?: MemoryComputerDurationBucket;
  outcome: MemoryOutcome;
}

export interface CandidateAdmission {
  key: string;
  candidate: MemoryExperienceCandidate;
  duplicate: boolean;
  durable: boolean;
  expiresAt?: number;
}
