import type { MenuScreenComponent, MultiSelectOptions } from "./contracts.js";
export declare function createMultiSelectComponent<ScreenId extends string, ActionId extends string>(options: MultiSelectOptions<ScreenId, ActionId>): MenuScreenComponent;
