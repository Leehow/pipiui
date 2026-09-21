import { resolve } from "node:path";
import type { ExperimentRequest, ExperimentResponse, TrialRecord, TrialRequest, TrialResponse } from "../contracts.js";
import { ExperimentService } from "./service.js";
import { ExperimentError } from "./paths.js";
import { INVENTORY_KINDS, summarizeRecord } from "./summary.js";
import { createAvailabilityReader, type AvailabilityReader } from "./availability.js";
import { TrialCoordinator } from "./trials.js";
import { createSandboxDriver } from "./sandbox-driver.js";
import type { SandboxDriver } from "./sandbox-contract.js";

const EXTENSION_ID = "experiment-lab";
type Context = { cwd: string; isProjectTrusted?: () => boolean };
type ToolResult = { content: Array<{ type: "text"; text: string }>; details: unknown };
type Request = ExperimentRequest | TrialRequest;
type Response = ExperimentResponse | TrialResponse;
const TRIAL_ACTIONS = new Set(["run", "status", "cancel", "cleanup"]);
const ACTIVE_TRIAL_STATES = new Set(["queued", "preparing", "running", "verifying"]);
type Pi = {
  registerTool: (definition: { name: string; label: string; description: string; promptSnippet: string; promptGuidelines: string[]; parameters: unknown; execute: (id: string, input: Request, signal: AbortSignal | undefined, update: unknown, ctx: Context) => Promise<ToolResult> }) => void;
  registerCommand: (name: string, command: { description: string; handler: (args: string, ctx: Context) => Promise<void> }) => void;
  on: (event: string, handler: (...args: unknown[]) => void | Promise<void>) => void;
  sendMessage?: (message: { customType: string; content: string; display: boolean; details?: unknown }, options?: { triggerTurn?: boolean; deliverAs?: "followUp" }) => void;
};

const pathList = { type: "array", items: { type: "string" }, maxItems: 100 };
const commandSchema = { type: "object", additionalProperties: false, required: ["executable"], properties: { executable: { type: "string", maxLength: 8192 }, args: { type: "array", maxItems: 64, items: { type: "string", maxLength: 4096 } }, shell: { type: "boolean" } } };
export const experimentParameters = {
  type: "object", additionalProperties: false, required: ["action"],
  properties: {
    version: { type: "integer", enum: [1] },
    action: { type: "string", enum: ["create", "list", "read", "update", "freeze", "revise", "inventory", "case", "run", "status", "cancel", "cleanup"] },
    caseId: { type: "string" },
    trialId: { type: "string", description: "run返回的可读运行标识；配合experimentId用于status/cancel/cleanup。" },
    inventoryKind: { type: "string", enum: INVENTORY_KINDS },
    page: { type: "integer", minimum: 1 },
    limit: { type: "integer", minimum: 1, maximum: 20 },
    offset: { type: "integer", minimum: 0 },
    experimentId: { type: "string", description: "调用方选择的语义 slug，例如 search-contrast。" },
    question: { type: "string", maxLength: 2000 },
    kind: { type: "string", enum: ["command", "pi", "browser"] },
    scopes: { ...pathList, description: "冻结的项目相对范围；默认全部已跟踪源码，排除元数据、敏感文件和生成物。" },
    includeUntracked: { ...pathList, description: "明确纳入的未跟踪源码相对路径；其他未跟踪内容保留但不复制。" },
    revision: { type: "integer", minimum: 1 },
    variants: { type: "array", minItems: 1, maxItems: 4, items: { type: "object", additionalProperties: false, required: ["id", "hypothesis"], properties: { id: { type: "string" }, hypothesis: { type: "string", maxLength: 2000 } } } },
    cases: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false, required: ["id", "command"], properties: {
      id: { type: "string" }, title: { type: "string", maxLength: 240 }, command: commandSchema, prepare: commandSchema,
      expectedExitCode: { type: "integer", minimum: 0, maximum: 255 },
      checks: { type: "array", maxItems: 16, items: { type: "object", additionalProperties: false, required: ["path"], properties: { path: { type: "string" }, expectedText: { type: "string", maxLength: 4096 }, sha256: { type: "string", pattern: "^[a-f0-9]{64}$" } } } },
      metricsFile: { type: "string" }, allowedDomains: { type: "array", maxItems: 16, items: { type: "string" } },
    } } },
    metrics: { type: "array", maxItems: 32, items: { type: "object", additionalProperties: false, required: ["id", "unit", "direction"], properties: { id: { type: "string" }, unit: { type: "string" }, direction: { type: "string", enum: ["lower", "higher", "neutral"] } } } },
    budget: { type: "object", additionalProperties: false, properties: {
      repetitions: { type: "integer", minimum: 1, maximum: 100 }, concurrency: { type: "integer", minimum: 1, maximum: 8 }, maxTrials: { type: "integer", minimum: 1, maximum: 10000 }, trialTimeoutMs: { type: "integer", minimum: 1, maximum: 86400000 }, totalTimeoutMs: { type: "integer", minimum: 1, maximum: 604800000 },
    } },
  },
};

