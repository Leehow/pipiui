/**
 * Extensible, JSON-serializable model capability contract.
 *
 * Models declare hosted tools and non-tool request features by name. Downstream
 * request/tool assembly must key off these declarations — never provider ids.
 *
 * Backward compatible: existing catalogs that only set `nativeSearch` still
 * parse. Generic PipiUI `web_search` is hidden only when the selected model
 * effectively has native `web_search`, not merely `x_search` or
 * `code_interpreter`. Domain policy applies to native `web_search` only.
 */

export const HOSTED_TOOL_NAMES = ["web_search", "x_search", "code_interpreter"] as const;
export type HostedToolName = (typeof HOSTED_TOOL_NAMES)[number];

export const NATIVE_SEARCH_TOOL_NAMES = ["web_search", "x_search"] as const;
export type NativeSearchToolName = (typeof NATIVE_SEARCH_TOOL_NAMES)[number];

export const MODEL_CAPABILITY_KEYS = [
  "hostedTools.web_search",
  "hostedTools.x_search",
  "hostedTools.code_interpreter",
  "structuredOutputs",
  "inputFiles",
] as const;
export type ModelCapabilityKey = (typeof MODEL_CAPABILITY_KEYS)[number];

const HOSTED_TOOL_SET = new Set<string>(HOSTED_TOOL_NAMES);
const NATIVE_SEARCH_TOOL_SET = new Set<string>(NATIVE_SEARCH_TOOL_NAMES);
const MODEL_CAPABILITY_KEY_SET = new Set<string>(MODEL_CAPABILITY_KEYS);

export type NativeSearchDomainPolicy = {
  /** Hostnames native `web_search` may visit. Absent/empty = unrestricted. */
  allow?: readonly string[];
  /** Hostnames native `web_search` must skip. */
  deny?: readonly string[];
};

export type NativeSearchCapability = {
  tools: readonly NativeSearchToolName[];
  /** Applies to native `web_search` only. Ignored when that tool is not declared. */
  domains?: NativeSearchDomainPolicy;
};

export type HostedToolsCapability = {
  tools: readonly HostedToolName[];
  /** Applies to hosted `web_search` only. Ignored when that tool is not declared. */
  domains?: NativeSearchDomainPolicy;
};

/** `true` = supported; object may name sub-features. Absent/false = not declared. */
export type StructuredOutputsCapability = true | {
  jsonSchema?: boolean;
  strict?: boolean;
};

/** `true` = supported; object may name sub-features. Absent/false = not declared. */
export type InputFilesCapability = true | {
  upload?: boolean;
  citations?: boolean;
};

/** Normalized model capability bag. Unknown keys are preserved. */
export type ModelCapabilities = {
  hostedTools?: HostedToolsCapability;
  structuredOutputs?: StructuredOutputsCapability;
  inputFiles?: InputFilesCapability;
  /** Legacy search-only slice. Prefer `hostedTools`. Still accepted on the wire. */
  nativeSearch?: NativeSearchCapability;
  [key: string]: unknown;
};

export type ModelCapabilitiesParseResult =
  | { ok: true; capabilities?: ModelCapabilities }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDomainList(
  value: unknown,
  label: string,
): { ok: true; list?: string[] } | { ok: false; error: string } {
  if (value === undefined) return { ok: true };
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim())) {
    return { ok: false, error: `${label} must be an array of non-empty strings` };
  }
  const list = [...new Set(value.map((item) => String(item).trim()))];
  return list.length ? { ok: true, list } : { ok: true };
}

function parseNamedTools<T extends string>(
  value: unknown,
  label: string,
  allowed: ReadonlySet<string>,
  allowedText: string,
): { ok: true; tools: T[] } | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, error: `${label} must be a non-empty array` };
  }
  const tools: T[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !allowed.has(item)) {
      return { ok: false, error: `${label} entries must be ${allowedText}` };
    }
    if (seen.has(item)) continue;
    seen.add(item);
    tools.push(item as T);
  }
  return { ok: true, tools };
}

