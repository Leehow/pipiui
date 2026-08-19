import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { type MenuContext, type MenuDefinition, type MenuScreen } from "./types.js";
export declare function defineMenu<State, ScreenId extends string, ActionId extends string, Context extends MenuContext = ExtensionCommandContext>(definition: MenuDefinition<State, ScreenId, ActionId, Context>): MenuDefinition<State, ScreenId, ActionId, Context>;
export declare function resolveMenuScreen<State, ScreenId extends string, ActionId extends string, Context extends MenuContext>(definition: MenuDefinition<State, ScreenId, ActionId, Context>, screenId: ScreenId, state: State): MenuScreen<ScreenId, ActionId>;
