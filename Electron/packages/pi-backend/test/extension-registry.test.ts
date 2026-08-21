import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiHostBackend } from "../src/index.js";
import {
  BUILTIN_EXTENSION_PACKAGES,
  PROJECT_EXTENSION_ENABLED_FILE,
  assertLegalTransition,
  canTransition,
  createExtensionRegistry,
  parseProjectExtensionEnabled,
  readAppExtensionEnabled,
  writeAppExtensionEnabled,
  type ExtensionLifecycleState,
} from "../src/extension-registry.js";
import { projectPiAgentDir } from "../src/project-pi-home.js";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

const LEGAL: Array<[ExtensionLifecycleState, ExtensionLifecycleState]> = [
  ["discovered", "loaded"],
  ["discovered", "error"],
  ["loaded", "enabled"],
  ["loaded", "disabled"],
  ["loaded", "error"],
  ["enabled", "disabled"],
  ["enabled", "error"],
  ["disabled", "enabled"],
  ["disabled", "unloaded"],
  ["disabled", "error"],
  ["error", "unloaded"],
];

const ILLEGAL: Array<[ExtensionLifecycleState, ExtensionLifecycleState]> = [
  ["enabled", "unloaded"],
  ["discovered", "enabled"],
  ["discovered", "disabled"],
  ["discovered", "unloaded"],
  ["loaded", "unloaded"],
  ["loaded", "discovered"],
  ["unloaded", "loaded"],
  ["unloaded", "enabled"],
  ["error", "enabled"],
  ["error", "loaded"],
  ["error", "disabled"],
  ["enabled", "discovered"],
  ["disabled", "discovered"],
];

describe("extension lifecycle state machine", () => {
  it("allows the D9 edges and rejects the rest", () => {
    for (const [from, to] of LEGAL) {
      expect(canTransition(from, to), `${from} → ${to}`).toBe(true);
      expect(() => assertLegalTransition(from, to)).not.toThrow();
    }
    for (const [from, to] of ILLEGAL) {
      expect(canTransition(from, to), `${from} → ${to}`).toBe(false);
      expect(() => assertLegalTransition(from, to)).toThrow(/illegal extension transition/);
    }
  });

  it("ingests builtins as enabled and refuses unload", () => {
    const registry = createExtensionRegistry();
    const ids = registry.list().map((item) => item.id);
    expect(ids).toEqual([...BUILTIN_EXTENSION_PACKAGES].map((item) => item.id).sort());
    for (const item of registry.list()) {
      expect(item.origin).toBe("builtin");
      expect(item.state).toBe("enabled");
      expect(item.uninstallable).toBe(false);
    }
    expect(() => registry.unload("pi-ext")).toThrow(/illegal extension transition: enabled → unloaded/);
    expect(registry.get("pi-ext")?.state).toBe("enabled");
    expect(registry.disable("pi-ext").state).toBe("disabled");
    expect(() => registry.unload("pi-ext")).toThrow(/cannot be unloaded/);
    expect(registry.get("pi-ext")?.state).toBe("disabled");
  });

  it("enters error on invalid descriptors without enabling", () => {
    const registry = createExtensionRegistry([]);
    const bad = registry.ingest({
      id: "Not Valid",
      name: "Bad",
      version: "1.0.0",
      origin: "app",
    });
    expect(bad.state).toBe("error");
    expect(bad.error).toMatch(/invalid extension id/);
    expect(() => registry.enable("Not Valid")).toThrow(/error; not retrying|illegal extension transition/);
  });

  it("enters error on migration failure and does not commit", () => {
    const registry = createExtensionRegistry([]);
    registry.ingest({ id: "quota", name: "Quota", version: "1.0.0", origin: "app", defaultEnabled: true });
    let committed = false;
    const record = registry.applyMigration(
      "quota",
      () => {
        throw new Error("migration failed");
      },
      () => {
        committed = true;
      },
    );
    expect(record.state).toBe("error");
    expect(record.error).toBe("migration failed");
    expect(committed).toBe(false);
    expect(() =>
      registry.applyMigration("quota", () => undefined, () => {
        committed = true;
      }),
    ).toThrow(/not retrying/);
    expect(committed).toBe(false);
  });

  it("leaves no registry residual after disable+unload", () => {
    const registry = createExtensionRegistry([]);
    registry.ingest({ id: "quota", name: "Quota", version: "1.0.0", origin: "app" });
    expect(registry.get("quota")?.state).toBe("loaded");
    let residual = true;
    registry.register("quota", () => {
      residual = false;
    });
    expect(() => registry.unload("quota")).toThrow(/illegal extension transition/);
    expect(registry.get("quota")).toBeTruthy();
    registry.enable("quota");
    expect(() => registry.unload("quota")).toThrow(/enabled → unloaded/);
    registry.disable("quota");
    expect(residual).toBe(false);
    registry.unload("quota");
    expect(registry.get("quota")).toBeUndefined();
    expect(registry.list().find((item) => item.id === "quota")).toBeUndefined();
    expect(registry.hasResiduals("quota")).toBe(false);
  });
});

