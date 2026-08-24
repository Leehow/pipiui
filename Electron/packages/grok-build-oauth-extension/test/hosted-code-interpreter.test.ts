import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyHostedSearchToPayload } from "../agent/hosted-search.js";
import {
  applyCodeInterpreterToPayload,
  codeInterpreterFromCapabilities,
  collectCodeInterpreterStream,
  extractHistoryCodeInterpreter,
  interpretCodeInterpreterEvent,
  mergeCodeInterpreterTool,
  modelHasCodeInterpreter,
  redactSecrets,
} from "../agent/hosted-code-interpreter.js";
import { buildConversationRequest } from "../agent/conversation.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadFixture(name: string): unknown[] {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8")) as unknown[];
}

describe("hosted code interpreter request contract", () => {
  it("injects {type:code_interpreter} only when the capability is declared", () => {
    const existing = [
      { type: "function", name: "bash" },
      { type: "function", name: "code_interpreter" },
      { type: "web_search" },
    ];
    expect(mergeCodeInterpreterTool(existing)).toEqual([
      { type: "function", name: "bash" },
      { type: "web_search" },
      { type: "code_interpreter" },
    ]);
    const disabled = { model: "grok-4.6", tools: existing };
    expect(applyCodeInterpreterToPayload(disabled, false)).toBe(disabled);
    expect(applyCodeInterpreterToPayload(disabled, false)).toEqual({
      model: "grok-4.6",
      tools: existing,
    });
    expect(disabled).not.toHaveProperty("include");
    expect(codeInterpreterFromCapabilities({ hostedTools: { tools: ["web_search"] } })).toBe(false);
    expect(codeInterpreterFromCapabilities({ hostedTools: { tools: ["code_interpreter"] } })).toBe(true);
    expect(codeInterpreterFromCapabilities({ nativeSearch: { tools: ["web_search"] } })).toBeUndefined();
    expect(modelHasCodeInterpreter({ capabilities: { nativeSearch: { tools: ["web_search"] } } })).toBe(false);
  });

  it("composes with hosted search and client function tools without changing off-capability payloads", () => {
    const base = {
      model: "grok-4.6",
      input: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", name: "image_gen" }, { type: "function", name: "web_search" }],
    };
    const searched = applyHostedSearchToPayload(base, { tools: ["web_search", "x_search"] });
    const composed = applyCodeInterpreterToPayload(searched, true);
    expect(composed.tools).toEqual([
      { type: "function", name: "image_gen" },
      { type: "web_search" },
      { type: "x_search" },
      { type: "code_interpreter" },
    ]);
    expect(composed.include).toEqual(["code_interpreter_call.outputs"]);
    const off = { ...base };
    expect(applyCodeInterpreterToPayload(off, false)).toBe(off);
    expect(applyCodeInterpreterToPayload(off, false)).toEqual(base);
    expect(JSON.stringify(applyCodeInterpreterToPayload(off, false))).toBe(JSON.stringify(base));
    expect(off).not.toHaveProperty("include");
  });

  it("merges include:[code_interpreter_call.outputs] only when enabled, preserving others", () => {
    const prior = {
      model: "grok-4.6",
      include: ["file_search_call.results", "code_interpreter_call.outputs"],
      tools: [{ type: "function", name: "bash" }],
    };
    const merged = applyCodeInterpreterToPayload(prior, true);
    expect(merged.include).toEqual(["file_search_call.results", "code_interpreter_call.outputs"]);
    expect(applyCodeInterpreterToPayload(merged, true).include).toEqual([
      "file_search_call.results",
      "code_interpreter_call.outputs",
    ]);
    expect(merged.tools).toEqual([{ type: "function", name: "bash" }, { type: "code_interpreter" }]);
    expect(prior.include).toEqual(["file_search_call.results", "code_interpreter_call.outputs"]);
    expect(applyCodeInterpreterToPayload(prior, false)).toBe(prior);
  });

  it("fails closed unless hostedTools.code_interpreter is declared", () => {
    const tools = [{ type: "function", name: "image_gen" }];
    const absent = buildConversationRequest({
      modelId: "grok-4.6",
      credentials: { access: "at-secret" },
      messages: [{ role: "user", content: "hi" }],
      tools,
    });
    expect(absent.body.tools).toEqual([
      { type: "function", name: "image_gen" },
    ]);
    expect(JSON.stringify(absent.body.tools)).not.toContain("code_interpreter");
    expect(absent.body).not.toHaveProperty("include");
    expect(JSON.stringify(absent.body)).not.toContain("code_interpreter_call.outputs");
    expect(modelHasCodeInterpreter({ id: "grok-4.6" } as { capabilities?: unknown })).toBe(false);
    expect(codeInterpreterFromCapabilities(undefined)).toBeUndefined();
    expect(codeInterpreterFromCapabilities({ hostedTools: { tools: ["web_search"] } })).toBe(false);

    const on = buildConversationRequest({
      modelId: "grok-4.6",
      credentials: { access: "at-secret" },
      messages: [{ role: "user", content: "hi" }],
      tools,
      capabilities: { hostedTools: { tools: ["web_search", "x_search", "code_interpreter"] } },
    });
    expect(on.body.tools).toEqual([
      { type: "function", name: "image_gen" },
      { type: "web_search" },
      { type: "x_search" },
      { type: "code_interpreter" },
    ]);
    expect(on.body.include).toEqual(["code_interpreter_call.outputs"]);

    const off = buildConversationRequest({
      modelId: "grok-4.6",
      credentials: { access: "at-secret" },
      messages: [{ role: "user", content: "hi" }],
      tools,
      capabilities: { hostedTools: { tools: ["web_search", "x_search", "code_interpreter"] } },
      codeInterpreter: false,
    });
    expect(off.body.tools).toEqual([
      { type: "function", name: "image_gen" },
      { type: "web_search" },
      { type: "x_search" },
    ]);
    expect(JSON.stringify(off.body.tools)).not.toContain("code_interpreter");
    expect(off.body).not.toHaveProperty("include");
    expect(JSON.stringify(off.body)).not.toContain("code_interpreter_call.outputs");
  });
});

