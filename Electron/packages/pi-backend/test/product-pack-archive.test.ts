import { createWriteStream } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { ZipFile } from "yazl";
import { afterEach, describe, expect, it } from "vitest";

import {
  installFromProductPackArchive,
  writeProductPackArchive,
} from "../src/product-pack-archive.js";
import type { ProductProfileManifest } from "../src/profile-manifest.js";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

async function smallZip(path: string, entries: Array<{ name: string; body: string; mode?: number }>): Promise<void> {
  const zip = new ZipFile();
  for (const entry of entries) zip.addBuffer(Buffer.from(entry.body), entry.name, entry.mode ? { mode: entry.mode } : undefined);
  const writing = pipeline(zip.outputStream as Readable, createWriteStream(path));
  zip.end();
  await writing;
}

describe("Product Pack ZIP archive", () => {
  it("streams a complete pack and extracts files with executable modes intact", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-pack-archive-"));
    const extension = join(root, "source", "lab-tools");
    await mkdir(join(extension, "bin"), { recursive: true });
    await writeFile(join(extension, "pipiui-extension.json"), JSON.stringify({
      id: "lab-tools",
      name: "Lab Tools",
      version: "1.0.0",
      capabilities: [],
    }));
    await writeFile(join(extension, "bin", "run"), "#!/bin/sh\necho ok\n");
    await chmod(join(extension, "bin", "run"), 0o755);
    const profile: ProductProfileManifest = {
      schemaVersion: 1,
      id: "lab",
      name: "Lab",
      customizable: true,
      extensions: { required: [], recommended: [{ id: "lab-tools", version: "^1.0.0" }] },
      layout: { primarySidebar: "pipi.sessions", center: "pipi.conversation" },
    };
    const archive = join(root, "lab.pipiui-pack.zip");

    const result = await writeProductPackArchive({
      destination: archive,
      packId: "lab",
      packName: "Lab",
      profile,
      extensions: [{ id: "lab-tools", directory: extension }],
    });

    expect(result).toMatchObject({ archivePath: archive, extensionCount: 1 });
    expect(result.bytes).toBeGreaterThan(0);
    await installFromProductPackArchive(archive, async directory => {
      expect(JSON.parse(await readFile(join(directory, "pipiui-product-pack.json"), "utf8"))).toMatchObject({
        id: "lab",
        profile: "profile/pipiui-profile.json",
        extensions: [{ id: "lab-tools", path: "extensions/lab-tools" }],
      });
      expect(JSON.parse(await readFile(join(directory, "profile", "pipiui-profile.json"), "utf8"))).toMatchObject({ id: "lab" });
      expect(JSON.parse(await readFile(join(directory, "extensions", "lab-tools", "pipiui-extension.json"), "utf8"))).toMatchObject({ hostApi: "^1.0.0" });
      expect(await readFile(join(directory, "extensions", "lab-tools", "bin", "run"), "utf8")).toContain("echo ok");
      expect((await stat(join(directory, "extensions", "lab-tools", "bin", "run"))).mode & 0o777).toBe(0o755);
    });
  });

  it("rejects path traversal before extraction", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-pack-traversal-"));
    const archive = join(root, "unsafe.zip");
    await smallZip(archive, [{ name: "aa/x", body: "escape" }]);
    const bytes = await readFile(archive);
    const safe = Buffer.from("aa/x");
    const unsafe = Buffer.from("../x");
    let replacements = 0;
    for (let index = 0; index <= bytes.length - safe.length; index += 1) {
      if (!bytes.subarray(index, index + safe.length).equals(safe)) continue;
      unsafe.copy(bytes, index);
      replacements += 1;
    }
    expect(replacements).toBeGreaterThanOrEqual(2);
    await writeFile(archive, bytes);

    await expect(installFromProductPackArchive(archive, async () => undefined))
      .rejects.toThrow(/invalid|unsafe|relative|parent/i);
    await expect(stat(join(root, "x"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects symbolic links from imported archives", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-pack-symlink-"));
    const archive = join(root, "symlink.zip");
    await smallZip(archive, [
      { name: "pipiui-product-pack.json", body: "{}" },
      { name: "link", body: "outside", mode: 0o120777 },
    ]);

    await expect(installFromProductPackArchive(archive, async () => undefined))
      .rejects.toThrow(/symbolic link/i);
  });
});
