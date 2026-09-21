import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPiHostBackend } from "../src/index.js";
import {
  EXTENSION_SECRET_ENCRYPTION_UNAVAILABLE,
  JEV_CREDENTIAL_DECRYPT_FAILED,
  JevCredentialStore,
  jevCredentialCipherPath,
  type ExtensionSecretCipher,
} from "../src/jev-credential-store.js";
import {
  JEV_BROWSER_ENABLED_KEY,
  JEV_EXTENSION_ID,
  JEV_SECRET_ENV,
  JEV_SECRET_KEY,
  jevRuntimeStateFile,
  type JevRuntimeState,
} from "../src/jev-runtime-state.js";
import { projectPiAgentDir } from "../src/project-pi-home.js";
import { listSecretMeta, resetInMemoryVault } from "../src/secret-vault.js";
import { assemblePiSpawn, type SpawnRegisteredExtension } from "../src/spawn-assembly.js";

const KEY_A = "jev-fake-key-aaaa";
const KEY_B = "jev-fake-key-bbbb";

function xorCipher(mask = 0x5a): ExtensionSecretCipher {
  const transform = (input: Buffer) => Buffer.from(input.map((byte) => byte ^ mask));
  const magic = Buffer.from("J1");
  return {
    encrypt: (plaintext) => transform(Buffer.concat([magic, Buffer.from(plaintext, "utf8")])),
    decrypt: (ciphertext) => {
      const out = transform(ciphertext);
      if (out.length < magic.length || out.subarray(0, magic.length).toString("utf8") !== "J1") {
        throw new Error("cipher decrypt refused");
      }
      return out.subarray(magic.length).toString("utf8");
    },
  };
}

function failingEncryptCipher(inner: ExtensionSecretCipher): ExtensionSecretCipher {
  return {
    encrypt: () => {
      throw new Error(EXTENSION_SECRET_ENCRYPTION_UNAVAILABLE);
    },
    decrypt: (ciphertext) => inner.decrypt(ciphertext),
  };
}

function failingDecryptCipher(inner: ExtensionSecretCipher): ExtensionSecretCipher {
  return {
    encrypt: (plaintext) => inner.encrypt(plaintext),
    decrypt: () => {
      throw new Error("cipher decrypt refused");
    },
  };
}

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

async function hostFixture(cipher?: ExtensionSecretCipher) {
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
    extensionSecretCipher: cipher,
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
    recreate(nextCipher: ExtensionSecretCipher | undefined = cipher) {
      const next = createPiHostBackend({ ...options, extensionSecretCipher: nextCipher });
      backends.push(next);
      return next;
    },
  };
}

