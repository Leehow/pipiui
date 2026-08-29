/**
 * Versioned Host Capability API — the single narrow channel an extension uses to
 * reach native host capabilities (browser session/view lifecycle, CUA driver).
 *
 * Every call travels as one `HostCapabilityRequestV1` envelope and answers with
 * one `HostCapabilityResponseV1` envelope. The host re-negotiates the manifest
 * `hostApi` range, re-checks the per-project permission grant, and consumes a
 * one-time capability token before any driver runs, so the envelope alone never
 * carries authority.
 *
 * Wire version and deny codes are a closed first-version set: additive growth
 * only, and never a silent re-shape (tests pin the exact envelope keys).
 */

/** Schema version of every host-capability envelope. */
export const HOST_CAPABILITY_WIRE_VERSION = 1 as const;

/**
 * Transport mirror of the manifest permission enum (pi-backend
 * `extension-manifest.ts` `EXTENSION_PERMISSIONS`). A test pins the two lists
 * together so they cannot drift.
 */
export const HOST_CAPABILITY_PERMISSIONS = ["net.request", "browser.session", "native.exec", "memory.read"] as const;
export type HostCapabilityPermission = (typeof HOST_CAPABILITY_PERMISSIONS)[number];

/** Closed first-version deny codes. Logical denies ride HTTP 200. */
export type HostCapabilityDenyCode =
  | "unsupported_wire"
  | "host_api_mismatch"
  | "permission_denied"
  | "unknown_capability"
  | "token_required"
  | "token_invalid"
  | "token_expired"
  | "token_consumed"
  | "host_unavailable"
  | "driver_error";

export type HostCapabilityHandshakeOkV1 = {
  schemaVersion: typeof HOST_CAPABILITY_WIRE_VERSION;
  ok: true;
  hostApiVersion: string;
  wireVersion: typeof HOST_CAPABILITY_WIRE_VERSION;
};
export type HostCapabilityHandshakeDenyV1 = {
  schemaVersion: typeof HOST_CAPABILITY_WIRE_VERSION;
  ok: false;
  code: "host_api_mismatch";
  hostApiVersion: string;
};
export type HostCapabilityHandshakeV1 = HostCapabilityHandshakeOkV1 | HostCapabilityHandshakeDenyV1;

/** One gated call from an extension into a native host capability. */
export type HostCapabilityRequestV1 = {
  schemaVersion: typeof HOST_CAPABILITY_WIRE_VERSION;
  /** Calling extension id. */
  extensionId: string;
  /** Semver range the extension loads against; re-checked on every call. */
  hostApi: string;
  permission: HostCapabilityPermission;
  /** Project root whose grant file must allow `permission` for `extensionId`. */
  projectRoot: string;
  /** One-time capability token minted by the host. Consumed on success. */
  token: string;
  op: "browser.action" | "browser.watch" | "browser.disposeSession" | "native.cua";
  params: Record<string, unknown>;
};

export type HostCapabilityDenyV1 = {
  schemaVersion: typeof HOST_CAPABILITY_WIRE_VERSION;
  ok: false;
  code: HostCapabilityDenyCode;
  error: string;
  hostApiVersion: string;
};
export type HostCapabilityResultV1 = {
  schemaVersion: typeof HOST_CAPABILITY_WIRE_VERSION;
  ok: true;
  result: Record<string, unknown>;
  hostApiVersion: string;
};
export type HostCapabilityResponseV1 = HostCapabilityResultV1 | HostCapabilityDenyV1;

/**
 * Token mint request (loopback `host_capability_token` action). Deliberately
 * carries no `hostApi`: the range is re-negotiated on every gated dispatch, so
 * mint only has to prove the permission gates.
 */
export type HostCapabilityMintRequestV1 = {
  extensionId: string;
  permission: HostCapabilityPermission;
  projectRoot: string;
};
export type HostCapabilityMintOkV1 = {
  schemaVersion: typeof HOST_CAPABILITY_WIRE_VERSION;
  ok: true;
  /** One-time; consumed by the first gated dispatch that redeems it. */
  token: string;
  /** Absolute host-clock expiry (ms epoch). */
  expiresAt: number;
  hostApiVersion: string;
};
export type HostCapabilityMintResponseV1 = HostCapabilityMintOkV1 | HostCapabilityDenyV1;

/** Strict `X.Y.Z` (no wildcards, no prerelease — the host version is a plain triple). */
export type SemVer = { major: number; minor: number; patch: number };

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;
/** Same comparator grammar as manifest `hostApi`: `>= > <= < = ^ ~` or bare exact. */
const COMPARATOR_RE = /^(>=|<=|>|<|=|\^|~)?(\d+)\.(\d+)\.(\d+)$/;

export function parseSemVer(value: string): SemVer | undefined {
  const match = SEMVER_RE.exec(value.trim());
  if (!match) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function compareSemVer(a: SemVer, b: SemVer): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function comparatorSatisfied(version: SemVer, comparator: string): boolean {
  const match = COMPARATOR_RE.exec(comparator);
  if (!match) return false;
  const op = match[1] ?? "=";
  const bound: SemVer = { major: Number(match[2]), minor: Number(match[3]), patch: Number(match[4]) };
  const cmp = compareSemVer(version, bound);
  switch (op) {
    case ">=":
      return cmp >= 0;
    case ">":
      return cmp > 0;
    case "<=":
      return cmp <= 0;
    case "<":
      return cmp < 0;
    case "=":
      return cmp === 0;
    case "^":
      return cmp >= 0 && version.major === bound.major;
    case "~":
      return cmp >= 0 && version.major === bound.major && version.minor === bound.minor;
  }
  return false;
}

/**
 * AND-satisfied simple semver range (space/comma-separated comparators; the
 * first-version contract has no `||` or wildcards). Anything unparsable —
 * including an empty range — is unsatisfied, so a malformed range fails closed.
 */
export function hostApiRangeSatisfies(range: string, version: string): boolean {
  const parsed = parseSemVer(version);
  if (!parsed) return false;
  const parts = range.trim().split(/[\s,]+/).filter(Boolean);
  if (!parts.length) return false;
  return parts.every((part) => comparatorSatisfied(parsed, part));
}

/** Handshake: does the extension's declared range load against this host? */
export function negotiateHostApiVersion(input: {
  hostVersion: string;
  requestedRange: string;
}): HostCapabilityHandshakeV1 {
  if (hostApiRangeSatisfies(input.requestedRange, input.hostVersion)) {
    return {
      schemaVersion: HOST_CAPABILITY_WIRE_VERSION,
      ok: true,
      hostApiVersion: input.hostVersion,
      wireVersion: HOST_CAPABILITY_WIRE_VERSION,
    };
  }
  return { schemaVersion: HOST_CAPABILITY_WIRE_VERSION, ok: false, code: "host_api_mismatch", hostApiVersion: input.hostVersion };
}
