import { safeMenuText } from "./components/index.js";
import { runTask } from "./task.js";
export async function invokeMenuInteraction(options) {
    const { ctx, definition, screen, state, menuSignal, runtime, interaction } = options;
    const signal = options.interactionSignal
        ? AbortSignal.any([menuSignal, options.interactionSignal])
        : menuSignal;
    switch (interaction.kind) {
        case "activate": {
            if (screen.kind === "actions") {
                const item = screen.items.find((candidate) => candidate.id === interaction.itemId);
                if (!item || item.disabled)
                    return rejected();
                return activateActionItem(ctx, definition, item, state, signal, runtime);
            }
            if (screen.kind === "choice") {
                const item = screen.items.find((candidate) => candidate.id === interaction.itemId);
                if (!item || item.disabled)
                    return rejected();
                return withSelection(await invokeAction(ctx, definition.actions[screen.action], state, signal, item.id, runtime), item.id);
            }
            if (screen.kind === "review") {
                if (!screen.confirm || screen.confirm.id !== interaction.itemId)
                    return rejected();
                return invokeAction(ctx, definition.actions[screen.confirm.action], state, signal, screen.confirm.id, runtime);
            }
            if (screen.kind === "multiSelect") {
                const item = screen.actions?.find((candidate) => candidate.id === interaction.itemId);
                if (!item || item.disabled)
                    return rejected();
                return activateActionItem(ctx, definition, item, state, signal, runtime);
            }
            return rejected();
        }
        case "setting": {
            if (screen.kind !== "settings")
                return rejected();
            const item = screen.items.find((candidate) => candidate.id === interaction.itemId);
            if (!item || item.disabled)
                return rejected();
            return withSelection(await invokeAction(ctx, definition.actions[item.action], state, signal, item.id, runtime, {
                value: interaction.value,
            }), item.id);
        }
        case "multiSelect": {
            if (screen.kind !== "multiSelect")
                return rejected();
            const item = screen.items.find((candidate) => candidate.id === interaction.itemId);
            if (!item || item.disabled)
                return rejected();
            return withSelection(await invokeAction(ctx, definition.actions[screen.action], state, signal, item.id, runtime, { selected: interaction.selected }), item.id);
        }
        case "input":
            if (screen.kind !== "input")
                return rejected();
            return invokeAction(ctx, definition.actions[screen.action], state, signal, "input", runtime, {
                value: interaction.value,
            });
    }
}
async function activateActionItem(ctx, definition, item, state, signal, runtime) {
    if ("to" in item && item.to !== undefined) {
        return accepted({ kind: "to", screen: item.to }, item.id);
    }
    if ("close" in item)
        return accepted({ kind: "close" }, item.id);
    if (!("action" in item) || item.action === undefined)
        return rejected();
    const handler = definition.actions[item.action];
    const invocation = "busyLabel" in item && item.busyLabel && ctx.mode === "tui" && ctx.hasUI
        ? await invokeBusyAction(ctx, handler, state, item.id, item.busyLabel, signal, runtime)
        : await invokeAction(ctx, handler, state, signal, item.id, runtime);
    return withSelection(invocation, item.id);
}
async function invokeBusyAction(ctx, handler, state, itemId, label, signal, runtime) {
    const result = await runTask(ctx, {
        label,
        signal,
        isCurrent: runtime.isCurrent,
        onError: () => undefined,
        task: ({ signal: taskSignal }) => invokeAction(ctx, handler, state, taskSignal, itemId, runtime, {}, false),
    });
    switch (result.kind) {
        case "completed":
            return result.value;
        case "cancelled":
            return rejected();
        case "stale":
            return { ...rejected(), stale: true };
        case "error":
            throw result.error;
    }
}
async function invokeAction(ctx, handler, state, signal, itemId, runtime, input = {}, abortIsStale = true) {
    if (!isMenuCurrent(runtime))
        return { ...rejected(), stale: true };
    if (signal.aborted) {
        return abortIsStale ? { ...rejected(), stale: true } : rejected();
    }
    let result;
    try {
        result = await handler({ ctx, state, signal, itemId, ...input });
    }
    catch (error) {
        if (!isMenuCurrent(runtime))
            return { ...rejected(), stale: true };
        if (signal.aborted) {
            return abortIsStale ? { ...rejected(), stale: true } : rejected();
        }
        await reportMenuError(ctx, runtime, error);
        if (!isMenuCurrent(runtime))
            return { ...rejected(), stale: true };
        if (signal.aborted) {
            return abortIsStale ? { ...rejected(), stale: true } : rejected();
        }
        return rejected();
    }
    if (!isMenuCurrent(runtime))
        return { ...rejected(), stale: true };
    if (signal.aborted) {
        return abortIsStale ? { ...rejected(), stale: true } : rejected();
    }
    if (result?.kind === "rejected") {
        if (result.error !== undefined)
            await reportMenuError(ctx, runtime, result.error);
        if (!isMenuCurrent(runtime))
            return { ...rejected(), stale: true };
        if (signal.aborted) {
            return abortIsStale ? { ...rejected(), stale: true } : rejected();
        }
        return rejected();
    }
    return accepted(result ?? { kind: "stay" });
}
export async function reportMenuError(ctx, runtime, error) {
    if (runtime.onError) {
        try {
            await runtime.onError(ctx, error);
            return;
        }
        catch {
            // Fall back to Pi's notifier when a custom reporter is no longer available.
        }
    }
    if (ctx.hasUI) {
        const message = error instanceof Error ? error.message : String(error);
        try {
            uiFor(ctx).notify(`Menu action failed: ${safeMenuText(message)}`, "error");
        }
        catch {
            // Error reporting must never escape the documented menu result contract.
        }
    }
}
export function isMenuCurrent(runtime) {
    return runtime.isCurrent?.() ?? true;
}
function accepted(transition, selectionItemId) {
    return { accepted: true, stale: false, transition, selectionItemId };
}
function rejected() {
    return { accepted: false, stale: false, transition: { kind: "stay" } };
}
function withSelection(invocation, selectionItemId) {
    return { ...invocation, selectionItemId };
}
function uiFor(ctx) {
    return ctx.ui;
}
