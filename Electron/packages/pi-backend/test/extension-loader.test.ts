import { afterEach, describe, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPiHostBackend } from "../src/index.js";
import { createExtensionLoader } from "../src/extension-loader.js";
import { validateExtensionManifest } from "../src/extension-manifest.js";
import { createExtensionRegistry } from "../src/extension-registry.js";
import { projectPiAgentDir } from "../src/project-pi-home.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "extensions");
const bundledRuntimeExtensions = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../resources/runtime/extensions",
);

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

async function tempRoot(prefix: string): Promise<string> {
  root = await mkdtemp(join(tmpdir(), prefix));
  return root;
}

async function copyFixture(name: string, destDir: string, id = name): Promise<string> {
  const source = join(fixtures, name, name === "valid" ? "quota" : "pkg");
  const dest = join(destDir, id);
  await mkdir(dirname(dest), { recursive: true });
  await cp(source, dest, { recursive: true });
  return dest;
}

async function writeManifest(dir: string, body: unknown): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "pipiui-extension.json"), `${JSON.stringify(body, null, 2)}\n`);
}

type Listed = {
  id: string;
  name?: string;
  version?: string;
  state: string;
  source?: string;
  origin?: string;
  error?: string;
  capabilities?: string[];
  ui?: { panels?: Array<{ slot: string }> };
};

async function backendFor(dirs: { runtime?: string; agent?: string }) {
  const agent = dirs.agent ?? join(root, "agent");
  await mkdir(agent, { recursive: true });
  return createPiHostBackend({
    agentDir: agent,
    sessionsRoot: join(root, "sessions"),
    runtimeRoot: dirs.runtime ?? join(root, "runtime"),
    profileMode: "isolated",
    canonicalProjectPaths: async () => undefined,
  });
}

describe("extension manifest D2 validation", () => {
  it("accepts a legal package shape", async () => {
    const raw = JSON.parse(await readFile(join(fixtures, "valid", "quota", "pipiui-extension.json"), "utf8"));
    const result = validateExtensionManifest(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.id).toBe("quota");
    expect(result.manifest.ui?.panels?.[0]?.slot).toBe("toolPanel");
  });

  it("rejects missing id, illegal id, non-namespaced settings, and unknown slot", async () => {
    const missing = JSON.parse(await readFile(join(fixtures, "missing-id", "pkg", "pipiui-extension.json"), "utf8"));
    const missingResult = validateExtensionManifest(missing);
    expect(missingResult.ok).toBe(false);
    if (missingResult.ok) return;
    expect(missingResult.errors.join("; ")).toMatch(/missing required field id/i);

    const illegal = JSON.parse(await readFile(join(fixtures, "illegal-id", "pkg", "pipiui-extension.json"), "utf8"));
    const illegalResult = validateExtensionManifest(illegal);
    expect(illegalResult.ok).toBe(false);
    if (illegalResult.ok) return;
    expect(illegalResult.errors.join("; ")).toMatch(/invalid extension id/i);

    const badKey = JSON.parse(await readFile(join(fixtures, "bad-settings-key", "pkg", "pipiui-extension.json"), "utf8"));
    const badKeyResult = validateExtensionManifest(badKey);
    expect(badKeyResult.ok).toBe(false);
    if (badKeyResult.ok) return;
    expect(badKeyResult.errors.join("; ")).toMatch(/must be namespaced ext\.quota-bad-key\./);

    const slot = JSON.parse(await readFile(join(fixtures, "unknown-slot", "pkg", "pipiui-extension.json"), "utf8"));
    const slotResult = validateExtensionManifest(slot);
    expect(slotResult.ok).toBe(false);
    if (slotResult.ok) return;
    expect(slotResult.errors.join("; ")).toMatch(/unknown panel slot 'sidebar'/);
  });
});

