import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUILTIN_EXTENSION_PACKAGES,
  CORE_CAPABILITY_EXTENSION_IDS,
  CORE_CAPABILITY_EXTENSION_PACKAGES,
  CORE_CAPABILITY_TOOL_CONTRACT,
  FROZEN_CORE_CAPABILITY_TOOL_NAMES,
  createExtensionRegistry,
} from "../src/extension-registry.js";
import {
  EXTENSION_AGENT_TOOL_NAME_RE,
  EXTENSION_HOST_API_VERSION,
  EXTENSION_NATIVE_RESOURCE_PLATFORMS,
  EXTENSION_PERMISSIONS,
  isValidExtensionHostApiRange,
  parseExtensionManifestJson,
  validateExtensionManifest,
  type ValidatedExtensionManifest,
} from "../src/extension-manifest.js";

const runtimeExtensionsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../resources/runtime/extensions",
);

const EXPECTED_TOOL_CONTRACT: Record<string, string[]> = {
  "web-access-extension": ["web_search", "fetch_content", "source_check", "get_search_content", "arxiv_fetch"],
  "webview-browser-extension": ["browser_search", "browser_fetch", "browser", "browser_flow"],
  "cua-extension": ["computer", "open_application"],
  "memory-extension": ["memory_query", "memory_status"],
};

/** Non-core base manifest: hostApi stays optional for back-compat (office/pdf et al). */
function manifest(extra: Record<string, unknown> = {}) {
  return {
    id: "probe",
    name: "Probe",
    version: "1.0.0",
    capabilities: [],
    ...extra,
  };
}

function errorsOf(value: unknown): string[] {
  const result = validateExtensionManifest(value);
  expect(result.ok).toBe(false);
  if (result.ok) return [];
  return result.errors;
}

function scaffoldManifest(id: string): ValidatedExtensionManifest {
  const raw = JSON.parse(readFileSync(join(runtimeExtensionsDir, id, "pipiui-extension.json"), "utf8"));
  const result = parseExtensionManifestJson(JSON.stringify(raw));
  expect(result.ok, `${id} scaffold manifest must validate: ${result.ok ? "" : result.errors.join("; ")}`).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.manifest;
}

describe("frozen core-capability tool contract", () => {
  it("pins the exact id → owned-tools map", () => {
    expect(Object.fromEntries(Object.entries(CORE_CAPABILITY_TOOL_CONTRACT).map(([id, tools]) => [id, [...tools]])))
      .toEqual(EXPECTED_TOOL_CONTRACT);
  });

  it("pins the exact flat tool-name list", () => {
    expect([...FROZEN_CORE_CAPABILITY_TOOL_NAMES]).toEqual([
      "web_search",
      "fetch_content",
      "source_check",
      "get_search_content",
      "arxiv_fetch",
      "browser_search",
      "browser_fetch",
      "browser",
      "browser_flow",
      "computer",
      "open_application",
      "memory_query",
      "memory_status",
    ]);
  });

  it("keeps tool names unique, well-formed, and disjoint across extensions", () => {
    const seen = new Map<string, string>();
    for (const pkg of CORE_CAPABILITY_EXTENSION_PACKAGES) {
      expect(pkg.ownedTools.length).toBeGreaterThan(0);
      for (const tool of pkg.ownedTools) {
        expect(EXTENSION_AGENT_TOOL_NAME_RE.test(tool), `tool name '${tool}'`).toBe(true);
        expect(seen.has(tool), `tool '${tool}' owned by both ${seen.get(tool)} and ${pkg.id}`).toBe(false);
        seen.set(tool, pkg.id);
      }
    }
    expect(seen.size).toBe(FROZEN_CORE_CAPABILITY_TOOL_NAMES.length);
  });

  it("does not collide with the pi runtime layer builtins", () => {
    for (const builtin of BUILTIN_EXTENSION_PACKAGES) {
      expect(CORE_CAPABILITY_EXTENSION_IDS.has(builtin.id)).toBe(false);
    }
  });
});

