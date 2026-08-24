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
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { qoderStateDir, resolveDefaultContextWindow, type QoderModelEntry } from "./vendor/models.js";
export declare const QODER_PROVIDER_IDS: readonly ["qoder-cn", "qoder"];
export type QoderMode = "cn" | "global";
export interface CompatModelLike {
    id: string;
    provider?: string;
    contextWindow?: number;
    [key: string]: unknown;
}
export declare function normalizedModels(models: CompatModelLike[], configsById: Record<string, QoderModelEntry> | null | undefined): CompatModelLike[];
export declare function modelConfigForRequest(entry: QoderModelEntry | null | undefined): QoderModelEntry | null;
export declare function registerQoderContextWindowCompat(pi: ExtensionAPI): void;
export { qoderStateDir, resolveDefaultContextWindow };
