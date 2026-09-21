import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateExtensionManifest } from "../../pi-backend/src/extension-manifest.js";
import { extensionUpdateCatalogItems } from "../../../apps/electron/src/main/update-center.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundled = join(root, "../../resources/runtime/extensions/autoresearch");

describe("autoresearch manifest and vendored upstream", () => {
  it("declares the vendored upstream agent half, its skills, and no UI", () => {
    const result = validateExtensionManifest(JSON.parse(readFileSync(join(root, "pipiui-extension.json"), "utf8")));
    expect(result.ok, result.ok ? "" : result.errors.join("; ")).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.id).toBe("autoresearch");
    expect(result.manifest.capabilities).toEqual([]);
    expect(result.manifest.agentExtension).toBe("vendor/pi-autoresearch/extensions/pi-autoresearch/index.ts");
    expect(result.manifest.agentSkills).toEqual(["skills", "vendor/pi-autoresearch/skills"]);
    expect(result.manifest.ui).toBeUndefined();
    expect(result.manifest.settings).toBeUndefined();
  });

  it("keeps the 更新中心 component version in lockstep with the vendored tarball", () => {
    const manifest = JSON.parse(readFileSync(join(root, "pipiui-extension.json"), "utf8"));
    expect(manifest.updateComponents).toEqual([
      {
        id: "pi-autoresearch",
        name: "pi-autoresearch",
        version: "1.8.1",
        source: { type: "npm", packageName: "pi-autoresearch" },
        upstream: "https://github.com/davebcn87/pi-autoresearch",
        license: "MIT",
      },
    ]);
    // The version 更新中心 compares against must be the code that actually ships.
    const vendored = JSON.parse(readFileSync(join(root, "vendor/pi-autoresearch/package.json"), "utf8"));
    expect(vendored.version).toBe(manifest.updateComponents[0].version);
    expect(vendored.name).toBe("pi-autoresearch");
    expect(vendored.pi.extensions).toEqual(["./extensions"]);
    expect(vendored.pi.skills).toEqual(["./skills"]);
    expect(vendored.license).toBe("MIT");
  });

  it("surfaces in 更新中心 as a Pi 扩展 row for the vendored upstream version", () => {
    const manifest = JSON.parse(readFileSync(join(root, "pipiui-extension.json"), "utf8"));
    // Same shape `listBundledUpdateExtensions` hands the app-side catalog: an enabled
    // builtin extension carrying its manifest-declared components.
    expect(extensionUpdateCatalogItems([{
      id: manifest.id,
      name: manifest.name,
      state: "enabled",
      origin: "builtin",
      updateComponents: manifest.updateComponents,
    }])).toEqual([
      {
        id: "autoresearch:pi-autoresearch",
        name: "pi-autoresearch",
        category: "extension",
        currentVersion: "1.8.1",
        source: { type: "npm", packageName: "pi-autoresearch" },
        ownerExtensionId: "autoresearch",
        ownerExtensionName: "自动研究",
      },
    ]);
  });

  it("syncs the vendored entry and skills into the bundled runtime tree", () => {
    for (const rel of [
      "pipiui-extension.json",
      "skills/autoresearch/SKILL.md",
      "vendor/pi-autoresearch/package.json",
      "vendor/pi-autoresearch/LICENSE",
      "vendor/pi-autoresearch/extensions/pi-autoresearch/index.ts",
      "vendor/pi-autoresearch/skills/autoresearch-create/SKILL.md",
      "vendor/pi-autoresearch/skills/autoresearch-finalize/SKILL.md",
      "vendor/pi-autoresearch/skills/autoresearch-hooks/SKILL.md",
    ]) {
      expect(existsSync(join(bundled, rel)), rel).toBe(true);
    }
    expect(JSON.parse(readFileSync(join(bundled, "pipiui-extension.json"), "utf8")))
      .toEqual(JSON.parse(readFileSync(join(root, "pipiui-extension.json"), "utf8")));
  });
});
