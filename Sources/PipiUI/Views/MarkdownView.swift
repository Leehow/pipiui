import AppKit
import SwiftUI

/// Block-level markdown renderer: headings, tables, lists, quotes, rules,
/// fenced code, and a monospaced fallback for ASCII diagrams outside fences.
/// Absolute file paths in prose become clickable (not inside fenced code).
struct MarkdownTextView: View {
    let text: String
    var onFlash: ((String) -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(Self.cachedParse(text).enumerated()), id: \.offset) { _, block in
                MarkdownBlockView(block: block, onFlash: onFlash)
            }
        }
        // Prose uses PathLinkedText (selectable + ⌘+click paths). Residual SwiftUI links still work.
        .environment(\.openURL, PathLinkOpenURL.action(onFlash: onFlash))
        .contextMenu {
            Button("复制") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(text, forType: .string)
            }
        }
    }

    /// 解析结果缓存：SwiftUI body 会反复求值，长会话里重复解析很浪费。
    private static let parseCache: NSCache<NSString, ParsedBlocks> = {
        let cache = NSCache<NSString, ParsedBlocks>()
        cache.countLimit = 500
        return cache
    }()

    private final class ParsedBlocks {
        let blocks: [Block]
        init(_ blocks: [Block]) { self.blocks = blocks }
    }

    static func cachedParse(_ text: String) -> [Block] {
        let key = text as NSString
        if let cached = parseCache.object(forKey: key) { return cached.blocks }
        let blocks = parse(text)
        parseCache.setObject(ParsedBlocks(blocks), forKey: key)
        return blocks
    }

    enum Block {
        case paragraph(String)
        case heading(Int, String)
        case code(String)
        case mono(String) // ASCII art / diagrams outside fences
        case table(header: [String], rows: [[String]])
        case list([ListItem])
        case quote(String)
        case rule
    }

    struct ListItem {
        let marker: String
        let text: String
        let indent: Int
    }

    // MARK: - Parsing

    static func parse(_ text: String) -> [Block] {
        var blocks: [Block] = []
        var paragraph: [String] = []
        var listItems: [ListItem] = []
        var quoteLines: [String] = []
        var codeLines: [String]?

        func flushParagraph() {
            guard !paragraph.isEmpty else { return }
            let joined = paragraph.joined(separator: "\n")
            blocks.append(looksLikeAsciiArt(joined) ? .mono(joined) : .paragraph(joined))
            paragraph = []
        }
        func flushList() {
            if !listItems.isEmpty { blocks.append(.list(listItems)); listItems = [] }
        }
        func flushQuote() {
            if !quoteLines.isEmpty { blocks.append(.quote(quoteLines.joined(separator: "\n"))); quoteLines = [] }
        }
        func flushAll() { flushParagraph(); flushList(); flushQuote() }

        let lines = text.components(separatedBy: "\n")
        var i = 0
        while i < lines.count {
            let line = lines[i]
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            if codeLines != nil {
                if trimmed.hasPrefix("```") {
                    blocks.append(.code(codeLines!.joined(separator: "\n")))
                    codeLines = nil
                } else {
                    codeLines!.append(line)
                }
                i += 1; continue
            }
            if trimmed.hasPrefix("```") {
                flushAll(); codeLines = []; i += 1; continue
            }
            if trimmed.hasPrefix("|"), i + 1 < lines.count, isTableSeparator(lines[i + 1]) {
                flushAll()
                let header = tableCells(trimmed)
                var rows: [[String]] = []
                i += 2
                while i < lines.count {
                    let rowTrimmed = lines[i].trimmingCharacters(in: .whitespaces)
                    guard rowTrimmed.hasPrefix("|") else { break }
                    rows.append(tableCells(rowTrimmed))
                    i += 1
                }
                blocks.append(.table(header: header, rows: rows))
                continue
            }
            if trimmed.isEmpty { flushAll(); i += 1; continue }
            if let (level, title) = headingLevel(trimmed) {
                flushAll(); blocks.append(.heading(level, title)); i += 1; continue
            }
            if trimmed == "---" || trimmed == "***" || trimmed == "___" {
                flushAll(); blocks.append(.rule); i += 1; continue
            }
            if trimmed.hasPrefix(">") {
                flushParagraph(); flushList()
                quoteLines.append(String(trimmed.dropFirst()).trimmingCharacters(in: .whitespaces))
                i += 1; continue
            }
            if let item = listItem(line) {
                flushParagraph(); flushQuote()
                listItems.append(item)
                i += 1; continue
            }
            flushList(); flushQuote()
            paragraph.append(line)
            i += 1
        }
        if let codeLines { blocks.append(.code(codeLines.joined(separator: "\n"))) }
        flushAll()
        return blocks
    }

    private static func headingLevel(_ line: String) -> (Int, String)? {
        guard line.hasPrefix("#") else { return nil }
        let hashes = line.prefix(while: { $0 == "#" })
        guard hashes.count <= 6 else { return nil }
        let rest = line.dropFirst(hashes.count)
        guard rest.first == " " else { return nil }
        return (hashes.count, rest.trimmingCharacters(in: .whitespaces))
    }

    private static func isTableSeparator(_ line: String) -> Bool {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.hasPrefix("|") || trimmed.contains("-") else { return false }
        let stripped = trimmed.filter { !" |:-".contains($0) }
        return stripped.isEmpty && trimmed.contains("-")
    }

    private static func tableCells(_ line: String) -> [String] {
        var cells = line.split(separator: "|", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
        if cells.first?.isEmpty == true { cells.removeFirst() }
        if cells.last?.isEmpty == true { cells.removeLast() }
        return cells
    }

    private static func listItem(_ line: String) -> ListItem? {
        let leading = line.prefix(while: { $0 == " " }).count
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        for bullet in ["- ", "* ", "+ "] where trimmed.hasPrefix(bullet) {
            return ListItem(marker: "•", text: String(trimmed.dropFirst(2)), indent: leading / 2)
        }
        if let dot = trimmed.firstIndex(where: { $0 == "." || $0 == ")" }),
           trimmed.index(after: dot) < trimmed.endIndex,
           trimmed[trimmed.index(after: dot)] == " ",
           !trimmed[..<dot].isEmpty, trimmed[..<dot].allSatisfy(\.isNumber) {
            return ListItem(
                marker: String(trimmed[..<dot]) + ".",
                text: String(trimmed[trimmed.index(dot, offsetBy: 2)...]),
                indent: leading / 2
            )
        }
        return nil
    }

    /// 含框线字符或多行大量空格对齐的段落按等宽渲染，避免简图错位。
    private static func looksLikeAsciiArt(_ text: String) -> Bool {
        let artChars = CharacterSet(charactersIn: "│┌┐└┘├┤┬┴┼─═║╔╗╚╝▼▲◄►")
        if text.unicodeScalars.contains(where: { artChars.contains($0) }) { return true }
        let lines = text.components(separatedBy: "\n")
        guard lines.count >= 3 else { return false }
        let aligned = lines.filter { $0.contains("   ") || $0.contains("-->") || $0.contains("|") }
        return aligned.count >= lines.count / 2 + 1
    }

    static func inline(_ string: String) -> AttributedString {
        (try? AttributedString(
            markdown: string,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(string)
    }

    /// Inline markdown + absolute path / file:// links (for prose blocks only).
    static func inlineWithPaths(_ string: String) -> AttributedString {
        // Plain prose without markdown markers: pure path linking is simpler/safer.
        if !hasInlineMarkdownMarkers(string) {
            return FileReveal.attributedStringLinkingPaths(string)
        }
        let md = inline(string)
        return FileReveal.injectPathLinks(into: md)
    }

    private static func hasInlineMarkdownMarkers(_ string: String) -> Bool {
        string.contains("*")
            || string.contains("_")
            || string.contains("`")
            || string.contains("[")
            || string.contains("](")
            || string.contains("~~")
    }
}

private struct MarkdownBlockView: View {
    let block: MarkdownTextView.Block
    var onFlash: ((String) -> Void)? = nil

    var body: some View {
        switch block {
        case .paragraph(let text):
            PathLinkedText(
                attributed: MarkdownTextView.inlineWithPaths(text),
                onFlash: onFlash
            )
        case .heading(let level, let title):
            PathLinkedText(
                attributed: MarkdownTextView.inlineWithPaths(title),
                nsFont: headingNSFont(level),
                onFlash: onFlash
            )
            .padding(.top, level <= 2 ? 6 : 2)
        case .code(let code), .mono(let code):
            // Do NOT path-link inside fenced / mono code bodies.
            // Code blocks keep SwiftUI Text + textSelection (no path ⌘+click required).
            ScrollView(.horizontal) {
                // 含框线字符的图走终端式网格渲染（CJK 占两格，框线严格对齐）
                if MonoArtView.hasBoxDrawing(code) {
                    MonoArtView(text: code)
                        .padding(10)
                } else {
                    Text(code)
                        .font(.callout.monospaced())
                        .textSelection(.enabled)
                        .padding(10)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
        case .table(let header, let rows):
            tableView(header: header, rows: rows)
        case .list(let items):
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(item.marker)
                            .foregroundStyle(.secondary)
                        PathLinkedText(
                            attributed: MarkdownTextView.inlineWithPaths(item.text),
                            onFlash: onFlash
                        )
                    }
                    .padding(.leading, CGFloat(item.indent) * 16)
                }
            }
        case .quote(let text):
            HStack(alignment: .top, spacing: 8) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color.accentColor.opacity(0.5))
                    .frame(width: 3)
                PathLinkedText(
                    attributed: {
                        var a = MarkdownTextView.inlineWithPaths(text)
                        a.foregroundColor = Color.secondary
                        return a
                    }(),
                    onFlash: onFlash
                )
            }
        case .rule:
            Divider()
        }
    }

    private func headingNSFont(_ level: Int) -> NSFont {
        switch level {
        case 1:
            return NSFont.systemFont(ofSize: NSFont.systemFontSize + 5, weight: .bold)
        case 2:
            return NSFont.systemFont(ofSize: NSFont.systemFontSize + 3, weight: .semibold)
        case 3:
            return NSFont.systemFont(ofSize: NSFont.systemFontSize + 1, weight: .semibold)
        default:
            return NSFont.systemFont(ofSize: NSFont.systemFontSize, weight: .semibold)
        }
    }

    private func tableView(header: [String], rows: [[String]]) -> some View {
        let columns = max(header.count, rows.map(\.count).max() ?? 0)
        let headerFont = NSFont.systemFont(ofSize: NSFont.systemFontSize, weight: .semibold)
        return ScrollView(.horizontal) {
            Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 0) {
                GridRow {
                    ForEach(0..<columns, id: \.self) { c in
                        PathLinkedText(
                            attributed: MarkdownTextView.inlineWithPaths(c < header.count ? header[c] : ""),
                            lineLimit: 3,
                            nsFont: headerFont,
                            onFlash: onFlash
                        )
                    }
                }
                .padding(.vertical, 6)
                Divider()
                ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                    GridRow {
                        ForEach(0..<columns, id: \.self) { c in
                            PathLinkedText(
                                attributed: MarkdownTextView.inlineWithPaths(c < row.count ? row[c] : ""),
                                lineLimit: 3,
                                onFlash: onFlash
                            )
                        }
                    }
                    .padding(.vertical, 5)
                    .background(index.isMultiple(of: 2) ? Color.clear : Color.primary.opacity(0.025))
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 4)
        }
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.03)))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary.opacity(0.08)))
    }
}
