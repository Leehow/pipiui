import { describe, expect, it } from "vitest";
import {
  applyStructuredOutput,
  normalizeStructuredOutputRequest,
  normalizeStructuredOutputResult,
  STRUCTURED_OUTPUT_SCHEMA_MAX_CHARS,
  structuredOutputsEnabled,
  toResponsesTextFormat,
} from "../agent/structured-output.js";

const schema = {
  type: "object",
  additionalProperties: false,
  properties: { answer: { type: "string" } },
  required: ["answer"],
} as const;

const enabled = { structuredOutputs: true as const };

describe("structured output request contract", () => {
  it("is off unless structuredOutputs is explicitly declared", () => {
    expect(structuredOutputsEnabled(undefined)).toBe(false);
    expect(structuredOutputsEnabled({})).toBe(false);
    expect(structuredOutputsEnabled({ structuredOutputs: false })).toBe(false);
    expect(structuredOutputsEnabled({ hostedTools: { tools: ["code_interpreter"] } })).toBe(false);
    expect(structuredOutputsEnabled({ structuredOutputs: true })).toBe(true);
    expect(structuredOutputsEnabled({ structuredOutputs: { jsonSchema: true } })).toBe(true);
    expect(structuredOutputsEnabled({ structuredOutputs: { jsonSchema: false } })).toBe(false);
  });

  it("rejects empty name, non-object / unserializable / cyclic / oversized schema", () => {
    expect(() => normalizeStructuredOutputRequest({ name: "  ", schema })).toThrow(/名称不能为空/);
    expect(() => normalizeStructuredOutputRequest({ name: "out", schema: ["array"] })).toThrow(/必须是 JSON 对象/);
    expect(() => normalizeStructuredOutputRequest({ name: "out", schema: null })).toThrow(/必须是 JSON 对象/);
    expect(() => normalizeStructuredOutputRequest({
      name: "out",
      schema: { type: "object", n: 1n },
    })).toThrow(/不可序列化/);
    const cyclic: Record<string, unknown> = { type: "object" };
    cyclic.self = cyclic;
    expect(() => normalizeStructuredOutputRequest({ name: "out", schema: cyclic })).toThrow(/循环引用/);
    const huge = { type: "object", title: "x".repeat(STRUCTURED_OUTPUT_SCHEMA_MAX_CHARS) };
    expect(() => normalizeStructuredOutputRequest({ name: "out", schema: huge })).toThrow(/明显超限/);
  });

  it("maps official Responses text.format json_schema and does not become a function tool", () => {
    const request = normalizeStructuredOutputRequest({
      name: " answer_card ",
      schema,
      description: "one field",
    });
    expect(toResponsesTextFormat(request)).toEqual({
      type: "json_schema",
      name: "answer_card",
      schema,
      strict: true,
      description: "one field",
    });

    const tools = [{ type: "function", name: "bash" }, { type: "web_search" }];
    const base = {
      model: "grok-4.6",
      stream: true,
      input: [{ role: "user", content: "hi" }],
      tools,
    };
    const composed = applyStructuredOutput(base, {
      name: "answer_card",
      schema: { ...schema },
      strict: false,
    }, enabled);
    expect(composed.input).toEqual(base.input);
    expect(composed.stream).toBe(true);
    expect(composed.tools).toEqual(tools);
    expect(composed.tools).toBe(tools);
    expect(composed.text).toEqual({
      format: {
        type: "json_schema",
        name: "answer_card",
        schema,
        strict: false,
      },
    });
    expect(JSON.stringify(composed.tools)).not.toContain("answer_card");
    expect(composed.tools).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "answer_card" })]),
    );
  });

  it("leaves ordinary text payloads unchanged and fail-closes without capability", () => {
    const payload = { model: "grok-4.6", stream: true, input: [{ role: "user", content: "hi" }] };
    expect(applyStructuredOutput(payload, undefined, enabled)).toBe(payload);
    expect(applyStructuredOutput(payload, null, { structuredOutputs: true })).toBe(payload);
    expect(payload).not.toHaveProperty("text");
    expect(() => applyStructuredOutput(payload, { name: "out", schema: { ...schema } })).toThrow(/未声明 structuredOutputs/);
    expect(() => applyStructuredOutput(
      payload,
      { name: "out", schema: { ...schema } },
      { hostedTools: { tools: ["web_search"] } },
    )).toThrow(/未声明 structuredOutputs/);
    expect(payload).toEqual({ model: "grok-4.6", stream: true, input: [{ role: "user", content: "hi" }] });
  });
});

describe("structured output result normalization", () => {
  it("distinguishes valid JSON, refusal, invalid, incomplete, and provider error", () => {
    expect(normalizeStructuredOutputResult({
      status: "completed",
      output_text: "{\"answer\":\"ok\"}",
    }, "answer_card")).toEqual({
      kind: "valid_json",
      name: "answer_card",
      value: { answer: "ok" },
      text: "{\"answer\":\"ok\"}",
    });

    expect(normalizeStructuredOutputResult({
      output: [{
        type: "message",
        content: [{ type: "refusal", refusal: "I will not do that. Bearer sk-secret" }],
      }],
    })).toEqual({
      kind: "refusal",
      message: "I will not do that. Bearer [redacted]",
    });

    expect(normalizeStructuredOutputResult({
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: "not-json" }] }],
    })).toMatchObject({ kind: "invalid", text: "not-json" });

    expect(normalizeStructuredOutputResult({
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output_text: "{\"answer\":",
    })).toMatchObject({
      kind: "incomplete",
      message: "max_output_tokens",
      text: "{\"answer\":",
    });

    expect(normalizeStructuredOutputResult({
      error: { code: "invalid_request", message: "bad schema Bearer at-secret" },
    })).toEqual({
      kind: "provider_error",
      message: "bad schema Bearer [redacted]",
      code: "invalid_request",
    });
    expect(normalizeStructuredOutputResult({
      error: {
        message: "fail path=/Users/haoli/secret.md file-abc data:image/png;base64,QUJD token=secret",
      },
    }).message).toEqual("fail path=[path] [file_id] [base64] token=secret");
  });
});
