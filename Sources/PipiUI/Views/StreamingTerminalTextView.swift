import AppKit
import SwiftUI

/// Lightweight terminal text cleanup for tool output previews.
///
/// Strips CSI/OSC (and a few other common ESC sequences) and applies `\r`
/// "overwrite current line" semantics so progress-bar style output does not
/// stack garbage. No third-party ANSI library — prefer dropping styles over
/// crashing on malformed sequences.
enum TerminalOutputSanitizer {
    /// Max UTF-16 units retained for display (tail-preserving). Full tool
    /// output stays in `ToolRun.output`; this only bounds the AppKit view.
    static let displayUTF16Limit = 100_000

    static func displayText(from raw: String) -> String {
        let stripped = stripANSI(raw)
        let withCR = applyCarriageReturns(stripped)
        return tailBounded(withCR, limit: displayUTF16Limit)
    }

    /// Remove ANSI escape sequences. Unrecognized ESC forms drop the ESC and
    /// continue so a bad sequence cannot brick the rest of the stream.
    static func stripANSI(_ input: String) -> String {
        guard input.contains("\u{1B}") || input.contains("\u{9B}") else {
            return input
        }

        var out = String()
        out.reserveCapacity(input.utf8.count)
        var i = input.startIndex
        let end = input.endIndex

        while i < end {
            let ch = input[i]
            if ch == "\u{9B}" {
                // 8-bit CSI: equivalent to ESC [
                i = input.index(after: i)
                i = skipCSIParameters(input, from: i)
                continue
            }
            if ch != "\u{1B}" {
                out.append(ch)
                i = input.index(after: i)
                continue
            }

            let afterEsc = input.index(after: i)
            guard afterEsc < end else { break }
            let next = input[afterEsc]

            switch next {
            case "[":
                // CSI: ESC [ ... final-byte in @–~
                i = skipCSIParameters(input, from: input.index(after: afterEsc))
            case "]":
                // OSC: ESC ] ... BEL or ST (ESC \)
                i = skipOSC(input, from: input.index(after: afterEsc))
            case "(", ")", "*", "+":
                // Character-set designation: ESC ( B  etc. — one payload byte.
                let payload = input.index(after: afterEsc)
                i = payload < end ? input.index(after: payload) : end
            case "c", "7", "8", "D", "E", "H", "M", "Z", ">", "=", "N", "O":
                // Single-character ESC sequences.
                i = input.index(after: afterEsc)
            default:
                // Unknown ESC — drop ESC only, keep the following char.
                i = afterEsc
            }
        }
        return out
    }

    /// Apply `\r` as "return to start of current line" (overwrite). Bare `\r`
    /// without a following `\n` replaces the in-progress line; `\r\n` stays a
    /// normal line ending.
    ///
    /// Iterates Unicode scalars (not `Character`) because Swift treats CRLF as a
    /// single extended grapheme cluster, which would hide the bare-`\r` case.
    static func applyCarriageReturns(_ input: String) -> String {
        guard input.unicodeScalars.contains(where: { $0 == "\r" }) else {
            return input
        }

        var lines: [String] = []
        var currentScalars: [UnicodeScalar] = []
        currentScalars.reserveCapacity(min(256, input.unicodeScalars.count))
        var i = input.unicodeScalars.startIndex
        let end = input.unicodeScalars.endIndex

        while i < end {
            let scalar = input.unicodeScalars[i]
            if scalar == "\r" {
                let next = input.unicodeScalars.index(after: i)
                if next < end, input.unicodeScalars[next] == "\n" {
                    // CRLF → normal newline
                    lines.append(String(String.UnicodeScalarView(currentScalars)))
                    currentScalars.removeAll(keepingCapacity: true)
                    i = input.unicodeScalars.index(after: next)
                } else {
                    // Overwrite current line
                    currentScalars.removeAll(keepingCapacity: true)
                    i = next
                }
            } else if scalar == "\n" {
                lines.append(String(String.UnicodeScalarView(currentScalars)))
                currentScalars.removeAll(keepingCapacity: true)
                i = input.unicodeScalars.index(after: i)
            } else {
                currentScalars.append(scalar)
                i = input.unicodeScalars.index(after: i)
            }
        }
        lines.append(String(String.UnicodeScalarView(currentScalars)))
        return lines.joined(separator: "\n")
    }

    /// Keep the tail when over budget so a live terminal still shows latest output.
    static func tailBounded(_ input: String, limit: Int) -> String {
        let sourceLength = input.utf16.count
        guard sourceLength > limit else { return input }

        let note =
            "[Output truncated for display: \(sourceLength - limit) UTF-16 units omitted from head. "
            + "Full result remains in session data.]\n"
        let noteUTF16 = note.utf16.count
        let contentLimit = max(0, limit - noteUTF16)
        let retained = characterSuffix(input, utf16Limit: contentLimit)
        return note + retained
    }

    // MARK: - Escape scanners

