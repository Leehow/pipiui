import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateExtensionManifest } from "../../pi-backend/src/extension-manifest.js";
import { GROK_BUILD_CONVERSATION_MODEL_IDS } from "../agent/models.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(pkgRoot, "pipiui-extension.json");

const HIDDEN_SETTING_KEYS = [
  "accessToken",
  "xaiApiBaseUrl",
  "defaultModel",
  "issuer",
  "clientId",
  "scopes",
  "earlyRefreshSec",
  "compatFallback",
  "sessionId",
  "tier",
];

describe("grok-build-oauth manifest (generic auth contribution)", () => {
  it("is valid JSON and declares auth.provider + conversation models", () => {
    const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
    const result = validateExtensionManifest(raw);
    expect(result.ok, result.ok ? "" : (result as { errors: string[] }).errors.join("; ")).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.id).toBe("grok-build-oauth");
    expect(result.manifest.name).toBe("Grok Build");
    expect(result.manifest.auth?.provider.id).toBe("grok-build");
    expect(result.manifest.auth?.provider.oauth).toBe(true);
    expect(result.manifest.auth?.provider.models).toEqual([]);
    expect(result.manifest.capabilities).toEqual(
      expect.arrayContaining(["bridge.emit", "invoke.agent", "stream.render"]),
    );
    expect(result.manifest.capabilities).not.toEqual(expect.arrayContaining(["settings.read", "settings.write"]));
    expect(result.manifest.settings).toBeUndefined();
    expect(result.manifest.ui?.settingsSections).toBeUndefined();
    expect(result.manifest.ui?.panels ?? []).toEqual([]);
    expect(result.manifest.ui?.toolRenderers?.map((r) => r.tool)).toEqual(
      expect.arrayContaining(["image_gen", "image_edit"]),
    );
    expect(result.manifest.agentExtension).toBe("agent/dist/index.js");
  });

  it("does not expose Token/Key, Base URL, OAuth, tier, compat, or session fields", () => {
    const raw = readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as {
      app?: { settings?: { schema?: { properties?: Record<string, unknown> } }; ui?: { settingsSections?: unknown[] } };
    };
    expect(parsed.app?.settings).toBeUndefined();
    expect(parsed.app?.ui?.settingsSections ?? []).toEqual([]);
    for (const key of HIDDEN_SETTING_KEYS) {
      expect(raw).not.toContain(`ext.grok-build-oauth.${key}`);
    }
    expect(raw).not.toMatch(/accessToken|refreshToken/);
  });

  it("declares entries that resolve inside the package and contributes zero right-sidebar panels", () => {
    const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      agent?: { extension?: string };
      app?: { ui?: { panels?: Array<{ entry?: string; id?: string }>; toolRenderers?: Array<{ entry?: string }> } };
    };
    expect(raw.agent?.extension).toBe("agent/dist/index.js");
    expect(raw.app?.ui?.panels ?? []).toEqual([]);
    expect(JSON.stringify(raw)).not.toMatch(/grok-build-status|toolPanel|app\/dist\/panel\.js/);
    expect(raw.app?.ui?.toolRenderers?.map((r) => r.entry)).toEqual([
      "app/dist/image-card.js",
      "app/dist/image-card.js",
    ]);
    const bundledPath = join(pkgRoot, "../../resources/runtime/extensions/grok-build-oauth/pipiui-extension.json");
    const bundled = JSON.parse(readFileSync(bundledPath, "utf8"));
    expect(bundled).toEqual(JSON.parse(readFileSync(manifestPath, "utf8")));
    expect(bundled.app?.ui?.panels ?? []).toEqual([]);
    expect(existsSync(join(pkgRoot, "../../resources/runtime/extensions/grok-build-oauth/app/dist/panel.js"))).toBe(false);
  });

  it("agent registers grok-build via the shared factory and never writes tokens to settings", () => {
    const agentSource = readFileSync(join(pkgRoot, "agent", "index.ts"), "utf8");
    expect(agentSource).toMatch(/registerProvider\s*\(\s*\n?\s*GROK_BUILD_PROVIDER_ID/);
    expect(agentSource).toMatch(/createGrokBuildProvider/);
    const providerSource = readFileSync(join(pkgRoot, "agent", "provider.ts"), "utf8");
    expect(providerSource).toMatch(/AUTH_PROVIDER_ID/);
    expect(providerSource).toMatch(/createAuthProvider/);
    expect(providerSource).toMatch(/GROK_BUILD_CONVERSATION_MODELS/);
    expect(agentSource).not.toMatch(/ext\.grok-build-oauth\.accessToken.*update/);
    expect(providerSource).not.toMatch(/ext\.grok-build-oauth\.accessToken.*update/);
    expect(providerSource).toMatch(/redact/);
  });
});

describe("grok-build-oauth build artifacts", () => {
  it("has built agent/app entries after npm run build", () => {
    expect(existsSync(join(pkgRoot, "agent", "dist", "index.js"))).toBe(true);
    expect(existsSync(join(pkgRoot, "agent", "dist", "index.d.ts"))).toBe(true);
    expect(existsSync(join(pkgRoot, "app", "dist", "panel.js"))).toBe(false);
    expect(existsSync(join(pkgRoot, "app", "dist", "image-card.js"))).toBe(true);
  });

  it("manifest entries point at built files", () => {
    const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      agent: { extension: string };
      app: { ui: { panels?: Array<{ entry: string }>; toolRenderers: Array<{ entry: string }> } };
    };
    expect(existsSync(join(pkgRoot, raw.agent.extension))).toBe(true);
    expect(raw.app.ui.panels ?? []).toEqual([]);
    for (const entry of raw.app.ui.toolRenderers) expect(existsSync(join(pkgRoot, entry.entry!))).toBe(true);
  });
});
