import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateExtensionManifest } from "../../pi-backend/src/extension-manifest.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("pipiui-headroom manifest and bundled artifact", () => {
  it("declares an independent project-scoped extension with no provider rewrite", () => {
    const raw = JSON.parse(readFileSync(join(root, "pipiui-extension.json"), "utf8"));
    const result = validateExtensionManifest(raw);
    expect(result.ok, result.ok ? "" : result.errors.join("; ")).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.id).toBe("pipiui-headroom");
    expect(result.manifest.agentExtension).toBe("agent/dist/index.js");
    expect(result.manifest.settings?.scope).toBe("project");
    expect(result.manifest.auth).toBeUndefined();
    expect(result.manifest.ui?.panels ?? []).toEqual([]);
  });

  it("syncs the compiled agent half into the bundled runtime tree", () => {
    const bundled = join(root, "../../resources/runtime/extensions/pipiui-headroom");
    expect(existsSync(join(root, "agent/dist/index.js"))).toBe(true);
    expect(existsSync(join(bundled, "agent/dist/index.js"))).toBe(true);
    expect(existsSync(join(bundled, "LICENSE"))).toBe(true);
    expect(existsSync(join(bundled, "NOTICE"))).toBe(true);
    expect(JSON.parse(readFileSync(join(bundled, "pipiui-extension.json"), "utf8")))
      .toEqual(JSON.parse(readFileSync(join(root, "pipiui-extension.json"), "utf8")));
  });
});
