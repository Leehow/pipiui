import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerInputFilesHooks } from "../agent/input-files-hooks.js";
import { SessionInputFileStore } from "../agent/files/state.js";
import type { SafeInputFile } from "../agent/files/types.js";

type HookHandler = (...args: unknown[]) => unknown;
type MockPi = {
  registerProvider: (id: string, config: unknown) => void;
  registerCommand: (name: string, opts: unknown) => void;
  registerTool: (tool: unknown) => void;
  on: (event: string, handler: HookHandler) => void;
};

const ENV_KEYS = ["PI_COC_AGENT_DIR", "PI_CODING_AGENT_DIR"];

function mockPi() {
  const providers = new Map<string, unknown>();
  const hooks = new Map<string, HookHandler[]>();
  const api: MockPi = {
    registerProvider: (id, config) => { providers.set(id, config); },
    registerCommand: () => undefined,
    registerTool: () => undefined,
    on: (event, handler) => {
      const list = hooks.get(event) ?? [];
      list.push(handler);
      hooks.set(event, list);
    },
  };
  return { api, providers, hooks };
}

function hook(hooks: Map<string, HookHandler[]>, event: string): HookHandler {
  const handler = hooks.get(event)?.[0];
  if (!handler) throw new Error(`missing ${event}`);
  return handler;
}

function readyFile(overrides: Partial<SafeInputFile> = {}): SafeInputFile {
  return {
    id: "att-1",
    name: "notes.md",
    size: 12,
    mimeType: "text/markdown",
    status: "ready",
    fileId: "file-abc",
    ...overrides,
  };
}

function grokCtx(sessionId: string, extras: { id?: string; inputFiles?: boolean } = {}) {
  return {
    model: {
      provider: "grok-build",
      id: extras.id ?? "grok-4.6",
      capabilities: extras.inputFiles === false ? {} : { inputFiles: true },
    },
    sessionManager: { getSessionId: () => sessionId },
  };
}

function responsesPayload() {
  return {
    model: "grok-4.6",
    stream: true,
    input: [
      { role: "user", content: "summarize" },
    ],
    tools: [{ type: "web_search" }, { type: "code_interpreter" }],
    include: ["code_interpreter_call.outputs"],
    text: { format: { type: "json_schema", name: "out", schema: { type: "object" }, strict: true } },
  };
}

