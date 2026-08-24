import { mkdtemp, readFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ATTRIBUTION_TURN_KIND,
  AVAILABLE_TOOL_BOUND,
  RETRIEVAL_ATTRIBUTION_FILENAME,
  RETRIEVAL_ATTRIBUTION_KIND,
  RETRIEVAL_ATTRIBUTION_VERSION,
  boundRetrievalInput,
  buildAttributionRecord,
  classifyGrepPattern,
  createRetrievalAttribution,
  formatAttributionSummary,
  hashPrompt,
  isGlobalPiHome,
  isProjectLocalAgentHome,
  normalizeAvailableTools,
  serializeAttributionRecord,
  summarizeAttributionRecords,
  type RetrievalAttributionRecord,
} from "../../../resources/runtime/pi-philosophy/retrieval-attribution.ts";

async function dir() {
  return join(await mkdtemp(join(tmpdir(), "retrieval-attr-")), ".pi", "agent");
}

function lines(text: string): RetrievalAttributionRecord[] {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RetrievalAttributionRecord);
}

describe("classifyGrepPattern", () => {
  it("classifies exact, alternation, and descriptive searches", () => {
    expect(classifyGrepPattern("composePhilosophy")).toBe("exact");
    expect(classifyGrepPattern("foo|bar")).toBe("alternation");
    expect(classifyGrepPattern("where the login state")).toBe("descriptive");
    expect(classifyGrepPattern("session.*token")).toBe("descriptive");
    expect(classifyGrepPattern("composePhilosophy", true)).toBe("exact");
    expect(classifyGrepPattern("foo|bar", true)).toBe("exact");
    expect(classifyGrepPattern("")).toBe("empty");
  });
});

describe("project isolation", () => {
  it("refuses the global ~/.pi home", () => {
    expect(isGlobalPiHome(join(homedir(), ".pi"))).toBe(true);
    expect(isGlobalPiHome(join(homedir(), ".pi", "agent"))).toBe(true);
    expect(isGlobalPiHome(join(tmpdir(), "project", ".pi", "agent"))).toBe(false);
  });

  it("accepts only project-local .pi/agent, not the App profile", () => {
    expect(isProjectLocalAgentHome(join(tmpdir(), "project", ".pi", "agent"))).toBe(true);
    expect(isProjectLocalAgentHome(join(homedir(), ".pi", "agent"))).toBe(false);
    expect(
      isProjectLocalAgentHome(join(homedir(), "Library", "Application Support", "@pipiui", "electron", "pi-agent")),
    ).toBe(false);
    expect(isProjectLocalAgentHome(join(tmpdir(), "retrieval-attr-scratch"))).toBe(false);
  });

  it("writes only under the given project agent dir", async () => {
    const agentDir = await dir();
    const tel = createRetrievalAttribution({
      agentDir,
      env: { PIPIUI_AGENT_ID: "worker-a", PIPIUI_AGENT_RUN_ID: "run-1" },
      now: () => new Date("2026-08-23T00:00:00.000Z"),
    });
    tel.noteTurn({
      promptHash: hashPrompt("final-prompt"),
      layerIds: ["retrieval", "research"],
      role: "worker",
      agent: "explore",
      model: "xai/grok-4.5",
    });
    tel.observeToolCall({
      toolName: "grep",
      toolCallId: "c1",
      sessionId: "sess-1",
      input: { pattern: "composePhilosophy", path: "src", literal: true },
    });
    await tel.pending();
    const raw = await readFile(join(agentDir, RETRIEVAL_ATTRIBUTION_FILENAME), "utf8");
    expect(tel.file).toBe(join(agentDir, RETRIEVAL_ATTRIBUTION_FILENAME));
    expect(raw).not.toMatch(homedir());
    const row = lines(raw).find((item) => item.tool === "grep");
    expect(row?.sessionId).toBe("sess-1");
    expect(row?.agentId).toBe("worker-a");
    expect(row?.runId).toBe("run-1");
  });

  it("does not write when agentDir is ~/.pi/agent", async () => {
    const written: string[] = [];
    const tel = createRetrievalAttribution({
      agentDir: join(homedir(), ".pi", "agent"),
      append: async (_file, line) => {
        written.push(line);
      },
    });
    expect(tel.file).toBeUndefined();
    tel.observeToolCall({ toolName: "grep", input: { pattern: "x" } });
    await tel.pending();
    expect(written).toEqual([]);
  });

  it("does not write when agentDir is the Electron App profile", async () => {
    const written: string[] = [];
    const tel = createRetrievalAttribution({
      agentDir: join(homedir(), "Library", "Application Support", "@pipiui", "electron", "pi-agent"),
      append: async (_file, line) => {
        written.push(line);
      },
    });
    expect(tel.file).toBeUndefined();
    tel.observeToolCall({ toolName: "grep", input: { pattern: "x" } });
    await tel.pending();
    expect(written).toEqual([]);
  });
});

