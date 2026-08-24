import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectCodeInterpreterStream,
  interpretCodeInterpreterEvent as interpretPackageEvent,
} from "../agent/hosted-code-interpreter.js";
import {
  interpretAndEmitCodeInterpreter,
  interpretCodeInterpreterEvent as interpretRuntimeEvent,
  toHostedCodeInterpreterEvent,
  type HostedCodeInterpreterAssistantEvent,
} from "../../../resources/runtime/extensions/hosted-code-interpreter-events.ts";
import {
  interpretAndEmit,
  uninstallHostedSearchCapture,
  wrapFetchForHostedSearch,
  type HostedAssistantEvent,
} from "../../../resources/runtime/extensions/hosted-search-events.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadFixture(name: string): unknown[] {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8")) as unknown[];
}

afterEach(() => {
  uninstallHostedSearchCapture();
});

describe("hosted code interpreter production events", () => {
  it("keeps package and runtime parsers aligned on official fixtures", () => {
    const events = [
      ...loadFixture("responses-hosted-code-interpreter-stream.json"),
      ...loadFixture("responses-hosted-code-interpreter-failed.json"),
    ];
    for (const event of events) {
      expect(interpretRuntimeEvent(event)).toEqual(interpretPackageEvent(event));
    }
  });

  it("emits typed hosted_code_interpreter from the production hook with stable callId and merged code", () => {
    const events = loadFixture("responses-hosted-code-interpreter-stream.json");
    const collected: HostedAssistantEvent[] = [];
    const seen = new Set<string>();
    for (const event of events) interpretAndEmit(event, (item) => collected.push(item), seen);
    const code = collected.filter((item): item is HostedCodeInterpreterAssistantEvent => (
      item.type === "hosted_code_interpreter"
    ));
    expect(code.map((item) => item.phase)).toEqual([
      "queued",
      "in_progress",
      "in_progress",
      "in_progress",
      "in_progress",
      "interpreting",
      "completed",
      "completed",
    ]);
    expect(new Set(code.map((item) => item.callId))).toEqual(new Set(["ci_1"]));
    const done = code.at(-1);
    expect(done).toMatchObject({
      type: "hosted_code_interpreter",
      callId: "ci_1",
      phase: "completed",
      code: "print(42)",
      outputs: [{ type: "logs", text: "42\n" }],
      files: [{ filename: "plot.png", mimeType: "image/png", url: "https://files.example/plot.png" }],
    });
    expect(JSON.stringify(code)).not.toContain("token=secret");
    expect(JSON.stringify(code)).not.toContain("Bearer");
    expect(collected.some((item) => item.type === "server_side_usage")).toBe(true);
  });

  it("tees /responses SSE into hosted_code_interpreter without local execution or secret leak", async () => {
    const emitted: HostedAssistantEvent[] = [];
    const body = [
      'data: {"type":"response.code_interpreter_call.queued","item_id":"ci_fetch","output_index":1}',
      "",
      'data: {"type":"response.code_interpreter_call_code.delta","item_id":"ci_fetch","delta":"print("}',
      "",
      'data: {"type":"response.code_interpreter_call_code.delta","item_id":"ci_fetch","delta":"1)"}',
      "",
      'data: {"type":"response.code_interpreter_call.completed","item_id":"ci_fetch","outputs":[{"type":"logs","logs":"1\\n Bearer sk-secret access_token=abc"}]}',
      "",
    ].join("\n");
    const wrapped = wrapFetchForHostedSearch(async () => new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }), (event) => emitted.push(event));
    const response = await wrapped("https://api.x.ai/v1/responses", { method: "POST" });
    expect(await response.text()).toContain("response.code_interpreter_call.queued");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const code = emitted.filter((item): item is HostedCodeInterpreterAssistantEvent => (
      item.type === "hosted_code_interpreter"
    ));
    expect(code[0]).toMatchObject({ type: "hosted_code_interpreter", callId: "ci_fetch", phase: "queued" });
    expect(code.some((item) => item.phase === "completed" && item.code === "print(1)")).toBe(true);
    expect(code.at(-1)?.outputs?.[0]?.text).toContain("Bearer [redacted]");
    expect(JSON.stringify(emitted)).not.toContain("sk-secret");
    expect(JSON.stringify(emitted)).not.toContain("access_token=abc");
    expect(JSON.stringify(emitted)).not.toContain("python");
  });

  it("runtime sink ignores unknown events and maps incomplete to failed", () => {
    const emitted: HostedCodeInterpreterAssistantEvent[] = [];
    expect(interpretAndEmitCodeInterpreter({ type: "response.output_text.delta", delta: "hi" }, (item) => {
      emitted.push(item);
    })).toBe(false);
    expect(interpretAndEmitCodeInterpreter({
      type: "response.code_interpreter_call.incomplete",
      item_id: "ci_inc",
    }, (item) => {
      emitted.push(item);
    })).toBe(true);
    expect(emitted).toEqual([
      toHostedCodeInterpreterEvent({ phase: "failed", itemId: "ci_inc" }),
    ]);
    expect(collectCodeInterpreterStream([{ type: "response.image_generation.completed" }]).calls).toEqual([]);
  });
});
