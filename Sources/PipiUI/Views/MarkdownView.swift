import AppKit
import SwiftUI

/// Block-level markdown renderer: headings, tables, lists, quotes, rules,
/// fenced code, and a monospaced fallback for ASCII diagrams outside fences.
/// Absolute file paths in prose become clickable (not inside fenced code).
struct MarkdownTextView: View {
    let text: String
    /// Chat is the compatibility default. DocumentPanel supplies a source URL so links, local
    /// images, and reader typography can use the same AST/TextKit pipeline safely.
    var renderContext: MarkdownRenderContext = .chat
    /// Explicit document-tab routing takes precedence over the transcript environment hook.
    var documentOpenAction: ((URL) -> Void)? = nil
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
            renderContext: renderContext,
            maximumNumberOfLines: lineLimit,
            isStreaming: isStreaming,
            onOpenDocument: documentOpenAction ?? openDocument,
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

    /// AST-adapted block contract. The AppKit host still owns one NSTextStorage for the
    /// whole message; only parsing/render decisions moved from line heuristics to Markdown AST.
    indirect enum Block: Equatable {
        case paragraph(InlineContent)
        case heading(Int, InlineContent)
        case code(String, language: String?)
        case mono(String) // ASCII art / diagrams outside fences
        case table(
            header: [InlineContent],
            rows: [[InlineContent]],
            alignments: [TableAlignment?]
        )
        case list([ListItem])
        case quote([Block])
        case rule
    }

    struct InlineContent: Equatable {
        let runs: [InlineRun]

        init(runs: [InlineRun]) {
            self.runs = runs
        }

        static func plain(_ text: String) -> Self {
            Self(runs: [.text(text)])
        }

        var plainText: String {
            runs.map(\.plainText).joined()
        }
    }

    indirect enum InlineRun: Equatable {
        case text(String)
        case softBreak
        case hardBreak
        case emphasis([InlineRun])
        case strong([InlineRun])
        case strikethrough([InlineRun])
        case code(String)
        case link(destination: String?, children: [InlineRun])
        /// Inline image attachments intentionally degrade to linked alt text in the selection host.
        /// Loading arbitrary remote/local binaries into NSTextStorage would undermine stable text
        /// selection and streaming measurement; native message image blocks remain unchanged.
        case image(source: String?, alt: [InlineRun])

        var plainText: String {
            switch self {
            case .text(let text), .code(let text):
                return text
            case .softBreak, .hardBreak:
                return "\n"
            case .emphasis(let children), .strong(let children), .strikethrough(let children):
                return children.map(\.plainText).joined()
            case .link(_, let children):
                return children.map(\.plainText).joined()
            case .image(_, let alt):
                let label = alt.map(\.plainText).joined()
                return "[Image: \(label.isEmpty ? "image" : label)]"
            }
        }
    }

    enum TaskState: Equatable {
        case checked
        case unchecked
    }

    enum TableAlignment: Equatable {
        case left
        case center
        case right
    }

    struct ListItem: Equatable {
        let marker: String
        let content: InlineContent
        let indent: Int
        let taskState: TaskState?

        init(
            marker: String,
            content: InlineContent,
            indent: Int,
            taskState: TaskState? = nil
        ) {
            self.marker = marker
            self.content = content
            self.indent = indent
            self.taskState = taskState
        }

        /// Compatibility initializer for focused list tests and legacy callers. The unfinished
        /// stream tail uses the explicit `content: .plain(...)` initializer to stay cheap.
        init(marker: String, text: String, indent: Int) {
            self.init(
                marker: marker,
                content: MarkdownASTAdapter.inlineContent(from: text),
                indent: indent
            )
        }

        var text: String { content.plainText }
    }

    // MARK: - Parsing

    /// Settled assistant-message markdown is parsed by swift-markdown's GFM AST. The narrow
    /// incremental line recognizers below are retained exclusively for the unfinished stream tail.
    static func parse(_ text: String) -> [Block] {
        MarkdownASTAdapter.blocks(from: text)
    }

    /// Test / memory-pressure helper: drop complete-document AST parse entries.
    static func clearParseCache() {
        parseCache.removeAllObjects()
    }

