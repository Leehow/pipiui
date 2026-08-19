import type { MenuCloseReason, MenuTransition } from "./types.js";
export interface MenuNavigator<ScreenId extends string> {
    readonly current: ScreenId;
    readonly closed: boolean;
    readonly closeReason: MenuCloseReason | undefined;
    apply(transition: MenuTransition<ScreenId>): "active" | "closed";
    rememberSelection(screen: ScreenId, itemId: string): void;
    selectionFor(screen: ScreenId, availableItemIds: readonly string[]): string | undefined;
}
export declare function createMenuNavigator<ScreenId extends string>(start: ScreenId): MenuNavigator<ScreenId>;
