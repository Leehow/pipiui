import XCTest
@testable import PipiUI

final class MarkdownSelectionContentTests: XCTestCase {
    func testSelectionAttributedCombinesParagraphsIntoOneTextStorage() {
        let markdown = """
        第一段 **加粗**文字。

        第二段文字。
        """

        let content = MarkdownSelectionContent.attributedString(for: markdown)

        XCTAssertEqual(content.string, "第一段 加粗文字。\n\n第二段文字。")
        XCTAssertEqual(
            content.string.components(separatedBy: "\n\n").count,
            2,
            "多个段落必须位于同一个 NSTextStorage，才能由原生 NSTextView 跨段拖拽选择"
        )
    }

    func testMergeAdjacentTextBlocksIntoOneSelectableMessage() {
        let blocks: [ChatBlock] = [
            .text("第一段。"),
            .text("第二段。"),
        ]

        XCTAssertEqual(
            MessageTextBlocks.mergeAdjacent(blocks),
            [.text("第一段。\n\n第二段。")]
        )
    }
}
