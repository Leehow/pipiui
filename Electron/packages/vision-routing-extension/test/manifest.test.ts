import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateExtensionManifest } from "../../pi-backend/src/extension-manifest.js";
import { BUNDLED_MANIFEST_EXTENSIONS } from "../../pi-backend/src/runtime-install.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("vision-routing manifest and bundled artifact", () => {
  it("declares a project-scoped builtin settings pane with a compiled entry", () => {
    const raw = JSON.parse(readFileSync(join(root, "pipiui-extension.json"), "utf8"));
    const result = validateExtensionManifest(raw);
    expect(result.ok, result.ok ? "" : result.errors.join("; ")).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.id).toBe("vision-routing");
    expect(result.manifest.capabilities).toEqual(["settings.read", "settings.write"]);
    expect(result.manifest.settings?.scope).toBe("project");
    expect(Object.keys(result.manifest.settings?.schema?.properties ?? {})).toEqual([
      "ext.vision-routing.enabled",
      "ext.vision-routing.model",
    ]);
    expect(result.manifest.ui?.settingsSections).toEqual([
      { id: "vision-routing", title: "识图模型", entry: "app/dist/settings-pane.js" },
    ]);
    expect(result.manifest.auth).toBeUndefined();
    expect(result.manifest.agentExtension).toBeUndefined();
  });

  it("syncs the compiled settings entry into the bundled runtime tree", () => {
    const bundled = join(root, "../../resources/runtime/extensions/vision-routing");
    expect(existsSync(join(root, "app/dist/settings-pane.js"))).toBe(true);
    expect(existsSync(join(bundled, "app/dist/settings-pane.js"))).toBe(true);
    expect(JSON.parse(readFileSync(join(bundled, "pipiui-extension.json"), "utf8")))
      .toEqual(JSON.parse(readFileSync(join(root, "pipiui-extension.json"), "utf8")));
    expect(BUNDLED_MANIFEST_EXTENSIONS).toContain("vision-routing");
  });
});
