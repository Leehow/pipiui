import type { ExtensionCommandContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import type { MenuContext } from "./types.js";
type ExtensionMode = MenuContext["mode"];
export interface CustomInteractionComponent extends Component {
    dispose?(): void;
    waitForPending?(): Promise<void>;
}
export interface CustomInteractionContext<Value, Context extends MenuContext = ExtensionCommandContext> {
    ctx: Context;
    tui: TUI;
    theme: Theme;
    keybindings: KeybindingsManager;
    signal: AbortSignal;
    complete(value: Value): void;
}
export interface RunCustomInteractionOptions<Value, Context extends MenuContext = ExtensionCommandContext> {
    create(context: CustomInteractionContext<Value, Context>): CustomInteractionComponent | Promise<CustomInteractionComponent>;
    signal?: AbortSignal;
    isCurrent?(): boolean;
    onError?(ctx: Context, error: unknown): void | Promise<void>;
    onUnsupportedMode?(ctx: Context, mode: ExtensionMode): void | Promise<void>;
}
export type RunCustomInteractionResult<Value> = {
    kind: "completed";
    value: Value;
} | {
    kind: "stale";
} | {
    kind: "unsupported";
    mode: ExtensionMode;
} | {
    kind: "error";
    error: unknown;
};
/**
 * Run one extension-owned custom TUI interaction under explicit owner and disposal semantics.
 */
export declare function runCustomInteraction<Value, Context extends MenuContext = ExtensionCommandContext>(ctx: Context, options: RunCustomInteractionOptions<Value, Context>): Promise<RunCustomInteractionResult<Value>>;
export {};
