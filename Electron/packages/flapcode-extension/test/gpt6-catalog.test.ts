import { describe, expect, it } from "vitest";
import { FLAPCODE_DEFAULT_MODEL_ID, flapcodeManifestModels } from "../agent/models.js";

// OpenAI model docs, checked 2026-09-23:
// https://developers.openai.com/api/docs/models/gpt-6-{astra,sol,luna}
// These assert catalog metadata, not relay availability or subscription prices.
describe("Flapcode GPT-6 catalog", () => {
  it.each([
    { id: "gpt-6-astra", name: "GPT-6 Astra", input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
    { id: "gpt-6-sol", name: "GPT-6 Sol", input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
    { id: "gpt-6-luna", name: "GPT-6 Luna", input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  ])("publishes documented metadata for $id", ({ id, name, ...cost }) => {
    const model = flapcodeManifestModels().find((entry) => entry.id === id);
    expect(model).toMatchObject({
      id,
      name: `${name} (Flapcode)`,
      api: "openai-responses",
      reasoning: true,
      input: ["text", "image"],
      cost,
      contextWindow: 1050000,
      maxTokens: 128000,
      compat: { supportsLongCacheRetention: false, supportsStrictMode: true },
    });
    expect(model?.thinkingLevelMap).toEqual({
      minimal: "low",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
      ...(id === "gpt-6-astra" ? { off: null } : {}),
    });
  });

  it("retains legacy model IDs and the existing default without inventing GPT-6 Terra", () => {
    const ids = flapcodeManifestModels().map((model) => model.id);
    expect(FLAPCODE_DEFAULT_MODEL_ID).toBe("gpt-5.6-sol");
    expect(ids[0]).toBe(FLAPCODE_DEFAULT_MODEL_ID);
    expect(ids).toEqual(expect.arrayContaining([
      "gpt-5.5", "gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.6-terra",
    ]));
    expect(ids).not.toContain("gpt-6-terra");
    expect(new Set(ids).size).toBe(ids.length);
  });
});
