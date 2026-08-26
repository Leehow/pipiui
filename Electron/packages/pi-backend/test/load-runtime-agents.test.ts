import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

import {
  loadRuntimeAgents,
  resolveRuntimeAgentsSource,
  RUNTIME_AGENTS_SPECIFIER,
} from "../src/load-runtime-agents.js";

const here = dirname(fileURLToPath(import.meta.url));
const sourceAgentsTs = resolve(here, "../../../resources/runtime/pi-ext/subagent/agents.ts");
const sourceAgentsJs = resolve(here, "../../../resources/runtime/pi-ext/subagent/agents.js");
const sourceAgentsDts = resolve(here, "../../../resources/runtime/pi-ext/subagent/agents.d.ts");
const loaderSource = resolve(here, "../src/load-runtime-agents.ts");
const bundleScript = resolve(here, "../scripts/bundle-runtime-agents.mjs");
const srcBundle = resolve(here, "../src/runtime-agents.bundle.mjs");
const tsconfig = resolve(here, "../tsconfig.json");
const tscBin = resolve(here, "../../../node_modules/typescript/bin/tsc");
const workspaceAgentsDir = resolve(here, "../../../resources/runtime/pi-ext/agents");

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

const SAMPLE_AGENT = `---
schema: 1
name: explore
description: Packaged-like explore agent used to exercise the bundled parser.
mode: read-only
capabilities:
  filesystem: read-only
  shell: false
  web: false
  mcp: false
  desktop: none
  delegation: false
worktree: none
deliverable: report
tools: read, grep, find, ls
---

You are an explore subagent.
`;

