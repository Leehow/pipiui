import { createMenuScreenComponent, safeMenuText } from "./components/index.js";
import { runCustomInteraction } from "./custom-interaction.js";
/** Run one standalone confirmation without absorbing the caller's confirmed side effect. */
export async function runConfirmation(ctx, options) {
    if (!isCurrent(options) || options.signal?.aborted)
        return { kind: "stale" };
    const prompt = normalizePrompt(options);
    if (ctx.mode === "tui" && ctx.hasUI)
        return runTuiConfirmation(ctx, options, prompt);
    if (ctx.mode === "rpc" && ctx.hasUI)
        return runRpcConfirmation(ctx, options, prompt);
    try {
        await options.onUnsupportedMode?.(ctx, ctx.mode);
    }
    catch (error) {
        return confirmationError(ctx, options, error);
    }
    if (!isCurrent(options) || options.signal?.aborted)
        return { kind: "stale" };
    return { kind: "unsupported", mode: ctx.mode };
}
async function runTuiConfirmation(ctx, options, prompt) {
    const result = await runCustomInteraction(ctx, {
        signal: options.signal,
        isCurrent: options.isCurrent,
        onError: (currentCtx, error) => reportConfirmationError(currentCtx, options, error),
        create: ({ tui, theme, keybindings, complete }) => createMenuScreenComponent({
            screen: {
                kind: "actions",
                title: prompt.title,
                lines: prompt.lines,
                items: [
                    { id: "confirm", label: prompt.confirmLabel, action: "confirm" },
                    { id: "back", label: prompt.cancelLabel, action: "back" },
                ],
                hint: "back",
            },
            selectedItemId: "confirm",
            tui,
            theme,
            keybindings,
            onEvent: (event) => {
                if (event.kind === "activate") {
                    complete(event.itemId === "confirm" ? "confirmed" : "back");
                    return;
                }
                complete(event.kind);
            },
        }),
    });
    if (result.kind === "completed") {
        return result.value === "confirmed"
            ? { kind: "confirmed" }
            : { kind: "closed", reason: result.value };
    }
    return result;
}
async function runRpcConfirmation(ctx, options, prompt) {
    let selection;
    try {
        selection = await uiFor(ctx).select([prompt.title, ...prompt.lines].join("\n"), [prompt.confirmLabel, prompt.cancelLabel], { signal: options.signal });
    }
    catch (error) {
        return confirmationError(ctx, options, error);
    }
    if (!isCurrent(options) || options.signal?.aborted)
        return { kind: "stale" };
    if (selection === prompt.confirmLabel)
        return { kind: "confirmed" };
    if (selection === undefined || selection === prompt.cancelLabel) {
        return { kind: "closed", reason: "back" };
    }
    return confirmationError(ctx, options, new Error("Confirmation dialog returned an option that was not offered"));
}
function normalizePrompt(options) {
    const title = safeMenuText(options.title) || "Confirm";
    const lines = options.message.split(/\r?\n/u).map(safeMenuText);
    const confirmLabel = safeMenuText(options.confirmLabel ?? "Confirm") || "Confirm";
    let cancelLabel = safeMenuText(options.cancelLabel ?? "Cancel") || "Cancel";
    if (cancelLabel === confirmLabel)
        cancelLabel = `${cancelLabel} [2]`;
    return { title, lines, confirmLabel, cancelLabel };
}
async function confirmationError(ctx, options, error) {
    if (!isCurrent(options) || options.signal?.aborted)
        return { kind: "stale" };
    await reportConfirmationError(ctx, options, error);
    if (!isCurrent(options) || options.signal?.aborted)
        return { kind: "stale" };
    return { kind: "error", error };
}
async function reportConfirmationError(ctx, options, error) {
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
        uiFor(ctx).notify(`Confirmation failed: ${safeMenuText(message)}`, "error");
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
