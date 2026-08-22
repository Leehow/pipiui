import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_MANIFEST_EXTENSIONS, installRuntimeTree, syncTree, treeSignature } from "../src/runtime-install.js";

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
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }) }
  });

  it("leaves the previous tree in place when the source is missing", async () => {
    const root = await temp();
    try {
      const dest = join(root, "dest"); await mkdir(dest);
      await writeFile(join(dest, "keep.ts"), "old\n");
      const report = syncTree(join(root, "gone"), dest);
      expect(report.failures.length).toBe(1);
      expect(await readFile(join(dest, "keep.ts"), "utf8")).toBe("old\n");
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }) }
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
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }) }
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
      expect(entries).toContain("pdf-inspector");
      expect(entries).toContain("anydoc");
      expect(await readdir(join(root, "pdf-inspector", "node_modules", "@firecrawl"))).toEqual(expect.arrayContaining(["pdf-inspector", "pdf-inspector-wasm"]));
      expect(await readdir(join(root, "anydoc", "node_modules", "@firecrawl"))).toEqual(expect.arrayContaining(["anydoc", "anydoc-wasm"]));
      expect(await readdir(join(root, "pi-ext"))).toEqual(expect.arrayContaining(["agents", "packages", "subagent"]));
      expect(existsSync(join(root, "pi-ext", "packages", "context-fold", "index.ts"))).toBe(true);
      expect(await readFile(join(root, "pi-ext", "packages", "context-fold", "VENDORED.md"), "utf8")).toContain("4881382bc6a5acaaf8e346a5f36a4c62cf0d3ae3");
      expect(await readdir(join(root, "pi-philosophy"))).toContain("philosophy.ts");
      expect(await readFile(join(root, "extensions", "pipiui-git.ts"), "utf8")).toContain("git_status");
      expect(await readFile(join(root, "extensions", "pipiui-runtime-info.ts"), "utf8")).toContain("pipiui_runtime_info");
      expect(await readFile(join(root, "extensions", "pipiui-coding-tools.ts"), "utf8")).toContain("readPathIfDirectory");
      expect(await readFile(join(root, "extensions", "pipiui-office-doc-shot-gate.ts"), "utf8")).toContain("triggerTurn: true");
      expect(await readFile(join(root, "extensions", "office-doc-shot-gate.ts"), "utf8")).toContain("mcp_officecli_officecli");
      expect(await readFile(join(root, "extensions", "pipiui-update-center.ts"), "utf8")).toContain('pi.on("input"');
      expect(await readFile(join(root, "extensions", "pipiui-electron-webview.ts"), "utf8")).toContain("sessionCapability: CAPABILITY");
      expect(await readdir(join(root, "built-in-skills"))).toEqual(expect.arrayContaining(["create-subagent", "add-extension", "pipiui-research"]));
      const researchSkill = await readFile(join(root, "built-in-skills", "pipiui-research", "SKILL.md"), "utf8");
      expect(researchSkill).toContain("default to multiple `explore` workers, not one");
      expect(researchSkill).toContain("dispatch **all known independent partitions at once**");
      expect(researchSkill).toContain("first-wave baseline of **3–6 independent partitions**");
      const helloDir = join(root, "extensions", "hello-pipiui");
      const helloManifest = JSON.parse(await readFile(join(helloDir, "pipiui-extension.json"), "utf8")) as {
        agent?: { extension?: string };
      };
      expect(helloManifest.agent?.extension).toBeTruthy();
      expect(existsSync(join(helloDir, helloManifest.agent!.extension!))).toBe(true);
      // M5: bundled manifest extensions keep their compiled `dist` halves even though
      // the generic extensions sync strips `dist`.
      expect(BUNDLED_MANIFEST_EXTENSIONS).toContain("grok-build-oauth");
      const grokDir = join(root, "extensions", "grok-build-oauth");
      const grokManifest = JSON.parse(await readFile(join(grokDir, "pipiui-extension.json"), "utf8")) as {
        agent?: { extension?: string };
        app?: { ui?: { panels?: { entry?: string }[]; toolRenderers?: { entry?: string }[] } };
      };
      expect(grokManifest.agent?.extension).toBeTruthy();
      expect(existsSync(join(grokDir, grokManifest.agent!.extension!))).toBe(true);
      const grokEntries = [
        ...(grokManifest.app?.ui?.panels ?? []).map((p) => p.entry),
        ...(grokManifest.app?.ui?.toolRenderers ?? []).map((r) => r.entry),
      ].filter(Boolean) as string[];
      expect(grokEntries.length).toBeGreaterThan(0);
      for (const entry of grokEntries) expect(existsSync(join(grokDir, entry))).toBe(true);
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }) }
  });

  it("names each unresolved asset rather than installing a partial tree in silence", async () => {
    const root = await temp();
    try {
      const report = installRuntimeTree({}, root);
      expect(report.failures).toEqual(["runtime source root: no source path resolved"]);
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }) }
  });
});

describe("syncTree keepDist (bundled manifest extensions)", () => {
  it("strips dist by default but preserves it under keepDist, with matching signatures", async () => {
    const root = await temp();
    try {
      const source = join(root, "src");
      await mkdir(join(source, "agent", "dist"), { recursive: true });
      await writeFile(join(source, "pipiui-extension.json"), "{}\n");
      await writeFile(join(source, "agent", "dist", "index.js"), "export default () => {};\n");

      const stripped = join(root, "stripped");
      syncTree(source, stripped);
      expect(existsSync(join(stripped, "pipiui-extension.json"))).toBe(true);
      expect(existsSync(join(stripped, "agent", "dist", "index.js"))).toBe(false);

      const kept = join(root, "kept");
      const first = syncTree(source, kept, undefined, { keepDist: true });
      expect(first.installed).toEqual([kept]);
      expect(existsSync(join(kept, "agent", "dist", "index.js"))).toBe(true);
      // Idempotent under keepDist; the default-signature tree must not shadow it.
      expect(syncTree(source, kept, undefined, { keepDist: true }).unchanged).toEqual([kept]);
      // A dist-only change flips the keepDist signature and reinstalls.
      await writeFile(join(source, "agent", "dist", "index.js"), "export default () => 1;\n");
      await utimes(join(source, "agent", "dist", "index.js"), new Date(), new Date(Date.now() + 5000));
      expect(syncTree(source, kept, undefined, { keepDist: true }).installed).toEqual([kept]);
      expect(await readFile(join(kept, "agent", "dist", "index.js"), "utf8")).toContain("=> 1");
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }) }
  });
});
