import { type Input } from "@earendil-works/pi-tui";
import type { ActionMenuItem } from "../types.js";
import type { MenuKeybindings, MenuScreenComponentOptions } from "./contracts.js";
export { safeMenuText } from "../text.js";
export declare function actionMenuItemPresentation(item: ActionMenuItem<string, string>): {
    label: string;
    description?: string;
};
export declare function actionMenuUnavailableDescription(item: ActionMenuItem<string, string>): string | undefined;
export declare function actionMenuDialogLabel(item: ActionMenuItem<string, string>): string;
export declare function renderFrame<ScreenId extends string, ActionId extends string>(title: string, lines: readonly string[], content: readonly string[], destination: "back" | "close", width: number, options: MenuScreenComponentOptions<ScreenId, ActionId>, confirmAction?: string): string[];
export declare function menuHint(keybindings: MenuKeybindings, destination: "back" | "close", confirmAction: string): string;
export declare function handleSearchInput(input: Input, data: string): void;
