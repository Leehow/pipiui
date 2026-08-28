import { afterEach, describe, expect, it } from "vitest";
import { mkdir, rm, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir as osTmpdir } from "node:os";
import { join } from "node:path";
import { validateExtensionManifest } from "../src/extension-manifest.js";
import { createExtensionLoader } from "../src/extension-loader.js";
import { createExtensionRegistry } from "../src/extension-registry.js";
import {
  EXTENSION_UPDATE_COMPONENTS_MAX,
  EXTENSION_UPDATE_SOURCE_TYPES,
  parseExtensionUpdateComponents,
  type ExtensionUpdateComponentSource,
} from "../src/extension-update-components.js";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

function baseManifest(extra: Record<string, unknown> = {}) {
  return {
    id: "probe",
    name: "Probe",
    version: "1.0.0",
    capabilities: [],
    ...extra,
  };
}

function pdfComponents(): unknown[] {
  return [
    {
      id: "pdf-inspector",
      name: "@firecrawl/pdf-inspector",
      version: "1.15.0",
      source: { type: "npm", packageName: "@firecrawl/pdf-inspector" },
      upstream: "https://github.com/firecrawl/pdf-inspector",
      license: "MIT",
    },
    {
      id: "pdf-inspector-wasm",
      name: "@firecrawl/pdf-inspector-wasm",
      version: "1.15.0",
      source: { type: "npm", packageName: "@firecrawl/pdf-inspector-wasm" },
    },
  ];
}

function errorsOfParse(value: unknown): string[] {
  const parsed = parseExtensionUpdateComponents(value);
  expect(parsed?.ok).toBe(false);
  return parsed && !parsed.ok ? parsed.errors : [];
}

