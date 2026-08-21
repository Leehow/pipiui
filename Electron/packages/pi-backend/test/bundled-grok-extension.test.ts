import { afterEach, describe, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPiHostBackend } from "../src/index.js";
import {
  GROK_COMPAT_FALLBACK_SETTING_KEY,
  GROK_EXTENSION_ID,
  mediaCompatFallbackEnvFromSettings,
} from "../src/extension-settings.js";
import { migrateExtensionSettings, parseExtensionMigrations } from "../src/extension-migrations.js";
import { parseExtensionManifestJson } from "../src/extension-manifest.js";
import { MEDIA_COMPAT_FALLBACK_ENV } from "../src/spawn-assembly.js";
import { listSecretMeta, resetInMemoryVault } from "../src/secret-vault.js";

const bundledRuntimeExtensions = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../resources/runtime/extensions",
);

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

function readBundledManifest(): Record<string, unknown> {
  return JSON.parse(
    // readFileSync keeps this synchronous contract check cheap and import-free.
    readFileSync(join(bundledRuntimeExtensions, GROK_EXTENSION_ID, "pipiui-extension.json"), "utf8"),
  );
}

describe("bundled grok-build-oauth manifest contract (M5)", () => {
  it("declares app-scoped settings with compatFallback default off and a vault-only secret", () => {
    const validation = parseExtensionManifestJson(
      readFileSync(join(bundledRuntimeExtensions, GROK_EXTENSION_ID, "pipiui-extension.json"), "utf8"),
    );
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    const manifest = validation.manifest;
    expect(manifest.id).toBe(GROK_EXTENSION_ID);
    expect(manifest.settings?.scope).toBe("app");
    const properties = manifest.settings?.schema?.properties ?? {};
    expect(properties[GROK_COMPAT_FALLBACK_SETTING_KEY]).toMatchObject({ type: "boolean", default: false });
    expect(properties["ext.grok-build-oauth.accessToken"]).toMatchObject({ type: "string", format: "secret" });
    expect(manifest.settings?.settingsVersion ?? manifest.settingsVersion ?? 1).toBeGreaterThanOrEqual(1);
  });

  it("has no-op migrations at settingsVersion 1 and refuses a newer disk", () => {
    const raw = readBundledManifest();
    const parsed = parseExtensionMigrations(raw.migrations);
    expect(parsed).toEqual({ ok: true, migrations: [] });
    const target = typeof raw.settingsVersion === "number" ? raw.settingsVersion : 1;
    const identity = migrateExtensionSettings({
      diskVersion: target,
      targetVersion: target,
      migrations: [],
      settings: { [GROK_COMPAT_FALLBACK_SETTING_KEY]: true },
    });
    expect(identity).toEqual({
      ok: true,
      settings: { [GROK_COMPAT_FALLBACK_SETTING_KEY]: true },
      settingsVersion: target,
      changed: false,
    });
    const fromFuture = migrateExtensionSettings({
      diskVersion: target + 1,
      targetVersion: target,
      migrations: [],
      settings: {},
    });
    expect(fromFuture.ok).toBe(false);
  });
});

describe("media compat fallback env (M5 default off)", () => {
  it("stays off unless the App settings slot explicitly enables it", () => {
    expect(mediaCompatFallbackEnvFromSettings({}, MEDIA_COMPAT_FALLBACK_ENV)).toEqual({});
    expect(
      mediaCompatFallbackEnvFromSettings(
        { extensions: { [GROK_EXTENSION_ID]: { enabled: true } } },
        MEDIA_COMPAT_FALLBACK_ENV,
      ),
    ).toEqual({});
    expect(
      mediaCompatFallbackEnvFromSettings(
        { extensions: { [GROK_EXTENSION_ID]: { settings: { [GROK_COMPAT_FALLBACK_SETTING_KEY]: "yes" } } } },
        MEDIA_COMPAT_FALLBACK_ENV,
      ),
    ).toEqual({});
    expect(
      mediaCompatFallbackEnvFromSettings(
        { extensions: { [GROK_EXTENSION_ID]: { settings: { [GROK_COMPAT_FALLBACK_SETTING_KEY]: true } } } },
        MEDIA_COMPAT_FALLBACK_ENV,
      ),
    ).toEqual({ [MEDIA_COMPAT_FALLBACK_ENV]: "1" });
    // The gate reads the settings slot directly: disabling the extension must not clear it.
    expect(
      mediaCompatFallbackEnvFromSettings(
        { extensions: { [GROK_EXTENSION_ID]: { enabled: false, settings: { [GROK_COMPAT_FALLBACK_SETTING_KEY]: true } } } },
        MEDIA_COMPAT_FALLBACK_ENV,
      ),
    ).toEqual({ [MEDIA_COMPAT_FALLBACK_ENV]: "1" });
  });
});