describe("runtime agents source loader", () => {
  it("points at agents.ts as the source of truth and never a generated agents.js", async () => {
    expect(RUNTIME_AGENTS_SPECIFIER).toBe("../../../resources/runtime/pi-ext/subagent/agents.ts");
    expect(RUNTIME_AGENTS_SPECIFIER.endsWith("agents.ts")).toBe(true);
    expect(RUNTIME_AGENTS_SPECIFIER.includes("agents.js")).toBe(false);
    const source = await readFile(loaderSource, "utf8");
    expect(source).toContain("subagent/agents.ts");
    expect(source).not.toMatch(/subagent\/agents\.js/);
    expect(source).toContain("runtime-agents.bundle.mjs");
  });

  it("resolves the workspace source tree without generated siblings", () => {
    expect(existsSync(sourceAgentsTs)).toBe(true);
    expect(existsSync(sourceAgentsJs)).toBe(false);
    expect(existsSync(sourceAgentsDts)).toBe(false);
    expect(resolveRuntimeAgentsSource()).toBe(sourceAgentsTs);
  });

  it("does not treat extraResources agents.ts as a host loader target", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-runtime-agents-packaged-"));
    const dest = join(root, "pi-ext", "subagent");
    await mkdir(dest, { recursive: true });
    const packagedTs = join(dest, "agents.ts");
    await writeFile(packagedTs, "throw new Error('extraResources agents.ts must not be imported');\n");
    await writeFile(join(dest, "agents.js"), "export const generated = true;\n");
    await writeFile(join(dest, "agents.d.ts"), "export {};\n");
    expect(resolveRuntimeAgentsSource()).toBe(sourceAgentsTs);
    const runtime = await loadRuntimeAgents(root);
    expect(runtime.isCanonicalPrivilegedBundledRole("secretary", "bundled")).toBe(true);
  });

  it("does not treat a generated-only tree as loadable", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-runtime-agents-generated-"));
    const dest = join(root, "pi-ext", "subagent");
    await mkdir(dest, { recursive: true });
    const generatedJs = join(dest, "agents.js");
    await writeFile(generatedJs, "export const generated = true;\n");
    await writeFile(join(dest, "agents.d.ts"), "export {};\n");
    const resolved = resolveRuntimeAgentsSource();
    expect(resolved).not.toBe(generatedJs);
    expect(resolved === undefined || resolved.endsWith(`${sep}agents.ts`)).toBe(true);
  });

  it("loads discovery exports from the bundled runtime core", async () => {
    const runtime = await loadRuntimeAgents();
    expect(typeof runtime.discoverAgentsFromRoots).toBe("function");
    expect(typeof runtime.discoverBundledAgentsFromDirectory).toBe("function");
    expect(typeof runtime.applyExtensionAgentContributions).toBe("function");
    expect(typeof runtime.isCanonicalPrivilegedBundledRole).toBe("function");
    expect(runtime.isCanonicalPrivilegedBundledRole("secretary", "bundled")).toBe(true);
    expect(runtime.isCanonicalPrivilegedBundledRole("explore", "project")).toBe(false);
    const bundled = runtime.discoverBundledAgentsFromDirectory(workspaceAgentsDir);
    expect(bundled.agents.map((agent) => agent.name)).toEqual(expect.arrayContaining(["explore", "secretary"]));
  });

  it("tsc emit includes the loader and the dependency-closure bundle", async () => {
    execFileSync(process.execPath, [bundleScript], { cwd: resolve(here, ".."), stdio: "pipe" });
    root = resolve(here, "../.tmp-loader-emit");
    await rm(root, { recursive: true, force: true });
    execFileSync(process.execPath, [
      tscBin,
      "-p",
      tsconfig,
      "--outDir",
      root,
      "--rootDir",
      resolve(here, "../src"),
      "--composite",
      "false",
      "--declaration",
      "true",
      "--noEmit",
      "false",
    ], { cwd: resolve(here, ".."), stdio: "pipe" });
    const emittedJs = join(root, "load-runtime-agents.js");
    const emittedDts = join(root, "load-runtime-agents.d.ts");
    expect(existsSync(emittedJs)).toBe(true);
    expect(existsSync(emittedDts)).toBe(true);
    const emitted = await readFile(emittedJs, "utf8");
    expect(emitted).toContain("runtime-agents.bundle.mjs");
    expect(emitted).toContain("agents.ts");
    expect(emitted).not.toMatch(/subagent\/agents\.js/);
    expect(emitted).not.toMatch(/import\([^)]*agents\.ts/);
    await copyFile(srcBundle, join(root, "runtime-agents.bundle.mjs"));
    const distMod = await import(emittedJs) as {
      resolveRuntimeAgentsSource: () => string | undefined;
      loadRuntimeAgents: () => Promise<{
        isCanonicalPrivilegedBundledRole: (name: string, origin: string) => boolean;
      }>;
    };
    expect(distMod.resolveRuntimeAgentsSource()).toBe(sourceAgentsTs);
    const runtime = await distMod.loadRuntimeAgents();
    expect(runtime.isCanonicalPrivilegedBundledRole("secretary", "bundled")).toBe(true);
  });

  it("loads parse/discover/apply from a temp packaged-like tree with no Electron/node_modules ancestor", async () => {
    execFileSync(process.execPath, [bundleScript], { cwd: resolve(here, ".."), stdio: "pipe" });
    expect(existsSync(srcBundle)).toBe(true);
    const bundledSource = await readFile(srcBundle, "utf8");
    expect(bundledSource).not.toMatch(/from\s+["']@earendil-works\/pi-coding-agent["']/);
    expect(bundledSource).toMatch(/yamlString|parseFrontmatter|explore/);

    root = await mkdtemp(join(tmpdir(), "pipi-packaged-agents-core-"));
    expect(root.includes(`${sep}Electron${sep}`)).toBe(false);
    const dest = join(root, "runtime-agents.bundle.mjs");
    await copyFile(srcBundle, dest);
    const agentsDir = join(root, "agents", "explore");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(join(agentsDir, "AGENT.md"), SAMPLE_AGENT);
    const extRoot = join(root, "ext");
    await mkdir(extRoot, { recursive: true });
    const probe = join(root, "probe.mjs");
    await writeFile(probe, `
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
if (here.includes("/Electron/") || here.includes("/node_modules/")) {
  throw new Error("packaged-like tree must not sit under Electron or node_modules");
}
const mod = await import(pathToFileURL(join(here, "runtime-agents.bundle.mjs")).href);
if (typeof mod.discoverBundledAgentsFromDirectory !== "function") throw new Error("missing discover");
if (typeof mod.applyExtensionAgentContributions !== "function") throw new Error("missing apply");
if (typeof mod.discoverAgentsFromRoots !== "function") throw new Error("missing discoverFromRoots");
if (!mod.isCanonicalPrivilegedBundledRole("secretary", "bundled")) throw new Error("canonical");
const discovered = mod.discoverBundledAgentsFromDirectory(join(here, "agents"));
if (!discovered.agents.some((agent) => agent.name === "explore")) {
  throw new Error("parse/discover failed: " + JSON.stringify(discovered.diagnostics));
}
const explore = discovered.agents.find((agent) => agent.name === "explore");
if (explore.capabilities.filesystem !== "read-only") throw new Error("capabilities not parsed");
const merged = mod.applyExtensionAgentContributions(discovered, {
  extensions: [{
    id: "ext-packaged-core",
    origin: "project",
    root: join(here, "ext"),
    agents: [],
    patches: [{ target: "explore", addTools: ["read"] }],
    providedTools: [],
  }],
  diagnostics: [],
});
const applied = merged.appliedPatches ?? [];
if (!applied.some((patch) => patch.extensionId === "ext-packaged-core" && patch.operations.includes("addTools"))) {
  throw new Error("apply failed: " + JSON.stringify(merged.diagnostics));
}
console.log(JSON.stringify({
  names: discovered.agents.map((agent) => agent.name),
  applied: applied.map((patch) => patch.operations),
}));
`);
    const env = { ...process.env, NODE_PATH: "" };
    delete env.NODE_PATH;
    const output = execFileSync(process.execPath, [probe], {
      cwd: root,
      env: { ...env, NODE_PATH: "" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const parsed = JSON.parse(output.trim().split("\n").at(-1) ?? "{}") as {
      names: string[];
      applied: string[][];
    };
    expect(parsed.names).toContain("explore");
    expect(parsed.applied.some((ops) => ops.includes("addTools"))).toBe(true);
  });
});
