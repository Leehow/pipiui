import { Key, matchesKey } from "@earendil-works/pi-tui";
import { createMenuScreenComponent, safeMenuText } from "./components/index.js";
import { runCustomInteraction } from "./custom-interaction.js";
import { formatInteractionHints } from "./interaction-hints.js";
/** Run a standalone choice interaction whose cursor can drive consumer-owned live previews. */
export async function runLiveChoice(ctx, options) {
    if (!isCurrent(options) || options.signal?.aborted)
        return { kind: "stale" };
    const validationError = validateOptions(options);
    if (validationError)
        return liveChoiceError(ctx, options, validationError);
    if (ctx.mode === "tui" && ctx.hasUI)
        return runTuiLiveChoice(ctx, options);
    if (ctx.mode === "rpc" && ctx.hasUI)
        return runRpcLiveChoice(ctx, options);
    try {
        await options.onUnsupportedMode?.(ctx, ctx.mode);
    }
    catch (error) {
        return liveChoiceError(ctx, options, error);
    }
    if (!isCurrent(options) || options.signal?.aborted)
        return { kind: "stale" };
    return { kind: "unsupported", mode: ctx.mode };
}
async function runTuiLiveChoice(ctx, options) {
    const selectedItemId = initialItemId(options);
    const result = await runCustomInteraction(ctx, {
        signal: options.signal,
        isCurrent: options.isCurrent,
        onError: (currentCtx, error) => reportLiveChoiceError(currentCtx, options, error),
        create: ({ tui, theme, keybindings, signal, complete }) => {
            let focusedItemId = selectedItemId;
            const shortcuts = availableShortcuts(options.shortcuts, keybindings);
            const previews = createPreviewQueue(ctx, options, signal, () => complete({ kind: "previewFailed" }));
            const component = createMenuScreenComponent({
                screen: {
                    kind: "choice",
                    title: options.title,
                    lines: options.lines,
                    items: tuiItems(options),
                    action: "select",
                    currentItemId: options.currentItemId,
                    viewportSize: options.viewportSize,
                    hint: options.hint ?? "back",
                },
                selectedItemId,
                tui,
                theme,
                keybindings,
                interactionHint: liveChoiceHint(keybindings, options, shortcuts),
                onSelectionChange: (itemId) => {
                    focusedItemId = itemId;
                    const item = findItem(options.items, focusedItemId);
                    if (item)
                        previews.enqueue(item);
                },
                onEvent: (event) => {
                    if (event.kind === "activate") {
                        const item = findItem(options.items, event.itemId);
                        if (itemConfirmationDisabled(item))
                            return;
                        complete({ kind: "selected", itemId: event.itemId });
                        return;
                    }
                    complete({ kind: "closed", reason: event.kind });
                },
            });
            const initialItem = findItem(options.items, focusedItemId);
            if (initialItem)
                previews.enqueue(initialItem);
            return {
                render: (width) => component.render(width),
                invalidate: () => component.invalidate(),
                handleInput(data) {
                    if (!isCurrent(options)) {
                        complete({ kind: "previewFailed" });
                        return;
                    }
                    const item = findItem(options.items, focusedItemId);
                    const shortcut = item && !item.disabled && !isStandardChoiceInput(data, keybindings)
                        ? findShortcut(shortcuts, data)
                        : undefined;
                    if (item && shortcut) {
                        complete({ kind: "shortcut", shortcutId: shortcut.id, itemId: item.id });
                        return;
                    }
                    component.handleInput(data);
                },
                async waitForPending() {
                    await component.waitForPending();
                    await previews.waitForPending();
                },
                dispose() {
                    previews.dispose();
                    component.dispose?.();
                },
            };
        },
    });
    if (result.kind === "completed" && result.value.kind !== "previewFailed")
        return result.value;
    if (result.kind === "completed") {
        return liveChoiceError(ctx, options, new Error("Live choice preview failed"));
    }
    return result;
}
async function runRpcLiveChoice(ctx, options) {
    const rows = rpcRows(options);
    while (true) {
        let selection;
        try {
            selection = await uiFor(ctx).select([options.title, ...(options.lines ?? [])].map(safeMenuText).filter(Boolean).join("\n"), rows.map((row) => row.label), { signal: options.signal });
        }
        catch (error) {
            return liveChoiceError(ctx, options, error);
        }
        if (!isCurrent(options) || options.signal?.aborted)
            return { kind: "stale" };
        if (selection === undefined)
            return { kind: "closed", reason: options.hint ?? "back" };
        const row = rows.find((candidate) => candidate.label === selection);
        if (!row) {
            return liveChoiceError(ctx, options, new Error("Live choice dialog returned an option that was not offered"));
        }
        if (row.kind === "exit")
            return { kind: "closed", reason: options.hint ?? "back" };
        if (!row.item.disabled && !itemConfirmationDisabled(row.item)) {
            return { kind: "selected", itemId: row.item.id };
        }
    }
}
function createPreviewQueue(ctx, options, signal, fail) {
    let queued;
    let running = false;
    let disposed = false;
    let failure;
    let pending = Promise.resolve();
    const start = () => {
        if (running || disposed || signal.aborted || !options.onSelectionChange)
            return;
        if (!isCurrent(options)) {
            queued = undefined;
            fail();
            return;
        }
        running = true;
        pending = (async () => {
            try {
                while (queued && !disposed && !signal.aborted) {
                    if (!isCurrent(options)) {
                        queued = undefined;
                        fail();
                        return;
                    }
                    const item = queued;
                    queued = undefined;
                    const result = options.onSelectionChange?.({ ctx, item, signal });
                    if (isPromiseLike(result))
                        await result;
                    if (!isCurrent(options)) {
                        queued = undefined;
                        fail();
                        return;
                    }
                }
            }
            catch (error) {
                if (signal.aborted || disposed)
                    return;
                failure = error;
                queued = undefined;
                fail();
            }
            finally {
                running = false;
                if (queued)
                    start();
            }
        })();
    };
    return {
        enqueue(item) {
            if (disposed || signal.aborted || !options.onSelectionChange)
                return;
            if (!isCurrent(options)) {
                fail();
                return;
            }
            queued = item;
            start();
        },
        async waitForPending() {
            while (running)
                await pending;
            if (failure !== undefined)
                throw failure;
        },
        dispose() {
            disposed = true;
            queued = undefined;
        },
    };
}
function isPromiseLike(value) {
    return (typeof value === "object" &&
        value !== null &&
        "then" in value &&
        typeof value.then === "function");
}
function liveChoiceHint(keybindings, options, shortcuts) {
    return formatInteractionHints(keybindings, [
        {
            bindings: ["tui.select.up", "tui.select.down"],
            label: options.navigationLabel ?? "preview",
        },
        { bindings: ["tui.select.confirm"], label: options.confirmLabel ?? "select" },
        ...shortcuts.map((shortcut) => ({
            keys: shortcut.keys,
            label: shortcut.label,
        })),
        {
            bindings: ["tui.select.cancel"],
            excludeKeys: ["ctrl+c"],
            label: options.hint ?? "back",
        },
        { keys: ["ctrl+c"], label: "close" },
        { bindings: ["tui.select.pageUp", "tui.select.pageDown"], label: "page" },
    ]);
}
function isStandardChoiceInput(data, keybindings) {
    return (matchesKey(data, Key.ctrl("c")) ||
        matchesKey(data, Key.home) ||
        matchesKey(data, Key.end) ||
        data === " " ||
        [
            "tui.select.cancel",
            "tui.select.up",
            "tui.select.down",
            "tui.select.pageUp",
            "tui.select.pageDown",
            "tui.select.confirm",
        ].some((binding) => keybindings.matches(data, binding)));
}
const STANDARD_CHOICE_BINDINGS = [
    "tui.select.cancel",
    "tui.select.up",
    "tui.select.down",
    "tui.select.pageUp",
    "tui.select.pageDown",
    "tui.select.confirm",
];
function availableShortcuts(shortcuts, keybindings) {
    const unavailableKeys = new Set([
        "ctrl+c",
        "home",
        "end",
        "space",
        ...STANDARD_CHOICE_BINDINGS.flatMap((binding) => keybindings.getKeys(binding)),
    ].map(canonicalKeyId));
    const available = [];
    for (const shortcut of shortcuts ?? []) {
        const keys = shortcut.keys.filter((key) => {
            const canonical = canonicalKeyId(key);
            if (unavailableKeys.has(canonical))
                return false;
            unavailableKeys.add(canonical);
            return true;
        });
        if (keys.length > 0)
            available.push({ ...shortcut, keys });
    }
    return available;
}
function canonicalKeyId(key) {
    const parts = key.toLowerCase().split("+");
    const base = parts.at(-1) ?? "";
    const canonicalBase = base === "esc" ? "escape" : base === "return" ? "enter" : base;
    const modifiers = ["ctrl", "shift", "alt", "super"].filter((modifier) => parts.includes(modifier));
    return [...modifiers, canonicalBase].join("+");
}
function findShortcut(shortcuts, data) {
    return shortcuts.find((shortcut) => shortcut.keys.some((key) => matchesKey(data, key)));
}
function initialItemId(options) {
    for (const id of [options.initialItemId, options.currentItemId]) {
        if (id !== undefined && findItem(options.items, id))
            return id;
    }
    return options.items[0]?.id;
}
function findItem(items, itemId) {
    return items.find((item) => item.id === itemId);
}
function tuiItems(options) {
    return options.items.map((item) => {
        const explanation = confirmationDisabledText(item, options.confirmLabel);
        return explanation ? { ...item, details: [explanation, ...(item.details ?? [])] } : item;
    });
}
function itemConfirmationDisabled(item) {
    return item?.disabled !== true && item?.confirmationDisabled === true;
}
function confirmationDisabledText(item, confirmLabel) {
    if (!itemConfirmationDisabled(item))
        return undefined;
    const action = safeMenuText(confirmLabel ?? "select").trim() || "select";
    const reason = safeMenuText(item.confirmationDisabledReason ?? "").trim();
    return `Cannot ${action}${reason ? `: ${reason}` : ""}`;
}
function lowercaseInitial(value) {
    return value ? `${value[0]?.toLowerCase() ?? ""}${value.slice(1)}` : undefined;
}
function rpcRows(options) {
    const used = new Set();
    const rows = options.items.map((item) => {
        const states = [
            item.id === options.currentItemId ? "current" : undefined,
            item.disabled
                ? `unavailable${item.disabledReason ? `: ${safeMenuText(item.disabledReason)}` : ""}`
                : undefined,
            lowercaseInitial(confirmationDisabledText(item, options.confirmLabel)),
            item.description ? safeMenuText(item.description) : undefined,
        ].filter((value) => Boolean(value));
        const label = `${item.disabled ? "[-] " : ""}${safeMenuText(item.label)}${states.length > 0 ? ` — ${states.join(" · ")}` : ""}`;
        return { kind: "item", label: uniqueLabel(label, used), item };
    });
    rows.push({
        kind: "exit",
        label: uniqueLabel(options.hint === "close" ? "Close" : "← Back", used),
    });
    return rows;
}
function uniqueLabel(label, used) {
    const base = label || "Choice";
    if (!used.has(base)) {
        used.add(base);
        return base;
    }
    let suffix = 2;
    while (used.has(`${base} [${suffix}]`))
        suffix += 1;
    const unique = `${base} [${suffix}]`;
    used.add(unique);
    return unique;
}
function validateOptions(options) {
    if (options.viewportSize !== undefined &&
        (!Number.isInteger(options.viewportSize) || options.viewportSize <= 0)) {
        return new Error("Live choice viewportSize must be a positive integer");
    }
    const itemIds = new Set();
    for (const item of options.items) {
        if (!item.id.trim())
            return new Error("Live choice item ids must not be blank");
        if (itemIds.has(item.id))
            return new Error(`Duplicate live choice item id: ${item.id}`);
        itemIds.add(item.id);
    }
    const shortcutIds = new Set();
    for (const shortcut of options.shortcuts ?? []) {
        if (!shortcut.id.trim())
            return new Error("Live choice shortcut ids must not be blank");
        if (shortcutIds.has(shortcut.id)) {
            return new Error(`Duplicate live choice shortcut id: ${shortcut.id}`);
        }
        if (shortcut.keys.length === 0) {
            return new Error(`Live choice shortcut ${shortcut.id} must declare at least one key`);
        }
        shortcutIds.add(shortcut.id);
    }
    return undefined;
}
async function liveChoiceError(ctx, options, error) {
    if (!isCurrent(options) || options.signal?.aborted)
        return { kind: "stale" };
    await reportLiveChoiceError(ctx, options, error);
    if (!isCurrent(options) || options.signal?.aborted)
        return { kind: "stale" };
    return { kind: "error", error };
}
async function reportLiveChoiceError(ctx, options, error) {
    let reported = false;
    if (options.onError) {
        try {
            await options.onError(ctx, error);
            reported = true;
        }
        catch {
            // Fall through to Pi's notifier when a custom reporter is unavailable.
        }
    }
    if (reported || !ctx.hasUI || !isCurrent(options) || options.signal?.aborted)
        return;
    const message = error instanceof Error ? error.message : String(error);
    try {
        uiFor(ctx).notify(`Live choice failed: ${safeMenuText(message)}`, "error");
    }
    catch {
        // Error reporting must not change the typed result.
    }
}
function isCurrent(options) {
    return options.isCurrent?.() ?? true;
}
function uiFor(ctx) {
    return ctx.ui;
}
