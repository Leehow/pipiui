/**
 * Production Chat-with-Files seam: Pi `before_provider_request` /
 * `after_provider_response`.
 *
 * Reads the project-local JSON store (`{agentHome}/input-files/{sessionId}.json`)
 * and appends already-uploaded `{type:"input_file",file_id}` parts onto the
 * Responses payload when `capabilities.inputFiles === true`. Injection is
 * capability-gated, not provider-id-gated. Never uploads, never registers a
 * Pi tool, never writes paths/bytes/credentials into the request or the store.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { applyMaterializedInputFiles } from "./files/input.js";
import { SessionInputFileStore } from "./files/state.js";
import { modelHasInputFiles, type SafeInputFile } from "./files/types.js";
import { tryResolveAgentHome } from "./oauth/home.js";

export type ProviderHookModel = {
  provider?: string;
  id?: string;
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
};

export type InputFilesHookOptions = {
  resolveHome?: () => string | undefined;
  createStore?: (agentHome: string) => SessionInputFileStore;
};

type PendingInjection = {
  sessionId: string;
  modelId?: string;
  attachmentIds: string[];
};

export type InputFilesHooks = {
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

function is2xx(status: unknown): boolean {
  return typeof status === "number" && status >= 200 && status < 300;
}

function isCompletionsPayload(payload: Record<string, unknown>): boolean {
  return Array.isArray(payload.messages) && !Array.isArray(payload.input);
}

function unsentOf(files: readonly SafeInputFile[]): SafeInputFile[] {
  return files.filter((file) => file.sent !== true);
}

function isReadyWithFileId(file: SafeInputFile): boolean {
  return file.status === "ready" && typeof file.fileId === "string" && Boolean(file.fileId.trim());
}

function pendingStatusLabel(files: readonly SafeInputFile[]): string {
  const statuses = [...new Set(files.map((file) => file.status))];
  return statuses.join("/");
}

export function createInputFilesHooks(options: InputFilesHookOptions = {}): InputFilesHooks {
  const resolveHome = options.resolveHome ?? tryResolveAgentHome;
  const createStore = options.createStore ?? ((home: string) => new SessionInputFileStore(home));
  let pending: PendingInjection | undefined;

  const clearPending = (): void => {
    pending = undefined;
  };

  const storeFor = (home: string): SessionInputFileStore => createStore(home);

  return {
    clearPending,

    async beforeProviderRequest(event, ctx) {
      if (!isRecord(event.payload)) return;

      const home = resolveHome();
      const sessionId = sessionIdOf(ctx);
      if (!home || !sessionId) return;

      const attachments = await storeFor(home).list(sessionId);
      const unsent = unsentOf(attachments);
      if (unsent.length === 0) {
        clearPending();
        return;
      }

      if (!modelHasInputFiles(ctx.model)) {
        clearPending();
        throw new Error("该模型未声明 inputFiles 能力，拒绝静默丢弃未发送附件");
      }

      const blocked = unsent.filter((file) => !isReadyWithFileId(file));
      if (blocked.length > 0) {
        clearPending();
        throw new Error(`附件尚未就绪（${pendingStatusLabel(blocked)}），拒绝不带附件发送`);
      }

      if (isCompletionsPayload(event.payload)) {
        clearPending();
        throw new Error("Chat with Files 仅支持 Responses /responses，拒绝写入 chat/completions");
      }

      const next = applyMaterializedInputFiles(event.payload, unsent);
      pending = {
        sessionId,
        ...(typeof ctx.model?.id === "string" && ctx.model.id.trim() ? { modelId: ctx.model.id.trim() } : {}),
        attachmentIds: unsent.map((file) => file.id),
      };
      return next;
    },

    async afterProviderResponse(event, ctx) {
      const current = pending;
      if (!current) return;
      if (sessionIdOf(ctx) !== current.sessionId) return;
      if (current.modelId && ctx.model?.id && current.modelId !== ctx.model.id) return;

      if (!is2xx(event.status)) {
        clearPending();
        return;
      }

      const home = resolveHome();
      if (!home) {
        clearPending();
        return;
      }

      const store = storeFor(home);
      const attachments = await store.list(current.sessionId);
      const injected = new Set(current.attachmentIds);
      await store.write(
        current.sessionId,
        attachments.map((file) => (injected.has(file.id) ? { ...file, sent: true } : file)),
      );
      clearPending();
    },
  };
}

export function registerInputFilesHooks(
  pi: Pick<ExtensionAPI, "on">,
  options?: InputFilesHookOptions,
): InputFilesHooks {
  const hooks = createInputFilesHooks(options);
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
