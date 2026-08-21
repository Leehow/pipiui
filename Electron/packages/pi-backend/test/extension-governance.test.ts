import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiHostBackend } from "../src/index.js";
import { migrateExtensionSettings, parseExtensionMigrations } from "../src/extension-migrations.js";
import { evaluateCapabilityGrant } from "../src/extension-grants.js";
import { projectPiAgentDir } from "../src/project-pi-home.js";
import { listSecretMeta, resetInMemoryVault } from "../src/secret-vault.js";
import { projectExtensionSettingsPath } from "../src/extension-settings.js";

let root = "";

afterEach(async () => {
  resetInMemoryVault();
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

async function tempRoot(prefix: string): Promise<string> {
  root = await mkdtemp(join(tmpdir(), prefix));
  return root;
}

async function writeManifest(dir: string, body: unknown): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "pipiui-extension.json"), `${JSON.stringify(body, null, 2)}\n`);
}

async function backendFor(dirs: { runtime?: string; agent?: string }) {
  const agent = dirs.agent ?? join(root, "agent");
  await mkdir(agent, { recursive: true });
  return createPiHostBackend({
    agentDir: agent,
    sessionsRoot: join(root, "sessions"),
    runtimeRoot: dirs.runtime ?? join(root, "runtime"),
    profileMode: "isolated",
    canonicalProjectPaths: async () => undefined,
    vaultDir: agent,
  });
}

const quotaV2 = {
  id: "quota",
  name: "Quota",
  version: "2.0.0",
  capabilities: ["settings.read", "settings.write"],
  settingsVersion: 2,
  migrations: [{ from: 1, to: 2, map: { "ext.quota.oldThreshold": "ext.quota.threshold" } }],
  app: {
    settings: {
      scope: "app",
      schema: {
        type: "object",
        properties: {
          "ext.quota.threshold": { type: "number" },
          "ext.quota.token": { type: "string", format: "secret" },
        },
      },
    },
  },
};

describe("settings migrations", () => {
  it("parses from→to key maps", () => {
    const parsed = parseExtensionMigrations([{ from: 1, to: 2, rename: { "ext.a.old": "ext.a.new" } }]);
    expect(parsed).toEqual({
      ok: true,
      migrations: [{ from: 1, to: 2, map: { "ext.a.old": "ext.a.new" } }],
    });
  });

  it("migrates in memory and refuses a missing step", () => {
    const ok = migrateExtensionSettings({
      diskVersion: 1,
      targetVersion: 2,
      migrations: [{ from: 1, to: 2, map: { "ext.quota.old": "ext.quota.new" } }],
      settings: { "ext.quota.old": 8 },
    });
    expect(ok).toEqual({
      ok: true,
      changed: true,
      settingsVersion: 2,
      settings: { "ext.quota.new": 8 },
    });
    const missing = migrateExtensionSettings({
      diskVersion: 1,
      targetVersion: 3,
      migrations: [{ from: 1, to: 2, map: { "ext.quota.old": "ext.quota.new" } }],
      settings: { "ext.quota.old": 8 },
    });
    expect(missing.ok).toBe(false);
  });

  it("applies key maps on load and writes the new version once", async () => {
    await tempRoot("pipi-ext-migrate-ok-");
    const agent = join(root, "agent");
    const runtime = join(root, "runtime");
    await writeManifest(join(runtime, "extensions", "quota"), quotaV2);
    await mkdir(agent, { recursive: true });
    await writeFile(
      join(agent, "pipiui-settings.json"),
      `${JSON.stringify({
        extensions: {
          quota: { settings: { "ext.quota.oldThreshold": 42 }, settingsVersion: 1 },
        },
      }, null, 2)}\n`,
    );
    const backend = await backendFor({ runtime, agent });
    const listed = (await backend.handle("listExtensions" as never, [])) as Array<{ id: string; state: string; error?: string }>;
    expect(listed.find((item) => item.id === "quota")).toMatchObject({ id: "quota", state: "enabled" });
    const got = (await backend.handle("getExtensionSettings" as never, ["quota"])) as Record<string, unknown>;
    expect(got).toEqual({ "ext.quota.threshold": 42 });
    const disk = JSON.parse(await readFile(join(agent, "pipiui-settings.json"), "utf8"));
    expect(disk.extensions.quota.settings).toEqual({ "ext.quota.threshold": 42 });
    expect(disk.extensions.quota.settingsVersion).toBe(2);
    expect(JSON.stringify(disk)).not.toContain("oldThreshold");
    await backend.close();
  });

  it("enters error and does not write partial data when a migration step is missing", async () => {
    await tempRoot("pipi-ext-migrate-fail-");
    const agent = join(root, "agent");
    const runtime = join(root, "runtime");
    await writeManifest(join(runtime, "extensions", "quota"), {
      ...quotaV2,
      settingsVersion: 3,
    });
    const original = {
      extensions: {
        quota: { settings: { "ext.quota.oldThreshold": 42 }, settingsVersion: 1 },
      },
    };
    await mkdir(agent, { recursive: true });
    await writeFile(join(agent, "pipiui-settings.json"), `${JSON.stringify(original, null, 2)}\n`);
    const backend = await backendFor({ runtime, agent });
    const listed = (await backend.handle("listExtensions" as never, [])) as Array<{ id: string; state: string; error?: string }>;
    const quota = listed.find((item) => item.id === "quota");
    expect(quota?.state).toBe("error");
    expect(quota?.error).toMatch(/missing migration from 2/);
    const disk = JSON.parse(await readFile(join(agent, "pipiui-settings.json"), "utf8"));
    expect(disk.extensions.quota.settings).toEqual({ "ext.quota.oldThreshold": 42 });
    expect(disk.extensions.quota.settingsVersion).toBe(1);
    await backend.close();
  });
});

