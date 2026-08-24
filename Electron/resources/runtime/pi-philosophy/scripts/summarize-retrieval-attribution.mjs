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
    "subagent_parallel",
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
      else if (parsed?.kind === CALL_KIND && typeof parsed.tool === "string") records.push(parsed);
    } catch {
      // skip malformed lines
    }
  }
  return records;
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
  let turns = 0;
  let calls = 0;
  for (const record of records) {
    const { role, agent, model } = identity(record);
    if (record.kind === TURN_KIND) {
      turns += 1;
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
    } else if (record.tool) {
      calls += 1;
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
  };
}

function format(summary) {
  return [
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
