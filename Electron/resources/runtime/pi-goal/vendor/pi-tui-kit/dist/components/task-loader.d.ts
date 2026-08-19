import { Container, type TUI } from "@earendil-works/pi-tui";
import type { MenuKeybindings } from "./contracts.js";
interface TaskLoaderTheme {
    fg(color: "accent" | "border" | "dim" | "muted", text: string): string;
}
/** Cancellable loader composed from public Pi TUI primitives and callback-owned inputs. */
export declare class TaskLoader extends Container {
    private readonly keybindings;
    private readonly loader;
    private readonly cancellable;
    private disposed;
    onAbort?: () => void;
    constructor(tui: TUI, theme: TaskLoaderTheme, keybindings: MenuKeybindings, message: string, options?: {
        cancellable?: boolean;
    });
    handleInput(data: string): void;
    dispose(): void;
}
export {};
