/**
 * Project-local session tool-call attribution.
 *
 * One append-only JSONL event per turn toolset and per tool call, written under
 * the current project's `.pi/agent` home. Best-effort and non-blocking: a logging
 * failure must never change tool execution. Does not store the full prompt or
 * unbounded / secret-bearing payloads.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

export const RETRIEVAL_ATTRIBUTION_FILENAME = "retrieval-attribution.jsonl";
export const RETRIEVAL_ATTRIBUTION_VERSION = 1 as const;
export const RETRIEVAL_ATTRIBUTION_KIND = "retrieval_tool_call" as const;
export const ATTRIBUTION_TURN_KIND = "session_toolset" as const;
export const RETRIEVAL_STRING_BOUND = 200;
export const RETRIEVAL_REF_BOUND = 12;
export const AVAILABLE_TOOL_BOUND = 256;

const RETRIEVAL_TOOLS = new Set([
  "grep",
  "find",
  "code_search",
  "read_spans",
  "code_nav",
  "repo_map",
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
] as const;

const SECRET_RE =
  /(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:bearer|api[_-]?key|password|secret|token|authorization)\s*[:=]\s*\S+)/i;

export type GrepPatternKind = "empty" | "exact" | "alternation" | "descriptive";

export type AttributionKind = typeof RETRIEVAL_ATTRIBUTION_KIND | typeof ATTRIBUTION_TURN_KIND;

export type RetrievalAttributionRecord = {
  v: typeof RETRIEVAL_ATTRIBUTION_VERSION;
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
};

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
  now?: Date;
};

export type RetrievalAttributionOptions = {
  agentDir: string;
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

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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

export function boundRetrievalInput(toolName: string, input: unknown): RetrievalInput | undefined {
  if (!RETRIEVAL_TOOLS.has(toolName)) return undefined;
  const raw = input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
  const redacted: string[] = [];
  const truncated: string[] = [];
  const retrieval: RetrievalInput = {};

  const pattern = boundString(asTrimmedString(raw.pattern), "pattern", truncated, redacted);
  const query = boundString(asTrimmedString(raw.query), "query", truncated, redacted);
  const pathValue = boundString(asTrimmedString(raw.path), "path", truncated, redacted);
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
  if (pathValue !== undefined && (toolName === "grep" || toolName === "find" || toolName === "code_search" || toolName === "code_nav")) {
    retrieval.path = pathValue;
  }
  if (glob !== undefined && (toolName === "grep" || toolName === "code_search")) retrieval.glob = glob;
  if (toolName === "code_nav") {
    if (operation !== undefined) retrieval.operation = operation;
    if (symbol !== undefined) retrieval.symbol = symbol;
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
  const retrieval = boundRetrievalInput(tool, input.input);
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

export function serializeAttributionRecord(record: RetrievalAttributionRecord): string {
  const safe: Record<string, unknown> = {};
  for (const key of ALLOWED_KEYS) {
    if (key === "retrieval") {
      if (!record.retrieval) continue;
      const retrieval: Record<string, unknown> = {};
      for (const field of RETRIEVAL_ALLOWED_KEYS) {
        if (record.retrieval[field] !== undefined) retrieval[field] = record.retrieval[field];
      }
      if (Object.keys(retrieval).length > 0) safe.retrieval = retrieval;
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

export type AttributionSummary = {
  rows: RoleToolRow[];
  prompts: Array<{ role: string; agent: string; promptHash: string; layerIds: string[]; count: number }>;
  slices: SliceSummary[];
  total: number;
  turns: number;
  calls: number;
};

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
  let turns = 0;
  let calls = 0;
  for (const record of records) {
    const { role, agent, model } = identity(record);
    if (record.kind === ATTRIBUTION_TURN_KIND) {
      turns += 1;
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
    } else if (record.tool) {
      calls += 1;
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
  };
}

export function formatAttributionSummary(summary: AttributionSummary): string {
  const lines = [
    `total=${summary.total}\tturns=${summary.turns}\tcalls=${summary.calls}`,
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

function isAttributionRecord(parsed: RetrievalAttributionRecord | null | undefined): parsed is RetrievalAttributionRecord {
  if (!parsed || parsed.v !== RETRIEVAL_ATTRIBUTION_VERSION) return false;
  if (parsed.kind === ATTRIBUTION_TURN_KIND) return typeof parsed.toolsetHash === "string";
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
      return { rows: [], prompts: [], slices: [], total: 0, turns: 0, calls: 0 };
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
  const now = options.now ?? (() => new Date());
  const append = options.append ?? defaultAppend;
  let turn: AttributionTurn = {};
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

  function observeToolCall(input: ObserveToolCallInput): RetrievalAttributionRecord | undefined {
    try {
      const record = buildAttributionRecord(
        {
          ...input,
          runId: input.runId ?? env.PIPIUI_AGENT_RUN_ID,
          agentId: input.agentId ?? env.PIPIUI_AGENT_ID,
          sessionId: input.sessionId ?? env.PIPIUI_SESSION_ID ?? env.PI_SESSION_ID,
          now: input.now ?? now(),
        },
        turn,
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
    observeToolCall,
    pending: () => chain,
    close,
  };
}

export type RetrievalAttribution = ReturnType<typeof createRetrievalAttribution>;
