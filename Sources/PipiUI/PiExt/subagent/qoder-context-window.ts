/**
 * Qoder CN / Qwen context-window compatibility layer (PipiUI).
 *
 * BUG BEING FIXED
 * ---------------
 * `pi-provider-qoder@0.2.9` (and 0.3.0, the current npm latest — both still
 * affected) builds the dynamic model list by taking the LARGEST
 * `context_config` tier as `Model.contextWindow` (e.g. `qmodel_preview` →
 * 1,000,000) even though the Qoder API marks the 200K tier as
 * `is_default: true`. pi and PipiUI transparently forward that value, so
 * auto-compaction only triggers around 983k tokens instead of ~183.6k
 * (200k − 16,384 reserve). The package additionally rewrites the request
 * `model_config` so the largest tier becomes the request's default.
 *
 * THIS LAYER
 * ----------
 * Runs from the App-owned PiExt (`-e`), so it loads in every pi process the
 * App spawns. At `session_start` (startup / new / resume / fork / reload —
 * after every extension, including the npm package, has loaded) it
 * re-registers the `qoder-cn` / `qoder` providers with:
 *
 *  1. models whose `contextWindow` is normalized from the API's default tier
 *     (per-model, from the package's own read-only cache `configs` — the
 *     exact same file the package reads; nothing is written). This changes
 *     the real pi runtime model — `shouldCompact`, `get_state.model`, and
 *     `get_session_stats.contextUsage` all read `model.contextWindow` — not
 *     just a UI clamp. `pi.registerProvider` triggers pi's
 *     `_refreshCurrentModelFromRegistry`, so an already-selected session model
 *     is replaced by the corrected one in place.
 *  2. `oauth.modifyModels` replaced by a normalizing wrapper, so a later
 *     credential refresh cannot re-inject the package's max-tier models.
 *  3. `streamSimple` replaced by `qoder-stream.ts` (qoder-stream.ts), the
 *     minimal vendored stream whose request `model_config` preserves the
 *     API-marked default tier instead of promoting the max tier. The stream is
 *     a port of `pi-provider-qoder@0.2.9` (MIT; complete notice at
 *     `ThirdPartyNotices/QoderProvider-LICENSE.txt`; see the file header for
 *     the SPDX/attribution and sync baseline).
 *
 * All lookups are strictly per model id against the API's own tier data:
 * providers/models without a cache entry (or without a default tier) fall
 * back to `max_input_tokens`, then to their existing value — no global
 * "all Qwen → 200k" rewrite.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ProviderConfig } from "@earendil-works/pi-coding-agent";
import { qoderStreamSimple, qoderStateDir, type QoderConfigEntry } from "./qoder-stream.ts";

export const QODER_PROVIDER_IDS = ["qoder-cn", "qoder"] as const;
export type QoderMode = "cn" | "global";

export function qoderCacheFileName(mode: QoderMode): string {
	return mode === "cn" ? "qoder-cn-models-cache.json" : "qoder-models-cache.json";
}

export function qoderCacheFilePath(mode: QoderMode): string {
	return join(qoderStateDir(), qoderCacheFileName(mode));
}

// ---------------------------------------------------------------------------
// Pure normalization helpers (exported for hermetic fixture tests)
// ---------------------------------------------------------------------------

/**
 * Resolve the context window a Qoder model actually runs with:
 *   1. the `context_config` tier marked `is_default: true` by the API;
 *   2. else `max_input_tokens` (the API's advertised input limit);
 *   3. else the caller-supplied fallback (existing model value).
 * Never picks the largest tier just because it exists.
 */
export function resolveDefaultContextWindow(
	entry: QoderConfigEntry | null | undefined,
	fallback: number,
): number {
	if (entry && typeof entry.context_config === "object" && entry.context_config !== null) {
		for (const tier of Object.values(entry.context_config)) {
			if (tier && typeof tier === "object" && tier.is_default === true && typeof tier.token_count === "number" && tier.token_count > 0) {
				return tier.token_count;
			}
		}
	}
	if (entry && typeof entry.max_input_tokens === "number" && entry.max_input_tokens > 0) {
		return entry.max_input_tokens;
	}
	return fallback;
}

