import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLED_MANIFEST_EXTENSIONS } from "../../pi-backend/src/runtime-install.ts";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const runtimeRoot = join(dirname(packageRoot), "..", "resources", "runtime");
const mirrorRoot = join(runtimeRoot, "extensions", "pdf-extension");

describe("pipiui-pdf-extension manifest + generated runtime mirror", () => {
  it("declares the bundled pdf-extension manifest with an agent entry and a namespaced project secret setting", async () => {
    const manifest = JSON.parse(await readFile(join(packageRoot, "pipiui-extension.json"), "utf8")) as Record<string, unknown>;
    expect(manifest.id).toBe("pdf-extension");
    expect(manifest.name).toBe("PipiUI PDF");
    expect(manifest.capabilities).toEqual([]);
    expect((manifest.agent as { extension?: string }).extension).toBe("agent/dist/index.js");

    const settings = (manifest.app as { settings?: { scope?: string; settingsVersion?: number; schema?: { properties?: Record<string, unknown> } } }).settings!;
    expect(settings.scope).toBe("project");
    expect(settings.settingsVersion).toBeGreaterThanOrEqual(1);
    const keys = Object.keys(settings.schema?.properties ?? {});
    expect(keys).toEqual(["ext.pdf-extension.aistudioAccessToken"]);
    expect(settings.schema?.properties?.["ext.pdf-extension.aistudioAccessToken"]).toMatchObject({
      type: "string",
      format: "secret",
    });
    // The package owns its vendored inspector tree through an explicit declaration.
    expect(manifest.runtimeAssets).toEqual(["vendor/pdf-inspector"]);
  });

  it("keeps the vendored pdf-inspector tree pinned (the legacy runtime copy is removed after the cutover)", () => {
    const vendorVersion = JSON.parse(readFileSync(join(packageRoot, "vendor/pdf-inspector/node_modules/@firecrawl/pdf-inspector/package.json"), "utf8")).version;
    expect(vendorVersion).toBe("1.27.0");
    expect(existsSync(join(runtimeRoot, "pdf-inspector"))).toBe(false);
    const wasmManifest = JSON.parse(readFileSync(join(packageRoot, "vendor/pdf-inspector/node_modules/@firecrawl/pdf-inspector-wasm/package.json"), "utf8"));
    expect(wasmManifest.version).toBe("1.27.0");
    expect(existsSync(join(packageRoot, "vendor/pdf-inspector/node_modules/@firecrawl/pdf-inspector-darwin-arm64"))).toBe(true);
  });

  it("declares the vendored Firecrawl inspector as its update component", async () => {
    const manifest = JSON.parse(await readFile(join(packageRoot, "pipiui-extension.json"), "utf8")) as {
      updateComponents?: Array<Record<string, unknown>>;
    };
    expect(manifest.updateComponents).toEqual([
      {
        id: "firecrawl-pdf-inspector",
        name: "@firecrawl/pdf-inspector",
        version: "1.27.0",
        source: { type: "npm", packageName: "@firecrawl/pdf-inspector" },
        upstream: "https://github.com/firecrawl/pdf-inspector",
        license: "MIT",
      },
    ]);
  });

  it("keeps the declared update component in lockfile lockstep with the vendored Firecrawl pins", () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, "pipiui-extension.json"), "utf8")) as {
      updateComponents?: Array<{ name: string; version: string }>;
    };
    const declared = manifest.updateComponents?.find((component) => component.name === "@firecrawl/pdf-inspector");
    expect(declared).toBeDefined();
    const vendorManifest = JSON.parse(readFileSync(join(packageRoot, "vendor/pdf-inspector/package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(vendorManifest.dependencies["@firecrawl/pdf-inspector"]).toBe(declared!.version);
    expect(vendorManifest.dependencies["@firecrawl/pdf-inspector-wasm"]).toBe(declared!.version);
    const lock = JSON.parse(readFileSync(join(packageRoot, "vendor/pdf-inspector/package-lock.json"), "utf8")) as {
      packages: Record<string, { version: string }>;
    };
    const pinnedVersions = Object.entries(lock.packages)
      .filter(([key]) => key.includes("node_modules/@firecrawl/pdf-inspector"))
      .map(([, entry]) => entry.version);
    expect(pinnedVersions.length).toBeGreaterThan(0);
    for (const version of pinnedVersions) expect(version).toBe(declared!.version);
  });

  it("keeps no duplicate inspector version constant in the agent half (lockfile + manifest are the single source)", () => {
    expect(readFileSync(join(packageRoot, "agent/pdf-inspector-local.ts"), "utf8")).not.toContain("PDF_INSPECTOR_VERSION");
    // The generated mirror must not resurrect the removed duplicate from a stale build.
    expect(existsSync(mirrorRoot), "run `npm run build -w @pipiui/pipiui-pdf-extension` first").toBe(true);
    expect(readFileSync(join(mirrorRoot, "agent/dist/pdf-inspector-local.js"), "utf8")).not.toContain("PDF_INSPECTOR_VERSION");
    expect(readFileSync(join(mirrorRoot, "agent/dist/pdf-inspector-local.d.ts"), "utf8")).not.toContain("PDF_INSPECTOR_VERSION");
  });

  it("generates the mirror via sync-bundled-extension: manifest, compiled agent, and the owned dependency tree — no hand edits", () => {
    expect(existsSync(mirrorRoot), "run `npm run build -w @pipiui/pipiui-pdf-extension` first").toBe(true);

    const sourceManifest = readFileSync(join(packageRoot, "pipiui-extension.json"), "utf8");
    expect(readFileSync(join(mirrorRoot, "pipiui-extension.json"), "utf8")).toBe(sourceManifest);

    const entry = join(mirrorRoot, "agent/dist/index.js");
    expect(statSync(entry).isFile()).toBe(true);
    expect(readFileSync(entry, "utf8")).toContain("pipiui_firecrawl_pdf");
    expect(readFileSync(entry, "utf8")).toContain("EXT_PDF_EXTENSION_AISTUDIOACCESSTOKEN");
    // Source TypeScript never ships; only compiled artifacts.
    expect(readdirSync(join(mirrorRoot, "agent"))).toEqual(["dist"]);

    // runtimeAssets tree copied into the mirror, minus dev-only .bin.
    expect(existsSync(join(mirrorRoot, "vendor/pdf-inspector/node_modules/@firecrawl/pdf-inspector-wasm/pdf_inspector_wasm_bg.wasm"))).toBe(true);
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : [full];
      });
    const mirroredFiles = walk(join(mirrorRoot, "vendor"));
    expect(mirroredFiles.length).toBeGreaterThan(0);
    for (const file of mirroredFiles) {
      expect(extname(file) !== ".bin" || statSync(file).isDirectory()).toBe(true);
      expect(file.includes("/.bin/") && statSync(file).isSymbolicLink()).toBe(false);
    }
    // No host-entry receipt: this extension declares none, so sync writes nothing.
    expect(existsSync(join(mirrorRoot, "pipiui-host-receipt.json"))).toBe(false);
  });

  it("registers the dist-backed builtin in BUNDLED_MANIFEST_EXTENSIONS so installs keep its halves", () => {
    expect(BUNDLED_MANIFEST_EXTENSIONS).toContain("office-extension");
    expect(BUNDLED_MANIFEST_EXTENSIONS).toContain("pdf-extension");
  });
});
