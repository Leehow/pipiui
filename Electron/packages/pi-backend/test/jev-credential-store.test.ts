import { existsSync, readFileSync, realpathSync, writeFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPiHostBackend } from "../src/index.js";
import {
  JEV_CREDENTIAL_READ_FAILED,
  JevCredentialStore,
  jevCredentialPath,
} from "../src/jev-credential-store.js";
import {
  JEV_BROWSER_ENABLED_KEY,
  JEV_EXTENSION_ID,
  JEV_SECRET_ENV,
  JEV_SECRET_KEY,
  jevRuntimeStateFile,
  type JevRuntimeState,
} from "../src/jev-runtime-state.js";
import { listSecretMeta, resetInMemoryVault } from "../src/secret-vault.js";
import { assemblePiSpawn, type SpawnRegisteredExtension } from "../src/spawn-assembly.js";

const KEY_A = "jev-fake-key-aaaa";
const KEY_B = "jev-fake-key-bbbb";

const roots: string[] = [];
const backends: ReturnType<typeof createPiHostBackend>[] = [];
afterEach(async () => {
  for (const backend of backends.splice(0)) await backend.close().catch(() => undefined);
  resetInMemoryVault();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
});

async function temporary() {
  const root = realpathSync(await mkdtemp(join(tmpdir(), "jev-cred-")));
  roots.push(root);
  return root;
}

type Probe = { registeredExtensionsForSpawn(root: string): Promise<SpawnRegisteredExtension[]> };

async function hostFixture() {
  const root = await temporary();
  const runtimeRoot = join(root, "runtime");
  const extensionRoot = join(runtimeRoot, "extensions", JEV_EXTENSION_ID);
  await mkdir(join(extensionRoot, "agent"), { recursive: true });
  await writeFile(join(extensionRoot, "agent", "index.js"), "export default () => {};\n");
  await writeFile(join(extensionRoot, "pipiui-extension.json"), JSON.stringify({
    id: JEV_EXTENSION_ID, name: "Jev", version: "1.0.0", defaultEnabled: false, settingsVersion: 1, migrations: [],
    capabilities: ["settings.read", "settings.write"], agent: { extension: "agent/index.js" },
    app: { settings: { scope: "project", schema: { type: "object", properties: {
      [JEV_SECRET_KEY]: { type: "string", format: "secret" },
      [JEV_BROWSER_ENABLED_KEY]: { type: "boolean" },
    } } } },
  }));
  const agentDir = join(root, "host-agent");
  await mkdir(agentDir);
  const options = {
    agentDir,
    vaultDir: agentDir,
    runtimeRoot,
    profileMode: "isolated" as const,
    canonicalProjectPaths: async () => undefined,
  };
  const backend = createPiHostBackend(options);
  backends.push(backend);
  async function addProject(name: string) {
    const path = join(root, name);
    await mkdir(path);
    const { id } = await backend.handle("addProject", [path]) as { id: string };
    return { path, id };
  }
  const a = await addProject("a");
  const b = await addProject("b");
  const probe = backend as unknown as Probe;
  return {
    root, agentDir, runtimeRoot, options, backend, probe, a, b,
    recreate() {
      const next = createPiHostBackend(options);
      backends.push(next);
      return next;
    },
  };
}

