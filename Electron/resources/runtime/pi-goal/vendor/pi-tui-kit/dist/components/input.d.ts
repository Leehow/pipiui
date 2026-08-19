import type { MenuScreen } from "../types.js";
import type { MenuScreenComponent, MenuScreenComponentOptions } from "./contracts.js";
export type InputOptions<ScreenId extends string, ActionId extends string> = MenuScreenComponentOptions<ScreenId, ActionId> & {
    screen: Extract<MenuScreen<ScreenId, ActionId>, {
        kind: "input";
    }>;
};
export declare function createInputComponent<ScreenId extends string, ActionId extends string>(options: InputOptions<ScreenId, ActionId>): MenuScreenComponent;
