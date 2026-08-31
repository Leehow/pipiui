import { describe, expect, it } from "vitest";

import { parseProductPackManifest } from "../src/product-pack-manifest.js";

describe("Product Pack manifest seam", () => {
  it("accepts a pure declarative Profile plus extension assembly", () => {
    expect(parseProductPackManifest({
      schemaVersion: 1,
      id: "campaign-starter",
      name: "Campaign Starter",
      profile: "profile/pipiui-profile.json",
      extensions: [{ id: "campaign-kit", path: "extensions/campaign-kit" }],
    })).toEqual({
      ok: true,
      pack: {
        schemaVersion: 1,
        id: "campaign-starter",
        name: "Campaign Starter",
        profile: "profile/pipiui-profile.json",
        extensions: [{ id: "campaign-kit", path: "extensions/campaign-kit" }],
      },
    });
  });

  it("rejects parent-path and duplicate-extension package entries before any install work", () => {
    const parsed = parseProductPackManifest({
      schemaVersion: 1,
      id: "campaign-starter",
      name: "Campaign Starter",
      profile: "../outside/pipiui-profile.json",
      extensions: [
        { id: "campaign-kit", path: "extensions/campaign-kit" },
        { id: "campaign-kit", path: "extensions/other" },
      ],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors).toEqual(expect.arrayContaining([
      "profile must be a package-relative path",
      "extensions contains duplicate extension 'campaign-kit'",
    ]));
  });
});
