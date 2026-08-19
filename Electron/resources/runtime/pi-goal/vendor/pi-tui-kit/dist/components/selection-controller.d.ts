interface SelectionItem {
    id: string;
}
/** Package-internal stable-ID selection movement shared by choice interactions. */
export declare class SelectionController<Item extends SelectionItem> {
    #private;
    readonly items: readonly Item[];
    constructor(items: readonly Item[], initialItemId?: string);
    get selectedIndex(): number;
    get selectedItem(): Item | undefined;
    select(index: number): Item | undefined;
    move(delta: number): Item | undefined;
    page(delta: number, viewportSize: number): Item | undefined;
    first(): Item | undefined;
    last(): Item | undefined;
}
export {};
