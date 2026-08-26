import type { ContextEvent, ExtensionAPI, ExtensionContext, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { HeadroomRuntime } from "./runtime.js";
export interface HeadroomRuntimeContract {
    start(ctx: ExtensionContext): Promise<boolean>;
    observeToolResult(event: ToolResultEvent, ctx: ExtensionContext): void;
    transform(messages: ContextEvent["messages"], ctx: ExtensionContext): ContextEvent["messages"] | undefined;
    retrieve(signal?: AbortSignal): Promise<string>;
    setEnabled(enabled: boolean): Promise<boolean>;
    health(): Promise<boolean>;
    activateFallback(reason: string): void;
    stop(): void;
    snapshot(): ReturnType<HeadroomRuntime["snapshot"]>;
}
export type RuntimeFactory = () => HeadroomRuntimeContract;
export declare function registerPipiuiHeadroom(pi: ExtensionAPI, runtimeFactory?: RuntimeFactory): void;
export default function pipiuiHeadroom(pi: ExtensionAPI): void;
