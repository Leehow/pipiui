import type { MenuContext, MenuDefinition, MenuScreen, MenuTransition } from "./types.js";
export type MenuInteraction = {
    kind: "activate";
    itemId: string;
} | {
    kind: "setting";
    itemId: string;
    value: string;
} | {
    kind: "multiSelect";
    itemId: string;
    selected: boolean;
} | {
    kind: "input";
    value: string;
};
export interface InteractionInvocation<ScreenId extends string> {
    accepted: boolean;
    stale: boolean;
    transition: MenuTransition<ScreenId>;
    selectionItemId?: string;
}
interface InteractionRuntimeOptions<Context extends MenuContext> {
    isCurrent?(): boolean;
    onError?(ctx: Context, error: unknown): void | Promise<void>;
}
interface InvokeMenuInteractionOptions<State, ScreenId extends string, ActionId extends string, Context extends MenuContext> {
    ctx: Context;
    definition: MenuDefinition<State, ScreenId, ActionId, Context>;
    screen: MenuScreen<ScreenId, ActionId>;
    state: State;
    menuSignal: AbortSignal;
    interactionSignal?: AbortSignal;
    runtime: InteractionRuntimeOptions<Context>;
    interaction: MenuInteraction;
}
export declare function invokeMenuInteraction<State, ScreenId extends string, ActionId extends string, Context extends MenuContext>(options: InvokeMenuInteractionOptions<State, ScreenId, ActionId, Context>): Promise<InteractionInvocation<ScreenId>>;
export declare function reportMenuError<Context extends MenuContext>(ctx: Context, runtime: InteractionRuntimeOptions<Context>, error: unknown): Promise<void>;
export declare function isMenuCurrent<Context extends MenuContext>(runtime: InteractionRuntimeOptions<Context>): boolean;
export {};