export interface CompatModelLike {
	id: string;
	provider?: string;
	contextWindow?: number;
	[key: string]: unknown;
}

/**
 * Per-model normalization of a provider's model list. Only models with a raw
 * cache entry are touched; everything else keeps its registered value.
 */
export function normalizedModels(
	models: CompatModelLike[],
	configsById: Record<string, QoderConfigEntry> | null | undefined,
): CompatModelLike[] {
	if (!models) return models;
	if (!configsById) return [...models];
	return models.map((model) => {
		const entry = configsById[model.id];
		if (!entry) return model;
		return { ...model, contextWindow: resolveDefaultContextWindow(entry, model.contextWindow ?? 0) };
	});
}

/**
 * Request-side fix: the `model_config` sent to Qoder must be the raw cache
 * entry — the API's `context_config` with its own `is_default` tier intact.
 * The package's `withMaxContextAsDefault` rewrite (promoting the largest tier)
 * is exactly what must never happen. When no entry exists the stream falls
 * back to the shape the package uses (no `context_config` at all → the API
 * applies its own default).
 */
export function modelConfigForRequest(entry: QoderConfigEntry | null | undefined): QoderConfigEntry | null {
	if (!entry) return null;
	return { ...entry };
}

// ---------------------------------------------------------------------------
// Read-only cache access (same files the package reads; never written)
// ---------------------------------------------------------------------------

export function readQoderCacheConfigs(mode: QoderMode): Record<string, QoderConfigEntry> {
	const cachePath = qoderCacheFilePath(mode);
	if (!existsSync(cachePath)) return {};
	try {
		const data = JSON.parse(readFileSync(cachePath, "utf8")) as {
			configs?: Record<string, QoderConfigEntry>;
		};
		return data?.configs && typeof data.configs === "object" ? data.configs : {};
	} catch {
		return {};
	}
}

// ---------------------------------------------------------------------------
// Provider re-registration (session_start; runs after the npm package loaded)
// ---------------------------------------------------------------------------

async function applyQoderContextWindowCompat(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	for (const providerId of QODER_PROVIDER_IDS) {
		const mode: QoderMode = providerId === "qoder-cn" ? "cn" : "global";
		const registered = ctx.modelRegistry.getRegisteredProviderConfig(providerId);
		if (!registered) continue; // package not installed — nothing to fix
		const provider = ctx.modelRegistry.getProvider(providerId);
		const models = provider?.getModels ? provider.getModels() : [];
		const configs = readQoderCacheConfigs(mode);
		const normalized = normalizedModels(models, configs);

		const registration: ProviderConfig = {
			models: normalized,
			// validateExtensionProvider requires `api` when streamSimple is set;
			// inherit the package's API id ("qoder-api") rather than redefining it.
			api: registered.api ?? ("qoder-api" as ProviderConfig["api"]),
		};
		if (registered.oauth && typeof registered.oauth === "object") {
			// Keep the package's login/refresh/getApiKey; replace only the
			// model rewrite so a later credential refresh cannot re-inject the
			// max-tier model list.
			registration.oauth = {
				...registered.oauth,
				modifyModels: (modelsToRewrite) => normalizedModels(modelsToRewrite, configs),
			};
		}
		// Our vendored stream: request model_config keeps the API default tier.
		registration.streamSimple = qoderStreamSimple as ProviderConfig["streamSimple"];

		pi.registerProvider(providerId, registration);
	}
}

/** Install the compat layer. Called from the App-owned PiExt entry. */
export function registerQoderContextWindowCompat(pi: ExtensionAPI): void {
	pi.on("session_start", (event, ctx) => {
		void applyQoderContextWindowCompat(pi, ctx).catch((error) => {
			// Best-effort fix: a compat failure must never crash the session;
			// the package's own (buggy) registration stays as the fallback.
			console.error(`[pipiui-qoder-compat] session_start apply failed: ${error instanceof Error ? error.message : String(error)}`);
		});
	});
}

// Re-export for callers/tests that want the canonical provider list.
export { qoderStateDir };