    // MARK: - Cheap unfinished-tail syntax

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
            let (taskState, text) = taskStateAndText(String(trimmed.dropFirst(2)))
            return ListItem(
                marker: "•",
                content: .plain(text),
                indent: leading / 2,
                taskState: taskState
            )
        }
        if let dot = trimmed.firstIndex(where: { $0 == "." || $0 == ")" }),
           trimmed.index(after: dot) < trimmed.endIndex,
           trimmed[trimmed.index(after: dot)] == " ",
           !trimmed[..<dot].isEmpty, trimmed[..<dot].allSatisfy(\.isNumber) {
            let (taskState, text) = taskStateAndText(
                String(trimmed[trimmed.index(dot, offsetBy: 2)...])
            )
            return ListItem(
                marker: String(trimmed[..<dot]) + ".",
                content: .plain(text),
                indent: leading / 2,
                taskState: taskState
            )
        }
        return nil
    }

    fileprivate static func taskStateAndText(_ text: String) -> (TaskState?, String) {
        let lower = text.lowercased()
        if lower.hasPrefix("[x] ") {
            return (.checked, String(text.dropFirst(4)))
        }
        if lower.hasPrefix("[ ] ") {
            return (.unchecked, String(text.dropFirst(4)))
        }
        return (nil, text)
    }

    fileprivate static func fenceLanguage(_ trimmed: String) -> String? {
        guard trimmed.hasPrefix("```") else { return nil }
        let info = trimmed.dropFirst(3).trimmingCharacters(in: .whitespaces)
        return info.split(whereSeparator: { $0.isWhitespace }).first.map(String.init)
    }

    /// 含框线字符或多行大量空格对齐的段落按等宽渲染，避免简图错位。
    static func looksLikeAsciiArt(_ text: String) -> Bool {
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

    /// Inline markdown for "thinking"/reasoning blocks. Renders `**bold**` (and other
    /// inline spans) without leaking raw `*` delimiters, and unions `.emphasized`
    /// (italic) into every run so the block keeps its reasoning look while preserving
    /// `.stronglyEmphasized` (bold) where the model wrote `**...**`. Unlike
    /// `inlineWithPaths`, it injects no path-link styling, so the caller's uniform
    /// `.foregroundStyle` is preserved. Cached by raw string (immutable thinking text
    /// → always hits after first view), mirroring `inlineWithPaths`.
    static func thinkingInline(_ string: String) -> AttributedString {
        let key = string as NSString
        if let cached = thinkingInlineCache.object(forKey: key) { return cached.attributed }
        var result = inline(string)
        // Bake italic into every run without clobbering bold: union `.emphasized` into
        // each run's `inlinePresentationIntent` (SwiftUI `Text` honors both intents, so
        // bold ranges render bold-italic and plain ranges render italic).
        let updates = result.runs.map { run -> (Range<AttributedString.Index>, InlinePresentationIntent) in
            var intent = run.inlinePresentationIntent ?? []
            intent.insert(.emphasized)
            return (run.range, intent)
        }
        for (range, intent) in updates {
            result[range].inlinePresentationIntent = intent
        }
        thinkingInlineCache.setObject(InlineBox(result), forKey: key)
        return result
    }

    /// Cache for `thinkingInline`, separate from `inlineCache` (whose entries are
    /// path-styled prose; thinking text needs baked-italic and never path links).
    private static let thinkingInlineCache: NSCache<NSString, InlineBox> = {
        let cache = NSCache<NSString, InlineBox>()
        cache.countLimit = 1000
        return cache
    }()

    /// Legacy inline-call cache. Active assistant blocks arrive as `InlineContent` from the
    /// swift-markdown AST; this raw-string path remains for the inactive legacy block view and
    /// callers that need a standalone inline fragment. Keyed by raw text, matching `parseCache`.
    private static let inlineCache: NSCache<NSString, InlineBox> = {
        let cache = NSCache<NSString, InlineBox>()
        cache.countLimit = 1000
        return cache
    }()

    private final class InlineBox {
        let attributed: AttributedString
        init(_ attributed: AttributedString) { self.attributed = attributed }
    }

    /// AST-backed inline fragment for prose blocks. `FileReveal` injects only bare-path styling
    /// and deliberately leaves explicit markdown links intact.
    static func inlineWithPaths(_ content: InlineContent) -> AttributedString {
        MarkdownASTInlineRenderer.attributed(content)
    }

    /// Standalone AST-backed inline parse for compatibility call sites. The active message path
    /// avoids this second parse because its `Block` already carries the adapted inline nodes.
    static func inlineWithPaths(_ string: String) -> AttributedString {
        let key = string as NSString
        if let cached = inlineCache.object(forKey: key) { return cached.attributed }
        let result = MarkdownASTInlineRenderer.attributed(
            MarkdownASTAdapter.inlineContent(from: string)
        )
        inlineCache.setObject(InlineBox(result), forKey: key)
        return result
    }

    /// Test / memory-pressure helper: drop the inline markdown cache.
    static func clearInlineCache() {
        inlineCache.removeAllObjects()
    }

    /// Test / memory-pressure helper: drop the thinking-inline markdown cache.
    static func clearThinkingInlineCache() {
        thinkingInlineCache.removeAllObjects()
    }

    /// True when a subagent log text item has markdown structure that benefits
    /// from the rich NSTextView renderer; plain prose/log lines return `false` so
    /// the row can use a lightweight selectable `Text` (no NSTextView, no markdown
    /// parse, no measurement host). Used by `AgentLogRow` to keep the common
    /// plain-log row off the expensive path. Pure and deterministic for tests.
    ///
    /// Block-level markers (headings, fences, tables, quotes, lists, rules) or any
    /// inline marker (bold/italic/code/link/strikethrough) triggers the rich path;
    /// only genuinely plain text goes lightweight. Combined with the lazy detail
    /// container this bounds mounted NSTextViews to visible structured rows.
    static func logTextNeedsRichRendering(_ text: String) -> Bool {
        guard !text.isEmpty else { return false }
        for raw in text.split(separator: "\n", omittingEmptySubsequences: false).prefix(64) {
            let trimmed = raw.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty { continue }
            if trimmed.hasPrefix("#")          // heading
                || trimmed.hasPrefix("```")    // fenced code
                || trimmed.hasPrefix("|")      // table row
                || trimmed.hasPrefix(">")      // blockquote
                || trimmed.hasPrefix("- ")
                || trimmed.hasPrefix("* ")
                || trimmed.hasPrefix("+ ")     // unordered list
                || trimmed == "---"
                || trimmed == "***"
                || trimmed == "___" {          // thematic rule
                return true
            }
            // Ordered list: digits then "."/")" then a space.
            if let delim = trimmed.firstIndex(where: { $0 == "." || $0 == ")" }),
               trimmed.index(after: delim) < trimmed.endIndex,
               trimmed[trimmed.index(after: delim)] == " ",
               !trimmed[..<delim].isEmpty,
               trimmed[..<delim].allSatisfy(\.isNumber) {
                return true
            }
        }
        return hasInlineMarkdownMarkers(text)
    }

    private static func hasInlineMarkdownMarkers(_ string: String) -> Bool {
        string.contains("*")
            || string.contains("_")
            || string.contains("`")
            || string.contains("[")
            || string.contains("](")
            || string.contains("~~")
    }

    /// One AttributedString for legacy callers; the active NSTextView additionally applies
    /// hanging indents per item in `MarkdownSelectionContent`.
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
            if let taskState = item.taskState {
                var checkbox = AttributedString(taskState == .checked ? "☑ " : "☐ ")
                checkbox.foregroundColor = taskState == .checked ? Color.accentColor : Color.secondary
                result.append(checkbox)
            }
            result.append(inlineWithPaths(item.content))
        }
        return result
    }
}

/// Flattens rendered markdown blocks into one attributed storage while preserving the text a
/// user sees and copies. The AppKit bridge below then provides a single native selection range.
private extension NSAttributedString.Key {
    /// Semantic anchor written only for document-reader headings. Chat storage remains untouched.
    static let pipiDocumentHeadingID = NSAttributedString.Key("PipiUI.DocumentHeadingID")
}

enum MarkdownSelectionContent {
    enum ParagraphRole {
        case body
        case list
        case heading
        case code
    }

    static func attributedString(
        for text: String,
        typography: ChatTypography = .make(fontSize: ChatTypography.defaultFontSize),
        context: MarkdownRenderContext = .chat,
        headingIDs: [String]? = nil
    ) -> NSAttributedString {
        attributedString(
            for: MarkdownTextView.cachedParse(text),
            typography: typography,
            context: context,
            headingIDs: headingIDs
        )
    }

    static func attributedString(
        for blocks: [MarkdownTextView.Block],
        typography: ChatTypography = .make(fontSize: ChatTypography.defaultFontSize),
        inlineHighlight: Bool = true,
        context: MarkdownRenderContext = .chat,
        headingIDs: [String]? = nil
    ) -> NSAttributedString {
        let result = NSMutableAttributedString()
        append(
            blocks,
            to: result,
            typography: typography,
            inlineHighlight: inlineHighlight,
            context: context,
            headingIDs: headingIDs
        )
        return result
    }

    static func append(
        _ blocks: ArraySlice<MarkdownTextView.Block>,
        to result: NSMutableAttributedString,
        typography: ChatTypography,
        inlineHighlight: Bool = true,
        context: MarkdownRenderContext = .chat,
        headingIDs: [String]? = nil
    ) {
        append(
            Array(blocks),
            to: result,
            typography: typography,
            inlineHighlight: inlineHighlight,
            context: context,
            headingIDs: headingIDs
        )
    }

    static func append(
        _ blocks: [MarkdownTextView.Block],
        to result: NSMutableAttributedString,
        typography: ChatTypography,
        inlineHighlight: Bool = true,
        context: MarkdownRenderContext = .chat,
        headingIDs: [String]? = nil
    ) {
        append(
            blocks,
            to: result,
            renderStyle: MarkdownRenderStyle(typography: typography, context: context),
            inlineHighlight: inlineHighlight,
            headingIDs: headingIDs
        )
    }

