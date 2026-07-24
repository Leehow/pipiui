import AppKit
import XCTest
@testable import PipiUI

final class MarkdownInlineCacheTests: XCTestCase {

    override func setUp() {
        super.setUp()
        MarkdownTextView.clearInlineCache()
    }

    func testSameInputReturnsEqualResult() {
        let text = "see **bold** and `code` plus /Users/alice/foo.swift"
        let first = MarkdownTextView.inlineWithPaths(text)
        let second = MarkdownTextView.inlineWithPaths(text)
        // Equal rendered output on cache hit (AttributedString is not identical across calls,
        // but its character/attribute content must match).
        XCTAssertEqual(String(first.characters), String(second.characters))
        XCTAssertTrue(first.runs.elementsEqual(second.runs, by: { $0.attributes == $1.attributes }))
    }

    func testDifferentInputDoesNotCollide() {
        let a = MarkdownTextView.inlineWithPaths("plain text A")
        let b = MarkdownTextView.inlineWithPaths("plain text B")
        XCTAssertNotEqual(String(a.characters), String(b.characters))
    }

    func testPlainProseCachedAsPlainString() {
        // No markdown markers → must not invoke AttributedString(markdown:); content equals input.
        let plain = "just a sentence with no markup"
        let result = MarkdownTextView.inlineWithPaths(plain)
        XCTAssertEqual(String(result.characters), plain)
        // Second call hits the cache and returns equal content.
        XCTAssertEqual(
            String(MarkdownTextView.inlineWithPaths(plain).characters),
            plain
        )
    }

    func testMarkdownParseApplied() {
        // **bold** should render bold (non-empty attributes), proving we did not short-circuit
        // into the plain-prose branch for markered text.
        let md = "this is **bold**"
        let result = MarkdownTextView.inlineWithPaths(md)
        let hasBold = result.runs.contains { run in
            run.inlinePresentationIntent?.contains(.stronglyEmphasized) == true
        }
        XCTAssertTrue(hasBold, "inlineWithPaths should apply markdown formatting to markered text")
    }

    func testClearCacheForcesReparse() {
        let text = "**x**"
        let first = MarkdownTextView.inlineWithPaths(text)
        MarkdownTextView.clearInlineCache()
        let second = MarkdownTextView.inlineWithPaths(text)
        // After clear, the result is recomputed but must still be correct.
        XCTAssertEqual(String(first.characters), String(second.characters))
    }
}