describe("event shape and prompt/layer correlation", () => {
  it("records stable attribution without the full prompt", async () => {
    const agentDir = await dir();
    const prompt = "SYSTEM\n<!-- pipi-philosophy -->\nretrieval body";
    const tel = createRetrievalAttribution({
      agentDir,
      now: () => new Date("2026-08-23T12:00:00.000Z"),
    });
    tel.noteTurn({
      promptHash: hashPrompt(prompt),
      layerIds: ["retrieval", "thinking"],
      role: "worker",
      agent: "explore",
      model: "xai/grok-4.5",
    });
    tel.observeToolCall({
      toolName: "code_search",
      toolCallId: "cs1",
      sessionId: "s1",
      runId: "r1",
      agentId: "a1",
      input: { query: "where the session token gets refreshed", mode: "auto" },
    });
    await tel.pending();
    const row = lines(await readFile(join(agentDir, RETRIEVAL_ATTRIBUTION_FILENAME), "utf8")).find(
      (item) => item.tool === "code_search",
    );
    expect(row).toBeDefined();
    expect(row!.v).toBe(RETRIEVAL_ATTRIBUTION_VERSION);
    expect(row!.kind).toBe(RETRIEVAL_ATTRIBUTION_KIND);
    expect(row!.ts).toBe("2026-08-23T12:00:00.000Z");
    expect(row.sessionId).toBe("s1");
    expect(row.runId).toBe("r1");
    expect(row.agentId).toBe("a1");
    expect(row.role).toBe("worker");
    expect(row.agent).toBe("explore");
    expect(row.model).toBe("xai/grok-4.5");
    expect(row.tool).toBe("code_search");
    expect(row.toolCallId).toBe("cs1");
    expect(row.promptHash).toBe(hashPrompt(prompt));
    expect(row.layerIds).toEqual(["retrieval", "thinking"]);
    expect(row.retrieval?.query).toBe("where the session token gets refreshed");
    expect(JSON.stringify(row)).not.toContain("SYSTEM");
    expect(JSON.stringify(row)).not.toContain("retrieval body");
  });

  it("prefers the exact final prompt hash from the live system prompt", () => {
    const turnHash = hashPrompt("composed-at-start");
    const final = "final assembled prompt";
    const record = buildAttributionRecord(
      { toolName: "read_spans", prompt: final, layerIds: ["retrieval"] },
      { promptHash: turnHash, layerIds: ["stale"] },
    );
    expect(record?.promptHash).toBe(hashPrompt(final));
    expect(record?.promptHash).not.toBe(turnHash);
    expect(record?.layerIds).toEqual(["retrieval"]);
  });

  it("correlates code_search queries with later read_spans refs", () => {
    const search = boundRetrievalInput("code_search", { query: "login invalidation", mode: "auto" });
    const spans = boundRetrievalInput("read_spans", { refs: ["R1", "R4"] });
    expect(search?.query).toBe("login invalidation");
    expect(spans?.refs).toEqual(["R1", "R4"]);
    expect(spans?.refCount).toBe(2);
  });
});

describe("redaction and bounds", () => {
  it("omits secret-looking fields and truncates long strings", () => {
    const long = "where ".repeat(80);
    const retrieval = boundRetrievalInput("grep", {
      pattern: "sk-abcdefghijklmnopqrstuvwxyz",
      path: long,
      glob: "*.ts",
    });
    expect(retrieval?.pattern).toBeUndefined();
    expect(retrieval?.redacted).toContain("pattern");
    expect(retrieval?.path?.length).toBeLessThanOrEqual(200);
    expect(retrieval?.truncated).toContain("path");
    expect(JSON.stringify(retrieval)).not.toMatch(/sk-abcdefghijklmnopqrstuvwxyz/);
  });

  it("drops extra payload fields on serialize", () => {
    const line = serializeAttributionRecord({
      v: 1,
      kind: "retrieval_tool_call",
      ts: "2026-08-23T00:00:00.000Z",
      tool: "grep",
      prompt: "full prompt",
      arguments: { token: "secret" },
      result: "nope",
    } as RetrievalAttributionRecord & { prompt: string; arguments: unknown; result: string });
    expect(line).not.toMatch(/full prompt|secret|nope|"prompt"|"arguments"|"result"/);
    expect(JSON.parse(line).tool).toBe("grep");
  });
});

