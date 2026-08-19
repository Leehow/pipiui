import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { MenuCloseReason, MenuContext, MenuDefinition } from "./types.js";
type ExtensionMode = MenuContext["mode"];
export type RunMenuResult = {
    kind: "closed";
    reason: MenuCloseReason;
} | {
    kind: "stale";
} | {
    kind: "unsupported";
    mode: ExtensionMode;
} | {
    kind: "error";
    error: unknown;
};
export interface RunMenuOptions<State, Context extends MenuContext = ExtensionCommandContext> {
    getState(context: {
        ctx: Context;
        signal: AbortSignal;
    }): State | Promise<State>;
    signal?: AbortSignal;
    isCurrent?(): boolean;
    onError?(ctx: Context, error: unknown): void | Promise<void>;
    onUnsupportedMode?(ctx: Context, mode: ExtensionMode): void | Promise<void>;
}
export declare function runMenu<State, ScreenId extends string, ActionId extends string, Context extends MenuContext = ExtensionCommandContext>(ctx: Context, definition: MenuDefinition<State, ScreenId, ActionId, Context>, options: RunMenuOptions<State, Context>): Promise<RunMenuResult>;
export {};