describe("core-capability scaffold manifests (runtime tree)", () => {
  it("ships exactly the four registered packages", () => {
    expect([...CORE_CAPABILITY_EXTENSION_IDS].sort()).toEqual(Object.keys(EXPECTED_TOOL_CONTRACT).sort());
    for (const id of CORE_CAPABILITY_EXTENSION_IDS) {
      const manifest = scaffoldManifest(id);
      expect(manifest.id).toBe(id);
      const registered = CORE_CAPABILITY_EXTENSION_PACKAGES.find((pkg) => pkg.id === id);
      expect(registered).toBeDefined();
      expect(manifest.name).toBe(registered!.name);
    }
  });

  it("declares a valid hostApi range covering the current host API level", () => {
    for (const id of CORE_CAPABILITY_EXTENSION_IDS) {
      const manifest = scaffoldManifest(id);
      expect(typeof manifest.hostApi).toBe("string");
      expect(isValidExtensionHostApiRange(manifest.hostApi)).toBe(true);
      // Sanity: the declared range admits the current host API version.
      const current = EXTENSION_HOST_API_VERSION.split(".").map(Number);
      const [floor] = manifest.hostApi!.match(/(\d+)\.(\d+)\.(\d+)/)!.slice(1).map(Number);
      expect(current[0]).toBeGreaterThanOrEqual(floor ?? 0);
    }
  });

  it("declares exactly one first-version permission per extension", () => {
    const expected: Record<string, string[]> = {
      "web-access-extension": ["net.request"],
      "webview-browser-extension": ["browser.session"],
      "cua-extension": ["native.exec"],
      "memory-extension": ["memory.read"],
    };
    for (const [id, permissions] of Object.entries(expected)) {
      expect(scaffoldManifest(id).permissions).toEqual(permissions);
      for (const permission of permissions) {
        expect(EXTENSION_PERMISSIONS).toContain(permission);
      }
    }
  });

  it("declares official-signed update metadata", () => {
    for (const id of CORE_CAPABILITY_EXTENSION_IDS) {
      const update = scaffoldManifest(id).update;
      expect(update).toBeDefined();
      expect(update!.channel).toBe("stable");
      expect(update!.signature).toBe("ed25519");
    }
  });

  it("declares the cua driver as a per-platform native resource", () => {
    const resources = scaffoldManifest("cua-extension").nativeResources;
    expect(resources).toEqual([
      { id: "cua-driver", entry: "native/cua-driver", platforms: ["darwin-arm64", "darwin-x64"] },
    ]);
    for (const platform of resources![0].platforms!) {
      expect(EXTENSION_NATIVE_RESOURCE_PLATFORMS).toContain(platform);
    }
  });

  it("non-driver scaffolds ship no native resources", () => {
    for (const id of ["web-access-extension", "webview-browser-extension", "memory-extension"]) {
      expect(scaffoldManifest(id).nativeResources).toBeUndefined();
    }
  });

  it("ingests every registered descriptor into a fresh registry as an enabled builtin", () => {
    for (const pkg of CORE_CAPABILITY_EXTENSION_PACKAGES) {
      const registry = createExtensionRegistry([pkg]);
      const record = registry.get(pkg.id);
      expect(record).toBeDefined();
      expect(record!.state).toBe("enabled");
      expect(record!.origin).toBe("builtin");
      expect(record!.uninstallable).toBe(false);
      expect([...registry.capabilities(pkg.id)]).toEqual([]);
    }
  });
});

