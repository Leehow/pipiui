import type { MenuScreen, ReviewScreen } from "../types.js";
import type { MenuScreenComponent, MenuScreenComponentOptions } from "./contracts.js";
export type ReviewOptions<ScreenId extends string, ActionId extends string> = MenuScreenComponentOptions<ScreenId, ActionId> & {
    screen: Extract<MenuScreen<ScreenId, ActionId>, {
        kind: "review";
    }>;
};
export declare function createReviewComponent<ScreenId extends string, ActionId extends string>(options: ReviewOptions<ScreenId, ActionId>): MenuScreenComponent;
export declare function reviewDialogPages<ActionId extends string>(screen: ReviewScreen<ActionId>): string[][];
