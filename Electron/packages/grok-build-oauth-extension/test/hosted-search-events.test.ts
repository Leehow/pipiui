import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { processResponsesStream } from "../../../node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js";
import {
  collectResponsesStream,
  interpretAndEmit,
  parseResponsesSseChunk,
  projectCollectedEvents,
  tapResponsesStream,
  uninstallHostedSearchCapture,
  wrapFetchForHostedSearch,
  type HostedAssistantEvent,
} from "../../../resources/runtime/extensions/hosted-search-events.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadFixture(name: string): unknown[] {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8")) as unknown[];
}

const dummyModel = {
  id: "grok-4.6",
  provider: "grok-build",
  api: "openai-responses",
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} as never;

afterEach(() => {
  uninstallHostedSearchCapture();
});

describe("hosted search production stream capture", () => {
  it("feeds the golden SSE fixture through processResponsesStream without client tool execution", async () => {
    const events = loadFixture("responses-hosted-search-stream.json");
    const collected: HostedAssistantEvent[] = [];
    const seen = new Set<string>();
    const output = {
      role: "assistant",
      content: [],
      api: "openai-responses",
      provider: "grok-build",
      model: "grok-4.6",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "pending",
      timestamp: Date.now(),
    };
    const stream = { push() { /* record only via tap */ } } as never;
    await processResponsesStream(
      tapResponsesStream(events as never[], (event) => interpretAndEmit(event, (item) => collected.push(item), seen)),
      output as never,
      stream,
      dummyModel,
    );
    expect(output.content.some((block: { type?: string }) => block.type === "toolCall")).toBe(false);
    expect(collected.filter((item) => item.type === "hosted_search").map((item) => item.type === "hosted_search" && item.kind)).toEqual([
      "web_search",
      "web_search",
      "web_search",
      "x_search",
      "x_search",
    ]);
    expect(collected.some((item) => item.type === "server_side_usage" && item.usage.serverSideToolUsage?.SERVER_SIDE_TOOL_WEB_SEARCH === 1)).toBe(true);
    expect(output.stopReason === "toolUse").toBe(false);
  });

  it("parses SSE chunks and projects hosted + citation + usage events", () => {
    const sse = [
      "event: response.web_search_call.in_progress",
      'data: {"type":"response.web_search_call.in_progress","item_id":"ws_sse","output_index":1}',
      "",
      'data: {"type":"response.output_text.annotation.added","annotation":{"type":"url_citation","url":"https://docs.example","title":"Docs","start_index":1,"end_index":4}}',
      "",
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":4,"output_tokens":2,"total_tokens":6,"server_side_tool_usage":{"SERVER_SIDE_TOOL_WEB_SEARCH":2}}}}',
      "",
    ].join("\n");
    const { events } = parseResponsesSseChunk(sse);
    const projected = projectCollectedEvents(collectResponsesStream(events));
    expect(projected[0]).toMatchObject({ type: "hosted_search", callId: "ws_sse", kind: "web_search", phase: "in_progress" });
    expect(projected.some((item) => item.type === "citations" && item.citations[0]?.url === "https://docs.example")).toBe(true);
    expect(projected.some((item) => item.type === "server_side_usage" && item.usage.serverSideToolUsage?.SERVER_SIDE_TOOL_WEB_SEARCH === 2)).toBe(true);
  });

  it("tees a /responses SSE fetch without exposing raw payloads or executing tools", async () => {
    const emitted: HostedAssistantEvent[] = [];
    const body = [
      'data: {"type":"response.web_search_call.searching","item_id":"ws_fetch","action":{"query":"pipiui"}}',
      "",
      'data: {"type":"response.completed","response":{"status":"completed"}}',
      "",
    ].join("\n");
    const wrapped = wrapFetchForHostedSearch(async () => new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }), (event) => emitted.push(event));
    const response = await wrapped("https://api.x.ai/v1/responses", { method: "POST" });
    expect(await response.text()).toContain("response.web_search_call.searching");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(emitted).toEqual([
      expect.objectContaining({ type: "hosted_search", callId: "ws_fetch", kind: "web_search", phase: "searching", query: "pipiui" }),
    ]);
    expect(JSON.stringify(emitted)).not.toContain("Bearer");
  });

  it("emits hosted_code_interpreter from official call events without local execution", () => {
    const events = loadFixture("responses-hosted-code-interpreter-stream.json");
    const collected: HostedAssistantEvent[] = [];
    const seen = new Set<string>();
    for (const event of events) interpretAndEmit(event, (item) => collected.push(item), seen);
    const code = collected.filter((item) => item.type === "hosted_code_interpreter");
    expect(code[0]).toMatchObject({ type: "hosted_code_interpreter", callId: "ci_1", phase: "queued" });
    expect(code.some((item) => item.type === "hosted_code_interpreter" && item.phase === "completed" && item.code === "print(42)")).toBe(true);
    const done = [...code].reverse().find((item) => item.type === "hosted_code_interpreter" && item.phase === "completed");
    expect(done && done.type === "hosted_code_interpreter" ? done.files : undefined).toEqual([
      { filename: "plot.png", mimeType: "image/png", url: "https://files.example/plot.png" },
    ]);
    expect(JSON.stringify(code)).not.toContain("token=secret");
    expect(collected.some((item) => item.type === "server_side_usage" && item.usage.serverSideToolUsage?.SERVER_SIDE_TOOL_CODE_EXECUTION === 1)).toBe(true);
  });

  it("normalizes file citations from annotation, output item, completed JSON and SSE without leaking ids or paths", () => {
    const events = [
      {
        type: "response.output_text.annotation.added",
        annotation: {
          type: "file_citation",
          file_id: "file-1",
          filename: "/secret/docs/report.pdf",
          url: "https://files.example/report.pdf?access_token=abc",
        },
      },
      {
        type: "response.output_item.done",
        item: {
          type: "message",
          content: [{
            type: "output_text",
            text: "See [[1]](https://docs.example/guide)",
            annotations: [
              { type: "file_citation", fileId: "file-1", fileName: "C:\\Users\\haoli\\report.pdf" },
              { type: "input_file", file_id: "file-2", name: "notes.md" },
              { type: "url_citation", url: "https://docs.example/guide", title: "Guide" },
              { type: "file_citation", file_id: "file-3", filename: "local.txt", url: "file:///Users/haoli/local.txt" },
            ],
          }],
        },
      },
      {
        type: "response.completed",
        response: {
          output: [{
            type: "message",
            content: [{
              type: "output_text",
              annotations: [
                { type: "file_citation", file_id: "file-2", filename: "notes.md" },
                { type: "url_citation", url: "https://news.example/a" },
              ],
            }],
          }],
        },
      },
    ];
    const collected = collectResponsesStream(events);
    expect(collected.fileSources).toEqual([
      { name: "report.pdf", url: "https://files.example/report.pdf" },
      { name: "notes.md" },
      { name: "local.txt" },
    ]);
    expect(collected.citations.map((item) => item.url)).toEqual([
      "https://docs.example/guide",
      "https://news.example/a",
    ]);
    const projected = projectCollectedEvents(collected);
    const fileEvent = projected.find((item) => item.type === "input_file_sources");
    expect(fileEvent).toEqual({ type: "input_file_sources", sources: collected.fileSources });
    expect(JSON.stringify(projected)).not.toContain("file-1");
    expect(JSON.stringify(projected)).not.toContain("file-2");
    expect(JSON.stringify(projected)).not.toContain("/secret/");
    expect(JSON.stringify(projected)).not.toContain("C:\\Users");
    expect(JSON.stringify(projected)).not.toContain("file://");
    expect(JSON.stringify(projected)).not.toContain("access_token");
    expect(JSON.stringify(projected)).not.toContain("Bearer");

    const sse = [
      'data: {"type":"response.output_text.annotation.added","annotation":{"type":"file_citation","file_id":"file-sse","filename":"/tmp/a.pdf"}}',
      "",
      'data: {"type":"response.output_text.annotation.added","annotation":{"type":"file_citation","file_id":"file-sse","filename":"a.pdf"}}',
      "",
      'data: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"See [[1]](https://docs.example/b)","annotations":[{"type":"url_citation","url":"https://docs.example/b"}]}]}]}}',
      "",
    ].join("\n");
    const parsed = parseResponsesSseChunk(sse);
    const fromSse = collectResponsesStream(parsed.events);
    expect(fromSse.fileSources).toEqual([{ name: "a.pdf" }]);
    expect(fromSse.citations).toEqual([expect.objectContaining({ url: "https://docs.example/b" })]);
  });

  it("does not treat ordinary url citations as file sources",
    () => {
      const collected = collectResponsesStream([{
        type: "response.output_text.annotation.added",
        annotation: { type: "url_citation", url: "https://cdn.example/doc.pdf", title: "doc.pdf", name: "doc.pdf" },
      }]);
      expect(collected.fileSources).toEqual([]);
      expect(collected.citations).toEqual([expect.objectContaining({ url: "https://cdn.example/doc.pdf", title: "doc.pdf" })]);
    },
  );

  it("tees JSON completed bodies and SSE chunks with file-source dedupe", async () => {
    const emitted: HostedAssistantEvent[] = [];
    const wrappedJson = wrapFetchForHostedSearch(async () => new Response(JSON.stringify({
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          annotations: [
            { type: "file_citation", file_id: "file-json", filename: "brief.md" },
            { type: "file_citation", file_id: "file-json", filename: "brief.md" },
          ],
        }],
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }), (event) => emitted.push(event));
    await wrappedJson("https://api.x.ai/v1/responses", { method: "POST" });
    expect(emitted.filter((item) => item.type === "input_file_sources")).toEqual([
      { type: "input_file_sources", sources: [{ name: "brief.md" }] },
    ]);
    expect(JSON.stringify(emitted)).not.toContain("file-json");

    const sseEmitted: HostedAssistantEvent[] = [];
    const body = [
      'data: {"type":"response.output_text.annotation.added","annotation":{"type":"file_citation","file_id":"file-chunk","filename":"win\\\\notes.txt"}}',
      "",
      'data: {"type":"response.output_item.done","item":{"type":"message","content":[{"annotations":[{"type":"file_citation","file_id":"file-chunk","name":"notes.txt"}]}]}}',
      "",
    ].join("\n");
    const wrappedSse = wrapFetchForHostedSearch(async () => new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }), (event) => sseEmitted.push(event));
    await wrappedSse("https://api.x.ai/v1/responses", { method: "POST" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sseEmitted.filter((item) => item.type === "input_file_sources")).toEqual([
      { type: "input_file_sources", sources: [{ name: "notes.txt" }] },
    ]);
  });

  it("uses a neutral name when the file citation has no basename", () => {
    const collected = collectResponsesStream([{
      type: "response.output_text.annotation.added",
      annotation: { type: "file_citation", file_id: "file-empty", filename: "/" },
    }]);
    expect(collected.fileSources).toEqual([{ name: "已上传文件" }]);
  });
});
