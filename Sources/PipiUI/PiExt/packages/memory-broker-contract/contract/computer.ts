import { MemoryContractError } from "./identity.ts";
import { MEMORY_LIMITS } from "./types.ts";
import type {
  ComputerMemoryDraft,
  MemoryComputerActionKind,
  MemoryComputerDurationBucket,
  MemoryComputerEvidence,
  MemoryExperienceCandidate,
  MemoryOutcome,
} from "./types.ts";

const computerActionKinds: readonly MemoryComputerActionKind[] = ["click", "type", "keyPress", "scroll", "openApplication", "focus"];
const computerDurationBuckets: readonly MemoryComputerDurationBucket[] = ["instant", "short", "medium", "long"];
const allowedDraftKeys = new Set(["claimKind", "bundleID", "appName", "errorCode", "actionKinds", "focusDrift", "durationBucket", "outcome"]);
const allowedComputerEvidenceKeys = new Set(["bundleID", "appName", "errorCode", "actionKinds", "focusDrift", "durationBucket"]);

/** Public review surface: Computer memory may serialize only this metadata. */
export const COMPUTER_MEMORY_ALLOWED_FIELDS = [
  "bundleID", "appName", "errorCode", "actionKinds", "focusDrift", "durationBucket",
  "outcome", "claim", "summary", "ttlSeconds",
] as const;

/**
 * These names are rejected from a Computer-memory candidate at every depth.
 * The resulting candidate is metadata-only, never a record of desktop content
 * or authority material.
 */
export const COMPUTER_MEMORY_FORBIDDEN_FIELDS = [
  "screenshot", "base64", "accessibility", "accessibilityTree", "ax", "axTree", "ax_tree",
  "elementToken", "element_token", "text", "typedText", "typed_text", "clipboard", "clipboardText",
  "credential", "credentials", "password", "passcode", "key", "keys", "otp", "oneTimePassword",
  "pid", "processID", "process_id", "windowID", "windowId", "window_id", "coordinate", "coordinates",
  "startCoordinate", "capability", "capabilityToken", "capability_token", "foregroundApp", "foreground",
  "focusedApplication", "windowTitle", "window_title", "focus", "target", "targetWindowIDs",
  "command", "rawCommand", "raw_command", "url", "urlQuery", "url_query", "query",
] as const;

