/**
 * Conversation request adapter for contributed Grok Build chat models.
 *
 * Pi's built-in `openai-responses` streamer is the session transport
 * (`api` + `baseUrl` + `oauth.getApiKey`). This module is the host-owned,
 * testable seam: HTTPS-only Responses URL, Bearer from App-profile
 * OAuth credentials, fail-closed without an access token, no token
 * material in thrown messages, hosted `web_search` / `x_search` only when
 * the catalog declares `nativeSearch` (no default-search fallback),
 * hosted `code_interpreter` when the model declares it (plus Responses
 * `include: ["code_interpreter_call.outputs"]`), optional structured
 * output via `applyStructuredOutput` (Responses `text.format` /
 * `json_schema`, never a tool), and optional materialized input files
 * (`{type:"input_file",file_id}`) last.
 */
import { GROK_BUILD_BASE_URL, GROK_BUILD_CHAT_API } from "./models.js";
import { type NativeSearchCapability } from "./hosted-search.js";
import { type StructuredOutputRequest } from "./structured-output.js";
import { type MaterializedInputFile, type SafeInputFile } from "./files/types.js";
export { GROK_BUILD_BASE_URL, GROK_BUILD_CHAT_API };
export { applyStructuredOutput, normalizeStructuredOutputResult, structuredOutputsEnabled, type StructuredOutputRequest, type StructuredOutputResult, } from "./structured-output.js";
export { applyMaterializedInputFiles } from "./files/input.js";
export { modelHasInputFiles, type MaterializedInputFile, type SafeInputFile } from "./files/types.js";
export type ConversationRequest = {
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
};
/** Pull the access token out of a Pi OAuth credential. Never returns refresh. */
export declare function accessTokenFromCredentials(credentials: unknown): string;
export declare function buildConversationRequest(input: {
    modelId: string;
    credentials: unknown;
    input?: unknown;
    messages?: unknown;
    tools?: unknown;
    nativeSearch?: NativeSearchCapability;
    capabilities?: unknown;
    codeInterpreter?: boolean;
    structuredOutput?: StructuredOutputRequest;
    inputFiles?: readonly (MaterializedInputFile | SafeInputFile)[];
    baseUrl?: string;
}): ConversationRequest;
/** Provider-level transport fields consumed by Pi ModelRuntime. */
export declare function conversationProviderTransport(): {
    api: typeof GROK_BUILD_CHAT_API;
    baseUrl: string;
    authHeader: true;
};
