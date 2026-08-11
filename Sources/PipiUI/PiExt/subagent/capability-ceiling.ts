import { Buffer } from "node:buffer";
import { types as nodeTypes } from "node:util";

export const SUBAGENT_CAPABILITY_CEILING_V1_MAX_ENCODED_BYTES = 32_768;

const MAX_AUTHORITY_ENTRIES = 256;
const MAX_AUTHORITY_ENTRY_BYTES = 128;
const MAX_PROVENANCE_ENTRIES = 8;
const MAX_PROVENANCE_ENTRY_BYTES = 128;
const TRANSPORT_PREFIX = "scv1.";
const MAX_JSON_BYTES_PER_PROVENANCE_ENTRY = (2 * MAX_PROVENANCE_ENTRY_BYTES) + 2;
const MAX_PROVENANCE_JSON_ADDITION_BYTES = 1 // comma before the property
  + Buffer.byteLength(JSON.stringify("provenance"), "utf8")
  + 1 // colon
  + 1 // opening array bracket
  + (MAX_PROVENANCE_ENTRIES * MAX_JSON_BYTES_PER_PROVENANCE_ENTRY)
  + (MAX_PROVENANCE_ENTRIES - 1) // array commas
  + 1; // closing array bracket
const KEYS = new Set([
  "version",
  "allowedTools",
  "allowedAgents",
  "denyExtensions",
  "provenance",
]);

export interface SubagentCapabilityCeilingV1 {
  readonly version: 1;
  readonly allowedTools?: readonly string[];
  readonly allowedAgents?: readonly string[];
  readonly denyExtensions: boolean;
  /** Diagnostic labels only. They never participate in authority decisions. */
  readonly provenance?: readonly string[];
}

