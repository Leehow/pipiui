import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createPiHostBackend } from "../src/index.js";
import { extractHistoryCitations, extractHistoryCodeInterpreter, extractHistoryFileSources, isHostedAssistantEvent, projectHostedAssistantEvent } from "../src/hosted-search-stream.js";

describe("hosted search stream projection", () => {
  it("projects hosted search to a dedicated event plus tool_call fallback with a stable call id", () => {
    const events = projectHostedAssistantEvent("sess-1", {
      type: "hosted_search",
      callId: "ws_1",
      kind: "web_search",
      phase: "searching",
      query: "pipiui",
      outputIndex: 1,
    }, 2);
    expect(events).toEqual([
      {
        type: "hosted_search",
        sessionId: "sess-1",
        callId: "ws_1",
        kind: "web_search",
        phase: "searching",
        query: "pipiui",
        outputIndex: 1,
        segment: 2,
      },
      {
        type: "tool_call",
        sessionId: "sess-1",
        toolCallId: "ws_1",
        name: "web_search",
        delta: JSON.stringify({ phase: "searching", query: "pipiui" }),
        status: "running",
        contentIndex: 1,
        segment: 2,
      },
    ]);
  });

  it("does not fabricate citations or hosted events from unknown shapes", () => {
    expect(isHostedAssistantEvent({ type: "toolcall_end" })).toBe(false);
    expect(projectHostedAssistantEvent("s", { type: "hosted_search", kind: "web_search" })).toEqual([]);
    expect(projectHostedAssistantEvent("s", { type: "citations", citations: [{ url: "not-a-url" }] })).toEqual([]);
    expect(projectHostedAssistantEvent("s", { type: "input_file_sources", sources: [{ name: "" }] })).toEqual([]);
    expect(extractHistoryCitations({}, "no links here")).toEqual([]);
  });

  it("projects sanitized input_file_sources and rejects leaked ids, paths and non-https urls", () => {
    expect(isHostedAssistantEvent({ type: "input_file_sources" })).toBe(true);
    expect(projectHostedAssistantEvent("sess-1", {
      type: "input_file_sources",
      sources: [
        { name: "/secret/doc.pdf", url: "https://files.example/doc.pdf?access_token=abc" },
        { name: "notes.md", url: "http://files.example/notes.md" },
        { name: "", url: "https://files.example/empty" },
        { name: "local.txt", url: "file:///tmp/local.txt" },
      ],
    })).toEqual([{
      type: "input_file_sources",
      sessionId: "sess-1",
      sources: [
        { name: "doc.pdf", url: "https://files.example/doc.pdf" },
        { name: "notes.md" },
        { name: "local.txt" },
      ],
    }]);
    const leaked = projectHostedAssistantEvent("s", {
      type: "input_file_sources",
      sources: [{ name: "ok.md", fileId: "file-secret", file_id: "file-secret", path: "/abs/ok.md" } as never],
    });
    expect(leaked).toEqual([{ type: "input_file_sources", sessionId: "s", sources: [{ name: "ok.md" }] }]);
    expect(JSON.stringify(leaked)).not.toContain("file-secret");
    expect(JSON.stringify(leaked)).not.toContain("/abs/");
  });

  it("projects hosted code interpreter lifecycle plus a code_interpreter tool_call fallback", () => {
    const events = projectHostedAssistantEvent("sess-1", {
      type: "hosted_code_interpreter",
      callId: "ci_1",
      phase: "in_progress",
      code: "print(1)",
      outputIndex: 2,
    }, 3);
    expect(events).toEqual([
      {
        type: "hosted_code_interpreter",
        sessionId: "sess-1",
        callId: "ci_1",
        phase: "in_progress",
        code: "print(1)",
        outputIndex: 2,
        segment: 3,
      },
      {
        type: "tool_call",
        sessionId: "sess-1",
        toolCallId: "ci_1",
        name: "code_interpreter",
        delta: JSON.stringify({ phase: "in_progress", code: "print(1)" }),
        status: "running",
        contentIndex: 2,
        segment: 3,
      },
    ]);
    expect(isHostedAssistantEvent({ type: "hosted_code_interpreter", phase: "completed" })).toBe(true);
    expect(extractHistoryCodeInterpreter({
      output: [{
        type: "code_interpreter_call",
        id: "ci_hist",
        status: "completed",
        code: "1+1",
        outputs: [{ type: "logs", logs: "2" }],
      }],
    })).toEqual([{ id: "ci_hist", name: "code_interpreter", input: JSON.stringify({ phase: "completed", code: "1+1", outputs: [{ type: "logs", text: "2" }] }) }]);
  });

  it("extracts history file sources from explicit shapes and fail-closes everything else", () => {
    expect(extractHistoryFileSources({
      citations: [
        { type: "file_citation", file_id: "file-1", filename: "/secret/docs/report.pdf", url: "https://files.example/report.pdf?access_token=abc" },
        { type: "url_citation", url: "https://docs.example/guide", title: "Guide", name: "guide.pdf" },
        { type: "file_citation", file_id: "file-1", filename: "report.pdf" },
      ],
      content: [{
        type: "output_text",
        annotations: [
          { type: "input_file", fileId: "file-2", fileName: "C:\\Users\\haoli\\notes.md" },
          { type: "file", file_id: "file-3", name: "local.txt", url: "file:///tmp/local.txt" },
          { type: "file_citation", file_id: "file-empty", filename: "/" },
          { type: "url_citation", url: "https://cdn.example/doc.pdf", name: "doc.pdf" },
        ],
      }],
      output: [{
        type: "message",
        content: [{
          annotations: [{ type: "file_citation", file_id: "file-2", filename: "notes.md" }],
        }],
      }],
    })).toEqual([
      { name: "report.pdf", url: "https://files.example/report.pdf" },
      { name: "notes.md" },
      { name: "local.txt" },
      { name: "已上传文件" },
    ]);
    expect(extractHistoryFileSources({
      citations: [{ url: "https://docs.example/a" }],
      content: [{ annotations: [{ type: "url_citation", url: "https://docs.example/b", title: "B" }] }],
    })).toEqual([]);
    const leaked = extractHistoryFileSources({
      citations: [{ type: "file_citation", file_id: "file-secret", filename: "ok.md", path: "/abs/ok.md", token: "sk-secret" }],
    });
    expect(leaked).toEqual([{ name: "ok.md" }]);
    expect(JSON.stringify(leaked)).not.toContain("file-secret");
    expect(JSON.stringify(leaked)).not.toContain("/abs/");
    expect(JSON.stringify(leaked)).not.toContain("sk-secret");
    expect(extractHistoryCitations({
      citations: [{ type: "file_citation", file_id: "file-1", filename: "report.pdf", url: "https://files.example/report.pdf" }],
      content: [{ annotations: [{ type: "file_citation", url: "https://files.example/report.pdf", filename: "report.pdf" }] }],
    }, "See [[1]](https://docs.example/b)")).toEqual([
      { url: "https://docs.example/b", type: "url_citation" },
    ]);
  });

  it("uses the neutral basename for explicit nameless file citations and still fail-closes unmarked objects", () => {
    const nameless = extractHistoryFileSources({
      citations: [
        { type: "file_citation", file_id: "file-anon" },
        { type: "input_file", fileId: "file-slash", filename: "/" },
        { type: "file", file_id: "file-ctrl", name: "\u0000" },
      ],
    });
    expect(nameless).toEqual([
      { name: "已上传文件" },
      { name: "已上传文件" },
      { name: "已上传文件" },
    ]);
    expect(JSON.stringify(nameless)).not.toContain("file-anon");
    expect(JSON.stringify(nameless)).not.toContain("file-slash");
    expect(JSON.stringify(nameless)).not.toContain("file-ctrl");
    expect(extractHistoryFileSources({
      citations: [{ url: "https://docs.example/a", title: "A" }],
      content: [{ annotations: [{ type: "url_citation", url: "https://cdn.example/doc.pdf", name: "doc.pdf" }] }],
    })).toEqual([]);
    expect(extractHistoryFileSources({
      citations: [{ title: "random", url: "not-a-url", path: "/abs/secret.pdf" }],
    })).toEqual([]);
  });

  it("projects interleaved search, code, citations and file sources without leaking ids", () => {
    const search = projectHostedAssistantEvent("sess-1", {
      type: "hosted_search",
      callId: "ws_cross",
      kind: "web_search",
      phase: "completed",
      query: "pipiui",
    });
    const code = projectHostedAssistantEvent("sess-1", {
      type: "hosted_code_interpreter",
      callId: "ci_cross",
      phase: "completed",
      code: "print(42)",
      files: [{ filename: "plot.png", url: "https://files.example/plot.png" }],
    });
    const citations = projectHostedAssistantEvent("sess-1", {
      type: "citations",
      citations: [
        { url: "https://docs.example/guide", startIndex: 1, endIndex: 4 },
        { url: "https://docs.example/guide" },
      ],
    });
    const files = projectHostedAssistantEvent("sess-1", {
      type: "input_file_sources",
      sources: [
        { name: "/secret/docs/report.pdf", url: "https://files.example/report.pdf?access_token=abc" },
        { name: "notes.md" },
        { name: "已上传文件" },
      ],
    });
    expect(search[0]).toMatchObject({ type: "hosted_search", callId: "ws_cross", kind: "web_search" });
    expect(code[0]).toMatchObject({ type: "hosted_code_interpreter", callId: "ci_cross", phase: "completed" });
    expect(citations).toEqual([{
      type: "citations",
      sessionId: "sess-1",
      citations: [
        { url: "https://docs.example/guide", startIndex: 1, endIndex: 4 },
        { url: "https://docs.example/guide" },
      ],
    }]);
    expect(files).toEqual([{
      type: "input_file_sources",
      sessionId: "sess-1",
      sources: [
        { name: "report.pdf", url: "https://files.example/report.pdf" },
        { name: "notes.md" },
        { name: "已上传文件" },
      ],
    }]);
    const leaked = JSON.stringify([search, code, citations, files]);
    expect(leaked).not.toContain("file-secret");
    expect(leaked).not.toContain("/secret/");
    expect(leaked).not.toContain("access_token");
  });

  it("preserves annotation indexes and inline [[N]](url) on history reload", () => {
    expect(extractHistoryCitations(
      {
        citations: ["https://docs.example/a"],
        content: [{
          type: "text",
          text: "See [[1]](https://docs.example/b)",
          annotations: [{ type: "url_citation", url: "https://docs.example/c", title: "C", start_index: 4, end_index: 8 }],
        }],
      },
      "See [[1]](https://docs.example/b)",
    )).toEqual([
      { url: "https://docs.example/a" },
      { url: "https://docs.example/c", title: "C", startIndex: 4, endIndex: 8, type: "url_citation" },
      { url: "https://docs.example/b", type: "url_citation" },
    ]);
  });
});

