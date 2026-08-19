import { Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { createDocumentLineCache, documentDialogPages, RPC_DOCUMENT_LINE_WIDTH, RPC_DOCUMENT_PAGE_SIZE, } from "./document-formatting.js";
import { menuHint, renderFrame, safeMenuText } from "./rendering.js";
const DEFAULT_REVIEW_VIEWPORT_SIZE = 14;
const RESERVED_HOST_ROWS = 3;
export function createReviewComponent(options) {
    let scrollOffset = 0;
    let lastMaximumScroll = 0;
    let lastViewportSize = reviewViewportSize(options.screen);
    let disposed = false;
    const documentLineCache = createDocumentLineCache(options.theme);
    const moveTo = (offset) => {
        scrollOffset = Math.max(0, Math.min(offset, lastMaximumScroll));
        options.tui.requestRender();
    };
    return {
        render(width) {
            const safeWidth = Math.max(1, width);
            const allLines = documentLineCache.lines(options.screen.content, options.screen.format, safeWidth);
            const terminalRows = options.screen.viewportSize === "adaptive" ? options.tui.terminal.rows : undefined;
            if (terminalRows !== undefined && Number.isFinite(terminalRows)) {
                const frame = renderAdaptiveReviewFrame({
                    screen: options.screen,
                    allLines,
                    width: safeWidth,
                    terminalRows,
                    scrollOffset,
                    theme: options.theme,
                    keybindings: options.keybindings,
                });
                scrollOffset = frame.scrollOffset;
                lastMaximumScroll = frame.maximumScroll;
                lastViewportSize = frame.viewportSize;
                return frame.lines;
            }
            const viewportSize = reviewViewportSize(options.screen);
            lastMaximumScroll = Math.max(0, allLines.length - viewportSize);
            scrollOffset = Math.max(0, Math.min(scrollOffset, lastMaximumScroll));
            lastViewportSize = viewportSize;
            const visible = allLines.slice(scrollOffset, scrollOffset + viewportSize);
            const first = allLines.length === 0 ? 0 : scrollOffset + 1;
            const last = Math.min(allLines.length, scrollOffset + viewportSize);
            const position = allLines.length > viewportSize
                ? [options.theme.fg("dim", `${first}-${last}/${allLines.length}`)]
                : [];
            return renderFrame(options.screen.title, options.screen.lines ?? [], [...visible, ...position], options.screen.hint ?? "back", safeWidth, options, options.screen.confirm ? safeMenuText(options.screen.confirm.label) : "");
        },
        invalidate() {
            documentLineCache.invalidate();
        },
        handleInput(data) {
            if (disposed)
                return;
            if (matchesKey(data, Key.ctrl("c")))
                options.onEvent({ kind: "close" });
            else if (options.keybindings.matches(data, "tui.select.cancel")) {
                options.onEvent({ kind: options.screen.hint ?? "back" });
            }
            else if (options.keybindings.matches(data, "tui.select.up")) {
                moveTo(scrollOffset - 1);
            }
            else if (options.keybindings.matches(data, "tui.select.down")) {
                moveTo(scrollOffset + 1);
            }
            else if (options.keybindings.matches(data, "tui.select.pageUp")) {
                moveTo(scrollOffset - lastViewportSize);
            }
            else if (options.keybindings.matches(data, "tui.select.pageDown")) {
                moveTo(scrollOffset + lastViewportSize);
            }
            else if (matchesKey(data, Key.home))
                moveTo(0);
            else if (matchesKey(data, Key.end))
                moveTo(lastMaximumScroll);
            else if (options.screen.confirm && options.keybindings.matches(data, "tui.select.confirm")) {
                options.onEvent({ kind: "activate", itemId: options.screen.confirm.id });
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
function renderAdaptiveReviewFrame(options) {
    const availableRows = Math.max(1, Math.floor(options.terminalRows) - RESERVED_HOST_ROWS);
    const destination = options.screen.hint ?? "back";
    const confirmAction = options.screen.confirm ? safeMenuText(options.screen.confirm.label) : "";
    const fullHeader = [
        ...wrapTextWithAnsi(options.theme.fg("accent", options.theme.bold(safeMenuText(options.screen.title))), options.width),
        ...(options.screen.lines ?? []).flatMap((line) => wrapTextWithAnsi(options.theme.fg("muted", safeMenuText(line)), options.width)),
    ].map((line) => truncateToWidth(line, options.width, ""));
    const fullHint = wrapTextWithAnsi(options.theme.fg("dim", menuHint(options.keybindings, destination, confirmAction)), options.width).map((line) => truncateToWidth(line, options.width, ""));
    const criticalHint = truncateToWidth(options.theme.fg("dim", compactReviewHint(options.keybindings, destination, confirmAction)), options.width, "");
    let chrome = allocateAdaptiveReviewChrome(availableRows, fullHeader, fullHint, criticalHint, false);
    if (availableRows >= 4 && options.allLines.length > chrome.viewportSize) {
        chrome = allocateAdaptiveReviewChrome(availableRows, fullHeader, fullHint, criticalHint, true);
    }
    const maximumScroll = Math.max(0, options.allLines.length - chrome.viewportSize);
    const scrollOffset = Math.max(0, Math.min(options.scrollOffset, maximumScroll));
    const visible = options.allLines.slice(scrollOffset, scrollOffset + chrome.viewportSize);
    const first = options.allLines.length === 0 ? 0 : scrollOffset + 1;
    const last = Math.min(options.allLines.length, scrollOffset + chrome.viewportSize);
    const position = chrome.showPosition
        ? [options.theme.fg("dim", `${first}-${last}/${options.allLines.length}`)]
        : [];
    const lines = [
        ...chrome.header,
        ...(chrome.separator ? [""] : []),
        ...visible,
        ...position,
        ...chrome.hint,
    ].map((line) => truncateToWidth(line, options.width, ""));
    return { lines, scrollOffset, maximumScroll, viewportSize: chrome.viewportSize };
}
function allocateAdaptiveReviewChrome(availableRows, fullHeader, fullHint, criticalHint, showPosition) {
    if (availableRows === 1) {
        return { header: [], separator: false, hint: [], showPosition: false, viewportSize: 1 };
    }
    const compactHeader = [fullHeader[0] ?? ""];
    if (availableRows === 2) {
        return {
            header: compactHeader,
            separator: false,
            hint: [],
            showPosition: false,
            viewportSize: 1,
        };
    }
    if (availableRows === 3) {
        return {
            header: compactHeader,
            separator: false,
            hint: [criticalHint],
            showPosition: false,
            viewportSize: 1,
        };
    }
    let remainingRows = availableRows - 3 - Number(showPosition);
    const extraHeaderCount = Math.min(remainingRows, Math.max(0, fullHeader.length - 1));
    const header = [...compactHeader, ...fullHeader.slice(1, 1 + extraHeaderCount)];
    remainingRows -= extraHeaderCount;
    let hint = [criticalHint];
    const fullHintExtraRows = Math.max(0, fullHint.length - 1);
    if (remainingRows > 0 && fullHint.length > 0 && fullHintExtraRows <= remainingRows) {
        hint = [...fullHint];
        remainingRows -= fullHintExtraRows;
    }
    const separator = remainingRows > 0;
    if (separator)
        remainingRows -= 1;
    return {
        header,
        separator,
        hint,
        showPosition,
        viewportSize: 1 + remainingRows,
    };
}
function compactReviewHint(keybindings, destination, confirmAction) {
    const confirm = reviewBindingText(keybindings, "tui.select.confirm");
    const cancel = reviewBindingText(keybindings, "tui.select.cancel", "ctrl+c");
    const up = reviewBindingText(keybindings, "tui.select.up");
    const down = reviewBindingText(keybindings, "tui.select.down");
    return [
        ...(confirm && confirmAction ? [`${confirm} ${confirmAction}`] : []),
        ...(cancel ? [`${cancel} ${destination}`] : []),
        ...(destination === "back" || !cancel ? ["ctrl+c close"] : []),
        ...(up || down ? [`${[up, down].filter(Boolean).join("/")} navigate`] : []),
    ].join(" • ");
}
function reviewBindingText(keybindings, binding, excluded) {
    return keybindings
        .getKeys(binding)
        .filter((key) => key !== excluded)
        .map((key) => {
        if (key === "up")
            return "↑";
        if (key === "down")
            return "↓";
        if (key === "escape")
            return "esc";
        return safeMenuText(key);
    })
        .filter(Boolean)
        .join("/");
}
export function reviewDialogPages(screen) {
    return documentDialogPages(screen.content, RPC_DOCUMENT_LINE_WIDTH, reviewDialogPageSize(screen));
}
function reviewViewportSize(screen) {
    return typeof screen.viewportSize === "number"
        ? screen.viewportSize
        : DEFAULT_REVIEW_VIEWPORT_SIZE;
}
function reviewDialogPageSize(screen) {
    return typeof screen.viewportSize === "number"
        ? Math.min(screen.viewportSize, RPC_DOCUMENT_PAGE_SIZE)
        : RPC_DOCUMENT_PAGE_SIZE;
}
