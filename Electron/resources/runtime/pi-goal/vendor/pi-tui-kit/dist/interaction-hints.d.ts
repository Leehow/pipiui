export interface InteractionKeybindings<Binding extends string = string> {
    getKeys(binding: Binding): readonly string[];
}
export interface InteractionHint<Binding extends string = string> {
    bindings?: readonly Binding[];
    keys?: readonly string[];
    excludeKeys?: readonly string[];
    label: string;
}
export interface FormatInteractionHintsOptions {
    separator?: string;
}
/** Format width-neutral interaction hints from Pi keybindings and literal shortcut keys. */
export declare function formatInteractionHints<Binding extends string>(keybindings: InteractionKeybindings<Binding>, hints: readonly InteractionHint<Binding>[], options?: FormatInteractionHintsOptions): string;