describe("JevCredentialStore", () => {
  it("persists across store instances without OS services and restricts POSIX permissions", async () => {
    const root = await temporary();
    await new JevCredentialStore().write(root, KEY_A);
    expect(await new JevCredentialStore().read(root)).toBe(KEY_A);
    if (process.platform !== "win32") expect(statSync(jevCredentialPath(root)).mode & 0o777).toBe(0o600);
  });
  it("canonicalizes symlink paths", async () => {
    const root = await temporary();
    const target = join(root, "target");
    await mkdir(target);
    const alias = join(root, "alias");
    await symlink(target, alias, "junction");
    await new JevCredentialStore().write(alias, KEY_A);
    expect(jevCredentialPath(alias)).toBe(jevCredentialPath(target));
    expect(await new JevCredentialStore().read(target)).toBe(KEY_A);
  });
  it("ignores legacy ciphertext before save and after clear without OS access", async () => {
    const root = await temporary();
    const file = jevCredentialPath(root);
    await mkdir(dirname(file), { recursive: true });
    const legacy = join(dirname(file), "credential.enc");
    writeFileSync(legacy, "legacy-ciphertext");
    const store = new JevCredentialStore();
    expect(await store.read(root)).toBeUndefined();
    await store.write(root, KEY_A);
    expect(await store.read(root)).toBe(KEY_A);
    await store.clear(root);
    expect(await store.read(root)).toBeUndefined();
    expect(readFileSync(legacy, "utf8")).toBe("legacy-ciphertext");
  });
  it("redacts corrupt data errors, preserves it on read and permits replacement", async () => {
    const root = await temporary();
    const store = new JevCredentialStore();
    await store.write(root, KEY_A);
    const file = jevCredentialPath(root);
    writeFileSync(file, KEY_A);
    await expect(store.read(root)).rejects.toThrow(JEV_CREDENTIAL_READ_FAILED);
    expect(readFileSync(file, "utf8")).toBe(KEY_A);
    await expect(store.write(root, "short")).rejects.toThrow();
    expect(readFileSync(file, "utf8")).toBe(KEY_A);
    await store.write(root, KEY_B);
    expect(await store.read(root)).toBe(KEY_B);
    const blocked = join(root, "file");
    writeFileSync(blocked, "x");
    await expect(store.write(blocked, KEY_A)).rejects.toThrow();
  });
});