describe("extension loader via listExtensions", () => {
  it("loads a legal package and surfaces manifest summary", async () => {
    await tempRoot("pipi-ext-valid-");
    const runtime = join(root, "runtime");
    await copyFixture("valid", join(runtime, "extensions"), "quota");
    const backend = await backendFor({ runtime });
    const listed = (await backend.handle("listExtensions" as never, [])) as Listed[];
    const quota = listed.find((item) => item.id === "quota");
    expect(quota).toMatchObject({
      id: "quota",
      name: "Quota Monitor",
      version: "1.0.0",
      state: "enabled",
      source: "builtin",
    });
    expect(quota?.capabilities).toEqual(expect.arrayContaining(["settings.read", "bridge.emit"]));
    expect(quota?.ui?.panels?.[0]?.slot).toBe("toolPanel");
    await backend.close();
  });

  it("puts invalid packages in error with a readable reason", async () => {
    await tempRoot("pipi-ext-invalid-");
    const runtime = join(root, "runtime");
    const extensions = join(runtime, "extensions");
    await copyFixture("missing-id", extensions, "missing-id");
    await copyFixture("illegal-id", extensions, "illegal-id");
    await copyFixture("bad-settings-key", extensions, "quota-bad-key");
    await copyFixture("unknown-slot", extensions, "quota-unknown-slot");
    const backend = await backendFor({ runtime });
    const listed = (await backend.handle("listExtensions" as never, [])) as Listed[];

    const missing = listed.find((item) => item.id === "missing-id" || item.error?.includes("missing required field id"));
    expect(missing?.state).toBe("error");
    expect(missing?.error).toMatch(/missing required field id/i);

    const illegal = listed.find((item) => item.error?.match(/invalid extension id/i) || item.id === "Quota");
    expect(illegal?.state).toBe("error");
    expect(illegal?.error).toMatch(/invalid extension id/i);

    const badKey = listed.find((item) => item.id === "quota-bad-key");
    expect(badKey?.state).toBe("error");
    expect(badKey?.error).toMatch(/must be namespaced ext\.quota-bad-key\./);

    const slot = listed.find((item) => item.id === "quota-unknown-slot");
    expect(slot?.state).toBe("error");
    expect(slot?.error).toMatch(/unknown panel slot 'sidebar'/);
    await backend.close();
  });

  it("selects project over app over builtin without rewriting builtin files", async () => {
    await tempRoot("pipi-ext-priority-");
    const runtime = join(root, "runtime");
    const agent = join(root, "agent");
    const project = join(root, "repo");
    await writeManifest(join(runtime, "extensions", "quota"), {
      id: "quota",
      name: "Builtin Quota",
      version: "1.0.0",
      capabilities: [],
    });
    const builtinText = await readFile(join(runtime, "extensions", "quota", "pipiui-extension.json"), "utf8");
    await writeManifest(join(agent, "extensions", "quota"), {
      id: "quota",
      name: "App Quota",
      version: "2.0.0",
      capabilities: ["settings.read"],
    });
    await writeManifest(join(projectPiAgentDir(project), "extensions", "quota"), {
      id: "quota",
      name: "Project Quota",
      version: "3.0.0",
      capabilities: ["bridge.emit"],
    });
    await mkdir(project, { recursive: true });

    const backend = await backendFor({ runtime, agent });
    const appView = (await backend.handle("listExtensions" as never, [])) as Listed[];
    expect(appView.find((item) => item.id === "quota")).toMatchObject({
      name: "App Quota",
      version: "2.0.0",
      source: "app",
    });

    const added = (await backend.handle("addProject", [project])) as { id: string };
    const projectView = (await backend.handle("listExtensions" as never, [added.id])) as Listed[];
    expect(projectView.find((item) => item.id === "quota")).toMatchObject({
      name: "Project Quota",
      version: "3.0.0",
      source: "project",
      capabilities: ["bridge.emit"],
    });

    expect(await readFile(join(runtime, "extensions", "quota", "pipiui-extension.json"), "utf8")).toBe(builtinText);

    const after = (await backend.handle("listExtensions" as never, [])) as Listed[];
    expect(after.find((item) => item.id === "quota")).toMatchObject({
      name: "App Quota",
      version: "2.0.0",
      source: "app",
    });
    await backend.close();
  });

  it("does not scan another project's extensions home", async () => {
    await tempRoot("pipi-ext-isolate-");
    const runtime = join(root, "runtime");
    await mkdir(join(runtime, "extensions"), { recursive: true });
    const projectA = join(root, "proj-a");
    const projectB = join(root, "proj-b");
    await mkdir(projectA, { recursive: true });
    await mkdir(projectB, { recursive: true });
    await writeManifest(join(projectPiAgentDir(projectA), "extensions", "alpha"), {
      id: "alpha",
      name: "Alpha",
      version: "1.0.0",
      capabilities: [],
    });
    await writeManifest(join(projectPiAgentDir(projectB), "extensions", "beta"), {
      id: "beta",
      name: "Beta",
      version: "1.0.0",
      capabilities: [],
    });
    await symlink(join(projectPiAgentDir(projectB), "extensions", "beta"), join(projectPiAgentDir(projectA), "extensions", "beta"));

    const backend = await backendFor({ runtime });
    const addedA = (await backend.handle("addProject", [projectA])) as { id: string };
    const addedB = (await backend.handle("addProject", [projectB])) as { id: string };

    const listA = (await backend.handle("listExtensions" as never, [addedA.id])) as Listed[];
    expect(listA.find((item) => item.id === "alpha")).toMatchObject({ source: "project", name: "Alpha" });
    expect(listA.find((item) => item.id === "beta")).toBeUndefined();

    const listB = (await backend.handle("listExtensions" as never, [addedB.id])) as Listed[];
    expect(listB.find((item) => item.id === "beta")).toMatchObject({ source: "project", name: "Beta" });
    expect(listB.find((item) => item.id === "alpha")).toBeUndefined();
    await backend.close();
  });
});

