import { mkdtemp, readFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ATTRIBUTION_RESULT_KIND,
  ATTRIBUTION_TURN_KIND,
  AVAILABLE_TOOL_BOUND,
  READ_PATH_BOUND,
  RETRIEVAL_ATTRIBUTION_FILENAME,
  RETRIEVAL_ATTRIBUTION_KIND,
  RETRIEVAL_ATTRIBUTION_VERSION,
  RETRIEVAL_ATTRIBUTION_V1,
  boundRetrievalInput,
  buildAttributionRecord,
  buildAttributionResult,
  classifyGrepPattern,
  createRetrievalAttribution,
  formatAttributionSummary,
  hashPrompt,
  isGlobalPiHome,
  isProjectLocalAgentHome,
  normalizeAvailableTools,
  serializeAttributionRecord,
  summarizeAttributionFile,
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

describe("read target normalization", () => {
  it("records project-relative read paths, offset, and limit without content", async () => {
    const agentDir = await dir();
    const projectRoot = join(agentDir, "..", "..");
    const tel = createRetrievalAttribution({ agentDir });
    tel.observeToolCall({
      toolName: "read",
      toolCallId: "r1",
      sessionId: "s1",
      input: { path: join(projectRoot, "src", "app.ts"), offset: 120, limit: 40 },
    });
    tel.observeToolCall({
      toolName: "read",
      toolCallId: "r2",
      sessionId: "s1",
      input: { paths: ["./src/a.ts", "src/a.ts", "docs/b.md"], offset: 0 },
    });
    await tel.pending();
    const rows = lines(await readFile(join(agentDir, RETRIEVAL_ATTRIBUTION_FILENAME), "utf8"));
    const first = rows.find((row) => row.toolCallId === "r1");
    expect(first?.retrieval?.paths).toEqual(["src/app.ts"]);
    expect(first?.retrieval?.offset).toBe(120);
    expect(first?.retrieval?.limit).toBe(40);
    expect(first?.v).toBe(RETRIEVAL_ATTRIBUTION_VERSION);
    expect(JSON.stringify(first)).not.toContain("\.\.");
    const second = rows.find((row) => row.toolCallId === "r2");
    // Deduplicated in order; leading ./ stripped.
    expect(second?.retrieval?.paths).toEqual(["src/a.ts", "docs/b.md"]);
    expect(second?.retrieval?.offset).toBe(0);
  });

  it("collapses outside-project and home read targets without leaking locations", () => {
    const retrieval = boundRetrievalInput("read", {
      paths: [join(homedir(), "secrets", "auth.json"), "~/notes.txt", "/etc/hosts"],
    }, "/somewhere/else/projectroot") as NonNullable<ReturnType<typeof boundRetrievalInput>>;
    expect(retrieval.paths?.every((path) => path === "[outside-project]")).toBe(true);
    expect(retrieval.redacted).toContain("paths");
    expect(JSON.stringify(retrieval)).not.toContain(homedir());
    expect(JSON.stringify(retrieval)).not.toContain("/etc/hosts");
  });

  it("drops secret-bearing, oversized, and malformed read arguments", () => {
    const retrieval = boundRetrievalInput(
      "read",
      {
        path: "token=sk-abcdefghijklmnopqrstuvwxyz.ts",
        offset: -5,
        limit: Number.NaN,
        paths: [`${"x".repeat(300)}.ts`],
      },
      "/proj",
    ) as NonNullable<ReturnType<typeof boundRetrievalInput>>;
    // Secret path vanishes; its field is flagged redacted, not stored.
    expect(JSON.stringify(retrieval)).not.toMatch(/sk-/);
    expect(retrieval.paths?.join("")).not.toContain("sk-");
    expect(retrieval.redacted?.length ?? 0).toBeGreaterThan(0);
    expect(retrieval.offset).toBeUndefined();
    expect(retrieval.limit).toBeUndefined();
    for (const path of retrieval.paths ?? []) expect(path.length).toBeLessThanOrEqual(200);
  });

  it("caps stored read paths at the documented bound", () => {
    const many = Array.from({ length: READ_PATH_BOUND + 6 }, (_, i) => `f${i}.ts`);
    const retrieval = boundRetrievalInput("read", { paths: many }, "/proj") as NonNullable<
      ReturnType<typeof boundRetrievalInput>
    >;
    expect(retrieval.paths).toHaveLength(READ_PATH_BOUND);
    expect(retrieval.truncated).toContain("paths");
  });

  it("never stores page content fields passed to read", () => {
    const retrieval = boundRetrievalInput("read", { path: "a.ts", content: "SECRET BODY", text: "more" }, "/proj");
    expect(JSON.stringify(retrieval)).not.toContain("SECRET BODY");
  });
});

describe("post-result metadata", () => {
  it("extracts structured retrieval funnel fields and nothing else", () => {
    const result = buildAttributionResult(false, {
      schemaVersion: 1,
      kind: "code-retrieval.search",
      hits: [
        { ref: "R1", path: "src/a.ts", startLine: 1, endLine: 9 },
        { ref: "R2", path: "src/b.ts", startLine: 10, endLine: 20, alreadyRead: true },
        { ref: "R3", path: "src/c.ts", startLine: 21, endLine: 30 },
      ],
      resultsPath: ".pi/agent/code-retrieval/results/abc.jsonl",
      degraded: false,
      query: "internal state that must not leak",
      content: [{ type: "text", text: "SOURCE BODY THAT MUST NOT LEAK" }],
    });
    expect(result.ok).toBe(true);
    expect(result.resultKind).toBe("code-retrieval.search");
    expect(result.degraded).toBe(false);
    expect(result.hitCount).toBe(3);
    expect(result.alreadyReadCount).toBe(1);
    expect(result.resultsPath).toBe(".pi/agent/code-retrieval/results/abc.jsonl");
    expect(result.refs).toEqual(["R1", "R2", "R3"]);
    expect(JSON.stringify(result)).not.toContain("internal state");
    expect(JSON.stringify(result)).not.toContain("SOURCE BODY");
  });

  it("marks explicitly errored calls and omits duration when no call was observed", () => {
    const errored = buildAttributionResult(true, { kind: "code-retrieval.spans", degraded: true, hits: [] });
    expect(errored.ok).toBe(false);
    expect(errored.degraded).toBe(true);
    expect(errored.durationMs).toBeUndefined();
    const unknownFlag = buildAttributionResult(undefined, undefined);
    expect(unknownFlag.ok).toBe(true);
    expect(Object.keys(unknownFlag)).toEqual(["ok"]);
  });

  it("correlates a tool_result event with its call id and measures bounded latency", async () => {
    const agentDir = await dir();
    let tick = 0;
    const clock = () => new Date(Date.UTC(2026, 7, 23, 12, 0, tick++));
    const tel = createRetrievalAttribution({ agentDir, now: clock });
    tel.observeToolCall({
      toolName: "code_search",
      toolCallId: "cs9",
      sessionId: "s1",
      input: { query: "where the session token gets refreshed" },
    });
    tel.observeToolResult({
      toolName: "code_search",
      toolCallId: "cs9",
      sessionId: "s1",
      isError: false,
      details: { kind: "code-retrieval.search", degraded: true, hitCountHint: 99, hits: [{ ref: "R1", alreadyRead: true }] },
    });
    // Unknown result (no observed call): recorded, but latency stays absent.
    tick += 4;
    tel.observeToolResult({
      toolName: "read_spans",
      toolCallId: "sp1",
      sessionId: "s1",
      isError: false,
      details: { kind: "code-retrieval.spans", hits: [] },
    });
    await tel.pending();
    const raw = await readFile(join(agentDir, RETRIEVAL_ATTRIBUTION_FILENAME), "utf8");
    const rows = lines(raw);
    const correlated = rows.find((row) => row.kind === ATTRIBUTION_RESULT_KIND && row.toolCallId === "cs9");
    expect(correlated?.tool).toBe("code_search");
    expect(correlated?.sessionId).toBe("s1");
    expect(correlated?.result?.ok).toBe(true);
    expect(correlated?.result?.degraded).toBe(true);
    expect(correlated?.result?.hitCount).toBe(1);
    expect(correlated?.result?.alreadyReadCount).toBe(1);
    expect(correlated?.result?.durationMs).toBe(1000);
    // Fields absent at the seam stay absent: no invented provider, no leaked hint.
    expect(correlated?.result?.refs).toEqual(["R1"]);
    expect(JSON.stringify(correlated)).not.toContain("hitCountHint");
    const orphan = rows.find((row) => row.kind === ATTRIBUTION_RESULT_KIND && row.toolCallId === "sp1");
    expect(orphan?.result?.durationMs).toBeUndefined();
  });

  it("stamps the last noted runtime index on calls, honoring explicit overrides", async () => {
    const agentDir = await dir();
    const tel = createRetrievalAttribution({ agentDir });
    expect(tel.noteTurnIndex(3)).toBe(3);
    tel.observeToolCall({ toolName: "grep", toolCallId: "g1", input: { pattern: "x" } });
    tel.observeToolCall({ toolName: "grep", toolCallId: "g2", input: { pattern: "y" }, turnIndex: 7 });
    // Invalid values never clobber the last real index.
    expect(tel.noteTurnIndex(-1)).toBe(3);
    expect(tel.noteTurnIndex(Number.NaN)).toBe(3);
    tel.observeToolCall({ toolName: "grep", toolCallId: "g3", input: { pattern: "z" } });
    await tel.pending();
    const rows = lines(await readFile(join(agentDir, RETRIEVAL_ATTRIBUTION_FILENAME), "utf8"));
    expect(rows.find((row) => row.toolCallId === "g1")?.turnIndex).toBe(3);
    expect(rows.find((row) => row.toolCallId === "g2")?.turnIndex).toBe(7);
    expect(rows.find((row) => row.toolCallId === "g3")?.turnIndex).toBe(3);
  });

  it("absent indices stay absent rather than invented", () => {
    expect(buildAttributionRecord({ toolName: "grep", turnIndex: -2 })?.turnIndex).toBeUndefined();
    expect(buildAttributionRecord({ toolName: "grep" })?.turnIndex).toBeUndefined();
  });
});

describe("versioned compatibility", () => {
  it("still summarizes v1 attribution files without new fields", async () => {
    const agentDir = await dir();
    const file = join(agentDir, RETRIEVAL_ATTRIBUTION_FILENAME);
    const v1Lines = [
      JSON.stringify({
        v: 1,
        kind: ATTRIBUTION_TURN_KIND,
        ts: "2026-08-01T00:00:00.000Z",
        role: "worker",
        agent: "explore",
        model: "x/y",
        availableToolIds: ["grep", "read"],
        availableToolCount: 2,
        toolsetHash: "hash-v1",
      }),
      JSON.stringify({
        v: 1,
        kind: RETRIEVAL_ATTRIBUTION_KIND,
        ts: "2026-08-01T00:00:01.000Z",
        role: "worker",
        agent: "explore",
        tool: "read",
        toolsetHash: "hash-v1",
      }),
    ];
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(agentDir, { recursive: true });
    await writeFile(file, v1Lines.join("\n") + "\n", "utf8");
    const summary = await summarizeAttributionFile(file);
    expect(summary.turns).toBe(1);
    expect(summary.calls).toBe(1);
    // A v1 read has no targets: denominator counts it, numerator stays zero.
    expect(summary.coverage.readCalls).toBe(1);
    expect(summary.coverage.readCallsWithTarget).toBe(0);
    expect(formatAttributionSummary(summary)).toContain("worker\texplore\tread\t1");
  });

  it("rejects records from a future schema version instead of misreading them", async () => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const agentDir = await dir();
    const file = join(agentDir, RETRIEVAL_ATTRIBUTION_FILENAME);
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      file,
      `${JSON.stringify({ v: RETRIEVAL_ATTRIBUTION_VERSION + 1, kind: RETRIEVAL_ATTRIBUTION_KIND, ts: "t", tool: "grep" })}\n`,
      "utf8",
    );
    const summary = await summarizeAttributionFile(file);
    expect(summary.calls).toBe(0);
    expect(summary.total).toBe(0);
  });

  it("keeps serializer allowlisting strict for new containers", () => {
    const line = serializeAttributionRecord({
      v: RETRIEVAL_ATTRIBUTION_VERSION,
      kind: RETRIEVAL_ATTRIBUTION_KIND,
      ts: "t",
      tool: "grep",
      result: "junk-not-an-object" as unknown as RetrievalAttributionRecord["result"],
      retrieval: "junk" as unknown as RetrievalAttributionRecord["retrieval"],
      provider: "made-up",
    } as RetrievalAttributionRecord);
    expect(line).not.toContain("provider");
    expect(line).not.toContain("junk");
    const roundTrip = JSON.parse(line) as RetrievalAttributionRecord;
    expect(roundTrip.result).toBeUndefined();
    expect(roundTrip.retrieval).toBeUndefined();
  });
});

