import { createHash } from "node:crypto";
import { MemoryContractError, canonicalMainProjectRoot, hasComputerMemoryGrant, validIdentifier } from "./identity.ts";
import type {
  CandidateAdmission,
  MemoryActorContext,
  MemoryBrokerRequest,
  MemoryCapability,
  MemoryClaimKind,
  MemoryComputerActionKind,
  MemoryComputerDurationBucket,
  MemoryComputerEvidence,
  MemoryEvidence,
  MemoryExperienceCandidate,
  MemoryExperienceKind,
  MemoryOperation,
  MemoryOutcome,
  MemoryProvenance,
  MemoryQuery,
  MemoryQueryResult,
  MemoryScope,
} from "./types.ts";
import { MEMORY_LIMITS, MEMORY_PROTOCOL_VERSION } from "./types.ts";
import { assertComputerCandidateContract, isComputerClaimKind, isSensitiveComputerApplication } from "./computer.ts";

const memoryCapabilities: readonly MemoryCapability[] = ["query", "submitExperience", "durableWrite", "promote"];
const operations: readonly MemoryOperation[] = ["memory.query", "experience.submit", "memory.status"];
const scopes: readonly MemoryScope[] = ["project", "session"];
const experienceKinds: readonly MemoryExperienceKind[] = ["experience", "computer"];
const claimKinds: readonly MemoryClaimKind[] = [
  "task", "outcome", "verification", "failure", "observation",
  "computer_recipe", "computer_failure", "computer_preference",
];
const provenances: readonly MemoryProvenance[] = ["observation", "outcome", "brief", "hypothesis"];
const outcomes: readonly MemoryOutcome[] = ["success", "failure", "neutral"];
const actionKinds: readonly MemoryComputerActionKind[] = ["click", "type", "keyPress", "scroll", "openApplication", "focus"];
const durationBuckets: readonly MemoryComputerDurationBucket[] = ["instant", "short", "medium", "long"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function utf8Length(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== "string") throw new MemoryContractError("invalid-request", message);
  return value;
}

function requireInteger(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new MemoryContractError("invalid-request", message);
  }
  return value;
}

/** `main` has the full policy surface; workers and operators only query/submit candidates. */
export function roleAllows(capability: MemoryCapability, role: MemoryActorContext["role"]): boolean {
  if (!memoryCapabilities.includes(capability)) return false;
  return role === "main" || capability === "query" || capability === "submitExperience";
}

export function authorizeCapability(capability: MemoryCapability, context: MemoryActorContext): void {
  if (!roleAllows(capability, context.role)) {
    throw new MemoryContractError("denied", `Memory capability denied: ${capability}.`);
  }
  // Current operator behavior is intentionally stricter than its role ACL:
  // only an existing desktop-granted operator has any broker surface.
  if (context.role === "operator" && !hasComputerMemoryGrant(context)) {
    throw new MemoryContractError("computer-memory-grant-required", "Computer memory requires the current operator's explicit desktop grant.");
  }
}

