import { afterEach, describe, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { parseExtensionManifestJson } from "../src/extension-manifest.js";
import { MEDIA_COMPAT_FALLBACK_ENV } from "../src/spawn-assembly.js";
import { resetInMemoryVault } from "../src/secret-vault.js";
import { authStatusContainsSecrets } from "../src/extension-provider-contract.js";
import type { AuthInteractionLike, AuthRuntimeLike } from "../src/provider-auth.js";

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

function fakeGrokAuthRuntime(initialCredentialed: string[] = []): AuthRuntimeLike & { logouts: string[] } {
  const credentialed = new Set(initialCredentialed);
  const logouts: string[] = [];
  const catalog = [
    { provider: "grok-build", id: "grok-4.6", name: "Grok 4.6", reasoning: true, input: ["text", "image"] },
    { provider: "grok-build", id: "grok-4-fast", name: "Grok 4 Fast", reasoning: false, input: ["text"] },
    { provider: "grok-build", id: "grok-code-fast-1", name: "Grok Code Fast", reasoning: false, input: ["text"] },
    { provider: "anthropic", id: "a1", name: "A1", reasoning: true },
  ];
  return {
    logouts,
    getProviders: async () => [
      { id: "grok-build", name: "Grok Build", auth: { oauth: { loginLabel: "Login Grok Build" } } },
      { id: "anthropic", name: "Anthropic", auth: { apiKey: { login: {} } } },
    ],
    getAvailable: async () => catalog.filter((model) => credentialed.has(model.provider)),
    login: async (providerId, _authType, interaction: AuthInteractionLike) => {
      interaction.notify({ type: "auth_url", url: "https://auth.example.com/start", instructions: "open" });
      await interaction.prompt({ type: "manual_code", message: "code" });
      credentialed.add(providerId);
      return { type: "oauth" };
    },
    logout: async (providerId) => {
      credentialed.delete(providerId);
      logouts.push(providerId);
    },
  };
}

describe("bundled grok-build-oauth manifest contract", () => {
  it("declares generic auth/provider/model contribution and no user-visible settings", () => {
    const validation = parseExtensionManifestJson(
      readFileSync(join(bundledRuntimeExtensions, GROK_EXTENSION_ID, "pipiui-extension.json"), "utf8"),
    );
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    const manifest = validation.manifest;
    expect(manifest.id).toBe(GROK_EXTENSION_ID);
    expect(manifest.settings).toBeUndefined();
    expect(manifest.ui?.settingsSections).toBeUndefined();
    expect(manifest.auth?.provider.id).toBe("grok-build");
    expect(manifest.auth?.provider.oauth).toBe(true);
    expect(manifest.auth?.provider.models.map((model) => model.id)).toEqual([
      "grok-4.6",
      "grok-4-fast",
      "grok-code-fast-1",
    ]);
    expect(manifest.ui?.toolRenderers?.map((item) => item.tool)).toEqual(
      expect.arrayContaining(["image_gen", "image_edit"]),
    );
    expect(manifest.ui?.panels ?? []).toEqual([]);
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
    expect(
      mediaCompatFallbackEnvFromSettings(
        { extensions: { [GROK_EXTENSION_ID]: { enabled: false, settings: { [GROK_COMPAT_FALLBACK_SETTING_KEY]: true } } } },
        MEDIA_COMPAT_FALLBACK_ENV,
      ),
    ).toEqual({ [MEDIA_COMPAT_FALLBACK_ENV]: "1" });
  });
});

describe("bundled grok-build-oauth host integration", () => {
  async function backendWithBundledGrok(credentialed: string[] = []) {
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
    await writeFile(
      join(agent, "models.json"),
      JSON.stringify({ providers: { anthropic: { apiKey: "k", models: [{ id: "a1", name: "A1", reasoning: true }] } } }),
    );
    if (credentialed.includes("grok-build")) {
      await writeFile(
        join(agent, "auth.json"),
        JSON.stringify({
          "grok-build": { type: "oauth", access: "tok-secret", refresh: "ref-secret", expires: 9_999_999_999 },
        }),
      );
    }
    const authRuntime = fakeGrokAuthRuntime(credentialed);
    const backend = createPiHostBackend({
      agentDir: agent,
      sessionsRoot: join(base, "sessions"),
      runtimeRoot: runtime,
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
      vaultDir: agent,
      authRuntime,
    });
    return { backend, agent, authRuntime };
  }

  it("discovers the shipped package as an enabled builtin via the registry (no bypass)", async () => {
    const { backend } = await backendWithBundledGrok();
    const listed = (await backend.handle("listExtensions" as never, [])) as Array<{ id: string; origin: string; state: string; uninstallable: boolean }>;
    const grok = listed.find((item) => item.id === GROK_EXTENSION_ID);
    expect(grok).toMatchObject({ id: GROK_EXTENSION_ID, origin: "builtin", state: "enabled", uninstallable: false });
    expect(grok).toMatchObject({
      contributions: { auth: { provider: { id: "grok-build" } } },
    });
    expect((grok as { ui?: { panels?: unknown[] } }).ui?.panels ?? []).toEqual([]);
    expect(JSON.stringify(grok)).not.toMatch(/grok-build-status|toolPanel/);
  });

  it("rejects leftover complex settings keys and does not accept access tokens", async () => {
    const { backend, agent } = await backendWithBundledGrok();
    await backend.handle("listExtensions" as never, []);
    const denied = (await backend.handle("updateExtensionSettings" as never, [
      GROK_EXTENSION_ID,
      { "ext.grok-build-oauth.accessToken": "xai-secret-access-token" },
    ])) as { ok: boolean; error?: { code: string } };
    expect(denied.ok).toBe(false);
    expect(denied.error?.code).toBe("capability_denied");
    const appJson = await readFile(join(agent, "pipiui-settings.json"), "utf8").catch(() => "");
    expect(appJson).not.toContain("xai-secret-access-token");
  });

  it("toggles enablement through the registry", async () => {
    const { backend } = await backendWithBundledGrok(["grok-build"]);
    await backend.handle("listExtensions" as never, []);
    const disabled = (await backend.handle("setExtensionEnabled" as never, [GROK_EXTENSION_ID, false, "app"])) as { state: string };
    expect(disabled.state).toBe("disabled");
    const enabled = (await backend.handle("setExtensionEnabled" as never, [GROK_EXTENSION_ID, true, "app"])) as { state: string };
    expect(enabled.state).toBe("enabled");
  });

  it("adds Grok conversation models only while enabled + signed in, and removes them on logout", async () => {
    const { backend, agent, authRuntime } = await backendWithBundledGrok([]);
    expect((await backend.handle("listModels", []) as { provider: string; id: string }[])
      .map((model) => `${model.provider}/${model.id}`)).toEqual(["anthropic/a1"]);

    const { loginId } = await backend.handle("beginExtensionLogin" as never, [GROK_EXTENSION_ID, "oauth"]) as { loginId: string };
    expect(await backend.handle("continueProviderLogin", [loginId])).toMatchObject({ kind: "auth_url" });
    expect(await backend.handle("continueProviderLogin", [loginId])).toMatchObject({ kind: "prompt" });
    expect(await backend.handle("continueProviderLogin", [loginId, "ok"])).toEqual({
      kind: "completed",
      providerId: "grok-build",
    });

    const loggedIn = (await backend.handle("listModels", []) as { provider: string; id: string }[])
      .map((model) => `${model.provider}/${model.id}`);
    expect(loggedIn).toEqual(expect.arrayContaining([
      "anthropic/a1",
      "grok-build/grok-4.6",
      "grok-build/grok-4-fast",
      "grok-build/grok-code-fast-1",
    ]));
    expect(loggedIn.some((id) => id.includes("imagine"))).toBe(false);

    await writeFile(
      join(agent, "auth.json"),
      JSON.stringify({
        "grok-build": { type: "oauth", access: "tok-secret", refresh: "ref-secret", expires: 9_999_999_999 },
      }),
    );
    const status = await backend.handle("getExtensionAuthStatus" as never, [GROK_EXTENSION_ID]) as Record<string, unknown>;
    expect(status).toMatchObject({
      extensionId: GROK_EXTENSION_ID,
      providerId: "grok-build",
      loggedIn: true,
      usable: true,
    });
    expect(authStatusContainsSecrets(status)).toBe(false);
    expect(JSON.stringify(status)).not.toContain("tok-secret");
    expect(JSON.stringify(status)).not.toContain("ref-secret");
    await writeFile(join(agent, "auth.json"), "{}\n");

    await backend.handle("setExtensionEnabled" as never, [GROK_EXTENSION_ID, false, "app"]);
    expect((await backend.handle("listModels", []) as { provider: string; id: string }[])
      .map((model) => `${model.provider}/${model.id}`)).toEqual(["anthropic/a1"]);
    await backend.handle("setExtensionEnabled" as never, [GROK_EXTENSION_ID, true, "app"]);
    expect((await backend.handle("listModels", []) as { provider: string; id: string }[])
      .map((model) => `${model.provider}/${model.id}`)).toContain("grok-build/grok-4.6");

    const state = await backend.handle("logoutExtension" as never, [GROK_EXTENSION_ID]) as { model: { provider: string; id: string } };
    expect(authRuntime.logouts).toEqual(["grok-build"]);
    expect((await backend.handle("listModels", []) as { provider: string; id: string }[])
      .map((model) => `${model.provider}/${model.id}`)).toEqual(["anthropic/a1"]);
    expect(state.model).toMatchObject({ provider: "anthropic", id: "a1" });

    const disk = JSON.parse(await readFile(join(agent, "models.json"), "utf8"));
    expect(disk.providers["grok-build"]).toBeUndefined();
  });
});
