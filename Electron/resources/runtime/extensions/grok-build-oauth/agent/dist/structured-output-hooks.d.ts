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
import { type StructuredOutputRequest, type StructuredOutputResult } from "./structured-output.js";
export type ProviderHookModel = {
    provider?: string;
    id?: string;
    api?: string;
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
    beforeProviderRequest: (event: BeforeProviderRequestEvent, ctx: ProviderHookContext) => Promise<Record<string, unknown> | undefined>;
    afterProviderResponse: (event: AfterProviderResponseEvent, ctx: ProviderHookContext) => Promise<void>;
    clearPending: () => void;
};
export declare function takeStructuredOutputViaBridge(fetchImpl?: typeof fetch): Promise<StructuredOutputRequest | undefined>;
export declare function createStructuredOutputHooks(options?: StructuredOutputHookOptions): StructuredOutputHooks;
export declare function registerStructuredOutputHooks(pi: Pick<ExtensionAPI, "on">, options?: StructuredOutputHookOptions): StructuredOutputHooks;
