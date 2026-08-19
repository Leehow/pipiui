import { safeMenuText } from "./text.js";
/** Format width-neutral interaction hints from Pi keybindings and literal shortcut keys. */
export function formatInteractionHints(keybindings, hints, options = {}) {
    const separator = safeMenuText(options.separator ?? "•") || "•";
    return hints
        .map((hint) => formatHint(keybindings, hint))
        .filter(Boolean)
        .join(` ${separator} `);
}
function formatHint(keybindings, hint) {
    const excluded = new Set((hint.excludeKeys ?? []).map(normalizeKey).filter(Boolean));
    const keys = [
        ...(hint.bindings ?? []).flatMap((binding) => keybindings.getKeys(binding)),
        ...(hint.keys ?? []),
    ]
        .map(normalizeKey)
        .filter((key) => key && !excluded.has(key));
    const uniqueKeys = [...new Set(keys)];
    const label = safeMenuText(hint.label);
    return uniqueKeys.length > 0 && label ? `${uniqueKeys.join("/")} ${label}` : "";
}
function normalizeKey(value) {
    const key = safeMenuText(value).toLowerCase();
    if (key === "up")
        return "↑";
    if (key === "down")
        return "↓";
    if (key === "return")
        return "enter";
    if (key === "escape")
        return "esc";
    return key;
}
