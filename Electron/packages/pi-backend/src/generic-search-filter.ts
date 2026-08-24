/**
 * Capability-driven hiding of PipiUI generic `web_search`.
 *
 * Tool-list assembly and the on-wire hosted-search hook must agree: hide the
 * client tool only when effective native `web_search` exists (`nativeSearch`
 * or the search slice of `hostedTools`). A lone `x_search` or
 * `code_interpreter` keeps the generic tool. Never branch on provider ids.
 */
import {
  effectiveModelHidesGenericWebSearch,
  effectiveNativeSearchOf,
  extraExcludedToolsForNativeSearch,
  normalizeModelCapabilities,
  type ModelCapabilities,
  type NativeSearchCapability,
} from "@pipi/host-api";

export type NativeSearchModelRef = {
  provider?: string;
  id?: string;
  capabilities?: ModelCapabilities;
};

export function hidesGenericWebSearch(model: NativeSearchModelRef | undefined): boolean {
  return effectiveModelHidesGenericWebSearch(model);
}

export function extraExcludedGenericSearchTools(
  model: NativeSearchModelRef | undefined,
): string[] {
  return extraExcludedToolsForNativeSearch(model);
}

export type NativeSearchRuntimeEntry = Partial<NativeSearchCapability> & {
  capabilities?: ModelCapabilities;
};

/** Compact `provider/id` → effective nativeSearch + full capability bag for workers. */
export function nativeSearchRuntimeCatalog(
  models: readonly NativeSearchModelRef[],
): Record<string, NativeSearchRuntimeEntry> {
  const catalog: Record<string, NativeSearchRuntimeEntry> = {};
  for (const model of models) {
    const provider = model.provider?.trim();
    const id = model.id?.trim();
    const capability = effectiveNativeSearchOf(model);
    const capabilities = normalizeModelCapabilities(model.capabilities);
    if (!provider || !id || (!capability && !capabilities)) continue;
    catalog[`${provider}/${id}`] = {
      ...(capability
        ? {
            tools: [...capability.tools],
            ...(capability.domains ? { domains: { ...capability.domains } } : {}),
          }
        : {}),
      ...(capabilities ? { capabilities } : {}),
    };
  }
  return catalog;
}