describe("no behavior change", () => {
  it("does not throw or mutate input when append fails", async () => {
    const input = { pattern: "composePhilosophy", path: "src" };
    const snapshot = structuredClone(input);
    const tel = createRetrievalAttribution({
      agentDir: join(tmpdir(), "proj", ".pi", "agent"),
      append: async () => {
        throw new Error("disk full");
      },
    });
    expect(() => tel.observeToolCall({ toolName: "grep", input })).not.toThrow();
    expect(input).toEqual(snapshot);
    await tel.pending();
  });

  it("still emits a name-only event for non-retrieval tools", () => {
    const record = buildAttributionRecord({
      toolName: "bash",
      input: { command: "cat ~/.env" },
    });
    expect(record?.tool).toBe("bash");
    expect(record?.retrieval).toBeUndefined();
    expect(JSON.stringify(record)).not.toContain("~/.env");
  });
});

describe("role x tool baseline", () => {
  it("aggregates a deterministic role x tool table", () => {
    const records: RetrievalAttributionRecord[] = [
      {
        v: 1,
        kind: "retrieval_tool_call",
        ts: "t",
        role: "worker",
        agent: "explore",
        tool: "code_search",
        promptHash: "aaa",
        layerIds: ["retrieval", "research"],
      },
      {
        v: 1,
        kind: "retrieval_tool_call",
        ts: "t",
        role: "worker",
        agent: "explore",
        tool: "read_spans",
        promptHash: "aaa",
        layerIds: ["retrieval", "research"],
      },
      {
        v: 1,
        kind: "retrieval_tool_call",
        ts: "t",
        role: "worker",
        agent: "reviewer",
        tool: "grep",
        promptHash: "bbb",
        layerIds: ["retrieval"],
      },
      {
        v: 1,
        kind: "retrieval_tool_call",
        ts: "t",
        role: "main",
        agent: "",
        tool: "code_search",
        promptHash: "ccc",
        layerIds: ["foundation", "retrieval"],
      },
    ];
    const summary = summarizeAttributionRecords(records);
    expect(formatAttributionSummary(summary)).toContain("worker\texplore\tcode_search\t1");
    expect(formatAttributionSummary(summary)).toContain("worker\treviewer\tgrep\t1");
    expect(formatAttributionSummary(summary)).toContain("main\tmain\tcode_search\t1");
    expect(summary.prompts.find((row) => row.agent === "explore")?.layerIds).toEqual([
      "retrieval",
      "research",
    ]);
  });
});

describe("available tool set and hash", () => {
  it("sorts, bounds, and hashes the available tool set stably", () => {
    const left = normalizeAvailableTools(["code_search", "grep", "read"]);
    const right = normalizeAvailableTools([{ name: "read" }, "grep", "code_search", "grep"]);
    expect(left.availableToolIds).toEqual(["code_search", "grep", "read"]);
    expect(left.toolsetHash).toBe(right.toolsetHash);
    expect(left.availableToolCount).toBe(3);
    expect(left.truncated).toBe(false);
    const overflow = normalizeAvailableTools(Array.from({ length: AVAILABLE_TOOL_BOUND + 5 }, (_, i) => `t${i}`));
    expect(overflow.availableToolIds).toHaveLength(AVAILABLE_TOOL_BOUND);
    expect(overflow.availableToolCount).toBe(AVAILABLE_TOOL_BOUND + 5);
    expect(overflow.truncated).toBe(true);
  });

  it("persists a session_toolset event with prompt, layers, and ids", async () => {
    const agentDir = await dir();
    const tel = createRetrievalAttribution({
      agentDir,
      env: { PIPIUI_AGENT_ID: "a1", PIPIUI_AGENT_RUN_ID: "r1" },
      now: () => new Date("2026-08-23T12:00:00.000Z"),
    });
    const prompt = "final assembled prompt";
    tel.noteTurn({
      promptHash: hashPrompt(prompt),
      layerIds: ["retrieval", "thinking"],
      role: "worker",
      agent: "explore",
      model: "xai/grok-4.5",
      sessionId: "s1",
      availableTools: ["memory_query", "grep", "code_search"],
    });
    await tel.pending();
    const turn = lines(await readFile(join(agentDir, RETRIEVAL_ATTRIBUTION_FILENAME), "utf8")).find(
      (item) => item.kind === ATTRIBUTION_TURN_KIND,
    );
    expect(turn).toMatchObject({
      kind: ATTRIBUTION_TURN_KIND,
      sessionId: "s1",
      runId: "r1",
      agentId: "a1",
      role: "worker",
      agent: "explore",
      model: "xai/grok-4.5",
      promptHash: hashPrompt(prompt),
      layerIds: ["retrieval", "thinking"],
      availableToolIds: ["code_search", "grep", "memory_query"],
      availableToolCount: 3,
    });
    expect(turn?.toolsetHash).toBe(normalizeAvailableTools(["memory_query", "grep", "code_search"]).toolsetHash);
    expect(JSON.stringify(turn)).not.toContain(prompt);
  });
});

