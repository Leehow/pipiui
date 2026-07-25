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

    func testSelectionAttributedAppliesBodyRhythm() {
        let typography = ChatTypography.make(fontSize: 15)
        let content = MarkdownSelectionContent.attributedString(
            for: "第一行文字足够长会换行。\n第二行。",
            typography: typography
        )

        var range = NSRange()
        let style = content.attribute(.paragraphStyle, at: 0, effectiveRange: &range) as? NSParagraphStyle
        XCTAssertNotNil(style)
        XCTAssertEqual(style?.lineSpacing ?? -1, typography.lineSpacing, accuracy: 0.001)
        XCTAssertEqual(style?.paragraphSpacing ?? -1, typography.paragraphSpacing, accuracy: 0.001)
    }

    func testListItemsUseListItemSpacing() {
        let typography = ChatTypography.make(fontSize: 15)
        let content = MarkdownSelectionContent.attributedString(
            for: "- 一项\n- 二项",
            typography: typography
        )

        var range = NSRange()
        let style = content.attribute(.paragraphStyle, at: 0, effectiveRange: &range) as? NSParagraphStyle
        XCTAssertNotNil(style)
        XCTAssertEqual(style?.lineSpacing ?? -1, typography.lineSpacing, accuracy: 0.001)
        XCTAssertEqual(style?.paragraphSpacing ?? -1, typography.listItemSpacing, accuracy: 0.001)
    }

    func testHeadingUsesTighterLineSpacing() {
        let typography = ChatTypography.make(fontSize: 15)
        let content = MarkdownSelectionContent.attributedString(
            for: "## 标题",
            typography: typography
        )

        var range = NSRange()
        let style = content.attribute(.paragraphStyle, at: 0, effectiveRange: &range) as? NSParagraphStyle
        XCTAssertNotNil(style)
        XCTAssertEqual(style?.lineSpacing ?? -1, typography.headingLineSpacing, accuracy: 0.001)
    }

    func testBlockSeparatorUsesBlockSpacingLineHeight() {
        let typography = ChatTypography.make(fontSize: 15)
        let content = MarkdownSelectionContent.attributedString(
            for: "第一段。\n\n第二段。",
            typography: typography
        )

        // Separator sits at the first "\n\n" between the two paragraphs.
        let separatorIndex = (content.string as NSString).range(of: "\n\n").location
        XCTAssertNotEqual(separatorIndex, NSNotFound)

        var range = NSRange()
        let style = content.attribute(
            .paragraphStyle,
            at: separatorIndex,
            effectiveRange: &range
        ) as? NSParagraphStyle
        XCTAssertNotNil(style)
        XCTAssertEqual(style?.minimumLineHeight ?? -1, typography.blockSpacing, accuracy: 0.001)
        XCTAssertEqual(style?.maximumLineHeight ?? -1, typography.blockSpacing, accuracy: 0.001)
    }
}
