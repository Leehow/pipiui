/**
 * Generic registration of extension-contributed auth providers into a Pi
 * ModelRuntime. No host special-case per extension id: any package that
 * declares `auth.provider` and exports `createAuthProvider` from its
 * agent provider module is registered. Failures never break auth.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ContributionClaim } from "./extension-provider-contract.js";

const PROVIDER_MODULE_CANDIDATES = ["agent/dist/provider.js", "agent/provider.js"] as const;

export type AuthRuntimeRegistrar = {
  registerProvider?(id: string, config: unknown): void;
  getProvider?(id: string): unknown;
};

export function contributedProviderModulePath(directory: string): string | undefined {
  for (const rel of PROVIDER_MODULE_CANDIDATES) {
    const candidate = join(directory, rel);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function loadContributedAuthProvider(directory: string): Promise<{
  id?: string;
  config: unknown;
} | undefined> {
  const path = contributedProviderModulePath(directory);
  if (!path) return undefined;
  const mod = (await import(pathToFileURL(path).href)) as Record<string, unknown>;
  const factory = mod.createAuthProvider;
  if (typeof factory !== "function") return undefined;
  const config = (factory as () => unknown)();
  if (!config || typeof config !== "object") return undefined;
  const id = asNonEmptyString(mod.AUTH_PROVIDER_ID);
  return id ? { id, config } : { config };
}

export async function registerContributedAuthProviders(input: {
  runtime: AuthRuntimeRegistrar;
  claims: readonly ContributionClaim[];
  directoryOf: (extensionId: string) => string | undefined;
}): Promise<void> {
  if (typeof input.runtime.registerProvider !== "function") return;
  const seen = new Set<string>();
  for (const claim of input.claims) {
    const directory = input.directoryOf(claim.extensionId);
    if (!directory) continue;
    try {
      const loaded = await loadContributedAuthProvider(directory);
      if (!loaded) continue;
      const providerId = loaded.id ?? claim.contribution.provider.id;
      if (!providerId || seen.has(providerId)) continue;
      seen.add(providerId);
      if (input.runtime.getProvider?.(providerId)) continue;
      input.runtime.registerProvider(providerId, loaded.config);
    } catch (error) {
      console.warn(
        `[pipiui] extension auth provider registration failed (${claim.extensionId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
