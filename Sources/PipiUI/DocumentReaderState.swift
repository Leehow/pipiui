import Combine
import Foundation

/// A compact Markdown heading model derived from the same AST blocks used by the renderer.
/// IDs are stable across ordinary content edits so a reader tab can keep its semantic anchor.
package struct MarkdownDocumentHeading: Identifiable, Equatable {
    package let id: String
    package let level: Int
    package let title: String
}

/// Document-reader outline extraction deliberately reuses `MarkdownTextView`'s cached AST.
/// It does not introduce a line parser or a second Markdown interpretation path.
package enum MarkdownDocumentOutline {
    package static func headings(from text: String) -> [MarkdownDocumentHeading] {
        headings(from: MarkdownTextView.cachedParse(text))
    }

    static func headings(
        from blocks: [MarkdownTextView.Block]
    ) -> [MarkdownDocumentHeading] {
        var occurrences: [String: Int] = [:]
        return blocks.compactMap { block in
            guard case .heading(let level, let content) = block else { return nil }
            let displayTitle = collapsedTitle(content.plainText)
            let title = displayTitle.isEmpty ? "未命名标题" : displayTitle
            let canonicalTitle = title
                .precomposedStringWithCanonicalMapping
                .lowercased()
            let occurrence = occurrences[canonicalTitle, default: 0]
            occurrences[canonicalTitle] = occurrence + 1
            return MarkdownDocumentHeading(
                id: "heading:\(canonicalTitle)#\(occurrence)",
                level: level,
                title: title
            )
        }
    }

    private static func collapsedTitle(_ text: String) -> String {
        text
            .split(whereSeparator: { $0.isWhitespace || $0.isNewline })
            .joined(separator: " ")
    }
}

/// A native-reader viewport expressed without fragile points. `anchorProgress` is the
/// normalized location inside the active heading's section; it makes a tab/reload restore
/// survive reflow and ordinary content insertions better than a raw pixel offset.
package struct DocumentReaderScrollPosition: Equatable {
    package let normalizedOffset: Double
    package let anchorHeadingID: String?
    package let anchorProgress: Double?

    package init(
        normalizedOffset: Double,
        anchorHeadingID: String? = nil,
        anchorProgress: Double? = nil
    ) {
        self.normalizedOffset = Self.clamp(normalizedOffset)
        self.anchorHeadingID = anchorHeadingID
        self.anchorProgress = anchorProgress.map(Self.clamp)
    }

    private static func clamp(_ value: Double) -> Double {
        guard value.isFinite else { return 0 }
        return min(1, max(0, value))
    }
}

/// Pure restoration decision used by the AppKit reader bridge and focused tests.
package enum DocumentReaderScrollRestoration {
    package enum Target: Equatable {
        case heading(id: String, progress: Double?)
        case normalized(Double)
    }

    package static func target(
        for position: DocumentReaderScrollPosition,
        availableHeadings: [MarkdownDocumentHeading]
    ) -> Target {
        if let id = position.anchorHeadingID,
           availableHeadings.contains(where: { $0.id == id }) {
            return .heading(id: id, progress: position.anchorProgress)
        }
        return .normalized(position.normalizedOffset)
    }
}

package enum DocumentReaderFindDirection: Equatable {
    case next
    case previous
}

/// Per-tab reader-only state. It intentionally lives next to `DocumentTabsStore`, rather than
/// in a shared chat scroll model, so document find/outline/viewport behavior cannot affect the
/// transcript.
package final class DocumentReaderState: ObservableObject {
    @Published package private(set) var activeHeadingID: String?
    @Published package private(set) var isFindVisible = false
    @Published package private(set) var isTableOfContentsVisible = false
    @Published package private(set) var findQuery = ""
    @Published package private(set) var findRequestGeneration: UInt64 = 0
    @Published package private(set) var findDirection: DocumentReaderFindDirection = .next
    @Published package private(set) var findFocusGeneration: UInt64 = 0
    @Published package private(set) var headingJumpGeneration: UInt64 = 0

    /// Updated by the native scroll observer, but intentionally not published: scroll pulses
    /// should not invalidate the SwiftUI document shell or the chat transcript.
    package private(set) var scrollPosition = DocumentReaderScrollPosition(normalizedOffset: 0)

    package init() {}

    package func captureScrollPosition(_ position: DocumentReaderScrollPosition) {
        scrollPosition = position
        recordActiveHeading(position.anchorHeadingID)
    }

    package func recordActiveHeading(_ id: String?) {
        guard activeHeadingID != id else { return }
        activeHeadingID = id
    }

    package func requestHeadingJump(to id: String) {
        activeHeadingID = id
        scrollPosition = DocumentReaderScrollPosition(
            normalizedOffset: scrollPosition.normalizedOffset,
            anchorHeadingID: id,
            anchorProgress: 0
        )
        headingJumpGeneration &+= 1
    }

    package func toggleTableOfContents() {
        isTableOfContentsVisible.toggle()
    }

    package func showFind() {
        isFindVisible = true
        findFocusGeneration &+= 1
    }

    package func dismissFind() {
        isFindVisible = false
    }

    package func updateFindQuery(_ query: String) {
        guard findQuery != query else { return }
        findQuery = query
        requestFind(.next)
    }

    package func findNext() {
        requestFind(.next)
    }

    package func findPrevious() {
        requestFind(.previous)
    }

    private func requestFind(_ direction: DocumentReaderFindDirection) {
        findDirection = direction
        findRequestGeneration &+= 1
    }
}
