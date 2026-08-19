import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { MenuContext } from "./types.js";
export type RunTaskResult<Value> = {
    kind: "completed";
    value: Value;
} | {
    kind: "cancelled";
} | {
    kind: "stale";
} | {
    kind: "error";
    error: unknown;
};
export interface RunTaskOptions<Value, Context extends MenuContext = ExtensionCommandContext> {
    label: string;
    task(context: {
        ctx: Context;
        signal: AbortSignal;
    }): Value | Promise<Value>;
    signal?: AbortSignal;
    isCurrent?(): boolean;
    cancellable?: boolean;
    onError?(ctx: Context, error: unknown): void | Promise<void>;
}
/**
 * Run abort-aware work with Pi's cancellable loader in TUI mode and the same
 * typed lifecycle result in every other mode.
 */
export declare function runTask<Value, Context extends MenuContext = ExtensionCommandContext>(ctx: Context, options: RunTaskOptions<Value, Context>): Promise<RunTaskResult<Value>>;
