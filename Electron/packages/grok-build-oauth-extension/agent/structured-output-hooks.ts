/**
 * Production Structured Outputs seam: Pi `before_provider_request`.
 *
 * Official `emitBeforeProviderRequest` swallows ordinary handler throws.
 * Take / normalize / apply failures throw a tagged `PipiUIFatalHookError` so
 * PipiUI's runner patch can abort before the provider HTTP call. Host
 * `assertReadyToSend` still gates capability / Responses API.
 *
 * Official `after_provider_response` is `{status, headers}` only — no Responses
 * body (Pi types + sdk `onResponse`). Do not invent a fake body hook.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StructuredOutputController } from "./structured-output-controller.js";
import {
  applyStructuredOutput,
  fatalStructuredOutputError,
  normalizeStructuredOutputRequest,
  normalizeStructuredOutputResult,
  structuredOutputsEnabled,
  type StructuredOutputRequest,
  type StructuredOutputResult,
} from "./structured-output.js";

export type ProviderHookModel = {
  provider?: string;
  id?: string;
  api?: string;
  capabilities?: unknown;
};

export type ProviderHookContext = {
  model?: ProviderHookModel;
  sessionManager?: { getSessionId?: () => string };
};

export type BeforeProviderRequestEvent = {
  type?: string;
  payload?: unknown;
};

export type AfterProviderResponseEvent = {
  type?: string;
  status?: number;
  headers?: unknown;
  body?: unknown;
  response?: unknown;
  payload?: unknown;
};

export type StructuredOutputHookOptions = {
  controller?: StructuredOutputController;
  takeRequest?: (sessionId: string) => StructuredOutputRequest | undefined | Promise<StructuredOutputRequest | undefined>;
  onResult?: (result: StructuredOutputResult) => void | Promise<void>;
};

export type StructuredOutputHooks = {
  beforeProviderRequest: (
    event: BeforeProviderRequestEvent,
    ctx: ProviderHookContext,
  ) => Promise<Record<string, unknown> | undefined>;
  afterProviderResponse: (
    event: AfterProviderResponseEvent,
    ctx: ProviderHookContext,
  ) => Promise<void>;
  clearPending: () => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sessionIdOf(ctx: ProviderHookContext): string {
  return ctx.sessionManager?.getSessionId?.()?.trim() ?? "";
}

function isCompletionsPayload(payload: Record<string, unknown>): boolean {
  return Array.isArray(payload.messages) && !Array.isArray(payload.input);
}

function isResponsesApi(model: ProviderHookModel | undefined): boolean {
  const api = typeof model?.api === "string" ? model.api.trim().toLowerCase() : "";
  if (!api) return true;
  return api === "openai-responses" || api.endsWith("-responses") || api === "responses";
}

function responseBodyOf(event: AfterProviderResponseEvent): unknown {
  if (event.body !== undefined) return event.body;
  if (event.response !== undefined) return event.response;
  return undefined;
}

export async function takeStructuredOutputViaBridge(
  fetchImpl: typeof fetch = fetch,
): Promise<StructuredOutputRequest | undefined> {
  const port = process.env.PIPIUI_BRIDGE_PORT?.trim();
  const capability = process.env.PIPIUI_SESSION_CAPABILITY?.trim();
  if (!port || !capability) return undefined;
  const res = await fetchImpl(`http://127.0.0.1:${port}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(5_000),
    body: JSON.stringify({
      schemaVersion: 1,
      sessionCapability: capability,
      action: "structured_output",
      event: { op: "take" },
    }),
  });
  const json = (await res.json().catch(() => null)) as unknown;
  if (!isRecord(json) || json.ok !== true) {
    throw new Error("无法读取 Structured Output 请求，拒绝静默退化为普通发送");
  }
  if (json.result == null) return undefined;
  return normalizeStructuredOutputRequest(json.result);
}

export function createStructuredOutputHooks(
  options: StructuredOutputHookOptions = {},
): StructuredOutputHooks {
  const controller = options.controller ?? new StructuredOutputController();
  const takeRequest = options.takeRequest ?? ((sessionId: string) => {
    if (
      !options.controller
      && process.env.PIPIUI_BRIDGE_PORT?.trim()
      && process.env.PIPIUI_SESSION_CAPABILITY?.trim()
    ) {
      return takeStructuredOutputViaBridge();
    }
    return controller.take(sessionId);
  });
  let lastName: string | undefined;

  const clearPending = (): void => {
    lastName = undefined;
    controller.clearAll();
  };

  return {
    clearPending,

    async beforeProviderRequest(event, ctx) {
      if (!isRecord(event.payload)) return;
      const sessionId = sessionIdOf(ctx);
      if (!sessionId) return;

      let request: StructuredOutputRequest | undefined;
      try {
        request = await takeRequest(sessionId);
      } catch (error) {
        throw fatalStructuredOutputError(
          error instanceof Error && /structured output|Structured Output|拒绝/.test(error.message)
            ? error
            : "无法读取 Structured Output 请求，拒绝静默退化为普通发送",
        );
      }
      if (!request) return;

      lastName = request.name;
      try {
        if (!structuredOutputsEnabled(ctx.model?.capabilities)) {
          throw new Error("该模型未声明 structuredOutputs 能力，拒绝静默退化为普通发送");
        }
        if (!isResponsesApi(ctx.model) || isCompletionsPayload(event.payload)) {
          throw new Error("Structured Outputs 仅支持 Responses /responses，拒绝写入 chat/completions");
        }
        return applyStructuredOutput(event.payload, request, ctx.model?.capabilities);
      } catch (error) {
        throw fatalStructuredOutputError(error);
      }
    },

    async afterProviderResponse(event, _ctx) {
      const body = responseBodyOf(event);
      if (body === undefined) return;
      const result = normalizeStructuredOutputResult(body, lastName);
      lastName = undefined;
      await options.onResult?.(result);
    },
  };
}

export function registerStructuredOutputHooks(
  pi: Pick<ExtensionAPI, "on">,
  options?: StructuredOutputHookOptions,
): StructuredOutputHooks {
  const hooks = createStructuredOutputHooks(options);
  pi.on("before_provider_request", (event, ctx) => hooks.beforeProviderRequest(event, ctx));
  pi.on("after_provider_response", (event, ctx) => hooks.afterProviderResponse(event, ctx));
  pi.on("session_start", () => {
    hooks.clearPending();
  });
  pi.on("session_shutdown", () => {
    hooks.clearPending();
  });
  return hooks;
}
