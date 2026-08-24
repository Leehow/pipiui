import { describe, expect, it } from "vitest";
import { normalizedModels } from "../agent/context-window.js";
import { resolveDefaultContextWindow, type QoderModelEntry } from "../agent/vendor/models.js";

const previewEntry: QoderModelEntry = {
  key: "qmodel_preview",
  max_input_tokens: 180000,
  context_config: {
    "200k": { token_count: 200000, is_default: true },
    "400k": { token_count: 400000, is_default: false },
    "1m": { token_count: 1000000, is_default: false },
  },
};

describe("qoder context-window compat", () => {
  it("prefers the API is_default tier over the largest tier", () => {
    expect(resolveDefaultContextWindow(previewEntry, 1000000)).toBe(200000);
  });

  it("falls back to max_input_tokens then the caller value", () => {
    expect(resolveDefaultContextWindow({ max_input_tokens: 180000 }, 1)).toBe(180000);
    expect(resolveDefaultContextWindow(null, 42)).toBe(42);
  });

  it("normalizes only models that have a cache entry", () => {
    const models = [
      { id: "qmodel_preview", contextWindow: 1000000 },
      { id: "unknown", contextWindow: 256000 },
    ];
    const out = normalizedModels(models, { qmodel_preview: previewEntry });
    expect(out[0]?.contextWindow).toBe(200000);
    expect(out[1]?.contextWindow).toBe(256000);
  });
});