export function normalizeBundleID(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const value = requireString(raw, "Invalid memory application bundleID.").trim();
  if (!value) return undefined;
  if (utf8Length(value) > MEMORY_LIMITS.maximumApplicationBundleIDUTF8Bytes
    || !/^[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+$/.test(value)) {
    throw new MemoryContractError("invalid-request", "Invalid memory application bundleID.");
  }
  return value.toLowerCase();
}

export function normalizeAppName(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const value = requireString(raw, "Invalid memory application name.")
    .trim()
    .replace(/\s+/gu, " ");
  if (!value) return undefined;
  if (utf8Length(value) > MEMORY_LIMITS.maximumApplicationNameUTF8Bytes || /[\u0000\r\n]/u.test(value)) {
    throw new MemoryContractError("invalid-request", "Invalid memory application name.");
  }
  return value;
}

export function normalizeQuery(raw: unknown): MemoryQuery {
  if (!isRecord(raw)) throw new MemoryContractError("invalid-request", "Missing memory query.");
  const text = requireString(raw.text, "Invalid memory query text.").trim();
  if (!text || utf8Length(text) > MEMORY_LIMITS.maximumQueryTextUTF8Bytes) {
    throw new MemoryContractError("invalid-request", "Invalid memory query text.");
  }
  const budget = requireInteger(raw.budget, "Memory query budget must be positive.");
  if (budget <= 0) throw new MemoryContractError("invalid-request", "Memory query budget must be positive.");
  if (!isOneOf(raw.scope, scopes)) throw new MemoryContractError("invalid-request", "Invalid memory query scope.");
  const bundleID = normalizeBundleID(raw.bundleID);
  const appName = normalizeAppName(raw.appName);
  const applicationScoped = bundleID !== undefined || appName !== undefined;
  return {
    text,
    budget: Math.min(
      budget,
      applicationScoped ? MEMORY_LIMITS.maximumApplicationQueryBudget : MEMORY_LIMITS.maximumQueryBudget,
    ),
    scope: raw.scope,
    ...(bundleID ? { bundleID } : {}),
    ...(appName ? { appName } : {}),
  };
}

export function isSensitiveApplicationForMemory(bundleID: string | undefined, appName: string | undefined): boolean {
  return isSensitiveComputerApplication(bundleID, appName);
}

/** App scope only narrows recall; it cannot confer desktop authorization. */
export function authorizeQuery(context: MemoryActorContext, query: MemoryQuery): void {
  authorizeCapability("query", context);
  if (query.bundleID || query.appName) {
    if (!hasComputerMemoryGrant(context)) {
      throw new MemoryContractError("computer-memory-grant-required", "Computer memory requires the current operator's explicit desktop grant.");
    }
    if (isSensitiveApplicationForMemory(query.bundleID, query.appName)) {
      throw new MemoryContractError("invalid-request", "Memory recall is unavailable for this sensitive application.");
    }
  }
}

function normalizeClaim(raw: unknown): string {
  const value = requireString(raw, "Memory claim is empty.")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .join(" ");
  if (!value) throw new MemoryContractError("invalid-request", "Memory claim is empty.");
  if (utf8Length(value) > MEMORY_LIMITS.maximumClaimUTF8Bytes) {
    throw new MemoryContractError("invalid-request", "Memory claim exceeds its size limit.");
  }
  return value;
}

function normalizeComputerEvidence(raw: unknown): MemoryComputerEvidence | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw)) throw new MemoryContractError("invalid-request", "Computer memory metadata is invalid.");
  const bundleID = normalizeBundleID(raw.bundleID);
  const appName = normalizeAppName(raw.appName);
  const errorCode = raw.errorCode === undefined || raw.errorCode === null
    ? undefined
    : requireString(raw.errorCode, "Computer memory error code is invalid.").trim().toLowerCase();
  if (errorCode !== undefined && !/^[a-z][a-z0-9_]{0,79}$/iu.test(errorCode)) {
    throw new MemoryContractError("invalid-request", "Computer memory error code is invalid.");
  }
  if (!Array.isArray(raw.actionKinds) || !raw.actionKinds.every((value) => isOneOf(value, actionKinds))) {
    throw new MemoryContractError("invalid-request", "Computer memory action kinds are invalid.");
  }
  if (raw.focusDrift !== undefined && typeof raw.focusDrift !== "boolean") {
    throw new MemoryContractError("invalid-request", "Computer memory focus state is invalid.");
  }
  if (raw.durationBucket !== undefined && !isOneOf(raw.durationBucket, durationBuckets)) {
    throw new MemoryContractError("invalid-request", "Computer memory duration bucket is invalid.");
  }
  return {
    ...(bundleID ? { bundleID } : {}),
    ...(appName ? { appName } : {}),
    ...(errorCode ? { errorCode } : {}),
    actionKinds: [...raw.actionKinds],
    ...(typeof raw.focusDrift === "boolean" ? { focusDrift: raw.focusDrift } : {}),
    ...(raw.durationBucket !== undefined ? { durationBucket: raw.durationBucket } : {}),
  };
}

function normalizeEvidence(raw: unknown): MemoryEvidence[] {
  if (!Array.isArray(raw)) throw new MemoryContractError("invalid-request", "Memory evidence is invalid.");
  const evidence: MemoryEvidence[] = [];
  for (const item of raw.slice(0, MEMORY_LIMITS.maximumEvidenceItems)) {
    if (!isRecord(item) || typeof item.summary !== "string") continue;
    const summary = item.summary.trim();
    if (!summary || utf8Length(summary) > MEMORY_LIMITS.maximumEvidenceUTF8Bytes) continue;
    evidence.push({ summary, ...(item.computer !== undefined ? { computer: normalizeComputerEvidence(item.computer) } : {}) });
  }
  return evidence;
}

