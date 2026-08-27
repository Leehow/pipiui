/**
 * Project-local session tool-call attribution.
 *
 * One append-only JSONL event per turn toolset, per tool call, and per observed tool
 * result (`tool_result`, correlated by `toolCallId`), written under the current
 * project's `.pi/agent` home. Best-effort and non-blocking: a logging failure must
 * never change tool execution. Does not store the full prompt or unbounded /
 * secret-bearing payloads. v2 adds bounded read targets, the runtime turn index,
 * and structured result metadata; v1 records remain readable everywhere.
 */
import { createHash } from "node:crypto";
import { promises as fs, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const RETRIEVAL_ATTRIBUTION_FILENAME = "retrieval-attribution.jsonl";
/** v2 adds read targets, turnIndex, and structured tool_result events; v1 records stay readable. */
export const RETRIEVAL_ATTRIBUTION_VERSION = 2 as const;
export const RETRIEVAL_ATTRIBUTION_V1 = 1 as const;
export const RETRIEVAL_ATTRIBUTION_KIND = "retrieval_tool_call" as const;
export const ATTRIBUTION_TURN_KIND = "session_toolset" as const;
/** Post-execution complement of a retrieval_tool_call, correlated by toolCallId. */
export const ATTRIBUTION_RESULT_KIND = "tool_result" as const;
export const RETRIEVAL_STRING_BOUND = 200;
export const RETRIEVAL_REF_BOUND = 12;
export const AVAILABLE_TOOL_BOUND = 256;
/** Read-target identifiers kept per call record; excess paths are counted, not stored. */
export const READ_PATH_BOUND = RETRIEVAL_REF_BOUND;
/** Guard against absurd offsets/limits; real files stay far below this. */
export const READ_RANGE_BOUND = 2_147_483_647;
/** Upper bound of toolCallIds tracked between tool_call and tool_result for latency. */
const PENDING_TOOLCALL_BOUND = 512;

const RETRIEVAL_TOOLS = new Set([
  "grep",
  "find",
  "code_search",
  "read_spans",
  "code_nav",
  "repo_map",
  // Bounded read *targets* (path/paths/offset/limit) only — never page content.
  "read",
]);

export const TOOL_GROUPS = {
  filesystem: ["bash", "edit", "find", "grep", "ls", "read", "write"],
  retrieval: ["code_nav", "code_search", "read_spans", "repo_map"],
  durable: ["memory_query", "memory_status", "session_recall", "skill_load", "skill_search"],
  research: [
    "arxiv_fetch",
    "browser",
    "browser_fetch",
    "browser_search",
    "fetch_content",
    "get_search_content",
    "source_check",
    "web_search",
  ],
  orchestration: [
    "subagent",
    "subagent_abort",
    "subagent_chain",
    "subagent_manage",
    "subagent_progress",
    "subagent_resolve",
    "subagent_status",
  ],
} as const;

export type ToolGroupName = keyof typeof TOOL_GROUPS;

const ALLOWED_KEYS = [
  "v",
  "kind",
  "ts",
  "sessionId",
  "runId",
  "agentId",
  "role",
  "agent",
  "model",
  "tool",
  "toolCallId",
  "promptHash",
  "layerIds",
  "availableToolIds",
  "availableToolCount",
  "toolsetHash",
  "truncated",
  "retrieval",
  "turnIndex",
  "result",
] as const;

const RETRIEVAL_ALLOWED_KEYS = [
  "pattern",
  "patternKind",
  "literal",
  "ignoreCase",
  "path",
  "glob",
  "query",
  "mode",
  "topK",
  "refs",
  "refCount",
  "operation",
  "symbol",
  "redacted",
  "truncated",
  "paths",
  "offset",
  "limit",
] as const;

const RESULT_ALLOWED_KEYS = [
  "ok",
  "resultKind",
  "degraded",
  "provider",
  "hitCount",
  "alreadyReadCount",
  "resultsPath",
  "refs",
  "durationMs",
  "redacted",
  "truncated",
] as const;

const SECRET_RE =
  /(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:bearer|api[_-]?key|password|secret|token|authorization)\s*[:=]\s*\S+)/i;

export type GrepPatternKind = "empty" | "exact" | "alternation" | "descriptive";

export type AttributionKind =
  | typeof RETRIEVAL_ATTRIBUTION_KIND
  | typeof ATTRIBUTION_TURN_KIND
  | typeof ATTRIBUTION_RESULT_KIND;

/** Serialized version: v1 rows exist historically; new rows are always v2. Both accepted on parse. */
type SchemaVersion = typeof RETRIEVAL_ATTRIBUTION_VERSION | typeof RETRIEVAL_ATTRIBUTION_V1;

export type RetrievalInput = {
  pattern?: string;
  patternKind?: GrepPatternKind;
  literal?: boolean;
  ignoreCase?: boolean;
  path?: string;
  glob?: string;
  query?: string;
  mode?: string;
  topK?: number;
  refs?: string[];
  refCount?: number;
  operation?: string;
  symbol?: string;
  redacted?: string[];
  truncated?: string[];
  /** Bounded read targets: project-relative paths and the requested window — never content. */
  paths?: string[];
  offset?: number;
  limit?: number;
};

/**
 * Bounded post-execution metadata taken only from structured runtime fields
 * (pi `tool_result.details`). No result bodies, no messages, no provider internals:
 * a field the runtime does not expose at the seam stays absent.
 */
export type AttributionResult = {
  /** False only when the runtime explicitly flagged the call as errored. */
  ok: boolean;
  resultKind?: string;
  degraded?: boolean;
  /** Executor provenance as reported by the tool itself (e.g. tantivy | rg | local grep). Absent when unexposed. */
  provider?: string;
  hitCount?: number;
  alreadyReadCount?: number;
  resultsPath?: string;
  refs?: string[];
  durationMs?: number;
  redacted?: string[];
  truncated?: string[];
};

export type RetrievalAttributionRecord = {
  v: SchemaVersion;
  kind: AttributionKind;
  ts: string;
  sessionId?: string;
  runId?: string;
  agentId?: string;
  role?: string;
  agent?: string;
  model?: string;
  tool?: string;
  toolCallId?: string;
  promptHash?: string;
  layerIds?: string[];
  availableToolIds?: string[];
  availableToolCount?: number;
  toolsetHash?: string;
  truncated?: boolean;
  retrieval?: RetrievalInput;
  /** Runtime turn index (pi `turn_start`), scoped to sessionId/runId; absent when the runtime did not expose it. */
  turnIndex?: number;
  result?: AttributionResult;
};