    private static func skipCSIParameters(_ input: String, from start: String.Index) -> String.Index {
        var i = start
        let end = input.endIndex
        while i < end {
            let scalar = input[i].unicodeScalars.first?.value ?? 0
            // Final byte of CSI is in 0x40...0x7E (@ through ~).
            if scalar >= 0x40 && scalar <= 0x7E {
                return input.index(after: i)
            }
            i = input.index(after: i)
        }
        return end
    }

    private static func skipOSC(_ input: String, from start: String.Index) -> String.Index {
        var i = start
        let end = input.endIndex
        while i < end {
            let ch = input[i]
            if ch == "\u{07}" { // BEL
                return input.index(after: i)
            }
            if ch == "\u{1B}" {
                let next = input.index(after: i)
                if next < end, input[next] == "\\" { // ST
                    return input.index(after: next)
                }
                // Bare ESC inside OSC — treat as terminator to avoid eating everything.
                return i
            }
            i = input.index(after: i)
        }
        return end
    }

    private static func characterSuffix(_ output: String, utf16Limit: Int) -> String {
        guard utf16Limit > 0 else { return "" }
        var utf16Count = 0
        var start = output.endIndex
        var idx = output.endIndex
        while idx > output.startIndex {
            let prev = output.index(before: idx)
            let clusterUTF16 = output[prev].utf16.count
            if utf16Count + clusterUTF16 > utf16Limit { break }
            utf16Count += clusterUTF16
            start = prev
            idx = prev
        }
        return String(output[start...])
    }
}

// MARK: - SwiftUI bridge

/// Read-only monospaced terminal surface that incrementally appends text into an
/// `NSTextView` instead of rebuilding the whole string on every partial update.
///
/// - Incremental: diffs the sanitized full string against the last painted text
///   and only mutates the changed UTF-16 tail.
/// - Throttled: UI appends coalesce to ~30ms (input pipeline already merges at
///   ~50ms; this is a second safety layer).
/// - Stick-to-bottom: auto-scrolls while the user is at the bottom; leaves the
///   viewport alone after an intentional upward scroll until they return.
struct StreamingTerminalTextView: NSViewRepresentable {
    let text: String
    var isLive: Bool = true

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
        scrollView.drawsBackground = true
        scrollView.backgroundColor = .textBackgroundColor
        OverlayScrollers.apply(to: scrollView)

        let textView = StreamingTerminalNSTextView(frame: .zero)
        textView.isEditable = false
        textView.isSelectable = true
        textView.isRichText = false
        textView.importsGraphics = false
        textView.drawsBackground = false
        textView.backgroundColor = .clear
        textView.textColor = .labelColor
        textView.font = Self.terminalFont
        textView.textContainerInset = NSSize(width: 10, height: 10)
        textView.textContainer?.lineFragmentPadding = 0
        textView.textContainer?.widthTracksTextView = true
        textView.isHorizontallyResizable = false
        textView.isVerticallyResizable = true
        textView.autoresizingMask = [.width]
        textView.minSize = .zero
        textView.maxSize = NSSize(
            width: CGFloat.greatestFiniteMagnitude,
            height: CGFloat.greatestFiniteMagnitude
        )
        textView.typingAttributes = Self.typingAttributes
        textView.allowsUndo = false
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.isAutomaticSpellingCorrectionEnabled = false
        textView.enabledTextCheckingTypes = 0
        textView.setAccessibilityLabel("工具输出终端")

