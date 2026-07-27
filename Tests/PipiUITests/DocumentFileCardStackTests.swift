import Foundation
import PipiUI
import XCTest

@MainActor
final class DocumentFileCardStackTests: XCTestCase {
    private func reference(
        _ path: String,
        origin: DocumentReference.Origin
    ) -> DocumentReference {
        let url = URL(fileURLWithPath: path)
        return DocumentReference(
            url: url,
            title: url.lastPathComponent,
            sourceRange: NSRange(location: 0, length: 1),
            origin: origin
        )
    }

    private func entry(_ state: DocumentSummaryStore.Entry.State) -> DocumentSummaryStore.Entry {
        .init(state: state)
    }

    func testExplicitReferencesRemainVisibleInEveryState() {
        for origin in [
            DocumentReference.Origin.absolute,
            .fileURL,
            .tilde,
        ] {
            for state in [
                DocumentSummaryStore.Entry.State.loading,
                .missing,
                .loaded(.init("body")),
                .tooLarge(size: 10),
                .unreadable,
            ] {
                let candidates = [reference("/Users/a/doc.md", origin: origin)]
                XCTAssertEqual(
                    DocumentFileCardStack.visibleCards(candidates) { _ in self.entry(state) }.count,
                    1,
                    "\(origin) / \(state)"
                )
            }
        }
    }

    func testSpeculativeReferencesHideOnlyWhileLoadingOrMissing() {
        let candidates = [
            reference("/project/relative.md", origin: .relativeResolved),
            reference("/project/bare.txt", origin: .uiFallback),
        ]
        XCTAssertTrue(
            DocumentFileCardStack.visibleCards(candidates) { _ in self.entry(.loading) }.isEmpty
        )
        XCTAssertTrue(
            DocumentFileCardStack.visibleCards(candidates) { _ in self.entry(.missing) }.isEmpty
        )

        for state in [
            DocumentSummaryStore.Entry.State.loaded(.init("body")),
            .tooLarge(size: 10),
            .unreadable,
        ] {
            XCTAssertEqual(
                DocumentFileCardStack.visibleCards(candidates) { _ in self.entry(state) }.count,
                2
            )
        }
    }

    func testVisibleCardsPreservesOrderAndDefensivelyDeduplicates() {
        let first = reference("/project/a.md", origin: .absolute)
        let second = reference("/project/b.md", origin: .relativeResolved)
        let visible = DocumentFileCardStack.visibleCards([first, second, first]) { _ in
            self.entry(.loaded(.init("body")))
        }
        XCTAssertEqual(visible.map(\.title), ["a.md", "b.md"])
    }

    func testPrefetchVisitsHiddenSpeculativeCandidatesBeforeVisibilityFiltering() {
        let candidates = [
            reference("/project/relative.md", origin: .relativeResolved),
            reference("/project/bare.txt", origin: .uiFallback),
            reference("/project/relative.md", origin: .absolute),
        ]
        var requests: [(String, DocumentKind)] = []

        DocumentFileCardStack.prefetchCandidates(candidates) { url, kind in
            requests.append((url.path, kind))
        }

        XCTAssertEqual(requests.map(\.0), ["/project/relative.md", "/project/bare.txt"])
        XCTAssertEqual(requests.map(\.1), [.markdown, .plain])
    }
}