const forbiddenNormalized = new Set(COMPUTER_MEMORY_FORBIDDEN_FIELDS.map(normalizeFieldName));
const forbiddenText = /\b(?:screenshot|base64|accessibility|ax(?:\s+(?:tree|snapshot))?|element[_\s-]?token|typed\s+text|clipboard|credentials?|password|passcode|key|keys|otp|one[-\s]?time(?:\s+password)?|private\s+key|capability(?:\s+token)?|pid|process[_\s-]?id|window[_\s-]?id|coordinates?|window\s+title|foreground\s+(?:app|window)|focused?\s+(?:app|window))\b/iu;
const sensitiveText = /\b(?:password|passwd|pwd|token|secret|api[\s_-]?key)\s*[:=]|\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b|\bgh[pousr]_[A-Za-z0-9_]{16,}\b|\bxox[baprs]-[A-Za-z0-9-]{16,}\b|\bAKIA[A-Z0-9]{16}\b|\bAIza[A-Za-z0-9_-]{30,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/iu;

const sensitiveBundleIDs = new Set([
  "com.leehow.pipiui",
  "com.apple.systempreferences",
  "com.apple.systemsettings",
  "com.apple.securityagent",
  "com.apple.authorizationhost",
  "com.apple.loginwindow",
  "com.apple.installer",
  "com.apple.terminal",
  "com.googlecode.iterm2",
  "com.mitchellh.ghostty",
  "dev.warp.warp-stable",
  "dev.warp.warp",
  "net.kovidgoyal.kitty",
  "com.github.wez.wezterm",
  "org.alacritty",
  "co.zeit.hyper",
  "com.raphaelamorim.rio",
  "org.tabby",
  "com.termius-dmg.mac",
  "com.1password.1password",
  "com.agilebits.onepassword7",
  "com.bitwarden.desktop",
  "com.lastpass.lastpass",
  "com.dashlane.dashlane",
  "com.apple.keychainaccess",
]);
const sensitiveNameFragments = [
  "pipiui", "system settings", "system preferences",
  "password", "1password", "bitwarden", "lastpass", "dashlane",
  "keychain access", "terminal", "iterm", "ghostty", "warp",
  "kitty", "wezterm", "alacritty", "hyper", "tabby", "termius",
  "authentication", "authorization", "securityagent",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeFieldName(value: string): string {
  return value.replace(/[^a-z0-9]/giu, "").toLowerCase();
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function normalizeBundleID(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") throw new MemoryContractError("invalid-request", "Computer memory bundleID is invalid.");
  const value = raw.trim();
  if (!value) return undefined;
  if (byteLength(value) > MEMORY_LIMITS.maximumApplicationBundleIDUTF8Bytes
    || !/^[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+$/.test(value)) {
    throw new MemoryContractError("invalid-request", "Computer memory bundleID is invalid.");
  }
  return value.toLowerCase();
}

function normalizeAppName(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") throw new MemoryContractError("invalid-request", "Computer memory application name is invalid.");
  const value = raw.trim().replace(/\s+/gu, " ");
  if (!value
    || byteLength(value) > MEMORY_LIMITS.maximumApplicationNameUTF8Bytes
    || /[\u0000\r\n]/u.test(value)
    || !isSafeComputerText(value)) {
    throw new MemoryContractError("invalid-request", "Computer memory application name is invalid.");
  }
  return value;
}

function normalizeErrorCode(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") throw new MemoryContractError("invalid-request", "Computer memory error code is invalid.");
  const value = raw.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{0,79}$/u.test(value)) {
    throw new MemoryContractError("invalid-request", "Computer memory error code is invalid.");
  }
  return value;
}

function isSafeComputerText(value: string): boolean {
  return !sensitiveText.test(value) && !forbiddenText.test(value);
}

function normalizeComputerClaim(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .join(" ");
}

function assertOnlyAllowedKeys(value: Record<string, unknown>, allowed: Set<string>, subject: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new MemoryContractError("invalid-request", `${subject} contains a forbidden or unsupported field: ${key}.`);
    }
  }
}

/** Rejects prohibited fields recursively instead of merely failing to serialize them. */
export function assertNoForbiddenComputerFields(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) assertNoForbiddenComputerFields(entry);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (forbiddenNormalized.has(normalizeFieldName(key))) {
      throw new MemoryContractError("invalid-request", `Computer memory contains forbidden field: ${key}.`);
    }
    assertNoForbiddenComputerFields(entry);
  }
}

export function isComputerClaimKind(value: string): value is ComputerMemoryDraft["claimKind"] {
  return value === "computer_recipe" || value === "computer_failure" || value === "computer_preference";
}

/** Strictly validate and copy a metadata-only draft; no raw Computer payload survives. */
export function sanitizeComputerMemoryDraft(raw: unknown): ComputerMemoryDraft {
  if (!isRecord(raw)) throw new MemoryContractError("invalid-request", "Computer memory draft is invalid.");
  assertNoForbiddenComputerFields(raw);
  assertOnlyAllowedKeys(raw, allowedDraftKeys, "Computer memory draft");
  if (!isComputerClaimKind(String(raw.claimKind))
    || !Array.isArray(raw.actionKinds)
    || !raw.actionKinds.every((entry) => typeof entry === "string" && computerActionKinds.includes(entry as MemoryComputerActionKind))
    || raw.actionKinds.length === 0
    || raw.actionKinds.length > MEMORY_LIMITS.maximumEvidenceItems
    || (raw.focusDrift !== undefined && typeof raw.focusDrift !== "boolean")
    || !["success", "failure", "neutral"].includes(String(raw.outcome))) {
    throw new MemoryContractError("invalid-request", "Computer memory draft is invalid.");
  }
  const actionKinds = [...new Set(raw.actionKinds as MemoryComputerActionKind[])];
  if (actionKinds.length === 0) throw new MemoryContractError("invalid-request", "Computer memory draft has no actions.");
  const bundleID = normalizeBundleID(raw.bundleID);
  const appName = normalizeAppName(raw.appName);
  const errorCode = normalizeErrorCode(raw.errorCode);
  const durationBucket = raw.durationBucket === undefined || raw.durationBucket === null
    ? undefined
    : computerDurationBuckets.includes(raw.durationBucket as MemoryComputerDurationBucket)
      ? raw.durationBucket as MemoryComputerDurationBucket
      : (() => { throw new MemoryContractError("invalid-request", "Computer memory duration bucket is invalid."); })();
  return {
    claimKind: raw.claimKind as ComputerMemoryDraft["claimKind"],
    ...(bundleID ? { bundleID } : {}),
    ...(appName ? { appName } : {}),
    ...(errorCode ? { errorCode } : {}),
    actionKinds,
    ...(typeof raw.focusDrift === "boolean" ? { focusDrift: raw.focusDrift } : {}),
    ...(durationBucket ? { durationBucket } : {}),
    outcome: raw.outcome as MemoryOutcome,
  };
}