describe("hosted search backend stream", () => {
  let root = "";
  afterEach(async () => {
    if (root) await (await import("node:fs/promises")).rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });

  it("forwards hosted search and citations across the session stream with a stable call id", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-hosted-search-"));
    const cwd = join(root, "project");
    const dir = join(root, "sessions", "project");
    await mkdir(dir, { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(join(dir, "session.jsonl"), `${JSON.stringify({ type: "session", version: 3, id: "session-1", timestamp: "2026-08-10T00:00:00.000Z", cwd })}\n`);
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      canonicalProjectPaths: async () => undefined,
      piPath: "node",
      spawn: (_bin, _args, options) => spawn("/usr/local/bin/node", [new URL("./fake-pi.mjs", import.meta.url).pathname], {
        ...options,
        env: { ...options.env, PATH: "/usr/local/bin:/usr/bin:/bin" },
      }) as never,
    });
    await backend.handle("addProject", [cwd]);
    const events: Array<{ channel?: string; event?: Record<string, unknown> }> = [];
    const off = backend.subscribe((event) => events.push(event as never));
    await backend.handle("sendPrompt", ["session-1", "__hosted_search__"]);
    await new Promise((resolve) => setTimeout(resolve, 400));
    off();
    const stream = events.filter((event) => event.channel === "stream").map((event) => event.event);
    expect(stream.filter((event) => event?.type === "hosted_search")).toEqual([
      expect.objectContaining({ type: "hosted_search", sessionId: "session-1", callId: "ws_live", kind: "web_search", phase: "searching", query: "pipiui" }),
      expect.objectContaining({ type: "hosted_search", sessionId: "session-1", callId: "ws_live", kind: "web_search", phase: "completed" }),
    ]);
    expect(stream.some((event) => event?.type === "tool_call" && event.toolCallId === "ws_live" && event.name === "web_search")).toBe(true);
    expect(stream.some((event) => event?.type === "tool_call" && event.toolCallId === "read-1" && event.name === "read")).toBe(true);
    expect(stream.filter((event) => event?.type === "citations")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "citations", sessionId: "session-1", citations: [expect.objectContaining({ url: "https://docs.example" })] }),
      ]),
    );
    await backend.close();
  });

  it("projects file sources from message_end when live SSE never arrived", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-file-sources-end-"));
    const cwd = join(root, "project");
    const dir = join(root, "sessions", "project");
    await mkdir(dir, { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(join(dir, "session.jsonl"), `${JSON.stringify({ type: "session", version: 3, id: "session-1", timestamp: "2026-08-10T00:00:00.000Z", cwd })}\n`);
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      canonicalProjectPaths: async () => undefined,
      piPath: "node",
      spawn: (_bin, _args, options) => spawn("/usr/local/bin/node", [new URL("./fake-pi.mjs", import.meta.url).pathname], {
        ...options,
        env: { ...options.env, PATH: "/usr/local/bin:/usr/bin:/bin" },
      }) as never,
    });
    await backend.handle("addProject", [cwd]);
    const events: Array<{ channel?: string; event?: Record<string, unknown> }> = [];
    const off = backend.subscribe((event) => events.push(event as never));
    await backend.handle("sendPrompt", ["session-1", "__file_sources_end__"]);
    await new Promise((resolve) => setTimeout(resolve, 400));
    off();
    const stream = events.filter((event) => event.channel === "stream").map((event) => event.event);
    expect(stream.filter((event) => event?.type === "input_file_sources")).toEqual([
      expect.objectContaining({
        type: "input_file_sources",
        sessionId: "session-1",
        sources: [{ name: "notes.md" }, { name: "report.pdf" }],
      }),
    ]);
    expect(stream.filter((event) => event?.type === "citations")).toEqual([
      expect.objectContaining({
        type: "citations",
        sessionId: "session-1",
        citations: [expect.objectContaining({ url: "https://docs.example" })],
      }),
    ]);
    expect(JSON.stringify(stream)).not.toContain("file-secret");
    expect(JSON.stringify(stream)).not.toContain("/secret/");
    await backend.close();
  });

  it("converts persisted assistant file citations onto history fileSources", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-file-sources-hist-"));
    const cwd = join(root, "project");
    const dir = join(root, "sessions", "project");
    await mkdir(dir, { recursive: true });
    await mkdir(cwd, { recursive: true });
    const path = join(dir, "session.jsonl");
    const msg = (id, message) => JSON.stringify({ type: "message", id, parentId: null, timestamp: "2026-08-10T00:00:01.000Z", message });
    await writeFile(path, [
      JSON.stringify({ type: "session", version: 3, id: "session-1", timestamp: "2026-08-10T00:00:00.000Z", cwd }),
      msg("a1", {
        role: "assistant",
        content: [{
          type: "text",
          text: "Based on the upload.",
          annotations: [
            { type: "file_citation", file_id: "file-secret", filename: "/secret/report.pdf" },
            { type: "url_citation", url: "https://docs.example", title: "Docs" },
          ],
        }],
        citations: [{ type: "file_citation", fileId: "file-2", fileName: "C:\\Users\\haoli\\notes.md" }],
      }),
    ].join("\n") + "\n");
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      canonicalProjectPaths: async () => undefined,
      piPath: "node",
    });
    const history = await backend.handle("getSessionHistory", ["session-1"]) as Array<Record<string, unknown>>;
    expect(history).toEqual([
      expect.objectContaining({
        role: "assistant",
        content: "Based on the upload.",
        citations: [expect.objectContaining({ url: "https://docs.example", title: "Docs" })],
        fileSources: [{ name: "notes.md" }, { name: "report.pdf" }],
      }),
    ]);
    expect(JSON.stringify(history)).not.toContain("file-secret");
    expect(JSON.stringify(history)).not.toContain("/secret/");
    await backend.close();
  });
});
