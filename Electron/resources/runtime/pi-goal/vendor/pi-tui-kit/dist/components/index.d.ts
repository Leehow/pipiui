import type { MenuScreen, MenuSettingItem } from "../types.js";
import type { MenuScreenComponent, MenuScreenComponentOptions } from "./contracts.js";
export { browseDialogLabel, browseDialogPages } from "./browse.js";
export type { MenuInputSubmit, MenuMultiSelectChange, MenuScreenComponent, MenuScreenComponentOptions, MenuScreenEvent, MenuSettingChange, } from "./contracts.js";
export { prepareMenuScreenRendering } from "./mermaid.js";
export { actionMenuDialogLabel, safeMenuText } from "./rendering.js";
export { reviewDialogPages } from "./review.js";
export declare function createMenuScreenComponent<ScreenId extends string, ActionId extends string>(options: MenuScreenComponentOptions<ScreenId, ActionId>): MenuScreenComponent;
export declare function settingForAction<ActionId extends string>(screen: Extract<MenuScreen<string, ActionId>, {
    kind: "settings";
}>, itemId: string): MenuSettingItem<ActionId> | undefined;
