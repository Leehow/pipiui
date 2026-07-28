import AppKit
import SwiftUI

// MARK: - Hit-test helpers (testable TextKit measure; never drives SwiftUI layout height)

/// Pure helpers for mapping a click point → character index → path target.
/// Used only by `CmdPathClickOverlay` — display layout is owned by SwiftUI `Text`.
enum PathLinkHitTest {
    /// First path target whose UTF-16 range contains `index`.
    static func pathTarget(
        atCharacterIndex index: Int,
        targets: [FileReveal.PathTarget]
    ) -> FileReveal.PathTarget? {
        guard index >= 0 else { return nil }
        return targets.first { NSLocationInRange(index, $0.range) }
    }

    /// Character (UTF-16) index under `point` for `text` laid out at `size` with `font`.
    /// Returns nil when the point is outside glyph bounds or text is empty.
    static func characterIndex(
        at point: CGPoint,
        text: String,
        size: CGSize,
        font: NSFont,
        lineLimit: Int? = nil
    ) -> Int? {
        guard !text.isEmpty, size.width > 1, size.height > 1 else { return nil }

        let attrs: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: NSColor.labelColor,
        ]
        let storage = NSTextStorage(attributedString: NSAttributedString(string: text, attributes: attrs))
        let layoutManager = NSLayoutManager()
        let container = NSTextContainer(size: NSSize(width: size.width, height: max(size.height, 1)))
        container.lineFragmentPadding = 0
        container.lineBreakMode = .byWordWrapping
        if let lineLimit, lineLimit > 0 {
            container.maximumNumberOfLines = lineLimit
        } else {
            container.maximumNumberOfLines = 0
        }
        layoutManager.addTextContainer(container)
        storage.addLayoutManager(layoutManager)
        layoutManager.ensureLayout(for: container)

        guard layoutManager.numberOfGlyphs > 0 else { return nil }

        var fraction: CGFloat = 0
        let glyphIndex = layoutManager.glyphIndex(
            for: point,
            in: container,
            fractionOfDistanceThroughGlyph: &fraction
        )
        let safeGlyph = min(max(0, glyphIndex), layoutManager.numberOfGlyphs - 1)
        let glyphRange = NSRange(location: safeGlyph, length: 1)
        let glyphRect = layoutManager.boundingRect(forGlyphRange: glyphRange, in: container)
        // Reject clicks in empty trailing space of the line box.
        guard glyphRect.insetBy(dx: -3, dy: -3).contains(point) else { return nil }

        return layoutManager.characterIndexForGlyph(at: safeGlyph)
    }

    /// Path URL under `point`, if any.
    static func pathURL(
        at point: CGPoint,
        text: String,
        targets: [FileReveal.PathTarget],
        size: CGSize,
        font: NSFont,
        lineLimit: Int? = nil
    ) -> URL? {
        guard !targets.isEmpty else { return nil }
        guard let index = characterIndex(
            at: point,
            text: text,
            size: size,
            font: font,
            lineLimit: lineLimit
        ) else { return nil }
        return pathTarget(atCharacterIndex: index, targets: targets)?.url
    }
}

// MARK: - SwiftUI entry

/// SwiftUI text with absolute paths styled (color + underline, no `.link`).
/// **⌘+click** on a path reveals in Finder via a transparent overlay that does not own layout.
///
/// Do not add SwiftUI's selection modifier here. On macOS it installs a
/// private `SelectionOverlay` backed by `NSTextField`; realizing many transcript
/// rows can repeatedly invalidate that overlay's intrinsic size. Whole-text copy
/// remains available from the context menu, while assistant Markdown uses its
/// dedicated selectable `NSTextView`.
struct PathLinkedText: View {
    private let plainText: String
    private let visual: AttributedString
    private let targets: [FileReveal.PathTarget]
    var monospaced: Bool = false
    var lineLimit: Int? = nil
    var truncationMode: Text.TruncationMode = .tail
    var onFlash: ((String) -> Void)? = nil
    /// Optional explicit AppKit font (headings / caption overrides).
    var nsFont: NSFont? = nil
    @Environment(\.chatTypography) private var chatTypography
    /// 文档路径 ⌘+点击 → 右侧文档面板（由 ChatDetailView 注入；nil 时维持访达显示）。
    @Environment(\.openDocument) private var openDocument

