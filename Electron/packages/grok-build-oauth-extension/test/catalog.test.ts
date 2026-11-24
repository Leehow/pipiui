import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseExtensionManifestJson } from "../../pi-backend/src/extension-manifest.js";
import {
  authStatusContainsSecrets,
  extensionAuthStatus,
  filterCatalogByContributions,
  resolveContributedCatalog,
  type ContributionClaim,
} from "../../pi-backend/src/extension-provider-contract.js";
import {
  AUTH_PROVIDER_ID,
  GROK_BUILD_CONVERSATION_MODEL_IDS,
  grokBuildManifestModels,
} from "../agent/models.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function grokClaim(enabled = true): ContributionClaim {
  const raw = JSON.parse(readFileSync(join(pkgRoot, "pipiui-extension.json"), "utf8"));
  const parsed = parseExtensionManifestJson(JSON.stringify(raw));
  if (!parsed.ok || !parsed.manifest.auth) throw new Error("expected grok auth contribution");
  return {
    extensionId: parsed.manifest.id,
    enabled,
    contribution: parsed.manifest.auth,
  };
}

describe("grok-build conversation catalog gating", () => {
  it("declares the canonical provider id and the tested conversation model set", () => {
    const claim = grokClaim();
    expect(claim.contribution.provider.id).toBe(AUTH_PROVIDER_ID);
    expect(claim.contribution.provider.oauth).toBe(true);
    expect(claim.contribution.provider.models).toEqual([]);
    expect(grokBuildManifestModels().map((model) => model.id)).toEqual([
      ...GROK_BUILD_CONVERSATION_MODEL_IDS,
    ]);
    expect(grokBuildManifestModels().find((model) => model.id === "grok-4.6")?.contextWindow).toBe(500000);
    expect(GROK_BUILD_CONVERSATION_MODEL_IDS).not.toContain("grok-imagine-image-quality");
    expect(grokBuildManifestModels().every((model) => model.api === "openai-responses")).toBe(true);
    expect(grokBuildManifestModels().every((model) => (
      model.capabilities.nativeSearch.tools.includes("web_search")
      && model.capabilities.nativeSearch.tools.includes("x_search")
      && model.capabilities.hostedTools.tools.includes("web_search")
      && model.capabilities.hostedTools.tools.includes("x_search")
      && model.capabilities.hostedTools.tools.includes("code_interpreter")
      && model.capabilities.structuredOutputs === true
      && model.capabilities.inputFiles === true
    ))).toBe(true);
    expect(claim.contribution.provider.models.every((model) => (
      model.capabilities?.hostedTools && Array.isArray((model.capabilities.hostedTools as { tools?: unknown }).tools)
        && (model.capabilities.hostedTools as { tools: string[] }).tools.includes("code_interpreter")
        && model.capabilities.structuredOutputs === true
        && model.capabilities.inputFiles === true
    ))).toBe(true);
    const source = JSON.parse(readFileSync(join(pkgRoot, "pipiui-extension.json"), "utf8"));
    expect(source.app?.ui?.panels ?? []).toEqual([]);
  });

  it("keeps models out of the catalog when signed out or disabled", () => {
    const claims = [grokClaim(true)];
    const existing = [
      { provider: "grok-build", id: "grok-4.6", name: "Grok 4.6" },
      { provider: "anthropic", id: "a1", name: "A1" },
    ];
    const signedOut = filterCatalogByContributions(existing, {
      claims,
      authenticatedProviders: new Set(),
    });
    expect(signedOut.map((model) => `${model.provider}/${model.id}`)).toEqual(["anthropic/a1"]);

    const disabled = filterCatalogByContributions(existing, {
      claims: [grokClaim(false)],
      authenticatedProviders: new Set(["grok-build"]),
    });
    expect(disabled.map((model) => `${model.provider}/${model.id}`)).toEqual(["anthropic/a1"]);
  });

  it("does not resurrect the static floor through manifest fallback, and never writes secrets", () => {
    const claims = [grokClaim(true)];
    const overlay = resolveContributedCatalog({
      claims,
      authenticatedProviders: new Set(["grok-build"]),
      existing: [{ provider: "anthropic", id: "a1" }],
    });
    expect(overlay.models).toEqual([]);
    const status = extensionAuthStatus({
      extensionId: "grok-build-oauth",
      providerId: "grok-build",
      enabled: true,
      loggedIn: true,
      expiresAtMs: 9,
    });
    expect(authStatusContainsSecrets(status)).toBe(false);
    expect(JSON.stringify(status)).not.toMatch(/access|refresh|token|sk-|Bearer/i);
  });
});