export function isSensitiveComputerApplication(bundleID: string | undefined, appName: string | undefined): boolean {
  const bundle = bundleID?.toLowerCase() ?? "";
  const name = appName?.toLowerCase() ?? "";
  return !bundle && !name
    || sensitiveBundleIDs.has(bundle)
    || sensitiveNameFragments.some((fragment) => name.includes(fragment));
}

/**
 * Derive the sole serializable Computer candidate from a strict draft. Sensitive
 * targets and malformed drafts produce no candidate; forbidden fields reject.
 */
export function computerCandidateFromDraft(raw: unknown): MemoryExperienceCandidate | undefined {
  const draft = sanitizeComputerMemoryDraft(raw);
  const bundleID = draft.bundleID;
  const appName = draft.appName;
  if (!bundleID || !appName || isSensitiveComputerApplication(bundleID, appName)) return undefined;

  const errorCode = draft.errorCode;
  if ((draft.claimKind === "computer_recipe" || draft.claimKind === "computer_preference")
    && (draft.outcome !== "success" || errorCode !== undefined)) {
    throw new MemoryContractError("invalid-request", "Computer recipe/preference candidate is invalid.");
  }
  if (draft.claimKind === "computer_failure" && (draft.outcome !== "failure" || errorCode === undefined)) {
    throw new MemoryContractError("invalid-request", "Computer failure candidate is invalid.");
  }

  const subject = appName || bundleID;
  const actionSummary = draft.actionKinds.join(", ");
  const computer = (errorCode: string | undefined): MemoryComputerEvidence => ({
    bundleID,
    appName,
    ...(errorCode ? { errorCode } : {}),
    actionKinds: draft.actionKinds,
    ...(draft.focusDrift !== undefined ? { focusDrift: draft.focusDrift } : {}),
    ...(draft.durationBucket ? { durationBucket: draft.durationBucket } : {}),
  });
  switch (draft.claimKind) {
    case "computer_recipe":
      return {
        kind: "computer",
        claimKind: draft.claimKind,
        claim: normalizeComputerClaim(`computer recipe for ${subject}: ${actionSummary}`),
        scope: "project",
        provenance: "hypothesis",
        outcome: "success",
        evidence: [{
          summary: "completed a bounded desktop action sequence",
          computer: computer(undefined),
        }],
        sourceRuns: [],
        ttlSeconds: MEMORY_LIMITS.computerSuccessTTLSeconds,
      };
    case "computer_preference":
      return {
        kind: "computer",
        claimKind: draft.claimKind,
        claim: normalizeComputerClaim(`computer preference candidate for ${subject}`),
        scope: "project",
        provenance: "hypothesis",
        outcome: "success",
        evidence: [{
          summary: "operator selected this application for a desktop task",
          computer: computer(undefined),
        }],
        sourceRuns: [],
        ttlSeconds: MEMORY_LIMITS.computerSuccessTTLSeconds,
      };
    case "computer_failure":
      return {
        kind: "computer",
        claimKind: draft.claimKind,
        claim: normalizeComputerClaim(`computer recovery note for ${subject}: ${errorCode}`),
        scope: "session",
        provenance: "brief",
        outcome: "failure",
        evidence: [{
          summary: "a bounded desktop operation needs a fresh observation before retry",
          computer: computer(errorCode),
        }],
        sourceRuns: [],
        ttlSeconds: MEMORY_LIMITS.computerFailureTTLSeconds,
      };
  }
}