describe("uninstallExtension", () => {
  it("disables then deletes an app-level package with no registry residual", async () => {
    await tempRoot("pipi-ext-uninstall-app-");
    const agent = join(root, "agent");
    const runtime = join(root, "runtime");
    await mkdir(join(runtime, "extensions"), { recursive: true });
    const pkg = join(agent, "extensions", "quota");
    await writeManifest(pkg, {
      id: "quota",
      name: "Quota",
      version: "1.0.0",
      capabilities: ["settings.read"],
    });
    const backend = await backendFor({ runtime, agent });
    await backend.handle("setExtensionEnabled" as never, ["quota", true, "app"]);
    const before = (await backend.handle("listExtensions" as never, [])) as Array<{ id: string; state: string }>;
    expect(before.find((item) => item.id === "quota")?.state).toBe("enabled");
    const result = (await backend.handle("uninstallExtension" as never, ["quota"])) as { id: string; state: string };
    expect(result).toEqual({ id: "quota", state: "unloaded" });
    expect(existsSync(pkg)).toBe(false);
    const after = (await backend.handle("listExtensions" as never, [])) as Array<{ id: string }>;
    expect(after.find((item) => item.id === "quota")).toBeUndefined();
    await backend.close();
  });

  it("refuses to uninstall builtin packages", async () => {
    await tempRoot("pipi-ext-uninstall-builtin-");
    const backend = await backendFor({});
    await expect(backend.handle("uninstallExtension" as never, ["pi-ext"])).rejects.toThrow(/cannot be uninstalled/);
    const listed = (await backend.handle("listExtensions" as never, [])) as Array<{ id: string }>;
    expect(listed.find((item) => item.id === "pi-ext")).toBeTruthy();
    await backend.close();
  });

  it("rejects path-escaping ids", async () => {
    await tempRoot("pipi-ext-uninstall-escape-");
    const backend = await backendFor({});
    await expect(backend.handle("uninstallExtension" as never, ["../secret"])).rejects.toThrow(/invalid extension id|unknown extension/);
    await backend.close();
  });

  it("refuses a package whose directory symlink escapes the jail", async () => {
    await tempRoot("pipi-ext-uninstall-symlink-");
    const agent = join(root, "agent");
    const runtime = join(root, "runtime");
    await mkdir(join(runtime, "extensions"), { recursive: true });
    const outside = join(root, "outside", "quota");
    await writeManifest(outside, { id: "quota", name: "Quota", version: "1.0.0", capabilities: [] });
    await mkdir(join(agent, "extensions"), { recursive: true });
    await symlink(outside, join(agent, "extensions", "quota"));
    const backend = await backendFor({ runtime, agent });
    const listed = (await backend.handle("listExtensions" as never, [])) as Array<{ id: string; source?: string }>;
    expect(listed.find((item) => item.id === "quota")).toBeUndefined();
    await expect(backend.handle("uninstallExtension" as never, ["quota"])).rejects.toThrow(/unknown extension/);
    expect(existsSync(outside)).toBe(true);
    await backend.close();
  });
});

