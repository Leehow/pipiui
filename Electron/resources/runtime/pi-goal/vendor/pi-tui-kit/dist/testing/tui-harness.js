import { isFocusable, Key, matchesKey } from "@earendil-works/pi-tui";
const DEFAULT_WIDTH = 100;
const DEFAULT_ROWS = 24;
export function createTuiHarness(options = {}) {
    let width = validDimension(options.width ?? DEFAULT_WIDTH, "width");
    let rows = validDimension(options.rows ?? DEFAULT_ROWS, "rows");
    let openCount = 0;
    let nextGeneration = 0;
    let requestRenderCount = 0;
    let active;
    let latest;
    let lastFrame = Object.freeze([]);
    const openWaiters = [];
    const terminal = {
        get columns() {
            return width;
        },
        get rows() {
            return rows;
        },
    };
    const tui = {
        terminal,
        requestRender() {
            requestRenderCount += 1;
        },
    };
    const theme = testingTheme(options.theme);
    const keybindings = testingKeybindings(options.keybindings);
    const custom = (async (factory, customOptions) => {
        if (customOptions !== undefined) {
            throw new Error("TUI harness does not support custom UI options or overlays");
        }
        if (active && !active.settled) {
            throw new Error("TUI harness already has an active custom component");
        }
        const session = {
            generation: ++nextGeneration,
            open: false,
            opened: false,
            settled: false,
            disposed: false,
            result: undefined,
            resultDeferred: deferred(),
        };
        active = session;
        latest = session;
        const done = (value) => settle(session, value);
        void Promise.resolve()
            .then(() => factory(tui, theme, keybindings, done))
            .then((component) => {
            session.component = component;
            if (session.settled) {
                disposeComponent(session);
                return;
            }
            if (active !== session) {
                failSession(session, new Error(`TUI custom generation ${session.generation} became obsolete before opening`));
                disposeComponent(session);
                return;
            }
            session.open = true;
            session.opened = true;
            openCount += 1;
            resolveOpenWaiters(openCount);
        }, (error) => failSession(session, error))
            .catch((error) => failSession(session, error));
        try {
            return (await session.resultDeferred.promise);
        }
        finally {
            if (active === session)
                active = undefined;
        }
    });
    function failSession(session, error) {
        if (session.settled)
            return;
        session.settled = true;
        session.open = false;
        session.openError = error;
        session.resultDeferred.reject(error);
        rejectOpenWaiters(error);
    }
    function settle(session, value) {
        if (session.settled)
            return;
        const settledBeforeOpen = !session.open && !session.component;
        session.settled = true;
        session.open = false;
        session.result = value;
        session.resultDeferred.resolve(session.result);
        disposeComponent(session);
        if (settledBeforeOpen) {
            const error = new Error("TUI custom component settled before opening");
            session.openError = error;
            rejectOpenWaiters(error);
        }
    }
    function disposeComponent(session) {
        if (session.disposed || !session.component)
            return;
        session.disposed = true;
        try {
            session.component.dispose?.();
        }
        catch {
            // Match Pi's custom host: disposal failures do not replace the component result.
        }
    }
    function resolveOpenWaiters(count) {
        for (const waiter of openWaiters.splice(0))
            waiter.resolve(count);
    }
    function rejectOpenWaiters(error) {
        for (const waiter of openWaiters.splice(0))
            waiter.reject(error);
    }
    function currentOpen() {
        return active?.open ? active : undefined;
    }
    function render(renderWidth = width) {
        const session = currentOpen();
        if (!session?.component)
            throw new Error("TUI harness has no open custom component");
        width = validDimension(renderWidth, "width");
        lastFrame = Object.freeze([...session.component.render(width)]);
        return lastFrame;
    }
    function send(data) {
        const session = currentOpen();
        if (!session?.component)
            return lastFrame;
        session.component.handleInput?.(data);
        return session.open ? render() : lastFrame;
    }
    return {
        custom,
        get openCount() {
            return openCount;
        },
        get requestRenderCount() {
            return requestRenderCount;
        },
        get isOpen() {
            return currentOpen() !== undefined;
        },
        get isFocusable() {
            return isFocusable(currentOpen()?.component ?? null);
        },
        get focused() {
            const component = currentOpen()?.component ?? null;
            return isFocusable(component) ? component.focused : false;
        },
        get result() {
            return latest?.result;
        },
        get resultPromise() {
            if (!latest)
                throw new Error("TUI harness has not opened a custom component");
            return latest.resultDeferred.promise;
        },
        waitForOpen() {
            if (currentOpen())
                return Promise.resolve(openCount);
            const session = active ?? latest;
            if (session?.settled && !session.opened && session.openError !== undefined) {
                return Promise.reject(session.openError);
            }
            return new Promise((resolve, reject) => openWaiters.push({ resolve, reject }));
        },
        render,
        press(key) {
            return send(keyData(key));
        },
        send,
        type(text) {
            return send(text);
        },
        resize(size) {
            const nextWidth = size.width === undefined ? width : validDimension(size.width, "width");
            const nextRows = size.rows === undefined ? rows : validDimension(size.rows, "rows");
            width = nextWidth;
            rows = nextRows;
            return render();
        },
        invalidate() {
            currentOpen()?.component?.invalidate();
        },
        setFocused(focused) {
            const component = currentOpen()?.component ?? null;
            if (isFocusable(component))
                component.focused = focused;
        },
        async waitForPending() {
            await latest?.component?.waitForPending?.();
        },
        dispose() {
            const session = active;
            if (!session || session.settled)
                return;
            settle(session, undefined);
        },
    };
}
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    void promise.catch(() => undefined);
    return { promise, resolve, reject };
}
function validDimension(value, name) {
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`TUI harness ${name} must be a positive integer`);
    }
    return value;
}
function keyData(key) {
    switch (key) {
        case "tui.select.up":
            return "\u001b[A";
        case "tui.select.down":
            return "\u001b[B";
        case "tui.select.pageUp":
            return "\u001b[5~";
        case "tui.select.pageDown":
            return "\u001b[6~";
        case "tui.select.confirm":
        case "tui.input.submit":
            return "\r";
        case "tui.select.cancel":
            return "\u001b";
        case "ctrl+c":
            return "\u0003";
        case "home":
            return "\u001b[H";
        case "end":
            return "\u001b[F";
    }
}
function testingTheme(override) {
    const identity = (text) => text;
    return {
        fg: (color, text) => override?.fg(color, text) ?? text,
        bg: (_color, text) => text,
        bold: (text) => override?.bold(text) ?? text,
        italic: identity,
        underline: identity,
        inverse: identity,
        strikethrough: identity,
        getFgAnsi: () => "",
        getBgAnsi: () => "",
        getColorMode: () => "truecolor",
        getThinkingBorderColor: () => identity,
        getBashModeBorderColor: () => identity,
    };
}
function testingKeybindings(override) {
    const matches = override?.matches.bind(override);
    const getKeys = override?.getKeys.bind(override);
    return {
        matches(data, binding) {
            if (matches)
                return matches(data, binding);
            const expected = bindingKey(binding);
            return ((expected !== undefined && matchesKey(data, expected)) ||
                (binding === "tui.select.cancel" && matchesKey(data, Key.ctrl("c"))));
        },
        getKeys(binding) {
            if (getKeys)
                return getKeys(binding);
            switch (binding) {
                case "tui.select.up":
                    return ["up"];
                case "tui.select.down":
                    return ["down"];
                case "tui.select.pageUp":
                    return ["pageup"];
                case "tui.select.pageDown":
                    return ["pagedown"];
                case "tui.select.confirm":
                case "tui.input.submit":
                    return ["enter"];
                case "tui.select.cancel":
                    return ["escape", "ctrl+c"];
                default:
                    return [];
            }
        },
    };
}
function bindingKey(binding) {
    switch (binding) {
        case "tui.select.up":
            return Key.up;
        case "tui.select.down":
            return Key.down;
        case "tui.select.pageUp":
            return Key.pageUp;
        case "tui.select.pageDown":
            return Key.pageDown;
        case "tui.select.confirm":
        case "tui.input.submit":
            return Key.enter;
        case "tui.select.cancel":
            return Key.escape;
        default:
            return undefined;
    }
}
