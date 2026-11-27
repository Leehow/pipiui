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
    signal?: AbortSignal;
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
    providerAttemptEnded: (sessionId: string, failed: boolean) => void;
    clearAttempt: () => void;
    clearPending: () => void;
};
export declare function takeStructuredOutputViaBridge(fetchImpl?: typeof fetch, ctx?: ProviderHookContext): Promise<StructuredOutputRequest | undefined>;
export declare function createStructuredOutputHooks(options?: StructuredOutputHookOptions): StructuredOutputHooks;
export declare function registerStructuredOutputHooks(pi: Pick<ExtensionAPI, "on">, options?: StructuredOutputHookOptions): StructuredOutputHooks;
