import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateExtensionManifest } from "../../pi-backend/src/extension-manifest.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(pkgRoot, "pipiui-extension.json");

describe("grok-build-oauth manifest (M2 oauth)", () => {
  it("is valid JSON and passes D2 validation", () => {
    const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
    const result = validateExtensionManifest(raw);
    expect(result.ok, result.ok ? "" : (result as { errors: string[] }).errors.join("; ")).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.id).toBe("grok-build-oauth");
    expect(result.manifest.name).toBe("Grok Build");
    expect(result.manifest.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(result.manifest.capabilities).toEqual(
      expect.arrayContaining(["settings.read", "settings.write", "bridge.emit", "invoke.agent", "stream.render"]),
    );
    // settings schema
    const schemaProps = result.manifest.settings?.schema.properties as Record<string, unknown> | undefined;
    expect(schemaProps).toBeTruthy();
    for (const key of Object.keys(schemaProps!)) {
      expect(key.startsWith("ext.grok-build-oauth.")).toBe(true);
    }
    expect(schemaProps?.["ext.grok-build-oauth.accessToken"]).toMatchObject({ format: "secret" });
    expect(result.manifest.settings?.scope).toBe("app");
    // ui wiring
    expect(result.manifest.ui?.panels?.[0]).toMatchObject({ slot: "toolPanel", id: "grok-build-status" });
    expect(result.manifest.ui?.toolRenderers?.map((r) => r.tool)).toEqual(expect.arrayContaining(["image_gen", "image_edit"]));
    expect(result.manifest.ui?.settingsSections?.[0]).toMatchObject({ id: "grok-build-oauth" });
    expect(result.manifest.agentExtension).toBe("agent/dist/index.js");
  });

  it("declares entries that resolve inside the package (no escape)", () => {
    const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      agent?: { extension?: string };
      app?: { ui?: { panels?: Array<{ entry?: string }>; toolRenderers?: Array<{ entry?: string }> } };
    };
    const agentEntry = raw.agent?.extension;
    expect(agentEntry).toBe("agent/dist/index.js");
    const panelEntry = raw.app?.ui?.panels?.[0]?.entry;
    expect(panelEntry).toBe("app/dist/panel.js");
    const rendererEntries = raw.app?.ui?.toolRenderers?.map((r) => r.entry);
    expect(rendererEntries).toEqual(["app/dist/image-card.js", "app/dist/image-card.js"]);
  });

  it("agent registers grok-build provider and uses Pi OAuth, not plaintext settings token", () => {
    const agentSource = readFileSync(join(pkgRoot, "agent", "index.ts"), "utf8");
    expect(agentSource).toMatch(/registerProvider\s*\(\s*\n?\s*GROK_BUILD_PROVIDER_ID/);
    expect(agentSource).toMatch(/createGrokBuildProvider/);
    // Canonical OAuth transport lives in the shared provider factory (single source).
    const providerSource = readFileSync(join(pkgRoot, "agent", "provider.ts"), "utf8");
    expect(providerSource).toMatch(/GROK_BUILD_PROVIDER_ID = "grok-build"/);
    expect(providerSource).toMatch(/oauth/);
    expect(agentSource).toMatch(/grok-build-oauth/);
    // Must not write token to settings directly — Pi persistence only
    expect(agentSource).not.toMatch(/ext\.grok-build-oauth\.accessToken.*update/);
    expect(providerSource).not.toMatch(/ext\.grok-build-oauth\.accessToken.*update/);
    // Redaction must be present
    expect(agentSource).toMatch(/redact/);
    expect(providerSource).toMatch(/redact/);
  });
});

describe("grok-build-oauth build artifacts", () => {
  it("has built agent/app entries after npm run build", () => {
    expect(existsSync(join(pkgRoot, "agent", "dist", "index.js"))).toBe(true);
    expect(existsSync(join(pkgRoot, "agent", "dist", "index.d.ts"))).toBe(true);
    expect(existsSync(join(pkgRoot, "app", "dist", "panel.js"))).toBe(true);
    expect(existsSync(join(pkgRoot, "app", "dist", "image-card.js"))).toBe(true);
    // d.ts for app entries
    expect(existsSync(join(pkgRoot, "app", "dist", "panel.d.ts"))).toBe(true);
  });

  it("manifest entries point at built files", () => {
    const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      agent: { extension: string };
      app: { ui: { panels: Array<{ entry: string }>; toolRenderers: Array<{ entry: string }> } };
    };
    expect(existsSync(join(pkgRoot, raw.agent.extension))).toBe(true);
    for (const entry of raw.app.ui.panels) expect(existsSync(join(pkgRoot, entry.entry!))).toBe(true);
    for (const entry of raw.app.ui.toolRenderers) expect(existsSync(join(pkgRoot, entry.entry!))).toBe(true);
  });
});