export function normalizeSourceRuns(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new MemoryContractError("invalid-request", "Memory source runs are invalid.");
  return [...new Set(raw.filter(validIdentifier))]
    .sort()
    .slice(0, MEMORY_LIMITS.maximumSourceRuns);
}

export function normalizeTTL(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const ttlSeconds = requireInteger(raw, "Memory candidate TTL is invalid.");
  if (ttlSeconds < MEMORY_LIMITS.minimumCandidateTTLSeconds) {
    throw new MemoryContractError("invalid-request", "Memory candidate TTL is too short.");
  }
  return Math.min(ttlSeconds, MEMORY_LIMITS.maximumCandidateTTLSeconds);
}

export function containsLikelySecret(value: string): boolean {
  const lowered = value.toLowerCase();
  return lowered.includes("-----begin") && lowered.includes("private key-----")
    || /\b(api[_-]?key|secret|password|access[_-]?token)\b\s*[:=]\s*[^\s]{8,}/iu.test(value)
    || /\b(?:sk|rk|pk)_[A-Za-z0-9_-]{16,}\b/u.test(value)
    || /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u.test(value);
}

export function containsLikelySecretCandidate(candidate: MemoryExperienceCandidate): boolean {
  return containsLikelySecret(candidate.claim) || candidate.evidence.some((entry) => containsLikelySecret(entry.summary));
}

/** Normalizes a candidate without transport, storage, Hermes, or UI dependencies. */
export function normalizeExperienceCandidate(raw: unknown): MemoryExperienceCandidate {
  if (!isRecord(raw)
    || !isOneOf(raw.kind, experienceKinds)
    || !isOneOf(raw.claimKind ?? "task", claimKinds)
    || !isOneOf(raw.scope, scopes)
    || !isOneOf(raw.provenance, provenances)
    || !isOneOf(raw.outcome, outcomes)) {
    throw new MemoryContractError("invalid-request", "Invalid memory experience candidate.");
  }
  const candidate: MemoryExperienceCandidate = {
    kind: raw.kind,
    claimKind: (raw.claimKind ?? "task") as MemoryClaimKind,
    claim: normalizeClaim(raw.claim),
    scope: raw.scope,
    provenance: raw.provenance,
    outcome: raw.outcome,
    evidence: normalizeEvidence(raw.evidence),
    sourceRuns: normalizeSourceRuns(raw.sourceRuns),
    ...(raw.ttlSeconds !== undefined ? { ttlSeconds: normalizeTTL(raw.ttlSeconds) } : {}),
  };
  if (candidate.kind === "computer") assertComputerCandidateContract(raw, candidate);
  return candidate;
}

export function experienceDedupeKey(projectRoot: string, candidate: MemoryExperienceCandidate): string {
  const canonicalRoot = canonicalMainProjectRoot(projectRoot);
  const normalized = normalizeExperienceCandidate(candidate);
  return createHash("sha256")
    .update([canonicalRoot, normalized.kind, normalized.claim].join("\u001f"), "utf8")
    .digest("hex");
}

export function candidateWithObservedRun(candidate: MemoryExperienceCandidate, runID: string): MemoryExperienceCandidate {
  if (!validIdentifier(runID)) throw new MemoryContractError("invalid-request", "Invalid memory run identity.");
  return { ...candidate, sourceRuns: normalizeSourceRuns([...candidate.sourceRuns, runID]) };
}

export function promotionIsEligible(context: MemoryActorContext, candidate: MemoryExperienceCandidate, requestedPromotion: boolean): boolean {
  if (!requestedPromotion) return false;
  authorizeCapability("durableWrite", context);
  authorizeCapability("promote", context);
  return candidate.provenance !== "brief" && candidate.provenance !== "hypothesis";
}

function earliestExpiry(lhs: number | undefined, rhs: number | undefined): number | undefined {
  if (lhs === undefined) return rhs;
  if (rhs === undefined) return lhs;
  return Math.min(lhs, rhs);
}

type RetainedCandidate = {
  candidate: MemoryExperienceCandidate;
  expiresAt?: number;
};

/**
 * Pure policy/dedupe state, not a retrieval or learning engine. A thin future
 * host can use admissions to decide whether and how to call its own backend.
 */
export class MemoryCandidateQuarantine {
  private readonly candidates = new Map<string, RetainedCandidate>();

