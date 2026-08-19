/** Package-internal stable-ID selection movement shared by choice interactions. */
export class SelectionController {
    items;
    #selectedIndex;
    constructor(items, initialItemId) {
        this.items = items;
        const initialIndex = initialItemId ? items.findIndex((item) => item.id === initialItemId) : -1;
        this.#selectedIndex = items.length === 0 ? -1 : Math.max(0, initialIndex);
    }
    get selectedIndex() {
        return this.#selectedIndex;
    }
    get selectedItem() {
        return this.items[this.#selectedIndex];
    }
    select(index) {
        if (this.items.length === 0)
            return undefined;
        this.#selectedIndex = Math.max(0, Math.min(index, this.items.length - 1));
        return this.selectedItem;
    }
    move(delta) {
        if (this.items.length === 0)
            return undefined;
        this.#selectedIndex =
            (((this.#selectedIndex + delta) % this.items.length) + this.items.length) % this.items.length;
        return this.selectedItem;
    }
    page(delta, viewportSize) {
        return this.select(this.#selectedIndex + delta * Math.max(1, viewportSize));
    }
    first() {
        return this.select(0);
    }
    last() {
        return this.select(this.items.length - 1);
    }
}