function parseDomains(
  value: unknown,
  label: string,
): { ok: true; domains?: NativeSearchDomainPolicy } | { ok: false; error: string } {
  if (value === undefined) return { ok: true };
  if (!isRecord(value)) return { ok: false, error: `${label} must be an object` };
  const allow = parseDomainList(value.allow, `${label}.allow`);
  if (!allow.ok) return allow;
  const deny = parseDomainList(value.deny, `${label}.deny`);
  if (!deny.ok) return deny;
  if (!allow.list && !deny.list) return { ok: true };
  return {
    ok: true,
    domains: {
      ...(allow.list ? { allow: allow.list } : {}),
      ...(deny.list ? { deny: deny.list } : {}),
    },
  };
}

function parseToolBag<T extends string>(
  value: unknown,
  label: string,
  allowed: ReadonlySet<string>,
  allowedText: string,
): { ok: true; bag: { tools: T[]; domains?: NativeSearchDomainPolicy } } | { ok: false; error: string } {
  if (Array.isArray(value)) {
    const tools = parseNamedTools<T>(value, label, allowed, allowedText);
    if (!tools.ok) return tools;
    return { ok: true, bag: { tools: tools.tools } };
  }
  if (!isRecord(value)) {
    return { ok: false, error: `${label} must be an object or array of tool names` };
  }
  const tools = parseNamedTools<T>(value.tools, `${label}.tools`, allowed, allowedText);
  if (!tools.ok) return tools;
  const domains = parseDomains(value.domains, `${label}.domains`);
  if (!domains.ok) return domains;
  return {
    ok: true,
    bag: {
      tools: tools.tools,
      ...(domains.domains && tools.tools.includes("web_search" as T)
        ? { domains: domains.domains }
        : {}),
    },
  };
}

function parseFlagObject(
  value: unknown,
  label: string,
  keys: readonly string[],
): { ok: true; value?: true | Record<string, boolean> } | { ok: false; error: string } {
  if (value === undefined || value === false) return { ok: true };
  if (value === true) return { ok: true, value: true };
  if (!isRecord(value)) return { ok: false, error: `${label} must be a boolean or object` };
  const next: Record<string, boolean> = {};
  for (const key of keys) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== "boolean") {
      return { ok: false, error: `${label}.${key} must be a boolean` };
    }
    next[key] = value[key];
  }
  return { ok: true, value: next };
}

function isSearchTool(name: string): name is NativeSearchToolName {
  return NATIVE_SEARCH_TOOL_SET.has(name);
}

function searchSlice(
  tools: readonly string[],
  domains?: NativeSearchDomainPolicy,
): NativeSearchCapability | undefined {
  const search = tools.filter(isSearchTool);
  if (!search.length) return undefined;
  const unique = [...new Set(search)];
  return {
    tools: unique,
    ...(domains && unique.includes("web_search") ? { domains } : {}),
  };
}

