import type { Component } from "@earendil-works/pi-tui";
/** Width-aware border that uses only Pi TUI's public component contract. */
export declare class DynamicBorder implements Component {
    private readonly color;
    constructor(color?: (text: string) => string);
    invalidate(): void;
    render(width: number): string[];
}