describe("bundled grok-build-oauth host integration (M5)", () => {
  async function backendWithBundledGrok() {
    const base = await tempRoot("pipi-grok-host-");
    const agent = join(base, "agent");
    const runtime = join(base, "runtime");
    await mkdir(agent, { recursive: true });
    await mkdir(join(runtime, "extensions"), { recursive: true });
    await cp(
      join(bundledRuntimeExtensions, GROK_EXTENSION_ID),
      join(runtime, "extensions", GROK_EXTENSION_ID),
      { recursive: true },
    );
    const backend = createPiHostBackend({
      agentDir: agent,
      sessionsRoot: join(base, "sessions"),
      runtimeRoot: runtime,
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
      vaultDir: agent,
    });
    return { backend, agent };
  }

  it("discovers the shipped package as an enabled builtin via the registry (no bypass)", async () => {
    const { backend } = await backendWithBundledGrok();
    const listed = (await backend.handle("listExtensions" as never, [])) as Array<{ id: string; origin: string; state: string; uninstallable: boolean }>;
    const grok = listed.find((item) => item.id === GROK_EXTENSION_ID);
    expect(grok).toMatchObject({ id: GROK_EXTENSION_ID, origin: "builtin", state: "enabled", uninstallable: false });
  });

  it("persists compatFallback to the settings slot and the accessToken only in the vault", async () => {
    const { backend, agent } = await backendWithBundledGrok();
    await backend.handle("listExtensions" as never, []);
    const secret = "xai-secret-access-token";
    const updated = (await backend.handle("updateExtensionSettings" as never, [
      GROK_EXTENSION_ID,
      { [GROK_COMPAT_FALLBACK_SETTING_KEY]: true, "ext.grok-build-oauth.accessToken": secret },
    ])) as { ok: boolean; data?: Record<string, unknown> };
    expect(updated).toEqual({ ok: true, data: { [GROK_COMPAT_FALLBACK_SETTING_KEY]: true } });

    const appJson = await readFile(join(agent, "pipiui-settings.json"), "utf8");
    expect(appJson).not.toContain(secret);
    const slot = JSON.parse(appJson).extensions[GROK_EXTENSION_ID];
    expect(slot.settings).toEqual({ [GROK_COMPAT_FALLBACK_SETTING_KEY]: true });

    const got = (await backend.handle("getExtensionSettings" as never, [GROK_EXTENSION_ID])) as Record<string, unknown>;
    expect(got[GROK_COMPAT_FALLBACK_SETTING_KEY]).toBe(true);
    expect(got["ext.grok-build-oauth.accessToken"]).toBe(true); // presence flag only
    expect(JSON.stringify(got)).not.toContain(secret);
    expect(listSecretMeta(agent)).toEqual([expect.objectContaining({ name: "ext.grok-build-oauth.accessToken" })]);
  });

  it("rejects unknown settings keys per the manifest schema", async () => {
    const { backend } = await backendWithBundledGrok();
    await backend.handle("listExtensions" as never, []);
    const denied = (await backend.handle("updateExtensionSettings" as never, [
      GROK_EXTENSION_ID,
      { "ext.grok-build-oauth.notInSchema": 1 },
    ])) as { ok: boolean; error?: { code: string } };
    expect(denied.ok).toBe(false);
    expect(denied.error?.code).toBe("capability_denied");
  });

  it("toggles enablement through the registry; disabling does not delete stored settings", async () => {
    const { backend, agent } = await backendWithBundledGrok();
    await backend.handle("listExtensions" as never, []);
    await backend.handle("updateExtensionSettings" as never, [
      GROK_EXTENSION_ID,
      { [GROK_COMPAT_FALLBACK_SETTING_KEY]: true },
    ]);
    const disabled = (await backend.handle("setExtensionEnabled" as never, [GROK_EXTENSION_ID, false, "app"])) as { state: string };
    expect(disabled.state).toBe("disabled");
    const appJson = JSON.parse(await readFile(join(agent, "pipiui-settings.json"), "utf8"));
    expect(appJson.extensions[GROK_EXTENSION_ID].settings[GROK_COMPAT_FALLBACK_SETTING_KEY]).toBe(true);
    const enabled = (await backend.handle("setExtensionEnabled" as never, [GROK_EXTENSION_ID, true, "app"])) as { state: string };
    expect(enabled.state).toBe("enabled");
  });
});
