import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerInputFilesHooks } from "../agent/input-files-hooks.js";
import { createStructuredOutputHooks } from "../agent/structured-output-hooks.js";
import { StructuredOutputController } from "../agent/structured-output-controller.js";
import { SessionInputFileStore } from "../agent/files/state.js";
import {
  collectResponsesStream,
  interpretAndEmit,
  projectCollectedEvents,
  uninstallHostedSearchCapture,
  type HostedAssistantEvent,
} from "../../../resources/runtime/extensions/hosted-search-events.ts";
import { projectHostedAssistantEvent } from "../../pi-backend/src/hosted-search-stream.js";

const EXTENSION = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), "../../../resources/runtime/extensions/pipiui-xai-server-tools.ts"),
).href;
const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

type Handler = (event: any, ctx: any) => unknown;

async function loadXaiServerTools() {
  vi.resetModules();
  const handlers = new Map<string, Handler[]>();
  const pi = {
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    registerCommand: vi.fn(),
    registerProvider: vi.fn(),
  };
  const extension = (await import(`${EXTENSION}?t=${Date.now()}`)).default;
  extension(pi as never);
  return { handlers };
}

const schema = {
  type: "object",
  additionalProperties: false,
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
};

const structuredText = {
  format: {
    type: "json_schema",
    name: "flag",
    schema,
    strict: true,
  },
};

function activateStructuredOutput(sessionId = "sess-cross") {
  const controller = new StructuredOutputController();
  controller.set(sessionId, { name: "flag", schema, strict: true });
  return createStructuredOutputHooks({ controller });
}

function grokAllCaps(overrides: Record<string, unknown> = {}) {
  return {
    model: {
      provider: "grok-build",
      api: "openai-responses",
      id: "grok-4.6",
      capabilities: {
        nativeSearch: { tools: ["web_search", "x_search"] },
        hostedTools: { tools: ["code_interpreter"] },
        structuredOutputs: true,
        inputFiles: true,
      },
      ...overrides,
    },
    sessionManager: { getSessionId: () => "sess-cross" },
  };
}

function responsesPayload(overrides: Record<string, unknown> = {}) {
  return {
    model: "grok-4.6",
    stream: true,
    input: [{ role: "user", content: "look" }],
    tools: [
      { type: "function", name: "bash" },
      { type: "function", name: "web_search" },
    ],
    include: ["file_search_call.results"],
    ...overrides,
  };
}

function leakProbe(value: unknown) {
  const json = JSON.stringify(value);
  expect(json).not.toContain("file-secret");
  expect(json).not.toContain("file-notes");
  expect(json).not.toContain("file-anon");
  expect(json).not.toContain("/secret/");
  expect(json).not.toContain("access_token");
  expect(json).not.toContain("token=secret");
  expect(json).not.toContain("file-abc");
  expect(json).not.toMatch(/data:[^"]*;base64,/);
}

describe("cross-capability live hook composition", () => {
  afterEach(() => {
    uninstallHostedSearchCapture();
  });

  it("xAI hook then Files hook keep search, code include, text.format, and input_file without clobber or dupes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "grok-cross-hooks-"));
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = dir;
    try {
      await new SessionInputFileStore(dir).write("sess-cross", [{
        id: "att-1",
        name: "notes.md",
        size: 12,
        mimeType: "text/markdown",
        status: "ready",
        fileId: "file-abc",
      }]);
      const { handlers } = await loadXaiServerTools();
      const xaiBefore = handlers.get("before_provider_request")?.[0];
      const files = registerInputFilesHooks({ on() { /* unused */ } }, { resolveHome: () => dir });
      const structured = activateStructuredOutput();
      const incoming = responsesPayload();
      expect(incoming).not.toHaveProperty("text");
      const afterXai = xaiBefore?.(
        { type: "before_provider_request", payload: incoming },
        grokAllCaps(),
      ) as Record<string, unknown>;
      expect(afterXai.tools).toEqual([
        { type: "function", name: "bash" },
        { type: "web_search" },
        { type: "x_search" },
        { type: "code_interpreter" },
      ]);
      expect(afterXai.include).toEqual(["file_search_call.results", "code_interpreter_call.outputs"]);
      expect(afterXai).not.toHaveProperty("text");
      expect(afterXai.input).toEqual(incoming.input);
      expect(JSON.stringify(afterXai.tools).match(/web_search/g)).toHaveLength(1);
      expect(JSON.stringify(afterXai.tools).match(/code_interpreter/g)).toHaveLength(1);

      const afterStructured = await structured.beforeProviderRequest(
        { type: "before_provider_request", payload: afterXai },
        grokAllCaps(),
      ) as Record<string, unknown>;
      expect(afterStructured.tools).toEqual(afterXai.tools);
      expect(afterStructured.include).toEqual(afterXai.include);
      expect(afterStructured.input).toEqual(afterXai.input);
      expect(afterStructured.text).toEqual(structuredText);

      const afterFiles = await files.beforeProviderRequest(
        { type: "before_provider_request", payload: afterStructured },
        grokAllCaps(),
      ) as Record<string, unknown>;
      expect(afterFiles.tools).toEqual(afterXai.tools);
      expect(afterFiles.include).toEqual(afterXai.include);
      expect(afterFiles.text).toEqual(structuredText);
      expect(afterFiles.input).toEqual([{
        role: "user",
        content: [
          { type: "input_text", text: "look" },
          { type: "input_file", file_id: "file-abc" },
        ],
      }]);
      expect(JSON.stringify(afterFiles).match(/"type":"json_schema"/g)).toHaveLength(1);
    } finally {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("setter activation writes one json_schema format and does not become a function tool", async () => {
    const { handlers } = await loadXaiServerTools();
    const structured = activateStructuredOutput();
    const afterXai = handlers.get("before_provider_request")?.[0]?.(
      { type: "before_provider_request", payload: responsesPayload() },
      grokAllCaps(),
    ) as Record<string, unknown>;
    const afterStructured = await structured.beforeProviderRequest(
      { type: "before_provider_request", payload: afterXai },
      grokAllCaps(),
    ) as Record<string, unknown>;
    expect(afterStructured.text).toEqual(structuredText);
    expect(JSON.stringify(afterStructured).match(/"type":"json_schema"/g)).toHaveLength(1);
    expect(afterStructured.tools).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "function", name: "flag" }),
    ]));
    expect(JSON.stringify(afterStructured.tools)).not.toContain("json_schema");
  });

  it("capability matrix: unsupported capabilities stay off the wire", async () => {
    const { handlers } = await loadXaiServerTools();
    const before = handlers.get("before_provider_request")?.[0];
    const payload = responsesPayload();

    expect(before?.(
      { type: "before_provider_request", payload },
      { model: { provider: "grok-build", api: "openai-responses", id: "grok-4.6" } },
    )).toBeUndefined();

    const xaiBare = before?.(
      { type: "before_provider_request", payload: responsesPayload({ search_parameters: { mode: "auto" } }) },
      { model: { provider: "xai", api: "openai-responses", id: "grok-4.6" } },
    ) as Record<string, unknown> | undefined;
    expect(JSON.stringify(xaiBare?.tools ?? payload.tools)).not.toContain("\"type\":\"web_search\"");
    expect(xaiBare).not.toHaveProperty("search_parameters");

    const codeOnly = before?.(
      { type: "before_provider_request", payload },
      {
        model: {
          provider: "grok-build",
          api: "openai-responses",
          id: "grok-4.6",
          capabilities: { hostedTools: { tools: ["code_interpreter"] } },
        },
      },
    ) as Record<string, unknown>;
    expect(codeOnly.tools).toEqual(expect.arrayContaining([{ type: "code_interpreter" }]));
    expect(JSON.stringify(codeOnly.tools)).not.toContain("\"type\":\"web_search\"");
    expect(JSON.stringify(codeOnly.tools)).not.toContain("\"type\":\"x_search\"");
    expect(codeOnly.include).toEqual(["file_search_call.results", "code_interpreter_call.outputs"]);
    expect(codeOnly).not.toHaveProperty("text");
  });
});

