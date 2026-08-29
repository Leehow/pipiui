import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExtensionLoader } from "../src/extension-loader.js";
import { createExtensionRegistry } from "../src/extension-registry.js";
import {
  projectExtensionGrantSeed,
  readProjectExtensionGrantsSync,
  seedProjectExtensionGrantsSync,
  type ExtensionGrantSeed,
} from "../src/extension-grants.js";
import { projectPiAgentDir } from "../src/project-pi-home.js";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

async function tempRoot(prefix: string): Promise<string> {
  root = await mkdtemp(join(tmpdir(), prefix));
  return root;
}

/** Bundled package with a valid core-capability manifest (hostApi required for core ids). */
async function writePackage(builtinRoot: string, id: string, permissions?: string[]): Promise<void> {
  const dir = join(builtinRoot, id);
  await mkdir(dir, { recursive: true });
  const manifest: Record<string, unknown> = {
    id,
    name: id,
    version: "0.1.0",
    capabilities: [],
    hostApi: ">=1.0.0 <2.0.0",
  };
  if (permissions) manifest.permissions = permissions;
  await writeFile(join(dir, "pipiui-extension.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function loaderFor(builtinRoot: string, appRoot?: string) {
  return createExtensionLoader({
    registry: createExtensionRegistry(),
    builtinRoot,
    appRoot: appRoot ?? join(root, "agent", "extensions"),
  });
}

const grantsPath = (project: string) => join(projectPiAgentDir(project), "ext-grants.json");

describe("core-capability grant seeding on the scan path (decision A)", () => {
  it("seeds exactly the manifest-declared permissions of bundled core extensions on first scan", async () => {
    await tempRoot("extension-grants-seed-");
    const builtinRoot = join(root, "runtime", "extensions");
    await writePackage(builtinRoot, "web-access-extension", ["net.request"]);
    await writePackage(builtinRoot, "webview-browser-extension", ["browser.session"]);
    await writePackage(builtinRoot, "cua-extension", ["native.exec"]);
    await writePackage(builtinRoot, "memory-extension", ["memory.read"]);
    const project = join(root, "repo");
    await mkdir(project, { recursive: true });

    loaderFor(builtinRoot).scan(project);

    expect(existsSync(grantsPath(project))).toBe(true);
    const grants = readProjectExtensionGrantsSync(projectPiAgentDir(project));
    expect(Object.keys(grants).sort()).toEqual([
      "cua-extension",
      "memory-extension",
      "web-access-extension",
      "webview-browser-extension",
    ]);
    expect(grants["web-access-extension"]?.grantedCapabilities).toEqual(["net.request"]);
    expect(grants["webview-browser-extension"]?.grantedCapabilities).toEqual(["browser.session"]);
    expect(grants["cua-extension"]?.grantedCapabilities).toEqual(["native.exec"]);
    expect(grants["memory-extension"]?.grantedCapabilities).toEqual(["memory.read"]);
    for (const record of Object.values(grants)) {
      expect(record.grantedAt).toEqual(expect.any(String));
      expect(Number.isNaN(Date.parse(record.grantedAt))).toBe(false);
    }
  });

  it("never rewrites an existing record: a revoked permission survives rescans untouched", async () => {
    await tempRoot("extension-grants-seed-idem-");
    const builtinRoot = join(root, "runtime", "extensions");
    await writePackage(builtinRoot, "cua-extension", ["native.exec"]);
    await writePackage(builtinRoot, "memory-extension", ["memory.read"]);
    const project = join(root, "repo");
    await mkdir(project, { recursive: true });
    const loader = loaderFor(builtinRoot);

    loader.scan(project);
    // User revokes native.exec (and stamps an old grant date); second scan must respect it.
    const document = JSON.parse(await readFile(grantsPath(project), "utf8")) as Record<string, { grantedCapabilities: string[]; grantedAt: string }>;
    document["cua-extension"] = { grantedCapabilities: [], grantedAt: "2000-01-01T00:00:00.000Z" };
    await writeFile(grantsPath(project), `${JSON.stringify(document, null, 2)}\n`, "utf8");

    loader.scan(project);

    const after = readProjectExtensionGrantsSync(projectPiAgentDir(project));
    expect(after["cua-extension"]).toEqual({ grantedCapabilities: [], grantedAt: "2000-01-01T00:00:00.000Z" });
    expect(after["memory-extension"]?.grantedCapabilities).toEqual(["memory.read"]);
  });

  it("seeds nothing for a core extension whose manifest declares no permissions", async () => {
    await tempRoot("extension-grants-seed-nodecl-");
    const builtinRoot = join(root, "runtime", "extensions");
    await writePackage(builtinRoot, "memory-extension"); // no permissions field
    const project = join(root, "repo");
    await mkdir(project, { recursive: true });

    loaderFor(builtinRoot).scan(project);

    expect(existsSync(grantsPath(project))).toBe(false);
    expect(readProjectExtensionGrantsSync(projectPiAgentDir(project))).toEqual({});
  });

  it("grants only the declared subset, never an amplified set", async () => {
    await tempRoot("extension-grants-seed-subset-");
    const builtinRoot = join(root, "runtime", "extensions");
    await writePackage(builtinRoot, "web-access-extension", ["net.request"]);
    const project = join(root, "repo");
    await mkdir(project, { recursive: true });

    loaderFor(builtinRoot).scan(project);

    const grants = readProjectExtensionGrantsSync(projectPiAgentDir(project));
    expect(grants["web-access-extension"]?.grantedCapabilities).toEqual(["net.request"]);
    expect(grants["web-access-extension"]?.grantedCapabilities).not.toContain("browser.session");
    expect(grants["web-access-extension"]?.grantedCapabilities).not.toContain("native.exec");
  });

  it("does not seed non-core extensions even when they declare permissions", async () => {
    await tempRoot("extension-grants-seed-noncore-");
    const builtinRoot = join(root, "runtime", "extensions");
    await writePackage(builtinRoot, "cua-extension", ["native.exec"]);
    await writePackage(builtinRoot, "quota", ["net.request"]);
    const project = join(root, "repo");
    await mkdir(project, { recursive: true });

    loaderFor(builtinRoot).scan(project);

    const grants = readProjectExtensionGrantsSync(projectPiAgentDir(project));
    expect(Object.keys(grants)).toEqual(["cua-extension"]);
    expect(grants["quota"]).toBeUndefined();
  });

  it("does not seed a project-installed instance that shadows a core id", async () => {
    await tempRoot("extension-grants-seed-shadow-");
    const builtinRoot = join(root, "runtime", "extensions");
    await writePackage(builtinRoot, "cua-extension", ["native.exec"]);
    const project = join(root, "repo");
    await writePackage(join(project, ".pi", "agent", "extensions"), "cua-extension", ["native.exec"]);

    loaderFor(builtinRoot).scan(project);

    expect(readProjectExtensionGrantsSync(projectPiAgentDir(project))).toEqual({});
  });
});

describe("projectExtensionGrantSeed (pure seed delta)", () => {
  const seeds: ExtensionGrantSeed[] = [
    { id: "cua-extension", permissions: ["native.exec"] },
    { id: "memory-extension", permissions: ["memory.read"] },
  ];

  it("fills only missing ids and keeps existing records verbatim", () => {
    const current = {
      "cua-extension": { grantedCapabilities: [], grantedAt: "2000-01-01T00:00:00.000Z" },
    };
    const next = projectExtensionGrantSeed(current, seeds, "2001-01-01T00:00:00.000Z");
    expect(next).toEqual({
      "cua-extension": { grantedCapabilities: [], grantedAt: "2000-01-01T00:00:00.000Z" },
      "memory-extension": { grantedCapabilities: ["memory.read"], grantedAt: "2001-01-01T00:00:00.000Z" },
    });
    // No mutation of the input.
    expect(current["cua-extension"].grantedCapabilities).toEqual([]);
  });

  it("returns undefined when every seed already has a record (no gratuitous write)", () => {
    const current = {
      "cua-extension": { grantedCapabilities: ["native.exec"], grantedAt: "2000-01-01T00:00:00.000Z" },
      "memory-extension": { grantedCapabilities: [], grantedAt: "2000-01-01T00:00:00.000Z" },
    };
    expect(projectExtensionGrantSeed(current, seeds)).toBeUndefined();
  });

  it("skips seeds without declared permissions and preserves unrelated store entries (no cleanup on removal)", () => {
    const current = {
      "gone-extension": { grantedCapabilities: ["net.request"], grantedAt: "2000-01-01T00:00:00.000Z" },
    };
    const next = projectExtensionGrantSeed(current, [{ id: "memory-extension", permissions: [] }]);
    expect(next).toBeUndefined();
    expect(seedProjectExtensionGrantsSync("/nonexistent/agent-dir", [])).toEqual({});
  });
});