/** Strict parse used by extension manifest / provider contribution validation. */
export function parseModelCapabilities(
  value: unknown,
  label = "capabilities",
): ModelCapabilitiesParseResult {
  if (value === undefined) return { ok: true };
  if (!isRecord(value)) return { ok: false, error: `${label} must be an object` };
  const capabilities: ModelCapabilities = { ...value };

  if (value.nativeSearch !== undefined) {
    const parsed = parseToolBag<NativeSearchToolName>(
      value.nativeSearch,
      `${label}.nativeSearch`,
      NATIVE_SEARCH_TOOL_SET,
      "web_search or x_search",
    );
    if (!parsed.ok) return parsed;
    capabilities.nativeSearch = parsed.bag;
  } else {
    delete capabilities.nativeSearch;
  }

  if (value.hostedTools !== undefined) {
    const parsed = parseToolBag<HostedToolName>(
      value.hostedTools,
      `${label}.hostedTools`,
      HOSTED_TOOL_SET,
      "web_search, x_search, or code_interpreter",
    );
    if (!parsed.ok) return parsed;
    capabilities.hostedTools = parsed.bag;
  } else {
    delete capabilities.hostedTools;
  }

  if (value.structuredOutputs !== undefined) {
    const parsed = parseFlagObject(value.structuredOutputs, `${label}.structuredOutputs`, [
      "jsonSchema",
      "strict",
    ]);
    if (!parsed.ok) return parsed;
    if (parsed.value === undefined) delete capabilities.structuredOutputs;
    else capabilities.structuredOutputs = parsed.value;
  } else {
    delete capabilities.structuredOutputs;
  }

  if (value.inputFiles !== undefined) {
    const parsed = parseFlagObject(value.inputFiles, `${label}.inputFiles`, ["upload", "citations"]);
    if (!parsed.ok) return parsed;
    if (parsed.value === undefined) delete capabilities.inputFiles;
    else capabilities.inputFiles = parsed.value;
  } else {
    delete capabilities.inputFiles;
  }

  return { ok: true, capabilities };
}

/**
 * Lenient runtime normalize: invalid known fields are dropped, other keys stay.
 * Never throws — catalog hydration must not fail on a bad capability blob.
 */
export function normalizeModelCapabilities(value: unknown): ModelCapabilities | undefined {
  if (value === undefined) return undefined;
  const parsed = parseModelCapabilities(value);
  if (parsed.ok) return parsed.capabilities;
  if (!isRecord(value)) return undefined;
  const rest: ModelCapabilities = { ...value };
  delete rest.nativeSearch;
  delete rest.hostedTools;
  delete rest.structuredOutputs;
  delete rest.inputFiles;
  return Object.keys(rest).length ? rest : undefined;
}

export function hostedToolsOf(
  model: { capabilities?: ModelCapabilities } | undefined,
): HostedToolsCapability | undefined {
  const declared = model?.capabilities?.hostedTools;
  if (declared) return declared;
  const search = model?.capabilities?.nativeSearch;
  if (!search) return undefined;
  return {
    tools: [...search.tools],
    ...(search.domains ? { domains: search.domains } : {}),
  };
}

export function nativeSearchOf(
  model: { capabilities?: ModelCapabilities } | undefined,
): NativeSearchCapability | undefined {
  const declared = model?.capabilities?.nativeSearch;
  if (declared) return declared;
  const hosted = model?.capabilities?.hostedTools;
  if (!hosted) return undefined;
  return searchSlice(hosted.tools, hosted.domains);
}

export function modelHasNativeSearchTool(
  model: { capabilities?: ModelCapabilities } | undefined,
  tool: NativeSearchToolName,
): boolean {
  return nativeSearchOf(model)?.tools.includes(tool) === true;
}

export function modelHasHostedTool(
  model: { capabilities?: ModelCapabilities } | undefined,
  tool: HostedToolName,
): boolean {
  return hostedToolsOf(model)?.tools.includes(tool) === true;
}

function flagEnabled(value: unknown): boolean {
  return value === true || isRecord(value);
}

export function modelHasStructuredOutputs(
  model: { capabilities?: ModelCapabilities } | undefined,
): boolean {
  return flagEnabled(model?.capabilities?.structuredOutputs);
}

export function modelHasInputFiles(
  model: { capabilities?: ModelCapabilities } | undefined,
): boolean {
  return flagEnabled(model?.capabilities?.inputFiles);
}

/**
 * Generic PipiUI `web_search` is hidden only when the selected model declares
 * native `web_search`. A lone `x_search` or `code_interpreter` does not hide it.
 */
export function modelHidesGenericWebSearch(
  model: { capabilities?: ModelCapabilities } | undefined,
): boolean {
  return modelHasNativeSearchTool(model, "web_search");
}