describe("extension loader agent spawn mounts", () => {
  it("reports agent.extension for overlay-enabled packages and not as enabled when disabled", async () => {
    await tempRoot("pipi-ext-spawn-");
    const appRoot = join(root, "agent", "extensions");
    await copyFixture("valid", appRoot, "quota");
    const registry = createExtensionRegistry([]);
    const loader = createExtensionLoader({
      registry,
      builtinRoot: join(root, "runtime", "extensions"),
      appRoot,
    });
    loader.scan();
    const disabled = loader.spawnPackages().find((pkg) => pkg.id === "quota");
    expect(disabled?.enabled).toBe(false);
    expect(disabled?.extensionPath).toMatch(/quota\/agent\/dist\/index\.js$/);
    const enabled = loader.spawnPackages({ quota: true }).find((pkg) => pkg.id === "quota");
    expect(enabled?.enabled).toBe(true);
    expect(enabled?.extensionPath).toBe(disabled?.extensionPath);
  });
});

describe("extension loader scan confinement", () => {
  it("ignores packages whose realpath leaves the project agent home", async () => {
    await tempRoot("pipi-ext-jail-");
    const registry = createExtensionRegistry([]);
    const projectA = join(root, "a");
    const projectB = join(root, "b");
    await writeManifest(join(projectPiAgentDir(projectB), "extensions", "escaped"), {
      id: "escaped",
      name: "Escaped",
      version: "1.0.0",
      capabilities: [],
    });
    await mkdir(join(projectPiAgentDir(projectA), "extensions"), { recursive: true });
    await symlink(
      join(projectPiAgentDir(projectB), "extensions", "escaped"),
      join(projectPiAgentDir(projectA), "extensions", "escaped"),
    );
    const loader = createExtensionLoader({
      registry,
      builtinRoot: join(root, "runtime", "extensions"),
      appRoot: join(root, "agent", "extensions"),
    });
    loader.scan(projectA);
    expect(registry.get("escaped")).toBeUndefined();
  });
});

describe("bundled hello-pipiui dogfood package", () => {
  it("scans the runtime extensions dir and loads hello-pipiui as builtin", async () => {
    await tempRoot("pipi-ext-hello-");
    const manifestText = await readFile(join(bundledRuntimeExtensions, "hello-pipiui", "pipiui-extension.json"), "utf8");
    const raw = JSON.parse(manifestText);
    const validation = validateExtensionManifest(raw);
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    expect(validation.manifest.id).toBe("hello-pipiui");
    expect(validation.manifest.capabilities).toEqual([
      "settings.read",
      "settings.write",
      "bridge.emit",
      "invoke.agent",
      "stream.render",
    ]);
    expect(validation.manifest.ui?.panels?.[0]).toMatchObject({
      slot: "toolPanel",
      id: "hello-pipiui",
      entry: "app/dist/panel.js",
    });

    const registry = createExtensionRegistry([]);
    const loader = createExtensionLoader({
      registry,
      builtinRoot: bundledRuntimeExtensions,
      appRoot: join(root, "agent", "extensions"),
    });
    const records = loader.scan();
    const rec = records.find((item) => item.id === "hello-pipiui") ?? registry.get("hello-pipiui");
    expect(rec).toMatchObject({
      id: "hello-pipiui",
      origin: "builtin",
      state: "enabled",
    });
    expect(rec?.error).toBeUndefined();
    const listed = loader.list().find((item) => item.id === "hello-pipiui");
    expect(listed?.source).toBe("builtin");
    expect(listed?.capabilities).toEqual(
      expect.arrayContaining(["bridge.emit", "invoke.agent", "stream.render"]),
    );
    expect(listed?.ui?.panels?.[0]?.slot).toBe("toolPanel");
  });
});
