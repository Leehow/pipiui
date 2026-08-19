import * as PiTui from "@earendil-works/pi-tui";
import { sanitizeDocumentText } from "./document-sanitization.js";
import { mermaidMarkdownTransform, supportsRichMarkdown } from "./mermaid.js";
import { getLanguageFromPath, highlightCode } from "./syntax-highlighting.js";
export const RPC_DOCUMENT_LINE_WIDTH = 120;
export const RPC_DOCUMENT_PAGE_SIZE = 8;
const TAB_SIZE = 4;
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export function createDocumentLineCache(theme) {
    let cached;
    return {
        lines(content, format, width) {
            const identity = documentFormatIdentity(format);
            if (cached?.content === content &&
                cached.formatKind === identity.kind &&
                cached.language === identity.language &&
                cached.filePath === identity.filePath &&
                cached.renderLatex === identity.renderLatex &&
                cached.renderMermaid === identity.renderMermaid &&
                cached.richMarkdown === identity.richMarkdown &&
                cached.width === width) {
                return cached.lines;
            }
            const lines = formatDocumentLines(content, format, width, theme);
            cached = {
                content,
                formatKind: identity.kind,
                language: identity.language,
                filePath: identity.filePath,
                renderLatex: identity.renderLatex,
                renderMermaid: identity.renderMermaid,
                richMarkdown: identity.richMarkdown,
                width,
                lines,
            };
            return lines;
        },
        invalidate() {
            cached = undefined;
        },
    };
}
export function formatDocumentLines(content, format, width, theme) {
    const resolvedFormat = format ?? { kind: "text" };
    if (resolvedFormat.kind === "markdown") {
        return renderMarkdownDocument(content, resolvedFormat, width, theme);
    }
    const segments = documentSegments(content, width);
    if (resolvedFormat.kind === "code") {
        const language = resolvedFormat.language ??
            (resolvedFormat.filePath ? getLanguageFromPath(resolvedFormat.filePath) : undefined);
        return segments.map(({ text }) => highlightCode(text, language, theme));
    }
    if (resolvedFormat.kind === "diff") {
        return segments.map(({ source, text }) => {
            if (source.startsWith("@@"))
                return theme.fg("accent", text);
            if (source.startsWith("+") && !source.startsWith("+++")) {
                return theme.fg("toolDiffAdded", text);
            }
            if (source.startsWith("-") && !source.startsWith("---")) {
                return theme.fg("toolDiffRemoved", text);
            }
            return theme.fg("toolDiffContext", text);
        });
    }
    return segments.map(({ text }) => theme.fg("text", text));
}
export function plainDocumentLines(content, width) {
    return documentSegments(content, width).map(({ text }) => text);
}
function renderMarkdownDocument(content, format, width, theme) {
    const component = new PiTui.Markdown(sanitizeDocumentText(content), 0, 0, markdownTheme(theme), { color: (text) => theme.fg("text", text) }, {
        renderLatex: format.renderLatex ?? true,
        transform: format.renderMermaid === false ? undefined : mermaidMarkdownTransform(theme),
    });
    return component.render(Math.max(1, width));
}
function markdownTheme(theme) {
    return {
        heading: (text) => theme.fg("mdHeading", text),
        link: (text) => theme.fg("mdLink", text),
        linkUrl: (text) => theme.fg("mdLinkUrl", text),
        code: (text) => theme.fg("mdCode", text),
        codeBlock: (text) => theme.fg("mdCodeBlock", text),
        codeBlockBorder: (text) => theme.fg("mdCodeBlockBorder", text),
        quote: (text) => theme.fg("mdQuote", text),
        quoteBorder: (text) => theme.fg("mdQuoteBorder", text),
        hr: (text) => theme.fg("mdHr", text),
        listBullet: (text) => theme.fg("mdListBullet", text),
        bold: (text) => theme.bold(text),
        italic: (text) => theme.italic?.(text) ?? text,
        underline: (text) => theme.underline?.(text) ?? text,
        strikethrough: (text) => theme.strikethrough?.(text) ?? text,
        highlightCode: (code, language) => code.split("\n").map((line) => highlightCode(line, language, theme)),
    };
}
export function documentDialogPages(content, width, pageSize) {
    const lines = plainDocumentLines(content, width);
    const safePageSize = Math.max(1, Math.floor(pageSize));
    const pages = [];
    for (let index = 0; index < lines.length; index += safePageSize) {
        pages.push(lines.slice(index, index + safePageSize));
    }
    return pages.length > 0 ? pages : [[""]];
}
function documentFormatIdentity(format) {
    const shared = {
        renderLatex: undefined,
        renderMermaid: undefined,
        richMarkdown: supportsRichMarkdown(),
    };
    if (format?.kind === "code") {
        return { ...shared, kind: format.kind, language: format.language, filePath: format.filePath };
    }
    if (format?.kind === "diff") {
        return { ...shared, kind: format.kind, language: undefined, filePath: format.filePath };
    }
    if (format?.kind === "markdown") {
        return {
            ...shared,
            kind: format.kind,
            language: undefined,
            filePath: undefined,
            renderLatex: format.renderLatex ?? true,
            renderMermaid: format.renderMermaid ?? true,
        };
    }
    return { ...shared, kind: "text", language: undefined, filePath: undefined };
}
function documentSegments(content, width) {
    const safe = sanitizeDocumentText(content);
    return safe.split("\n").flatMap((line) => {
        const source = expandTabs(line);
        return hardWrapLine(source, width).map((text) => ({ source, text }));
    });
}
function expandTabs(line) {
    let column = 0;
    let result = "";
    for (const { segment } of graphemeSegmenter.segment(line)) {
        if (segment === "\t") {
            const count = TAB_SIZE - (column % TAB_SIZE);
            result += " ".repeat(count);
            column += count;
            continue;
        }
        result += segment;
        column += PiTui.visibleWidth(segment);
    }
    return result;
}
function hardWrapLine(line, width) {
    const safeWidth = Math.max(1, width);
    if (line.length === 0)
        return [""];
    const lines = [];
    let current = "";
    let currentWidth = 0;
    const flush = () => {
        lines.push(current);
        current = "";
        currentWidth = 0;
    };
    for (const { segment } of graphemeSegmenter.segment(line)) {
        const segmentWidth = PiTui.visibleWidth(segment);
        if (segmentWidth > safeWidth) {
            if (current.length > 0)
                flush();
            lines.push("?".repeat(safeWidth));
            continue;
        }
        if (currentWidth + segmentWidth > safeWidth && current.length > 0)
            flush();
        current += segment;
        currentWidth += segmentWidth;
    }
    if (current.length > 0 || lines.length === 0)
        lines.push(current);
    return lines;
}
