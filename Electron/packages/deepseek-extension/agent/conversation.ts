/**
 * Conversation request adapter for contributed DeepSeek chat models.
 *
 * Pi's built-in `openai-responses` streamer is the session transport
 * (`api` + `baseUrl` + stored API key). This module is the host-owned,
 * testable seam: HTTPS Responses URLs, Bearer from the Pi credential store
 * (settings fallback), fail-closed without a key, and no key material in
 * thrown messages.
 */

import {
  buildDeepSeekRequest,
  buildDeepSeekRequestAsync,
  type DeepSeekEndpoint,
  type DeepSeekRequest,
  type FilesRewriteOptions,
} from "./client.js";
import { resolveBaseUrl, resolveSettingsApiKey } from "./config.js";
import { DeepSeekFilesClient } from "./files/client.js";
import { DEEPSEEK_BASE_URL, DEEPSEEK_CHAT_API } from "./models.js";

export { DEEPSEEK_BASE_URL, DEEPSEEK_CHAT_API };

const MISSING_KEY = "未配置 DeepSeek API key — 请先 /login deepseek 或在设置中填写 ext.deepseek.apiKey";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Pull the API key out of a Pi credential. Never returns refresh tokens. */
export function apiKeyFromCredentials(credentials: unknown): string {
  if (typeof credentials === "string" && credentials.trim()) return credentials.trim();
  if (!isRecord(credentials)) {
    throw new Error(MISSING_KEY);
  }
  const key = credentials.key;
  if (typeof key === "string" && key.trim()) return key.trim();
  const access = credentials.access;
  if (typeof access === "string" && access.trim()) return access.trim();
  throw new Error(MISSING_KEY);
}

/**
 * Pi credential store first, then `ext.deepseek.apiKey`.
 * Throws a user-actionable message and never echoes secrets.
 */
export function resolveDeepSeekApiKey(credentials?: unknown): string {
  if (credentials !== undefined) {
    try {
      return apiKeyFromCredentials(credentials);
    } catch (error) {
      if (resolveSettingsApiKey()) {
        /* fall through to settings */
      } else {
        throw error;
      }
    }
  }
  const fallback = resolveSettingsApiKey();
  if (fallback) return fallback;
  throw new Error(MISSING_KEY);
}

function requireModelId(modelId: unknown): string {
  const id = typeof modelId === "string" ? modelId.trim() : "";
  if (!id) throw new Error("缺少 DeepSeek 对话模型 id");
  return id;
}

/** Same credential chain as conversation requests: Pi store first, then settings. */
export function createConversationFilesClient(input: {
  credentials?: unknown;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
} = {}): DeepSeekFilesClient {
  return new DeepSeekFilesClient({
    baseUrl: resolveBaseUrl(input.baseUrl),
    apiKey: resolveDeepSeekApiKey(input.credentials),
    fetchImpl: input.fetchImpl,
  });
}

export function buildConversationRequest(input: {
  modelId: string;
  credentials?: unknown;
  messages?: unknown;
  input?: unknown;
  instructions?: string;
  baseUrl?: string;
  endpoint?: DeepSeekEndpoint;
  extra?: Record<string, unknown>;
}): DeepSeekRequest {
  const apiKey = resolveDeepSeekApiKey(input.credentials);
  return buildDeepSeekRequest({
    endpoint: input.endpoint ?? "responses",
    model: requireModelId(input.modelId),
    apiKey,
    baseUrl: input.baseUrl,
    messages: input.messages,
    input: input.input,
    instructions: input.instructions,
    extra: input.extra,
  });
}

export async function buildConversationRequestAsync(
  input: {
    modelId: string;
    credentials?: unknown;
    messages?: unknown;
    input?: unknown;
    instructions?: string;
    baseUrl?: string;
    endpoint?: DeepSeekEndpoint;
    extra?: Record<string, unknown>;
    fetchImpl?: typeof fetch;
  } & FilesRewriteOptions,
): Promise<DeepSeekRequest> {
  const apiKey = resolveDeepSeekApiKey(input.credentials);
  return buildDeepSeekRequestAsync({
    endpoint: input.endpoint ?? "responses",
    model: requireModelId(input.modelId),
    apiKey,
    baseUrl: input.baseUrl,
    messages: input.messages,
    input: input.input,
    instructions: input.instructions,
    extra: input.extra,
    files: input.files,
    filesClient: input.filesClient ?? createConversationFilesClient(input),
    fileCache: input.fileCache,
    limits: input.limits,
    fetchImpl: input.fetchImpl,
    signal: input.signal,
  });
}

/** Provider-level transport fields consumed by Pi ModelRuntime. */
export function conversationProviderTransport(): {
  api: typeof DEEPSEEK_CHAT_API;
  baseUrl: string;
  authHeader: true;
} {
  return {
    api: DEEPSEEK_CHAT_API,
    baseUrl: resolveBaseUrl(),
    authHeader: true,
  };
}
