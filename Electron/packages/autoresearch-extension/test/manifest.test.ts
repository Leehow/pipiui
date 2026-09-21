import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { validateExtensionManifest } from "../../pi-backend/src/extension-manifest.js";
import { extensionUpdateCatalogItems } from "../../../apps/electron/src/main/update-center.js";

// The mount composes the vendored upstream extension; upstream's own module cannot be imported
// here (its `@sinclair/typebox` / `@earendil-works/pi-ai` imports only resolve inside Pi's
// loader), so it is stubbed and only the mount's own decisions are exercised.
vi.mock("../vendor/pi-autoresearch/extensions/pi-autoresearch/index.ts", () => ({ default: () => undefined }));
const { AUTORESEARCH_ACTIVATION_ENTRY, AUTORESEARCH_TOOL_NAMES, explicitlyTurnedOff } = await import("../mount/autoresearch.js");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundled = join(root, "../../resources/runtime/extensions/autoresearch");
const vendoredEntry = "vendor/pi-autoresearch/extensions/pi-autoresearch/index.ts";

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const branch = (entries: unknown[]) => ({ sessionManager: { getBranch: () => entries } }) as never;

describe("autoresearch manifest and vendored upstream", () => {
  it("declares the PipiUI mount, the skills, and no UI", () => {
    const result = validateExtensionManifest(readJson(join(root, "pipiui-extension.json")));
    expect(result.ok, result.ok ? "" : result.errors.join("; ")).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.id).toBe("autoresearch");
    expect(result.manifest.capabilities).toEqual([]);
    expect(result.manifest.agentExtension).toBe("mount/autoresearch.ts");
    expect(result.manifest.agentSkills).toEqual(["skills", "vendor/pi-autoresearch/skills"]);
    expect(result.manifest.ui).toBeUndefined();
    expect(result.manifest.settings).toBeUndefined();
  });

  it("keeps the 更新中心 component version in lockstep with the vendored tarball", () => {
    const manifest = readJson(join(root, "pipiui-extension.json"));
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
    const vendored = readJson(join(root, "vendor/pi-autoresearch/package.json"));
    expect(vendored.version).toBe(manifest.updateComponents[0].version);
    expect(vendored.name).toBe("pi-autoresearch");
    expect(vendored.pi.extensions).toEqual(["./extensions"]);
    expect(vendored.pi.skills).toEqual(["./skills"]);
    expect(vendored.license).toBe("MIT");
  });

  it("surfaces in 更新中心 as a Pi 扩展 row for the vendored upstream version", () => {
    const manifest = readJson(join(root, "pipiui-extension.json"));
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

  it("mounts the vendored entry through a relative path that exists", () => {
    const source = readFileSync(join(root, "mount/autoresearch.ts"), "utf8");
    const imported = /from "(\.[^"]*pi-autoresearch[^"]*)"/.exec(source)?.[1];
    expect(imported, "mount must import the vendored entry").toBeTruthy();
    expect(resolve(join(root, "mount"), imported!)).toBe(resolve(join(root, vendoredEntry)));
    expect(existsSync(join(root, vendoredEntry))).toBe(true);
  });

  it("names exactly the tools upstream gates, and its own activation entry type", () => {
    const vendored = readFileSync(join(root, vendoredEntry), "utf8");
    expect(AUTORESEARCH_TOOL_NAMES).toEqual(["init_experiment", "run_experiment", "log_experiment"]);
    for (const name of AUTORESEARCH_TOOL_NAMES) {
      expect(vendored, `${name} is registered by upstream`).toContain(`name: "${name}"`);
    }
    // Both are upstream internals this mount depends on; a re-vendor that renames either
    // must fail here instead of silently leaving the tools gated.
    expect(vendored).toContain(`AUTORESEARCH_ACTIVATION_ENTRY = "${AUTORESEARCH_ACTIVATION_ENTRY}"`);
    expect(vendored).toContain("registerGatedTool");
    expect(vendored).toContain("setActiveTools");
  });

  it("treats the newest recorded mode decision as the one that wins", () => {
    const entry = (active: boolean) => ({ customType: AUTORESEARCH_ACTIVATION_ENTRY, data: { active } });
    expect(explicitlyTurnedOff(branch([]))).toBe(false);
    expect(explicitlyTurnedOff(branch([entry(false)]))).toBe(true);
    expect(explicitlyTurnedOff(branch([entry(false), entry(true)]))).toBe(false);
    expect(explicitlyTurnedOff(branch([entry(true), entry(false)]))).toBe(true);
    // Unrelated entries and malformed payloads never flip the decision.
    expect(explicitlyTurnedOff(branch([{ customType: "other", data: { active: false } }]))).toBe(false);
    expect(explicitlyTurnedOff(branch([{ customType: AUTORESEARCH_ACTIVATION_ENTRY, data: {} }]))).toBe(false);
  });

  it("syncs the mount, vendored entry and skills into the bundled runtime tree", () => {
    for (const rel of [
      "pipiui-extension.json",
      "mount/autoresearch.ts",
      "skills/autoresearch/SKILL.md",
      "vendor/pi-autoresearch/package.json",
      "vendor/pi-autoresearch/LICENSE",
      vendoredEntry,
      "vendor/pi-autoresearch/skills/autoresearch-create/SKILL.md",
      "vendor/pi-autoresearch/skills/autoresearch-finalize/SKILL.md",
      "vendor/pi-autoresearch/skills/autoresearch-hooks/SKILL.md",
    ]) {
      expect(existsSync(join(bundled, rel)), rel).toBe(true);
    }
    expect(readJson(join(bundled, "pipiui-extension.json"))).toEqual(readJson(join(root, "pipiui-extension.json")));
    expect(readFileSync(join(bundled, "mount/autoresearch.ts"), "utf8"))
      .toBe(readFileSync(join(root, "mount/autoresearch.ts"), "utf8"));
  });
});