        scrollView.documentView = textView
        context.coordinator.attach(scrollView: scrollView, textView: textView)
        context.coordinator.enqueue(text: text, force: true)
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        context.coordinator.isLive = isLive
        context.coordinator.enqueue(text: text, force: !isLive)
        // Appearance may flip while the sheet is open.
        if let textView = scrollView.documentView as? NSTextView {
            textView.textColor = .labelColor
            textView.typingAttributes = Self.typingAttributes
            scrollView.backgroundColor = .textBackgroundColor
        }
    }

    static func dismantleNSView(_ scrollView: NSScrollView, coordinator: Coordinator) {
        coordinator.detach()
    }

    private static var terminalFont: NSFont {
        NSFont.monospacedSystemFont(ofSize: NSFont.smallSystemFontSize, weight: .regular)
    }

    private static var typingAttributes: [NSAttributedString.Key: Any] {
        [
            .font: terminalFont,
            .foregroundColor: NSColor.labelColor,
        ]
    }

    // MARK: Coordinator

    final class Coordinator {
        private weak var scrollView: NSScrollView?
        private weak var textView: NSTextView?
        private var renderedText = ""
        private var pendingText: String?
        private var flushWorkItem: DispatchWorkItem?
        private var scrollObserver: NSObjectProtocol?
        private var boundsObserver: NSObjectProtocol?
        /// User is at (or near) the bottom; new output should pin the viewport.
        private var stickToBottom = true
        var isLive = true

        private let flushIntervalNanoseconds: UInt64 = 30_000_000 // 30ms
        private let bottomSlack: CGFloat = 24

        func attach(scrollView: NSScrollView, textView: NSTextView) {
            self.scrollView = scrollView
            self.textView = textView

            let center = NotificationCenter.default
            scrollObserver = center.addObserver(
                forName: NSScrollView.didLiveScrollNotification,
                object: scrollView,
                queue: .main
            ) { [weak self] _ in
                self?.refreshStickToBottomFromScroll()
            }
            boundsObserver = center.addObserver(
                forName: NSView.boundsDidChangeNotification,
                object: scrollView.contentView,
                queue: .main
            ) { [weak self] _ in
                self?.refreshStickToBottomFromScroll()
            }
            scrollView.contentView.postsBoundsChangedNotifications = true
        }

        func detach() {
            flushWorkItem?.cancel()
            flushWorkItem = nil
            pendingText = nil
            if let scrollObserver {
                NotificationCenter.default.removeObserver(scrollObserver)
            }
            if let boundsObserver {
                NotificationCenter.default.removeObserver(boundsObserver)
            }
            scrollObserver = nil
            boundsObserver = nil
            scrollView = nil
            textView = nil
        }

        /// Queue a full-string paint. Live updates coalesce; final/`force` paints ASAP.
        func enqueue(text raw: String, force: Bool) {
            let display = TerminalOutputSanitizer.displayText(from: raw)
            pendingText = display
            if force {
                flushWorkItem?.cancel()
                flushWorkItem = nil
                flushPending()
                return
            }
            guard flushWorkItem == nil else { return }
            let work = DispatchWorkItem { [weak self] in
                self?.flushWorkItem = nil
                self?.flushPending()
            }
            flushWorkItem = work
            DispatchQueue.main.asyncAfter(
                deadline: .now() + .nanoseconds(Int(flushIntervalNanoseconds)),
                execute: work
            )
        }

        private func flushPending() {
            guard let next = pendingText else { return }
            pendingText = nil
            apply(displayText: next)
        }

        private func apply(displayText newText: String) {
            guard let textView, let storage = textView.textStorage else { return }
            guard newText != renderedText else {
                if stickToBottom { scrollToBottomIfNeeded(force: false) }
                return
            }

            let oldNS = renderedText as NSString
            let newNS = newText as NSString
            let oldLen = oldNS.length
            let newLen = newNS.length
            let common = Self.commonUTF16PrefixLength(oldNS, newNS)

            let attrs = StreamingTerminalTextView.typingAttributes
            storage.beginEditing()
            if common < oldLen {
                storage.replaceCharacters(
                    in: NSRange(location: common, length: oldLen - common),
                    with: ""
                )
            }
            if common < newLen {
                let suffix = newNS.substring(from: common)
                storage.replaceCharacters(
                    in: NSRange(location: common, length: 0),
                    with: NSAttributedString(string: suffix, attributes: attrs)
                )
            }
            storage.endEditing()

            renderedText = newText

            if stickToBottom {
                scrollToBottomIfNeeded(force: true)
            }
        }

        private func refreshStickToBottomFromScroll() {
            guard let scrollView else { return }
            let visible = scrollView.contentView.bounds
            let docHeight = scrollView.documentView?.bounds.height
                ?? scrollView.documentVisibleRect.height
            let distanceFromBottom = docHeight - (visible.origin.y + visible.height)
            // Live scroll away from bottom unpins; returning within slack re-pins.
            stickToBottom = distanceFromBottom <= bottomSlack
        }

        private func scrollToBottomIfNeeded(force: Bool) {
            guard let scrollView, let textView else { return }
            if !force && !stickToBottom { return }

            // Ensure layout has the latest glyph metrics before asking for end rect.
            if let container = textView.textContainer {
                textView.layoutManager?.ensureLayout(for: container)
            }
            let length = textView.string.utf16.count
            if length == 0 {
                textView.scroll(NSPoint(x: 0, y: 0))
                return
            }
            textView.scrollRangeToVisible(NSRange(location: max(0, length - 1), length: 1))
            // Also pin the clip view in case scrollRangeToVisible is a no-op mid-layout.
            let docHeight = textView.bounds.height
            let clipHeight = scrollView.contentView.bounds.height
            if docHeight > clipHeight {
                let target = NSPoint(x: 0, y: docHeight - clipHeight)
                scrollView.contentView.scroll(to: target)
                scrollView.reflectScrolledClipView(scrollView.contentView)
            }
            stickToBottom = true
        }

        /// Shared pure helper — unit-tested.
        static func commonUTF16PrefixLength(_ a: NSString, _ b: NSString) -> Int {
            let limit = min(a.length, b.length)
            var i = 0
            while i < limit, a.character(at: i) == b.character(at: i) {
                i += 1
            }
            return i
        }
    }
}

/// NSTextView that never becomes first-responder on background clicks unnecessarily
/// and keeps a stable monospaced look inside the tool detail sheet.
private final class StreamingTerminalNSTextView: NSTextView {
    override func mouseDown(with event: NSEvent) {
        // Allow selection without focusing the whole sheet keyboard ring awkwardly.
        window?.makeFirstResponder(self)
        super.mouseDown(with: event)
    }
}