describe("cross-capability interleaved capture / project / dedupe", () => {
  it("keeps search, code, citations, file sources and usage across interleaved SSE events", () => {
    const events = JSON.parse(readFileSync(join(fixtures, "responses-hosted-cross-capability-stream.json"), "utf8")) as unknown[];
    const live: HostedAssistantEvent[] = [];
    const seen = new Set<string>();
    for (const event of events) interpretAndEmit(event, (item) => live.push(item), seen);

    expect(live.filter((item) => item.type === "hosted_search").map((item) => item.type === "hosted_search" && item.phase)).toEqual([
      "in_progress",
      "searching",
      "completed",
    ]);
    const code = live.filter((item) => item.type === "hosted_code_interpreter");
    expect(code[0]).toMatchObject({ type: "hosted_code_interpreter", callId: "ci_cross", phase: "queued" });
    expect(code.some((item) => item.type === "hosted_code_interpreter" && item.phase === "completed" && item.code === "print(42)")).toBe(true);

    const citations = live.filter((item) => item.type === "citations").flatMap((item) => item.type === "citations" ? item.citations : []);
    expect(citations).toEqual([
      expect.objectContaining({ url: "https://docs.example/guide", startIndex: 1, endIndex: 4 }),
    ]);
    expect(citations.filter((item) => item.url === "https://docs.example/guide")).toHaveLength(1);

    const files = live.filter((item) => item.type === "input_file_sources").flatMap((item) => item.type === "input_file_sources" ? item.sources : []);
    expect(files).toEqual([
      { name: "report.pdf", url: "https://files.example/report.pdf" },
      { name: "notes.md" },
      { name: "已上传文件" },
    ]);
    expect(live.some((item) => item.type === "server_side_usage" && item.usage.serverSideToolUsage?.SERVER_SIDE_TOOL_WEB_SEARCH === 1)).toBe(true);
    leakProbe(live);

    const collected = collectResponsesStream(events);
    expect(collected.searches.map((item) => item.phase)).toEqual(["in_progress", "searching", "completed"]);
    expect(collected.codeCalls.some((item) => item.phase === "completed" && item.code === "print(42)")).toBe(true);
    expect(collected.citations).toEqual([
      expect.objectContaining({ url: "https://docs.example/guide", startIndex: 1, endIndex: 4 }),
    ]);
    expect(collected.fileSources).toEqual([
      { name: "report.pdf", url: "https://files.example/report.pdf" },
      { name: "notes.md" },
      { name: "已上传文件" },
    ]);
    const projected = projectCollectedEvents(collected);
    expect(projected.some((item) => item.type === "hosted_search")).toBe(true);
    expect(projected.some((item) => item.type === "hosted_code_interpreter")).toBe(true);
    expect(projected.some((item) => item.type === "citations")).toBe(true);
    expect(projected.some((item) => item.type === "input_file_sources")).toBe(true);
    leakProbe(projected);

    const backend = projected.flatMap((event) => projectHostedAssistantEvent("sess-cross", event as never));
    expect(backend.some((item) => item.type === "hosted_search")).toBe(true);
    expect(backend.some((item) => item.type === "hosted_code_interpreter")).toBe(true);
    expect(backend.some((item) => item.type === "citations")).toBe(true);
    expect(backend.some((item) => item.type === "input_file_sources")).toBe(true);
    leakProbe(backend);
  });
});
