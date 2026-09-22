import { afterEach, describe, expect, it, vi } from "vitest";
import { closeSync, existsSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiHostBackend } from "../src/index.js";
import { projectPiAgentDir } from "../src/project-pi-home.js";
import { resetInMemoryVault } from "../src/secret-vault.js";
import * as extensionSettings from "../src/extension-settings.js";
import {
  JEV_CONTEXT_ENABLED_KEY, JEV_BROWSER_ENABLED_KEY, JEV_EXTENSION_ID, JEV_GENERATION_ENV, JEV_SECRET_ENV, JEV_SECRET_KEY, JEV_STATE_FILE_ENV,
  JevRuntimeStateStore, jevRuntimeStateFile, type JevRuntimeState,
} from "../src/jev-runtime-state.js";
import { assemblePiSpawn, mergedSpawnEnvironment, workerRegisteredExtensionArgs, type SpawnRegisteredExtension } from "../src/spawn-assembly.js";

const roots: string[] = [];
const backends: ReturnType<typeof createPiHostBackend>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const backend of backends.splice(0)) await backend.close();
  resetInMemoryVault();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
});
async function temporary() {
  const root = realpathSync(await mkdtemp(join(tmpdir(), "jev-host-")));
  roots.push(root);
  return root;
}
const state = (root: string): JevRuntimeState => JSON.parse(readFileSync(jevRuntimeStateFile(root), "utf8"));
type Probe = { registeredExtensionsForSpawn(root: string): Promise<SpawnRegisteredExtension[]> };

async function fixture(scope: "project" | "app" = "project") {
  const root = await temporary();
  const runtimeRoot = join(root, "runtime");
  const extensionRoot = join(runtimeRoot, "extensions", JEV_EXTENSION_ID);
  await mkdir(join(extensionRoot, "agent"), { recursive: true });
  await writeFile(join(extensionRoot, "agent", "index.js"), "export default () => {};\n");
  await writeFile(join(extensionRoot, "pipiui-extension.json"), JSON.stringify({
    id: JEV_EXTENSION_ID, name: "Jev", version: "1.0.0", defaultEnabled: false, settingsVersion: 1, migrations: [],
    capabilities: ["settings.read", "settings.write"], agent: { extension: "agent/index.js" },
    app: { settings: { scope, schema: { type: "object", properties: {
      [JEV_SECRET_KEY]: { type: "string", format: "secret" },
      [JEV_BROWSER_ENABLED_KEY]: { type: "boolean" },
      [JEV_CONTEXT_ENABLED_KEY]: { type: "boolean" },
    } } } },
  }));
  const agentDir = join(root, "host-agent");
  await mkdir(agentDir);
  const backend = createPiHostBackend({
    agentDir, vaultDir: agentDir, runtimeRoot, profileMode: "isolated", canonicalProjectPaths: async () => undefined,
    // Test-only cipher; production uses Electron OS encryption, never a RAM success fallback.
    extensionSecretCipher: {
      encrypt: value => Buffer.from(value, 'utf8').map(byte => byte ^ 0x5a),
      decrypt: bytes => Buffer.from(bytes.map(byte => byte ^ 0x5a)).toString('utf8'),
    },
  });
  backends.push(backend);
  const probe = backend as unknown as Probe;
  async function addProject(name: string) {
    const path = join(root, name);
    await mkdir(path);
    const { id } = await backend.handle("addProject", [path]) as { id: string };
    return { path, id };
  }
  const a = await addProject("a");
  const b = await addProject("b");
  const unopened = join(root, "unopened");
  await mkdir(unopened);
  const enable = (id: string, value: boolean) => backend.handle("setExtensionEnabled" as never, [JEV_EXTENSION_ID, value, "project", id]);
  const key = (id: string, value: string | null) => backend.handle("updateExtensionSettings" as never, [JEV_EXTENSION_ID, { [JEV_SECRET_KEY]: value }, id]);
  const browser = (id: string, value: boolean) => backend.handle("updateExtensionSettings" as never, [JEV_EXTENSION_ID, { [JEV_BROWSER_ENABLED_KEY]: value }, id]);
  const context = (id: string, value: boolean) => backend.handle("updateExtensionSettings" as never, [JEV_EXTENSION_ID, { [JEV_CONTEXT_ENABLED_KEY]: value }, id]);
  async function spawn(path: string) {
    const packages = await probe.registeredExtensionsForSpawn(path);
    return { packages, ...assemblePiSpawn({ cwd: path, paths: {}, registeredExtensions: packages }) };
  }
  return { backend, probe, a, b, unopened, enable, key, browser, context, spawn, agentDir };
}