describe("Jev extension credential persistence via host backend", () => {
  it("restores presence and spawn env after resetInMemoryVault and backend rebuild", async () => {
    const { agentDir, a, backend, probe, recreate } = await hostFixture();
    await backend.handle("setExtensionEnabled" as never, [JEV_EXTENSION_ID, true, "project", a.id]);
    const saved = await backend.handle("updateExtensionSettings" as never, [
      JEV_EXTENSION_ID, { [JEV_SECRET_KEY]: KEY_A }, a.id,
    ]) as { ok: boolean; data?: Record<string, unknown> };
    expect(saved.ok).toBe(true);
    expect(JSON.stringify(saved)).not.toContain(KEY_A);
    const file = jevCredentialPath(a.path);
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8")).apiKey).toBe(KEY_A);
    expect(existsSync(join(agentDir, "secret-vault.json"))).toBe(false);

    const first = await probe.registeredExtensionsForSpawn(a.path);
    const spawned = assemblePiSpawn({ cwd: a.path, paths: {}, registeredExtensions: first });
    expect(spawned.env[JEV_SECRET_ENV]).toBe(KEY_A);

    resetInMemoryVault();
    await backend.close();
    const restarted = recreate();
    const got = await restarted.handle("getExtensionSettings" as never, [JEV_EXTENSION_ID, a.id]) as Record<string, unknown>;
    expect(got[JEV_SECRET_KEY]).toBe(true);
    expect(got[JEV_SECRET_KEY]).not.toBe(KEY_A);
    expect(JSON.stringify(got)).not.toContain(KEY_A);

    await restarted.handle("setExtensionEnabled" as never, [JEV_EXTENSION_ID, true, "project", a.id]);
    const again = await (restarted as unknown as Probe).registeredExtensionsForSpawn(a.path);
    const remounted = assemblePiSpawn({ cwd: a.path, paths: {}, registeredExtensions: again });
    expect(remounted.env[JEV_SECRET_ENV]).toBe(KEY_A);
    const state = JSON.parse(readFileSync(jevRuntimeStateFile(a.path), "utf8")) as JevRuntimeState;
    expect(state.hasKey).toBe(true);
    expect(listSecretMeta(agentDir).find((item) => item.name === JEV_SECRET_KEY)).toBeUndefined();
  });

  it("replaces the durable value, isolates A/B, and does not resurrect after clear", async () => {
    const { agentDir, a, b, backend, recreate } = await hostFixture();
    await backend.handle("setExtensionEnabled" as never, [JEV_EXTENSION_ID, true, "project", a.id]);
    await backend.handle("setExtensionEnabled" as never, [JEV_EXTENSION_ID, true, "project", b.id]);
    expect((await backend.handle("updateExtensionSettings" as never, [
      JEV_EXTENSION_ID, { [JEV_SECRET_KEY]: KEY_A }, a.id,
    ]) as { ok: boolean }).ok).toBe(true);
    expect((await backend.handle("updateExtensionSettings" as never, [
      JEV_EXTENSION_ID, { [JEV_SECRET_KEY]: KEY_B, [JEV_BROWSER_ENABLED_KEY]: true }, a.id,
    ]) as { ok: boolean }).ok).toBe(true);

    const blobA = readFileSync(jevCredentialPath(a.path));
    expect(blobA.includes(KEY_A)).toBe(false);
    expect(JSON.parse(blobA.toString("utf8")).apiKey).toBe(KEY_B);
    expect(existsSync(jevCredentialPath(b.path))).toBe(false);

    resetInMemoryVault();
    await backend.close();
    const restarted = recreate();
    await restarted.handle("setExtensionEnabled" as never, [JEV_EXTENSION_ID, true, "project", a.id]);
    await restarted.handle("setExtensionEnabled" as never, [JEV_EXTENSION_ID, true, "project", b.id]);
    const packagesA = await (restarted as unknown as Probe).registeredExtensionsForSpawn(a.path);
    const packagesB = await (restarted as unknown as Probe).registeredExtensionsForSpawn(b.path);
    expect(assemblePiSpawn({ cwd: a.path, paths: {}, registeredExtensions: packagesA }).env[JEV_SECRET_ENV]).toBe(KEY_B);
    expect(assemblePiSpawn({ cwd: b.path, paths: {}, registeredExtensions: packagesB }).env[JEV_SECRET_ENV]).toBeUndefined();
    const settingsA = await restarted.handle("getExtensionSettings" as never, [JEV_EXTENSION_ID, a.id]) as Record<string, unknown>;
    const settingsB = await restarted.handle("getExtensionSettings" as never, [JEV_EXTENSION_ID, b.id]) as Record<string, unknown>;
    expect(settingsA).toMatchObject({ [JEV_SECRET_KEY]: true, [JEV_BROWSER_ENABLED_KEY]: true });
    expect(settingsB[JEV_SECRET_KEY]).toBeUndefined();
    expect(JSON.stringify([settingsA, settingsB])).not.toContain(KEY_A);
    expect(JSON.stringify([settingsA, settingsB])).not.toContain(KEY_B);

    expect((await restarted.handle("updateExtensionSettings" as never, [
      JEV_EXTENSION_ID, { [JEV_SECRET_KEY]: null }, a.id,
    ]) as { ok: boolean }).ok).toBe(true);
    expect(existsSync(jevCredentialPath(a.path))).toBe(false);
    resetInMemoryVault();
    await restarted.close();
    const afterClear = recreate();
    const cleared = await afterClear.handle("getExtensionSettings" as never, [JEV_EXTENSION_ID, a.id]) as Record<string, unknown>;
    expect(cleared[JEV_SECRET_KEY]).toBeUndefined();
    expect(cleared[JEV_BROWSER_ENABLED_KEY]).toBe(true);
    await afterClear.handle("setExtensionEnabled" as never, [JEV_EXTENSION_ID, true, "project", a.id]);
    const clearedSpawn = await (afterClear as unknown as Probe).registeredExtensionsForSpawn(a.path);
    expect(assemblePiSpawn({ cwd: a.path, paths: {}, registeredExtensions: clearedSpawn }).env[JEV_SECRET_ENV]).toBeUndefined();
    expect(existsSync(join(agentDir, "secret-vault.json"))).toBe(false);
  });

  it("reports a disk failure without replacing the cached credential", async () => {
    const { a, backend, probe } = await hostFixture();
    await backend.handle("setExtensionEnabled" as never, [JEV_EXTENSION_ID, true, "project", a.id]);
    expect((await backend.handle("updateExtensionSettings" as never, [
      JEV_EXTENSION_ID, { [JEV_SECRET_KEY]: KEY_A }, a.id,
    ]) as { ok: boolean }).ok).toBe(true);
    const file = jevCredentialPath(a.path);
    await rm(file);
    await mkdir(file);
    const refused = await backend.handle("updateExtensionSettings" as never, [
      JEV_EXTENSION_ID, { [JEV_SECRET_KEY]: KEY_B }, a.id,
    ]) as { ok: boolean };
    expect(refused.ok).toBe(false);
    expect(JSON.stringify(refused)).not.toContain(KEY_B);
    const extensions = await probe.registeredExtensionsForSpawn(a.path);
    expect(assemblePiSpawn({ cwd: a.path, paths: {}, registeredExtensions: extensions }).env[JEV_SECRET_ENV]).toBe(KEY_A);
  });
});
