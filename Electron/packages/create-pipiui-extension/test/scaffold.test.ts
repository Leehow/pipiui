import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  createPipiuiExtension,
  legalizeExtensionId,
  stripJsonc,
  templateRoot,
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
    const { cp } = await import("node:fs/promises");
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
      state: "loaded",
    });
    expect(rec?.error).toBeUndefined();
    expect(loader.list().find((item) => item.id === "hello-ping")?.capabilities).toEqual(
      expect.arrayContaining(["bridge.emit", "invoke.agent", "stream.render"]),
    );
  });
});
