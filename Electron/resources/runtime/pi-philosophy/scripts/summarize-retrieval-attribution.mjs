#!/usr/bin/env node
/**
 * Role × tool baseline from project-local attribution JSONL.
 *
 * Does not modify prompt text. Default file is the current project's
 * `.pi/agent/retrieval-attribution.jsonl`.
 *
 *   node Electron/resources/runtime/pi-philosophy/scripts/summarize-retrieval-attribution.mjs
 *   node Electron/resources/runtime/pi-philosophy/scripts/summarize-retrieval-attribution.mjs /path/to/file.jsonl
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const CALL_KIND = "retrieval_tool_call";
const TURN_KIND = "session_toolset";
const RESULT_KIND = "tool_result";

const INDEXED_SEARCH_TOOLS = new Set(["code_search", "code_nav", "repo_map", "read_spans"]);

const TOOL_GROUPS = {
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
};

function agentDir() {
  return process.env.PI_CODING_AGENT_DIR || join(process.cwd(), ".pi", "agent");
}

function defaultPath() {
  return process.env.PIPI_RETRIEVAL_ATTRIBUTION_PATH?.trim() || join(agentDir(), "retrieval-attribution.jsonl");
}

function parseRecords(text) {
  const records = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed?.kind === TURN_KIND && typeof parsed.toolsetHash === "string") records.push(parsed);
      else if (parsed?.kind === RESULT_KIND && typeof parsed.tool === "string" && typeof parsed.toolCallId === "string") records.push(parsed);
      else if (parsed?.kind === CALL_KIND && typeof parsed.tool === "string") records.push(parsed);
    } catch {
      // skip malformed lines
    }
  }
  return records;
}

function percentile(sorted, fraction) {
  if (!sorted.length) return undefined;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

function identity(record) {
  const role = record.role || "unknown";
  return {
    role,
    agent: record.agent || (role === "main" ? "main" : "unknown"),
    model: record.model || "unknown",
  };
}

function sliceKey(role, agent, model, toolsetHash = "") {
  return `${role}\t${agent}\t${model}\t${toolsetHash}`;
}

function summarize(records) {
  const toolCounts = new Map();
  const promptCounts = new Map();
  const usedBySlice = new Map();
  const toolsetBySlice = new Map();
  const resultRows = new Map();
  const providerRows = new Map();
  const coverage = { turns: 0, calls: 0, results: 0, readCalls: 0, readCallsWithTarget: 0, indexedSearchCalls: 0, resultsWithProvider: 0 };
  let turns = 0;
  let calls = 0;
  for (const record of records) {
    const { role, agent, model } = identity(record);
    if (record.kind === TURN_KIND) {
      turns += 1;
      coverage.turns += 1;
      const hash = record.toolsetHash || "";
      const key = sliceKey(role, agent, model, hash);
      if (!toolsetBySlice.has(key)) {
        toolsetBySlice.set(key, {
          ids: Array.isArray(record.availableToolIds) ? record.availableToolIds : [],
          count: record.availableToolCount ?? record.availableToolIds?.length ?? 0,
          hash,
        });
      }
      if (!usedBySlice.has(key)) usedBySlice.set(key, new Map());
    } else if (record.kind === RESULT_KIND) {
      coverage.results += 1;
      const result = record.result && typeof record.result === "object" ? record.result : undefined;
      if (record.tool && result) {
        const outcome = result.ok ? "ok" : "error";
        const rowKey = [role, agent, record.tool, result.resultKind || "-", outcome].join("\t");
        let row = resultRows.get(rowKey);
        if (!row) {
          row = { role, agent, tool: record.tool, resultKind: result.resultKind || "-", outcome, count: 0, degraded: 0, hitsSum: 0, maxHits: 0, durationsMs: [] };
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
            providerRows.set(providerKey, { role, agent, tool: record.tool, provider: result.provider, count: 1, degraded: result.degraded === true ? 1 : 0 });
          }
        }
        const hits = typeof result.hitCount === "number" && Number.isFinite(result.hitCount) ? result.hitCount : 0;
        row.hitsSum += hits;
        if (hits > row.maxHits) row.maxHits = hits;
        if (typeof result.durationMs === "number" && Number.isFinite(result.durationMs)) row.durationsMs.push(result.durationMs);
      }
    } else if (record.kind === CALL_KIND && record.tool) {
      calls += 1;
      coverage.calls += 1;
      if (record.tool === "read") {
        coverage.readCalls += 1;
        const retrieval = record.retrieval && typeof record.retrieval === "object" ? record.retrieval : undefined;
        const hasTarget = (Array.isArray(retrieval?.paths) && retrieval.paths.length > 0) || typeof retrieval?.path === "string";
        if (hasTarget) coverage.readCallsWithTarget += 1;
      }
      if (INDEXED_SEARCH_TOOLS.has(record.tool)) coverage.indexedSearchCalls += 1;
      const toolKey = `${role}\t${agent}\t${record.tool}`;
      const tool = toolCounts.get(toolKey);
      if (tool) tool.count += 1;
      else toolCounts.set(toolKey, { role, agent, tool: record.tool, count: 1 });
      const hash = record.toolsetHash || "";
      const exact = sliceKey(role, agent, model, hash);
      const fallback = sliceKey(role, agent, model, "");
      const key = usedBySlice.has(exact) || toolsetBySlice.has(exact) ? exact : fallback;
      const used = usedBySlice.get(key) ?? new Map();
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
          layerIds: Array.isArray(record.layerIds) ? record.layerIds : [],
          count: 1,
        });
      }
    }
  }
  const sortKey = (left, right) =>
    left.role.localeCompare(right.role) ||
    left.agent.localeCompare(right.agent) ||
    (left.model ?? "").localeCompare(right.model ?? "") ||
    (left.tool ?? "").localeCompare(right.tool ?? "");
  const sliceKeys = new Set([...toolsetBySlice.keys(), ...usedBySlice.keys()]);
  const slices = [...sliceKeys]
    .map((key) => {
      const [role, agent, model, hash] = key.split("\t");
      const toolset = toolsetBySlice.get(key);
      const usedMap = usedBySlice.get(key) ?? new Map();
      const availableToolIds = toolset?.ids ?? [];
      const used = [...usedMap.keys()].sort((a, b) => a.localeCompare(b));
      const unused = availableToolIds.filter((tool) => !usedMap.has(tool));
      const groups = Object.keys(TOOL_GROUPS).map((group) => {
        const members = TOOL_GROUPS[group];
        const available = availableToolIds.filter((tool) => members.includes(tool));
        const usedInGroup = used.filter((tool) => members.includes(tool));
        const unusedInGroup = available.filter((tool) => !usedMap.has(tool));
        const callsInGroup = usedInGroup.reduce((sum, tool) => sum + (usedMap.get(tool) ?? 0), 0);
        return {
          group,
          available,
          used: usedInGroup,
          unused: unusedInGroup,
          calls: callsInGroup,
          note: group === "durable" && available.length > 0 && usedInGroup.length === 0
            ? "eligibility-not-defect"
            : "eligibility",
        };
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

function format(summary) {
  return [
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
    ...summary.providers.map((row) => [row.role, row.agent, row.tool, row.provider, row.count, row.degraded].join("\t")),
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
          `${slice.role}\t${slice.agent}\t${slice.model}\t${group.group}\t${group.available.length}\t${group.used.length}\t${group.unused.length}\t${group.calls}\t${group.note}`,
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
    "",
  ].join("\n");
}

const file = process.argv[2] && !process.argv[2].startsWith("-") ? process.argv[2] : defaultPath();
let text = "";
try {
  text = await readFile(file, "utf8");
} catch (error) {
  if (error && typeof error === "object" && error.code === "ENOENT") {
    process.stdout.write(`total=0\tturns=0\tcalls=0\n# missing ${file}\n`);
    process.exit(0);
  }
  throw error;
}
process.stdout.write(format(summarize(parseRecords(text))));
process.stdout.write(`# file ${file}\n`);
