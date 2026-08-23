import { describe, expect, it } from "vitest";
import {
  applyJsonOutputConstraint,
  isStructuredOutputRequest,
  JSON_CONSTRAINT_TEXT,
  JSON_OBJECT_FORMAT,
  payloadMentionsJson,
  rewriteJsonOutput,
} from "../agent/json-output.js";

describe("DeepSeek JSON Output rewrite", () => {
  it("leaves non-structured payloads unchanged", () => {
    const payload = {
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "hello" }],
    };
    expect(isStructuredOutputRequest(payload)).toBe(false);
    expect(rewriteJsonOutput(payload)).toEqual(payload);
    expect(applyJsonOutputConstraint(payload)).toEqual({
      payload,
      applied: false,
      injectedConstraint: false,
    });
  });

  it("does not treat response_format text as structured", () => {
    const payload = {
      messages: [{ role: "user", content: "hello" }],
      response_format: { type: "text" },
    };
    expect(isStructuredOutputRequest(payload)).toBe(false);
    expect(rewriteJsonOutput(payload)).toEqual(payload);
  });

  it("leaves json_schema structured-output requests untouched", () => {
    const payload = {
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "return name and age" }],
      response_format: { type: "json_schema", json_schema: { name: "x", schema: { type: "object" } } },
    };
    expect(isStructuredOutputRequest(payload)).toBe(false);
    expect(applyJsonOutputConstraint(payload)).toEqual({
      payload,
      applied: false,
      injectedConstraint: false,
    });
  });

  it("injects json_object and a JSON constraint when the prompt has no JSON word", () => {
    const payload = {
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "return name and age" }],
      response_format: { type: "json_object" },
    };
    const result = applyJsonOutputConstraint(payload);
    expect(result.applied).toBe(true);
    expect(result.injectedConstraint).toBe(true);
    expect(result.payload.response_format).toEqual(JSON_OBJECT_FORMAT);
    expect(result.payload.messages[0]).toEqual({ role: "system", content: JSON_CONSTRAINT_TEXT });
    expect(result.payload.messages[1]).toEqual({ role: "user", content: "return name and age" });
    expect(payloadMentionsJson(result.payload)).toBe(true);
    expect(JSON_CONSTRAINT_TEXT).toMatch(/JSON/);
    expect(payload).toEqual({
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "return name and age" }],
      response_format: { type: "json_object" },
    });
  });

  it("appends the constraint to an existing system message", () => {
    const payload = {
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "pack the answer" },
      ],
      response_format: { type: "json_object" },
    };
    const next = rewriteJsonOutput(payload);
    expect(next.messages[0]).toEqual({
      role: "system",
      content: `Be concise.\n${JSON_CONSTRAINT_TEXT}`,
    });
    expect(next.messages[1]).toEqual({ role: "user", content: "pack the answer" });
  });

  it("does not append a constraint when messages already mention json", () => {
    const payload = {
      messages: [{ role: "user", content: "Reply as JSON with keys a and b" }],
      response_format: { type: "json_object" },
    };
    const result = applyJsonOutputConstraint(payload);
    expect(result.applied).toBe(true);
    expect(result.injectedConstraint).toBe(false);
    expect(result.payload.messages).toEqual(payload.messages);
    expect(result.payload.response_format).toEqual(JSON_OBJECT_FORMAT);
  });

  it("detects JSON case-insensitively in array content parts", () => {
    const payload = {
      messages: [{ role: "user", content: [{ type: "text", text: "use Json object" }] }],
      response_format: { type: "json_object" },
    };
    expect(payloadMentionsJson(payload)).toBe(true);
    expect(applyJsonOutputConstraint(payload).injectedConstraint).toBe(false);
  });

  it("leaves Responses json_schema text.format untouched", () => {
    const payload = {
      model: "deepseek-v4-flash",
      input: [{ role: "user", content: [{ type: "input_text", text: "today's weather" }] }],
      text: { format: { type: "json_schema", name: "weather", schema: { type: "object" } } },
    };
    expect(isStructuredOutputRequest(payload)).toBe(false);
    expect(rewriteJsonOutput(payload)).toEqual(payload);
  });

  it("rewrites Responses text.format and injects instructions when needed", () => {
    const payload = {
      model: "deepseek-v4-flash",
      input: [{ role: "user", content: [{ type: "input_text", text: "today's weather" }] }],
      text: { format: { type: "json_object" } },
    };
    const result = applyJsonOutputConstraint(payload);
    expect(result.applied).toBe(true);
    expect(result.injectedConstraint).toBe(true);
    expect(result.payload.text).toEqual({ format: JSON_OBJECT_FORMAT });
    expect(result.payload.input[0]).toEqual({ role: "system", content: JSON_CONSTRAINT_TEXT });
  });

  it("appends the constraint to Responses instructions", () => {
    const payload = {
      input: [{ role: "user", content: "data" }],
      instructions: "Be brief.",
      text: { format: { type: "json_object" } },
    };
    const next = rewriteJsonOutput(payload);
    expect(next.instructions).toBe(`Be brief.\n${JSON_CONSTRAINT_TEXT}`);
    expect(next.input).toEqual(payload.input);
  });
});