describe("capability grants", () => {
  it("requires confirmation on first L1 grant and after the declared set grows", async () => {
    await tempRoot("pipi-ext-grant-");
    const agent = join(root, "agent");
    const runtime = join(root, "runtime");
    await writeManifest(join(agent, "extensions", "quota"), {
      id: "quota",
      name: "Quota",
      version: "1.0.0",
      capabilities: ["settings.read", "bridge.emit"],
    });
    const backend = await backendFor({ runtime, agent });
    await backend.handle("listExtensions" as never, []);
    const first = (await backend.handle("getCapabilityGrant" as never, ["quota"])) as {
      needsConfirmation: boolean;
      refused: boolean;
      grantedCapabilities: string[];
    };
    expect(first).toMatchObject({ needsConfirmation: true, refused: false, grantedCapabilities: [] });
    const confirmed = (await backend.handle("confirmCapabilityGrant" as never, [
      "quota",
      ["settings.read", "bridge.emit"],
    ])) as { needsConfirmation: boolean; grantedCapabilities: string[]; grantedAt?: string };
    expect(confirmed.needsConfirmation).toBe(false);
    expect(confirmed.grantedCapabilities).toEqual(["settings.read", "bridge.emit"]);
    expect(confirmed.grantedAt).toBeTruthy();
    const settings = JSON.parse(await readFile(join(agent, "pipiui-settings.json"), "utf8"));
    expect(settings.extensions.quota.grantedCapabilities).toEqual(["settings.read", "bridge.emit"]);
    expect(typeof settings.extensions.quota.grantedAt).toBe("string");
    await backend.close();

    await writeManifest(join(agent, "extensions", "quota"), {
      id: "quota",
      name: "Quota",
      version: "1.1.0",
      capabilities: ["settings.read", "bridge.emit", "invoke.agent"],
    });
    const again = await backendFor({ runtime, agent });
    await again.handle("listExtensions" as never, []);
    const grown = (await again.handle("getCapabilityGrant" as never, ["quota"])) as { needsConfirmation: boolean };
    expect(grown.needsConfirmation).toBe(true);
    await again.close();
  });

  it("refuses L2 capabilities and does not persist a grant", async () => {
    await tempRoot("pipi-ext-grant-l2-");
    const agent = join(root, "agent");
    const runtime = join(root, "runtime");
    await writeManifest(join(agent, "extensions", "evil"), {
      id: "evil",
      name: "Evil",
      version: "1.0.0",
      capabilities: ["host.main"],
    });
    const backend = await backendFor({ runtime, agent });
    await backend.handle("listExtensions" as never, []);
    const grant = (await backend.handle("getCapabilityGrant" as never, ["evil"])) as {
      refused: boolean;
      refusedCapabilities: string[];
    };
    expect(grant.refused).toBe(true);
    expect(grant.refusedCapabilities).toContain("host.main");
    const confirmed = (await backend.handle("confirmCapabilityGrant" as never, ["evil", ["host.main"]])) as {
      refused: boolean;
    };
    expect(confirmed.refused).toBe(true);
    const settings = JSON.parse(await readFile(join(agent, "pipiui-settings.json"), "utf8").catch(() => "{}"));
    expect(settings.extensions?.evil?.grantedCapabilities).toBeUndefined();
    await backend.close();
  });

  it("lets a project grant overlay the App grant", async () => {
    await tempRoot("pipi-ext-grant-project-");
    const agent = join(root, "agent");
    const runtime = join(root, "runtime");
    const project = join(root, "repo");
    await mkdir(project, { recursive: true });
    await writeManifest(join(agent, "extensions", "quota"), {
      id: "quota",
      name: "Quota",
      version: "1.0.0",
      capabilities: ["settings.read"],
    });
    const backend = await backendFor({ runtime, agent });
    const added = (await backend.handle("addProject", [project])) as { id: string };
    await backend.handle("confirmCapabilityGrant" as never, ["quota", ["settings.read"]]);
    await backend.handle("confirmCapabilityGrant" as never, ["quota", ["settings.read", "bridge.emit"], added.id]);
    const appGrant = (await backend.handle("getCapabilityGrant" as never, ["quota"])) as {
      grantedCapabilities: string[];
    };
    const projectGrant = (await backend.handle("getCapabilityGrant" as never, ["quota", added.id])) as {
      grantedCapabilities: string[];
    };
    expect(appGrant.grantedCapabilities).toEqual(["settings.read"]);
    expect(projectGrant.grantedCapabilities).toEqual(["settings.read", "bridge.emit"]);
    await backend.close();
  });

  it("treats builtins as pre-trusted", () => {
    expect(
      evaluateCapabilityGrant({
        id: "pi-ext",
        origin: "builtin",
        declared: ["bridge.emit"],
      }).needsConfirmation,
    ).toBe(false);
  });
});