/**
 * Declared `nativeSearch`, or the search slice of a declared `hostedTools` bag.
 * Never infers from provider or model ids — undeclared rows keep generic search.
 */
export function effectiveNativeSearchOf(
  model: { provider?: string; capabilities?: ModelCapabilities } | undefined,
): NativeSearchCapability | undefined {
  return nativeSearchOf(model);
}

/** Tool-list / on-wire agreement: hide generic `web_search` iff effective native web exists. */
export function effectiveModelHidesGenericWebSearch(
  model: { provider?: string; capabilities?: ModelCapabilities } | undefined,
): boolean {
  return effectiveNativeSearchOf(model)?.tools.includes("web_search") === true;
}

export const GENERIC_WEB_SEARCH_TOOL_NAME = "web_search";

/**
 * Local browser-search route registered by the built-in browser extension
 * (`pipiui-browser-search.ts`): `browser_search` + `browser_fetch`. When the
 * selected model executes search server-side (effective native `web_search`),
 * these local search surfaces are redundant and leave the tool list with the
 * generic client `web_search` — same capability predicate, never a provider
 * branch.
 */
export const BROWSER_SEARCH_TOOL_NAMES = ["browser_search", "browser_fetch"] as const;

/** Local search tools suppressed when the model has effective native `web_search`. */
export const NATIVE_SEARCH_EXCLUDED_LOCAL_TOOLS: readonly string[] = [
  GENERIC_WEB_SEARCH_TOOL_NAME,
  ...BROWSER_SEARCH_TOOL_NAMES,
];

export function extraExcludedToolsForNativeSearch(
  model: { provider?: string; capabilities?: ModelCapabilities } | undefined,
): string[] {
  return effectiveModelHidesGenericWebSearch(model) ? [...NATIVE_SEARCH_EXCLUDED_LOCAL_TOOLS] : [];
}

export function nativeSearchDomainPolicyOf(
  model: { capabilities?: ModelCapabilities } | undefined,
): NativeSearchDomainPolicy | undefined {
  if (!modelHasNativeSearchTool(model, "web_search")) return undefined;
  return nativeSearchOf(model)?.domains;
}

/** Overlay wins on shared keys; known capability fields fall back to base when overlay omits them. */
export function mergeModelCapabilities(
  base?: ModelCapabilities,
  overlay?: ModelCapabilities,
): ModelCapabilities | undefined {
  if (!base && !overlay) return undefined;
  const merged: ModelCapabilities = { ...base, ...overlay };
  for (const key of ["nativeSearch", "hostedTools", "structuredOutputs", "inputFiles"] as const) {
    const value = overlay?.[key] ?? base?.[key];
    if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
    else delete merged[key];
  }
  return Object.keys(merged).length ? merged : undefined;
}

export function isModelCapabilityKey(value: string): value is ModelCapabilityKey {
  return MODEL_CAPABILITY_KEY_SET.has(value);
}

/** True only when the bag explicitly declares the named capability. Never guesses. */
export function modelSatisfiesCapability(
  model: { capabilities?: ModelCapabilities } | undefined,
  key: string,
): boolean {
  switch (key) {
    case "hostedTools.web_search":
      return modelHasHostedTool(model, "web_search");
    case "hostedTools.x_search":
      return modelHasHostedTool(model, "x_search");
    case "hostedTools.code_interpreter":
      return modelHasHostedTool(model, "code_interpreter");
    case "structuredOutputs":
      return modelHasStructuredOutputs(model);
    case "inputFiles":
      return modelHasInputFiles(model);
    default:
      return false;
  }
}

export function declaredModelCapabilityKeys(
  model: { capabilities?: ModelCapabilities } | undefined,
): ModelCapabilityKey[] {
  return MODEL_CAPABILITY_KEYS.filter((key) => modelSatisfiesCapability(model, key));
}