describe("parseExtensionUpdateComponents contract", () => {
  it("treats an absent field as no declared components", () => {
    expect(parseExtensionUpdateComponents(undefined)).toBeUndefined();
    expect(parseExtensionUpdateComponents(null)).toBeUndefined();
  });

  it("accepts every source variant with owner-neutral fields", () => {
    const parsed = parseExtensionUpdateComponents([
      {
        id: "pdf-inspector",
        name: "@firecrawl/pdf-inspector",
        version: "1.15.0",
        source: { type: "npm", packageName: " @firecrawl/pdf-inspector " },
        upstream: " https://github.com/firecrawl/pdf-inspector ",
        license: "MIT",
      },
      {
        id: "requests",
        name: "requests",
        version: "2.32.3",
        source: { type: "pypi", packageName: "requests" },
      },
      {
        id: "cua-driver",
        name: "cua-driver-rs",
        version: "0.4.1",
        source: { type: "githubReleases", owner: "trycua", repo: "cua" },
        license: "Apache-2.0",
      },
    ]);
    expect(parsed?.ok).toBe(true);
    if (!parsed?.ok) return;
    expect(parsed.components).toEqual([
      {
        id: "pdf-inspector",
        name: "@firecrawl/pdf-inspector",
        version: "1.15.0",
        source: { type: "npm", packageName: "@firecrawl/pdf-inspector" },
        upstream: "https://github.com/firecrawl/pdf-inspector",
        license: "MIT",
      },
      {
        id: "requests",
        name: "requests",
        version: "2.32.3",
        source: { type: "pypi", packageName: "requests" },
      },
      {
        id: "cua-driver",
        name: "cua-driver-rs",
        version: "0.4.1",
        source: { type: "githubReleases", owner: "trycua", repo: "cua" },
        license: "Apache-2.0",
      },
    ]);
  });

  it("accepts an empty array and normalizes it to no components", () => {
    const parsed = parseExtensionUpdateComponents([]);
    expect(parsed?.ok).toBe(true);
    if (parsed?.ok) expect(parsed.components).toEqual([]);
  });

  it("rejects structural garbage", () => {
    expect(errorsOfParse("pdf-inspector")).toEqual(["updateComponents must be an array"]);
    expect(errorsOfParse(["x"])).toEqual(["updateComponents[0] must be an object"]);
    // Per-item errors collect (surrounding manifest convention); nothing is silently dropped.
    expect(errorsOfParse([{ id: "x" }])).toEqual([
      "updateComponents[0] missing name",
      "updateComponents[0] missing version",
      "updateComponents[0].source must be an object",
    ]);
  });

  it("rejects unknown fields on items and on sources", () => {
    expect(errorsOfParse([{
      id: "x", name: "X", version: "1.0.0", homepage: "https://example.com",
      source: { type: "npm", packageName: "x" },
    }])).toEqual(["unknown field 'homepage' in updateComponents[0]"]);
    expect(errorsOfParse([{
      id: "x", name: "X", version: "1.0.0",
      source: { type: "npm", packageName: "x", url: "https://evil.example.com" },
    }])).toEqual(["unknown field 'url' in updateComponents[0].source"]);
    expect(errorsOfParse([{
      id: "x", name: "X", version: "1.0.0",
      source: { type: "githubReleases", owner: "o", repo: "r", url: "https://evil.example.com" },
    }])).toEqual(["unknown field 'url' in updateComponents[0].source"]);
  });

  it("rejects missing required fields and invalid ids", () => {
    const errors = errorsOfParse([{ name: "X", version: "1.0.0", source: { type: "npm", packageName: "x" } }]);
    expect(errors).toContain("updateComponents[0] missing id");
    expect(errorsOfParse([{
      id: "PDF Inspector", name: "X", version: "1.0.0", source: { type: "npm", packageName: "x" },
    }])).toContain("updateComponents[0] invalid id 'PDF Inspector': must match [a-z][a-z0-9-]*");
    expect(errorsOfParse([{
      id: "x", source: { type: "npm", packageName: "x" },
    }])).toEqual(expect.arrayContaining(["updateComponents[0] missing name", "updateComponents[0] missing version"]));
    expect(errorsOfParse([{
      id: "x", name: "X", version: "1.0.0",
    }])).toContain("updateComponents[0].source must be an object");
  });

  it("rejects unknown or missing source types", () => {
    expect(errorsOfParse([{
      id: "x", name: "X", version: "1.0.0", source: { type: "custom", url: "https://evil.example.com" },
    }])).toContain(
      `updateComponents[0].source.type must be one of ${EXTENSION_UPDATE_SOURCE_TYPES.join(", ")}`,
    );
    expect(errorsOfParse([{
      id: "x", name: "X", version: "1.0.0", source: {},
    }])).toContain(
      `updateComponents[0].source.type must be one of ${EXTENSION_UPDATE_SOURCE_TYPES.join(", ")}`,
    );
  });

  it("rejects package/owner/repo names that are not registry identifiers", () => {
    // URL payloads never pass as package names — no SSRF surface via strings.
    expect(errorsOfParse([{
      id: "x", name: "X", version: "1.0.0", source: { type: "npm", packageName: "https://evil.example.com/x" },
    }])).toContain(
      "updateComponents[0].source.packageName is not a valid npm package name 'https://evil.example.com/x'",
    );
    expect(errorsOfParse([{
      id: "x", name: "X", version: "1.0.0", source: { type: "npm", packageName: "Lodash" },
    }])).toContain("updateComponents[0].source.packageName is not a valid npm package name 'Lodash'");
    expect(errorsOfParse([{
      id: "x", name: "X", version: "1.0.0", source: { type: "pypi", packageName: "" },
    }])).toContain("updateComponents[0].source.packageName must be a non-empty string");
    expect(errorsOfParse([{
      id: "x", name: "X", version: "1.0.0", source: { type: "githubReleases", repo: "cua" },
    }])).toContain("updateComponents[0].source.owner must be a non-empty GitHub owner");
    expect(errorsOfParse([{
      id: "x", name: "X", version: "1.0.0", source: { type: "githubReleases", owner: "try cua", repo: "cua" },
    }])).toContain("updateComponents[0].source.owner is not a valid GitHub owner 'try cua'");
    expect(errorsOfParse([{
      id: "x", name: "X", version: "1.0.0", source: { type: "githubReleases", owner: "trycua" },
    }])).toContain("updateComponents[0].source.repo must be a non-empty GitHub repository name");
  });

  it("rejects duplicate ids, non-https upstream, bad license, and oversized arrays", () => {
    expect(errorsOfParse([
      { id: "x", name: "X", version: "1.0.0", source: { type: "npm", packageName: "x" } },
      { id: "x", name: "X2", version: "2.0.0", source: { type: "npm", packageName: "x2" } },
    ])).toContain("duplicate update component id 'x'");
    expect(errorsOfParse([{
      id: "x", name: "X", version: "1.0.0", source: { type: "npm", packageName: "x" },
      upstream: "http://insecure.example.com",
    }])).toContain("updateComponents[0].upstream must be an https:// URL");
    expect(errorsOfParse([{
      id: "x", name: "X", version: "1.0.0", source: { type: "npm", packageName: "x" },
      upstream: "not a url",
    }])).toContain("updateComponents[0].upstream must be an https:// URL");
    expect(errorsOfParse([{
      id: "x", name: "X", version: "1.0.0", source: { type: "npm", packageName: "x" },
      license: "  ",
    }])).toContain("updateComponents[0].license must be a non-empty string");
    const tooMany = Array.from({ length: EXTENSION_UPDATE_COMPONENTS_MAX + 1 }, (_, i) => ({
      id: `c-${i}`,
      name: `C${i}`,
      version: "1.0.0",
      source: { type: "npm", packageName: `c-${i}` },
    }));
    expect(errorsOfParse(tooMany)).toContain(
      `updateComponents must have at most ${EXTENSION_UPDATE_COMPONENTS_MAX} entries`,
    );
  });
});