    private static func append(
        _ blocks: [MarkdownTextView.Block],
        to result: NSMutableAttributedString,
        renderStyle: MarkdownRenderStyle,
        inlineHighlight: Bool,
        headingIDs: [String]?
    ) {
        let bodyStyle = paragraphStyle(for: renderStyle, role: .body)
        let codeStyle = paragraphStyle(for: renderStyle, role: .code)
        var headingIndex = 0

        for block in blocks {
            if result.length > 0 {
                result.append(blockSeparator(style: renderStyle))
            }
            switch block {
            case .paragraph(let paragraph):
                result.append(rendered(
                    proseAttributed(
                        paragraph,
                        inlineHighlight: inlineHighlight,
                        context: renderStyle.context
                    ),
                    font: renderStyle.bodyNSFont,
                    codeFont: renderStyle.codeNSFont,
                    style: bodyStyle
                ))
            case .heading(let level, let title):
                let heading = NSMutableAttributedString(attributedString: rendered(
                    proseAttributed(
                        title,
                        inlineHighlight: inlineHighlight,
                        context: renderStyle.context
                    ),
                    font: renderStyle.headingNSFont(level: level),
                    codeFont: renderStyle.codeNSFont,
                    style: paragraphStyle(
                        for: renderStyle,
                        role: .heading,
                        headingLevel: level
                    )
                ))
                if let headingIDs,
                   headingIndex < headingIDs.count,
                   heading.length > 0 {
                    heading.addAttribute(
                        .pipiDocumentHeadingID,
                        value: headingIDs[headingIndex],
                        range: NSRange(location: 0, length: heading.length)
                    )
                }
                headingIndex += 1
                result.append(heading)
            case .code(let code, let language):
                result.append(codeAttributed(
                    code: code,
                    language: language,
                    renderStyle: renderStyle,
                    style: codeStyle
                ))
            case .mono(let code):
                result.append(rendered(
                    AttributedString(code),
                    font: renderStyle.codeNSFont,
                    codeFont: renderStyle.codeNSFont,
                    style: codeStyle,
                    background: renderStyle.monoBackground
                ))
            case .list(let items):
                result.append(listAttributed(
                    items,
                    renderStyle: renderStyle,
                    inlineHighlight: inlineHighlight
                ))
            case .quote(let quoteBlocks):
                result.append(quoteAttributed(
                    quoteBlocks,
                    renderStyle: renderStyle,
                    inlineHighlight: inlineHighlight
                ))
            case .table(let header, let rows, let alignments):
                result.append(tableAttributed(
                    header: header,
                    rows: rows,
                    alignments: alignments,
                    renderStyle: renderStyle,
                    inlineHighlight: inlineHighlight
                ))
            case .rule:
                result.append(rendered(
                    AttributedString(
                        renderStyle.isDocument
                            ? "────────────────────────────────"
                            : "────────────────────────"
                    ),
                    font: renderStyle.bodyNSFont,
                    codeFont: renderStyle.codeNSFont,
                    style: bodyStyle,
                    color: .separatorColor
                ))
            }
        }
    }

    /// Streaming-tail blocks carry cheap plain inline content; settled blocks carry AST runs.
    private static func proseAttributed(
        _ content: MarkdownTextView.InlineContent,
        inlineHighlight: Bool,
        context: MarkdownRenderContext
    ) -> AttributedString {
        MarkdownASTInlineRenderer.attributed(
            content,
            includeFormatting: inlineHighlight,
            context: context
        )
    }

    /// Render each list item as a paragraph so TextKit can use a real hanging indent instead of
    /// literal leading spaces. It remains one NSTextStorage and therefore one drag-selection span.
    private static func listAttributed(
        _ items: [MarkdownTextView.ListItem],
        renderStyle: MarkdownRenderStyle,
        inlineHighlight: Bool
    ) -> NSAttributedString {
        let result = NSMutableAttributedString()
        for (index, item) in items.enumerated() {
            if index > 0 { result.append(NSAttributedString(string: "\n")) }

            let line = NSMutableAttributedString()
            let marker = NSMutableAttributedString(string: item.marker + " ")
            marker.addAttribute(
                .foregroundColor,
                value: NSColor.secondaryLabelColor,
                range: NSRange(location: 0, length: marker.length)
            )
            marker.addAttribute(
                .font,
                value: renderStyle.bodyNSFont,
                range: NSRange(location: 0, length: marker.length)
            )
            line.append(marker)

            if let taskState = item.taskState {
                let checkbox = NSMutableAttributedString(
                    string: taskState == .checked ? "☑ " : "☐ "
                )
                checkbox.addAttribute(
                    .foregroundColor,
                    value: taskState == .checked ? NSColor.controlAccentColor : NSColor.secondaryLabelColor,
                    range: NSRange(location: 0, length: checkbox.length)
                )
                checkbox.addAttribute(
                    .font,
                    value: renderStyle.bodyNSFont,
                    range: NSRange(location: 0, length: checkbox.length)
                )
                line.append(checkbox)
            }

            line.append(rendered(
                proseAttributed(
                    item.content,
                    inlineHighlight: inlineHighlight,
                    context: renderStyle.context
                ),
                font: renderStyle.bodyNSFont,
                codeFont: renderStyle.codeNSFont,
                style: paragraphStyle(for: renderStyle, role: .list)
            ))

            let baseIndent = CGFloat(item.indent) * (
                renderStyle.isDocument
                    ? max(22, renderStyle.fontSize * 1.55)
                    : max(20, renderStyle.fontSize * 1.45)
            )
            let style = NSMutableParagraphStyle()
            style.lineSpacing = renderStyle.lineSpacing
            style.paragraphSpacing = renderStyle.listItemSpacing
            style.firstLineHeadIndent = baseIndent
            style.headIndent = baseIndent + (
                renderStyle.isDocument
                    ? max(34, renderStyle.fontSize * 2.45)
                    : max(30, renderStyle.fontSize * 2.3)
            )
            let lineRange = NSRange(location: 0, length: line.length)
            line.addAttribute(.paragraphStyle, value: style, range: lineRange)
            result.append(line)
        }
        return result
    }

    private static func codeAttributed(
        code: String,
        language: String?,
        renderStyle: MarkdownRenderStyle,
        style: NSParagraphStyle
    ) -> NSAttributedString {
        let result = NSMutableAttributedString()
        let background = renderStyle.codeBackground
        if let language, !language.isEmpty {
            let labelStyle = NSMutableParagraphStyle()
            labelStyle.lineSpacing = 0
            labelStyle.paragraphSpacing = max(3, renderStyle.fontSize * 0.2)
            let labelFont = NSFont.monospacedSystemFont(
                ofSize: max(10, renderStyle.codeNSFont.pointSize - 2),
                weight: .semibold
            )
            result.append(rendered(
                AttributedString(language),
                font: labelFont,
                codeFont: labelFont,
                style: labelStyle,
                color: .secondaryLabelColor,
                background: background
            ))
            result.append(NSAttributedString(string: "\n"))
        }
        result.append(rendered(
            AttributedString(code),
            font: renderStyle.codeNSFont,
            codeFont: renderStyle.codeNSFont,
            style: style,
            background: background
        ))
        if result.length > 0 {
            result.addAttribute(
                .backgroundColor,
                value: background,
                range: NSRange(location: 0, length: result.length)
            )
        }
        return result
    }

    private static func quoteAttributed(
        _ blocks: [MarkdownTextView.Block],
        renderStyle: MarkdownRenderStyle,
        inlineHighlight: Bool
    ) -> NSAttributedString {
        let result = NSMutableAttributedString(
            attributedString: attributedString(
                for: blocks,
                typography: renderStyle.typography,
                inlineHighlight: inlineHighlight,
                context: renderStyle.context
            )
        )
        guard result.length > 0 else { return result }
        let source = result.string as NSString
        var lineStarts = [0]
        for index in 0..<source.length where source.character(at: index) == 10 {
            if index + 1 < source.length { lineStarts.append(index + 1) }
        }

        let quoteBackground = renderStyle.quoteBackground
        result.addAttribute(
            .backgroundColor,
            value: quoteBackground,
            range: NSRange(location: 0, length: result.length)
        )
        for location in lineStarts.reversed() where source.character(at: location) != 10 {
            let bar = NSMutableAttributedString(string: "▎ ")
            bar.addAttribute(
                .foregroundColor,
                value: NSColor.controlAccentColor.withAlphaComponent(0.8),
                range: NSRange(location: 0, length: bar.length)
            )
            bar.addAttribute(
                .backgroundColor,
                value: quoteBackground,
                range: NSRange(location: 0, length: bar.length)
            )
            bar.addAttribute(
                .font,
                value: renderStyle.bodyNSFont,
                range: NSRange(location: 0, length: bar.length)
            )
            result.insert(bar, at: location)
        }
        return result
    }

