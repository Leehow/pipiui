import { mkdtemp, mkdir, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installRuntimeTree, syncTree, treeSignature } from "../src/runtime-install.js";

const runtimeSource = new URL("../../../resources/runtime", import.meta.url).pathname;
const temp = () => mkdtemp(join(tmpdir(), "runtime-install-"));

describe("syncTree", () => {
  it("copies a tree, skips node_modules, and no-ops until the source changes", async () => {
    const root = await temp();
    try {
      const source = join(root, "src"); const dest = join(root, "dest");
      await mkdir(join(source, "node_modules"), { recursive: true });
      await writeFile(join(source, "index.ts"), "export const a = 1\n");
      await writeFile(join(source, "node_modules", "huge.js"), "x".repeat(1000));

      expect(syncTree(source, dest).installed).toEqual([dest]);
      expect(await readdir(dest)).not.toContain("node_modules");
      expect(syncTree(source, dest).unchanged).toEqual([dest]);

      await writeFile(join(source, "index.ts"), "export const a = 2\n");
      await utimes(join(source, "index.ts"), new Date(), new Date(Date.now() + 5000));
      expect(syncTree(source, dest).installed).toEqual([dest]);
      expect(await readFile(join(dest, "index.ts"), "utf8")).toBe("export const a = 2\n");
    } finally { await rm(root, { recursive: true, force: true }) }
  });

  it("leaves the previous tree in place when the source is missing", async () => {
    const root = await temp();
    try {
      const dest = join(root, "dest"); await mkdir(dest);
      await writeFile(join(dest, "keep.ts"), "old\n");
      const report = syncTree(join(root, "gone"), dest);
      expect(report.failures.length).toBe(1);
      expect(await readFile(join(dest, "keep.ts"), "utf8")).toBe("old\n");
    } finally { await rm(root, { recursive: true, force: true }) }
  });
});

describe("treeSignature", () => {
  it("ignores dev-only directories so an npm install never forces a reinstall", async () => {
    const root = await temp();
    try {
      await writeFile(join(root, "a.ts"), "a\n");
      const before = treeSignature(root);
      await mkdir(join(root, "node_modules"));
      await writeFile(join(root, "node_modules", "b.js"), "b\n");
      expect(treeSignature(root)).toBe(before);
    } finally { await rm(root, { recursive: true, force: true }) }
  });
});

describe("installRuntimeTree", () => {
  it("installs the whole shipped tree the way resolveSpawnPaths expects to find it", async () => {
    const root = await temp();
    try {
      const report = installRuntimeTree({
        sourceRoot: runtimeSource,
      }, root);
      expect(report.failures).toEqual([]);
      const entries = await readdir(root);
      expect(entries).toContain("pi-ext");
      expect(entries).toContain("pi-philosophy");
      expect(entries).toContain("extensions");
      expect(entries).toContain("built-in-skills");
      expect(await readdir(join(root, "pi-ext"))).toEqual(expect.arrayContaining(["agents", "packages", "subagent"]));
      expect(await readdir(join(root, "pi-philosophy"))).toContain("philosophy.ts");
      expect(await readFile(join(root, "extensions", "pipiui-git.ts"), "utf8")).toContain("git_status");
      expect(await readFile(join(root, "extensions", "pipiui-electron-webview.ts"), "utf8")).toContain("sessionCapability: CAPABILITY");
      expect(await readdir(join(root, "built-in-skills"))).toContain("create-subagent");
    } finally { await rm(root, { recursive: true, force: true }) }
  });

  it("names each unresolved asset rather than installing a partial tree in silence", async () => {
    const root = await temp();
    try {
      const report = installRuntimeTree({}, root);
      expect(report.failures).toEqual(["runtime source root: no source path resolved"]);
    } finally { await rm(root, { recursive: true, force: true }) }
  });
});