describe("extension enable persistence", () => {
  it("round-trips App-level enablement through pipiui-settings.json extensions slot", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-ext-app-"));
    const agent = join(root, "agent");
    await mkdir(agent, { recursive: true });
    const first = createPiHostBackend({
      agentDir: agent,
      sessionsRoot: join(root, "sessions"),
      canonicalProjectPaths: async () => undefined,
    });
    const listed = (await first.handle("listExtensions" as never, [])) as Array<{ id: string; state: string }>;
    expect(listed.find((item) => item.id === "pi-ext")?.state).toBe("enabled");
    const disabled = (await first.handle("setExtensionEnabled" as never, ["pi-ext", false, "app"])) as { state: string };
    expect(disabled.state).toBe("disabled");
    const settings = JSON.parse(await readFile(join(agent, "pipiui-settings.json"), "utf8"));
    expect(readAppExtensionEnabled(settings)).toMatchObject({ "pi-ext": false });
    expect(settings.extensions["pi-ext"]).toMatchObject({ enabled: false });
    await first.close();

    const second = createPiHostBackend({
      agentDir: agent,
      sessionsRoot: join(root, "sessions"),
      canonicalProjectPaths: async () => undefined,
    });
    const again = (await second.handle("listExtensions" as never, [])) as Array<{ id: string; state: string }>;
    expect(again.find((item) => item.id === "pi-ext")?.state).toBe("disabled");
    await second.handle("setExtensionEnabled" as never, ["pi-ext", true, "app"]);
    const restored = (await second.handle("listExtensions" as never, [])) as Array<{ id: string; state: string }>;
    expect(restored.find((item) => item.id === "pi-ext")?.state).toBe("enabled");
    await second.close();
  });

  it("lets a project overlay win without rewriting App enablement", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-ext-project-"));
    const agent = join(root, "agent");
    const project = join(root, "repo");
    await mkdir(agent, { recursive: true });
    await mkdir(project, { recursive: true });
    const backend = createPiHostBackend({
      agentDir: agent,
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
    });
    const added = (await backend.handle("addProject", [project])) as { id: string };
    await backend.handle("setExtensionEnabled" as never, ["pi-philosophy", true, "app"]);
    const projectDisabled = (await backend.handle("setExtensionEnabled" as never, [
      "pi-philosophy",
      false,
      "project",
      added.id,
    ])) as { state: string };
    expect(projectDisabled.state).toBe("disabled");
    const appView = (await backend.handle("listExtensions" as never, [])) as Array<{ id: string; state: string }>;
    const projectView = (await backend.handle("listExtensions" as never, [added.id])) as Array<{
      id: string;
      state: string;
    }>;
    expect(appView.find((item) => item.id === "pi-philosophy")?.state).toBe("enabled");
    expect(projectView.find((item) => item.id === "pi-philosophy")?.state).toBe("disabled");
    const overlay = JSON.parse(await readFile(join(projectPiAgentDir(project), PROJECT_EXTENSION_ENABLED_FILE), "utf8"));
    expect(parseProjectExtensionEnabled(overlay)).toEqual({ "pi-philosophy": false });
    const settings = JSON.parse(await readFile(join(agent, "pipiui-settings.json"), "utf8"));
    expect(readAppExtensionEnabled(settings)["pi-philosophy"]).toBe(true);
    const piSettingsPath = join(projectPiAgentDir(project), "settings.json");
    const piSettings = JSON.parse(await readFile(piSettingsPath, "utf8").catch(() => "{}"));
    expect(piSettings).not.toHaveProperty("extensions");
    expect(piSettings).not.toHaveProperty("pi-philosophy");
    await backend.close();
  });

  it("does not seed App enablement into a new project view or home", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-ext-noseed-"));
    const agent = join(root, "agent");
    const project = join(root, "fresh");
    await mkdir(agent, { recursive: true });
    await mkdir(project, { recursive: true });
    const settings: Record<string, unknown> = { keep: "me" };
    writeAppExtensionEnabled(settings, "pi-ext", false);
    writeAppExtensionEnabled(settings, "pi-goal", false);
    await writeFile(join(agent, "pipiui-settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
    const backend = createPiHostBackend({
      agentDir: agent,
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
    });
    const appView = (await backend.handle("listExtensions" as never, [])) as Array<{ id: string; state: string }>;
    expect(appView.find((item) => item.id === "pi-ext")?.state).toBe("disabled");
    expect(appView.find((item) => item.id === "pi-goal")?.state).toBe("disabled");
    const added = (await backend.handle("addProject", [project])) as { id: string };
    const projectView = (await backend.handle("listExtensions" as never, [added.id])) as Array<{
      id: string;
      state: string;
    }>;
    expect(projectView.find((item) => item.id === "pi-ext")?.state).toBe("enabled");
    expect(projectView.find((item) => item.id === "pi-goal")?.state).toBe("enabled");
    await expect(readFile(join(projectPiAgentDir(project), PROJECT_EXTENSION_ENABLED_FILE), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(join(projectPiAgentDir(project), "trust.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await backend.close();
  });
});
