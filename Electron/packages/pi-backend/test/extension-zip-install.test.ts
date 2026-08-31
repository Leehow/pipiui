import { createWriteStream, existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { ZipFile } from "yazl";
import { afterEach, describe, expect, it } from "vitest";

import { createPiHostBackend } from "../src/index.js";
import { extensionUpdateStoreRoot, readExtensionSlot } from "../src/extension-update-engine.js";

const runtimeSource = new URL("../../../resources/runtime", import.meta.url).pathname;
let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

async function smallZip(path: string, entries: Array<{ name: string; body: string }>): Promise<void> {
  const zip = new ZipFile();
  for (const entry of entries) zip.addBuffer(Buffer.from(entry.body), entry.name);
  const writing = pipeline(zip.outputStream as Readable, createWriteStream(path));
  zip.end();
  await writing;
}

function extensionManifest(id = "zip-kit"): string {
  return JSON.stringify({ id, name: "Zip Kit", version: "1.0.0", hostApi: "^1.0.0", capabilities: [] });
}

async function makeBackend() {
  const project = join(root, "workspace");
  await mkdir(project, { recursive: true });
  const backend = createPiHostBackend({
    agentDir: join(root, "agent"),
    runtimeRoot: join(root, "runtime"),
    runtimeAssets: { sourceRoot: runtimeSource },
    profileMode: "isolated",
    canonicalProjectPaths: async () => undefined,
  });
  const added = await backend.handle("addProject", [project]) as { id: string };
  return { backend, projectId: added.id, project };
}

describe("single-extension ZIP install", () => {
  it("installs a zip rooted at the manifest, enables it for the project, and stores object + receipt", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-ext-zip-"));
    const archive = join(root, "zip-kit.zip");
    await smallZip(archive, [
      { name: "pipiui-extension.json", body: extensionManifest() },
      { name: "agent/entry.ts", body: "export const enabled = true\n" },
    ]);
    const { backend, projectId, project } = await makeBackend();

    const record = await backend.handle("installExtensionZip" as never, [projectId, archive]) as { id: string; state: string };
    expect(record).toMatchObject({ id: "zip-kit", state: "enabled" });

    const listed = await backend.handle("listExtensions" as never, [projectId]) as Array<{ id: string; state: string; source: string }>;
    expect(listed.find(item => item.id === "zip-kit")).toMatchObject({ state: "enabled" });

    const storeRoot = extensionUpdateStoreRoot(join(root, "agent"));
    expect(await readExtensionSlot(storeRoot, "zip-kit", "active")).toMatchObject({ version: "1.0.0" });
    const receiptsDir = join(storeRoot, "extensions", "zip-kit", "receipts");
    expect(existsSync(receiptsDir) && readdirSync(receiptsDir).length > 0).toBe(true);
    // Enabled state is a project-scoped override; the App default stays untouched.
    expect(existsSync(join(project, ".pi", "agent"))).toBe(true);
    await backend.close();
  });

  it("accepts a zip whose package sits in a single top-level folder", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-ext-zip-nested-"));
    const archive = join(root, "zip-kit-folder.zip");
    await smallZip(archive, [
      { name: "zip-kit/pipiui-extension.json", body: extensionManifest() },
      { name: "zip-kit/app/index.tsx", body: "export const panel = true\n" },
    ]);
    const { backend, projectId } = await makeBackend();

    await expect(backend.handle("installExtensionZip" as never, [projectId, archive]))
      .resolves.toMatchObject({ id: "zip-kit", state: "enabled" });
    await backend.close();
  });

  it("rejects a zip with no pipiui-extension.json manifest", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-ext-zip-nomanifest-"));
    const archive = join(root, "no-manifest.zip");
    await smallZip(archive, [{ name: "agent/entry.ts", body: "export const x = 1\n" }]);
    const { backend, projectId } = await makeBackend();

    await expect(backend.handle("installExtensionZip" as never, [projectId, archive]))
      .rejects.toThrow(/pipiui-extension\.json/);
    const storeRoot = extensionUpdateStoreRoot(join(root, "agent"));
    expect(await readExtensionSlot(storeRoot, "zip-kit", "active")).toBeUndefined();
    await backend.close();
  });

  it("rejects a zip with multiple package roots", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-ext-zip-multiroot-"));
    const archive = join(root, "multi-root.zip");
    await smallZip(archive, [
      { name: "zip-kit/pipiui-extension.json", body: extensionManifest("zip-kit") },
      { name: "other-kit/pipiui-extension.json", body: extensionManifest("other-kit") },
    ]);
    const { backend, projectId } = await makeBackend();

    await expect(backend.handle("installExtensionZip" as never, [projectId, archive]))
      .rejects.toThrow(/pipiui-extension\.json/);
    const storeRoot = extensionUpdateStoreRoot(join(root, "agent"));
    expect(await readExtensionSlot(storeRoot, "zip-kit", "active")).toBeUndefined();
    expect(await readExtensionSlot(storeRoot, "other-kit", "active")).toBeUndefined();
    await backend.close();
  });

  it("rejects a zip with path-traversal entries before anything escapes the staging dir", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-ext-zip-traversal-"));
    const archive = join(root, "traversal.zip");
    // yazl refuses to write ../ names, so patch the stored name bytes the same
    // way product-pack-archive.test.ts forges a hostile archive.
    await smallZip(archive, [
      { name: "pipiui-extension.json", body: extensionManifest() },
      { name: "aa/escaped.txt", body: "outside" },
    ]);
    const bytes = await readFile(archive);
    const safe = Buffer.from("aa/");
    const unsafe = Buffer.from("../");
    let replacements = 0;
    for (let index = 0; index <= bytes.length - safe.length; index += 1) {
      if (!bytes.subarray(index, index + safe.length).equals(safe)) continue;
      unsafe.copy(bytes, index);
      replacements += 1;
    }
    expect(replacements).toBeGreaterThanOrEqual(2);
    await writeFile(archive, bytes);
    const { backend, projectId } = await makeBackend();

    await expect(backend.handle("installExtensionZip" as never, [projectId, archive]))
      .rejects.toThrow(/unsafe|escape|relative|parent|unsafe path/i);
    expect(existsSync(join(root, "escaped.txt"))).toBe(false);
    await backend.close();
  });

  it("rejects non-zip or missing archives with a clear error", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-ext-zip-badpath-"));
    const notAZip = join(root, "missing.zip");
    const { backend, projectId } = await makeBackend();

    await expect(backend.handle("installExtensionZip" as never, [projectId, notAZip]))
      .rejects.toThrow();
    await expect(backend.handle("installExtensionZip" as never, [projectId, "relative/path.zip"]))
      .rejects.toThrow(/absolute/i);
    await writeFile(join(root, "data.txt"), "hello");
    await expect(backend.handle("installExtensionZip" as never, [projectId, join(root, "data.txt")]))
      .rejects.toThrow(/\.zip/);
    await backend.close();
  });
});