describe("JevCredentialStore", () => {
  it("round-trips through ciphertext that does not contain the plaintext key", async () => {
    const root = await temporary();
    const store = new JevCredentialStore(xorCipher());
    await store.write(root, KEY_A);
    const file = jevCredentialCipherPath(root);
    const blob = readFileSync(file);
    expect(blob.includes(KEY_A)).toBe(false);
    expect(blob.toString("utf8")).not.toContain(KEY_A);
    expect(await store.read(root)).toBe(KEY_A);
  });

  it("isolates project A from B and canonicalizes symlink paths", async () => {
    const root = await temporary();
    const realA = join(root, "real-a");
    const realB = join(root, "real-b");
    await mkdir(realA);
    await mkdir(realB);
    const aliasA = join(root, "alias-a");
    await symlink(realA, aliasA);
    const store = new JevCredentialStore(xorCipher());
    await store.write(aliasA, KEY_A);
    await store.write(realB, KEY_B);
    expect(jevCredentialCipherPath(aliasA)).toBe(jevCredentialCipherPath(realA));
    expect(jevCredentialCipherPath(realA)).not.toBe(jevCredentialCipherPath(realB));
    expect(await store.read(realA)).toBe(KEY_A);
    expect(await store.read(aliasA)).toBe(KEY_A);
    expect(await store.read(realB)).toBe(KEY_B);
  });

  it("reads nothing without a cipher when no ciphertext exists, and does not overwrite on decrypt failure", async () => {
    const root = await temporary();
    const empty = new JevCredentialStore();
    await expect(empty.read(root)).resolves.toBeUndefined();
    const store = new JevCredentialStore(xorCipher());
    await store.write(root, KEY_A);
    const file = jevCredentialCipherPath(root);
    const before = readFileSync(file);
    writeFileSync(file, Buffer.from("not-a-valid-ciphertext"));
    const garbage = readFileSync(file);
    await expect(store.read(root)).rejects.toThrow(JEV_CREDENTIAL_DECRYPT_FAILED);
    expect(readFileSync(file).equals(garbage)).toBe(true);
    expect(readFileSync(file).equals(before)).toBe(false);
  });

  it("does not replace existing ciphertext when encrypt or write fails", async () => {
    const root = await temporary();
    const store = new JevCredentialStore(xorCipher());
    await store.write(root, KEY_A);
    const file = jevCredentialCipherPath(root);
    const before = readFileSync(file);
    const unavailable = new JevCredentialStore(failingEncryptCipher(xorCipher()));
    await expect(unavailable.write(root, KEY_B)).rejects.toThrow(EXTENSION_SECRET_ENCRYPTION_UNAVAILABLE);
    expect(readFileSync(file).equals(before)).toBe(true);
    expect(await store.read(root)).toBe(KEY_A);

    const blockedRoot = join(root, "not-a-project-dir");
    writeFileSync(blockedRoot, "x");
    await expect(store.write(blockedRoot, KEY_B)).rejects.toThrow();
    expect(readFileSync(file).equals(before)).toBe(true);
    expect(await store.read(root)).toBe(KEY_A);
  });

  it("clear removes the blob; a store without a cipher still cannot fake a write", async () => {
    const root = await temporary();
    const store = new JevCredentialStore(xorCipher());
    await store.write(root, KEY_A);
    await store.clear(root);
    expect(existsSync(jevCredentialCipherPath(root))).toBe(false);
    await expect(store.read(root)).resolves.toBeUndefined();
    const memoryOnly = new JevCredentialStore();
    await expect(memoryOnly.write(root, KEY_A)).rejects.toThrow(EXTENSION_SECRET_ENCRYPTION_UNAVAILABLE);
    expect(existsSync(jevCredentialCipherPath(root))).toBe(false);
  });
});

