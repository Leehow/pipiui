import type { FrozenVariant } from "./batch-contract.js";
import type { VariantStore } from "./variants.js";
import { ExperimentError, semanticId } from "./paths.js";

export const VARIANT_ACTIONS = new Set(["variant_prepare", "variant_freeze", "variant_read", "variant_list"]);
export type VariantRequest = {
  version?: 1;
  requestId?: string;
  action: "variant_prepare" | "variant_freeze" | "variant_read" | "variant_list";
  experimentId: string;
  variantId?: string;
  agentId?: string;
  revision?: number;
  includeUntracked?: string[];
  validationPaths?: string[];
};
export type VariantResponse = {
  version: 1;
  requestId?: string;
  action: VariantRequest["action"];
  variant?: FrozenVariant;
  variants?: FrozenVariant[];
  preparation?: Awaited<ReturnType<VariantStore["prepare"]>>;
};

export function summarizeVariant(variant: FrozenVariant) {
  const { files, snapshotPath: _internalSource, ...summary } = variant;
  return { ...summary, files: { count: files.length, preview: files.slice(0, 10).map((file) => file.path), truncated: files.length > 10 } };
}

export async function executeVariantRequest(store: VariantStore, request: VariantRequest, signal?: AbortSignal): Promise<VariantResponse> {
  signal?.throwIfAborted();
  if (request.version !== undefined && request.version !== 1) throw new ExperimentError("invalid-version", "只支持实验契约版本1。");
  const experimentId = semanticId(request.experimentId);
  const response: VariantResponse = { version: 1, action: request.action, ...(request.requestId ? { requestId: request.requestId } : {}) };
  switch (request.action) {
    case "variant_prepare":
      response.preparation = await store.prepare({ experimentId, variantId: semanticId(request.variantId), agentId: semanticId(request.agentId), revision: request.revision, validationPaths: request.validationPaths });
      break;
    case "variant_freeze":
      response.variant = await store.freeze(experimentId, semanticId(request.variantId), request.revision, request.includeUntracked);
      break;
    case "variant_read":
      response.variant = await store.read(experimentId, semanticId(request.variantId), request.revision);
      break;
    case "variant_list":
      response.variants = await store.list(experimentId, request.revision);
      break;
    default:
      throw new ExperimentError("unsupported-action", "未知候选操作。");
  }
  return response;
}
