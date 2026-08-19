import { Container, Key, Loader, matchesKey, Spacer, Text } from "@earendil-works/pi-tui";
import { DynamicBorder } from "./dynamic-border.js";
/** Cancellable loader composed from public Pi TUI primitives and callback-owned inputs. */
export class TaskLoader extends Container {
    keybindings;
    loader;
    cancellable;
    disposed = false;
    onAbort;
    constructor(tui, theme, keybindings, message, options = {}) {
        super();
        this.keybindings = keybindings;
        this.cancellable = options.cancellable ?? true;
        const cancelHint = this.cancellable ? cancelKeyText(keybindings) : undefined;
        const borderColor = (text) => theme.fg("border", text);
        this.addChild(new DynamicBorder(borderColor));
        this.loader = new Loader(tui, (text) => theme.fg("accent", text), (text) => theme.fg("muted", text), message);
        this.addChild(this.loader);
        if (cancelHint !== undefined) {
            this.addChild(new Spacer(1));
            this.addChild(new Text(theme.fg("dim", cancelHint) + theme.fg("muted", " cancel"), 1, 0));
        }
        this.addChild(new Spacer(1));
        this.addChild(new DynamicBorder(borderColor));
    }
    handleInput(data) {
        if (this.disposed || !this.cancellable)
            return;
        const matches = this.keybindings.matches;
        const cancelled = typeof matches === "function"
            ? matches.call(this.keybindings, data, "tui.select.cancel")
            : matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"));
        if (cancelled)
            this.onAbort?.();
    }
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.loader.stop();
    }
}
function cancelKeyText(keybindings) {
    const getKeys = keybindings.getKeys;
    const keys = typeof getKeys === "function"
        ? getKeys.call(keybindings, "tui.select.cancel")
        : ["escape", "ctrl+c"];
    return keys.map(displayKey).join("/");
}
function displayKey(key) {
    return key
        .split("+")
        .map((part) => process.platform === "darwin" && part.toLowerCase() === "alt" ? "option" : part)
        .join("+");
}