describe("Jev extension credential persistence via host backend", () => {
  it("restores presence and spawn env after resetInMemoryVault and backend rebuild", async () => {
    const cipher = xorCipher();
    const { agentDir, a, backend, probe, recreate } = await hostFixture(cipher);
    await backend.handle("setExtensionEnabled" as never, [JEV_EXTENSION_ID, true, "project", a.id]);
    const saved = await backend.handle("updateExtensionSettings" as never, [
      JEV_EXTENSION_ID, { [JEV_SECRET_KEY]: KEY_A }, a.id,
    ]) as { ok: boolean; data?: Record<string, unknown> };
    expect(saved.ok).toBe(true);
    expect(JSON.stringify(saved)).not.toContain(KEY_A);
    const file = jevCredentialCipherPath(a.path);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file).includes(KEY_A)).toBe(false);
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
    const cipher = xorCipher();
    const { agentDir, a, b, backend, recreate } = await hostFixture(cipher);
    await backend.handle("setExtensionEnabled" as never, [JEV_EXTENSION_ID, true, "project", a.id]);
    await backend.handle("setExtensionEnabled" as never, [JEV_EXTENSION_ID, true, "project", b.id]);
    expect((await backend.handle("updateExtensionSettings" as never, [
      JEV_EXTENSION_ID, { [JEV_SECRET_KEY]: KEY_A }, a.id,
    ]) as { ok: boolean }).ok).toBe(true);
    expect((await backend.handle("updateExtensionSettings" as never, [
      JEV_EXTENSION_ID, { [JEV_SECRET_KEY]: KEY_B, [JEV_BROWSER_ENABLED_KEY]: true }, a.id,
    ]) as { ok: boolean }).ok).toBe(true);

    const blobA = readFileSync(jevCredentialCipherPath(a.path));
    expect(blobA.includes(KEY_A)).toBe(false);
    expect(blobA.includes(KEY_B)).toBe(false);
    expect(existsSync(jevCredentialCipherPath(b.path))).toBe(false);

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
    expect(existsSync(jevCredentialCipherPath(a.path))).toBe(false);
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

  it("does not pollute the old key when cipher is unavailable, decrypt fails, or write fails", async () => {
    const good = xorCipher();
    const { a, backend, recreate } = await hostFixture(good);
    expect((await backend.handle("updateExtensionSettings" as never, [
      JEV_EXTENSION_ID, { [JEV_SECRET_KEY]: KEY_A }, a.id,
    ]) as { ok: boolean }).ok).toBe(true);
    const file = jevCredentialCipherPath(a.path);
    const before = readFileSync(file);

    resetInMemoryVault();
    await backend.close();
    const blocked = recreate(failingEncryptCipher(good));
    const refused = await blocked.handle("updateExtensionSettings" as never, [
      JEV_EXTENSION_ID, { [JEV_SECRET_KEY]: KEY_B }, a.id,
    ]) as { ok: boolean; error?: { message?: string } };
    expect(refused.ok).toBe(false);
    expect(refused.error?.message).toContain("系统加密不可用");
    expect(readFileSync(file).equals(before)).toBe(true);
    const presenceWhileBlocked = await blocked.handle("getExtensionSettings" as never, [JEV_EXTENSION_ID, a.id]) as Record<string, unknown>;
    expect(presenceWhileBlocked[JEV_SECRET_KEY]).toBe(true);
    expect(JSON.stringify(presenceWhileBlocked)).not.toContain(KEY_B);

    resetInMemoryVault();
    await blocked.close();
    writeFileSync(file, Buffer.from("corrupt-jev-ciphertext"));
    const corrupt = readFileSync(file);
    const unread = recreate(failingDecryptCipher(failingEncryptCipher(good)));
    await expect(unread.handle("getExtensionSettings" as never, [JEV_EXTENSION_ID, a.id]))
      .rejects.toThrow(JEV_CREDENTIAL_DECRYPT_FAILED);
    expect(readFileSync(file).equals(corrupt)).toBe(true);
    const overwrite = await unread.handle("updateExtensionSettings" as never, [
      JEV_EXTENSION_ID, { [JEV_SECRET_KEY]: KEY_B }, a.id,
    ]) as { ok: boolean; error?: { message?: string } };
    expect(overwrite.ok).toBe(false);
    expect(readFileSync(file).equals(corrupt)).toBe(true);

    resetInMemoryVault();
    await unread.close();
    writeFileSync(file, before);
    const restored = recreate(good);
    await restored.handle("setExtensionEnabled" as never, [JEV_EXTENSION_ID, true, "project", a.id]);
    const packages = await (restored as unknown as Probe).registeredExtensionsForSpawn(a.path);
    expect(assemblePiSpawn({ cwd: a.path, paths: {}, registeredExtensions: packages }).env[JEV_SECRET_ENV]).toBe(KEY_A);
  });

  it("starts and reads Jev settings without a cipher when no key is stored, and keeps the tool vault off disk", async () => {
    const { agentDir, a, backend } = await hostFixture();
    const got = await backend.handle("getExtensionSettings" as never, [JEV_EXTENSION_ID, a.id]) as Record<string, unknown>;
    expect(got[JEV_SECRET_KEY]).toBeUndefined();
    const memorySave = await backend.handle("updateExtensionSettings" as never, [
      JEV_EXTENSION_ID, { [JEV_SECRET_KEY]: KEY_A }, a.id,
    ]) as { ok: boolean };
    expect(memorySave.ok).toBe(false);
    expect(existsSync(jevCredentialCipherPath(a.path))).toBe(false);
    expect((await backend.handle("getExtensionSettings" as never, [JEV_EXTENSION_ID, a.id]) as Record<string, unknown>)[JEV_SECRET_KEY]).toBeUndefined();
    expect(existsSync(join(agentDir, "secret-vault.json"))).toBe(false);
    expect(existsSync(join(projectPiAgentDir(a.path), "secret-vault.json"))).toBe(false);

    resetInMemoryVault();
    await backend.close();
    const restarted = createPiHostBackend({
      agentDir,
      vaultDir: agentDir,
      runtimeRoot: join(dirname(agentDir), "runtime"),
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
    });
    backends.push(restarted);
    const after = await restarted.handle("getExtensionSettings" as never, [JEV_EXTENSION_ID, a.id]) as Record<string, unknown>;
    expect(after[JEV_SECRET_KEY]).toBeUndefined();
  });
});