describe("production input-files hooks", () => {
  let dir = "";
  let saved: Record<string, string | undefined> = {};

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "grok-input-hooks-"));
    saved = {};
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    process.env.PI_CODING_AGENT_DIR = dir;
  });

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function loadRegistered() {
    const mod = await import("../agent/index.js");
    const pi = mockPi();
    (mod.default as (api: MockPi) => void)(pi.api);
    return pi;
  }

  it("registers before/after provider hooks on the grok-build extension", async () => {
    const pi = await loadRegistered();
    expect(pi.providers.has("grok-build")).toBe(true);
    expect(pi.hooks.has("before_provider_request")).toBe(true);
    expect(pi.hooks.has("after_provider_response")).toBe(true);
    expect(pi.hooks.has("session_start")).toBe(true);
    expect(pi.hooks.has("session_shutdown")).toBe(true);
  });

  it("injects unsent ready file ids onto the last user message and keeps other fields", async () => {
    const store = new SessionInputFileStore(dir);
    await store.write("sess-a", [
      readyFile(),
      readyFile({ id: "att-img", name: "shot.png", mimeType: "image/png", fileId: "file-img", sent: true }),
    ]);
    const pi = await loadRegistered();
    const payload = {
      ...responsesPayload(),
      input: [
        { role: "assistant", content: "prev" },
        {
          role: "user",
          content: [
            { type: "input_text", text: "look" },
            { type: "input_image", image_url: "https://example.com/a.png" },
          ],
        },
      ],
    };
    const next = await hook(pi.hooks, "before_provider_request")(
      { type: "before_provider_request", payload },
      grokCtx("sess-a"),
    ) as Record<string, unknown>;
    expect(next.tools).toEqual(payload.tools);
    expect(next.include).toEqual(payload.include);
    expect(next.text).toEqual(payload.text);
    expect(next.input).toEqual([
      { role: "assistant", content: "prev" },
      {
        role: "user",
        content: [
          { type: "input_text", text: "look" },
          { type: "input_image", image_url: "https://example.com/a.png" },
          { type: "input_file", file_id: "file-abc" },
        ],
      },
    ]);
    expect(JSON.stringify(next)).not.toContain("/Users/");
    expect(JSON.stringify(next)).not.toContain("att-1");
  });

  it("converts string user content to input_text when attaching files", async () => {
    await new SessionInputFileStore(dir).write("sess-a", [readyFile()]);
    const pi = await loadRegistered();
    const next = await hook(pi.hooks, "before_provider_request")(
      { type: "before_provider_request", payload: responsesPayload() },
      grokCtx("sess-a"),
    ) as { input: Array<{ content: unknown }> };
    expect(next.input[0]?.content).toEqual([
      { type: "input_text", text: "summarize" },
      { type: "input_file", file_id: "file-abc" },
    ]);
  });

  it("injects by inputFiles capability, not provider id, and leaves empty stores untouched", async () => {
    await new SessionInputFileStore(dir).write("sess-a", [readyFile()]);
    const pi = await loadRegistered();
    const payload = responsesPayload();
    const other = await hook(pi.hooks, "before_provider_request")(
      { type: "before_provider_request", payload },
      { model: { provider: "openai", id: "gpt-4.1", capabilities: { inputFiles: true } }, sessionManager: { getSessionId: () => "sess-a" } },
    ) as Record<string, unknown>;
    expect(other.input).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: "summarize" },
          { type: "input_file", file_id: "file-abc" },
        ],
      },
    ]);
    expect(other.tools).toEqual(payload.tools);
    expect(other.include).toEqual(payload.include);
    expect(other.text).toEqual(payload.text);
    const empty = await hook(pi.hooks, "before_provider_request")(
      { type: "before_provider_request", payload },
      grokCtx("sess-empty"),
    );
    expect(empty).toBeUndefined();
  });

  it("fails closed when the live model did not declare inputFiles", async () => {
    await new SessionInputFileStore(dir).write("sess-a", [readyFile()]);
    const pi = await loadRegistered();
    await expect(
      hook(pi.hooks, "before_provider_request")(
        { type: "before_provider_request", payload: responsesPayload() },
        grokCtx("sess-a", { inputFiles: false }),
      ),
    ).rejects.toThrow(/未声明 inputFiles/);
  });

  it("fails closed on unsent uploading/failed/cancelled attachments", async () => {
    const store = new SessionInputFileStore(dir);
    const pi = await loadRegistered();
    const before = hook(pi.hooks, "before_provider_request");
    for (const status of ["uploading", "failed", "cancelled"] as const) {
      await store.write("sess-a", [readyFile({ id: status, status, fileId: status === "uploading" ? undefined : "file-x" })]);
      await expect(
        before({ type: "before_provider_request", payload: responsesPayload() }, grokCtx("sess-a")),
      ).rejects.toThrow(/尚未就绪/);
    }
    await store.write("sess-a", [
      readyFile(),
      readyFile({ id: "att-2", status: "uploading", fileId: undefined }),
    ]);
    await expect(
      before({ type: "before_provider_request", payload: responsesPayload() }, grokCtx("sess-a")),
    ).rejects.toThrow(/尚未就绪/);
  });

  it("marks only this request's injected ids after 2xx, not after 401/non-2xx", async () => {
    const store = new SessionInputFileStore(dir);
    await store.write("sess-a", [
      readyFile(),
      readyFile({ id: "att-2", name: "other.md", fileId: "file-other" }),
    ]);
    const hooks = registerInputFilesHooks(mockPi().api);
    const injected = await hooks.beforeProviderRequest(
      { type: "before_provider_request", payload: responsesPayload() },
      grokCtx("sess-a"),
    ) as { input: Array<{ content: Array<{ file_id?: string }> }> };
    expect(injected.input.at(-1)?.content.map((part) => part.file_id).filter(Boolean)).toEqual(["file-abc", "file-other"]);

    await hooks.afterProviderResponse({ type: "after_provider_response", status: 401 }, grokCtx("sess-a"));
    expect((await store.list("sess-a")).every((file) => file.sent !== true)).toBe(true);

    await hooks.beforeProviderRequest(
      { type: "before_provider_request", payload: responsesPayload() },
      grokCtx("sess-a"),
    );
    await hooks.afterProviderResponse({ type: "after_provider_response", status: 500 }, grokCtx("sess-a"));
    expect((await store.list("sess-a")).every((file) => file.sent !== true)).toBe(true);

    await hooks.beforeProviderRequest(
      { type: "before_provider_request", payload: responsesPayload() },
      grokCtx("sess-a"),
    );
    await hooks.afterProviderResponse({ type: "after_provider_response", status: 200 }, grokCtx("sess-a"));
    const marked = await store.list("sess-a");
    expect(marked.map((file) => [file.id, file.sent])).toEqual([
      ["att-1", true],
      ["att-2", true],
    ]);
  });

  it("does not mark sent after abort/session switch, and isolates sessions", async () => {
    const store = new SessionInputFileStore(dir);
    await store.write("sess-a", [readyFile()]);
    await store.write("sess-b", [readyFile({ id: "att-b", fileId: "file-b" })]);
    const hooks = registerInputFilesHooks(mockPi().api);

    const forA = await hooks.beforeProviderRequest(
      { type: "before_provider_request", payload: responsesPayload() },
      grokCtx("sess-a"),
    ) as { input: Array<{ content: Array<{ file_id?: string }> }> };
    expect(forA.input.at(-1)?.content.some((part) => part.file_id === "file-abc")).toBe(true);
    expect(forA.input.at(-1)?.content.some((part) => part.file_id === "file-b")).toBe(false);

    hooks.clearPending();
    await hooks.afterProviderResponse({ type: "after_provider_response", status: 200 }, grokCtx("sess-a"));
    expect((await store.list("sess-a"))[0]?.sent).toBeUndefined();

    const forB = await hooks.beforeProviderRequest(
      { type: "before_provider_request", payload: responsesPayload() },
      grokCtx("sess-b"),
    ) as { input: Array<{ content: Array<{ file_id?: string }> }> };
    expect(forB.input.at(-1)?.content.map((part) => part.file_id).filter(Boolean)).toEqual(["file-b"]);
    await hooks.afterProviderResponse({ type: "after_provider_response", status: 201 }, grokCtx("sess-a"));
    expect((await store.list("sess-b"))[0]?.sent).toBeUndefined();
    await hooks.afterProviderResponse({ type: "after_provider_response", status: 201 }, grokCtx("sess-b"));
    expect((await store.list("sess-b"))[0]?.sent).toBe(true);
    expect((await store.list("sess-a"))[0]?.sent).toBeUndefined();
  });

  it("refuses chat/completions payloads when attachments are pending", async () => {
    await new SessionInputFileStore(dir).write("sess-a", [readyFile()]);
    const hooks = registerInputFilesHooks(mockPi().api);
    await expect(
      hooks.beforeProviderRequest(
        {
          type: "before_provider_request",
          payload: { model: "grok-4.6", messages: [{ role: "user", content: "hi" }] },
        },
        grokCtx("sess-a"),
      ),
    ).rejects.toThrow(/responses/);
  });
});
