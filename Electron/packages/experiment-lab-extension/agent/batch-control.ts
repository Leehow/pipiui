import type { ExperimentBudget } from "../contracts.js";
import type { BatchInput, BatchLogPage, BatchLogView, BatchRecord, BatchSummary, BatchTrial, BatchVariantInput, PiCase } from "./batch-contract.js";
import { ExperimentError, semanticId } from "./paths.js";

export const BATCH_ACTIONS = new Set(["batch_run", "batch_status", "batch_list", "batch_cancel", "batch_logs", "batch_respond", "batch_view"]);
const ACTIVE = new Set(["preparing", "running", "waiting-input", "verifying"]);
export type BatchRequest = {
  version?: 1;
  requestId?: string;
  action: "batch_run" | "batch_status" | "batch_list" | "batch_cancel" | "batch_logs" | "batch_respond" | "batch_view";
  experimentId: string;
  batchId?: string;
  revision?: number;
  profiles?: BatchVariantInput[];
  piCases?: PiCase[];
  budget?: Partial<ExperimentBudget>;
  mode?: "comparison" | "throughput";
  trialId?: string;
  cursor?: number;
  logLimit?: number;
  limit?: number;
  offset?: number;
  inputRequestId?: string;
  response?: { value?: string; confirmed?: boolean; cancelled?: boolean };
};
export type BatchView = BatchRecord | BatchSummary;
export type BatchResponse = {
  version: 1;
  action: BatchRequest["action"];
  requestId?: string;
  batch?: BatchView;
  batches?: BatchView[];
  log?: BatchLogPage;
  view?: BatchLogView;
  responded?: boolean;
};
/** The control layer depends on behavior, not ownership of running processes. */
export type BatchControlPort = {
  start(input: BatchInput): Promise<BatchRecord>;
  get(experimentId: string, batchId: string): Promise<BatchView>;
  list(experimentId: string, limit?: number, offset?: number): Promise<BatchView[]>;
  cancel(experimentId: string, batchId: string): Promise<BatchView>;
  cancelTrial(experimentId: string, batchId: string, trialId: string): Promise<BatchView>;
  logs(experimentId: string, batchId: string, trialId: string, cursor?: number, limit?: number): Promise<BatchLogPage>;
  view(experimentId: string, batchId: string, trialId: string): Promise<BatchLogView>;
  respond(experimentId: string, batchId: string, trialId: string, inputRequestId: string, response: { value?: string; confirmed?: boolean; cancelled?: boolean }): Promise<unknown>;
};

export function summarizeBatch(record: BatchView, trialId?: string, limit = 20, offset = 0) {
  const states: Partial<Record<BatchTrial["state"], number>> = {};
  for (const trial of record.trials) states[trial.state] = (states[trial.state] ?? 0) + 1;
  const active = record.trials.filter((trial) => ACTIVE.has(trial.state)).length;
  const queued = states.queued ?? 0;
  const selected = trialId ? record.trials.filter((trial) => trial.id === trialId) : record.trials.slice(offset, offset + limit);
  if (trialId && !selected.length) throw new ExperimentError("trial-not-found", "该批次没有此轮运行。");
  // Native summaries already omit these fields; full start receipts do not.
  const { owner: _owner, cases: _cases, trials: _trials, variants, ...rest } = record as BatchRecord;
  const trials: BatchSummary["trials"] = selected.map(({ run, ...trial }) => ({ ...trial, ...(run ? { run: { state: run.state, totalMs: run.totalMs, usage: run.usage, stopReason: run.stopReason, toolCalls: run.toolCalls } } : {}) }));
  return {
    ...rest,
    // Long system prompts and source inventories stay in the saved definition.
    variants: variants.map(({ profile, ...variant }) => ({ ...variant, profile: { id: profile.id, provider: profile.provider, model: profile.model, thinking: profile.thinking, tools: profile.tools, extensionCount: profile.extensions?.length ?? 0, skillCount: profile.skills?.length ?? 0 } })),
    progress: { queued, active, finished: record.trials.length - queued - active, total: record.trials.length, states },
    trials, page: { offset, limit, returned: trials.length, total: record.trials.length },
  };
}
export function boundedBatchResponse(response: BatchResponse, request?: BatchRequest) {
  const limit = request?.limit ?? 20;
  const offset = request?.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20 || !Number.isInteger(offset) || offset < 0) throw new ExperimentError("invalid-page", "状态查询每页1至20项，offset为非负整数。");
  return { ...response,
    ...(response.batch ? { batch: summarizeBatch(response.batch, request?.trialId, limit, offset) } : {}),
    ...(response.batches ? { batches: response.batches.map((batch) => summarizeBatch(batch, undefined, 0)) } : {}),
  };
}

export async function executeBatchRequest(port: BatchControlPort, request: BatchRequest, signal?: AbortSignal): Promise<BatchResponse> {
  signal?.throwIfAborted();
  if (request.version !== undefined && request.version !== 1) throw new ExperimentError("invalid-version", "只支持实验契约版本1。");
  const experimentId = semanticId(request.experimentId);
  if ((request.limit !== undefined && (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 20)) || (request.offset !== undefined && (!Number.isInteger(request.offset) || request.offset < 0))) throw new ExperimentError("invalid-page", "状态查询每页1至20项，offset为非负整数。");
  const response: BatchResponse = { version: 1, action: request.action, ...(request.requestId ? { requestId: request.requestId } : {}) };
  if (request.action === "batch_list") {
    response.batches = await port.list(experimentId, request.limit, request.offset);
    return response;
  }
  const batchId = semanticId(request.batchId);
  switch (request.action) {
    case "batch_run":
      if (!Array.isArray(request.profiles) || !Array.isArray(request.piCases)) throw new ExperimentError("invalid-batch", "Pi 批次需要明确方案配置 profiles 与共同测例 piCases。");
      response.batch = await port.start({ experimentId, batchId, revision: request.revision, variants: request.profiles, cases: request.piCases, budget: request.budget, mode: request.mode });
      break;
    case "batch_status": response.batch = await port.get(experimentId, batchId); break;
    case "batch_cancel":
      response.batch = request.trialId
        ? await port.cancelTrial(experimentId, batchId, semanticId(request.trialId))
        : await port.cancel(experimentId, batchId);
      break;
    case "batch_view": response.view = await port.view(experimentId, batchId, semanticId(request.trialId)); break;
    case "batch_logs": response.log = await port.logs(experimentId, batchId, semanticId(request.trialId), request.cursor, request.logLimit); break;
    case "batch_respond":
      if (typeof request.inputRequestId !== "string" || !request.inputRequestId || !request.response || typeof request.response !== "object" || Array.isArray(request.response)) throw new ExperimentError("invalid-response", "需要该轮实际输入请求身份与回复。");
      await port.respond(experimentId, batchId, semanticId(request.trialId), request.inputRequestId, request.response);
      response.responded = true;
      break;
    default: throw new ExperimentError("unsupported-action", "未知批次操作。");
  }
  return response;
}