    /// NSTextView ignores SwiftUI `.lineSpacing`; spacing must live on `NSParagraphStyle`.
    static func paragraphStyle(
        for typography: ChatTypography,
        role: ParagraphRole = .body,
        headingLevel: Int? = nil
    ) -> NSParagraphStyle {
        paragraphStyle(
            for: MarkdownRenderStyle(typography: typography, context: .chat),
            role: role,
            headingLevel: headingLevel
        )
    }

    private static func paragraphStyle(
        for renderStyle: MarkdownRenderStyle,
        role: ParagraphRole = .body,
        headingLevel: Int? = nil
    ) -> NSParagraphStyle {
        let style = NSMutableParagraphStyle()
        switch role {
        case .body:
            style.lineSpacing = renderStyle.lineSpacing
            style.paragraphSpacing = renderStyle.paragraphSpacing
        case .list:
            style.lineSpacing = renderStyle.lineSpacing
            style.paragraphSpacing = renderStyle.listItemSpacing
        case .heading:
            style.lineSpacing = renderStyle.headingLineSpacing
            if renderStyle.isDocument {
                let level = headingLevel ?? 6
                style.paragraphSpacingBefore = max(
                    level == 1 ? 22 : 15,
                    renderStyle.fontSize * (level == 1 ? 1.15 : 0.78)
                )
                style.paragraphSpacing = max(
                    level == 1 ? 16 : 11,
                    renderStyle.fontSize * (level == 1 ? 0.82 : 0.58)
                )
            } else {
                style.paragraphSpacingBefore = max(
                    6,
                    renderStyle.fontSize * (headingLevel == 1 ? 0.7 : 0.45)
                )
                style.paragraphSpacing = max(6, renderStyle.paragraphSpacing)
            }
        case .code:
            // ~1.5× total line-height for monospace blocks.
            style.lineSpacing = renderStyle.isDocument
                ? renderStyle.fontSize * 0.26
                : renderStyle.fontSize * 0.3
            style.paragraphSpacing = renderStyle.isDocument
                ? max(12, renderStyle.paragraphSpacing)
                : renderStyle.paragraphSpacing
        }
        return style
    }

    /// Empty paragraph between markdown blocks; height is exactly `blockSpacing`.
    static func blockSeparator(typography: ChatTypography) -> NSAttributedString {
        blockSeparator(style: MarkdownRenderStyle(typography: typography, context: .chat))
    }

    private static func blockSeparator(style renderStyle: MarkdownRenderStyle) -> NSAttributedString {
        let style = NSMutableParagraphStyle()
        style.minimumLineHeight = renderStyle.blockSpacing
        style.maximumLineHeight = renderStyle.blockSpacing
        style.lineSpacing = 0
        style.paragraphSpacing = 0
        let result = NSMutableAttributedString(string: "\n\n")
        let range = NSRange(location: 0, length: result.length)
        result.addAttribute(.font, value: renderStyle.bodyNSFont, range: range)
        result.addAttribute(.paragraphStyle, value: style, range: range)
        return result
    }

    /// A text-table treatment avoids individual SwiftUI subviews (which would fragment selection):
    /// borders are glyph runs, headers are weighted/backed, and rows retain their inline AST styles.
    private static func tableAttributed(
        header: [MarkdownTextView.InlineContent],
        rows: [[MarkdownTextView.InlineContent]],
        alignments: [MarkdownTextView.TableAlignment?],
        renderStyle: MarkdownRenderStyle,
        inlineHighlight: Bool
    ) -> NSAttributedString {
        if renderStyle.isDocument {
            return documentTableAttributed(
                header: header,
                rows: rows,
                alignments: alignments,
                renderStyle: renderStyle,
                inlineHighlight: inlineHighlight
            )
        }

        // Keep the transcript's existing compact table pixels and streaming measurements intact.
        let typography = renderStyle.typography
        _ = alignments
        let result = NSMutableAttributedString()
        let allRows = [header] + rows
        for (rowIndex, row) in allRows.enumerated() {
            if rowIndex > 0 { result.append(NSAttributedString(string: "\n")) }
            let line = NSMutableAttributedString()
            func appendBorder(_ text: String) {
                let border = NSMutableAttributedString(string: text)
                border.addAttribute(
                    .foregroundColor,
                    value: NSColor.separatorColor,
                    range: NSRange(location: 0, length: border.length)
                )
                border.addAttribute(
                    .font,
                    value: typography.bodyNSFont,
                    range: NSRange(location: 0, length: border.length)
                )
                line.append(border)
            }

            appendBorder("│ ")
            for (column, cell) in row.enumerated() {
                if column > 0 { appendBorder(" │ ") }
                line.append(rendered(
                    proseAttributed(
                        cell,
                        inlineHighlight: inlineHighlight,
                        context: renderStyle.context
                    ),
                    font: rowIndex == 0
                        ? NSFont.systemFont(ofSize: typography.fontSize, weight: .semibold)
                        : typography.bodyNSFont,
                    codeFont: typography.codeNSFont,
                    style: paragraphStyle(for: typography, role: .body)
                ))
            }
            appendBorder(" │")

            let style = NSMutableParagraphStyle()
            style.lineSpacing = max(2, typography.fontSize * 0.16)
            style.paragraphSpacing = max(2, typography.fontSize * 0.16)
            let lineRange = NSRange(location: 0, length: line.length)
            line.addAttribute(.paragraphStyle, value: style, range: lineRange)
            let rowBackground: NSColor? = rowIndex == 0
                ? NSColor.labelColor.withAlphaComponent(0.075)
                : (!rowIndex.isMultiple(of: 2)
                    ? NSColor.labelColor.withAlphaComponent(0.025)
                    : nil)
            if let rowBackground {
                applyBackground(rowBackground, toUnbackgroundedRunsIn: line, range: lineRange)
            }
            if rowIndex == 0 {
                line.addAttribute(
                    .underlineStyle,
                    value: NSUnderlineStyle.single.rawValue,
                    range: lineRange
                )
            }
            result.append(line)
        }
        return result
    }

