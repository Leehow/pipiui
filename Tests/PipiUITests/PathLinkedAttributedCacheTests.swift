import AppKit
import SwiftUI
import XCTest
import PipiUI

final class PathLinkedAttributedCacheTests: XCTestCase {

    override func setUp() {
        super.setUp()
        FileReveal.clearPathLinkCache()
    }

    // MARK: - Default shape (inlineWithPaths output) is cached

    func testDefaultAttributedIsCachedAndEqual() {
        // What MarkdownTextView.inlineWithPaths produces for a plain-with-path string:
        // an AttributedString with no caller-applied foreground color.
        let text = "see /Users/alice/proj/file.swift here"
        let attributed = AttributedString(text)

        let first = FileReveal.pathLinkedContent(attributed: attributed)
        let second = FileReveal.pathLinkedContent(attributed: attributed)

        XCTAssertEqual(String(first.visual.characters), String(second.visual.characters))
        XCTAssertEqual(first.targets.count, second.targets.count)
        XCTAssertEqual(first.targets.map(\.path), second.targets.map(\.path))
        // The path got the accent + underline style on both passes.
        XCTAssertEqual(first.targets.count, 1)
        XCTAssertEqual(first.targets.first?.path, "/Users/alice/proj/file.swift")
    }

    func testTwoDistinctTextsDoNotCollide() {
        let a = FileReveal.pathLinkedContent(attributed: AttributedString("/Users/a/x.swift"))
        let b = FileReveal.pathLinkedContent(attributed: AttributedString("/Users/b/y.swift"))
        XCTAssertEqual(a.targets.first?.path, "/Users/a/x.swift")
        XCTAssertEqual(b.targets.first?.path, "/Users/b/y.swift")
    }

    // MARK: - Caller-applied foreground color bypasses cache (no pollution)

    func testRestyledAttributedNotCachedButStillCorrect() {
        // Simulate the quote path: caller sets foregroundColor = .secondary on the whole run.
        // This must NOT hit the cache of the default-shape entry for the same text, otherwise
        // the secondary color would be lost.
        let text = "/Users/alice/notes.md plus prose"
        let plainAttributed = AttributedString(text)

        // Warm the default-shape cache with the unstyled version.
        let defaultContent = FileReveal.pathLinkedContent(attributed: plainAttributed)
        let defaultHasNoForeground = defaultContent.visual.runs.allSatisfy { $0.foregroundColor == nil || $0.foregroundColor == Color.accentColor }
        XCTAssertTrue(defaultHasNoForeground, "default-shape path render only applies accent on the path range")

        // Now request the restyled version (secondary color everywhere).
        var restyled = AttributedString(text)
        restyled.foregroundColor = .secondary
        let restyledContent = FileReveal.pathLinkedContent(attributed: restyled)

        // It must still carry the secondary color on the non-path range (i.e. it was computed,
        // not returned from the default cache entry).
        let nonPathRunHasSecondary = restyledContent.visual.runs.contains { run in
            run.foregroundColor == .secondary
        }
        XCTAssertTrue(nonPathRunHasSecondary, "restyled attributed must not be served from the default cache")
    }

    // MARK: - Markdown link text is still cacheable

    func testMarkdownLinkTextIsCacheable() {
        // Foundation markdown turns [t](u) into a .link attribute but does NOT add a
        // foregroundColor, so this common case must still hit the cache.
        let md = (try? AttributedString(
            markdown: "see [docs](https://example.com) and /Users/alice/readme.md",
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString()

        let first = FileReveal.pathLinkedContent(attributed: md)
        let second = FileReveal.pathLinkedContent(attributed: md)

        XCTAssertEqual(String(first.visual.characters), String(second.visual.characters))
        XCTAssertEqual(first.targets.count, second.targets.count)
        // The file path is still detected as a target alongside the markdown link.
        XCTAssertEqual(first.targets.last?.path, "/Users/alice/readme.md")
    }

    // MARK: - Clear forces recompute

    func testClearForcesRecompute() {
        let text = "path /Users/x/y.swift end"
        let attributed = AttributedString(text)
        let first = FileReveal.pathLinkedContent(attributed: attributed)
        FileReveal.clearPathLinkCache()
        let second = FileReveal.pathLinkedContent(attributed: attributed)
        // Recomputed but still correct.
        XCTAssertEqual(first.targets.map(\.path), second.targets.map(\.path))
    }
}