/** Validate an already-normalized generic candidate against the Computer allowlist. */
export function assertComputerCandidateContract(raw: unknown, candidate: MemoryExperienceCandidate): void {
  assertNoForbiddenComputerFields(raw);
  if (candidate.kind !== "computer"
    || !isComputerClaimKind(candidate.claimKind)
    || (candidate.claimKind === "computer_failure"
      ? candidate.provenance !== "brief"
      : candidate.provenance !== "hypothesis")
    || candidate.evidence.length !== 1
    || !candidate.evidence[0]?.computer
    || !isSafeComputerText(candidate.claim)
    || !isSafeComputerText(candidate.evidence[0].summary)) {
    throw new MemoryContractError("invalid-request", "Computer memory candidate violates the metadata-only contract.");
  }
  const computer = candidate.evidence[0].computer;
  const rawEvidence = isRecord(raw) && Array.isArray(raw.evidence) ? raw.evidence[0] : undefined;
  const rawComputer = isRecord(rawEvidence) && isRecord(rawEvidence.computer) ? rawEvidence.computer : undefined;
  // Swift validates against the original Codable field values after deriving
  // their normalized forms, so direct callers cannot smuggle case/whitespace
  // variants that a host-generated draft would never emit.
  if (!rawComputer
    || rawComputer.bundleID !== computer.bundleID
    || rawComputer.appName !== computer.appName
    || rawComputer.errorCode !== computer.errorCode
    || rawComputer.durationBucket !== computer.durationBucket) {
    throw new MemoryContractError("invalid-request", "Computer memory candidate violates the metadata-only contract.");
  }
  assertComputerEvidence(computer);
  if (!computer.bundleID || !computer.appName || isSensitiveComputerApplication(computer.bundleID, computer.appName)) {
    throw new MemoryContractError("invalid-request", "Computer memory candidate targets a sensitive or invalid application.");
  }
  if (candidate.claimKind === "computer_recipe" || candidate.claimKind === "computer_preference") {
    if (candidate.outcome !== "success" || computer.errorCode !== undefined || candidate.scope !== "project" || candidate.ttlSeconds !== MEMORY_LIMITS.computerSuccessTTLSeconds) {
      throw new MemoryContractError("invalid-request", "Computer recipe/preference candidate is invalid.");
    }
    return;
  }
  if (candidate.outcome !== "failure"
    || candidate.scope !== "session"
    || computer.errorCode === undefined
    || candidate.ttlSeconds !== MEMORY_LIMITS.computerFailureTTLSeconds) {
    throw new MemoryContractError("invalid-request", "Computer failure candidate is invalid.");
  }
}

function assertComputerEvidence(computer: MemoryComputerEvidence): void {
  const raw = computer as unknown as Record<string, unknown>;
  assertNoForbiddenComputerFields(raw);
  assertOnlyAllowedKeys(raw, allowedComputerEvidenceKeys, "Computer memory evidence");
  if (!computer.bundleID
    || !computer.appName
    || !Array.isArray(computer.actionKinds)
    || computer.actionKinds.length === 0
    || computer.actionKinds.length > MEMORY_LIMITS.maximumEvidenceItems
    || !computer.actionKinds.every((entry) => computerActionKinds.includes(entry))) {
    throw new MemoryContractError("invalid-request", "Computer memory candidate violates the metadata-only contract.");
  }
  if (computer.errorCode !== undefined && !/^[a-z][a-z0-9_]{0,79}$/u.test(computer.errorCode)) {
    throw new MemoryContractError("invalid-request", "Computer memory candidate violates the metadata-only contract.");
  }
  if (computer.durationBucket !== undefined && !computerDurationBuckets.includes(computer.durationBucket)) {
    throw new MemoryContractError("invalid-request", "Computer memory candidate violates the metadata-only contract.");
  }
}
