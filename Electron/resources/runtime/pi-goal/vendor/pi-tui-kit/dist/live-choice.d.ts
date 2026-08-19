import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { type KeyId } from "@earendil-works/pi-tui";
import type { MenuCloseReason, MenuContext } from "./types.js";
type ExtensionMode = MenuContext["mode"];
export interface LiveChoiceItem<ItemId extends string = string> {
    id: ItemId;
    label: string;
    description?: string;
    details?: readonly string[];
    disabled?: boolean;
    disabledReason?: string;
    confirmationDisabled?: boolean;
    confirmationDisabledReason?: string;
}
export interface LiveChoiceShortcut<ShortcutId extends string = string> {
    id: ShortcutId;
    keys: readonly KeyId[];
    label: string;
}
export interface LiveChoiceSelectionContext<Item extends LiveChoiceItem, Context extends MenuContext = ExtensionCommandContext> {
    ctx: Context;
    item: Item;
    signal: AbortSignal;
}
export interface RunLiveChoiceOptions<Item extends LiveChoiceItem, ShortcutId extends string = never, Context extends MenuContext = ExtensionCommandContext> {
    title: string;
    lines?: readonly string[];
    items: readonly Item[];
    currentItemId?: Item["id"];
    initialItemId?: Item["id"];
    viewportSize?: number;
    hint?: MenuCloseReason;
    navigationLabel?: string;
    confirmLabel?: string;
    shortcuts?: readonly LiveChoiceShortcut<ShortcutId>[];
    onSelectionChange?(context: LiveChoiceSelectionContext<Item, Context>): void | Promise<void>;
    signal?: AbortSignal;
    isCurrent?(): boolean;
    onError?(ctx: Context, error: unknown): void | Promise<void>;
    onUnsupportedMode?(ctx: Context, mode: ExtensionMode): void | Promise<void>;
}
export type RunLiveChoiceResult<ItemId extends string = string, ShortcutId extends string = string> = {
    kind: "selected";
    itemId: ItemId;
} | {
    kind: "shortcut";
    shortcutId: ShortcutId;
    itemId: ItemId;
} | {
    kind: "closed";
    reason: MenuCloseReason;
} | {
    kind: "stale";
} | {
    kind: "unsupported";
    mode: ExtensionMode;
} | {
    kind: "error";
    error: unknown;
};
/** Run a standalone choice interaction whose cursor can drive consumer-owned live previews. */
export declare function runLiveChoice<const Item extends LiveChoiceItem, ShortcutId extends string = never, Context extends MenuContext = ExtensionCommandContext>(ctx: Context, options: RunLiveChoiceOptions<Item, ShortcutId, Context>): Promise<RunLiveChoiceResult<Item["id"], ShortcutId>>;
export {};
