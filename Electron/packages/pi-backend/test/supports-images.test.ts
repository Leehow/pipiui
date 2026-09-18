import { describe, expect, it } from "vitest";
import { supportsImagesFor } from "../src/supports-images.js";

describe("supportsImagesFor", () => {
  it("defaults to multimodal, including DeepSeek and catalogs that omit image from input", () => {
    expect(supportsImagesFor("deepseek-v3", "deepseek")).toBe(true);
    expect(supportsImagesFor("deepseek-flash", "deepseek-extended")).toBe(true);
    expect(supportsImagesFor("deepseek-v4-pro", "deepseek-extended")).toBe(true);
    expect(supportsImagesFor("gpt-5", "openai", ["text"])).toBe(true);
    expect(supportsImagesFor("mystery-1", "acme")).toBe(true);
    expect(supportsImagesFor("grok-4-fast", "grok-build", ["text"])).toBe(true);
  });

  it("marks GLM text models before 5.3 as text-only, including when input claims image", () => {
    for (const id of ["glm-4", "glm-4.5", "glm-4.6", "GLM-4.6", "glm-5", "glm-5.0", "glm-5.1", "glm-5.2"]) {
      expect(supportsImagesFor(id, "zai-coding-cn"), id).toBe(false);
      expect(supportsImagesFor(id, "zai", ["text", "image"]), id).toBe(false);
    }
  });

  it("treats GLM 5.3 and later, and pre-5.3 vision SKUs, as multimodal", () => {
    for (const id of [
      "glm-5.3",
      "glm-5.3-flash",
      "glm-5.4",
      "glm-6",
      "glm-4v-plus",
      "glm-4.5v",
      "glm-5v",
      "glm-4vl",
    ]) {
      expect(supportsImagesFor(id, "zai"), id).toBe(true);
    }
  });
});
