import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { formatInteractionHints } from "../interaction-hints.js";
import { replaceTerminalControls, safeMenuText } from "../text.js";
export { safeMenuText } from "../text.js";
export function actionMenuItemPresentation(item) {
    const label = safeMenuText(item.label);
    const description = item.description ? safeMenuText(item.description) : undefined;
    return { label: item.disabled ? `[-] ${label}` : label, description };
}
export function actionMenuUnavailableDescription(item) {
    if (!item.disabled)
        return undefined;
    const reason = safeMenuText(item.disabledReason ?? "");
    return reason ? `Unavailable: ${reason}` : undefined;
}
export function actionMenuDialogLabel(item) {
    const label = safeMenuText(item.label);
    const reason = safeMenuText(item.disabledReason ?? "");
    if (!item.disabled || !reason)
        return label;
    return `[-] ${label} (unavailable: ${reason})`;
}
export function renderFrame(title, lines, content, destination, width, options, confirmAction = "select") {
    const safeWidth = Math.max(1, width);
    const result = [
        ...wrapTextWithAnsi(options.theme.fg("accent", options.theme.bold(safeMenuText(title))), safeWidth),
        ...lines.flatMap((line) => wrapTextWithAnsi(options.theme.fg("muted", safeMenuText(line)), safeWidth)),
        ...(content.length > 0 ? ["", ...content] : []),
        ...wrapTextWithAnsi(options.theme.fg("dim", menuHint(options.keybindings, destination, confirmAction)), safeWidth),
    ];
    return result.map((line) => truncateToWidth(line, safeWidth, ""));
}
export function menuHint(keybindings, destination, confirmAction) {
    return formatInteractionHints(keybindings, [
        { bindings: ["tui.select.up", "tui.select.down"], label: "navigate" },
        ...(confirmAction ? [{ bindings: ["tui.select.confirm"], label: confirmAction }] : []),
        {
            bindings: ["tui.select.cancel"],
            excludeKeys: ["ctrl+c"],
            label: destination,
        },
        ...(destination === "back" ? [{ keys: ["ctrl+c"], label: "close" }] : []),
    ]);
}
export function handleSearchInput(input, data) {
    input.handleInput(data);
    const value = replaceTerminalControls(input.getValue());
    if (value !== input.getValue())
        input.setValue(value);
}
