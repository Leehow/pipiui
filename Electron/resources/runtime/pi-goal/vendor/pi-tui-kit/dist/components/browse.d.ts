import type { MenuBrowseItem } from "../types.js";
import type { BrowseOptions, MenuScreenComponent } from "./contracts.js";
export declare function createBrowseComponent<ScreenId extends string, ActionId extends string>(options: BrowseOptions<ScreenId, ActionId>): MenuScreenComponent;
export declare function browseDialogLabel(item: MenuBrowseItem): string;
export declare function browseDialogPages(item: MenuBrowseItem): string[][];