export type AttributionTurn = {
  promptHash?: string;
  layerIds?: string[];
  role?: string;
  agent?: string;
  model?: string;
  sessionId?: string;
  runId?: string;
  agentId?: string;
  availableTools?: unknown;
  availableToolIds?: string[];
  availableToolCount?: number;
  toolsetHash?: string;
};

export type ObserveToolCallInput = {
  toolName?: unknown;
  toolCallId?: unknown;
  input?: unknown;
  sessionId?: unknown;
  runId?: unknown;
  agentId?: unknown;
  role?: unknown;
  agent?: unknown;
  model?: unknown;
  prompt?: unknown;
  promptHash?: unknown;
  layerIds?: unknown;
  /** Runtime turn index, when the caller already holds one; else the observer's last seen index. */
  turnIndex?: unknown;
  /** Project root for making recorded paths project-relative; derived from agentDir when omitted. */
  projectRoot?: unknown;
  now?: Date;
};

export type ObserveToolResultInput = {
  toolName?: unknown;
  toolCallId?: unknown;
  isError?: unknown;
  details?: unknown;
  sessionId?: unknown;
  runId?: unknown;
  agentId?: unknown;
  role?: unknown;
  agent?: unknown;
  model?: unknown;
  turnIndex?: unknown;
  now?: Date;
};

export type RetrievalAttributionOptions = {
  agentDir: string;
  /** Root used to project-relativize read paths; defaults to the parent of `.pi/agent`. */
  projectRoot?: string;
  now?: () => Date;
  append?: (file: string, line: string) => Promise<void>;
  env?: NodeJS.ProcessEnv;
};

export function retrievalAttributionPath(agentDir: string): string {
  return join(agentDir, RETRIEVAL_ATTRIBUTION_FILENAME);
}

export function isGlobalPiHome(agentDir: string, home = homedir()): boolean {
  const globalHome = resolve(home, ".pi");
  const resolved = resolve(agentDir);
  return resolved === globalHome || resolved.startsWith(globalHome + sep);
}

/** True only for a project-local `{project}/.pi/agent` home. Refuses ~/.pi and App-profile `pi-agent`. */
export function isProjectLocalAgentHome(agentDir: string, home = homedir()): boolean {
  if (isGlobalPiHome(agentDir, home)) return false;
  const normalized = resolve(agentDir).replace(/[\\/]+$/, "");
  return normalized.endsWith(`${sep}.pi${sep}agent`);
}

