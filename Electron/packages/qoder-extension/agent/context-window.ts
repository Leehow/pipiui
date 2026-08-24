/**
 * Qoder CN / Qwen context-window compatibility layer (PipiUI).
 *
 * Upstream `pi-provider-qoder@0.3.0` still takes the LARGEST `context_config`
 * tier as `Model.contextWindow` and rewrites request `model_config` so that
 * tier becomes the default. The API marks the 200K tier `is_default: true`.
 *
 * Vendor `models.ts` is patched so cache reads / writes / request configs use
 * the API default. This layer re-registers both providers on `session_start`
 * so a later cache refresh cannot leave the in-memory model list on the max
 * tier, and so `oauth.modifyModels` stays normalizing.
 */

import type { ExtensionAPI, ExtensionContext, ProviderConfig } from "@earendil-works/pi-coding-agent";
import {
  getCachedModels,
  qoderStateDir,
  readQoderCacheConfigs,
  resolveDefaultContextWindow,
  type QoderModelDef,
  type QoderModelEntry,
} from "./vendor/models.js";
import { streamQoder } from "./vendor/stream.js";

export const QODER_PROVIDER_IDS = ["qoder-cn", "qoder"] as const;
export type QoderMode = "cn" | "global";

export interface CompatModelLike {
  id: string;
  provider?: string;
  contextWindow?: number;
  [key: string]: unknown;
}

export function normalizedModels(
  models: CompatModelLike[],
  configsById: Record<string, QoderModelEntry> | null | undefined,
): CompatModelLike[] {
  if (!models) return models;
  if (!configsById) return [...models];
  return models.map((model) => {
    const entry = configsById[model.id];
    if (!entry) return model;
    return { ...model, contextWindow: resolveDefaultContextWindow(entry, model.contextWindow ?? 0) };
  });
}

export function modelConfigForRequest(entry: QoderModelEntry | null | undefined): QoderModelEntry | null {
  if (!entry) return null;
  return { ...entry };
}

async function applyQoderContextWindowCompat(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  for (const providerId of QODER_PROVIDER_IDS) {
    const mode: QoderMode = providerId === "qoder-cn" ? "cn" : "global";
    const registered = ctx.modelRegistry.getRegisteredProviderConfig(providerId);
    if (!registered) continue;
    const provider = ctx.modelRegistry.getProvider(providerId);
    const models = provider?.getModels ? provider.getModels() : getCachedModels(mode);
    const configs = readQoderCacheConfigs(mode);
    const normalized = normalizedModels(models as unknown as CompatModelLike[], configs);

    const registration: ProviderConfig = {
      models: normalized as unknown as QoderModelDef[] as ProviderConfig["models"],
      api: registered.api ?? ("qoder-api" as ProviderConfig["api"]),
      streamSimple: streamQoder as unknown as ProviderConfig["streamSimple"],
    };
    if (registered.oauth && typeof registered.oauth === "object") {
      registration.oauth = {
        ...registered.oauth,
        modifyModels: (modelsToRewrite) =>
          normalizedModels(modelsToRewrite as unknown as CompatModelLike[], configs) as unknown as typeof modelsToRewrite,
      };
    }
    pi.registerProvider(providerId, registration);
  }
}

export function registerQoderContextWindowCompat(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    void applyQoderContextWindowCompat(pi, ctx).catch((error) => {
      console.error(
        `[pipiui-qoder-compat] session_start apply failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  });
}

export { qoderStateDir, resolveDefaultContextWindow };