function fail(message: string): never {
  throw new TypeError(`Invalid SubagentCapabilityCeilingV1: ${message}`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  if (nodeTypes.isProxy(value)) return false;
  try {
    const prototype = Reflect.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function normalizeStringSet(
  value: unknown,
  field: string,
  maxEntries: number,
  maxEntryBytes: number,
  rejectControlCharacters: boolean,
): readonly string[] {
  if (typeof value !== "object" || value === null || nodeTypes.isProxy(value)) {
    fail(`${field} must be an ordinary array`);
  }
  if (!Array.isArray(value)) fail(`${field} must be an ordinary array`);
  let prototype: object | null;
  let keys: readonly PropertyKey[];
  try {
    prototype = Reflect.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    fail(`${field} cannot be inspected`);
  }
  if (prototype !== Array.prototype) fail(`${field} must use Array.prototype`);

  const descriptors = new Map<string, PropertyDescriptor>();
  for (const key of keys) {
    if (typeof key !== "string") fail(`${field} must not contain symbol keys`);
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    } catch {
      fail(`${field}.${key} cannot be inspected`);
    }
    if (descriptor === undefined || !("value" in descriptor)) {
      fail(`${field}.${key} must be a data property`);
    }
    descriptors.set(key, descriptor);
  }

  const lengthDescriptor = descriptors.get("length");
  const length = lengthDescriptor?.value;
  if (lengthDescriptor === undefined
    || lengthDescriptor.enumerable !== false
    || lengthDescriptor.configurable !== false
    || typeof length !== "number"
    || !Number.isSafeInteger(length)
    || length < 0) {
    fail(`${field}.length must be the canonical array length property`);
  }
  if (length > maxEntries) fail(`${field} exceeds ${maxEntries} entries`);
  if (descriptors.size !== length + 1) fail(`${field} must be dense and contain no extra keys`);

  const entries: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors.get(String(index));
    if (descriptor === undefined || descriptor.enumerable !== true) {
      fail(`${field} must contain dense enumerable index data properties`);
    }
    entries.push(descriptor.value as string);
  }

  const normalized = entries.map((entry, index) => {
    if (typeof entry !== "string") fail(`${field}[${index}] must be a string`);
    if (entry.length === 0 || entry.trim().length === 0 || entry !== entry.trim()) {
      fail(`${field}[${index}] must be non-blank and have no surrounding whitespace`);
    }
    if (Buffer.byteLength(entry, "utf8") > maxEntryBytes) {
      fail(`${field}[${index}] exceeds ${maxEntryBytes} UTF-8 bytes`);
    }
    if (rejectControlCharacters && /\p{Cc}/u.test(entry)) {
      fail(`${field}[${index}] contains a control character`);
    }
    return entry;
  });
  return Object.freeze([...new Set(normalized)].sort());
}

function freezeCeiling(value: {
  allowedTools?: readonly string[];
  allowedAgents?: readonly string[];
  denyExtensions: boolean;
  provenance?: readonly string[];
}): SubagentCapabilityCeilingV1 {
  const result: {
    version: 1;
    allowedTools?: readonly string[];
    allowedAgents?: readonly string[];
    denyExtensions: boolean;
    provenance?: readonly string[];
  } = { version: 1, denyExtensions: value.denyExtensions };
  if (value.allowedTools !== undefined) result.allowedTools = value.allowedTools;
  if (value.allowedAgents !== undefined) result.allowedAgents = value.allowedAgents;
  if (value.provenance !== undefined) result.provenance = value.provenance;
  return Object.freeze(result);
}

function canonicalJSON(value: SubagentCapabilityCeilingV1): string {
  const transport: Record<string, unknown> = { version: 1 };
  if (value.allowedTools !== undefined) transport.allowedTools = value.allowedTools;
  if (value.allowedAgents !== undefined) transport.allowedAgents = value.allowedAgents;
  transport.denyExtensions = value.denyExtensions;
  if (value.provenance !== undefined) transport.provenance = value.provenance;
  return JSON.stringify(transport);
}

function encodedTransport(value: SubagentCapabilityCeilingV1): string {
  return `${TRANSPORT_PREFIX}${Buffer.from(canonicalJSON(value), "utf8").toString("base64url")}`;
}

function base64urlUnpaddedLength(byteLength: number): number {
  const completeTriples = Math.floor(byteLength / 3);
  const remainder = byteLength % 3;
  return (completeTriples * 4) + (remainder === 0 ? 0 : remainder + 1);
}

function ensureTransportClosure(value: SubagentCapabilityCeilingV1): void {
  const authorityOnly = freezeCeiling({
    allowedTools: value.allowedTools,
    allowedAgents: value.allowedAgents,
    denyExtensions: value.denyExtensions,
  });
  const authorityJSONBytes = Buffer.byteLength(canonicalJSON(authorityOnly), "utf8");
  const maximumJSONBytes = authorityJSONBytes + MAX_PROVENANCE_JSON_ADDITION_BYTES;
  const maximumEncodedBytes = Buffer.byteLength(TRANSPORT_PREFIX, "utf8")
    + base64urlUnpaddedLength(maximumJSONBytes);
  if (maximumEncodedBytes > SUBAGENT_CAPABILITY_CEILING_V1_MAX_ENCODED_BYTES) {
    fail(`authority cannot fit the ${SUBAGENT_CAPABILITY_CEILING_V1_MAX_ENCODED_BYTES}-byte transport with bounded provenance`);
  }
}

export function parseSubagentCapabilityCeilingV1(
  value: unknown,
): SubagentCapabilityCeilingV1 {
  if (!isPlainRecord(value)) fail("expected an object");
  const data: Record<string, unknown> = Object.create(null);
  let ownKeys: readonly PropertyKey[];
  try {
    ownKeys = Reflect.ownKeys(value);
  } catch {
    fail("cannot inspect object keys");
  }
  for (const key of ownKeys) {
    if (typeof key !== "string") fail("symbol keys are not allowed");
    if (!KEYS.has(key)) fail(`unknown key ${JSON.stringify(key)}`);
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    } catch {
      fail(`cannot inspect property ${JSON.stringify(key)}`);
    }
    if (descriptor === undefined
      || descriptor.enumerable !== true
      || !("value" in descriptor)) {
      fail(`${JSON.stringify(key)} must be an enumerable data property`);
    }
    data[key] = descriptor.value;
  }
  if (data.version !== 1) fail("version must be 1");
  if (typeof data.denyExtensions !== "boolean") fail("denyExtensions must be a boolean");

  const normalized = freezeCeiling({
    allowedTools: data.allowedTools === undefined
      ? undefined
      : normalizeStringSet(data.allowedTools, "allowedTools", MAX_AUTHORITY_ENTRIES, MAX_AUTHORITY_ENTRY_BYTES, true),
    allowedAgents: data.allowedAgents === undefined
      ? undefined
      : normalizeStringSet(data.allowedAgents, "allowedAgents", MAX_AUTHORITY_ENTRIES, MAX_AUTHORITY_ENTRY_BYTES, true),
    denyExtensions: data.denyExtensions,
    provenance: data.provenance === undefined
      ? undefined
      : normalizeStringSet(data.provenance, "provenance", MAX_PROVENANCE_ENTRIES, MAX_PROVENANCE_ENTRY_BYTES, true),
  });
  ensureTransportClosure(normalized);
  return normalized;
}