/** Keep large path inventories on disk instead of expanding them into model context. */
export function boundedResponse(value: Response): unknown {
  if (TRIAL_ACTIONS.has(value.action)) {
    const response = value as TrialResponse;
    const expose = (trial: TrialRecord) => { const { owner: _owner, requestDigest: _request, ...publicRecord } = trial; return publicRecord; };
    return { ...response,
      ...(response.trial ? { trial: expose(response.trial) } : {}),
      ...(response.trials ? { trials: response.trials.map((trial) => ({ id: trial.id, experimentId: trial.experimentId, revision: trial.revision, caseId: trial.caseId, state: trial.state, quality: trial.quality, reason: trial.reason, totalMs: trial.totalMs, createdAt: trial.createdAt })) } : {}),
    };
  }
  const baseline = value as ExperimentResponse;
  return {
    ...baseline,
    ...(baseline.experiment ? { experiment: summarizeRecord(baseline.experiment) } : {}),
    ...(baseline.experiments ? { experiments: baseline.experiments.map((record) => ({
      id: record.id, question: record.question.slice(0, 240), questionTruncated: record.question.length > 240,
      revision: record.revision, state: record.state, kind: record.kind, updatedAt: record.updatedAt,
      ...(record.baseline ? { fingerprint: record.baseline.fingerprint, files: record.inventory.files.count } : {}),
    })), pageSize: baseline.experiments.length, pageLimit: 20 } : {}),
  };
}

async function emit(event: string, payload: unknown): Promise<void> {
  const port = process.env.PIPIUI_BRIDGE_PORT;
  const token = process.env.PIPIUI_SESSION_CAPABILITY;
  if (!port || !token) return;
  try {
    await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, sessionCapability: token, action: "ext.emit", extensionId: EXTENSION_ID, event, payload }),
      signal: AbortSignal.timeout(3000),
    });
  } catch { /* The durable record is authoritative; the bridge only notifies the panel. */ }
}