describe("manifest seam: updateComponents in validateExtensionManifest", () => {
  it("carries normalized components onto the validated manifest", () => {
    const result = validateExtensionManifest(baseManifest({ updateComponents: pdfComponents() }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.updateComponents).toEqual([
      {
        id: "pdf-inspector",
        name: "@firecrawl/pdf-inspector",
        version: "1.15.0",
        source: { type: "npm", packageName: "@firecrawl/pdf-inspector" },
        upstream: "https://github.com/firecrawl/pdf-inspector",
        license: "MIT",
      },
      {
        id: "pdf-inspector-wasm",
        name: "@firecrawl/pdf-inspector-wasm",
        version: "1.15.0",
        source: { type: "npm", packageName: "@firecrawl/pdf-inspector-wasm" },
      },
    ]);
  });

  it("normalizes manifests without the field exactly as before", () => {
    const result = validateExtensionManifest(baseManifest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.updateComponents).toBeUndefined();
    expect(Object.keys(result.manifest)).not.toContain("updateComponents");
  });

  it("omits an empty declaration from the validated manifest", () => {
    const result = validateExtensionManifest(baseManifest({ updateComponents: [] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.updateComponents).toBeUndefined();
  });

  it("fails validation with readable per-item errors on malformed entries", () => {
    const result = validateExtensionManifest(baseManifest({
      updateComponents: [
        { id: "Bad Id", name: "X", source: { type: "npm", packageName: "x", extra: 1 } },
      ],
    }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("; ")).toContain("updateComponents[0] invalid id 'Bad Id'");
    expect(result.errors.join("; ")).toContain("updateComponents[0] missing version");
    expect(result.errors.join("; ")).toContain("unknown field 'extra' in updateComponents[0].source");
  });
});

async function writePackage(dir: string, id: string, manifest: Record<string, unknown>): Promise<void> {
  const dest = join(dir, id);
  await mkdir(dest, { recursive: true });
  await writeFile(join(dest, "pipiui-extension.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

describe("loader normalization: updateComponents survives loader.list()", () => {
  it("surfaces declared components on the extension list item", async () => {
    root = await mkdtemp(join(osTmpdir(), "pipi-ext-updc-"));
    const builtinRoot = join(root, "runtime", "extensions");
    await writePackage(builtinRoot, "probe", baseManifest({ updateComponents: pdfComponents() }));
    await writePackage(builtinRoot, "plain", baseManifest({ id: "plain", name: "Plain" }));
    const loader = createExtensionLoader({
      registry: createExtensionRegistry([]),
      builtinRoot,
      appRoot: join(root, "agent", "extensions"),
    });
    loader.scan();
    const listed = loader.list();
    const probe = listed.find((item) => item.id === "probe");
    expect(probe?.state).toBe("enabled");
    expect(probe?.updateComponents).toEqual([
      {
        id: "pdf-inspector",
        name: "@firecrawl/pdf-inspector",
        version: "1.15.0",
        source: { type: "npm", packageName: "@firecrawl/pdf-inspector" },
        upstream: "https://github.com/firecrawl/pdf-inspector",
        license: "MIT",
      },
      {
        id: "pdf-inspector-wasm",
        name: "@firecrawl/pdf-inspector-wasm",
        version: "1.15.0",
        source: { type: "npm", packageName: "@firecrawl/pdf-inspector-wasm" },
      },
    ]);
    // Manifests without the field normalize exactly as before: no key at all.
    const plain = listed.find((item) => item.id === "plain");
    expect(plain?.state).toBe("enabled");
    expect(plain && "updateComponents" in plain).toBe(false);
  });

  it("puts packages with malformed declarations in error with a readable reason", async () => {
    root = await mkdtemp(join(osTmpdir(), "pipi-ext-updc-bad-"));
    const builtinRoot = join(root, "runtime", "extensions");
    await writePackage(builtinRoot, "probe", baseManifest({
      updateComponents: [{ id: "x", name: "X", source: { type: "pypi", packageName: "" } }],
    }));
    const loader = createExtensionLoader({
      registry: createExtensionRegistry([]),
      builtinRoot,
      appRoot: join(root, "agent", "extensions"),
    });
    const rec = loader.scan().find((item) => item.id === "probe");
    expect(rec?.state).toBe("error");
    expect(rec?.error).toMatch(/updateComponents\[0\]\.source\.packageName/);
    expect(loader.list().find((item) => item.id === "probe")?.updateComponents).toBeUndefined();
  });
});

describe("provider contract: sources map onto fixed checker endpoints", () => {
  // Mirrors the update-center checker URL shapes (npm registry / PyPI JSON API /
  // GitHub Releases API). The manifest can never carry its own URL — these are
  // the only endpoints a declared source may resolve to.
  function checkerUrl(source: ExtensionUpdateComponentSource): string {
    if (source.type === "npm") return `https://registry.npmjs.org/${encodeURIComponent(source.packageName)}`;
    if (source.type === "pypi") return `https://pypi.org/pypi/${encodeURIComponent(source.packageName)}/json`;
    return `https://api.github.com/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/releases`;
  }

  it("resolves every source variant to its fixed registry/API endpoint", () => {
    const parsed = parseExtensionUpdateComponents(pdfComponents().concat([{
      id: "requests",
      name: "requests",
      version: "2.32.3",
      source: { type: "pypi", packageName: "requests" },
      upstream: "https://github.com/psf/requests",
    }]));
    expect(parsed?.ok).toBe(true);
    if (!parsed?.ok) return;
    const urls = parsed.components.map((component) => checkerUrl(component.source));
    expect(urls[0]).toBe("https://registry.npmjs.org/%40firecrawl%2Fpdf-inspector");
    expect(urls[1]).toBe("https://registry.npmjs.org/%40firecrawl%2Fpdf-inspector-wasm");
    expect(urls[2]).toBe("https://pypi.org/pypi/requests/json");
  });

  it("githubReleases sources resolve to the releases API without extra host fields", () => {
    const parsed = parseExtensionUpdateComponents([{
      id: "cua-driver",
      name: "cua-driver-rs",
      version: "0.4.1",
      source: { type: "githubReleases", owner: "trycua", repo: "cua" },
    }]);
    expect(parsed?.ok).toBe(true);
    if (!parsed?.ok) return;
    expect(checkerUrl(parsed.components[0]!.source)).toBe(
      "https://api.github.com/repos/trycua/cua/releases",
    );
  });
});
