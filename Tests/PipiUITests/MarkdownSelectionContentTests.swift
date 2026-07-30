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

    func testBoldAndCodeFontsSurviveRendered() {
        let typography = ChatTypography.make(fontSize: 15)
        let content = MarkdownSelectionContent.attributedString(
            for: "**agentId** and `explore-sidebar`",
            typography: typography
        )

        XCTAssertEqual(content.string, "agentId and explore-sidebar")

        let ns = content.string as NSString
        let boldRange = ns.range(of: "agentId")
        XCTAssertNotEqual(boldRange.location, NSNotFound)
        let boldFont = content.attribute(.font, at: boldRange.location, effectiveRange: nil) as? NSFont
        XCTAssertNotNil(boldFont)
        XCTAssertTrue(
            boldFont!.fontDescriptor.symbolicTraits.contains(.bold),
            "expected bold font on **agentId**, got \(boldFont!.fontName)"
        )

        let codeRange = ns.range(of: "explore-sidebar")
        XCTAssertNotEqual(codeRange.location, NSNotFound)
        let codeFont = content.attribute(.font, at: codeRange.location, effectiveRange: nil) as? NSFont
        XCTAssertNotNil(codeFont)
        XCTAssertTrue(
            codeFont!.fontDescriptor.symbolicTraits.contains(.monoSpace),
            "expected monospaced font on `explore-sidebar`, got \(codeFont!.fontName)"
        )
    }

    func testItalicAndStrikethroughSurviveRendered() {
        let content = MarkdownSelectionContent.attributedString(
            for: "*斜体* and ~~删除线~~"
        )
        let ns = content.string as NSString

        let italicRange = ns.range(of: "斜体")
        XCTAssertNotEqual(italicRange.location, NSNotFound)
        let italicFont = content.attribute(.font, at: italicRange.location, effectiveRange: nil) as? NSFont
        XCTAssertNotNil(italicFont)
        XCTAssertTrue(
            italicFont!.fontDescriptor.symbolicTraits.contains(.italic),
            "expected italic font on *斜体*, got \(italicFont!.fontName)"
        )

        let strikeRange = ns.range(of: "删除线")
        XCTAssertNotEqual(strikeRange.location, NSNotFound)
        let strike = content.attribute(.strikethroughStyle, at: strikeRange.location, effectiveRange: nil) as? Int
        XCTAssertEqual(strike, NSUnderlineStyle.single.rawValue)
    }

    func testTableCellsKeepInlineMarkdown() {
        let markdown = """
        | Key | Value |
        | --- | --- |
        | **agentId** | `explore` |
        """
        let content = MarkdownSelectionContent.attributedString(for: markdown)
        let ns = content.string as NSString

        let boldRange = ns.range(of: "agentId")
        XCTAssertNotEqual(boldRange.location, NSNotFound)
        let boldFont = content.attribute(.font, at: boldRange.location, effectiveRange: nil) as? NSFont
        XCTAssertTrue(
            boldFont?.fontDescriptor.symbolicTraits.contains(.bold) == true,
            "table cell **agentId** must stay bold"
        )

        let codeRange = ns.range(of: "explore")
        XCTAssertNotEqual(codeRange.location, NSNotFound)
        let codeFont = content.attribute(.font, at: codeRange.location, effectiveRange: nil) as? NSFont
        XCTAssertTrue(
            codeFont?.fontDescriptor.symbolicTraits.contains(.monoSpace) == true,
            "table cell `explore` must stay monospaced"
        )
    }
}