    /// Document tables use a monospaced grid so AST column alignment is visible while every
    /// cell remains in the same selectable NSTextStorage. Chat keeps its historical compact rows.
    private static func documentTableAttributed(
        header: [MarkdownTextView.InlineContent],
        rows: [[MarkdownTextView.InlineContent]],
        alignments: [MarkdownTextView.TableAlignment?],
        renderStyle: MarkdownRenderStyle,
        inlineHighlight: Bool
    ) -> NSAttributedString {
        let columnCount = max(header.count, rows.map(\.count).max() ?? 0)
        guard columnCount > 0 else { return NSAttributedString() }

        let allRows = [header] + rows
        let widths = (0..<columnCount).map { column in
            max(
                3,
                allRows.map { row in
                    documentTableDisplayWidth(
                        column < row.count ? row[column].plainText : ""
                    )
                }.max() ?? 0
            )
        }
        let rowStyle = NSMutableParagraphStyle()
        rowStyle.lineSpacing = max(3, renderStyle.fontSize * 0.18)
        rowStyle.paragraphSpacing = max(4, renderStyle.fontSize * 0.22)
        let headerFont = NSFont.monospacedSystemFont(
            ofSize: renderStyle.tableFont.pointSize,
            weight: .semibold
        )

        func chrome(_ text: String) -> NSAttributedString {
            let value = NSMutableAttributedString(string: text)
            let range = NSRange(location: 0, length: value.length)
            value.addAttribute(.foregroundColor, value: NSColor.separatorColor, range: range)
            value.addAttribute(.font, value: renderStyle.tableFont, range: range)
            value.addAttribute(.paragraphStyle, value: rowStyle, range: range)
            return value
        }

        func horizontalBorder(left: String, separator: String, right: String) -> NSAttributedString {
            let pieces = widths.map { String(repeating: "─", count: $0 + 2) }
            return chrome(left + pieces.joined(separator: separator) + right)
        }

        func rowLine(_ row: [MarkdownTextView.InlineContent], rowIndex: Int) -> NSAttributedString {
            let line = NSMutableAttributedString()
            line.append(chrome("│"))
            for column in 0..<columnCount {
                let cell = column < row.count ? row[column] : .plain("")
                let missingWidth = max(0, widths[column] - documentTableDisplayWidth(cell.plainText))
                let alignment = column < alignments.count ? alignments[column] : nil
                let leftPadding: Int
                let rightPadding: Int
                switch alignment {
                case .right:
                    leftPadding = missingWidth
                    rightPadding = 0
                case .center:
                    leftPadding = missingWidth / 2
                    rightPadding = missingWidth - leftPadding
                case .left, nil:
                    leftPadding = 0
                    rightPadding = missingWidth
                }
                line.append(chrome(" " + String(repeating: " ", count: leftPadding)))
                line.append(rendered(
                    proseAttributed(
                        cell,
                        inlineHighlight: inlineHighlight,
                        context: renderStyle.context
                    ),
                    font: rowIndex == 0 ? headerFont : renderStyle.tableFont,
                    codeFont: renderStyle.codeNSFont,
                    style: rowStyle
                ))
                line.append(chrome(String(repeating: " ", count: rightPadding) + " "))
                line.append(chrome("│"))
            }

            let range = NSRange(location: 0, length: line.length)
            let background: NSColor? = rowIndex == 0
                ? NSColor.labelColor.withAlphaComponent(0.12)
                : (!rowIndex.isMultiple(of: 2)
                    ? NSColor.labelColor.withAlphaComponent(0.035)
                    : nil)
            if let background {
                applyBackground(background, toUnbackgroundedRunsIn: line, range: range)
            }
            line.addAttribute(.paragraphStyle, value: rowStyle, range: range)
            return line
        }

        let lines: [NSAttributedString] = [
            horizontalBorder(left: "┌", separator: "┬", right: "┐"),
            rowLine(header, rowIndex: 0),
            horizontalBorder(left: "├", separator: "┼", right: "┤"),
        ] + rows.enumerated().map { offset, row in
            rowLine(row, rowIndex: offset + 1)
        } + [
            horizontalBorder(left: "└", separator: "┴", right: "┘"),
        ]

        let result = NSMutableAttributedString()
        for (index, line) in lines.enumerated() {
            if index > 0 { result.append(NSAttributedString(string: "\n")) }
            result.append(line)
        }
        return result
    }

    private static func documentTableDisplayWidth(_ text: String) -> Int {
        text.reduce(into: 0) { width, character in
            let isASCII = character.unicodeScalars.allSatisfy { $0.value < 0x80 }
            width += isASCII ? 1 : 2
        }
    }

    private static func applyBackground(
        _ background: NSColor,
        toUnbackgroundedRunsIn line: NSMutableAttributedString,
        range: NSRange
    ) {
        var unbackgrounded = [NSRange]()
        line.enumerateAttribute(.backgroundColor, in: range) { value, range, _ in
            if value == nil { unbackgrounded.append(range) }
        }
        for range in unbackgrounded {
            line.addAttribute(.backgroundColor, value: background, range: range)
        }
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
        // Per-run fonts: a single body font over the whole range wipes AST-adapted
        // bold/italic/code traits carried in `inlinePresentationIntent`.
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
            if intent.contains(.code), attrs[.backgroundColor] == nil {
                result.addAttribute(
                    .backgroundColor,
                    value: NSColor.labelColor.withAlphaComponent(0.08),
                    range: r
                )
            }
            if attrs[.link] != nil {
                if attrs[.foregroundColor] == nil {
                    result.addAttribute(
                        .foregroundColor,
                        value: NSColor.controlAccentColor,
                        range: r
                    )
                }
                if attrs[.underlineStyle] == nil {
                    result.addAttribute(
                        .underlineStyle,
                        value: NSUnderlineStyle.single.rawValue,
                        range: r
                    )
                }
            }
            // `FileReveal` writes SwiftUI's underline scope for the legacy SwiftUI path.
            // Mirror it into the AppKit key while flattening into this NSTextStorage.
            if attrs[.underlineStyle] == nil,
               attrs[NSAttributedString.Key("SwiftUI.UnderlineStyle")] != nil {
                result.addAttribute(
                    .underlineStyle,
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

/// Per-native-host append lineage. Immutable/remounted messages still use the exact-string
/// caches above; only a strict append with unchanged typography is allowed to reuse blocks.
///
/// Streaming hot path:
/// - stable prefix blocks are fully highlighted once and never reparsed on append
/// - only the unstable tail is reparsed and replaced on append
/// - the tail uses the same swift-markdown AST and inline rendering as settled content
final class MarkdownStreamingRenderer {
    enum Update {
        case unchanged
        case full(NSAttributedString)
        case replace(range: NSRange, tail: NSAttributedString)
    }

    /// Enables tail-only replacement while a message is streaming. The tail still uses the
    /// same swift-markdown AST and inline rendering as settled content.
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
        }

        // Parse only the unstable tail, but always use the same swift-markdown AST as settled
        // content so GFM tables and inline formatting do not change during streaming.
        let tailBlocks = MarkdownTextView.cachedParse(
            boundary.map { String(text[$0...]) } ?? text
        )
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
            inlineHighlight: true
        ))

        let oldLength = renderedLength
        renderedLength = replacementStart + replacement.length
        previousText = text
        lastReplaceThrottleable = !stableGrew
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
        } else {
            stableBlocks = []
            tailStartUTF16 = 0
        }
        stableAttributed.setAttributedString(MarkdownSelectionContent.attributedString(
            for: stableBlocks,
            typography: newTypography,
            inlineHighlight: true
        ))