describe("summarizer coverage and retrieval funnel", () => {
  function searchDetails(hitCount: number, opts: { degraded?: boolean; durationMs?: number } = {}) {
    return {
      ok: true,
      resultKind: "code-retrieval.search",
      degraded: opts.degraded === true,
      hitCount,
      refs: Array.from({ length: Math.min(hitCount, 12) }, (_, i) => `R${i + 1}`),
      ...(opts.durationMs !== undefined ? { durationMs: opts.durationMs } : {}),
    };
  }

  it("reports coverage denominators plus outcome, degradation, hit, and latency funnels", () => {
    const toolset = normalizeAvailableTools(["grep", "read", "code_search", "read_spans"]);
    const records: RetrievalAttributionRecord[] = [
      { v: 1, kind: ATTRIBUTION_TURN_KIND, ts: "t", role: "main", agent: "main", availableToolIds: toolset.availableToolIds, availableToolCount: 4, toolsetHash: "h" },
      { v: 2, kind: RETRIEVAL_ATTRIBUTION_KIND, ts: "t", role: "main", agent: "main", tool: "read", toolCallId: "r1", retrieval: { paths: ["src/a.ts"] } },
      { v: 2, kind: RETRIEVAL_ATTRIBUTION_KIND, ts: "t", role: "main", agent: "main", tool: "read", toolCallId: "r2" },
      { v: 2, kind: RETRIEVAL_ATTRIBUTION_KIND, ts: "t", role: "main", agent: "main", tool: "code_search", toolCallId: "cs1" },
      { v: 2, kind: ATTRIBUTION_RESULT_KIND, ts: "t", role: "main", agent: "main", tool: "code_search", toolCallId: "cs1", result: searchDetails(8, { degraded: true, durationMs: 100 }) },
      { v: 2, kind: ATTRIBUTION_RESULT_KIND, ts: "t", role: "main", agent: "main", tool: "code_search", toolCallId: "cs2", result: { ...searchDetails(2), ok: false, durationMs: 300 } },
    ];
    const summary = summarizeAttributionRecords(records);
    expect(summary.calls).toBe(3);
    expect(summary.coverage).toMatchObject({ turns: 1, calls: 3, results: 2, readCalls: 2, readCallsWithTarget: 1, indexedSearchCalls: 1 });
    const okRow = summary.results.find((row) => row.outcome === "ok");
    expect(okRow).toMatchObject({ tool: "code_search", count: 1, degraded: 1, hitsSum: 8, maxHits: 8 });
    const errorRow = summary.results.find((row) => row.outcome === "error");
    expect(errorRow).toMatchObject({ tool: "code_search", count: 1, degraded: 0, hitsSum: 2 });
    expect(okRow?.durationsMs).toEqual([100]);
    const formatted = formatAttributionSummary(summary);
    expect(formatted).toContain("coverage=turns:1\tcalls:3\tresults:2\treadCalls:2\treadCallsWithTarget:1\tindexedSearchCalls:1");
    expect(formatted).toContain("main\tmain\tcode_search\tcode-retrieval.search\tok\t1\t1\t8\t8\t100\t100\t100");
    // Legacy sections survive next to the new ones.
    expect(formatted).toContain("role\tagent\ttool\tcount");
    expect(formatted).toContain("role\tagent\tmodel\tunusedTools");
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

describe("telemetry path normalization across path-bearing tools", () => {
  it("redacts relative .. escapes without logging destinations", () => {
    const grepEscape = boundRetrievalInput("grep", { pattern: "token", path: "../../etc/shadow" }, "/proj");
    expect(grepEscape?.path).toBe("[outside-project]");
    expect(grepEscape?.redacted).toContain("path");
    expect(JSON.stringify(grepEscape)).not.toMatch(/\.\.|etc|shadow/);

    // An interior escape hidden behind a benign prefix is caught too.
    const navEscape = boundRetrievalInput(
      "code_nav",
      { operation: "definition", symbol: "S", path: "src/../../../../outside/secret.ts" },
      "/somewhere/projectroot",
    );
    expect(navEscape?.path).toBe("[outside-project]");
    expect(JSON.stringify(navEscape)).not.toContain("outside/secret.ts");

    const readInterior = boundRetrievalInput("read", { paths: ["docs/../../../*.env"] }, "/proj");
    expect(readInterior?.paths?.join(",")).toBe("[outside-project]");
  });

  it("normalizes absolute paths for grep, find, code_search, and code_nav alike", () => {
    const projectRoot = "/fake-checkout-that-does-not-exist";
    const outsidePath = join(homedir(), "elsewhere", "notes.md");
    const cases: Array<[string, Record<string, unknown>]> = [
      ["grep", { pattern: "composePhilosophy" }],
      ["find", { pattern: "*.test.ts" }],
      ["code_search", { query: "where login state is invalidated" }],
      ["code_nav", { operation: "references", symbol: "observeToolCall" }],
    ];
    for (const [toolName, base] of cases) {
      const inside = boundRetrievalInput(toolName, { ...base, path: join(projectRoot, "src", "app.ts") }, projectRoot);
      expect(inside?.path, `${toolName} inside`).toBe("src/app.ts");
      const outside = boundRetrievalInput(toolName, { ...base, path: outsidePath }, projectRoot);
      expect(outside?.path, `${toolName} outside`).toBe("[outside-project]");
      expect(JSON.stringify(outside)).not.toContain(homedir());
    }
  });

  it("keeps tilde targets as markers for non-read tools too", () => {
    const retrieval = boundRetrievalInput("grep", { pattern: "x", path: "~/secrets.txt" }, "/proj");
    expect(retrieval?.path).toBe("[outside-project]");
    expect(JSON.stringify(retrieval)).not.toContain("~/");
  });

  it("bounds and redacts paths[] arrays for grep/find while preserving safe entries", () => {
    const mixed = boundRetrievalInput(
      "grep",
      {
        pattern: "x",
        ignoreCase: true,
        paths: ["src/a.ts", join(homedir(), "outside.ts"), "~/b.md", "lib/../../gone.rs"],
      },
      "/proj",
    );
    expect(mixed?.paths).toEqual(["src/a.ts", "[outside-project]"]);
    expect(mixed?.redacted).toContain("paths");
    expect(JSON.stringify(mixed)).not.toContain(homedir());
    expect(JSON.stringify(mixed)).not.toContain("outside.ts");

    const overflow = boundRetrievalInput(
      "find",
      { pattern: "*", paths: Array.from({ length: READ_PATH_BOUND + 4 }, (_, i) => `f${i}.ts`) },
      "/proj",
    );
    expect(overflow?.paths).toHaveLength(READ_PATH_BOUND);
    expect(overflow?.truncated).toContain("paths");

    // Array inputs never disturb scalar field extraction.
    expect(mixed?.patternKind).toBe("exact");
  });

  it("canonicalizes safe paths (./ prefixes collapse) instead of dropping them", () => {
    const search = boundRetrievalInput("code_search", { query: "q", mode: "auto", path: "./packages/ui/src" }, "/repo");
    expect(search?.path).toBe("packages/ui/src");
  });

  it("redacts symlink escapes and keeps genuinely in-project symlinks readable-relative", async () => {
    const { mkdir, mkdtemp, symlink, writeFile } = await import("node:fs/promises");
    const projectRoot = await mkdtemp(join(tmpdir(), "attr-sym-root-"));
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await writeFile(join(projectRoot, "src", "safe.ts"), "export const ok = true;\n");
    const outside = await mkdtemp(join(tmpdir(), "attr-sym-out-"));
    await writeFile(join(outside, "secret.env"), "LEAK=1\n");
    // Escape: symlink inside the checkout pointing at an outside directory.
    await symlink(outside, join(projectRoot, "leak"));
    // Safe: in-project symlink whose target stays inside.
    await symlink("safe.ts", join(projectRoot, "src", "alias.ts"));

    const retrieval = boundRetrievalInput(
      "read",
      { paths: ["leak/secret.env", "src/safe.ts", "src/alias.ts"] },
      projectRoot,
    ) as NonNullable<ReturnType<typeof boundRetrievalInput>>;

    expect(retrieval.paths).toEqual(["[outside-project]", "src/safe.ts", "src/alias.ts"]);
    expect(retrieval.redacted).toContain("paths");
    expect(JSON.stringify(retrieval)).not.toContain(outside);
    expect(JSON.stringify(retrieval)).not.toContain("LEAK");
  });

  it("still applies symlink containment when writing via create-before-read leaves", async () => {
    // Leaf does not exist, parent inside a symlinked directory chain: closest resolvable ancestor decides.
    const { mkdir, mkdtemp, symlink } = await import("node:fs/promises");
    const projectRoot = await mkdtemp(join(tmpdir(), "attr-sym2-root-"));
    await mkdir(join(projectRoot, "gen"), { recursive: true });
    const outside = await mkdtemp(join(tmpdir(), "attr-sym2-out-"));
    await symlink(outside, join(projectRoot, "gen", "out"));
    const retrieval = boundRetrievalInput("read", { paths: ["gen/out/new-file.txt"] }, projectRoot);
    expect(retrieval?.paths).toEqual(["[outside-project]"]);
    expect(JSON.stringify(retrieval)).not.toContain(outside);
  });

  it("redacts escapes through nonexistent descendants of an outside-pointing symlink", async () => {
    // link-out exists and points outside; every path beneath it is missing, so both
    // the target realpath and the immediate-parent fallback used to bail out and
    // skip containment. The deepest existing ancestor must decide instead.
    const { mkdir, mkdtemp, symlink } = await import("node:fs/promises");
    const projectRoot = await mkdtemp(join(tmpdir(), "attr-sym3-root-"));
    await mkdir(join(projectRoot, "project"), { recursive: true });
    const outside = await mkdtemp(join(tmpdir(), "attr-sym3-out-"));
    await symlink(outside, join(projectRoot, "project", "link-out"));
    const missingUnderEscape = join("project", "link-out", "missing", "deeper.ts");
    const cases: Array<[string, Record<string, unknown>]> = [
      ["read", { paths: [missingUnderEscape] }],
      ["grep", { pattern: "x", path: missingUnderEscape }],
      ["find", { pattern: "*.ts", paths: [missingUnderEscape] }],
      ["code_search", { query: "q", path: missingUnderEscape }],
      ["code_nav", { operation: "definition", symbol: "S", path: missingUnderEscape }],
    ];
    for (const [toolName, input] of cases) {
      const bounded = boundRetrievalInput(toolName, input, projectRoot);
      expect(bounded?.path ?? bounded?.paths?.[0], `${toolName} escape`).toBe("[outside-project]");
      expect(JSON.stringify(bounded), `${toolName} leak`).not.toContain(outside);
      expect(JSON.stringify(bounded), `${toolName} leak deeper.ts`).not.toContain("deeper.ts");
    }
  });

  it("keeps not-yet-created descendants under an in-project ancestor recorded normally", async () => {
    // Missing nested dirs under a real in-project ancestor (macOS tmpdir is itself
    // an alias) still resolve against the deepest existing ancestor and stay inside.
    const { mkdir, mkdtemp } = await import("node:fs/promises");
    const projectRoot = await mkdtemp(join(tmpdir(), "attr-sym4-root-"));
    await mkdir(join(projectRoot, "project", "src"), { recursive: true });
    const safeNested = join("project", "src", "new-dir", "generated.ts");
    const read = boundRetrievalInput("read", { paths: [safeNested] }, projectRoot);
    expect(read?.paths).toEqual([safeNested]);
    expect(read?.redacted).toBeUndefined();
    const nav = boundRetrievalInput(
      "code_nav",
      { operation: "references", symbol: "X", path: safeNested },
      projectRoot,
    );
    expect(nav?.path).toBe(safeNested);
    expect(nav?.redacted).toBeUndefined();
  });
});

describe("provider provenance ingestion and coverage", () => {
  it("records the executor provider reported in structured details only", () => {
    const result = buildAttributionResult(false, {
      kind: "code-retrieval.search",
      provider: "tantivy",
      degraded: false,
      hits: [{ ref: "R1", path: "src/a.ts" }, { ref: "R2", path: "src/b.ts" }],
      content: [{ type: "text", text: "BODY MUST NOT LEAK" }],
    });
    expect(result.provider).toBe("tantivy");
    expect(result.hitCount).toBe(2);
    expect(JSON.stringify(result)).not.toContain("BODY MUST NOT LEAK");

    const absentProvider = buildAttributionResult(false, { kind: "read.note" });
    expect(absentProvider.provider).toBeUndefined();

    // Untrusted-looking provider strings are screened like every other value.
    const secretish = buildAttributionResult(false, { kind: "k", provider: "token=sk-abcdefghijklmnopqrstuvwxyz" });
    expect(secretish.provider).toBeUndefined();
    expect(secretish.redacted).toContain("provider");
    expect(JSON.stringify(secretish)).not.toMatch(/sk-/);
  });

  it("flows provider through a correlated tool_result record within the serializer allowlist", async () => {
    const agentDir = await dir();
    const tel = createRetrievalAttribution({ agentDir });
    tel.observeToolCall({
      toolName: "code_search",
      toolCallId: "pv1",
      sessionId: "s1",
      input: { query: "where the session token gets refreshed" },
    });
    tel.observeToolResult({
      toolName: "code_search",
      toolCallId: "pv1",
      isError: false,
      details: {
        kind: "code-retrieval.search",
        degraded: false,
        provider: "tantivy",
        hits: [{ ref: "R1" }, { ref: "R2", alreadyRead: true }],
      },
    });
    await tel.pending();
    const row = lines(await readFile(join(agentDir, RETRIEVAL_ATTRIBUTION_FILENAME), "utf8")).find(
      (item) => item.kind === ATTRIBUTION_RESULT_KIND && item.toolCallId === "pv1",
    );
    expect(row?.result?.provider).toBe("tantivy");
    expect(row?.result?.hitCount).toBe(2);
    expect(row?.result?.alreadyReadCount).toBe(1);
    expect(JSON.stringify(row)).not.toContain("where the session token gets refreshed");
  });

  it("aggregates provider coverage metrics without storing any result content", () => {
    const records: RetrievalAttributionRecord[] = [
      { v: 2, kind: ATTRIBUTION_TURN_KIND, ts: "t", role: "main", agent: "main", availableToolIds: ["code_search"], availableToolCount: 1, toolsetHash: "h" },
      { v: 2, kind: RETRIEVAL_ATTRIBUTION_KIND, ts: "t", role: "main", agent: "main", tool: "code_search", toolsetHash: "h" },
      { v: 2, kind: ATTRIBUTION_RESULT_KIND, ts: "t", role: "main", agent: "main", tool: "code_search", toolCallId: "c1", result: { ok: true, resultKind: "code-retrieval.search", provider: "tantivy", hitCount: 5 } },
      { v: 2, kind: ATTRIBUTION_RESULT_KIND, ts: "t", role: "main", agent: "main", tool: "code_search", toolCallId: "c2", result: { ok: false, resultKind: "code-retrieval.search", provider: "tantivy", degraded: true } },
      { v: 2, kind: ATTRIBUTION_RESULT_KIND, ts: "t", role: "worker", agent: "explore", model: "m", tool: "grep", toolCallId: "g1", result: { ok: true, resultKind: "native.grep", provider: "rg" } },
      { v: 2, kind: ATTRIBUTION_RESULT_KIND, ts: "t", role: "main", agent: "main", tool: "read", toolCallId: "r9", result: { ok: true, resultKind: "read.note" } },
    ];
    const summary = summarizeAttributionRecords(records);
    expect(summary.coverage.results).toBe(4);
    expect(summary.coverage.resultsWithProvider).toBe(3);
    expect(summary.providers).toEqual([
      { role: "main", agent: "main", tool: "code_search", provider: "tantivy", count: 2, degraded: 1 },
      { role: "worker", agent: "explore", tool: "grep", provider: "rg", count: 1, degraded: 0 },
    ]);
    const formatted = formatAttributionSummary(summary);
    expect(formatted).toContain("role\tagent\ttool\tprovider\tcount\tdegraded");
    expect(formatted).toContain("main\tmain\tcode_search\ttantivy\t2\t1");
    expect(formatted).toContain("resultsWithProvider:3");
    // Legacy sections stay intact beside the new one.
    expect(formatted).toContain("role\tagent\ttool\tresultKind\toutcome\tcount\tdegraded\thitsSum\tmaxHits\tp50Ms\tp95Ms\tmaxMs");
  });

  it("v1-era files summarize cleanly with zero provider coverage", async () => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const agentDir = await dir();
    const file = join(agentDir, RETRIEVAL_ATTRIBUTION_FILENAME);
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      file,
      `${JSON.stringify({ v: 1, kind: RETRIEVAL_ATTRIBUTION_KIND, ts: "t", role: "worker", agent: "explore", tool: "grep" })}\n`,
      "utf8",
    );
    const summary = await summarizeAttributionFile(file);
    expect(summary.calls).toBe(1);
    expect(summary.coverage.resultsWithProvider).toBe(0);
    expect(summary.providers).toEqual([]);
  });
});