describe("hosted code interpreter stream", () => {
  it("accumulates queued/in_progress/code deltas/completed plus safe file metadata", () => {
    const collected = collectCodeInterpreterStream(loadFixture("responses-hosted-code-interpreter-stream.json"));
    expect(collected.calls.map((call) => call.phase)).toEqual([
      "queued",
      "in_progress",
      "in_progress",
      "in_progress",
      "in_progress",
      "interpreting",
      "completed",
      "completed",
    ]);
    const done = collected.calls.at(-1);
    expect(done).toMatchObject({
      itemId: "ci_1",
      phase: "completed",
      code: "print(42)",
      outputs: [{ type: "logs", text: "42\n" }],
    });
    expect(done?.files).toEqual([
      { filename: "plot.png", mimeType: "image/png", url: "https://files.example/plot.png" },
    ]);
    expect(JSON.stringify(done)).not.toContain("token=secret");
  });

  it("keeps failed status, redacts secrets, and never invents local execution", () => {
    const collected = collectCodeInterpreterStream(loadFixture("responses-hosted-code-interpreter-failed.json"));
    const failed = collected.calls.at(-1);
    expect(failed?.phase).toBe("failed");
    expect(failed?.error?.message).toContain("RuntimeError: boom");
    expect(failed?.error?.message).not.toContain("sk-secret");
    expect(collected.error?.message).not.toContain("sk-secret");
  });

  it("maps incomplete to failed, ignores unknown events, and drops http file URLs", () => {
    const collected = collectCodeInterpreterStream([
      { type: "response.output_text.delta", delta: "hello" },
      { type: "response.web_search_call.searching", item_id: "ws_1" },
      { type: "response.code_interpreter_call.incomplete", item_id: "ci_inc", output_index: 2 },
      {
        type: "response.output_item.done",
        output_index: 3,
        item: {
          type: "code_interpreter_call",
          id: "ci_http",
          status: "completed",
          outputs: [
            { type: "logs", logs: "ok access_token=leak download_token=dl" },
            { type: "file", filename: "out.bin", url: "http://files.example/out.bin" },
            { type: "file", filename: "ok.png", url: "https://files.example/ok.png?access_token=abc&x=1" },
          ],
        },
      },
    ]);
    expect(interpretCodeInterpreterEvent({ type: "response.output_text.delta", delta: "hello" })).toBeUndefined();
    expect(collected.calls.map((call) => call.phase)).toEqual(["failed", "completed"]);
    expect(collected.calls[0]).toMatchObject({ itemId: "ci_inc", phase: "failed" });
    expect(collected.calls[1]?.outputs?.[0]?.text).toBe("ok access_token=[redacted] download_token=[redacted]");
    expect(collected.calls[1]?.files).toEqual([
      { filename: "out.bin" },
      { filename: "ok.png", url: "https://files.example/ok.png?x=1" },
    ]);
    expect(JSON.stringify(collected)).not.toContain("access_token=leak");
    expect(JSON.stringify(collected)).not.toContain("http://files.example");
  });

  it("redacts Bearer, access, and download tokens in diagnostics", () => {
    expect(redactSecrets("Bearer at-secret access_token=abc download_token=zzz")).toBe(
      "Bearer [redacted] access_token=[redacted] download_token=[redacted]",
    );
  });

  it("replays history output items into stable cards", () => {
    const calls = extractHistoryCodeInterpreter({
      output: [{
        type: "code_interpreter_call",
        id: "ci_hist",
        status: "completed",
        code: "1+1",
        outputs: [{ type: "logs", logs: "2" }],
      }],
    });
    expect(calls).toEqual([
      {
        phase: "completed",
        itemId: "ci_hist",
        code: "1+1",
        outputs: [{ type: "logs", text: "2" }],
      },
    ]);
  });
});
