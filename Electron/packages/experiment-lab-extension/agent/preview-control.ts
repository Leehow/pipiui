import type { PreviewCoordinator, PreviewRecord } from "./previews.js";
import { ExperimentError, semanticId } from "./paths.js";

export const PREVIEW_ACTIONS = new Set(["preview_start", "preview_status", "preview_list", "preview_stop", "preview_evidence"]);
export type PreviewRequest = {
  version?: 1; requestId?: string;
  action: "preview_start" | "preview_status" | "preview_list" | "preview_stop" | "preview_evidence";
  experimentId: string; previewId?: string; variantId?: string; revision?: number;
  entry?: string; fixturePaths?: string[]; cursor?: number; limit?: number; offset?: number;
};
export type PreviewResponse = {
  version: 1; requestId?: string; action: PreviewRequest["action"];
  preview?: PreviewRecord; previews?: PreviewRecord[];
  evidence?: Awaited<ReturnType<PreviewCoordinator["evidence"]>>;
};
export function boundedPreviewResponse(response: PreviewResponse) {
  return { ...response, ...(response.evidence ? { evidence: { ...response.evidence, items: response.evidence.items.map((item) => ({ ...item, pages: item.pages.map(({ observation, ...page }) => {
    const text = JSON.stringify(observation);
    return { ...page, observationPreview: text.slice(0, 1200), observationTruncated: text.length > 1200 };
  }) })) } } : {}) };
}
export async function executePreviewRequest(coordinator: PreviewCoordinator, request: PreviewRequest, signal?: AbortSignal): Promise<PreviewResponse> {
  signal?.throwIfAborted();
  if (request.version !== undefined && request.version !== 1) throw new ExperimentError("invalid-version", "只支持实验契约版本1。");
  const experimentId = semanticId(request.experimentId);
  const limit = request.limit ?? 20, offset = request.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20 || !Number.isInteger(offset) || offset < 0) throw new ExperimentError("invalid-page", "预览列表每页1至20项，offset为非负整数。");
  const response: PreviewResponse = { version: 1, action: request.action, ...(request.requestId ? { requestId: request.requestId } : {}) };
  if (request.action === "preview_list") { response.previews = (await coordinator.list(experimentId)).slice(offset, offset + limit); return response; }
  const previewId = semanticId(request.previewId);
  switch (request.action) {
    case "preview_start": response.preview = await coordinator.start({ experimentId, previewId, variantId: semanticId(request.variantId), revision: request.revision, entry: request.entry, fixturePaths: request.fixturePaths }); break;
    case "preview_status": response.preview = await coordinator.get(experimentId, previewId); break;
    case "preview_stop": response.preview = await coordinator.stop(experimentId, previewId); break;
    case "preview_evidence": response.evidence = await coordinator.evidence(experimentId, previewId, { cursor: request.cursor, limit }); break;
    default: throw new ExperimentError("unsupported-action", "未知预览操作。");
  }
  return response;
}
