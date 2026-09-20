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
import { createExtensionLoader } from "../src/extension-loader.js";
import { parseExtensionManifestJson } from "../src/extension-manifest.js";

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
  it("honors optional manifest defaultEnabled without changing legacy origin defaults", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-ext-defaults-"));
    const builtin = join(root, "builtin");
    const app = join(root, "app");
    const project = join(root, "project");
    for (const [directory, id, extra] of [
      [builtin, "jev-optimizer", { defaultEnabled: false }],
      [builtin, "legacy-builtin", {}],
      [app, "legacy-app", {}],
      [join(projectPiAgentDir(project), "extensions"), "legacy-project", {}],
    ] as const) {
      await mkdir(join(directory, id), { recursive: true });
      await writeFile(join(directory, id, "pipiui-extension.json"), JSON.stringify({
        id, name: id, version: "1.0.0", capabilities: [], ...extra,
      }));
    }
    const registry = createExtensionRegistry([]);
    const loader = createExtensionLoader({ registry, builtinRoot: builtin, appRoot: app });
    loader.scan(project);
    expect(registry.get("jev-optimizer")?.defaultEnabled).toBe(false);
    expect(loader.spawnPackages().find(pkg => pkg.id === "jev-optimizer")?.enabled).toBe(false);
    expect(registry.get("legacy-builtin")?.state).toBe("enabled");
    expect(registry.get("legacy-app")?.state).toBe("loaded");
    expect(registry.get("legacy-project")?.state).toBe("enabled");
    expect(loader.spawnPackages({ "jev-optimizer": true }).find(pkg => pkg.id === "jev-optimizer")?.enabled).toBe(true);
    expect(parseExtensionManifestJson(JSON.stringify({
      id: "bad-default", name: "Bad", version: "1.0.0", capabilities: [], defaultEnabled: "false",
    }))).toMatchObject({ ok: false, errors: ["defaultEnabled must be a boolean"] });
    await expect(readFile(join(projectPiAgentDir(project), "trust.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

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
      expect(item.category).toBeDefined();
    }
    expect(() => registry.unload("pi-ext")).toThrow(/illegal extension transition: enabled → unloaded/);
    expect(registry.get("pi-ext")?.state).toBe("enabled");
    expect(registry.disable("pi-ext").state).toBe("disabled");
    expect(() => registry.unload("pi-ext")).toThrow(/cannot be unloaded/);
    expect(registry.get("pi-ext")?.state).toBe("disabled");
  });

  it("unloads a builtin from error so a later ingest can rediscover it", () => {
    const registry = createExtensionRegistry([]);
    registry.ingest({
      id: "office-extension",
      name: "PipiUI Office",
      version: "0.1.0",
      origin: "builtin",
    });
    registry.enterError("office-extension", "agent.extension does not exist: agent/dist/index.js");
    expect(registry.get("office-extension")?.state).toBe("error");
    expect(() => registry.unload("office-extension")).not.toThrow();
    expect(registry.get("office-extension")).toBeUndefined();
    const again = registry.ingest({
      id: "office-extension",
      name: "PipiUI Office",
      version: "0.1.0",
      origin: "builtin",
    });
    expect(again.state).toBe("enabled");
    expect(again.error).toBeUndefined();
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

describe("session mount snapshots", () => {
  it("replaces a session snapshot on each spawn registration instead of unioning", () => {
    const registry = createExtensionRegistry([]);
    // First spawn mounts two extensions.
    registry.mountSession("sess-1", ["a", "b"]);
    expect(registry.isMounted("sess-1", "a")).toBe(true);
    expect(registry.isMounted("sess-1", "b")).toBe(true);
    // Same-ID respawn under changed enablement replaces the whole set.
    registry.mountSession("sess-1", ["b", "c"]);
    expect(registry.isMounted("sess-1", "a")).toBe(false);
    expect(registry.isMounted("sess-1", "b")).toBe(true);
    expect(registry.isMounted("sess-1", "c")).toBe(true);
  });

  it("clears the snapshot when the new spawn mounts nothing", () => {
    const registry = createExtensionRegistry([]);
    registry.mountSession("sess-1", ["pdf-extension"]);
    expect(registry.isMounted("sess-1", "pdf-extension")).toBe(true);
    // Dead child respawns with pdf disabled: no residual mount may survive.
    registry.mountSession("sess-1", []);
    expect(registry.isMounted("sess-1", "pdf-extension")).toBe(false);
    // Explicit cleanup stays per-session.
    registry.mountSession("sess-2", ["other"]);
    registry.unmountSession("sess-1");
    expect(registry.isMounted("sess-1", "other")).toBe(false);
    expect(registry.isMounted("sess-2", "other")).toBe(true);
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
    // Effective/merged state (same as spawn): inherit App disable. Do not copy it into project home.
    expect(projectView.find((item) => item.id === "pi-ext")?.state).toBe("disabled");
    expect(projectView.find((item) => item.id === "pi-goal")?.state).toBe("disabled");
    await expect(readFile(join(projectPiAgentDir(project), PROJECT_EXTENSION_ENABLED_FILE), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(join(projectPiAgentDir(project), "trust.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await backend.close();
  });

  it("lets a project overlay re-enable after a pure App-level disable", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-ext-merge-"));
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
    await backend.handle("setExtensionEnabled" as never, ["pi-ext", false, "app"]);
    const before = (await backend.handle("listExtensions" as never, [added.id])) as Array<{ id: string; state: string }>;
    expect(before.find((item) => item.id === "pi-ext")?.state).toBe("disabled");
    await expect(readFile(join(projectPiAgentDir(project), PROJECT_EXTENSION_ENABLED_FILE), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    const projectEnabled = (await backend.handle("setExtensionEnabled" as never, [
      "pi-ext",
      true,
      "project",
      added.id,
    ])) as { state: string };
    expect(projectEnabled.state).toBe("enabled");
    const appView = (await backend.handle("listExtensions" as never, [])) as Array<{ id: string; state: string }>;
    const projectView = (await backend.handle("listExtensions" as never, [added.id])) as Array<{ id: string; state: string }>;
    expect(appView.find((item) => item.id === "pi-ext")?.state).toBe("disabled");
    expect(projectView.find((item) => item.id === "pi-ext")?.state).toBe("enabled");
    const overlay = JSON.parse(await readFile(join(projectPiAgentDir(project), PROJECT_EXTENSION_ENABLED_FILE), "utf8"));
    expect(parseProjectExtensionEnabled(overlay)).toEqual({ "pi-ext": true });
    const settings = JSON.parse(await readFile(join(agent, "pipiui-settings.json"), "utf8"));
    expect(readAppExtensionEnabled(settings)["pi-ext"]).toBe(false);
    await backend.close();
  });
});
