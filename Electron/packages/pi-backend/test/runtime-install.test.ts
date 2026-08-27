import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_MANIFEST_EXTENSIONS, installRuntimeTree, syncTree, treeSignature } from "../src/runtime-install.js";
import { assemblePiSpawn, resolveSpawnPaths } from "../src/spawn-assembly.js";

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

  it("skips cargo target directories so rust build artifacts never install", async () => {
    const root = await temp();
    try {
      const source = join(root, "src"); const dest = join(root, "dest");
      await mkdir(join(source, "sidecar-rust", "target"), { recursive: true });
      await writeFile(join(source, "index.ts"), "export const a = 1\n");
      await writeFile(join(source, "sidecar-rust", "Cargo.toml"), "[package]\nname = \"x\"\n");
      await writeFile(join(source, "sidecar-rust", "target", "huge.rlib"), "x".repeat(1000));

      expect(syncTree(source, dest).installed).toEqual([dest]);
      expect(existsSync(join(dest, "sidecar-rust", "Cargo.toml"))).toBe(true);
      expect(existsSync(join(dest, "sidecar-rust", "target"))).toBe(false);
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
      expect(entries).toContain("anydoc");
      // The pdf parser ships as a bundled manifest extension with its owned vendored deps.
      expect(await readdir(join(root, "extensions", "pdf-extension"))).toEqual(expect.arrayContaining(["agent", "pipiui-extension.json", "vendor"]));
      expect(existsSync(join(root, "extensions", "pdf-extension", "vendor", "pdf-inspector", "node_modules", "@firecrawl"))).toBe(true);
      expect(await readdir(join(root, "anydoc", "node_modules", "@firecrawl"))).toEqual(expect.arrayContaining(["anydoc", "anydoc-wasm"]));
      expect(await readdir(join(root, "pi-ext"))).toEqual(expect.arrayContaining(["agents", "packages", "subagent"]));
      expect(existsSync(join(root, "pi-ext", "packages", "context-fold", "index.ts"))).toBe(true);
      expect(await readFile(join(root, "pi-ext", "packages", "context-fold", "VENDORED.md"), "utf8")).toContain("4881382bc6a5acaaf8e346a5f36a4c62cf0d3ae3");
      expect(await readdir(join(root, "pi-philosophy"))).toContain("philosophy.ts");
      expect(await readFile(join(root, "extensions", "pipiui-git.ts"), "utf8")).toContain("git_status");
      expect(await readFile(join(root, "extensions", "pipiui-runtime-info.ts"), "utf8")).toContain("pipiui_runtime_info");
      expect(await readFile(join(root, "extensions", "pipiui-coding-tools.ts"), "utf8")).toContain("readPathIfDirectory");
      expect(await readFile(join(root, "extensions", "pipiui-office-doc-shot-gate.ts"), "utf8")).toContain("triggerTurn: true");
      expect(await readFile(join(root, "extensions", "office-doc-shot-gate.ts"), "utf8")).toContain("pipiui_officecli");
      expect(await readFile(join(root, "extensions", "office-doc-shot-gate.ts"), "utf8")).toContain("DIRECT_OFFICECLI_TOOL");
      expect(await readFile(join(root, "extensions", "pipiui-office-doc-shot-gate.ts"), "utf8")).toContain("pipiui_officecli");
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
      expect(BUNDLED_MANIFEST_EXTENSIONS).toContain("qoder");
      expect(BUNDLED_MANIFEST_EXTENSIONS).toContain("pipiui-headroom");
      expect(BUNDLED_MANIFEST_EXTENSIONS).toContain("office-extension");
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
      // A dist-backed builtin (office-extension) must survive the generic strip.
      // Missing this keepDist pass is exactly `agent.extension does not exist: agent/dist/index.js`.
      const officeDir = join(root, "extensions", "office-extension");
      const officeManifest = JSON.parse(await readFile(join(officeDir, "pipiui-extension.json"), "utf8")) as {
        agent?: { extension?: string };
        host?: { entry?: string };
        app?: { ui?: { documentRenderers?: { entry?: string }[] } };
      };
      expect(officeManifest.agent?.extension).toBe("agent/dist/index.js");
      expect(existsSync(join(officeDir, officeManifest.agent!.extension!))).toBe(true);
      expect(officeManifest.host?.entry).toBeTruthy();
      expect(existsSync(join(officeDir, officeManifest.host!.entry!))).toBe(true);
      for (const renderer of officeManifest.app?.ui?.documentRenderers ?? []) {
        if (renderer.entry) expect(existsSync(join(officeDir, renderer.entry))).toBe(true);
      }
      const shipped = await readdir(join(runtimeSource, "extensions"), { withFileTypes: true });
      for (const entry of shipped) {
        if (!entry.isDirectory()) continue;
        const manifestPath = join(runtimeSource, "extensions", entry.name, "pipiui-extension.json");
        if (!existsSync(manifestPath)) continue;
        const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
          agent?: { extension?: string };
          host?: { entry?: string };
        };
        const declared = [manifest.agent?.extension, manifest.host?.entry].filter(
          (rel): rel is string => typeof rel === "string" && rel.length > 0,
        );
        if (!declared.some((rel) => rel.split(/[/\\]/).includes("dist"))) continue;
        expect(BUNDLED_MANIFEST_EXTENSIONS, `${entry.name} ships dist-backed agent/host`).toContain(entry.name);
        for (const rel of declared) {
          expect(existsSync(join(root, "extensions", entry.name, rel)), `${entry.name} ${rel}`).toBe(true);
        }
      }
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }) }
  });

  // Standalone proof for the chatrpg-test-dispatch bundled skill: it must hold even in
  // environments where unrelated prebuilt dist artifacts (e.g. code-retrieval) are absent.
  it("ships chatrpg-test-dispatch as a built-in skill", async () => {
    const root = await temp();
    try {
      // Same sync mechanism the runtime install uses, scoped to just the skills subtree.
      const runtimeRoot = join(root, "runtime");
      const installed = [join(runtimeRoot, "built-in-skills")];
      expect(syncTree(join(runtimeSource, "built-in-skills"), installed[0]).installed).toEqual(installed);
      const dispatchSkill = await readFile(join(runtimeRoot, "built-in-skills", "chatrpg-test-dispatch", "SKILL.md"), "utf8");
      expect(dispatchSkill).toContain("progressLog");
      expect(dispatchSkill).toContain("tee -a");
      // Spawn/runtime path contract: the synced runtime exposes the root as builtInSkills,
      // and a ready skill loader publishes it as PIPIUI_BUILT_IN_SKILL_ROOT.
      const paths = resolveSpawnPaths(runtimeRoot);
      expect(paths.builtInSkills).toBe(join(runtimeRoot, "built-in-skills"));
      const spawn = assemblePiSpawn({
        cwd: root,
        features: { skillLoader: true },
        paths: { ...paths, skillLoader: join(runtimeSource, "extensions", "pipiui-skillloader.ts") },
      });
      expect(spawn.env.PIPIUI_BUILT_IN_SKILL_ROOT).toBe(paths.builtInSkills);
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }) }
  });

  it("names each unresolved asset rather than installing a partial tree in silence", async () => {
    const root = await temp();
    try {
      const report = installRuntimeTree({}, root);
      expect(report.failures).toEqual(["runtime source root: no source path resolved"]);
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }) }
  });

  it("installs keepDist builtins before the first listExtensions scan", async () => {
    const { createPiHostBackend } = await import("../src/index.js");
    const root = await temp();
    try {
      const source = join(root, "src");
      const dest = join(root, "runtime");
      const officeSrc = join(source, "extensions", "office-extension");
      const officeDest = join(dest, "extensions", "office-extension");
      await mkdir(join(officeSrc, "agent", "dist"), { recursive: true });
      await mkdir(officeDest, { recursive: true });
      const manifest = {
        id: "office-extension",
        name: "PipiUI Office",
        version: "0.1.0",
        capabilities: [],
        agent: { extension: "agent/dist/index.js" },
      };
      await writeFile(join(officeSrc, "pipiui-extension.json"), `${JSON.stringify(manifest)}\n`);
      await writeFile(join(officeSrc, "agent", "dist", "index.js"), "export default function () {}\n");
      await writeFile(join(officeDest, "pipiui-extension.json"), `${JSON.stringify(manifest)}\n`);
      const backend = createPiHostBackend({
        agentDir: join(root, "agent"),
        sessionsRoot: join(root, "sessions"),
        runtimeRoot: dest,
        runtimeAssets: { sourceRoot: source },
        canonicalProjectPaths: async () => undefined,
      });
      const listed = (await backend.handle("listExtensions" as never, [])) as Array<{
        id: string;
        state: string;
        error?: string;
      }>;
      const office = listed.find((row) => row.id === "office-extension");
      expect(office?.state).not.toBe("error");
      expect(office?.error).toBeUndefined();
      expect(existsSync(join(officeDest, "agent", "dist", "index.js"))).toBe(true);
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