    init(
        text: String,
        base: AttributeContainer = .init(),
        linkColor: Color? = Color.accentColor,
        monospaced: Bool = false,
        lineLimit: Int? = nil,
        truncationMode: Text.TruncationMode = .tail,
        nsFont: NSFont? = nil,
        onFlash: ((String) -> Void)? = nil
    ) {
        self.plainText = text
        // Single scan → visual + ⌘+click targets (cached for default style).
        let linked = FileReveal.pathLinkedContent(text: text, base: base, linkColor: linkColor)
        self.visual = linked.visual
        self.targets = linked.targets
        self.monospaced = monospaced
        self.lineLimit = lineLimit
        self.truncationMode = truncationMode
        self.nsFont = nsFont
        self.onFlash = onFlash
    }

    /// Pre-built attributed prose (e.g. markdown inline). Paths get visual style only (no `.link`).
    init(
        attributed: AttributedString,
        monospaced: Bool = false,
        lineLimit: Int? = nil,
        truncationMode: Text.TruncationMode = .tail,
        nsFont: NSFont? = nil,
        onFlash: ((String) -> Void)? = nil
    ) {
        let plain = String(attributed.characters)
        self.plainText = plain
        // Single scan → inject style + targets (match cache shared with plain scans).
        let linked = FileReveal.pathLinkedContent(attributed: attributed)
        self.visual = linked.visual
        self.targets = linked.targets
        self.monospaced = monospaced
        self.lineLimit = lineLimit
        self.truncationMode = truncationMode
        self.nsFont = nsFont
        self.onFlash = onFlash
    }

    var body: some View {
        let hitFont = resolveHitFont()
        textBody
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                // No GeometryReader: a `.background` overlay is sized to the Text's
                // laid-out frame by SwiftUI, and CmdPathClickNSView already reads its
                // own `bounds` at click time (see pathURL(at:) below). Routing the size
                // through a GeometryReader here meant one GeometryReader + NSViewRepresentable
                // update per text node per resize frame — hundreds of them across a long
                // transcript. The overlay gets its bounds from layout either way.
                CmdPathClickOverlay(
                    plainText: plainText,
                    targets: targets,
                    font: hitFont,
                    lineLimit: lineLimit,
                    onFlash: onFlash,
                    onOpenDocument: openDocument
                )
            )
            .contextMenu { contextMenuContent }
    }

    @ViewBuilder
    private var textBody: some View {
        styledText
    }

    @ViewBuilder
    private var styledText: some View {
        if let lineLimit {
            fontApplied(Text(visual))
                .lineLimit(lineLimit)
                .truncationMode(truncationMode)
        } else {
            fontApplied(Text(visual))
        }
    }

    @ViewBuilder
    private func fontApplied(_ text: Text) -> some View {
        let sized: Text = {
            if let nsFont {
                return text.font(Font(nsFont))
            }
            if monospaced {
                return text.font(Font(chatTypography.codeNSFont))
            }
            return text.font(Font(chatTypography.bodyNSFont))
        }()
        sized.lineSpacing(chatTypography.lineSpacing)
    }

    @ViewBuilder
    private var contextMenuContent: some View {
        Button("复制") {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(plainText, forType: .string)
        }
        if let url = contextRevealURL,
           DocumentDetector.isDocument(url),
           let openDocument {
            Button("在文档面板打开") {
                openDocument(url)
            }
        }
        if let url = contextRevealURL {
            Button("在访达中显示") {
                if FileReveal.revealInFinder(url: url) { return }
                onFlash?(FileReveal.missingPathMessage(url.path))
            }
        }
    }

    /// Reveal target for context menu: whole string is a path, or exactly one path in the text.
    private var contextRevealURL: URL? {
        if let url = FileReveal.fileURL(fromCandidate: plainText) {
            return url
        }
        if targets.count == 1 {
            return targets[0].url
        }
        return nil
    }

    private func resolveHitFont() -> NSFont {
        if let nsFont { return nsFont }
        if monospaced { return chatTypography.codeNSFont }
        return chatTypography.bodyNSFont
    }
}

// MARK: - OpenURL residual (SwiftUI / markdown http links)

/// OpenURL handler: file paths → Finder reveal; others → system.
enum PathLinkOpenURL {
    static func action(onFlash: ((String) -> Void)?) -> OpenURLAction {
        OpenURLAction { url in
            if url.isFileURL {
                if FileReveal.revealInFinder(url: url) {
                    return .handled
                }
                onFlash?(FileReveal.missingPathMessage(url.path))
                return .handled
            }
            if url.scheme == nil || url.scheme == "file" {
                let path = url.path.isEmpty ? url.absoluteString : url.path
                if FileReveal.revealInFinder(path: path) {
                    return .handled
                }
                onFlash?(FileReveal.missingPathMessage(path))
                return .handled
            }
            return .systemAction
        }
    }
}

