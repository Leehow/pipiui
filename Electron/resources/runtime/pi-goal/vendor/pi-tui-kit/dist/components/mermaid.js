import * as PiTui from "@earendil-works/pi-tui";
import { sanitizeTerminalText } from "../terminal-text.js";
import { sanitizeDocumentText } from "./document-sanitization.js";
let renderMermaid;
let loadPromise;
let loadFailed = false;
export function supportsRichMarkdown() {
    return typeof PiTui.renderLatex === "function" && typeof PiTui.Marked === "function";
}
export function prepareMermaidRenderer() {
    if (!supportsRichMarkdown() || renderMermaid || loadFailed)
        return undefined;
    loadPromise ??= import("grok-mermaid")
        .then((module) => {
        renderMermaid = module.render;
    })
        .catch(() => {
        loadFailed = true;
    });
    return loadPromise;
}
export function prepareMenuScreenRendering(screen) {
    if (screen.kind === "review") {
        return documentNeedsMermaid(screen.content, screen.format)
            ? prepareMermaidRenderer()
            : undefined;
    }
    if (screen.kind === "browse") {
        return screen.items.some((item) => documentNeedsMermaid(item.detailDocument?.content, item.detailDocument?.format))
            ? prepareMermaidRenderer()
            : undefined;
    }
    return undefined;
}
export function mermaidMarkdownTransform(theme) {
    if (!renderMermaid || !supportsRichMarkdown())
        return undefined;
    const markdownParser = new PiTui.Marked();
    return (markdown, availableWidth) => markdownParser
        .lexer(markdown)
        .map((token) => renderToken(token, availableWidth, theme))
        .join("");
}
function documentNeedsMermaid(content, format) {
    if (format?.kind !== "markdown" ||
        format.renderMermaid === false ||
        content === undefined ||
        !supportsRichMarkdown()) {
        return false;
    }
    const markdown = sanitizeDocumentText(content);
    if (!/(?:^|\n)[\t ]{0,3}(?:`{3,}|~{3,})[\t ]*mermaid(?:[\t \n]|$)/iu.test(markdown)) {
        return false;
    }
    return new PiTui.Marked().lexer(markdown).some(isMermaid);
}
function renderToken(token, availableWidth, theme) {
    if (!isMermaid(token) || !renderMermaid)
        return token.raw;
    let art;
    try {
        art = renderMermaid(token.text);
    }
    catch {
        return token.raw;
    }
    if (!art || art.width > Math.max(1, availableWidth))
        return token.raw;
    if (art.warnings.length > 0)
        return warningFallback(token.raw, art.warnings, theme);
    return `${themedLines(art, theme).map(codeSpan).join("  \n")}\n`;
}
function isMermaid(token) {
    return (token.type === "code" && token.lang?.trim().split(/\s+/u, 1)[0]?.toLowerCase() === "mermaid");
}
function warningFallback(raw, warnings, theme) {
    const suffix = warnings.length > 1 ? ` (+${warnings.length - 1} more)` : "";
    const warning = sanitizeTerminalText(`Mermaid diagram not rendered: ${warnings[0] ?? "incomplete source"}${suffix}`);
    return `${raw}\n${codeSpan(theme.fg("warning", warning))}  \n`;
}
function themedLines(art, theme) {
    return art.styled.map((row) => row.map((span) => styleSpan(span, theme)).join(""));
}
function styleSpan(span, theme) {
    switch (span.cls) {
        case "border":
            return theme.fg("borderMuted", span.text);
        case "text":
            return theme.fg("text", span.text);
        case "edge":
            return theme.fg("accent", span.text);
        case "edgeLabel":
            return theme.fg("muted", span.text);
        case "title":
            return theme.fg("accent", theme.bold(span.text));
        case "none":
            return span.text;
    }
}
function codeSpan(line) {
    const content = line || "\u00a0";
    const longestBacktickRun = Math.max(0, ...Array.from(content.matchAll(/`+/gu), (match) => match[0].length));
    const fence = "`".repeat(longestBacktickRun + 1);
    const padding = content.startsWith("`") || content.endsWith("`") ? " " : "";
    return `${fence}${padding}${content}${padding}${fence}`;
}