describe("manifest contract: hostApi", () => {
  it("rejects a core-capability manifest missing the hostApi range", () => {
    const errors = errorsOf(manifest({ id: "web-access-extension", name: "Web Access" }));
    expect(errors.some((error) => error.includes("hostApi"))).toBe(true);
  });

  it("rejects malformed hostApi ranges", () => {
    for (const hostApi of ["banana", 42, null, "", "^1", ">=1.0.0 || <0.5.0", "1.0.0 - 2.0.0"]) {
      expect(isValidExtensionHostApiRange(hostApi), `hostApi ${JSON.stringify(hostApi)}`).toBe(false);
    }
    for (const hostApi of ["banana", 42]) {
      const errors = errorsOf(manifest({ hostApi }));
      expect(errors.some((error) => error.includes("hostApi"))).toBe(true);
    }
  });

  it("accepts and preserves a valid range; stays optional for non-core manifests", () => {
    const ok = validateExtensionManifest(manifest({ hostApi: ">=1.0.0 <2.0.0" }));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.manifest.hostApi).toBe(">=1.0.0 <2.0.0");
    expect(validateExtensionManifest(manifest()).ok).toBe(true);
    for (const range of ["^1.0.0", "~1.2.3", "1.2.3", ">=1.0.0", "1.0.0-beta.1"]) {
      expect(isValidExtensionHostApiRange(range), `hostApi ${range}`).toBe(true);
    }
  });
});

describe("manifest contract: permissions / nativeResources / update", () => {
  it("rejects unknown permissions and non-array permissions", () => {
    expect(errorsOf(manifest({ permissions: ["filesystem.write"] })).some((error) => error.includes("permission")))
      .toBe(true);
    expect(errorsOf(manifest({ permissions: "net.request" })).some((error) => error.includes("permissions")))
      .toBe(true);
    const ok = validateExtensionManifest(manifest({ permissions: ["net.request", "net.request"] }));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.manifest.permissions).toEqual(["net.request"]);
  });

  it("validates nativeResources entries", () => {
    const ok = validateExtensionManifest(manifest({
      nativeResources: [{ id: "cua-driver", entry: "native/cua-driver", platforms: ["darwin-universal"] }],
    }));
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.manifest.nativeResources).toEqual([
        { id: "cua-driver", entry: "native/cua-driver", platforms: ["darwin-universal"] },
      ]);
    }
    const bad: Array<[string, unknown]> = [
      ["non-array", { nativeResources: "native/cua-driver" }],
      ["absolute entry", { nativeResources: [{ id: "drv", entry: "/usr/bin/drv" }] }],
      ["dotdot entry", { nativeResources: [{ id: "drv", entry: "../drv" }] }],
      ["unknown platform", { nativeResources: [{ id: "drv", entry: "bin/drv", platforms: ["linux-x64"] }] }],
      ["bad id", { nativeResources: [{ id: "Cua Driver", entry: "bin/drv" }] }],
      ["duplicate id", { nativeResources: [{ id: "drv", entry: "bin/a" }, { id: "drv", entry: "bin/b" }] }],
      ["unknown field", { nativeResources: [{ id: "drv", entry: "bin/drv", url: "https://x" }] }],
    ];
    for (const [label, extra] of bad) {
      expect(errorsOf(manifest(extra)).length, label).toBeGreaterThan(0);
    }
  });

  it("validates update metadata against the closed enums and source union", () => {
    const ok = validateExtensionManifest(manifest({
      update: {
        source: { type: "githubReleases", owner: "example", repo: "ext" },
        channel: "stable",
        signature: "ed25519",
      },
    }));
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.manifest.update).toEqual({
        source: { type: "githubReleases", owner: "example", repo: "ext" },
        channel: "stable",
        signature: "ed25519",
      });
    }
    const bad: Array<[string, unknown]> = [
      ["unknown channel", { update: { channel: "canary" } }],
      ["unknown signature", { update: { signature: "rsa" } }],
      ["missing source object", { update: { source: 7 } }],
      ["unknown source type", { update: { source: { type: "http", url: "https://x" } } }],
      ["unknown update field", { update: { channel: "stable", freeze: true } }],
      ["non-object update", { update: "stable" }],
    ];
    for (const [label, extra] of bad) {
      expect(errorsOf(manifest(extra)).length, label).toBeGreaterThan(0);
    }
    // Metadata without a source stays valid at the manifest layer (scaffold
    // stage); the updater requires a source before any download.
    const sourceless = validateExtensionManifest(manifest({ update: { channel: "stable" } }));
    expect(sourceless.ok).toBe(true);
  });
});
