import { stripVTControlCharacters } from "node:util";
import { fuzzyFilter, Input, Key, matchesKey, SelectList, truncateToWidth, visibleWidth, wrapTextWithAnsi, } from "@earendil-works/pi-tui";
import { createBrowseComponent } from "./browse.js";
import { DynamicBorder } from "./dynamic-border.js";
import { createInputComponent } from "./input.js";
import { createMultiSelectComponent } from "./multi-select.js";
import { actionMenuItemPresentation, actionMenuUnavailableDescription, handleSearchInput, menuHint, renderFrame, safeMenuText, } from "./rendering.js";
import { createReviewComponent } from "./review.js";
export { browseDialogLabel, browseDialogPages } from "./browse.js";
export { prepareMenuScreenRendering } from "./mermaid.js";
export { actionMenuDialogLabel, safeMenuText } from "./rendering.js";
export { reviewDialogPages } from "./review.js";
export function createMenuScreenComponent(options) {
    let component;
    switch (options.screen.kind) {
        case "actions":
            component = createActionsComponent(options);
            break;
        case "detail":
            component = createDetailComponent(options);
            break;
        case "browse":
            component = createBrowseComponent(options);
            break;
        case "choice":
            component = createChoiceComponent(options);
            break;
        case "settings":
            component = createSettingsComponent(options);
            break;
        case "input":
            component = createInputComponent(options);
            break;
        case "review":
            component = createReviewComponent(options);
            break;
        case "multiSelect":
            component = createMultiSelectComponent(options);
            break;
    }
    Object.defineProperty(component, "__piTuiKitScreen", { value: true });
    return component;
}
function createActionsComponent(options) {
    const items = options.screen.items.map((item) => ({
        value: item.id,
        ...actionMenuItemPresentation(item),
    }));
    const widestPrimary = Math.max(1, ...items.map((item) => visibleWidth(item.label))) + 2;
    const list = new SelectList(items, Math.min(items.length, 10), selectTheme(options.theme), {
        minPrimaryColumnWidth: Math.min(32, widestPrimary),
        maxPrimaryColumnWidth: widestPrimary,
        truncatePrimary: ({ text, maxWidth }) => truncateToWidth(text, maxWidth, maxWidth > 1 ? "…" : ""),
    });
    setInitialSelection(list, items, options.selectedItemId);
    return commonListComponent(options, list, items, options.screen.lines ?? [], options.screen.hint ?? "back", (itemId) => {
        const source = options.screen.items.find((candidate) => candidate.id === itemId);
        if (!source?.disabled)
            options.onEvent({ kind: "activate", itemId });
    }, (itemId) => {
        const source = options.screen.items.find((candidate) => candidate.id === itemId);
        if (!source)
            return [];
        const unavailable = actionMenuUnavailableDescription(source);
        return unavailable ? [unavailable] : [];
    });
}
function createDetailComponent(options) {
    let disposed = false;
    return {
        render(width) {
            return renderFrame(options.screen.title, options.screen.lines, [], options.screen.hint ?? "back", width, options);
        },
        invalidate() { },
        handleInput(data) {
            if (disposed)
                return;
            if (matchesKey(data, Key.ctrl("c")))
                options.onEvent({ kind: "close" });
            else if (options.keybindings.matches(data, "tui.select.cancel")) {
                options.onEvent({ kind: options.screen.hint ?? "back" });
            }
        },
        async waitForPending() { },
        dispose() {
            if (disposed)
                return;
            disposed = true;
            options.onDispose?.();
        },
    };
}
function createChoiceComponent(options) {
    const searchInput = new Input();
    const restoredSearchQuery = options.searchQuery ?? "";
    if (restoredSearchQuery)
        handleSearchInput(searchInput, restoredSearchQuery);
    const border = new DynamicBorder((text) => options.theme.fg("border", text));
    const allItems = options.screen.items.map((item) => {
        const current = item.id === options.screen.currentItemId ? " ✓ current" : "";
        const unavailable = item.disabled
            ? `unavailable${item.disabledReason ? `: ${safeMenuText(item.disabledReason)}` : ""}`
            : undefined;
        const label = safeMenuText(item.label);
        const description = item.description ? safeMenuText(item.description) : "";
        return {
            item,
            selectItem: {
                value: item.id,
                label: `${item.disabled ? "[-] " : ""}${label}${current}`,
                description: [unavailable, description]
                    .filter((value) => Boolean(value))
                    .join(" · ") || undefined,
            },
            searchText: [
                safeChoiceText(item.label),
                safeChoiceText(item.description ?? ""),
                safeChoiceText(item.searchText ?? ""),
            ]
                .filter(Boolean)
                .join(" "),
        };
    });
    let filteredItems = options.screen.enableSearch
        ? fuzzyFilter(allItems, searchInput.getValue(), (candidate) => candidate.searchText)
        : [...allItems];
    let selectedIndex = Math.max(0, filteredItems.findIndex(({ item }) => item.id === options.selectedItemId));
    let restoreItemId;
    let disposed = false;
    let list = createList();
    function pageSize() {
        return Math.min(filteredItems.length, options.screen.viewportSize ?? 10);
    }
    function createList() {
        const items = filteredItems.map(({ selectItem }) => selectItem);
        const next = new SelectList(items, Math.min(items.length, options.screen.viewportSize ?? 10), selectTheme(options.theme));
        setInitialSelection(next, items, filteredItems[selectedIndex]?.item.id);
        return next;
    }
    const selected = () => filteredItems[selectedIndex]?.item;
    const setSelectedIndex = (index, wrap, rememberUserSelection) => {
        if (filteredItems.length === 0) {
            selectedIndex = 0;
            return;
        }
        selectedIndex = wrap
            ? (index + filteredItems.length) % filteredItems.length
            : Math.max(0, Math.min(index, filteredItems.length - 1));
        if (rememberUserSelection)
            restoreItemId = undefined;
        list.setSelectedIndex(selectedIndex);
        const item = selected();
        if (item)
            options.onSelectionChange?.(item.id);
    };
    const move = (delta) => setSelectedIndex(selectedIndex + delta, true, true);
    const applyFilter = () => {
        if (!options.screen.enableSearch)
            return;
        const previouslySelectedId = selected()?.id;
        filteredItems = fuzzyFilter(allItems, searchInput.getValue(), (candidate) => candidate.searchText);
        if (filteredItems.length === 0) {
            if (previouslySelectedId)
                restoreItemId ??= previouslySelectedId;
            selectedIndex = 0;
            list = createList();
            return;
        }
        const previousIndex = filteredItems.findIndex(({ item }) => item.id === previouslySelectedId);
        if (previousIndex < 0 && previouslySelectedId)
            restoreItemId ??= previouslySelectedId;
        const restoreIndex = filteredItems.findIndex(({ item }) => item.id === restoreItemId);
        selectedIndex = restoreIndex >= 0 ? restoreIndex : previousIndex >= 0 ? previousIndex : 0;
        if (restoreIndex >= 0)
            restoreItemId = undefined;
        list = createList();
        const item = selected();
        if (item)
            options.onSelectionChange?.(item.id);
    };
    const activate = () => {
        const item = selected();
        if (item && !item.disabled)
            options.onEvent({ kind: "activate", itemId: item.id });
    };
    const component = {
        render(width) {
            const safeWidth = Math.max(1, width);
            const selectedItem = selected();
            const details = [
                ...(selectedItem?.disabledReason
                    ? [`Unavailable: ${safeMenuText(selectedItem.disabledReason)}`]
                    : []),
                ...(selectedItem?.details ?? []).map(safeMenuText),
            ];
            const choices = allItems.length === 0
                ? [options.theme.fg("dim", "  No choices available")]
                : filteredItems.length === 0
                    ? [options.theme.fg("dim", "  No matching choices")]
                    : [
                        ...list.render(safeWidth),
                        ...(details.length > 0
                            ? [
                                "",
                                ...details.flatMap((line) => wrapTextWithAnsi(options.theme.fg("muted", line), safeWidth)),
                            ]
                            : []),
                    ];
            const search = options.screen.enableSearch
                ? [
                    ...renderChoiceSearchInput(searchInput, safeWidth),
                    "",
                    ...choices,
                    options.theme.fg("dim", "Type to search"),
                ]
                : choices;
            const result = [
                ...border.render(safeWidth),
                ...wrapTextWithAnsi(options.theme.fg("accent", options.theme.bold(safeMenuText(options.screen.title))), safeWidth),
                ...(options.screen.lines ?? []).flatMap((line) => wrapTextWithAnsi(options.theme.fg("muted", safeMenuText(line)), safeWidth)),
                "",
                ...search,
                ...wrapTextWithAnsi(options.theme.fg("dim", options.interactionHint ??
                    menuHint(options.keybindings, options.screen.hint ?? "back", "select")), safeWidth),
                ...border.render(safeWidth),
            ];
            return result.map((line) => truncateToWidth(line, safeWidth, ""));
        },
        invalidate() {
            border.invalidate();
            list.invalidate();
            if (options.screen.enableSearch)
                searchInput.invalidate();
        },
        handleInput(data) {
            if (disposed)
                return;
            if (matchesKey(data, Key.ctrl("c")))
                options.onEvent({ kind: "close" });
            else if (options.keybindings.matches(data, "tui.select.cancel")) {
                options.onEvent({ kind: options.screen.hint ?? "back" });
            }
            else if (options.keybindings.matches(data, "tui.select.up"))
                move(-1);
            else if (options.keybindings.matches(data, "tui.select.down"))
                move(1);
            else if (options.keybindings.matches(data, "tui.select.pageUp")) {
                setSelectedIndex(selectedIndex - Math.max(1, pageSize()), false, true);
            }
            else if (options.keybindings.matches(data, "tui.select.pageDown")) {
                setSelectedIndex(selectedIndex + Math.max(1, pageSize()), false, true);
            }
            else if (matchesKey(data, Key.home))
                setSelectedIndex(0, false, true);
            else if (matchesKey(data, Key.end)) {
                setSelectedIndex(filteredItems.length - 1, false, true);
            }
            else if (options.keybindings.matches(data, "tui.select.confirm") ||
                (!options.screen.enableSearch && data === " ")) {
                activate();
            }
            else if (options.screen.enableSearch) {
                handleSearchInput(searchInput, data);
                options.onSearchQueryChange?.(searchInput.getValue());
                applyFilter();
            }
            options.tui.requestRender();
        },
        async waitForPending() { },
        dispose() {
            if (disposed)
                return;
            disposed = true;
            options.onDispose?.();
        },
    };
    if (options.screen.enableSearch) {
        Object.defineProperty(component, "focused", {
            get: () => searchInput.focused,
            set: (value) => {
                searchInput.focused = value;
            },
        });
    }
    return component;
}
function safeChoiceText(value) {
    return safeMenuText(stripVTControlCharacters(String(value)));
}
function renderChoiceSearchInput(input, width) {
    const prefix = "Search: ";
    const inputWidth = Math.max(1, width - visibleWidth(prefix));
    return input.render(inputWidth).map((line) => truncateToWidth(`${prefix}${line}`, width, ""));
}
// Pi's current SettingsList cannot initialize its cursor, enforce disabled rows, expose search
// focus, or await rejected saves. Keep this adapter local while matching its public presentation.
function createSettingsComponent(options) {
    const searchInput = new Input();
    const border = new DynamicBorder((text) => options.theme.fg("border", text));
    const searchableItems = options.screen.items.map((item) => ({
        item,
        label: safeMenuText(item.label),
    }));
    let filteredItems = searchableItems;
    const committed = new Map(options.screen.items.map((item) => [item.id, item.currentValue]));
    const displayed = new Map(committed);
    const latestRequested = new Map();
    let selectedIndex = Math.max(0, filteredItems.findIndex(({ item }) => item.id === options.selectedItemId));
    let pending = Promise.resolve();
    let disposed = false;
    let closing = false;
    const selectedItem = () => filteredItems[selectedIndex]?.item;
    const closeAfterPending = (kind) => {
        if (closing || disposed)
            return;
        closing = true;
        void pending.then(() => {
            if (!disposed)
                options.onEvent({ kind });
        });
    };
    const select = (index) => {
        if (filteredItems.length === 0)
            return;
        selectedIndex = (index + filteredItems.length) % filteredItems.length;
        const item = selectedItem();
        if (item)
            options.onSelectionChange?.(item.id);
    };
    const applyFilter = () => {
        filteredItems = fuzzyFilter(searchableItems, searchInput.getValue(), (candidate) => candidate.label);
        selectedIndex = 0;
        const item = selectedItem();
        if (item)
            options.onSelectionChange?.(item.id);
    };
    const activate = () => {
        const item = selectedItem();
        if (!item || item.disabled || closing || disposed)
            return;
        const values = item.values ?? [item.currentValue];
        if (values.length === 0)
            return;
        const currentValue = displayed.get(item.id) ?? item.currentValue;
        const currentIndex = values.indexOf(currentValue);
        const value = values[(currentIndex + 1) % values.length] ?? currentValue;
        displayed.set(item.id, value);
        latestRequested.set(item.id, value);
        const operation = pending.then(async () => {
            if (disposed)
                return;
            const previousValue = committed.get(item.id) ?? item.currentValue;
            let response = false;
            try {
                response =
                    (await options.onSettingChange?.({
                        itemId: item.id,
                        value,
                        previousValue,
                    })) ?? false;
            }
            catch (error) {
                options.onError?.(error);
            }
            if (disposed)
                return;
            const accepted = typeof response === "boolean" ? response : response.accepted;
            if (accepted)
                committed.set(item.id, value);
            else if (latestRequested.get(item.id) === value)
                displayed.set(item.id, previousValue);
            options.tui.requestRender();
            if (accepted && typeof response !== "boolean") {
                closing = true;
                void pending.then(() => {
                    if (!disposed)
                        options.onTransition?.(response.transition);
                });
            }
        });
        pending = operation.catch(() => undefined);
    };
    const component = {
        get focused() {
            return searchInput.focused;
        },
        set focused(value) {
            searchInput.focused = value;
        },
        render(width) {
            const safeWidth = Math.max(1, width);
            const result = [
                ...border.render(safeWidth),
                ...wrapTextWithAnsi(options.theme.fg("accent", options.theme.bold(safeMenuText(options.screen.title))), safeWidth),
                ...(options.screen.lines ?? []).flatMap((line) => wrapTextWithAnsi(options.theme.fg("muted", safeMenuText(line)), safeWidth)),
                "",
                ...searchInput.render(safeWidth),
                "",
                ...renderSettingsRows(filteredItems, searchableItems, selectedIndex, displayed, safeWidth, options),
                "",
                ...wrapTextWithAnsi(options.theme.fg("dim", settingsHint(options.keybindings)), safeWidth),
                ...border.render(safeWidth),
            ];
            return result.map((line) => truncateToWidth(line, safeWidth, ""));
        },
        invalidate() {
            border.invalidate();
            searchInput.invalidate();
        },
        handleInput(data) {
            if (disposed || closing)
                return;
            if (matchesKey(data, Key.ctrl("c")))
                closeAfterPending("close");
            else if (options.keybindings.matches(data, "tui.select.cancel")) {
                closeAfterPending("back");
            }
            else if (options.keybindings.matches(data, "tui.select.up")) {
                select(selectedIndex - 1);
            }
            else if (options.keybindings.matches(data, "tui.select.down")) {
                select(selectedIndex + 1);
            }
            else if (options.keybindings.matches(data, "tui.select.pageUp"))
                select(0);
            else if (options.keybindings.matches(data, "tui.select.pageDown")) {
                select(filteredItems.length - 1);
            }
            else if (options.keybindings.matches(data, "tui.select.confirm") || data === " ") {
                activate();
            }
            else {
                handleSearchInput(searchInput, data);
                applyFilter();
            }
            options.tui.requestRender();
        },
        waitForPending: () => pending,
        dispose() {
            if (disposed)
                return;
            disposed = true;
            options.onDispose?.();
        },
    };
    return component;
}
function renderSettingsRows(filteredItems, allItems, selectedIndex, displayed, width, options) {
    if (allItems.length === 0)
        return [options.theme.fg("dim", "  No settings available")];
    if (filteredItems.length === 0)
        return [options.theme.fg("dim", "  No matching settings")];
    const maxVisible = Math.min(filteredItems.length, 10);
    const startIndex = Math.max(0, Math.min(selectedIndex - Math.floor(maxVisible / 2), filteredItems.length - maxVisible));
    const endIndex = Math.min(startIndex + maxVisible, filteredItems.length);
    const maxLabelWidth = Math.min(30, Math.max(...allItems.map((candidate) => visibleWidth(candidate.label))));
    const lines = [];
    for (let index = startIndex; index < endIndex; index += 1) {
        const candidate = filteredItems[index];
        if (!candidate)
            continue;
        const { item, label } = candidate;
        const selected = index === selectedIndex;
        const prefix = selected ? options.theme.fg("accent", "→ ") : "  ";
        const labelPadded = label + " ".repeat(Math.max(0, maxLabelWidth - visibleWidth(label)));
        const currentValue = safeMenuText(displayed.get(item.id) ?? item.currentValue);
        const value = item.disabled ? `(unavailable) ${currentValue}` : currentValue;
        const valueWidth = Math.max(0, width - visibleWidth(prefix) - maxLabelWidth - 2);
        let labelText = labelPadded;
        let valueText = truncateToWidth(value, valueWidth, "");
        if (selected) {
            labelText = options.theme.fg("accent", labelText);
            valueText = options.theme.fg("accent", valueText);
        }
        else if (item.disabled) {
            labelText = options.theme.fg("dim", labelText);
            valueText = options.theme.fg("dim", valueText);
        }
        else {
            valueText = options.theme.fg("muted", valueText);
        }
        lines.push(truncateToWidth(`${prefix}${labelText}  ${valueText}`, width, ""));
    }
    if (startIndex > 0 || endIndex < filteredItems.length) {
        lines.push(options.theme.fg("dim", `  (${selectedIndex + 1}/${filteredItems.length})`));
    }
    const selected = filteredItems[selectedIndex]?.item;
    if (selected?.description) {
        lines.push("");
        for (const line of wrapTextWithAnsi(safeMenuText(selected.description), Math.max(1, width - 4))) {
            lines.push(options.theme.fg("dim", `  ${line}`));
        }
    }
    return lines;
}
function settingsHint(keybindings) {
    const confirmKeys = uniqueHintKeys([...keybindings.getKeys("tui.select.confirm"), "space"]);
    const cancelKeys = uniqueHintKeys(keybindings.getKeys("tui.select.cancel").filter((key) => key !== "ctrl+c"));
    return [
        "Type to search",
        ...(confirmKeys ? [`${confirmKeys} to change`] : []),
        ...(cancelKeys ? [`${cancelKeys} to go back`] : []),
        "Ctrl+C to close",
    ].join(" · ");
}
function uniqueHintKeys(keys) {
    return [...new Set(keys.map(displayHintKey).filter(Boolean))].join("/");
}
function displayHintKey(key) {
    if (key === "enter")
        return "Enter";
    if (key === "space")
        return "Space";
    if (key === "escape")
        return "Esc";
    if (key === "ctrl+c")
        return "Ctrl+C";
    if (key === "up")
        return "↑";
    if (key === "down")
        return "↓";
    return safeMenuText(key);
}
function commonListComponent(options, list, items, lines, destination, onActivate, selectedDetails) {
    const initialIndex = Math.max(0, items.findIndex((item) => item.value === options.selectedItemId));
    let selectedIndex = initialIndex;
    let disposed = false;
    const select = (index, wrap) => {
        if (items.length === 0)
            return;
        selectedIndex = wrap
            ? (index + items.length) % items.length
            : Math.max(0, Math.min(index, items.length - 1));
        list.setSelectedIndex(selectedIndex);
        const itemId = items[selectedIndex]?.value;
        if (itemId)
            options.onSelectionChange?.(itemId);
    };
    return {
        render(width) {
            const safeWidth = Math.max(1, width);
            const selectedId = items[selectedIndex]?.value;
            const details = selectedId ? (selectedDetails?.(selectedId) ?? []) : [];
            const content = [
                ...list.render(safeWidth),
                ...(details.length > 0
                    ? [
                        "",
                        ...details.flatMap((detail) => wrapTextWithAnsi(options.theme.fg("muted", safeMenuText(detail)), safeWidth)),
                    ]
                    : []),
            ];
            return renderFrame(options.screen.title, lines, content, destination, width, options);
        },
        invalidate() {
            list.invalidate();
        },
        handleInput(data) {
            if (disposed)
                return;
            if (matchesKey(data, Key.ctrl("c"))) {
                options.onEvent({ kind: "close" });
                return;
            }
            if (options.keybindings.matches(data, "tui.select.cancel")) {
                options.onEvent({ kind: destination });
                return;
            }
            if (options.keybindings.matches(data, "tui.select.up"))
                select(selectedIndex - 1, true);
            else if (options.keybindings.matches(data, "tui.select.down")) {
                select(selectedIndex + 1, true);
            }
            else if (options.keybindings.matches(data, "tui.select.pageUp")) {
                select(selectedIndex - Math.max(1, Math.min(items.length, 10)), false);
            }
            else if (options.keybindings.matches(data, "tui.select.pageDown")) {
                select(selectedIndex + Math.max(1, Math.min(items.length, 10)), false);
            }
            else if (matchesKey(data, Key.home))
                select(0, false);
            else if (matchesKey(data, Key.end))
                select(items.length - 1, false);
            else if (options.keybindings.matches(data, "tui.select.confirm")) {
                const itemId = items[selectedIndex]?.value;
                if (itemId)
                    onActivate(itemId);
            }
            options.tui.requestRender();
        },
        async waitForPending() { },
        dispose() {
            if (disposed)
                return;
            disposed = true;
            options.onDispose?.();
        },
    };
}
function selectTheme(theme) {
    return {
        selectedPrefix: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text),
        scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("warning", text),
    };
}
function setInitialSelection(list, items, selectedId) {
    if (!selectedId)
        return;
    const index = items.findIndex((item) => item.value === selectedId);
    if (index >= 0)
        list.setSelectedIndex(index);
}
export function settingForAction(screen, itemId) {
    return screen.items.find((item) => item.id === itemId);
}