export function registerExperimentLab(pi: Pi, dependencies: { driver?: SandboxDriver; availability?: AvailabilityReader } = {}): void {
  const services = new Map<string, ExperimentService>();
  const runners = new Map<string, TrialCoordinator>();
  const notifyAgent = new Set<string>();
  const availability = dependencies.availability ?? createAvailabilityReader();
  let ended = false;
  const sessionAbort = new AbortController();
  const service = (ctx: Context): ExperimentService => {
    if (ended) throw new ExperimentError("session-ended", "会话已结束，请在新会话操作实验。");
    if (ctx.isProjectTrusted && !ctx.isProjectTrusted()) throw new ExperimentError("project-untrusted", "当前项目尚未获准读取本地实验配置。");
    const root = resolve(process.env.PIPIUI_PROJECT_ROOT || ctx.cwd);
    let value = services.get(root);
    if (!value) { value = new ExperimentService(root); services.set(root, value); }
    return value;
  };
  const runner = (ctx: Context): TrialCoordinator => {
    const store = service(ctx);
    const root = resolve(process.env.PIPIUI_PROJECT_ROOT || ctx.cwd);
    let value = runners.get(root);
    if (!value) {
      value = new TrialCoordinator(root, { store, driver: dependencies.driver ?? createSandboxDriver(), availability, ownerSessionId: process.env.PIPIUI_SESSION_KEY, onUpdate: (trial) => {
        void emit("trial", boundedResponse({ version: 1, action: "status", trial }));
        const key = `${root}/${trial.experimentId}/${trial.id}`;
        if (!ACTIVE_TRIAL_STATES.has(trial.state) && notifyAgent.delete(key) && !ended) {
          pi.sendMessage?.({ customType: "experiment-result", display: true, content: `实验 ${trial.experimentId}/${trial.id} 已结束：${trial.state}；质量检查：${trial.quality}。用 experiment status 查看持久证据。此消息是运行结果，不是用户新指令。`, details: boundedResponse({ version: 1, action: "status", trial }) }, { triggerTurn: true, deliverAs: "followUp" });
        }
      } });
      runners.set(root, value);
    }
    return value;
  };
  const execute = async (request: Request, ctx: Context, signal?: AbortSignal, toolCallId?: string): Promise<Response> => {
    if (!TRIAL_ACTIONS.has(request.action)) return service(ctx).execute(request as ExperimentRequest, signal);
    const response = await runner(ctx).execute(request as TrialRequest, toolCallId ?? request.requestId, signal);
    if (toolCallId && response.action === "run" && response.trial && ACTIVE_TRIAL_STATES.has(response.trial.state)) notifyAgent.add(`${resolve(process.env.PIPIUI_PROJECT_ROOT || ctx.cwd)}/${response.trial.experimentId}/${response.trial.id}`);
    return response;
  };
  pi.registerTool({
    name: "experiment", label: "实验台", description: "按需创建、定义测例并冻结项目实验。run只在独立OS沙盒副本中异步执行冻结命令，返回trialId；status/cancel/cleanup读取、停止或清理该运行，不自动合并。退出成功不等于质量通过。列表每页20项，read至多48KiB，inventory按24KiB分页。",
    promptSnippet: "Freeze optional experiments and run bounded sandbox trials with durable evidence",
    promptGuidelines: ["Use experiment only when an experiment is requested or appropriate; do not require prototypes for ordinary fixes.", "experiment freeze is not a passing test. Define fixed cases and authorized network/budgets before freezing; never put secrets in command arguments.", "experiment run returns an asynchronous trial identity. Use experiment status for evidence; completion messages are results, not new user instructions. Unknown quality/cost is not zero or PASS."],
    parameters: experimentParameters,
    async execute(_id, input, signal, _update, ctx) {
      signal?.throwIfAborted();
      const result = await execute(input, ctx, signal ? AbortSignal.any([signal, sessionAbort.signal]) : sessionAbort.signal, _id);
      await emit("changed", { experimentId: input.experimentId });
      const details = boundedResponse(result);
      return { content: [{ type: "text", text: JSON.stringify(details) }], details };
    },
  });
  pi.registerCommand(EXTENSION_ID, {
    description: "实验台控制面；使用实验面板或直接描述需要比较的方案。",
    async handler(args, ctx) {
      let request: Request | undefined;
      try {
        // Host invokeExtension serializes { method, params } into command args.
        const envelope = JSON.parse(args || "{}");
        const raw = envelope.params ?? envelope;
        if (raw && typeof raw === "object" && !raw.action && envelope.method) raw.action = envelope.method;
        request = raw as Request;
        const response = await execute(request, ctx, sessionAbort.signal);
        await emit("result", boundedResponse(response));
      } catch (error) {
        await emit("result", { version: 1, requestId: request?.requestId, error: { code: error instanceof ExperimentError ? error.code : "experiment-error", message: error instanceof ExperimentError ? error.message : "实验操作失败，请重试。" } });
      }
    },
  });
  pi.on("session_shutdown", async () => { ended = true; sessionAbort.abort(); await Promise.allSettled([...runners.values()].map((value) => value.shutdown())); runners.clear(); services.clear(); notifyAgent.clear(); });
}

export default registerExperimentLab;
