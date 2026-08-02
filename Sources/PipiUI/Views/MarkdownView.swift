import AppKit
import SwiftUI

/// Block-level markdown renderer: headings, tables, lists, quotes, rules,
/// fenced code, and a monospaced fallback for ASCII diagrams outside fences.
/// Absolute file paths in prose become clickable (not inside fenced code).
struct MarkdownTextView: View {
    let text: String
    var lineLimit: Int? = nil
    var onFlash: ((String) -> Void)? = nil
    @Environment(\.chatTypography) private var chatTypography
    /// 文档路径 ⌘+点击 → 右侧文档面板（ChatDetailView 注入；nil 时回退访达显示）。
    @Environment(\.openDocument) private var openDocument

    var body: some View {
        // SwiftUI gives every block its own text-selection host, so a drag cannot cross a
        // paragraph/list/code boundary. One NSTextView keeps all rendered blocks in one
        // NSTextStorage, which is the unit AppKit uses for native drag selection.
        SelectableMarkdownTextView(
            attributedText: MarkdownSelectionContent.attributedString(
                for: text,
                typography: chatTypography
            ),
            bodyFont: chatTypography.bodyNSFont,
            maximumNumberOfLines: lineLimit,
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
        let result = NSMutableAttributedString()
        let blocks = MarkdownTextView.cachedParse(text)
        let bodyStyle = paragraphStyle(for: typography, role: .body)
        let listStyle = paragraphStyle(for: typography, role: .list)
        let headingStyle = paragraphStyle(for: typography, role: .heading)
        let codeStyle = paragraphStyle(for: typography, role: .code)

        for (index, block) in blocks.enumerated() {
            if index > 0 {
                result.append(blockSeparator(typography: typography))
            }
            switch block {
            case .paragraph(let paragraph):
                result.append(rendered(
                    MarkdownTextView.inlineWithPaths(paragraph),
                    font: typography.bodyNSFont,
                    codeFont: typography.codeNSFont,
                    style: bodyStyle
                ))
            case .heading(let level, let title):
                result.append(rendered(
                    MarkdownTextView.inlineWithPaths(title),
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
                    MarkdownTextView.listAttributed(items),
                    font: typography.bodyNSFont,
                    codeFont: typography.codeNSFont,
                    style: listStyle
                ))
            case .quote(let quote):
                result.append(rendered(
                    MarkdownTextView.inlineWithPaths(quote),
                    font: typography.bodyNSFont,
                    codeFont: typography.codeNSFont,
                    style: bodyStyle,
                    color: .secondaryLabelColor
                ))
            case .table(let header, let rows):
                result.append(rendered(
                    tableAttributed(header: header, rows: rows),
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
        return result
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
    private static func blockSeparator(typography: ChatTypography) -> NSAttributedString {
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
    private static func tableAttributed(header: [String], rows: [[String]]) -> AttributedString {
        var result = AttributedString()
        let allRows = [header] + rows
        for (rowIndex, row) in allRows.enumerated() {
            if rowIndex > 0 { result.append(AttributedString("\n")) }
            for (cellIndex, cell) in row.enumerated() {
                if cellIndex > 0 { result.append(AttributedString("\t")) }
                result.append(MarkdownTextView.inlineWithPaths(cell))
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

/// AppKit selection host for a complete markdown message. `NSTextView` owns one text storage,
/// so dragging from one paragraph/block into another keeps a continuous selection and copies
/// the full range correctly.
private struct SelectableMarkdownTextView: NSViewRepresentable {
    let attributedText: NSAttributedString
    let bodyFont: NSFont
    var maximumNumberOfLines: Int? = nil
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
            attributedText: attributedText,
            bodyFont: bodyFont,
            maximumNumberOfLines: maximumNumberOfLines,
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
    private var preferredBackingScale: CGFloat = 2
    private(set) var measurementPassCount = 0
    private(set) var measurementInvalidationCount = 0
    private(set) var intrinsicInvalidationCount = 0

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
        attributedText: NSAttributedString,
        bodyFont: NSFont,
        maximumNumberOfLines: Int?,
        onOpenDocument: ((URL) -> Void)?,
        onFlash: ((String) -> Void)?,
        backingScale: CGFloat
    ) -> Bool {
        var heightChanged = false

        if textView.font?.isEqual(bodyFont) != true {
            textView.font = bodyFont
            heightChanged = true
        }
        if !textView.attributedString().isEqual(to: attributedText) {
            // Set the fallback before installing attributed runs; assigning textColor on
            // every update could overwrite path accent colors in unchanged storage.
            textView.textColor = .labelColor
            textView.textStorage?.setAttributedString(attributedText)
            measurementStorage.setAttributedString(attributedText)
            heightChanged = true
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
            invalidateMeasuredHeight()
        }
        return heightChanged
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

    private func invalidateMeasuredHeight() {
        measurement = nil
        measurementInvalidationCount += 1
        if measurementStorage.length > 0 {
            measurementLayoutManager.invalidateLayout(
                forCharacterRange: NSRange(location: 0, length: measurementStorage.length),
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