        let combined = NSMutableAttributedString(attributedString: stableAttributed)
        let tailBlocks = MarkdownTextView.cachedParse(
            boundary.map { String(text[$0...]) } ?? text
        )
        if !stableBlocks.isEmpty, !tailBlocks.isEmpty {
            combined.append(MarkdownSelectionContent.blockSeparator(typography: newTypography))
        }
        combined.append(MarkdownSelectionContent.attributedString(
            for: tailBlocks,
            typography: newTypography,
            inlineHighlight: true
        ))
        let full: NSAttributedString = combined

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
    let renderContext: MarkdownRenderContext
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
            renderContext: renderContext,
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
    private var activeRenderContext: MarkdownRenderContext = .chat
    private var hasResizableDocumentImages = false
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
            _ = resizeDocumentImages(toMaximumWidth: bounds.width)
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
        renderContext: MarkdownRenderContext = .chat,
        maximumNumberOfLines: Int?,
        isStreaming: Bool = false,
        onOpenDocument: ((URL) -> Void)?,
        onFlash: ((String) -> Void)?,
        backingScale: CGFloat
    ) -> Bool {
        let contextChanged = activeRenderContext != renderContext
        activeRenderContext = renderContext
        let renderStyle = MarkdownRenderStyle(typography: typography, context: renderContext)
        let streamingChanged = isStreamingContent != isStreaming
        isStreamingContent = isStreaming

        // Documents intentionally bypass the chat streaming renderer, but still flatten the
        // same AST into this one NSTextView. That makes URL/image context deterministic.
        if renderContext.isDocument {
            return update(
                renderUpdate: .full(
                    MarkdownSelectionContent.attributedString(
                        for: markdownText,
                        typography: typography,
                        context: renderContext
                    )
                ),
                bodyFont: renderStyle.bodyNSFont,
                renderContext: renderContext,
                maximumNumberOfLines: maximumNumberOfLines,
                onOpenDocument: onOpenDocument,
                onFlash: onFlash,
                backingScale: backingScale,
                throttleLayout: false
            )
        }

        streamingRenderer.prefersLightweightTail = isStreaming
        // A host that previously rendered a document has no valid chat append lineage.
        // Leaving stream mode likewise rebuilds full inline highlighting.
        if contextChanged || (streamingChanged && !isStreaming) {
            let renderUpdate = streamingRenderer.reset(text: markdownText, typography: typography)
            return update(
                renderUpdate: renderUpdate,
                bodyFont: typography.bodyNSFont,
                renderContext: renderContext,
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
            renderContext: renderContext,
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
        renderContext: MarkdownRenderContext = .chat,
        maximumNumberOfLines: Int?,
        onOpenDocument: ((URL) -> Void)?,
        onFlash: ((String) -> Void)?,
        backingScale: CGFloat
    ) -> Bool {
        activeRenderContext = renderContext
        return update(
            renderUpdate: .full(attributedText),
            bodyFont: bodyFont,
            renderContext: renderContext,
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
        renderContext: MarkdownRenderContext,
        maximumNumberOfLines: Int?,
        onOpenDocument: ((URL) -> Void)?,
        onFlash: ((String) -> Void)?,
        backingScale: CGFloat,
        throttleLayout: Bool
    ) -> Bool {
        var heightChanged = false
        var invalidatedRange: NSRange?
        var contentChanged = false

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
            contentChanged = true
            heightChanged = true
        case .replace(let range, let tail)
            where NSMaxRange(range) <= (textView.textStorage?.length ?? 0)
                && NSMaxRange(range) <= measurementStorage.length:
            textView.textStorage?.replaceCharacters(in: range, with: tail)
            measurementStorage.replaceCharacters(in: range, with: tail)
            invalidatedRange = NSRange(location: range.location, length: tail.length)
            tailReplacementCount += 1
            contentChanged = true
            heightChanged = true
        default:
            break
        }

        if contentChanged {
            hasResizableDocumentImages = MarkdownDocumentImageAttachments.contains(
                in: textView.textStorage
            )
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

        textView.renderContext = renderContext
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

    @discardableResult
    private func resizeDocumentImages(toMaximumWidth width: CGFloat) -> Bool {
        guard hasResizableDocumentImages,
              width.isFinite,
              width > 0 else {
            return false
        }
        let displayChanged = MarkdownDocumentImageAttachments.resize(
            in: textView.textStorage,
            maximumWidth: width
        )
        let measurementChanged = MarkdownDocumentImageAttachments.resize(
            in: measurementStorage,
            maximumWidth: width
        )
        guard displayChanged || measurementChanged else { return false }

        if let displayStorage = textView.textStorage, displayStorage.length > 0 {
            textView.layoutManager?.invalidateLayout(
                forCharacterRange: NSRange(location: 0, length: displayStorage.length),
                actualCharacterRange: nil
            )
        }
        if measurementStorage.length > 0 {
            measurementLayoutManager.invalidateLayout(
                forCharacterRange: NSRange(location: 0, length: measurementStorage.length),
                actualCharacterRange: nil
            )
        }
        measurement = nil
        return true
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
        _ = resizeDocumentImages(toMaximumWidth: width)
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

/// Markdown documents use a dedicated native scroll host. It still renders the shared AST into
/// one read-only NSTextView, preserving drag selection/copy while adding per-tab viewport,
/// outline-anchor, and find behavior without changing the chat transcript's scroll machinery.
struct DocumentMarkdownReaderView: NSViewRepresentable {
    let markdownText: String
    let headings: [MarkdownDocumentHeading]
    let readerState: DocumentReaderState
    let typography: ChatTypography
    let renderContext: MarkdownRenderContext
    let onOpenDocument: ((URL) -> Void)?
    let onFlash: ((String) -> Void)?

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView(frame: .zero)
        scrollView.borderType = .noBorder
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = false
        scrollView.autohidesScrollers = true
        scrollView.scrollerStyle = .overlay
        scrollView.drawsBackground = false
        scrollView.automaticallyAdjustsContentInsets = false
        OverlayScrollers.apply(to: scrollView)

        let textView = PathClickTextView(frame: .zero)
        textView.isEditable = false
        textView.isSelectable = true
        textView.isRichText = true
        textView.importsGraphics = false
        textView.allowsUndo = false
        textView.drawsBackground = false
        textView.backgroundColor = .clear
        textView.textColor = .labelColor
        textView.textContainerInset = NSSize(
            width: MarkdownRenderContext.documentReaderHorizontalInset,
            height: MarkdownRenderContext.documentReaderVerticalInset
        )
        textView.textContainer?.lineFragmentPadding = 0
        textView.textContainer?.widthTracksTextView = false
        textView.textContainer?.heightTracksTextView = false
        textView.isHorizontallyResizable = false
        textView.isVerticallyResizable = false
        textView.autoresizingMask = [.width]
        textView.minSize = .zero
        textView.maxSize = NSSize(
            width: CGFloat.greatestFiniteMagnitude,
            height: CGFloat.greatestFiniteMagnitude
        )
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.isAutomaticSpellingCorrectionEnabled = false
        textView.enabledTextCheckingTypes = 0
        textView.setAccessibilityLabel("Markdown 文档阅读器")

        scrollView.documentView = textView
        context.coordinator.attach(scrollView: scrollView, textView: textView)
        context.coordinator.update(
            markdownText: markdownText,
            headings: headings,
            readerState: readerState,
            typography: typography,
            renderContext: renderContext,
            onOpenDocument: onOpenDocument,
            onFlash: onFlash
        )
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        context.coordinator.update(
            markdownText: markdownText,
            headings: headings,
            readerState: readerState,
            typography: typography,
            renderContext: renderContext,
            onOpenDocument: onOpenDocument,
            onFlash: onFlash
        )
        OverlayScrollers.applyIfNeeded(to: scrollView)
    }

    static func dismantleNSView(_ scrollView: NSScrollView, coordinator: Coordinator) {
        coordinator.detach()
    }

    final class Coordinator {
        private weak var scrollView: NSScrollView?
        private weak var textView: PathClickTextView?
        private weak var readerState: DocumentReaderState?
        private var clipBoundsObserver: NSObjectProtocol?
        private var renderedText = ""
        private var renderedHeadings: [MarkdownDocumentHeading] = []
        private var renderedTypography: ChatTypography?
        private var renderedContext: MarkdownRenderContext?
        private var headingRanges: [String: NSRange] = [:]
        private var lastViewportWidth: CGFloat = 0
        private var restorationGeneration: UInt64 = 0
        /// Ignore clip notifications until a semantic restore has landed; otherwise the empty/new
        /// native viewport can overwrite a tab's saved position before it is reapplied.
        private var restorationPending = false
        private var lastFindRequestGeneration: UInt64 = 0
        private var lastHeadingJumpGeneration: UInt64 = 0

        deinit {
            detach()
        }

        fileprivate func attach(scrollView: NSScrollView, textView: PathClickTextView) {
            detach()
            self.scrollView = scrollView
            self.textView = textView
            textView.onReaderFind = { [weak self] in
                self?.readerState?.showFind()
            }
            textView.onReaderFindNavigation = { [weak self] backwards in
                guard let state = self?.readerState else { return }
                state.showFind()
                if backwards {
                    state.findPrevious()
                } else {
                    state.findNext()
                }
            }

            let clip = scrollView.contentView
            clip.postsBoundsChangedNotifications = true
            clipBoundsObserver = NotificationCenter.default.addObserver(
                forName: NSView.boundsDidChangeNotification,
                object: clip,
                queue: .main
            ) { [weak self] _ in
                self?.handleClipBoundsChange()
            }
        }

        func detach() {
            captureScrollPosition()
            if let clipBoundsObserver {
                NotificationCenter.default.removeObserver(clipBoundsObserver)
            }
            clipBoundsObserver = nil
            textView?.onReaderFind = nil
            textView?.onReaderFindNavigation = nil
            scrollView = nil
            textView = nil
            readerState = nil
            restorationGeneration &+= 1
            restorationPending = false
        }

        func update(
            markdownText: String,
            headings: [MarkdownDocumentHeading],
            readerState: DocumentReaderState,
            typography: ChatTypography,
            renderContext: MarkdownRenderContext,
            onOpenDocument: ((URL) -> Void)?,
            onFlash: ((String) -> Void)?
        ) {
            guard let textView else { return }
            let stateChanged = self.readerState !== readerState
            let contentChanged = renderedText != markdownText
                || renderedHeadings != headings
                || renderedTypography != typography
                || renderedContext != renderContext

            if stateChanged || contentChanged {
                captureScrollPosition()
            }
            self.readerState = readerState
            textView.renderContext = renderContext
            textView.onOpenDocument = onOpenDocument
            textView.onFlash = onFlash

            if stateChanged {
                // Stored generations are requests issued while this tab was active. A tab switch
                // restores its semantic position, rather than replaying a historical key/button.
                lastFindRequestGeneration = readerState.findRequestGeneration
                lastHeadingJumpGeneration = readerState.headingJumpGeneration
            }

            if contentChanged {
                let attributed = MarkdownSelectionContent.attributedString(
                    for: markdownText,
                    typography: typography,
                    context: renderContext,
                    headingIDs: headings.map(\.id)
                )
                textView.font = MarkdownRenderStyle(
                    typography: typography,
                    context: renderContext
                ).bodyNSFont
                textView.textStorage?.setAttributedString(attributed)
                renderedText = markdownText
                renderedHeadings = headings
                renderedTypography = typography
                renderedContext = renderContext
                headingRanges = Self.headingRanges(in: attributed)
            }

            if stateChanged || contentChanged {
                layoutDocument()
                restoreScrollPosition()
            }
            applyPendingHeadingJump()
            applyPendingFindRequest()
        }

        private func handleClipBoundsChange() {
            guard let scrollView else { return }
            if restorationPending {
                // Initial/mounted geometry can arrive after `update`. Keep the saved tab state
                // authoritative until we have a usable native viewport to restore into.
                if scrollView.contentView.bounds.width > 1,
                   scrollView.contentView.bounds.height > 0 {
                    restoreScrollPosition()
                }
                return
            }

            let width = scrollView.contentView.bounds.width
            if abs(width - lastViewportWidth) > 0.5 {
                captureScrollPosition()
                layoutDocument()
                restoreScrollPosition()
                return
            }
            captureScrollPosition()
        }

        /// Keeps the NSTextView document-width equal to the reader measure, while the document
        /// view itself spans the clip view so native scrolling and find indicators stay correct.
        private func layoutDocument() {
            guard let scrollView,
                  let textView,
                  let container = textView.textContainer,
                  let layoutManager = textView.layoutManager
            else { return }

            let clipBounds = scrollView.contentView.bounds
            let viewportWidth = max(1, clipBounds.width)
            let bodyWidth = min(
                MarkdownRenderContext.documentReaderMaximumMeasure,
                max(1, viewportWidth - MarkdownRenderContext.documentReaderHorizontalInset * 2)
            )
            let horizontalInset = max(
                MarkdownRenderContext.documentReaderHorizontalInset,
                (viewportWidth - bodyWidth) / 2
            )
            let verticalInset = MarkdownRenderContext.documentReaderVerticalInset
            lastViewportWidth = viewportWidth

            if textView.textContainerInset != NSSize(width: horizontalInset, height: verticalInset) {
                textView.textContainerInset = NSSize(width: horizontalInset, height: verticalInset)
            }
            let targetContainerSize = NSSize(
                width: bodyWidth,
                height: CGFloat.greatestFiniteMagnitude
            )
            if container.containerSize != targetContainerSize {
                container.containerSize = targetContainerSize
            }
            if MarkdownDocumentImageAttachments.resize(
                in: textView.textStorage,
                maximumWidth: bodyWidth
            ), let storage = textView.textStorage, storage.length > 0 {
                layoutManager.invalidateLayout(
                    forCharacterRange: NSRange(location: 0, length: storage.length),
                    actualCharacterRange: nil
                )
            }

            layoutManager.ensureLayout(for: container)
            let contentHeight = ceil(
                layoutManager.usedRect(for: container).height + verticalInset * 2
            )
            let targetFrame = NSSize(
                width: viewportWidth,
                height: max(clipBounds.height, contentHeight)
            )
            if textView.frame.size != targetFrame {
                textView.setFrameSize(targetFrame)
            }
        }

        private func restoreScrollPosition() {
            restorationPending = true
            restorationGeneration &+= 1
            let generation = restorationGeneration
            DispatchQueue.main.async { [weak self] in
                guard let self, self.restorationGeneration == generation else { return }
                self.layoutDocument()
                guard let scrollView = self.scrollView,
                      scrollView.contentView.bounds.width > 1,
                      scrollView.contentView.bounds.height > 0
                else { return }
                self.restoreScrollPositionNow()
            }
        }

        private func restoreScrollPositionNow() {
            guard let state = readerState else {
                restorationPending = false
                return
            }
            switch DocumentReaderScrollRestoration.target(
                for: state.scrollPosition,
                availableHeadings: renderedHeadings
            ) {
            case .heading(let id, let progress):
                if let start = headingTop(for: id) {
                    let target: CGFloat
                    if let progress,
                       let end = sectionEnd(afterHeadingID: id), end > start {
                        target = start + (end - start) * CGFloat(progress)
                    } else {
                        target = start
                    }
                    scroll(toDocumentY: target)
                    state.recordActiveHeading(id)
                } else {
                    state.recordActiveHeading(nil)
                    scrollToNormalized(state.scrollPosition.normalizedOffset)
                }
            case .normalized(let offset):
                scrollToNormalized(offset)
            }
            restorationPending = false
            captureScrollPosition()
        }

        private func applyPendingHeadingJump() {
            guard let state = readerState,
                  state.headingJumpGeneration != lastHeadingJumpGeneration
            else { return }
            lastHeadingJumpGeneration = state.headingJumpGeneration
            guard let id = state.activeHeadingID,
                  headingTop(for: id) != nil
            else { return }
            scroll(toDocumentY: headingTop(for: id) ?? 0)
            captureScrollPosition()
        }

        private func applyPendingFindRequest() {
            guard let state = readerState,
                  state.findRequestGeneration != lastFindRequestGeneration
            else { return }
            lastFindRequestGeneration = state.findRequestGeneration
            performFind(query: state.findQuery, direction: state.findDirection)
        }

        /// Reader find keeps its query per `DocumentReaderState`; NSTextView supplies the native
        /// selection, visibility scroll, and transient find indicator without sharing global find
        /// panel state between tabs.
        private func performFind(
            query: String,
            direction: DocumentReaderFindDirection
        ) {
            guard let textView,
                  !query.isEmpty,
                  !textView.string.isEmpty
            else { return }
            let source = textView.string as NSString
            let selected = textView.selectedRange()
            let options: NSString.CompareOptions = [.caseInsensitive, .diacriticInsensitive]
            let result: NSRange

            switch direction {
            case .next:
                let start = min(NSMaxRange(selected), source.length)
                let forwardRange = NSRange(location: start, length: source.length - start)
                let forward = source.range(of: query, options: options, range: forwardRange)
                result = forward.location != NSNotFound
                    ? forward
                    : source.range(
                        of: query,
                        options: options,
                        range: NSRange(location: 0, length: source.length)
                    )
            case .previous:
                let end = min(max(0, selected.location), source.length)
                let backward = source.range(
                    of: query,
                    options: options.union(.backwards),
                    range: NSRange(location: 0, length: end)
                )
                result = backward.location != NSNotFound
                    ? backward
                    : source.range(
                        of: query,
                        options: options.union(.backwards),
                        range: NSRange(location: 0, length: source.length)
                    )
            }

            guard result.location != NSNotFound else {
                NSSound.beep()
                return
            }
            textView.setSelectedRange(result)
            textView.scrollRangeToVisible(result)
            textView.showFindIndicator(for: result)
            captureScrollPosition()
        }

        private func captureScrollPosition() {
            guard !restorationPending,
                  let scrollView,
                  let textView,
                  let state = readerState
            else { return }
            let clip = scrollView.contentView
            let maxY = maximumScrollY()
            let normalized = maxY > 0
                ? Double(clip.bounds.origin.y / maxY)
                : 0
            let activeID = activeHeading(atDocumentY: clip.bounds.origin.y)
            let progress = activeID.flatMap {
                sectionProgress(forHeadingID: $0, atDocumentY: clip.bounds.origin.y)
            }
            state.captureScrollPosition(DocumentReaderScrollPosition(
                normalizedOffset: normalized,
                anchorHeadingID: activeID,
                anchorProgress: progress
            ))
            _ = textView // Keeps both native inputs explicit at this seam.
        }

        private func activeHeading(atDocumentY y: CGFloat) -> String? {
            var activeID: String?
            for heading in renderedHeadings {
                guard let top = headingTop(for: heading.id) else { continue }
                if top <= y + 1 {
                    activeID = heading.id
                } else {
                    break
                }
            }
            return activeID
        }

        private func sectionProgress(
            forHeadingID id: String,
            atDocumentY y: CGFloat
        ) -> Double? {
            guard let start = headingTop(for: id),
                  let end = sectionEnd(afterHeadingID: id),
                  end > start
            else { return nil }
            return Double(min(1, max(0, (y - start) / (end - start))))
        }

        private func sectionEnd(afterHeadingID id: String) -> CGFloat? {
            guard let index = renderedHeadings.firstIndex(where: { $0.id == id }) else {
                return nil
            }
            for heading in renderedHeadings.dropFirst(index + 1) {
                if let next = headingTop(for: heading.id) {
                    return next
                }
            }
            return maximumScrollY()
        }

        private func headingTop(for id: String) -> CGFloat? {
            guard let textView,
                  let range = headingRanges[id],
                  range.length > 0,
                  let container = textView.textContainer,
                  let layoutManager = textView.layoutManager
            else { return nil }
            layoutManager.ensureLayout(for: container)
            let glyphRange = layoutManager.glyphRange(
                forCharacterRange: range,
                actualCharacterRange: nil
            )
            guard glyphRange.length > 0 else { return nil }
            let glyphRect = layoutManager.boundingRect(
                forGlyphRange: glyphRange,
                in: container
            )
            return max(
                0,
                glyphRect.minY + textView.textContainerOrigin.y - textView.textContainerInset.height
            )
        }

        private func maximumScrollY() -> CGFloat {
            guard let scrollView, let textView else { return 0 }
            return max(0, textView.frame.height - scrollView.contentView.bounds.height)
        }

        private func scrollToNormalized(_ offset: Double) {
            scroll(toDocumentY: maximumScrollY() * CGFloat(offset))
        }

        private func scroll(toDocumentY y: CGFloat) {
            guard let scrollView else { return }
            let clip = scrollView.contentView
            let targetY = min(maximumScrollY(), max(0, y))
            guard abs(clip.bounds.origin.y - targetY) > 0.5 else { return }
            clip.scroll(to: NSPoint(x: clip.bounds.origin.x, y: targetY))
            scrollView.reflectScrolledClipView(clip)
        }

        private static func headingRanges(in attributed: NSAttributedString) -> [String: NSRange] {
            guard attributed.length > 0 else { return [:] }
            var ranges: [String: NSRange] = [:]
            attributed.enumerateAttribute(
                .pipiDocumentHeadingID,
                in: NSRange(location: 0, length: attributed.length)
            ) { value, range, _ in
                guard let id = value as? String else { return }
                if let existing = ranges[id] {
                    ranges[id] = NSUnionRange(existing, range)
                } else {
                    ranges[id] = range
                }
            }
            return ranges
        }
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
    var renderContext: MarkdownRenderContext = .chat
    var onOpenDocument: ((URL) -> Void)?
    var onFlash: ((String) -> Void)?
    /// Set only by the document reader. Chat keeps its existing responder behavior.
    var onReaderFind: (() -> Void)?
    var onReaderFindNavigation: ((Bool) -> Void)?
    private var trackingAreaRef: NSTrackingArea?

    override func performFindPanelAction(_ sender: Any?) {
        // Route the standard Edit ▸ Find command into the tab-local reader field instead of
        // NSTextView's process-shared find panel. Chat leaves this nil and keeps native behavior.
        if let onReaderFind {
            onReaderFind()
            return
        }
        super.performFindPanelAction(sender)
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if handleReaderFindShortcut(event) { return true }
        return super.performKeyEquivalent(with: event)
    }

    override func keyDown(with event: NSEvent) {
        if handleReaderFindShortcut(event) { return }
        super.keyDown(with: event)
    }

    private func handleReaderFindShortcut(_ event: NSEvent) -> Bool {
        guard event.modifierFlags.contains(.command),
              let characters = event.charactersIgnoringModifiers?.lowercased()
        else { return false }
        switch characters {
        case "f":
            guard let onReaderFind else { return false }
            onReaderFind()
            return true
        case "g":
            guard let onReaderFindNavigation else { return false }
            onReaderFindNavigation(event.modifierFlags.contains(.shift))
            return true
        default:
            return false
        }
    }

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
        if let characterIndex = characterIndex(at: event),
           let url = attributedURL(atCharacterIndex: characterIndex) {
            if renderContext.isDocument {
                switch MarkdownDocumentResourceResolver.linkAction(for: url.absoluteURL) {
                case .openDocument(let localURL):
                    if let onOpenDocument {
                        onOpenDocument(localURL)
                    } else if !FileReveal.revealInFinder(url: localURL) {
                        onFlash?(FileReveal.missingPathMessage(localURL.path))
                    }
                case .revealInFinder(let localURL):
                    if !FileReveal.revealInFinder(url: localURL) {
                        onFlash?(FileReveal.missingPathMessage(localURL.path))
                    }
                case .openExternal(let externalURL):
                    NSWorkspace.shared.open(externalURL)
                case .blocked:
                    break
                }
            } else if url.isFileURL {
                if let onOpenDocument, DocumentDetector.isDocument(url) {
                    onOpenDocument(url)
                } else if !FileReveal.revealInFinder(url: url) {
                    onFlash?(FileReveal.missingPathMessage(url.path))
                }
            } else {
                NSWorkspace.shared.open(url)
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

    private func attributedURL(atCharacterIndex charIndex: Int) -> URL? {
        guard let textStorage,
              charIndex >= 0,
              charIndex < textStorage.length else { return nil }
        if let url = textStorage.attribute(.link, at: charIndex, effectiveRange: nil) as? URL {
            return url
        }
        if let string = textStorage.attribute(.link, at: charIndex, effectiveRange: nil) as? String {
            return URL(string: string)
        }
        return nil
    }

    private func hasAttributedLink(atCharacterIndex charIndex: Int) -> Bool {
        attributedURL(atCharacterIndex: charIndex) != nil
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

    /// Kept as a non-active compatibility fallback. All transcript messages use
    /// `MarkdownNativeLayoutView` above so selection never fragments across blocks.
    var body: some View {
        Text(
            MarkdownSelectionContent.attributedString(
                for: [block],
                typography: chatTypography
            ).string
        )
        .font(Font(chatTypography.bodyNSFont))
        .foregroundStyle(.primary)
    }
}
