import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  createPipiuiExtension,
  createPipiuiProfile,
  legalizeExtensionId,
  stripJsonc,
  templateRoot,
  profileTemplateRoot,
} from "../src/cli.mjs";
import { createExtensionLoader } from "../../pi-backend/src/extension-loader.js";
import { createExtensionRegistry } from "../../pi-backend/src/extension-registry.js";
import { EXTENSION_CAPABILITIES, parseExtensionManifestJson } from "../../pi-backend/src/extension-manifest.js";
import { projectPiAgentDir } from "../../pi-backend/src/project-pi-home.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(pkgRoot, "src", "cli.mjs");
const capabilitySet = new Set<string>(EXTENSION_CAPABILITIES);

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

async function tempRoot(prefix: string): Promise<string> {
  root = await mkdtemp(join(tmpdir(), prefix));
  return root;
}

function runCli(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], { cwd, env: { ...process.env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

describe("create-pipiui-extension id legalization", () => {
  it("maps display names onto [a-z][a-z0-9-]* and prefixes a letter when needed", () => {
    expect(legalizeExtensionId("My Ext")).toBe("my-ext");
    expect(legalizeExtensionId("Hello_World")).toBe("hello-world");
    expect(legalizeExtensionId("123")).toBe("ext-123");
    expect(legalizeExtensionId("quota")).toBe("quota");
    expect(() => legalizeExtensionId("   ")).toThrow(/missing <name>/);
    expect(() => legalizeExtensionId("你好")).toThrow(/cannot legalize/);
  });

  it("strips JSONC comments without touching strings", () => {
    const raw = `{
  // heading
  "id": "hello", /* inner */
  "name": "keep // slash"
}`;
    expect(JSON.parse(stripJsonc(raw))).toEqual({ id: "hello", name: "keep // slash" });
  });
});

describe("create-pipiui-extension CLI", () => {
  it("copies the local template, fills id/name, and emits loadable JSON (no network)", async () => {
    const cwd = await tempRoot("pipi-create-ext-");
    const dest = join(cwd, "out");
    const spawned = await runCli(["My Ext", dest], cwd);
    expect(spawned.code, spawned.stderr).toBe(0);
    expect(spawned.stdout).toMatch(/created my-ext/);

    const manifestText = await readFile(join(dest, "pipiui-extension.json"), "utf8");
    expect(manifestText).not.toMatch(/\/\//);
    const parsed = JSON.parse(manifestText);
    expect(parsed).toMatchObject({
      id: "my-ext",
      name: "My Ext",
      version: "0.1.0",
    });
    expect(parsed.capabilities).toEqual([
      "settings.read",
      "settings.write",
      "bridge.emit",
      "invoke.agent",
      "stream.render",
    ]);
    expect(parsed.app.settings.schema.properties["ext.my-ext.greeting"]).toBeTruthy();

    const agent = await readFile(join(dest, "agent", "index.ts"), "utf8");
    expect(agent).toContain('const EXTENSION_ID = "my-ext"');
    expect(agent).toContain('action: "ext.emit"');
    expect(existsSync(join(dest, "app", "panel.tsx"))).toBe(true);
    expect(existsSync(join(dest, "README.md"))).toBe(true);
    expect(templateRoot()).toBe(join(pkgRoot, "template"));

    const again = await runCli(["My Ext", dest], cwd);
    expect(again.code).toBe(1);
    expect(again.stderr).toMatch(/not empty/);
  });

  it("creates a project-local Product Profile with --profile", async () => {
    const cwd = await tempRoot("pipi-create-profile-");
    const dest = join(cwd, "trpg-profile");
    const spawned = await runCli(["--profile", "TRPG", dest], cwd);
    expect(spawned.code, spawned.stderr).toBe(0);
    expect(spawned.stdout).toMatch(/created profile trpg/);
    const profile = JSON.parse(await readFile(join(dest, "pipiui-profile.json"), "utf8"));
    expect(profile).toMatchObject({
      schemaVersion: 1,
      id: "trpg",
      name: "TRPG",
      extensions: { required: [], recommended: [] },
    });
    expect(profileTemplateRoot()).toBe(join(pkgRoot, "profile-template"));
    expect(createPipiuiProfile({ name: "Lab", dir: join(cwd, "lab"), cwd }).id).toBe("lab");
  });

  it("scaffolds into the project extensions dir with --install (discovered path)", async () => {
    const cwd = await tempRoot("pipi-create-install-");
    await mkdir(join(cwd, ".git"), { recursive: true });
    const spawned = await runCli(["My Tool", "--install"], cwd);
    expect(spawned.code, spawned.stderr).toBe(0);
    // The child reports process.cwd(), which macOS resolves past the /var→/private/var symlink.
    const dest = join(realpathSync(cwd), ".pi", "agent", "extensions", "my-tool");
    expect(spawned.stdout).toContain(`installed my-tool at ${dest}`);
    const parsed = JSON.parse(await readFile(join(dest, "pipiui-extension.json"), "utf8"));
    expect(parsed).toMatchObject({ id: "my-tool", name: "My Tool", version: "0.1.0" });
  });

  it("keeps an explicit [dir] winning over --install", async () => {
    const cwd = await tempRoot("pipi-create-install-dir-");
    await mkdir(join(cwd, ".git"), { recursive: true });
    const dest = join(cwd, "custom-out");
    const spawned = await runCli(["My Tool", "--install", dest], cwd);
    expect(spawned.code, spawned.stderr).toBe(0);
    expect(spawned.stdout).toMatch(/created my-tool/);
    expect(existsSync(join(dest, "pipiui-extension.json"))).toBe(true);
    expect(existsSync(join(cwd, ".pi", "agent", "extensions", "my-tool"))).toBe(false);
  });

  it("errors out when --install cannot find a project root", async () => {
    const cwd = await tempRoot("pipi-create-install-orphan-");
    const spawned = await runCli(["My Tool", "--install"], cwd);
    expect(spawned.code).toBe(1);
    expect(spawned.stderr).toMatch(/--install/);
    expect(existsSync(join(cwd, "my-tool"))).toBe(false);
  });
});

describe("scaffolded package on the pi-backend loader scan path", () => {
  it("discovers a legalized package and loads it (manifest + capability enum)", async () => {
    const cwd = await tempRoot("pipi-create-ext-load-");
    const generated = join(cwd, "generated");
    const result = createPipiuiExtension({ name: "Hello Ping", dir: generated, cwd });
    expect(result.id).toBe("hello-ping");

    const manifestText = await readFile(join(generated, "pipiui-extension.json"), "utf8");
    const validation = parseExtensionManifestJson(manifestText);
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    expect(validation.manifest.id).toBe("hello-ping");
    for (const cap of validation.manifest.capabilities) {
      expect(capabilitySet.has(cap), cap).toBe(true);
    }

    const project = join(cwd, "project");
    await mkdir(project, { recursive: true });
    const scanDir = join(projectPiAgentDir(project), "extensions");
    const dest = join(scanDir, result.id);
    const { cp, symlink } = await import("node:fs/promises");
    // The manifest pins agent/dist/index.js and the loader fail-closes on a
    // missing entry, so build the agent slice exactly like a developer
    // checkout would: types resolve from the installed workspace deps.
    const electronRoot = fileURLToPath(new URL("../../..", import.meta.url));
    await symlink(join(electronRoot, "node_modules"), join(generated, "node_modules"), "dir");
    const tsc = join(electronRoot, "node_modules", "typescript", "bin", "tsc");
    await new Promise<void>((resolve, reject) => {
      const build = spawn(process.execPath, [tsc, "-p", join(generated, "agent", "tsconfig.json")], { stdio: "pipe" });
      let out = "";
      build.stdout.on("data", (chunk) => { out += chunk; });
      build.stderr.on("data", (chunk) => { out += chunk; });
      build.on("error", reject);
      build.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`template agent build failed: ${code}\n${out}`)));
    });
    await mkdir(scanDir, { recursive: true });
    await cp(generated, dest, { recursive: true });

    const registry = createExtensionRegistry([]);
    const loader = createExtensionLoader({
      registry,
      builtinRoot: join(cwd, "runtime", "extensions"),
      appRoot: join(cwd, "agent", "extensions"),
    });
    const records = loader.scan(project);
    const rec = records.find((item) => item.id === "hello-ping") ?? registry.get("hello-ping");
    expect(rec).toMatchObject({
      id: "hello-ping",
      name: "Hello Ping",
      version: "0.1.0",
      origin: "project",
      // Project-origin packages default to enabled (no overlay record needed).
      state: "enabled",
    });
    expect(rec?.error).toBeUndefined();
    expect(loader.list().find((item) => item.id === "hello-ping")?.capabilities).toEqual(
      expect.arrayContaining(["bridge.emit", "invoke.agent", "stream.render"]),
    );
  });
});