// MARK: - ⌘+click overlay (no layout ownership)

/// Transparent hit-test overlay. Steals events only for ⌘+mouse; otherwise passes through.
private struct CmdPathClickOverlay: NSViewRepresentable {
    let plainText: String
    let targets: [FileReveal.PathTarget]
    let font: NSFont
    let lineLimit: Int?
    let onFlash: ((String) -> Void)?
    let onOpenDocument: ((URL) -> Void)?

    func makeNSView(context: Context) -> CmdPathClickNSView {
        let view = CmdPathClickNSView()
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor.clear.cgColor
        apply(to: view)
        return view
    }

    func updateNSView(_ view: CmdPathClickNSView, context: Context) {
        apply(to: view)
    }

    private func apply(to view: CmdPathClickNSView) {
        view.plainText = plainText
        view.targets = targets
        view.hitFont = font
        view.lineLimit = lineLimit
        view.onFlash = onFlash
        view.onOpenDocument = onOpenDocument
    }
}

private final class CmdPathClickNSView: NSView {
    var plainText: String = ""
    var targets: [FileReveal.PathTarget] = []
    var hitFont: NSFont = .systemFont(ofSize: NSFont.systemFontSize)
    var lineLimit: Int?
    var onFlash: ((String) -> Void)?
    var onOpenDocument: ((URL) -> Void)?

    override var isOpaque: Bool { false }

    /// Steal hits only for ⌘+left-mouse (and ⌘+move for cursor). Everything else → nil (pass through).
    override func hitTest(_ point: NSPoint) -> NSView? {
        guard let event = NSApp.currentEvent else { return nil }
        guard event.modifierFlags.contains(.command) else { return nil }

        switch event.type {
        case .leftMouseDown, .leftMouseUp, .leftMouseDragged, .mouseMoved, .cursorUpdate:
            // Only claim points inside our bounds.
            return bounds.contains(point) ? self : nil
        default:
            return nil
        }
    }

    override func mouseDown(with event: NSEvent) {
        guard event.modifierFlags.contains(.command) else { return }
        // 位置命中失败且全文只有一条路径 → 兜底用唯一目标：单行中间截断时
        // TextKit 测量与实际渲染错位，精确映射不可靠。
        let url = pathURL(at: event) ?? (targets.count == 1 ? targets[0].url : nil)
        guard let url else { return }
        // 文档（md/txt…）→ 右侧文档面板渲染；其它文件维持访达显示。
        if let onOpenDocument, DocumentDetector.isDocument(url) {
            onOpenDocument(url)
        } else {
            reveal(url)
        }
    }

    override func mouseUp(with event: NSEvent) {
        // Swallow ⌘+up so selection does not tweak after a path reveal.
        guard event.modifierFlags.contains(.command) else { return }
    }

    override func mouseDragged(with event: NSEvent) {
        // Swallow ⌘+drag while we own the hit.
        guard event.modifierFlags.contains(.command) else { return }
    }

    override func mouseMoved(with event: NSEvent) {
        updateCursor(for: event)
    }

    override func cursorUpdate(with event: NSEvent) {
        updateCursor(for: event)
    }

    private func updateCursor(for event: NSEvent) {
        if event.modifierFlags.contains(.command), pathURL(at: event) != nil {
            NSCursor.pointingHand.set()
        } else {
            NSCursor.arrow.set()
        }
    }

    private func pathURL(at event: NSEvent) -> URL? {
        let point = convert(event.locationInWindow, from: nil)
        // The overlay's own bounds are set by SwiftUI to the Text's laid-out size;
        // that is the authoritative width for the TextKit hit-test below. Before the
        // first layout pass bounds may be degenerate — fall back to .zero, which makes
        // PathLinkHitTest naturally miss (same as clicking text that hasn't laid out yet).
        let size = bounds.width > 1 && bounds.height > 1
            ? bounds.size
            : .zero
        return PathLinkHitTest.pathURL(
            at: point,
            text: plainText,
            targets: targets,
            size: size,
            font: hitFont,
            lineLimit: lineLimit
        )
    }

    private func reveal(_ url: URL) {
        if FileReveal.revealInFinder(url: url) { return }
        onFlash?(FileReveal.missingPathMessage(url.path))
    }
}
