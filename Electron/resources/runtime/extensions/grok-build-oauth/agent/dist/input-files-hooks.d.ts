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
import { SessionInputFileStore } from "./files/state.js";
export type ProviderHookModel = {
    provider?: string;
    id?: string;
    capabilities?: unknown;
};
export type ProviderHookContext = {
    model?: ProviderHookModel;
    sessionManager?: {
        getSessionId?: () => string;
    };
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
export type InputFilesHooks = {
    beforeProviderRequest: (event: BeforeProviderRequestEvent, ctx: ProviderHookContext) => Promise<Record<string, unknown> | undefined>;
    afterProviderResponse: (event: AfterProviderResponseEvent, ctx: ProviderHookContext) => Promise<void>;
    clearPending: () => void;
};
export declare function createInputFilesHooks(options?: InputFilesHookOptions): InputFilesHooks;
export declare function registerInputFilesHooks(pi: Pick<ExtensionAPI, "on">, options?: InputFilesHookOptions): InputFilesHooks;
