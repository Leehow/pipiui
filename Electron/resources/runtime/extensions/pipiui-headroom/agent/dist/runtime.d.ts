import type { ContextEvent, ExtensionContext, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { type ManagedServiceState } from "./managed-service.js";
import type { HeadroomConfig, RuntimeSnapshot } from "./types.js";
import { type WorkerClient } from "./worker.js";
export interface HeadroomRuntimeOptions {
    config: HeadroomConfig;
    warnings?: string[];
    client?: WorkerClient;
    managedStateReader?: () => Promise<ManagedServiceState | undefined>;
    managedPollIntervalMs?: number;
}
export declare class HeadroomRuntime {
    #private;
    constructor(options: HeadroomRuntimeOptions);
    start(ctx: ExtensionContext): Promise<boolean>;
    observeToolResult(event: ToolResultEvent, ctx: ExtensionContext): void;
    transform(messages: ContextEvent["messages"], ctx: ExtensionContext): ContextEvent["messages"] | undefined;
    retrieve(signal?: AbortSignal): Promise<string>;
    setEnabled(enabled: boolean): Promise<boolean>;
    health(): Promise<boolean>;
    activateFallback(reason: string): void;
    stop(): void;
    snapshot(): RuntimeSnapshot;
}
