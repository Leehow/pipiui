import XCTest
@testable import PipiUI

final class MarkdownListSelectionTests: XCTestCase {

    func testListAttributedJoinsItemsWithNewlines() {
        let items = [
            MarkdownTextView.ListItem(marker: "•", text: "first", indent: 0),
            MarkdownTextView.ListItem(marker: "•", text: "second", indent: 0),
            MarkdownTextView.ListItem(marker: "•", text: "nested", indent: 1),
        ]
        let plain = String(MarkdownTextView.listAttributed(items).characters)
        XCTAssertEqual(plain, "• first\n• second\n  • nested")
    }

    func testListAttributedKeepsInlineMarkdown() {
        let items = [
            MarkdownTextView.ListItem(marker: "•", text: "see **bold**", indent: 0),
        ]
        let attr = MarkdownTextView.listAttributed(items)
        let hasBold = attr.runs.contains { run in
            run.inlinePresentationIntent?.contains(.stronglyEmphasized) == true
        }
        XCTAssertTrue(hasBold)
        XCTAssertEqual(String(attr.characters), "• see bold")
    }

    func testParseListBecomesSingleBlock() {
        let blocks = MarkdownTextView.parse("""
        - alpha
        - beta
        """)
        guard case .list(let items) = blocks.first else {
            return XCTFail("expected one list block, got \(blocks)")
        }
        XCTAssertEqual(items.count, 2)
        XCTAssertEqual(blocks.count, 1)
    }
}