function intersectOptionalSets(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): readonly string[] | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  const rightSet = new Set(right);
  return Object.freeze(left.filter((entry) => rightSet.has(entry)));
}

function mergeProvenance(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): readonly string[] | undefined {
  const merged = [...new Set([...(left ?? []), ...(right ?? [])])]
    .sort()
    .slice(0, MAX_PROVENANCE_ENTRIES);
  return merged.length === 0 ? undefined : Object.freeze(merged);
}

export function intersectSubagentCapabilityCeilingsV1(
  leftValue: unknown,
  rightValue: unknown,
): SubagentCapabilityCeilingV1 {
  const left = parseSubagentCapabilityCeilingV1(leftValue);
  const right = parseSubagentCapabilityCeilingV1(rightValue);
  return freezeCeiling({
    allowedTools: intersectOptionalSets(left.allowedTools, right.allowedTools),
    allowedAgents: intersectOptionalSets(left.allowedAgents, right.allowedAgents),
    denyExtensions: left.denyExtensions || right.denyExtensions,
    provenance: mergeProvenance(left.provenance, right.provenance),
  });
}

function setIsAtMost(
  candidate: readonly string[] | undefined,
  ceiling: readonly string[] | undefined,
): boolean {
  if (ceiling === undefined) return true;
  if (candidate === undefined) return false;
  const ceilingSet = new Set(ceiling);
  return candidate.every((entry) => ceilingSet.has(entry));
}

export function isSubagentCapabilityAuthorityAtMostV1(
  candidateValue: unknown,
  ceilingValue: unknown,
): boolean {
  const candidate = parseSubagentCapabilityCeilingV1(candidateValue);
  const ceiling = parseSubagentCapabilityCeilingV1(ceilingValue);
  return setIsAtMost(candidate.allowedTools, ceiling.allowedTools)
    && setIsAtMost(candidate.allowedAgents, ceiling.allowedAgents)
    && (!ceiling.denyExtensions || candidate.denyExtensions);
}

export function equivalentSubagentCapabilityAuthorityV1(
  left: unknown,
  right: unknown,
): boolean {
  return isSubagentCapabilityAuthorityAtMostV1(left, right)
    && isSubagentCapabilityAuthorityAtMostV1(right, left);
}

export function encodeSubagentCapabilityCeilingV1(value: unknown): string {
  const normalized = parseSubagentCapabilityCeilingV1(value);
  return encodedTransport(normalized);
}

export function decodeSubagentCapabilityCeilingV1(encoded: unknown): SubagentCapabilityCeilingV1 {
  if (typeof encoded !== "string") fail("encoded payload must be a string");
  if (Buffer.byteLength(encoded, "utf8") > SUBAGENT_CAPABILITY_CEILING_V1_MAX_ENCODED_BYTES) {
    fail(`encoded payload exceeds ${SUBAGENT_CAPABILITY_CEILING_V1_MAX_ENCODED_BYTES} bytes`);
  }
  if (!encoded.startsWith(TRANSPORT_PREFIX)) fail(`encoded payload must start with ${TRANSPORT_PREFIX}`);
  const body = encoded.slice(TRANSPORT_PREFIX.length);
  if (body.length === 0 || !/^[A-Za-z0-9_-]+$/u.test(body)) fail("encoded payload is not canonical base64url");

  let parsed: unknown;
  try {
    const bytes = Buffer.from(body, "base64url");
    if (bytes.toString("base64url") !== body) fail("encoded payload is not canonical base64url");
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith("Invalid SubagentCapabilityCeilingV1:")) throw error;
    fail("encoded payload does not contain valid JSON");
  }

  const normalized = parseSubagentCapabilityCeilingV1(parsed);
  if (encodeSubagentCapabilityCeilingV1(normalized) !== encoded) {
    fail("encoded payload is not canonical SubagentCapabilityCeilingV1 data");
  }
  return normalized;
}
