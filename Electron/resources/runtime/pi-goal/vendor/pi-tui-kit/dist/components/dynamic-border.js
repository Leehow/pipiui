/** Width-aware border that uses only Pi TUI's public component contract. */
export class DynamicBorder {
    color;
    constructor(color = (text) => text) {
        this.color = color;
    }
    invalidate() { }
    render(width) {
        return [this.color("─".repeat(Math.max(1, width)))];
    }
}