export function hashPrompt(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function collectToolNames(input: unknown): string[] {
  const names = new Set<string>();
  const list = Array.isArray(input) ? input : [];
  for (const item of list) {
    if (typeof item === "string") {
      const name = item.trim();
      if (name) names.add(name);
      continue;
    }
    if (item && typeof item === "object" && typeof (item as { name?: unknown }).name === "string") {
      const name = (item as { name: string }).name.trim();
      if (name) names.add(name);
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

export type NormalizedToolset = {
  availableToolIds: string[];
  availableToolCount: number;
  toolsetHash: string;
  truncated: boolean;
};

export function normalizeAvailableTools(input: unknown): NormalizedToolset {
  const sorted = collectToolNames(input);
  const truncated = sorted.length > AVAILABLE_TOOL_BOUND;
  return {
    availableToolIds: truncated ? sorted.slice(0, AVAILABLE_TOOL_BOUND) : sorted,
    availableToolCount: sorted.length,
    toolsetHash: hashPrompt(sorted.join("\n")),
    truncated,
  };
}

export function classifyToolGroup(tool: string): ToolGroupName | "other" {
  for (const [group, names] of Object.entries(TOOL_GROUPS) as Array<[ToolGroupName, readonly string[]]>) {
    if (names.includes(tool)) return group;
  }
  if (tool.startsWith("memory_") || tool.startsWith("skill_") || tool === "session_recall") return "durable";
  if (tool.startsWith("subagent")) return "orchestration";
  if (tool.startsWith("secret_vault") || tool.includes("auth")) return "other";
  return "other";
}

export function classifyGrepPattern(
  pattern: string | undefined,
  literal?: boolean,
): GrepPatternKind {
  if (!pattern) return "empty";
  if (literal === true) return looksDescriptive(pattern) ? "descriptive" : "exact";
  if (hasUnescapedAlternation(pattern)) return "alternation";
  if (looksDescriptive(pattern) || /[.+*?^${}()[\]\\]/.test(pattern)) return "descriptive";
  return "exact";
}

function hasUnescapedAlternation(pattern: string): boolean {
  return /(^|[^\\])(\\\\)*\|/.test(pattern);
}

function looksDescriptive(pattern: string): boolean {
  return /\s/.test(pattern) || pattern.length > 40;
}

function deriveProjectRoot(agentDir: string): string {
  // `{project}/.pi/agent` → `{project}`. Non-local homes never write records anyway.
  return dirname(dirname(resolve(agentDir)));
}

const OUTSIDE_MARKER = "[outside-project]";

/** True when `full` sits on or outside `root` (empty or escaping relation) — i.e. not strictly inside. */
function leavesProject(full: string, root: string): boolean {
  const rel = relative(root, full).replace(/\\/g, "/");
  return !rel || rel.startsWith("../") || rel === ".." || isAbsolute(rel);
}

/**
 * Best-effort canonical form: realpath the target itself, or — when part of the
 * path does not exist yet — realpath the deepest existing ancestor and re-attach
 * the unresolved remainder lexically. A missing directory nested beneath a
 * symlinked ancestor is therefore still containment-checked (`link-out/`
 * → outside, `link-out/missing/deeper.ts` resolves against the outside target);
 * only a path with no existing ancestor at all returns undefined, skipping the
 * realpath pass. With no symlinks involved the output equals the input.
 */
function safeRealpath(target: string): string | undefined {
  let suffix = "";
  let dir = target;
  for (;;) {
    try {
      return join(realpathSync(dir), suffix);
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return undefined;
      suffix = join(basename(dir), suffix);
      dir = parent;
    }
  }
}

/**
 * One bounded, secret-screened, project-relative path for telemetry, used for every
 * path-bearing input (read targets, grep/find/code_search/code_nav paths, resultsPath).
 * Relative `..` escapes, absolute paths outside the project, `~/`, and paths that
 * resolve through symlinks beyond the project root (best-effort realpath) collapse
 * to OUTSIDE_MARKER: privacy forbids recording locations beyond this checkout — only
 * that the model asked outside, never where to. Safe project-relative paths survive
 * in their model-visible form, deduplicated by the caller, bounded by length/count.
 */
function normalizeTelemetryPath(
  rawValue: string,
  projectRoot: string,
  truncated: string[],
  redacted: string[],
  field: string,
): string | undefined {
  if (SECRET_RE.test(rawValue)) {
    redacted.push(field);
    return undefined;
  }
  let candidate = rawValue.trim().replace(/\\/g, "/");
  if (!candidate) return undefined;
  if (candidate.startsWith("~/") || candidate === "~") {
    redacted.push(field);
    return OUTSIDE_MARKER;
  }
  const root = resolve(projectRoot);
  const realRoot = safeRealpath(root) ?? root;
  // Absolute and relative candidates both resolve against the root; containment is
  // checked lexically first, then through best-effort realpath (symlink escapes).
  const lexicalFull = isAbsolute(candidate) ? resolve(candidate) : resolve(root, candidate);
  if (leavesProject(lexicalFull, root)) {
    redacted.push(field);
    return OUTSIDE_MARKER;
  }
  // Canonical model-visible form: project-relative, no "." or interior ".." segments.
  let recorded = relative(root, lexicalFull).replace(/\\/g, "/");
  // Symlink containment: an in-project path that really resolves past the checkout
  // is still an escape; record the marker, not the destination.
  const realFull = safeRealpath(lexicalFull);
  if (realFull && leavesProject(realFull, realRoot)) {
    redacted.push(field);
    return OUTSIDE_MARKER;
  }
  if (recorded.length > RETRIEVAL_STRING_BOUND) {
    truncated.push(field);
    recorded = recorded.slice(0, RETRIEVAL_STRING_BOUND);
  }
  return recorded;
}

/** Normalize + dedupe + bound a list of path inputs; overflow is counted, values are never logged raw. */
function boundPathList(
  candidates: readonly unknown[],
  projectRoot: string,
  truncated: string[],
  redacted: string[],
  field: string,
): string[] {
  const seen = new Set<string>();
  const bounded: string[] = [];
  let overflow = 0;
  for (const item of candidates) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (bounded.length >= READ_PATH_BOUND) {
      overflow += 1;
      continue;
    }
    const target = normalizeTelemetryPath(trimmed, projectRoot, truncated, redacted, field);
    // Deduplicate on the normalized form so "./a.ts", "a.ts" and absolute forms collapse.
    if (!target || seen.has(target)) continue;
    seen.add(target);
    bounded.push(target);
  }
  if (overflow > 0) truncated.push(field);
  return bounded;
}

/** Collect read call targets: `path` and/or `paths[]`, bounded and deduplicated in order. */
function boundReadTargets(
  raw: Record<string, unknown>,
  projectRoot: string,
  truncated: string[],
  redacted: string[],
): { paths?: string[]; offset?: number; limit?: number } {
  const candidates: unknown[] = [];
  if (typeof raw.path === "string") candidates.push(raw.path);
  if (Array.isArray(raw.paths)) candidates.push(...raw.paths);
  const bounded = boundPathList(candidates, projectRoot, truncated, redacted, "paths");
  const offset = asRangeNumber(raw.offset);
  const limit = asRangeNumber(raw.limit);
  return {
    ...(bounded.length ? { paths: bounded } : {}),
    ...(offset !== undefined ? { offset } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Non-negative safe integer within READ_RANGE_BOUND; anything else is unrecordable. */
function asRangeNumber(value: unknown): number | undefined {
  const num = asFiniteNumber(value);
  if (num === undefined || !Number.isSafeInteger(num) || num < 0 || num > READ_RANGE_BOUND) return undefined;
  return num;
}

function asTurnIndex(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function boundString(
  value: string | undefined,
  field: string,
  truncated: string[],
  redacted: string[],
): string | undefined {
  if (value === undefined) return undefined;
  if (SECRET_RE.test(value)) {
    redacted.push(field);
    return undefined;
  }
  if (value.length > RETRIEVAL_STRING_BOUND) {
    truncated.push(field);
    return value.slice(0, RETRIEVAL_STRING_BOUND);
  }
  return value;
}

export function boundRetrievalInput(
  toolName: string,
  input: unknown,
  projectRoot: string = deriveProjectRoot(process.env.PI_CODING_AGENT_DIR || process.cwd()),
): RetrievalInput | undefined {
  if (!RETRIEVAL_TOOLS.has(toolName)) return undefined;
  const raw = input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
  const redacted: string[] = [];
  const truncated: string[] = [];
  const retrieval: RetrievalInput = {};

  const pattern = boundString(asTrimmedString(raw.pattern), "pattern", truncated, redacted);
  const query = boundString(asTrimmedString(raw.query), "query", truncated, redacted);
  const glob = boundString(asTrimmedString(raw.glob), "glob", truncated, redacted);
  const symbol = boundString(asTrimmedString(raw.symbol), "symbol", truncated, redacted);
  const mode = boundString(asTrimmedString(raw.mode), "mode", truncated, redacted);
  const operation = boundString(asTrimmedString(raw.operation), "operation", truncated, redacted);
  const literal = asBoolean(raw.literal);
  const ignoreCase = asBoolean(raw.ignoreCase);
  const topK = asFiniteNumber(raw.topK);

  if (toolName === "grep" || toolName === "find") {
    if (pattern !== undefined) retrieval.pattern = pattern;
    if (toolName === "grep") {
      retrieval.patternKind = classifyGrepPattern(asTrimmedString(raw.pattern), literal);
      if (literal !== undefined) retrieval.literal = literal;
      if (ignoreCase !== undefined) retrieval.ignoreCase = ignoreCase;
    }
  }
  if (toolName === "code_search") {
    if (query !== undefined) retrieval.query = query;
    if (mode !== undefined) retrieval.mode = mode;
    if (topK !== undefined) retrieval.topK = topK;
  }
  if (toolName === "grep" || toolName === "find" || toolName === "code_search" || toolName === "code_nav") {
    const singlePath = asTrimmedString(raw.path);
    if (singlePath !== undefined) {
      const normalizedPath = normalizeTelemetryPath(singlePath, projectRoot, truncated, redacted, "path");
      if (normalizedPath !== undefined) retrieval.path = normalizedPath;
    }
  }
  if ((toolName === "grep" || toolName === "find") && Array.isArray(raw.paths)) {
    const normalizedPaths = boundPathList(raw.paths, projectRoot, truncated, redacted, "paths");
    if (normalizedPaths.length) retrieval.paths = normalizedPaths;
  }
  if (glob !== undefined && (toolName === "grep" || toolName === "code_search")) retrieval.glob = glob;
  if (toolName === "code_nav") {
    if (operation !== undefined) retrieval.operation = operation;
    if (symbol !== undefined) retrieval.symbol = symbol;
  }
  if (toolName === "read") {
    const targets = boundReadTargets(raw, projectRoot, truncated, redacted);
    if (targets.paths !== undefined) retrieval.paths = targets.paths;
    if (targets.offset !== undefined) retrieval.offset = targets.offset;
    if (targets.limit !== undefined) retrieval.limit = targets.limit;
  }
  if (toolName === "read_spans") {
    const refsRaw = Array.isArray(raw.refs) ? raw.refs.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
    retrieval.refCount = refsRaw.length;
    const sliced = refsRaw.slice(0, RETRIEVAL_REF_BOUND).map((ref) => {
      if (SECRET_RE.test(ref)) {
        redacted.push("refs");
        return "[redacted]";
      }
      if (ref.length > RETRIEVAL_STRING_BOUND) {
        truncated.push("refs");
        return ref.slice(0, RETRIEVAL_STRING_BOUND);
      }
      return ref;
    });
    if (sliced.length) retrieval.refs = sliced;
    if (refsRaw.length > RETRIEVAL_REF_BOUND) truncated.push("refs");
  }

  if (redacted.length) retrieval.redacted = [...new Set(redacted)];
  if (truncated.length) retrieval.truncated = [...new Set(truncated)];
  return retrieval;
}

export function buildAttributionRecord(
  input: ObserveToolCallInput,
  turn: AttributionTurn = {},
): RetrievalAttributionRecord | undefined {
  const tool = asTrimmedString(input.toolName);
  if (!tool) return undefined;
  const prompt = typeof input.prompt === "string" ? input.prompt : undefined;
  const promptHash =
    prompt !== undefined
      ? hashPrompt(prompt)
      : asTrimmedString(input.promptHash) ?? turn.promptHash;
  const layerIds = Array.isArray(input.layerIds)
    ? input.layerIds.filter((item): item is string => typeof item === "string")
    : turn.layerIds;
  const turnIndex = asTurnIndex(input.turnIndex);
  const record: RetrievalAttributionRecord = {
    v: RETRIEVAL_ATTRIBUTION_VERSION,
    kind: RETRIEVAL_ATTRIBUTION_KIND,
    ts: (input.now ?? new Date()).toISOString(),
    tool,
  };
  const sessionId = asTrimmedString(input.sessionId);
  const runId = asTrimmedString(input.runId);
  const agentId = asTrimmedString(input.agentId);
  const role = asTrimmedString(input.role) ?? turn.role;
  const agent = asTrimmedString(input.agent) ?? turn.agent;
  const model = asTrimmedString(input.model) ?? turn.model;
  const toolCallId = asTrimmedString(input.toolCallId);
  const toolsetHash = turn.toolsetHash;
  if (sessionId) record.sessionId = sessionId;
  if (runId) record.runId = runId;
  if (agentId) record.agentId = agentId;
  if (role) record.role = role;
  if (agent) record.agent = agent;
  if (model) record.model = model;
  if (toolCallId) record.toolCallId = toolCallId;
  if (promptHash) record.promptHash = promptHash;
  if (layerIds?.length) record.layerIds = layerIds;
  if (toolsetHash) record.toolsetHash = toolsetHash;
  if (turnIndex !== undefined) record.turnIndex = turnIndex;
  const retrieval = boundRetrievalInput(
    tool,
    input.input,
    typeof input.projectRoot === "string" && input.projectRoot.trim()
      ? resolve(input.projectRoot)
      : undefined,
  );
  if (retrieval && Object.keys(retrieval).length > 0) record.retrieval = retrieval;
  return record;
}

export function buildToolsetRecord(
  turn: AttributionTurn,
  extras: { sessionId?: unknown; runId?: unknown; agentId?: unknown; now?: Date } = {},
): RetrievalAttributionRecord {
  const toolset =
    turn.availableToolIds && turn.toolsetHash && turn.availableToolCount !== undefined
      ? {
          availableToolIds: turn.availableToolIds,
          availableToolCount: turn.availableToolCount,
          toolsetHash: turn.toolsetHash,
          truncated: turn.availableToolCount > turn.availableToolIds.length,
        }
      : normalizeAvailableTools(turn.availableTools);
  const record: RetrievalAttributionRecord = {
    v: RETRIEVAL_ATTRIBUTION_VERSION,
    kind: ATTRIBUTION_TURN_KIND,
    ts: (extras.now ?? new Date()).toISOString(),
    availableToolIds: toolset.availableToolIds,
    availableToolCount: toolset.availableToolCount,
    toolsetHash: toolset.toolsetHash,
  };
  if (toolset.truncated) record.truncated = true;
  const sessionId = asTrimmedString(extras.sessionId) ?? asTrimmedString(turn.sessionId);
  const runId = asTrimmedString(extras.runId) ?? asTrimmedString(turn.runId);
  const agentId = asTrimmedString(extras.agentId) ?? asTrimmedString(turn.agentId);
  const role = asTrimmedString(turn.role);
  const agent = asTrimmedString(turn.agent);
  const model = asTrimmedString(turn.model);
  const promptHash = asTrimmedString(turn.promptHash);
  if (sessionId) record.sessionId = sessionId;
  if (runId) record.runId = runId;
  if (agentId) record.agentId = agentId;
  if (role) record.role = role;
  if (agent) record.agent = agent;
  if (model) record.model = model;
  if (promptHash) record.promptHash = promptHash;
  if (turn.layerIds?.length) record.layerIds = turn.layerIds.filter((id): id is string => typeof id === "string");
  return record;
}

export function buildResultRecord(
  input: ObserveToolResultInput,
  extras: { sessionId?: unknown; runId?: unknown; agentId?: unknown; durationMs?: number } = {},
): RetrievalAttributionRecord | undefined {
  const tool = asTrimmedString(input.toolName);
  const toolCallId = asTrimmedString(input.toolCallId);
  if (!tool || !toolCallId) return undefined;
  const result = buildAttributionResult(input.isError, input.details);
  const durationMs = extras.durationMs;
  if (durationMs !== undefined) result.durationMs = Math.max(0, Math.round(durationMs));
  const record: RetrievalAttributionRecord = {
    v: RETRIEVAL_ATTRIBUTION_VERSION,
    kind: ATTRIBUTION_RESULT_KIND,
    ts: (input.now ?? new Date()).toISOString(),
    tool,
    toolCallId,
    result,
  };
  const sessionId = asTrimmedString(input.sessionId);
  const runId = asTrimmedString(input.runId);
  const agentId = asTrimmedString(input.agentId);
  const role = asTrimmedString(input.role);
  const agent = asTrimmedString(input.agent);
  const model = asTrimmedString(input.model);
  const turnIndex = asTurnIndex(input.turnIndex);
  if (sessionId) record.sessionId = sessionId;
  if (runId) record.runId = runId;
  if (agentId) record.agentId = agentId;
  if (role) record.role = role;
  if (agent) record.agent = agent;
  if (model) record.model = model;
  if (turnIndex !== undefined) record.turnIndex = turnIndex;
  return record;
}

export function serializeAttributionRecord(record: RetrievalAttributionRecord): string {
  const safe: Record<string, unknown> = {};
  for (const key of ALLOWED_KEYS) {
    if (key === "retrieval") {
      if (!record.retrieval || typeof record.retrieval !== "object") continue;
      const retrieval: Record<string, unknown> = {};
      for (const field of RETRIEVAL_ALLOWED_KEYS) {
        if (record.retrieval[field] !== undefined) retrieval[field] = record.retrieval[field];
      }
      if (Object.keys(retrieval).length > 0) safe.retrieval = retrieval;
      continue;
    }
    if (key === "result") {
      // Only structured AttributionResult objects pass; arbitrary values are dropped.
      if (!record.result || typeof record.result !== "object" || Array.isArray(record.result)) continue;
      const result: Record<string, unknown> = {};
      for (const field of RESULT_ALLOWED_KEYS) {
        if (record.result[field] !== undefined) result[field] = record.result[field];
      }
      if (Object.keys(result).length > 0) safe.result = result;
      continue;
    }
    if (record[key] !== undefined) safe[key] = record[key];
  }
  return JSON.stringify(safe) + "\n";
}

export type RoleToolRow = {
  role: string;
  agent: string;
  tool: string;
  count: number;
};

export type GroupAdoption = {
  group: ToolGroupName;
  available: string[];
  used: string[];
  unused: string[];
  calls: number;
  note?: string;
};

export type SliceSummary = {
  role: string;
  agent: string;
  model: string;
  toolsetHash: string;
  availableToolIds: string[];
  availableToolCount: number;
  used: string[];
  unused: string[];
  groups: GroupAdoption[];
};

export type ResultRow = {
  role: string;
  agent: string;
  tool: string;
  resultKind: string;
  outcome: "ok" | "error";
  count: number;
  degraded: number;
  hitsSum: number;
  maxHits: number;
  durationsMs: number[];
};

/** Aggregate provenance coverage for results that reported a provider; counts only, never content. */
export type ProviderRow = {
  role: string;
  agent: string;
  tool: string;
  provider: string;
  count: number;
  degraded: number;
};

export type CoverageSummary = {
  turns: number;
  calls: number;
  results: number;
  readCalls: number;
  readCallsWithTarget: number;
  indexedSearchCalls: number;
  /** Results whose structured details exposed a provider — measures ingestion, not correctness. */
  resultsWithProvider: number;
};

export type AttributionSummary = {
  rows: RoleToolRow[];
  prompts: Array<{ role: string; agent: string; promptHash: string; layerIds: string[]; count: number }>;
  slices: SliceSummary[];
  total: number;
  turns: number;
  calls: number;
  coverage: CoverageSummary;
  results: ResultRow[];
  providers: ProviderRow[];
};

const INDEXED_SEARCH_TOOLS = new Set(["code_search", "code_nav", "repo_map", "read_spans"]);

function emptyCoverage(): CoverageSummary {
  return { turns: 0, calls: 0, results: 0, readCalls: 0, readCallsWithTarget: 0, indexedSearchCalls: 0, resultsWithProvider: 0 };
}

function percentile(sortedValues: readonly number[], fraction: number): number | undefined {
  if (sortedValues.length === 0) return undefined;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(fraction * sortedValues.length) - 1));
  return sortedValues[index];
}

function identity(record: RetrievalAttributionRecord): { role: string; agent: string; model: string } {
  const role = record.role || "unknown";
  return {
    role,
    agent: record.agent || (role === "main" ? "main" : "unknown"),
    model: record.model || "unknown",
  };
}

function sliceKey(role: string, agent: string, model: string, toolsetHash = ""): string {
  return `${role}\t${agent}\t${model}\t${toolsetHash}`;
}

export function summarizeAttributionRecords(
  records: readonly RetrievalAttributionRecord[],
): AttributionSummary {
  const toolCounts = new Map<string, RoleToolRow>();
  const promptCounts = new Map<string, AttributionSummary["prompts"][number]>();
  const usedBySlice = new Map<string, Map<string, number>>();
  const toolsetBySlice = new Map<string, { ids: string[]; count: number; hash: string }>();
  const resultRows = new Map<string, ResultRow>();
  const providerRows = new Map<string, ProviderRow>();
  const coverage = emptyCoverage();
  let turns = 0;
  let calls = 0;
  for (const record of records) {
    const { role, agent, model } = identity(record);
    if (record.kind === ATTRIBUTION_TURN_KIND) {
      turns += 1;
      coverage.turns += 1;
      const hash = record.toolsetHash || "";
      const key = sliceKey(role, agent, model, hash);
      if (!toolsetBySlice.has(key)) {
        toolsetBySlice.set(key, {
          ids: record.availableToolIds ?? [],
          count: record.availableToolCount ?? record.availableToolIds?.length ?? 0,
          hash,
        });
      }
      if (!usedBySlice.has(key)) usedBySlice.set(key, new Map());
    } else if (record.kind === ATTRIBUTION_RESULT_KIND) {
      coverage.results += 1;
      const result = record.result && typeof record.result === "object" ? record.result : undefined;
      if (record.tool && result) {
        const outcome = result.ok ? "ok" : "error";
        const rowKey = [role, agent, record.tool, result.resultKind || "-", outcome].join("\t");
        let row = resultRows.get(rowKey);
        if (!row) {
          row = {
            role,
            agent,
            tool: record.tool,
            resultKind: result.resultKind || "-",
            outcome,
            count: 0,
            degraded: 0,
            hitsSum: 0,
            maxHits: 0,
            durationsMs: [],
          };
          resultRows.set(rowKey, row);
        }
        row.count += 1;
        if (result.degraded === true) row.degraded += 1;
        if (typeof result.provider === "string" && result.provider) {
          coverage.resultsWithProvider += 1;
          const providerKey = [role, agent, record.tool, result.provider].join("\t");
          const existingProvider = providerRows.get(providerKey);
          if (existingProvider) {
            existingProvider.count += 1;
            if (result.degraded === true) existingProvider.degraded += 1;
          } else {
            providerRows.set(providerKey, {
              role,
              agent,
              tool: record.tool,
              provider: result.provider,
              count: 1,
              degraded: result.degraded === true ? 1 : 0,
            });
          }
        }
        const hits = asFiniteNumber(result.hitCount) ?? 0;
        row.hitsSum += hits;
        if (hits > row.maxHits) row.maxHits = hits;
        if (typeof result.durationMs === "number" && Number.isFinite(result.durationMs)) {
          row.durationsMs.push(result.durationMs);
        }
      }
    } else if (record.kind === RETRIEVAL_ATTRIBUTION_KIND && record.tool) {
      calls += 1;
      coverage.calls += 1;
      if (record.tool === "read") {
        coverage.readCalls += 1;
        const hasTarget =
          (Array.isArray(record.retrieval?.paths) && (record.retrieval?.paths?.length ?? 0) > 0) ||
          typeof record.retrieval?.path === "string";
        if (hasTarget) coverage.readCallsWithTarget += 1;
      }
      if (INDEXED_SEARCH_TOOLS.has(record.tool)) coverage.indexedSearchCalls += 1;
      const toolKey = `${role}\t${agent}\t${record.tool}`;
      const existing = toolCounts.get(toolKey);
      if (existing) existing.count += 1;
      else toolCounts.set(toolKey, { role, agent, tool: record.tool, count: 1 });
      const hash = record.toolsetHash || "";
      const exact = sliceKey(role, agent, model, hash);
      const fallback = sliceKey(role, agent, model, "");
      const key = usedBySlice.has(exact) || toolsetBySlice.has(exact) ? exact : fallback;
      const used = usedBySlice.get(key) ?? new Map<string, number>();
      used.set(record.tool, (used.get(record.tool) ?? 0) + 1);
      usedBySlice.set(key, used);
    }
    if (record.promptHash) {
      const promptKey = `${role}\t${agent}\t${record.promptHash}`;
      const prompt = promptCounts.get(promptKey);
      if (prompt) prompt.count += 1;
      else {
        promptCounts.set(promptKey, {
          role,
          agent,
          promptHash: record.promptHash,
          layerIds: record.layerIds ?? [],
          count: 1,
        });
      }
    }
  }
  const sortKey = (left: { role: string; agent: string; tool?: string; model?: string }, right: typeof left) =>
    left.role.localeCompare(right.role) ||
    left.agent.localeCompare(right.agent) ||
    (left.model ?? "").localeCompare(right.model ?? "") ||
    (left.tool ?? "").localeCompare(right.tool ?? "");
  const sliceKeys = new Set([...toolsetBySlice.keys(), ...usedBySlice.keys()]);
  const slices: SliceSummary[] = [...sliceKeys]
    .map((key) => {
      const [role, agent, model, hash] = key.split("\t");
      const toolset = toolsetBySlice.get(key);
      const usedMap = usedBySlice.get(key) ?? new Map<string, number>();
      const availableToolIds = toolset?.ids ?? [];
      const used = [...usedMap.keys()].sort((a, b) => a.localeCompare(b));
      const unused = availableToolIds.filter((tool) => !usedMap.has(tool));
      const groups = (Object.keys(TOOL_GROUPS) as ToolGroupName[]).map((group) => {
        const members = TOOL_GROUPS[group];
        const available = availableToolIds.filter((tool) => members.includes(tool));
        const usedInGroup = used.filter((tool) => members.includes(tool));
        const unusedInGroup = available.filter((tool) => !usedMap.has(tool));
        const callsInGroup = usedInGroup.reduce((sum, tool) => sum + (usedMap.get(tool) ?? 0), 0);
        const adoption: GroupAdoption = {
          group,
          available,
          used: usedInGroup,
          unused: unusedInGroup,
          calls: callsInGroup,
        };
        if (group === "durable" && available.length > 0 && usedInGroup.length === 0) {
          adoption.note = "eligibility-not-defect";
        }
        return adoption;
      });
      return {
        role: role || "unknown",
        agent: agent || "unknown",
        model: model || "unknown",
        toolsetHash: toolset?.hash || hash || "",
        availableToolIds,
        availableToolCount: toolset?.count ?? availableToolIds.length,
        used,
        unused,
        groups,
      };
    })
    .sort(sortKey);
  return {
    rows: [...toolCounts.values()].sort(sortKey),
    prompts: [...promptCounts.values()].sort(sortKey),
    slices,
    total: records.length,
    turns,
    calls,
    coverage,
    results: [...resultRows.values()]
      .map((row) => ({ ...row, durationsMs: [...row.durationsMs].sort((a, b) => a - b) }))
      .sort((left, right) =>
        left.role.localeCompare(right.role) ||
        left.agent.localeCompare(right.agent) ||
        left.tool.localeCompare(right.tool) ||
        left.resultKind.localeCompare(right.resultKind) ||
        left.outcome.localeCompare(right.outcome)),
    providers: [...providerRows.values()].sort((left, right) =>
      left.role.localeCompare(right.role) ||
      left.agent.localeCompare(right.agent) ||
      left.tool.localeCompare(right.tool) ||
      left.provider.localeCompare(right.provider)),
  };
}

export function formatAttributionSummary(summary: AttributionSummary): string {
  const lines = [
    `total=${summary.total}\tturns=${summary.turns}\tcalls=${summary.calls}`,
    `coverage=turns:${summary.coverage.turns}\tcalls:${summary.coverage.calls}\tresults:${summary.coverage.results}\treadCalls:${summary.coverage.readCalls}\treadCallsWithTarget:${summary.coverage.readCallsWithTarget}\tindexedSearchCalls:${summary.coverage.indexedSearchCalls}\tresultsWithProvider:${summary.coverage.resultsWithProvider}`,
    "role\tagent\ttool\tresultKind\toutcome\tcount\tdegraded\thitsSum\tmaxHits\tp50Ms\tp95Ms\tmaxMs",
    ...summary.results.map((row) =>
      [
        row.role,
        row.agent,
        row.tool,
        row.resultKind,
        row.outcome,
        row.count,
        row.degraded,
        row.hitsSum,
        row.maxHits,
        percentile(row.durationsMs, 0.5) ?? "-",
        percentile(row.durationsMs, 0.95) ?? "-",
        row.durationsMs.length ? row.durationsMs[row.durationsMs.length - 1] : "-",
      ].join("\t"),
    ),
    "role\tagent\ttool\tprovider\tcount\tdegraded",
    ...summary.providers.map((row) =>
      [row.role, row.agent, row.tool, row.provider, row.count, row.degraded].join("\t"),
    ),
    "role\tagent\tmodel\ttoolsetHash\tavailable\tused\tunused",
    ...summary.slices.map(
      (slice) =>
        `${slice.role}\t${slice.agent}\t${slice.model}\t${slice.toolsetHash || "-"}\t${slice.availableToolCount}\t${slice.used.length}\t${slice.unused.length}`,
    ),
    "",
    "role\tagent\tmodel\tgroup\tavailable\tused\tunused\tcalls\tnote",
    ...summary.slices.flatMap((slice) =>
      slice.groups.map(
        (group) =>
          `${slice.role}\t${slice.agent}\t${slice.model}\t${group.group}\t${group.available.length}\t${group.used.length}\t${group.unused.length}\t${group.calls}\t${group.note || "eligibility"}`,
      ),
    ),
    "",
    "role\tagent\ttool\tcount",
    ...summary.rows.map((row) => `${row.role}\t${row.agent}\t${row.tool}\t${row.count}`),
    "",
    "role\tagent\tpromptHash\tlayerIds\tcount",
    ...summary.prompts.map(
      (row) => `${row.role}\t${row.agent}\t${row.promptHash}\t${row.layerIds.join(",") || "-"}\t${row.count}`,
    ),
    "",
    "role\tagent\tmodel\tavailableTools",
    ...summary.slices.map(
      (slice) => `${slice.role}\t${slice.agent}\t${slice.model}\t${slice.availableToolIds.join(",") || "-"}`,
    ),
    "",
    "role\tagent\tmodel\tunusedTools",
    ...summary.slices.map(
      (slice) => `${slice.role}\t${slice.agent}\t${slice.model}\t${slice.unused.join(",") || "-"}`,
    ),
  ];
  return lines.join("\n") + "\n";
}

/**
 * Structured post-execution metadata from a pi `tool_result` event.
 *
 * Only enumerated scalar/array fields of `details` are read. Bounded provider
 * provenance as reported by the tool itself is ingested deliberately; error text,
 * result bodies, and anything else the runtime does not expose here stay absent.
 */
export function buildAttributionResult(
  isError: unknown,
  details: unknown,
  projectRoot = deriveProjectRoot(process.env.PI_CODING_AGENT_DIR || process.cwd()),
): AttributionResult {
  const truncated: string[] = [];
  const redacted: string[] = [];
  const result: AttributionResult = { ok: isError !== true };
  const d = details && typeof details === "object" && !Array.isArray(details)
    ? (details as Record<string, unknown>)
    : undefined;
  if (!d) return result;
  const resultKind = boundString(asTrimmedString(d.kind), "resultKind", truncated, redacted);
  if (resultKind) result.resultKind = resultKind;
  const degraded = asBoolean(d.degraded);
  if (degraded !== undefined) result.degraded = degraded;
  const provider = boundString(asTrimmedString(d.provider), "provider", truncated, redacted);
  if (provider) result.provider = provider;
  const resultsPathRaw = asTrimmedString(d.resultsPath);
  if (resultsPathRaw) {
    const rel = normalizeTelemetryPath(resultsPathRaw, projectRoot, truncated, redacted, "resultsPath");
    if (rel !== undefined) result.resultsPath = rel;
  }
  const hits = Array.isArray(d.hits) ? d.hits : [];
  if (hits.length > 0) {
    result.hitCount = hits.length;
    let alreadyRead = 0;
    const refs: string[] = [];
    for (const hit of hits) {
      if (hit && typeof hit === "object" && (hit as Record<string, unknown>).alreadyRead === true) alreadyRead += 1;
      if (refs.length >= RETRIEVAL_REF_BOUND) continue;
      const ref = hit && typeof hit === "object" ? asTrimmedString((hit as Record<string, unknown>).ref) : undefined;
      if (ref === undefined) continue;
      if (SECRET_RE.test(ref)) {
        redacted.push("refs");
        refs.push("[redacted]");
      } else if (ref.length > RETRIEVAL_STRING_BOUND) {
        truncated.push("refs");
        refs.push(ref.slice(0, RETRIEVAL_STRING_BOUND));
      } else {
        refs.push(ref);
      }
    }
    if (alreadyRead > 0) result.alreadyReadCount = alreadyRead;
    if (refs.length) result.refs = refs;
    if (hits.length > RETRIEVAL_REF_BOUND) truncated.push("refs");
  }
  if (redacted.length) result.redacted = [...new Set(redacted)];
  if (truncated.length) result.truncated = [...new Set(truncated)];
  return result;
}

function isAttributionRecord(parsed: RetrievalAttributionRecord | null | undefined): parsed is RetrievalAttributionRecord {
  // v1 files predate read targets / turnIndex / tool_result rows and stay first-class.
  if (!parsed || (parsed.v !== RETRIEVAL_ATTRIBUTION_VERSION && parsed.v !== RETRIEVAL_ATTRIBUTION_V1)) return false;
  if (parsed.kind === ATTRIBUTION_TURN_KIND) return typeof parsed.toolsetHash === "string";
  if (parsed.kind === ATTRIBUTION_RESULT_KIND) {
    return typeof parsed.tool === "string" && typeof parsed.toolCallId === "string";
  }
  return parsed.kind === RETRIEVAL_ATTRIBUTION_KIND && typeof parsed.tool === "string";
}

function parseJsonl(text: string): RetrievalAttributionRecord[] {
  return text
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as RetrievalAttributionRecord;
        return isAttributionRecord(parsed) ? [parsed] : [];
      } catch {
        return [];
      }
    });
}

export async function summarizeAttributionFile(file: string): Promise<AttributionSummary> {
  try {
    return summarizeAttributionRecords(parseJsonl(await fs.readFile(file, "utf8")));
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") {
      return { rows: [], prompts: [], slices: [], total: 0, turns: 0, calls: 0, coverage: emptyCoverage(), results: [], providers: [] };
    }
    throw error;
  }
}

async function defaultAppend(file: string, line: string): Promise<void> {
  await fs.mkdir(dirname(file), { recursive: true });
  await fs.appendFile(file, line, "utf8");
}

export function createRetrievalAttribution(options: RetrievalAttributionOptions) {
  const env = options.env ?? process.env;
  const configured = env.PIPI_RETRIEVAL_ATTRIBUTION_PATH;
  const disabled = configured !== undefined && configured.trim() === "";
  const file = disabled
    ? undefined
    : configured?.trim()
      ? configured.trim()
      : isProjectLocalAgentHome(options.agentDir)
        ? retrievalAttributionPath(options.agentDir)
        : undefined;
  const projectRoot = resolve(
    options.projectRoot?.trim() ? options.projectRoot : deriveProjectRoot(options.agentDir),
  );
  const now = options.now ?? (() => new Date());
  const append = options.append ?? defaultAppend;
  let turn: AttributionTurn = {};
  let turnIndex: number | undefined;
  /** toolCallId → observation timestamp of the tool_call, for result-side latency. */
  const pendingCalls = new Map<string, number>();
  let chain = Promise.resolve();

  function enqueue(task: () => Promise<void>): void {
    chain = chain.then(async () => {
      try {
        await task();
      } catch {
        /* best-effort */
      }
    });
  }

  function noteTurn(next: AttributionTurn): AttributionTurn {
    const toolset = normalizeAvailableTools(next.availableTools ?? next.availableToolIds);
    turn = {
      ...turn,
      ...next,
      availableToolIds: toolset.availableToolIds,
      availableToolCount: toolset.availableToolCount,
      toolsetHash: toolset.toolsetHash,
    };
    if (!file) return turn;
    try {
      const record = buildToolsetRecord(turn, {
        sessionId: next.sessionId ?? env.PIPIUI_SESSION_ID ?? env.PI_SESSION_ID,
        runId: next.runId ?? env.PIPIUI_AGENT_RUN_ID,
        agentId: next.agentId ?? env.PIPIUI_AGENT_ID,
        now: now(),
      });
      enqueue(() => append(file, serializeAttributionRecord(record)));
    } catch {
      /* best-effort */
    }
    return turn;
  }

  /** Record the runtime's real turn index (pi `turn_start`); absent means never observed. */
  function noteTurnIndex(value: unknown): number | undefined {
    const next = asTurnIndex(value);
    if (next !== undefined) turnIndex = next;
    return turnIndex;
  }

  function observeToolCall(input: ObserveToolCallInput): RetrievalAttributionRecord | undefined {
    try {
      const observedAt = input.now ?? now();
      const record = buildAttributionRecord(
        {
          ...input,
          turnIndex: asTurnIndex(input.turnIndex) ?? turnIndex,
          projectRoot: input.projectRoot ?? projectRoot,
          runId: input.runId ?? env.PIPIUI_AGENT_RUN_ID,
          agentId: input.agentId ?? env.PIPIUI_AGENT_ID,
          sessionId: input.sessionId ?? env.PIPIUI_SESSION_ID ?? env.PI_SESSION_ID,
          now: observedAt,
        },
        turn,
      );
      if (!record) return record;
      const toolCallId = asTrimmedString(input.toolCallId);
      if (toolCallId && !pendingCalls.has(toolCallId)) {
        pendingCalls.set(toolCallId, observedAt.getTime());
        while (pendingCalls.size > PENDING_TOOLCALL_BOUND) {
          const oldest = pendingCalls.keys().next().value;
          if (oldest === undefined) break;
          pendingCalls.delete(oldest);
        }
      }
      if (!file) return record;
      enqueue(() => append(file, serializeAttributionRecord(record)));
      return record;
    } catch {
      return undefined;
    }
  }

  function observeToolResult(input: ObserveToolResultInput): RetrievalAttributionRecord | undefined {
    try {
      const nowMs = (input.now ?? now()).getTime();
      const toolCallId = asTrimmedString(input.toolCallId);
      let durationMs: number | undefined;
      if (toolCallId) {
        const startMs = pendingCalls.get(toolCallId);
        pendingCalls.delete(toolCallId);
        if (startMs !== undefined && nowMs >= startMs) durationMs = nowMs - startMs;
      }
      const record = buildResultRecord(
        {
          ...input,
          turnIndex: input.turnIndex ?? turnIndex,
          sessionId: input.sessionId ?? env.PIPIUI_SESSION_ID ?? env.PI_SESSION_ID,
          runId: input.runId ?? env.PIPIUI_AGENT_RUN_ID,
          agentId: input.agentId ?? env.PIPIUI_AGENT_ID,
          role: input.role ?? turn.role,
          agent: input.agent ?? turn.agent,
          model: input.model ?? turn.model,
          now: input.now ?? new Date(nowMs),
        },
        { durationMs },
      );
      if (!record || !file) return record;
      enqueue(() => append(file, serializeAttributionRecord(record)));
      return record;
    } catch {
      return undefined;
    }
  }

  async function close(): Promise<void> {
    await chain.catch(() => undefined);
  }

  return {
    file,
    noteTurn,
    noteTurnIndex,
    observeToolCall,
    observeToolResult,
    pending: () => chain,
    close,
  };
}

export type RetrievalAttribution = ReturnType<typeof createRetrievalAttribution>;