describe("Jev host state projection", () => {
  it("projects context selection settings to new sessions and revokes without disabling browser or retrieval", async () => {
    const f = await fixture();
    await f.enable(f.a.id, true); await f.key(f.a.id, "context-test-key");
    await f.browser(f.a.id, true); await f.context(f.a.id, true);
    const on = await f.spawn(f.a.path);
    expect(state(f.a.path)).toMatchObject({ enabled: true, hasKey: true, browserEnabled: true, contextEnabled: true });
    expect(JSON.parse(on.env.PIPIUI_EXT_SETTINGS_JEV_OPTIMIZER)).toMatchObject({ [JEV_CONTEXT_ENABLED_KEY]: true });
    const generation = state(f.a.path).generation;
    await f.context(f.a.id, false);
    expect(state(f.a.path).contextEnabled).not.toBe(true);
    expect(state(f.a.path)).toMatchObject({ enabled: true, hasKey: true, browserEnabled: true, generation });
  });
  it("atomically replaces complete nonsecret state and rotates only on authority changes", async () => {
    const root = await temporary();
    const store = new JevRuntimeStateStore();
    const first = store.ensure(root, { enabled: true, hasKey: true });
    const firstState = state(root);
    expect(firstState).toMatchObject({ schemaVersion: 1, enabled: true, hasKey: true, browserEnabled: false, generation: first.generation });
    expect(firstState.browserGeneration).toEqual(expect.any(String));
    expect(firstState.browserGeneration.length).toBeGreaterThan(0);
    const fd = openSync(first.file, "r");
    try {
      expect(store.ensure(root, { enabled: true, hasKey: true })).toEqual(first);
      store.revoke(root);
      const revoked = state(root);
      expect(revoked).toMatchObject({ schemaVersion: 1, enabled: false, hasKey: true, browserEnabled: false });
      expect(revoked.generation).not.toBe(first.generation);
      expect(revoked.browserGeneration).not.toBe(firstState.browserGeneration);
      // An already-open reader still sees its complete old inode, never a truncated write.
      expect(JSON.parse(readFileSync(fd, "utf8"))).toEqual(firstState);
      const again = store.ensure(root, { enabled: true, hasKey: true });
      expect(again.generation).not.toBe(first.generation);
      expect(again.generation).not.toBe(revoked.generation);
      expect(Object.keys(state(root)).sort()).toEqual(["browserEnabled", "browserGeneration", "enabled", "generation", "hasKey", "schemaVersion"]);
      expect(readdirSync(join(projectPiAgentDir(root), JEV_EXTENSION_ID))).toEqual(["runtime-state.json"]);
    } finally { closeSync(fd); }
  });

  it("repairs missing/corrupt files and never adopts a previous host's authority", async () => {
    const root = await temporary();
    const store = new JevRuntimeStateStore();
    const old = store.ensure(root, { enabled: true, hasKey: true });
    writeFileSync(old.file, "broken");
    expect(store.ensure(root, { enabled: true, hasKey: true })).toEqual(old);
    expect(state(root).generation).toBe(old.generation);
    await rm(old.file);
    store.ensure(root, { enabled: true, hasKey: true });
    expect(state(root).generation).toBe(old.generation);
    new JevRuntimeStateStore().ensure(root, { enabled: true, hasKey: false });
    expect(state(root).hasKey).toBe(false);
    expect(state(root).generation).not.toBe(old.generation);
  });

  it("rejects browser when fields are missing and rotates only browserGeneration on browserEnabled", async () => {
    const root = await temporary();
    const store = new JevRuntimeStateStore();
    const first = store.ensure(root, { enabled: true, hasKey: true });
    const initial = state(root);
    expect(initial.browserEnabled).toBe(false);
    writeFileSync(first.file, `${JSON.stringify({ schemaVersion: 1, enabled: true, hasKey: true, generation: first.generation })}\n`);
    const legacy = JSON.parse(readFileSync(first.file, "utf8")) as Partial<JevRuntimeState>;
    expect(legacy.browserEnabled === true).toBe(false);
    expect(legacy.browserGeneration).toBeUndefined();
    expect(legacy).toMatchObject({ enabled: true, hasKey: true, generation: first.generation });
    const repaired = store.ensure(root, { enabled: true, hasKey: true });
    expect(repaired).toEqual(first);
    expect(state(root)).toMatchObject({ enabled: true, hasKey: true, browserEnabled: false, generation: first.generation });
    expect(state(root).browserGeneration).toBe(initial.browserGeneration);
    const enabledBrowser = store.ensure(root, { enabled: true, hasKey: true, browserEnabled: true });
    expect(enabledBrowser).toEqual(first);
    expect(state(root).browserEnabled).toBe(true);
    expect(state(root).browserGeneration).not.toBe(initial.browserGeneration);
    const browserGen = state(root).browserGeneration;
    expect(store.ensure(root, { enabled: true, hasKey: true, browserEnabled: true }).generation).toBe(first.generation);
    expect(state(root).browserGeneration).toBe(browserGen);
    store.ensure(root, { enabled: true, hasKey: true, browserEnabled: false });
    expect(state(root).generation).toBe(first.generation);
    expect(state(root).browserEnabled).toBe(false);
    expect(state(root).browserGeneration).not.toBe(browserGen);
    const alreadyOff = state(root);
    store.revokeBrowser(root);
    expect(state(root)).toEqual(alreadyOff);
    store.ensure(root, { enabled: true, hasKey: true, browserEnabled: true });
    const on = state(root);
    store.revokeBrowser(root);
    expect(state(root)).toMatchObject({ enabled: true, hasKey: true, browserEnabled: false, generation: on.generation });
    expect(state(root).browserGeneration).not.toBe(on.browserGeneration);
    store.revoke(root);
    const revoked = state(root);
    expect(revoked.generation).not.toBe(first.generation);
    expect(revoked.browserGeneration).not.toBe(browserGen);
    expect(revoked.browserEnabled).toBe(false);
    store.ensure(root, { enabled: true, hasKey: false, browserEnabled: true });
    expect(state(root).generation).not.toBe(revoked.generation);
    expect(state(root).browserGeneration).not.toBe(revoked.browserGeneration);
    expect(state(root).browserEnabled).toBe(true);
  });

  it("projects before spawn, delivers only enabled mounts, and revokes old main/worker snapshots", async () => {
    const { a, b, unopened, enable, key, spawn } = await fixture();
    const off = await spawn(a.path);
    expect(off.env[JEV_STATE_FILE_ENV]).toBeUndefined();
    expect(off.env[JEV_GENERATION_ENV]).toBeUndefined();
    expect(off.env[JEV_SECRET_ENV]).toBeUndefined();
    const staleEnv = { [JEV_STATE_FILE_ENV]: "/stale/state", [JEV_GENERATION_ENV]: "old", [JEV_SECRET_ENV]: "jev-stale-key" };
    const sanitized = mergedSpawnEnvironment(staleEnv, staleEnv, off.env);
    expect(sanitized[JEV_STATE_FILE_ENV]).toBeUndefined();
    expect(sanitized[JEV_GENERATION_ENV]).toBeUndefined();
    expect(sanitized[JEV_SECRET_ENV]).toBeUndefined();
    expect(state(a.path)).toMatchObject({ enabled: false, hasKey: false });
    await enable(a.id, true);
    const missing = await spawn(a.path);
    expect(missing.env[JEV_STATE_FILE_ENV]).toBe(jevRuntimeStateFile(a.path));
    expect(missing.env[JEV_SECRET_ENV]).toBeUndefined();
    expect(state(a.path)).toMatchObject({ enabled: true, hasKey: false });
    expect(await key(a.id, "jev-test-secret-a")).toMatchObject({ ok: true });
    const mounted = await spawn(a.path);
    expect(mounted.env[JEV_SECRET_ENV]).toBe("jev-test-secret-a");
    expect(mounted.env[JEV_GENERATION_ENV]).toBe(state(a.path).generation);
    const workerEnv = { ...mounted.env };
    expect(workerRegisteredExtensionArgs(workerEnv)).toEqual(mounted.args.filter((_, i, args) => args[i - 1] === "-e").flatMap(path => ["-e", path]));
    const before = state(a.path).generation;
    await enable(a.id, false);
    expect(state(a.path)).toMatchObject({ enabled: false, hasKey: true });
    expect(state(a.path).generation).not.toBe(before);
    expect(JSON.parse(readFileSync(workerEnv[JEV_STATE_FILE_ENV]!, "utf8")).generation).not.toBe(workerEnv[JEV_GENERATION_ENV]);
    const disabled = await spawn(a.path);
    expect(workerRegisteredExtensionArgs(disabled.env)).toEqual([]);
    expect(disabled.env[JEV_STATE_FILE_ENV]).toBeUndefined();
    expect(disabled.env[JEV_SECRET_ENV]).toBeUndefined();
    await enable(a.id, true);
    const enabled = await spawn(a.path);
    expect(enabled.env[JEV_GENERATION_ENV]).not.toBe(before);
    const other = await spawn(b.path);
    expect(other.env[JEV_SECRET_ENV]).toBeUndefined();
    expect(state(b.path)).toMatchObject({ enabled: false, hasKey: false });
    expect(existsSync(jevRuntimeStateFile(unopened))).toBe(false);
  });

  it("rotates on replacement/clear before touching the vault and serializes a racing spawn", async () => {
    const { a, b, unopened, enable, key, spawn } = await fixture();
    await enable(a.id, true);
    await key(a.id, "jev-test-first-key");
    const first = await spawn(a.path);
    await spawn(b.path);
    const bBefore = state(b.path);
    const put = extensionSettings.putExtensionSecrets;
    let release!: () => void;
    let entered!: () => void;
    const inVault = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(extensionSettings, "putExtensionSecrets").mockImplementationOnce(async (...args) => {
      expect(state(a.path).enabled).toBe(false);
      expect(state(a.path).generation).not.toBe(first.env[JEV_GENERATION_ENV]);
      entered();
      await gate;
      return put(...args);
    });
    const replace = key(a.id, "jev-test-replacement-key");
    await inVault;
    let spawned = false;
    const racing = spawn(a.path).then(value => { spawned = true; return value; });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(spawned).toBe(false);
    release();
    expect(await replace).toMatchObject({ ok: true });
    const next = await racing;
    expect(next.env[JEV_SECRET_ENV]).toBe("jev-test-replacement-key");
    expect(next.env[JEV_GENERATION_ENV]).toBe(state(a.path).generation);
    expect(next.env[JEV_GENERATION_ENV]).not.toBe(first.env[JEV_GENERATION_ENV]);
    expect(state(b.path)).toEqual(bBefore);
    await key(a.id, null);
    expect(state(a.path)).toMatchObject({ enabled: true, hasKey: false });
    expect(state(a.path).generation).not.toBe(next.env[JEV_GENERATION_ENV]);
    expect((await spawn(a.path)).env[JEV_SECRET_ENV]).toBeUndefined();
    const persisted = await readFile(jevRuntimeStateFile(a.path), "utf8") + await readFile(join(projectPiAgentDir(a.path), "ext-settings", `${JEV_EXTENSION_ID}.json`), "utf8");
    expect(persisted).not.toMatch(/jev-test-|apiKey|hash/i);
    expect(existsSync(jevRuntimeStateFile(unopened))).toBe(false);
  });

  it("does not put project keys in another project's enabled mount", async () => {
    const { a, b, enable, key, spawn } = await fixture();
    await enable(a.id, true);
    await enable(b.id, true);
    await key(a.id, "jev-only-project-a");
    expect((await spawn(a.path)).env[JEV_SECRET_ENV]).toBe("jev-only-project-a");
    expect((await spawn(b.path)).env[JEV_SECRET_ENV]).toBeUndefined();
    const before = state(a.path);
    await key(b.id, "jev-only-project-b");
    expect(state(a.path)).toEqual(before);
    expect((await spawn(b.path)).env[JEV_SECRET_ENV]).toBe("jev-only-project-b");
  });

  it("invalidates actual app-scoped credentials across open consumers while preserving per-project enablement", async () => {
    const { a, b, unopened, enable, key, spawn } = await fixture("app");
    await enable(a.id, true);
    await enable(b.id, false);
    await key(a.id, "jev-shared-first");
    const mounted = await spawn(a.path);
    const bBefore = state(b.path);
    expect(state(a.path)).toMatchObject({ enabled: true, hasKey: true });
    expect(bBefore).toMatchObject({ enabled: false, hasKey: true });
    await key(a.id, "jev-shared-replaced");
    expect(state(a.path).generation).not.toBe(mounted.env[JEV_GENERATION_ENV]);
    expect(state(b.path).generation).not.toBe(bBefore.generation);
    expect(state(a.path).enabled).toBe(true);
    expect(state(b.path).enabled).toBe(false);
    await key(b.id, null);
    expect(state(a.path).hasKey).toBe(false);
    expect(state(b.path).hasKey).toBe(false);
    expect(existsSync(jevRuntimeStateFile(unopened))).toBe(false);
  });

  it("projects strict browserEnabled immediately without rotating code generation", async () => {
    const { backend, a, b, enable, key, browser, spawn } = await fixture();
    await enable(a.id, true);
    await key(a.id, "jev-test-secret-a");
    const mounted = await spawn(a.path);
    await spawn(b.path);
    const initial = state(a.path);
    const bBefore = state(b.path);
    expect(initial).toMatchObject({ enabled: true, hasKey: true, browserEnabled: false });
    expect(mounted.env[JEV_GENERATION_ENV]).toBe(initial.generation);
    await expect(backend.handle("updateExtensionSettings" as never, [JEV_EXTENSION_ID, { [JEV_BROWSER_ENABLED_KEY]: 1 }, a.id])).resolves.toMatchObject({ ok: false });
    expect(state(a.path)).toEqual(initial);
    expect(await browser(a.id, true)).toMatchObject({ ok: true });
    expect(state(a.path)).toMatchObject({ enabled: true, hasKey: true, browserEnabled: true, generation: initial.generation });
    expect(state(a.path).browserGeneration).not.toBe(initial.browserGeneration);
    expect(state(b.path)).toEqual(bBefore);
    const onGen = state(a.path).browserGeneration;
    const remounted = await spawn(a.path);
    expect(remounted.env[JEV_GENERATION_ENV]).toBe(initial.generation);
    expect(state(a.path)).toMatchObject({ browserEnabled: true, generation: initial.generation, browserGeneration: onGen });
    expect(await browser(a.id, false)).toMatchObject({ ok: true });
    expect(state(a.path).generation).toBe(initial.generation);
    expect(state(a.path).browserEnabled).toBe(false);
    expect(state(a.path).browserGeneration).not.toBe(onGen);
    expect(await browser(a.id, true)).toMatchObject({ ok: true });
    const authorized = state(a.path);
    await enable(a.id, false);
    expect(state(a.path).generation).not.toBe(authorized.generation);
    expect(state(a.path).browserGeneration).not.toBe(authorized.browserGeneration);
    expect(state(a.path).browserEnabled).toBe(false);
    await enable(a.id, true);
    const reenabled = state(a.path);
    expect(reenabled.browserEnabled).toBe(true);
    expect(reenabled.generation).not.toBe(authorized.generation);
    await key(a.id, "jev-test-replacement-key");
    expect(state(a.path).generation).not.toBe(reenabled.generation);
    expect(state(a.path).browserGeneration).not.toBe(reenabled.browserGeneration);
    expect(state(a.path)).toMatchObject({ enabled: true, hasKey: true, browserEnabled: true });
    await key(a.id, null);
    expect(state(a.path).generation).not.toBe(reenabled.generation);
    expect(state(a.path).hasKey).toBe(false);
    expect(state(a.path).browserEnabled).toBe(true);
    expect(state(b.path)).toEqual(bBefore);
  });

  it("revokes browser before settings I/O without rotating code generation", async () => {
    const { a, enable, key, browser } = await fixture();
    await enable(a.id, true);
    await key(a.id, "jev-test-secret-a");
    expect(await browser(a.id, true)).toMatchObject({ ok: true });
    const authorized = state(a.path);
    expect(authorized.browserEnabled).toBe(true);
    const write = extensionSettings.writeProjectExtensionSettingsValues;
    let release!: () => void;
    let entered!: () => void;
    const inWrite = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(extensionSettings, "writeProjectExtensionSettingsValues").mockImplementationOnce(async (...args) => {
      expect(state(a.path).browserEnabled).toBe(false);
      expect(state(a.path).generation).toBe(authorized.generation);
      expect(state(a.path)).toMatchObject({ enabled: true, hasKey: true });
      expect(state(a.path).browserGeneration).not.toBe(authorized.browserGeneration);
      entered();
      await gate;
      return write(...args);
    });
    const disable = browser(a.id, false);
    await inWrite;
    expect(state(a.path).browserEnabled).toBe(false);
    expect(state(a.path).generation).toBe(authorized.generation);
    release();
    expect(await disable).toMatchObject({ ok: true });
    expect(state(a.path)).toMatchObject({ enabled: true, hasKey: true, browserEnabled: false, generation: authorized.generation });
    const offGen = state(a.path).browserGeneration;
    expect(await browser(a.id, true)).toMatchObject({ ok: true });
    expect(state(a.path).generation).toBe(authorized.generation);
    expect(state(a.path).browserEnabled).toBe(true);
    expect(state(a.path).browserGeneration).not.toBe(offGen);
    const onGen = state(a.path).browserGeneration;
    expect(await browser(a.id, false)).toMatchObject({ ok: true });
    expect(state(a.path).generation).toBe(authorized.generation);
    expect(state(a.path).browserEnabled).toBe(false);
    expect(state(a.path).browserGeneration).not.toBe(onGen);
  });

  it("does not deliver authority for disabled, absent, invalid, or differently identified mounts", async () => {
    const root = await temporary();
    const entry = join(root, "index.js");
    await writeFile(entry, "export default () => {};\n");
    const snapshot = new JevRuntimeStateStore().ensure(root, { enabled: true, hasKey: true });
    for (const pkg of [
      { id: JEV_EXTENSION_ID, enabled: false, extensionPath: entry },
      { id: JEV_EXTENSION_ID, enabled: true },
      { id: JEV_EXTENSION_ID, enabled: true, extensionPath: root },
      { id: "another-extension", enabled: true, extensionPath: entry },
    ]) {
      const output = assemblePiSpawn({ cwd: root, paths: {}, registeredExtensions: [{ ...pkg, jevRuntimeState: snapshot }] });
      expect(output.env[JEV_STATE_FILE_ENV]).toBeUndefined();
      expect(output.env[JEV_GENERATION_ENV]).toBeUndefined();
    }
  });
});