describe("all-tool recording and secret omission", () => {
  it("records every tool name and keeps retrieval fields only for search tools", async () => {
    const agentDir = await dir();
    const tel = createRetrievalAttribution({ agentDir });
    tel.noteTurn({
      role: "worker",
      agent: "explore",
      model: "xai/grok-4.5",
      availableTools: ["bash", "code_search", "memory_query", "secret_vault_put"],
    });
    tel.observeToolCall({ toolName: "bash", input: { command: "cat ~/.env" } });
    tel.observeToolCall({
      toolName: "code_search",
      input: { query: "where login is invalidated" },
    });
    tel.observeToolCall({
      toolName: "memory_query",
      input: { query: "api_key=sk-abcdefghijklmnopqrstuvwxyz", scope: "project" },
    });
    tel.observeToolCall({
      toolName: "secret_vault_put",
      input: { name: "OPENAI_API_KEY", value: "sk-secretvalue" },
    });
    await tel.pending();
    const rows = lines(await readFile(join(agentDir, RETRIEVAL_ATTRIBUTION_FILENAME), "utf8"));
    const names = rows.filter((row) => row.kind === RETRIEVAL_ATTRIBUTION_KIND).map((row) => row.tool);
    expect(names).toEqual(["bash", "code_search", "memory_query", "secret_vault_put"]);
    const search = rows.find((row) => row.tool === "code_search");
    expect(search?.retrieval?.query).toBe("where login is invalidated");
    const memory = rows.find((row) => row.tool === "memory_query");
    const vault = rows.find((row) => row.tool === "secret_vault_put");
    expect(memory?.retrieval).toBeUndefined();
    expect(vault?.retrieval).toBeUndefined();
    expect(JSON.stringify(memory)).not.toMatch(/api_key|sk-/);
    expect(JSON.stringify(vault)).not.toMatch(/OPENAI_API_KEY|sk-secretvalue/);
    expect(JSON.stringify(rows.find((row) => row.tool === "bash"))).not.toContain("~/.env");
  });
});

describe("available-but-unused summary", () => {
  it("exposes unused tools and treats durable zero-use as eligibility, not a defect", () => {
    const tools = ["bash", "code_search", "grep", "memory_query", "read", "session_recall"];
    const toolset = normalizeAvailableTools(tools);
    const records: RetrievalAttributionRecord[] = [
      {
        v: 1,
        kind: ATTRIBUTION_TURN_KIND,
        ts: "t",
        role: "worker",
        agent: "explore",
        model: "xai/grok-4.5",
        availableToolIds: toolset.availableToolIds,
        availableToolCount: toolset.availableToolCount,
        toolsetHash: toolset.toolsetHash,
      },
      {
        v: 1,
        kind: RETRIEVAL_ATTRIBUTION_KIND,
        ts: "t",
        role: "worker",
        agent: "explore",
        model: "xai/grok-4.5",
        tool: "grep",
        toolsetHash: toolset.toolsetHash,
      },
    ];
    const summary = summarizeAttributionRecords(records);
    const slice = summary.slices[0];
    expect(slice?.availableToolCount).toBe(6);
    expect(slice?.used).toEqual(["grep"]);
    expect(slice?.unused).toEqual(["bash", "code_search", "memory_query", "read", "session_recall"]);
    const durable = slice?.groups.find((group) => group.group === "durable");
    expect(durable).toMatchObject({
      available: ["memory_query", "session_recall"],
      used: [],
      unused: ["memory_query", "session_recall"],
      calls: 0,
      note: "eligibility-not-defect",
    });
    const formatted = formatAttributionSummary(summary);
    expect(formatted).toContain("eligibility-not-defect");
    expect(formatted).not.toMatch(/\tdefect\b/);
    expect(formatted).toContain("filesystem\t3\t1\t2\t1");
    expect(formatted).toContain("retrieval\t1\t0\t1\t0");
  });
});