  accept(
    context: MemoryActorContext,
    rawCandidate: unknown,
    requestedPromotion = false,
    now = Date.now(),
  ): CandidateAdmission {
    authorizeCapability("submitExperience", context);
    const candidate = normalizeExperienceCandidate(rawCandidate);
    if (candidate.kind === "computer" && !hasComputerMemoryGrant(context)) {
      throw new MemoryContractError("computer-memory-grant-required", "Computer memory requires the current operator's explicit desktop grant.");
    }
    if (containsLikelySecretCandidate(candidate)) {
      throw new MemoryContractError("invalid-request", "Experience candidate may contain a secret.");
    }
    const durable = promotionIsEligible(context, candidate, requestedPromotion);
    this.purge(now);
    const key = experienceDedupeKey(context.projectRoot, candidate);
    const expiresAt = candidate.ttlSeconds === undefined ? undefined : now + candidate.ttlSeconds * 1_000;
    const retained = this.candidates.get(key);
    if (retained) {
      const aggregate = candidateWithObservedRun({
        ...retained.candidate,
        sourceRuns: [...retained.candidate.sourceRuns, ...candidate.sourceRuns],
      }, context.runID);
      const retainedCandidate = { candidate: aggregate, expiresAt: earliestExpiry(retained.expiresAt, expiresAt) };
      this.candidates.set(key, retainedCandidate);
      return { key, candidate: aggregate, duplicate: true, durable: false, ...(retainedCandidate.expiresAt !== undefined ? { expiresAt: retainedCandidate.expiresAt } : {}) };
    }
    const accepted = candidateWithObservedRun(candidate, context.runID);
    this.candidates.set(key, { candidate: accepted, ...(expiresAt !== undefined ? { expiresAt } : {}) });
    return { key, candidate: accepted, duplicate: false, durable, ...(expiresAt !== undefined ? { expiresAt } : {}) };
  }

  candidateForDedupeKey(key: string, now = Date.now()): MemoryExperienceCandidate | undefined {
    this.purge(now);
    return this.candidates.get(key)?.candidate;
  }

  /** Roll back a newly admitted candidate when its backend write fails. */
  discard(key: string): void {
    this.candidates.delete(key);
  }

  purge(now = Date.now()): void {
    for (const [key, retained] of this.candidates) {
      if (retained.expiresAt !== undefined && retained.expiresAt <= now) this.candidates.delete(key);
    }
  }
}

/** Decodes only the versioned, authority-free memory request envelope. */
export function normalizeMemoryBrokerRequest(raw: unknown): MemoryBrokerRequest {
  if (!isRecord(raw)
    || raw.version !== MEMORY_PROTOCOL_VERSION
    || !isOneOf(raw.operation, operations)
    || raw.desktopGrant !== undefined
    || raw.capability !== undefined
    || raw.memoryBrokerCapability !== undefined
    || raw.durableWrite !== undefined) {
    throw new MemoryContractError("invalid-request", "Unsupported or unauthorized memory request.");
  }
  if (raw.promote !== undefined && typeof raw.promote !== "boolean") {
    throw new MemoryContractError("invalid-request", "Invalid memory promotion request.");
  }
  const request: MemoryBrokerRequest = {
    version: MEMORY_PROTOCOL_VERSION,
    operation: raw.operation,
    ...(raw.query !== undefined ? { query: normalizeQuery(raw.query) } : {}),
    ...(raw.candidate !== undefined ? { candidate: normalizeExperienceCandidate(raw.candidate) } : {}),
    ...(typeof raw.promote === "boolean" ? { promote: raw.promote } : {}),
  };
  if (request.operation === "memory.query" && !request.query) {
    throw new MemoryContractError("invalid-request", "Missing memory query.");
  }
  if (request.operation === "experience.submit" && !request.candidate) {
    throw new MemoryContractError("invalid-request", "Missing experience candidate.");
  }
  // Computer candidates are accepted only after the strict contract above;
  // dispatch still requires an operator desktop grant in quarantine admission.
  return request;
}

export function boundQueryResults(raw: unknown): MemoryQueryResult[] {
  if (!Array.isArray(raw)) return [];
  const results: MemoryQueryResult[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.claim !== "string") continue;
    const claim = entry.claim.trim();
    if (!claim) continue;
    results.push({
      claim: Buffer.from(claim, "utf8").subarray(0, MEMORY_LIMITS.maximumResultClaimUTF8Bytes).toString("utf8"),
      score: typeof entry.score === "number" && Number.isFinite(entry.score) ? entry.score : 0,
    });
    if (results.length >= MEMORY_LIMITS.maximumQueryResults) break;
  }
  return results;
}

export { isComputerClaimKind };