describe("secret settings end-to-end", () => {
  it("stores format:secret only in the vault; JSON and get expose existence", async () => {
    await tempRoot("pipi-ext-secret-e2e-");
    const agent = join(root, "agent");
    const runtime = join(root, "runtime");
    const project = join(root, "repo");
    await mkdir(project, { recursive: true });
    await writeManifest(join(agent, "extensions", "quota"), {
      id: "quota",
      name: "Quota",
      version: "1.0.0",
      capabilities: ["settings.read", "settings.write"],
      settingsVersion: 1,
      app: {
        settings: {
          scope: "app",
          schema: {
            type: "object",
            properties: {
              "ext.quota.threshold": { type: "number" },
              "ext.quota.token": { type: "string", format: "secret" },
            },
          },
        },
      },
    });
    await writeManifest(join(projectPiAgentDir(project), "extensions", "quotap"), {
      id: "quotap",
      name: "Quota Project",
      version: "1.0.0",
      capabilities: ["settings.read", "settings.write"],
      settingsVersion: 1,
      app: {
        settings: {
          scope: "project",
          schema: {
            type: "object",
            properties: {
              "ext.quotap.token": { type: "string", format: "secret" },
            },
          },
        },
      },
    });
    const backend = await backendFor({ runtime, agent });
    await backend.handle("listExtensions" as never, []);
    const secret = "s3cret-token-value";
    const updated = (await backend.handle("updateExtensionSettings" as never, [
      "quota",
      { "ext.quota.threshold": 90, "ext.quota.token": secret },
    ])) as { ok: boolean; data?: Record<string, unknown> };
    expect(updated).toEqual({ ok: true, data: { "ext.quota.threshold": 90 } });
    const appJson = await readFile(join(agent, "pipiui-settings.json"), "utf8");
    expect(appJson).not.toContain(secret);
    expect(JSON.parse(appJson).extensions.quota.settings).toEqual({ "ext.quota.threshold": 90 });
    const got = (await backend.handle("getExtensionSettings" as never, ["quota"])) as Record<string, unknown>;
    expect(got).toEqual({ "ext.quota.threshold": 90, "ext.quota.token": true });
    expect(JSON.stringify(got)).not.toContain(secret);
    expect(listSecretMeta(agent)).toEqual([expect.objectContaining({ name: "ext.quota.token" })]);

    const added = (await backend.handle("addProject", [project])) as { id: string };
    await backend.handle("listExtensions" as never, [added.id]);
    const projectSecret = "proj-secret-value";
    const projectUpdated = (await backend.handle("updateExtensionSettings" as never, [
      "quotap",
      { "ext.quotap.token": projectSecret },
      added.id,
    ])) as { ok: boolean; data?: Record<string, unknown> };
    expect(projectUpdated).toEqual({ ok: true, data: {} });
    const projectDisk = await readFile(projectExtensionSettingsPath(projectPiAgentDir(project), "quotap"), "utf8");
    expect(projectDisk).not.toContain(projectSecret);
    const projectGot = (await backend.handle("getExtensionSettings" as never, ["quotap", added.id])) as Record<
      string,
      unknown
    >;
    expect(projectGot).toEqual({ "ext.quotap.token": true });
    expect(JSON.stringify(projectGot)).not.toContain(projectSecret);
    await backend.close();
  });
});
