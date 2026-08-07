import AppKit
import SwiftUI

/// Block-level markdown renderer: headings, tables, lists, quotes, rules,
/// fenced code, and a monospaced fallback for ASCII diagrams outside fences.
/// Absolute file paths in prose become clickable (not inside fenced code).
struct MarkdownTextView: View {
    let text: String
    var lineLimit: Int? = nil
    /// Streaming rows may defer expensive inline markdown on the unstable tail.
    /// Settled messages leave this `false` so rendering stays bit-identical.
    var isStreaming: Bool = false
    var onFlash: ((String) -> Void)? = nil
    @Environment(\.chatTypography) private var chatTypography
    /// 文档路径 ⌘+点击 → 右侧文档面板（ChatDetailView 注入；nil 时回退访达显示）。
    @Environment(\.openDocument) private var openDocument

    var body: some View {
        // SwiftUI gives every block its own text-selection host, so a drag cannot cross a
        // paragraph/list/code boundary. One NSTextView keeps all rendered blocks in one
        // NSTextStorage, which is the unit AppKit uses for native drag selection.
        SelectableMarkdownTextView(
            markdownText: text,
            typography: chatTypography,
            maximumNumberOfLines: lineLimit,
            isStreaming: isStreaming,
            onOpenDocument: openDocument,
            onFlash: onFlash
        )
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

    enum Block: Equatable {
        case paragraph(String)
        case heading(Int, String)
        case code(String)
        case mono(String) // ASCII art / diagrams outside fences
        case table(header: [String], rows: [[String]])
        case list([ListItem])
        case quote(String)
        case rule
    }

    struct ListItem: Equatable {
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

    fileprivate static func headingLevel(_ line: String) -> (Int, String)? {
        guard line.hasPrefix("#") else { return nil }
        let hashes = line.prefix(while: { $0 == "#" })
        guard hashes.count <= 6 else { return nil }
        let rest = line.dropFirst(hashes.count)
        guard rest.first == " " else { return nil }
        return (hashes.count, rest.trimmingCharacters(in: .whitespaces))
    }

    fileprivate static func isTableSeparator(_ line: String) -> Bool {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.hasPrefix("|") || trimmed.contains("-") else { return false }
        let stripped = trimmed.filter { !" |:-".contains($0) }
        return stripped.isEmpty && trimmed.contains("-")
    }

    fileprivate static func tableCells(_ line: String) -> [String] {
        var cells = line.split(separator: "|", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
        if cells.first?.isEmpty == true { cells.removeFirst() }
        if cells.last?.isEmpty == true { cells.removeLast() }
        return cells
    }

    fileprivate static func listItem(_ line: String) -> ListItem? {
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
    fileprivate static func looksLikeAsciiArt(_ text: String) -> Bool {
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

    /// Inline markdown parse cache. Session history text is immutable, so a warm switch that
    /// rebuilds ~150 `MessageRow`s (each with several markdown blocks) re-parses nothing — the
    /// `AttributedString(markdown:)` Foundation call is the single biggest main-thread cost there.
    /// Keyed by the raw string, matching `parseCache`.
    private static let inlineCache: NSCache<NSString, InlineBox> = {
        let cache = NSCache<NSString, InlineBox>()
        cache.countLimit = 1000
        return cache
    }()

    private final class InlineBox {
        let attributed: AttributedString
        init(_ attributed: AttributedString) { self.attributed = attributed }
    }

    /// Inline markdown for prose blocks. Path style + ⌘+click targets are applied once in
    /// `PathLinkedText` via `FileReveal.pathLinkedContent` (avoids a second full-text scan).
    /// Result is cached by the raw string (immutable history text → always hits after first view).
    static func inlineWithPaths(_ string: String) -> AttributedString {
        let key = string as NSString
        if let cached = inlineCache.object(forKey: key) { return cached.attributed }
        // Plain prose without markdown markers: hand plain attributed text to PathLinkedText.
        let result = hasInlineMarkdownMarkers(string) ? inline(string) : AttributedString(string)
        inlineCache.setObject(InlineBox(result), forKey: key)
        return result
    }

    /// Test / memory-pressure helper: drop the inline markdown cache.
    static func clearInlineCache() {
        inlineCache.removeAllObjects()
    }

    private static func hasInlineMarkdownMarkers(_ string: String) -> Bool {
        string.contains("*")
            || string.contains("_")
            || string.contains("`")
            || string.contains("[")
            || string.contains("](")
            || string.contains("~~")
    }

    /// One AttributedString for a whole list block so bullets and text preserve
    /// one visual run. (Separate `PathLinkedText` per item cannot share styling.)
    static func listAttributed(_ items: [ListItem]) -> AttributedString {
        var result = AttributedString()
        for (index, item) in items.enumerated() {
            if index > 0 { result.append(AttributedString("\n")) }
            if item.indent > 0 {
                result.append(AttributedString(String(repeating: "  ", count: item.indent)))
            }
            var marker = AttributedString(item.marker + " ")
            marker.foregroundColor = Color.secondary
            result.append(marker)
            result.append(inlineWithPaths(item.text))
        }
        return result
    }
}

/// Flattens rendered markdown blocks into one attributed storage while preserving the text a
/// user sees and copies. The AppKit bridge below then provides a single native selection range.
enum MarkdownSelectionContent {
    enum ParagraphRole {
        case body
        case list
        case heading
        case code
    }

    static func attributedString(
        for text: String,
        typography: ChatTypography = .make(fontSize: ChatTypography.defaultFontSize)
    ) -> NSAttributedString {
        attributedString(for: MarkdownTextView.cachedParse(text), typography: typography)
    }

    static func attributedString(
        for blocks: [MarkdownTextView.Block],
        typography: ChatTypography = .make(fontSize: ChatTypography.defaultFontSize),
        inlineHighlight: Bool = true
    ) -> NSAttributedString {
        let result = NSMutableAttributedString()
        append(blocks, to: result, typography: typography, inlineHighlight: inlineHighlight)
        return result
    }

    static func append(
        _ blocks: ArraySlice<MarkdownTextView.Block>,
        to result: NSMutableAttributedString,
        typography: ChatTypography,
        inlineHighlight: Bool = true
    ) {
        append(Array(blocks), to: result, typography: typography, inlineHighlight: inlineHighlight)
    }

    static func append(
        _ blocks: [MarkdownTextView.Block],
        to result: NSMutableAttributedString,
        typography: ChatTypography,
        inlineHighlight: Bool = true
    ) {
        let bodyStyle = paragraphStyle(for: typography, role: .body)
        let listStyle = paragraphStyle(for: typography, role: .list)
        let headingStyle = paragraphStyle(for: typography, role: .heading)
        let codeStyle = paragraphStyle(for: typography, role: .code)

        for block in blocks {
            if result.length > 0 {
                result.append(blockSeparator(typography: typography))
            }
            switch block {
            case .paragraph(let paragraph):
                result.append(rendered(
                    proseAttributed(paragraph, inlineHighlight: inlineHighlight),
                    font: typography.bodyNSFont,
                    codeFont: typography.codeNSFont,
                    style: bodyStyle
                ))
            case .heading(let level, let title):
                result.append(rendered(
                    proseAttributed(title, inlineHighlight: inlineHighlight),
                    font: typography.headingNSFont(level: level),
                    codeFont: typography.codeNSFont,
                    style: headingStyle
                ))
            case .code(let code), .mono(let code):
                result.append(rendered(
                    AttributedString(code),
                    font: typography.codeNSFont,
                    codeFont: typography.codeNSFont,
                    style: codeStyle,
                    background: NSColor.labelColor.withAlphaComponent(0.05)
                ))
            case .list(let items):
                result.append(rendered(
                    listAttributed(items, inlineHighlight: inlineHighlight),
                    font: typography.bodyNSFont,
                    codeFont: typography.codeNSFont,
                    style: listStyle
                ))
            case .quote(let quote):
                result.append(rendered(
                    proseAttributed(quote, inlineHighlight: inlineHighlight),
                    font: typography.bodyNSFont,
                    codeFont: typography.codeNSFont,
                    style: bodyStyle,
                    color: .secondaryLabelColor
                ))
            case .table(let header, let rows):
                result.append(rendered(
                    tableAttributed(header: header, rows: rows, inlineHighlight: inlineHighlight),
                    font: typography.bodyNSFont,
                    codeFont: typography.codeNSFont,
                    style: bodyStyle
                ))
            case .rule:
                result.append(rendered(
                    AttributedString("────────"),
                    font: typography.bodyNSFont,
                    codeFont: typography.codeNSFont,
                    style: bodyStyle,
                    color: .separatorColor
                ))
            }
        }
    }

    /// Streaming tail path: skip `AttributedString(markdown:)` until the block settles.
    private static func proseAttributed(_ string: String, inlineHighlight: Bool) -> AttributedString {
        inlineHighlight ? MarkdownTextView.inlineWithPaths(string) : AttributedString(string)
    }

    private static func listAttributed(
        _ items: [MarkdownTextView.ListItem],
        inlineHighlight: Bool
    ) -> AttributedString {
        guard inlineHighlight else {
            var result = AttributedString()
            for (index, item) in items.enumerated() {
                if index > 0 { result.append(AttributedString("\n")) }
                if item.indent > 0 {
                    result.append(AttributedString(String(repeating: "  ", count: item.indent)))
                }
                var marker = AttributedString(item.marker + " ")
                marker.foregroundColor = Color.secondary
                result.append(marker)
                result.append(AttributedString(item.text))
            }
            return result
        }
        return MarkdownTextView.listAttributed(items)
    }

    /// NSTextView ignores SwiftUI `.lineSpacing`; spacing must live on `NSParagraphStyle`.
    static func paragraphStyle(
        for typography: ChatTypography,
        role: ParagraphRole = .body
    ) -> NSParagraphStyle {
        let style = NSMutableParagraphStyle()
        switch role {
        case .body:
            style.lineSpacing = typography.lineSpacing
            style.paragraphSpacing = typography.paragraphSpacing
        case .list:
            style.lineSpacing = typography.lineSpacing
            style.paragraphSpacing = typography.listItemSpacing
        case .heading:
            style.lineSpacing = typography.headingLineSpacing
            style.paragraphSpacing = typography.paragraphSpacing
        case .code:
            // ~1.5× total line-height for monospace blocks.
            style.lineSpacing = typography.fontSize * 0.3
            style.paragraphSpacing = typography.paragraphSpacing
        }
        return style
    }

    /// Empty paragraph between markdown blocks; height is exactly `blockSpacing`.
    static func blockSeparator(typography: ChatTypography) -> NSAttributedString {
        let style = NSMutableParagraphStyle()
        style.minimumLineHeight = typography.blockSpacing
        style.maximumLineHeight = typography.blockSpacing
        style.lineSpacing = 0
        style.paragraphSpacing = 0
        let result = NSMutableAttributedString(string: "\n\n")
        let range = NSRange(location: 0, length: result.length)
        result.addAttribute(.font, value: typography.bodyNSFont, range: range)
        result.addAttribute(.paragraphStyle, value: style, range: range)
        return result
    }

    /// Tab/newline join of table cells, preserving per-cell inline markdown (bold/code/…).
    private static func tableAttributed(
        header: [String],
        rows: [[String]],
        inlineHighlight: Bool = true
    ) -> AttributedString {
        var result = AttributedString()
        let allRows = [header] + rows
        for (rowIndex, row) in allRows.enumerated() {
            if rowIndex > 0 { result.append(AttributedString("\n")) }
            for (cellIndex, cell) in row.enumerated() {
                if cellIndex > 0 { result.append(AttributedString("\t")) }
                result.append(proseAttributed(cell, inlineHighlight: inlineHighlight))
            }
        }
        return result
    }

    private static func rendered(
        _ text: AttributedString,
        font: NSFont,
        codeFont: NSFont,
        style: NSParagraphStyle,
        color: NSColor = .labelColor,
        background: NSColor? = nil
    ) -> NSAttributedString {
        let result = NSMutableAttributedString(attributedString: NSAttributedString(text))
        let range = NSRange(location: 0, length: result.length)
        guard range.length > 0 else { return result }
        // Per-run fonts: a single body font over the whole range wipes bold/italic/code that
        // Foundation only carries as `inlinePresentationIntent` after markdown parse.
        result.enumerateAttributes(in: range) { attrs, r, _ in
            let resolved = fontByMergingMarkdownTraits(
                base: font,
                codeFont: codeFont,
                attributes: attrs
            )
            result.addAttribute(.font, value: resolved, range: r)
            let intent = inlinePresentationIntent(from: attrs)
            if intent.contains(.strikethrough),
               attrs[.strikethroughStyle] == nil {
                result.addAttribute(
                    .strikethroughStyle,
                    value: NSUnderlineStyle.single.rawValue,
                    range: r
                )
            }
        }
        // 默认色只补无颜色的 run：inlineWithPaths 注入的路径 accent 色/下划线必须保留，
        // 否则用户看不到哪里可以 ⌘+点击。
        var uncolored: [NSRange] = []
        result.enumerateAttribute(.foregroundColor, in: range) { value, r, _ in
            if value == nil { uncolored.append(r) }
        }
        for r in uncolored {
            result.addAttribute(.foregroundColor, value: color, range: r)
        }
        result.addAttribute(.paragraphStyle, value: style, range: range)
        if let background {
            result.addAttribute(.backgroundColor, value: background, range: range)
        }
        return result
    }

    /// Read `inlinePresentationIntent` whether bridged as the OptionSet or an NSNumber.
    private static func inlinePresentationIntent(
        from attributes: [NSAttributedString.Key: Any]
    ) -> InlinePresentationIntent {
        if let intent = attributes[.inlinePresentationIntent] as? InlinePresentationIntent {
            return intent
        }
        if let number = attributes[.inlinePresentationIntent] as? NSNumber {
            return InlinePresentationIntent(rawValue: number.uintValue)
        }
        return []
    }

    /// Map markdown inline intents onto a concrete NSFont so NSTextView paints bold/code.
    private static func fontByMergingMarkdownTraits(
        base: NSFont,
        codeFont: NSFont,
        attributes: [NSAttributedString.Key: Any]
    ) -> NSFont {
        let intent = inlinePresentationIntent(from: attributes)
        var traits = (attributes[.font] as? NSFont)?.fontDescriptor.symbolicTraits ?? []
        if intent.contains(.stronglyEmphasized) { traits.insert(.bold) }
        if intent.contains(.emphasized) { traits.insert(.italic) }

        if intent.contains(.code) {
            let weight: NSFont.Weight = traits.contains(.bold) ? .semibold : .regular
            let mono = NSFont.monospacedSystemFont(ofSize: codeFont.pointSize, weight: weight)
            if traits.contains(.italic),
               let italic = font(mono, matchingTraits: mono.fontDescriptor.symbolicTraits.union(.italic)) {
                return italic
            }
            return mono
        }

        guard !traits.isEmpty else { return base }
        let merged = base.fontDescriptor.symbolicTraits.union(traits)
        return font(base, matchingTraits: merged) ?? base
    }

    private static func font(
        _ base: NSFont,
        matchingTraits traits: NSFontDescriptor.SymbolicTraits
    ) -> NSFont? {
        // AppKit's withSymbolicTraits is non-optional (UIKit's is Optional).
        let descriptor = base.fontDescriptor.withSymbolicTraits(traits)
        return NSFont(descriptor: descriptor, size: base.pointSize)
    }
}

/// Forward-only block parser for the streaming tail.
///
/// Complete lines (ending in `\n`) commit into parser state. The trailing partial line is
/// held and only applied during `snapshotBlocks()` (EOF flush), matching `MarkdownTextView.parse`
/// which always processes the final component. Append cost is O(new complete lines).
private final class IncrementalMarkdownBlockParser {
    private var blocks: [MarkdownTextView.Block] = []
    private var paragraph: [String] = []
    private var listItems: [MarkdownTextView.ListItem] = []
    private var quoteLines: [String] = []
    private var codeLines: [String]?
    /// Incomplete trailing line (no terminating newline yet).
    private var partialLine = ""
    /// `components(separatedBy: "\n")` yields a final `""` when the source ends with `\n`.
    /// Track that without committing it until `snapshotBlocks()`, so a later append can still
    /// continue the line after the trailing newline of an intermediate chunk.
    private var committedEndsWithNewline = false
    /// One-line lookahead: a `|` line waits for the separator before becoming a table.
    private var pendingTableHeader: String?
    private var tableHeader: [String]?
    private var tableRows: [[String]] = []

    func reset() {
        blocks = []
        paragraph = []
        listItems = []
        quoteLines = []
        codeLines = nil
        partialLine = ""
        committedEndsWithNewline = false
        pendingTableHeader = nil
        tableHeader = nil
        tableRows = []
    }

    func replaceAll(with text: String) {
        reset()
        append(text)
    }

    func append(_ text: String) {
        guard !text.isEmpty else { return }
        var start = text.startIndex
        if !partialLine.isEmpty {
            // Resume the unfinished line.
            if let nl = text.firstIndex(of: "\n") {
                let line = partialLine + text[start..<nl]
                partialLine = ""
                processLine(line)
                start = text.index(after: nl)
                committedEndsWithNewline = start == text.endIndex
            } else {
                partialLine += text
                committedEndsWithNewline = false
                return
            }
        }
        while start < text.endIndex {
            if let nl = text[start...].firstIndex(of: "\n") {
                processLine(String(text[start..<nl]))
                start = text.index(after: nl)
                committedEndsWithNewline = start == text.endIndex
            } else {
                partialLine = String(text[start...])
                committedEndsWithNewline = false
                return
            }
        }
    }

    /// Apply pending partial line + open-block flushes without mutating committed state.
    func snapshotBlocks() -> [MarkdownTextView.Block] {
        let savedBlocks = blocks
        let savedParagraph = paragraph
        let savedList = listItems
        let savedQuote = quoteLines
        let savedCode = codeLines
        let savedPartial = partialLine
        let savedEndsWithNewline = committedEndsWithNewline
        let savedPendingHeader = pendingTableHeader
        let savedTableHeader = tableHeader
        let savedTableRows = tableRows

        if !partialLine.isEmpty {
            processLine(partialLine)
            partialLine = ""
        } else if committedEndsWithNewline {
            // Match `"a\n".components(separatedBy:)` → `["a", ""]`.
            processLine("")
        }
        flushAll()

        let result = blocks

        blocks = savedBlocks
        paragraph = savedParagraph
        listItems = savedList
        quoteLines = savedQuote
        codeLines = savedCode
        partialLine = savedPartial
        committedEndsWithNewline = savedEndsWithNewline
        pendingTableHeader = savedPendingHeader
        tableHeader = savedTableHeader
        tableRows = savedTableRows
        return result
    }

    private func flushParagraph() {
        guard !paragraph.isEmpty else { return }
        let joined = paragraph.joined(separator: "\n")
        blocks.append(
            MarkdownTextView.looksLikeAsciiArt(joined) ? .mono(joined) : .paragraph(joined)
        )
        paragraph = []
    }

    private func flushList() {
        if !listItems.isEmpty {
            blocks.append(.list(listItems))
            listItems = []
        }
    }

    private func flushQuote() {
        if !quoteLines.isEmpty {
            blocks.append(.quote(quoteLines.joined(separator: "\n")))
            quoteLines = []
        }
    }

    private func flushTable() {
        if let header = tableHeader {
            blocks.append(.table(header: header, rows: tableRows))
        }
        tableHeader = nil
        tableRows = []
    }

    private func flushPendingTableHeaderAsProse() {
        guard let header = pendingTableHeader else { return }
        pendingTableHeader = nil
        // Re-process as a normal content line (not a table).
        processContentLine(header)
    }

    private func flushAll() {
        flushPendingTableHeaderAsProse()
        flushTable()
        flushParagraph()
        flushList()
        flushQuote()
        if let codeLines {
            blocks.append(.code(codeLines.joined(separator: "\n")))
            self.codeLines = nil
        }
    }

    private func processLine(_ line: String) {
        let trimmed = line.trimmingCharacters(in: .whitespaces)

        if codeLines != nil {
            if trimmed.hasPrefix("```") {
                blocks.append(.code(codeLines!.joined(separator: "\n")))
                codeLines = nil
            } else {
                codeLines!.append(line)
            }
            return
        }

        // Resolve one-line table lookahead.
        if let header = pendingTableHeader {
            pendingTableHeader = nil
            if MarkdownTextView.isTableSeparator(line) {
                flushParagraph()
                flushList()
                flushQuote()
                tableHeader = MarkdownTextView.tableCells(
                    header.trimmingCharacters(in: .whitespaces)
                )
                tableRows = []
                return
            }
            processContentLine(header)
            // Fall through to process `line`.
        }

        if tableHeader != nil {
            if trimmed.hasPrefix("|") {
                tableRows.append(MarkdownTextView.tableCells(trimmed))
                return
            }
            flushTable()
            // Fall through.
        }

        if trimmed.hasPrefix("```") {
            flushParagraph()
            flushList()
            flushQuote()
            flushTable()
            codeLines = []
            return
        }

        if trimmed.hasPrefix("|") {
            // Need the next line to know if this opens a table.
            pendingTableHeader = line
            return
        }

        processContentLine(line)
    }

    private func processContentLine(_ line: String) {
        let trimmed = line.trimmingCharacters(in: .whitespaces)

        if trimmed.isEmpty {
            flushParagraph()
            flushList()
            flushQuote()
            flushTable()
            return
        }
        if let (level, title) = MarkdownTextView.headingLevel(trimmed) {
            flushParagraph()
            flushList()
            flushQuote()
            flushTable()
            blocks.append(.heading(level, title))
            return
        }
        if trimmed == "---" || trimmed == "***" || trimmed == "___" {
            flushParagraph()
            flushList()
            flushQuote()
            flushTable()
            blocks.append(.rule)
            return
        }
        if trimmed.hasPrefix(">") {
            flushParagraph()
            flushList()
            flushTable()
            quoteLines.append(
                String(trimmed.dropFirst()).trimmingCharacters(in: .whitespaces)
            )
            return
        }
        if let item = MarkdownTextView.listItem(line) {
            flushParagraph()
            flushQuote()
            flushTable()
            listItems.append(item)
            return
        }
        flushList()
        flushQuote()
        flushTable()
        paragraph.append(line)
    }
}

/// Per-native-host append lineage. Immutable/remounted messages still use the exact-string
/// caches above; only a strict append with unchanged typography is allowed to reuse blocks.
///
/// Streaming hot path:
/// - stable prefix blocks are fully highlighted once and never reparsed on append
/// - tail is scanned with a forward line cursor (O(new lines), not O(tail))
/// - optional lightweight tail skips inline markdown until the row settles
final class MarkdownStreamingRenderer {
    enum Update {
        case unchanged
        case full(NSAttributedString)
        case replace(range: NSRange, tail: NSAttributedString)
    }

    /// When true, only stable blocks pay for `AttributedString(markdown:)`. Tail prose is plain
    /// until promoted into the stable prefix or the host leaves streaming mode.
    var prefersLightweightTail = false

    /// True when the latest `.replace` only mutated the unstable tail (layout may throttle).
    private(set) var lastReplaceThrottleable = false

    private var previousText = ""
    private var typography: ChatTypography?
    private var stableBlocks: [MarkdownTextView.Block] = []
    private let stableAttributed = NSMutableAttributedString()
    private var renderedLength = 0
    /// UTF-16 offset where the current unstable tail begins in `previousText`.
    private var tailStartUTF16 = 0
    private let tailParser = IncrementalMarkdownBlockParser()

    func update(text: String, typography newTypography: ChatTypography) -> Update {
        lastReplaceThrottleable = false
        if text == previousText, typography == newTypography {
            return .unchanged
        }
        let isAppend = text.count > previousText.count && text.hasPrefix(previousText)
        guard isAppend, typography == newTypography else {
            return reset(text: text, typography: newTypography)
        }

        let boundary = Self.stablePrefixBoundary(in: text)
        let newTailStartUTF16 = boundary.map { Self.utf16Offset(of: $0, in: text) } ?? 0
        guard newTailStartUTF16 >= tailStartUTF16 else {
            return reset(text: text, typography: newTypography)
        }

        let replacementStart = stableAttributed.length
        var stableGrew = false

        if newTailStartUTF16 > tailStartUTF16 {
            guard let boundary else {
                return reset(text: text, typography: newTypography)
            }
            let newStableBlocks = MarkdownTextView.cachedParse(String(text[..<boundary]))
            guard newStableBlocks.count >= stableBlocks.count,
                  Array(newStableBlocks.prefix(stableBlocks.count)) == stableBlocks else {
                return reset(text: text, typography: newTypography)
            }
            if newStableBlocks.count > stableBlocks.count {
                MarkdownSelectionContent.append(
                    newStableBlocks[stableBlocks.count...],
                    to: stableAttributed,
                    typography: newTypography,
                    inlineHighlight: true
                )
                stableGrew = true
            }
            stableBlocks = newStableBlocks
            tailStartUTF16 = newTailStartUTF16
            tailParser.replaceAll(with: String(text[boundary...]))
        } else {
            // Pure tail growth: feed only the newly appended characters.
            let suffixStart = text.index(text.startIndex, offsetBy: previousText.count)
            tailParser.append(String(text[suffixStart...]))
        }

        let tailBlocks = tailParser.snapshotBlocks()
        let replacement = NSMutableAttributedString()
        if stableAttributed.length > replacementStart {
            replacement.append(stableAttributed.attributedSubstring(
                from: NSRange(
                    location: replacementStart,
                    length: stableAttributed.length - replacementStart
                )
            ))
        }
        if !stableBlocks.isEmpty, !tailBlocks.isEmpty {
            replacement.append(MarkdownSelectionContent.blockSeparator(typography: newTypography))
        }
        replacement.append(MarkdownSelectionContent.attributedString(
            for: tailBlocks,
            typography: newTypography,
            inlineHighlight: !prefersLightweightTail
        ))

        let oldLength = renderedLength
        renderedLength = replacementStart + replacement.length
        previousText = text
        lastReplaceThrottleable = prefersLightweightTail && !stableGrew
        return .replace(
            range: NSRange(location: replacementStart, length: oldLength - replacementStart),
            tail: replacement
        )
    }

    func reset(text: String, typography newTypography: ChatTypography) -> Update {
        lastReplaceThrottleable = false
        let boundary = Self.stablePrefixBoundary(in: text)
        if let boundary {
            stableBlocks = MarkdownTextView.cachedParse(String(text[..<boundary]))
            tailStartUTF16 = Self.utf16Offset(of: boundary, in: text)
            tailParser.replaceAll(with: String(text[boundary...]))
        } else {
            stableBlocks = []
            tailStartUTF16 = 0
            tailParser.replaceAll(with: text)
        }
        stableAttributed.setAttributedString(MarkdownSelectionContent.attributedString(
            for: stableBlocks,
            typography: newTypography,
            inlineHighlight: true
        ))

        let full: NSAttributedString
        if prefersLightweightTail {
            let combined = NSMutableAttributedString(attributedString: stableAttributed)
            let tailBlocks = tailParser.snapshotBlocks()
            if !stableBlocks.isEmpty, !tailBlocks.isEmpty {
                combined.append(MarkdownSelectionContent.blockSeparator(typography: newTypography))
            }
            combined.append(MarkdownSelectionContent.attributedString(
                for: tailBlocks,
                typography: newTypography,
                inlineHighlight: false
            ))
            full = combined
        } else {
            // Settled / exact path: one monolithic parse so storage matches non-streaming hosts.
            full = MarkdownSelectionContent.attributedString(for: text, typography: newTypography)
        }

        previousText = text
        typography = newTypography
        renderedLength = full.length
        return .full(full)
    }

    private static func utf16Offset(of index: String.Index, in text: String) -> Int {
        text[..<index].utf16.count
    }

    /// Returns the start of the penultimate blank-line-delimited content region. Blank lines
    /// inside an open fence are deliberately ignored, so tables/fences/lists/quotes/ASCII-art
    /// cannot reinterpret anything promoted into the stable prefix.
    static func stablePrefixBoundary(in text: String) -> String.Index? {
        var regionStarts: [String.Index] = [text.startIndex]
        var lineStart = text.startIndex
        var inFence = false
        var sawSafeBlank = false

        while lineStart < text.endIndex {
            let newline = text[lineStart...].firstIndex(of: "\n")
            let lineEnd = newline ?? text.endIndex
            let trimmed = text[lineStart..<lineEnd].trimmingCharacters(in: .whitespaces)

            if trimmed.hasPrefix("```") {
                if sawSafeBlank, !inFence, lineStart != text.startIndex {
                    regionStarts.append(lineStart)
                }
                sawSafeBlank = false
                inFence.toggle()
            } else if !inFence, trimmed.isEmpty {
                sawSafeBlank = true
            } else if !inFence, sawSafeBlank {
                regionStarts.append(lineStart)
                sawSafeBlank = false
            }

            guard let newline else { break }
            lineStart = text.index(after: newline)
        }

        guard regionStarts.count >= 3 else { return nil }
        return regionStarts[regionStarts.count - 2]
    }
}

/// AppKit selection host for a complete markdown message. `NSTextView` owns one text storage,
/// so dragging from one paragraph/block into another keeps a continuous selection and copies
/// the full range correctly.
private struct SelectableMarkdownTextView: NSViewRepresentable {
    let markdownText: String
    let typography: ChatTypography
    var maximumNumberOfLines: Int? = nil
    var isStreaming: Bool = false
    var onOpenDocument: ((URL) -> Void)? = nil
    var onFlash: ((String) -> Void)? = nil

    func makeNSView(context: Context) -> MarkdownNativeLayoutView {
        let host = MarkdownNativeLayoutView(frame: .zero)
        update(host)
        return host
    }

    func updateNSView(_ host: MarkdownNativeLayoutView, context: Context) {
        update(host)
    }

    func sizeThatFits(
        _ proposal: ProposedViewSize,
        nsView host: MarkdownNativeLayoutView,
        context: Context
    ) -> CGSize? {
        // A nil/infinite proposal is an unconstrained ideal-size query, not permission
        // to reuse the native view's previous frame width. Returning that old width after
        // a right-panel transition lets SwiftUI preserve a stale row height.
        guard let width = proposal.width,
              width.isFinite,
              width > 0 else { return nil }
        return CGSize(
            width: width,
            height: host.measuredHeight(
                for: width,
                backingScale: backingScale(for: host)
            )
        )
    }

    private func update(_ host: MarkdownNativeLayoutView) {
        host.update(
            markdownText: markdownText,
            typography: typography,
            maximumNumberOfLines: maximumNumberOfLines,
            isStreaming: isStreaming,
            onOpenDocument: onOpenDocument,
            onFlash: onFlash,
            backingScale: backingScale(for: host)
        )
    }

    private func backingScale(for host: NSView) -> CGFloat {
        host.window?.backingScaleFactor
            ?? NSScreen.main?.backingScaleFactor
            ?? 2
    }
}

/// A non-resizing, clipping host makes native text height an explicit SwiftUI contract.
///
/// A vertically resizable bare NSTextView mutates its own frame when TextKit lays out new
/// content, while reporting no intrinsic or fitting height. SwiftUI can therefore retain an
/// old row height as the native view grows and paints into following rows. This wrapper owns
/// the only height calculation, invalidates its intrinsic size for every height-affecting
/// change, and keeps the child exactly inside the frame SwiftUI reserved.
final class MarkdownNativeLayoutView: NSView {
    private struct Measurement {
        let width: CGFloat
        let backingScale: CGFloat
        let height: CGFloat
    }

    private let textView: PathClickTextView
    /// Proposal measurement is intentionally detached from the displayed NSTextView.
    /// Mutating the displayed TextKit container from SwiftUI's size query can schedule
    /// another AppKit layout, which feeds native layout back into AttributeGraph.
    private let measurementStorage = NSTextStorage()
    private let measurementLayoutManager = NSLayoutManager()
    private let measurementContainer = NSTextContainer()
    private var measurement: Measurement?
    private var lastMeasuredWidth: CGFloat?
    private var preferredBodyFont: NSFont?
    private var preferredBackingScale: CGFloat = 2
    private(set) var measurementPassCount = 0
    private(set) var measurementInvalidationCount = 0
    private(set) var intrinsicInvalidationCount = 0
    private let streamingRenderer = MarkdownStreamingRenderer()
    private(set) var tailReplacementCount = 0
    private var isStreamingContent = false
    /// ~30 Hz ceiling for tail-only measure/invalidate while streaming (coalesce is ~50ms).
    private static let tailLayoutCooldown: TimeInterval = 1.0 / 30.0
    private var lastTailLayoutAt: TimeInterval = 0
    private var pendingTailLayoutWork: DispatchWorkItem?

    override init(frame frameRect: NSRect) {
        textView = PathClickTextView(frame: .zero)
        super.init(frame: frameRect)

        textView.isEditable = false
        textView.isSelectable = true
        textView.drawsBackground = false
        textView.textContainerInset = .zero
        textView.textContainer?.lineFragmentPadding = 0
        textView.textContainer?.widthTracksTextView = false
        textView.textContainer?.heightTracksTextView = false
        textView.isHorizontallyResizable = false
        // The wrapper, not NSTextView, owns height. Otherwise assigning content makes
        // NSTextView grow its frame independently of SwiftUI's reserved row.
        textView.isVerticallyResizable = false
        textView.autoresizingMask = [.width, .height]
        addSubview(textView)

        measurementContainer.lineFragmentPadding = 0
        measurementContainer.widthTracksTextView = false
        measurementContainer.heightTracksTextView = false
        measurementStorage.addLayoutManager(measurementLayoutManager)
        measurementLayoutManager.addTextContainer(measurementContainer)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override var isFlipped: Bool { true }

    /// Secondary containment guard. Correctness comes from exact measurement; clipping
    /// only prevents a transient stale frame from drawing over sibling transcript rows.
    override var wantsDefaultClipping: Bool { true }

    override func layout() {
        super.layout()
        textView.frame = bounds
        // Display layout follows the frame SwiftUI already chose. Never invalidate the
        // host's intrinsic size from inside AppKit layout: that closes a feedback loop
        // (SwiftUI layout -> AppKit layout -> intrinsic invalidation -> SwiftUI layout)
        // which AttributeGraph detects during simultaneous transcript-row reflow.
        if let container = textView.textContainer,
           bounds.width.isFinite,
           bounds.width > 0 {
            MarkdownLayoutSizing.updateContainerIfNeeded(
                container,
                proposedWidth: bounds.width,
                backingScale: preferredBackingScale
            )
        }
    }

    override var intrinsicContentSize: NSSize {
        let width = bounds.width.isFinite && bounds.width > 0
            ? bounds.width
            : (lastMeasuredWidth ?? 0)
        guard width > 0 else {
            return NSSize(
                width: NSView.noIntrinsicMetric,
                height: NSView.noIntrinsicMetric
            )
        }
        return NSSize(
            width: NSView.noIntrinsicMetric,
            height: measuredHeight(for: width, backingScale: preferredBackingScale)
        )
    }

    override var fittingSize: NSSize {
        let intrinsic = intrinsicContentSize
        guard intrinsic.height != NSView.noIntrinsicMetric else {
            return super.fittingSize
        }
        return NSSize(
            width: bounds.width.isFinite && bounds.width > 0
                ? bounds.width
                : (lastMeasuredWidth ?? 0),
            height: intrinsic.height
        )
    }

    @discardableResult
    func update(
        markdownText: String,
        typography: ChatTypography,
        maximumNumberOfLines: Int?,
        isStreaming: Bool = false,
        onOpenDocument: ((URL) -> Void)?,
        onFlash: ((String) -> Void)?,
        backingScale: CGFloat
    ) -> Bool {
        let streamingChanged = isStreamingContent != isStreaming
        isStreamingContent = isStreaming
        streamingRenderer.prefersLightweightTail = isStreaming
        // Leaving stream mode must rebuild with full inline highlight so settled pixels match.
        if streamingChanged, !isStreaming, !markdownText.isEmpty {
            let renderUpdate = streamingRenderer.reset(text: markdownText, typography: typography)
            return update(
                renderUpdate: renderUpdate,
                bodyFont: typography.bodyNSFont,
                maximumNumberOfLines: maximumNumberOfLines,
                onOpenDocument: onOpenDocument,
                onFlash: onFlash,
                backingScale: backingScale,
                throttleLayout: false
            )
        }
        var renderUpdate = streamingRenderer.update(text: markdownText, typography: typography)
        if case .replace(let range, _) = renderUpdate,
           NSMaxRange(range) > (textView.textStorage?.length ?? 0)
            || NSMaxRange(range) > measurementStorage.length {
            // A host/storage discontinuity is not an append lineage. Re-establish the exact
            // full renderer state instead of risking a partial or out-of-range edit.
            renderUpdate = streamingRenderer.reset(text: markdownText, typography: typography)
        }
        return update(
            renderUpdate: renderUpdate,
            bodyFont: typography.bodyNSFont,
            maximumNumberOfLines: maximumNumberOfLines,
            onOpenDocument: onOpenDocument,
            onFlash: onFlash,
            backingScale: backingScale,
            throttleLayout: isStreaming && streamingRenderer.lastReplaceThrottleable
        )
    }

    @discardableResult
    func update(
        attributedText: NSAttributedString,
        bodyFont: NSFont,
        maximumNumberOfLines: Int?,
        onOpenDocument: ((URL) -> Void)?,
        onFlash: ((String) -> Void)?,
        backingScale: CGFloat
    ) -> Bool {
        update(
            renderUpdate: .full(attributedText),
            bodyFont: bodyFont,
            maximumNumberOfLines: maximumNumberOfLines,
            onOpenDocument: onOpenDocument,
            onFlash: onFlash,
            backingScale: backingScale,
            throttleLayout: false
        )
    }

    private func update(
        renderUpdate: MarkdownStreamingRenderer.Update,
        bodyFont: NSFont,
        maximumNumberOfLines: Int?,
        onOpenDocument: ((URL) -> Void)?,
        onFlash: ((String) -> Void)?,
        backingScale: CGFloat,
        throttleLayout: Bool
    ) -> Bool {
        var heightChanged = false
        var invalidatedRange: NSRange?

        if preferredBodyFont?.isEqual(bodyFont) != true {
            preferredBodyFont = bodyFont
            textView.font = bodyFont
            heightChanged = true
        }
        switch renderUpdate {
        case .unchanged:
            break
        case .full(let attributedText) where !textView.attributedString().isEqual(to: attributedText):
            // Set the fallback before installing attributed runs; assigning textColor on
            // every update could overwrite path accent colors in unchanged storage.
            textView.textColor = .labelColor
            textView.textStorage?.setAttributedString(attributedText)
            measurementStorage.setAttributedString(attributedText)
            heightChanged = true
        case .replace(let range, let tail)
            where NSMaxRange(range) <= (textView.textStorage?.length ?? 0)
                && NSMaxRange(range) <= measurementStorage.length:
            textView.textStorage?.replaceCharacters(in: range, with: tail)
            measurementStorage.replaceCharacters(in: range, with: tail)
            invalidatedRange = NSRange(location: range.location, length: tail.length)
            tailReplacementCount += 1
            heightChanged = true
        default:
            break
        }

        let limit = max(0, maximumNumberOfLines ?? 0)
        let lineBreakMode: NSLineBreakMode = limit > 0 ? .byTruncatingTail : .byWordWrapping
        for container in [textView.textContainer, measurementContainer].compactMap({ $0 }) {
            if container.maximumNumberOfLines != limit || container.lineBreakMode != lineBreakMode {
                container.maximumNumberOfLines = limit
                container.lineBreakMode = lineBreakMode
                heightChanged = true
            }
        }

        let scale = MarkdownLayoutSizing.validBackingScale(backingScale)
        if preferredBackingScale != scale {
            preferredBackingScale = scale
            heightChanged = true
        }

        textView.onOpenDocument = onOpenDocument
        textView.onFlash = onFlash

        if heightChanged {
            noteHeightAffectingChange(
                characterRange: invalidatedRange,
                throttleable: throttleLayout
            )
        }
        return heightChanged
    }

    /// Tail-only streaming edits may coalesce measure/intrinsic invalidation to ~30 Hz.
    /// Text storage still updates immediately so glyphs keep streaming; only layout cost drops.
    private func noteHeightAffectingChange(characterRange: NSRange?, throttleable: Bool) {
        if !throttleable || !isStreamingContent {
            pendingTailLayoutWork?.cancel()
            pendingTailLayoutWork = nil
            lastTailLayoutAt = ProcessInfo.processInfo.systemUptime
            invalidateMeasuredHeight(characterRange: characterRange)
            return
        }

        let now = ProcessInfo.processInfo.systemUptime
        if now - lastTailLayoutAt >= Self.tailLayoutCooldown {
            pendingTailLayoutWork?.cancel()
            pendingTailLayoutWork = nil
            lastTailLayoutAt = now
            invalidateMeasuredHeight(characterRange: characterRange)
            return
        }

        // Keep measurement storage dirty for the next allowed pass without thrashing SwiftUI.
        if let characterRange, measurementStorage.length > 0 {
            let range = NSRange(
                location: min(characterRange.location, measurementStorage.length),
                length: min(
                    characterRange.length,
                    measurementStorage.length - min(characterRange.location, measurementStorage.length)
                )
            )
            measurementLayoutManager.invalidateLayout(
                forCharacterRange: range,
                actualCharacterRange: nil
            )
        }
        // Drop the cached height so the next unthrottled measure is fresh, but do not
        // bounce intrinsicContentSize every coalesce tick.
        measurement = nil

        pendingTailLayoutWork?.cancel()
        let delay = max(0, Self.tailLayoutCooldown - (now - lastTailLayoutAt))
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.lastTailLayoutAt = ProcessInfo.processInfo.systemUptime
            self.pendingTailLayoutWork = nil
            self.invalidateMeasuredHeight(characterRange: nil)
        }
        pendingTailLayoutWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    func measuredHeight(for proposedWidth: CGFloat, backingScale: CGFloat) -> CGFloat {
        guard proposedWidth.isFinite, proposedWidth > 0 else {
            return 0
        }
        let scale = MarkdownLayoutSizing.validBackingScale(backingScale)
        let width = MarkdownLayoutSizing.normalizedWidth(
            proposedWidth,
            backingScale: scale
        )
        if let measurement,
           measurement.width == width,
           measurement.backingScale == scale {
            return measurement.height
        }

        MarkdownLayoutSizing.updateContainerIfNeeded(
            measurementContainer,
            proposedWidth: width,
            backingScale: scale
        )
        measurementLayoutManager.ensureLayout(for: measurementContainer)
        let height = MarkdownLayoutSizing.fullContentHeight(
            usedRect: measurementLayoutManager.usedRect(for: measurementContainer),
            verticalInset: textView.textContainerInset.height,
            backingScale: scale
        )
        measurement = Measurement(width: width, backingScale: scale, height: height)
        lastMeasuredWidth = width
        preferredBackingScale = scale
        measurementPassCount += 1
        return height
    }

    /// Test/diagnostic surface for the exact TextKit height at the current container width.
    var currentTextKitHeight: CGFloat {
        measurementLayoutManager.ensureLayout(for: measurementContainer)
        return MarkdownLayoutSizing.fullContentHeight(
            usedRect: measurementLayoutManager.usedRect(for: measurementContainer),
            verticalInset: textView.textContainerInset.height,
            backingScale: preferredBackingScale
        )
    }

    /// The displayed stack is separate from proposal measurement; this catches a stale
    /// display container even when detached measurement returned the correct SwiftUI size.
    var displayedTextKitHeight: CGFloat {
        guard let container = textView.textContainer,
              let layoutManager = textView.layoutManager else { return 0 }
        layoutManager.ensureLayout(for: container)
        return MarkdownLayoutSizing.fullContentHeight(
            usedRect: layoutManager.usedRect(for: container),
            verticalInset: textView.textContainerInset.height,
            backingScale: preferredBackingScale
        )
    }

    var nativeTextFrame: NSRect { textView.frame }
    var nativeTextIsVerticallyResizable: Bool { textView.isVerticallyResizable }
    var maximumNumberOfLines: Int { textView.textContainer?.maximumNumberOfLines ?? 0 }
    var nativeSelectedRange: NSRange {
        get { textView.selectedRange() }
        set { textView.setSelectedRange(newValue) }
    }

    private func invalidateMeasuredHeight(characterRange: NSRange? = nil) {
        measurement = nil
        measurementInvalidationCount += 1
        if measurementStorage.length > 0 {
            let range = characterRange.map {
                NSRange(
                    location: min($0.location, measurementStorage.length),
                    length: min($0.length, measurementStorage.length - min($0.location, measurementStorage.length))
                )
            } ?? NSRange(location: 0, length: measurementStorage.length)
            measurementLayoutManager.invalidateLayout(
                forCharacterRange: range,
                actualCharacterRange: nil
            )
        }
        invalidateHostIntrinsicContentSize()
        needsLayout = true
    }

    private func invalidateHostIntrinsicContentSize() {
        intrinsicInvalidationCount += 1
        invalidateIntrinsicContentSize()
    }
}

enum MarkdownLayoutSizing {
    static func validBackingScale(_ backingScale: CGFloat) -> CGFloat {
        backingScale.isFinite && backingScale > 0 ? backingScale : 1
    }

    static func normalizedWidth(
        _ width: CGFloat,
        backingScale: CGFloat
    ) -> CGFloat {
        guard width.isFinite, width > 0 else { return 1 }
        let scale = validBackingScale(backingScale)
        return max(1, floor(width * scale) / scale)
    }

    static func normalizedHeight(
        _ height: CGFloat,
        backingScale: CGFloat
    ) -> CGFloat {
        guard height.isFinite, height > 0 else { return 0 }
        let scale = validBackingScale(backingScale)
        return ceil(height * scale) / scale
    }

    static func fullContentHeight(
        usedRect: NSRect,
        verticalInset: CGFloat,
        backingScale: CGFloat
    ) -> CGFloat {
        normalizedHeight(
            max(0, usedRect.height) + max(0, verticalInset) * 2,
            backingScale: backingScale
        )
    }

    static func containerNeedsUpdate(
        current: NSSize,
        target: NSSize
    ) -> Bool {
        current.width != target.width
            || current.height != target.height
    }

    /// Returns true only when it mutates TextKit. Reassigning the same
    /// infinite-height size keeps AppKit layout dirty and can recursively drive
    /// SwiftUI's platform-view sizeThatFits during rapid transcript scrolling.
    @discardableResult
    static func updateContainerIfNeeded(
        _ container: NSTextContainer,
        proposedWidth: CGFloat,
        backingScale: CGFloat
    ) -> Bool {
        let target = NSSize(
            width: normalizedWidth(
                proposedWidth,
                backingScale: backingScale
            ),
            height: CGFloat.greatestFiniteMagnitude
        )
        guard containerNeedsUpdate(
            current: container.containerSize,
            target: target
        ) else {
            return false
        }
        container.containerSize = target
        return true
    }
}

enum MarkdownHoverCursorKind: Equatable {
    case text
    case pointingHand

    static func resolve(
        commandDown: Bool,
        hasPath: Bool,
        hasAttributedLink: Bool
    ) -> Self {
        if (commandDown && hasPath) || hasAttributedLink {
            return .pointingHand
        }
        return .text
    }
}

/// 与 PathLinkedText 相同的 ⌘+点击路径约定：文档（md/txt…）→ 右侧文档面板，
/// 其它文件 → 访达显示；⌘+悬停路径显示手型光标。路径命中范围基于当前显示文本
/// 现算（PathLinkCache 缓存，mousemove 走命中缓存）。
private final class PathClickTextView: NSTextView {
    var onOpenDocument: ((URL) -> Void)?
    var onFlash: ((String) -> Void)?
    private var trackingAreaRef: NSTrackingArea?

    override func mouseDown(with event: NSEvent) {
        if event.modifierFlags.contains(.command),
           let characterIndex = characterIndex(at: event),
           let url = pathURL(atCharacterIndex: characterIndex) {
            if let onOpenDocument, DocumentDetector.isDocument(url) {
                onOpenDocument(url)
            } else if !FileReveal.revealInFinder(url: url) {
                onFlash?(FileReveal.missingPathMessage(url.path))
            }
            return
        }
        super.mouseDown(with: event)
    }

    private func characterIndex(at event: NSEvent) -> Int? {
        guard let layoutManager, let textContainer, !string.isEmpty else { return nil }
        var point = convert(event.locationInWindow, from: nil)
        point.x -= textContainerInset.width
        point.y -= textContainerInset.height
        let charIndex = layoutManager.characterIndex(
            for: point,
            in: textContainer,
            fractionOfDistanceBetweenInsertionPoints: nil
        )
        guard charIndex != NSNotFound,
              charIndex >= 0,
              charIndex < (string as NSString).length else { return nil }
        // 排除点在某行尾部空白处误命中末尾字符的情况。
        let glyphIndex = layoutManager.glyphIndexForCharacter(at: charIndex)
        let glyphRect = layoutManager.boundingRect(
            forGlyphRange: NSRange(location: glyphIndex, length: 1),
            in: textContainer
        )
        guard glyphRect.insetBy(dx: -3, dy: -3).contains(point) else { return nil }
        return charIndex
    }

    private func pathURL(atCharacterIndex charIndex: Int) -> URL? {
        let targets = FileReveal.pathTargets(in: string)
        return PathLinkHitTest.pathTarget(atCharacterIndex: charIndex, targets: targets)?.url
    }

    private func hasAttributedLink(atCharacterIndex charIndex: Int) -> Bool {
        guard let textStorage,
              charIndex >= 0,
              charIndex < textStorage.length else { return false }
        return textStorage.attribute(.link, at: charIndex, effectiveRange: nil) != nil
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let trackingAreaRef { removeTrackingArea(trackingAreaRef) }
        let area = NSTrackingArea(
            rect: bounds,
            options: [.mouseMoved, .activeInKeyWindow, .inVisibleRect],
            owner: self
        )
        addTrackingArea(area)
        trackingAreaRef = area
    }

    override func mouseMoved(with event: NSEvent) {
        let charIndex = characterIndex(at: event)
        let commandDown = event.modifierFlags.contains(.command)
        let cursor = MarkdownHoverCursorKind.resolve(
            commandDown: commandDown,
            hasPath: commandDown
                && charIndex.map { pathURL(atCharacterIndex: $0) != nil } == true,
            hasAttributedLink: charIndex.map(hasAttributedLink(atCharacterIndex:)) == true
        )
        switch cursor {
        case .pointingHand:
            NSCursor.pointingHand.set()
        case .text:
            NSCursor.iBeam.set()
        }
    }
}

private struct MarkdownBlockView: View {
    let block: MarkdownTextView.Block
    var onFlash: ((String) -> Void)? = nil
    @Environment(\.chatTypography) private var chatTypography

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
                nsFont: chatTypography.headingNSFont(level: level),
                onFlash: onFlash
            )
            .padding(.top, level <= 2 ? 6 : 2)
        case .code(let code), .mono(let code):
            // Do NOT path-link inside fenced / mono code bodies.
            // This legacy block renderer avoids SwiftUI textSelection. The active
            // MarkdownTextView path uses one selectable AppKit NSTextView instead.
            ScrollView(.horizontal) {
                // 含框线字符的图走终端式网格渲染（CJK 占两格，框线严格对齐）
                if MonoArtView.hasBoxDrawing(code) {
                    MonoArtView(text: code)
                        .padding(10)
                } else {
                    Text(code)
                        .font(Font(chatTypography.codeNSFont))
                        .contextMenu {
                            Button("复制") {
                                NSPasteboard.general.clearContents()
                                NSPasteboard.general.setString(
                                    code,
                                    forType: .string
                                )
                            }
                        }
                        .padding(10)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
        case .table(let header, let rows):
            tableView(header: header, rows: rows)
        case .list(let items):
            // Single selectable Text: per-item PathLinkedText cannot share drag selection.
            PathLinkedText(
                attributed: MarkdownTextView.listAttributed(items),
                onFlash: onFlash
            )
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

    private func tableView(header: [String], rows: [[String]]) -> some View {
        let columns = max(header.count, rows.map(\.count).max() ?? 0)
        let headerFont = NSFont.systemFont(ofSize: chatTypography.fontSize, weight: .semibold)
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
