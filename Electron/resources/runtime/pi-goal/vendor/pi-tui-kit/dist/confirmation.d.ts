import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { MenuCloseReason, MenuContext } from "./types.js";
type ExtensionMode = MenuContext["mode"];
export interface RunConfirmationOptions<Context extends MenuContext = ExtensionCommandContext> {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    signal?: AbortSignal;
    isCurrent?(): boolean;
    onError?(ctx: Context, error: unknown): void | Promise<void>;
    onUnsupportedMode?(ctx: Context, mode: ExtensionMode): void | Promise<void>;
}
export type RunConfirmationResult = {
    kind: "confirmed";
} | {
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
/** Run one standalone confirmation without absorbing the caller's confirmed side effect. */
export declare function runConfirmation<Context extends MenuContext = ExtensionCommandContext>(ctx: Context, options: RunConfirmationOptions<Context>): Promise<RunConfirmationResult>;
export {};
