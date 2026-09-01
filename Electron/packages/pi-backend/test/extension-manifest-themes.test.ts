import { describe, expect, it } from "vitest";
import { validateExtensionManifest } from "../src/extension-manifest.js";

const TOKENS = Object.fromEntries(
  ["--bg", "--surface", "--surface-raised", "--surface-hover", "--surface-input", "--border", "--border-strong", "--text", "--text-strong", "--muted", "--subtle", "--selection", "--accent", "--accent-soft", "--danger", "--warning", "--success"].map((key) => [key, "#112233"]),
);

const baseManifest = {
  id: "pipiui-theme-pack",
  name: "主题包",
  version: "1.0.0",
  capabilities: [],
};

describe("extension manifest app.ui.themes passthrough", () => {
  it("passes theme entries through validation verbatim (content is renderer-validated)", () => {
    const themes = [
      { id: "forest", name: "护眼绿", description: "深绿", scheme: "dark", tokens: TOKENS },
      { id: "paper", name: "暖米白", description: "米白", scheme: "light", tokens: TOKENS },
    ];
    const result = validateExtensionManifest({ ...baseManifest, app: { ui: { themes } } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.ui?.themes).toEqual(themes);
  });

  it("rejects a non-array themes field", () => {
    const result = validateExtensionManifest({ ...baseManifest, app: { ui: { themes: "forest" } } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("\n")).toContain("app.ui.themes must be an array");
  });

  it("omits ui entirely when themes is an empty array and nothing else is declared", () => {
    const result = validateExtensionManifest({ ...baseManifest, app: { ui: { themes: [] } } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.ui).toBeUndefined();
  });
});
