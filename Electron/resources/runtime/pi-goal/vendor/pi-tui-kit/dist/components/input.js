import { Input, Key, matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { handleSearchInput, renderFrame, safeMenuText } from "./rendering.js";
export function createInputComponent(options) {
    const input = new Input();
    let pending = Promise.resolve();
    let submitting = false;
    let closing = false;
    let disposed = false;
    const closeAfterPending = (kind) => {
        if (closing || disposed)
            return;
        closing = true;
        void pending.then(() => {
            if (!disposed)
                options.onEvent({ kind });
        });
    };
    const submit = () => {
        if (submitting || closing || disposed)
            return;
        submitting = true;
        const value = input.getValue();
        const operation = Promise.resolve()
            .then(async () => {
            let response = false;
            try {
                response = (await options.onInputSubmit?.({ value })) ?? false;
            }
            catch (error) {
                options.onError?.(error);
            }
            if (disposed)
                return;
            submitting = false;
            const accepted = typeof response === "boolean" ? response : response.accepted;
            if (accepted && typeof response !== "boolean") {
                closing = true;
                options.onTransition?.(response.transition);
            }
            options.tui.requestRender();
        })
            .catch(() => {
            if (!disposed) {
                submitting = false;
                options.tui.requestRender();
            }
        });
        pending = operation;
    };
    const component = {
        get focused() {
            return input.focused;
        },
        set focused(value) {
            input.focused = value;
        },
        render(width) {
            const safeWidth = Math.max(1, width);
            const content = [
                ...input.render(safeWidth),
                ...(input.getValue().length === 0 && options.screen.placeholder
                    ? wrapTextWithAnsi(options.theme.fg("dim", safeMenuText(options.screen.placeholder)), safeWidth)
                    : []),
                ...(submitting ? [options.theme.fg("dim", "Saving…")] : []),
            ];
            return renderFrame(options.screen.title, options.screen.lines ?? [], content, options.screen.hint ?? "back", safeWidth, options, "submit");
        },
        invalidate() {
            input.invalidate();
        },
        handleInput(data) {
            if (disposed || closing)
                return;
            if (matchesKey(data, Key.ctrl("c")))
                closeAfterPending("close");
            else if (options.keybindings.matches(data, "tui.select.cancel")) {
                closeAfterPending(options.screen.hint ?? "back");
            }
            else if (options.keybindings.matches(data, "tui.input.submit"))
                submit();
            else if (!submitting)
                handleSearchInput(input, data);
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
