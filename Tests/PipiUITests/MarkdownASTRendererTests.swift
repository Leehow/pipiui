import AppKit
import XCTest
@testable import PipiUI

final class MarkdownASTRendererTests: XCTestCase {
    private let typography = ChatTypography.make(fontSize: ChatTypography.defaultFontSize)

    func testDependencyAndActiveRendererUseSwiftMarkdownAST() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let package = try String(
            contentsOf: root.appendingPathComponent("Package.swift"),
            encoding: .utf8
        )
        let adapter = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/Views/MarkdownASTAdapter.swift"),
            encoding: .utf8
        )

        XCTAssertTrue(package.contains("https://github.com/swiftlang/swift-markdown.git"))
        XCTAssertTrue(package.contains(".product(name: \"Markdown\", package: \"swift-markdown\")"))
        XCTAssertTrue(adapter.contains("Markdown.Document("))
        XCTAssertTrue(adapter.contains("Markdown.Table"))
        XCTAssertTrue(adapter.contains("Markdown.ListItem"))
        XCTAssertTrue(adapter.contains("Markdown.Image"))
    }

    func testNestedListsAndTasksAdaptFromASTWithHangingSelectionText() {
        let source = """
        - [x] shipped **today**
          1. first child
             - [ ] nested task
        - plain item
        """
        let blocks = MarkdownTextView.parse(source)

        guard case .list(let items)? = blocks.first else {
            return XCTFail("expected an AST-adapted list, got \(blocks)")
        }
        XCTAssertEqual(items.count, 4)
        XCTAssertEqual(items[0].marker, "•")
        XCTAssertEqual(items[0].taskState, .checked)
        XCTAssertEqual(items[1].marker, "1.")
        XCTAssertEqual(items[1].indent, 1)
        XCTAssertEqual(items[2].taskState, .unchecked)
        XCTAssertEqual(items[2].indent, 2)

        let content = MarkdownSelectionContent.attributedString(
            for: blocks,
            typography: typography
        )
        XCTAssertTrue(content.string.contains("• ☑ shipped today"))
        XCTAssertTrue(content.string.contains("☐ nested task"))
        let bold = (content.string as NSString).range(of: "today")
        let font = content.attribute(.font, at: bold.location, effectiveRange: nil) as? NSFont
        XCTAssertTrue(font?.fontDescriptor.symbolicTraits.contains(.bold) == true)

        let firstStyle = content.attribute(.paragraphStyle, at: 0, effectiveRange: nil) as? NSParagraphStyle
        XCTAssertGreaterThan(firstStyle?.headIndent ?? 0, firstStyle?.firstLineHeadIndent ?? 0)
    }

    func testGFMTableRetainsCellsAlignmentsAndHeaderTreatment() {
        let source = """
        | Key | Value |
        | :-- | :---: |
        | **agentId** | `explore` |
        """
        let blocks = MarkdownTextView.parse(source)
        guard case .table(let header, let rows, let alignments)? = blocks.first else {
            return XCTFail("expected a GFM table, got \(blocks)")
        }
        XCTAssertEqual(header.count, 2)
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(alignments, [.left, .center])

        let content = MarkdownSelectionContent.attributedString(for: blocks, typography: typography)
        XCTAssertTrue(content.string.contains("│ Key │ Value │"))
        let headerRange = (content.string as NSString).range(of: "Key")
        let headerFont = content.attribute(.font, at: headerRange.location, effectiveRange: nil) as? NSFont
        XCTAssertTrue(headerFont?.fontDescriptor.symbolicTraits.contains(.bold) == true)
        let codeRange = (content.string as NSString).range(of: "explore")
        let codeFont = content.attribute(.font, at: codeRange.location, effectiveRange: nil) as? NSFont
        XCTAssertTrue(codeFont?.fontDescriptor.symbolicTraits.contains(.monoSpace) == true)
    }

    func testStreamingLightweightTailRendersGFMTableWithoutLeadingPipes() {
        let source = "A | B\n--- | ---\n**x** | y"
        let renderer = MarkdownStreamingRenderer()
        renderer.prefersLightweightTail = true

        guard case .full(let content) = renderer.update(text: source, typography: typography) else {
            return XCTFail("initial streaming update should be full")
        }
        XCTAssertTrue(content.string.contains("│"))
        XCTAssertFalse(content.string.contains("--- | ---"))
    }

    func testStreamingLightweightTailAppliesInlineFormattingLikeSettledMarkdown() {
        let source = "**bold** and `code` and [txt](https://example.com) and ~~gone~~"
        let renderer = MarkdownStreamingRenderer()
        renderer.prefersLightweightTail = true

        guard case .full(let streamed) = renderer.update(text: source, typography: typography) else {
            return XCTFail("initial streaming update should be full")
        }
        let settled = MarkdownSelectionContent.attributedString(for: source, typography: typography)
        XCTAssertEqual(streamed.string, settled.string)
        XCTAssertFalse(streamed.string.contains("**"))
        XCTAssertFalse(streamed.string.contains("`"))
        XCTAssertFalse(streamed.string.contains("~~"))
        let linkRange = (streamed.string as NSString).range(of: "txt")
        XCTAssertEqual(
            (streamed.attribute(.link, at: linkRange.location, effectiveRange: nil) as? URL)?.absoluteString,
            "https://example.com"
        )
    }

    func testStreamingTableWithoutLeadingPipesMatchesSettledOutput() {
        let source = "A | B\n--- | ---\n**x** | y"
        let renderer = MarkdownStreamingRenderer()
        renderer.prefersLightweightTail = true

        guard case .full(let streamed) = renderer.update(text: source, typography: typography) else {
            return XCTFail("initial streaming update should be full")
        }
        let settled = MarkdownSelectionContent.attributedString(for: source, typography: typography)
        XCTAssertEqual(streamed.string, settled.string)
    }

    func testBlockquoteUsesASTChildrenAndSingleStorageQuoteChrome() {
        let source = """
        > quoted **status**
        >
        > - nested item
        """
        let blocks = MarkdownTextView.parse(source)
        guard case .quote(let children)? = blocks.first else {
            return XCTFail("expected a quote block, got \(blocks)")
        }
        XCTAssertEqual(children.count, 2)

        let content = MarkdownSelectionContent.attributedString(for: blocks, typography: typography)
        XCTAssertTrue(content.string.contains("▎ quoted status"))
        XCTAssertTrue(content.string.contains("▎ • nested item"))
        let quoteRange = (content.string as NSString).range(of: "quoted")
        XCTAssertNotNil(content.attribute(.backgroundColor, at: quoteRange.location, effectiveRange: nil))
    }

    func testFencedCodeKeepsLanguageAndCodeBackground() {
        let source = """
        ```swift
        let value = 42
        ```
        """
        let blocks = MarkdownTextView.parse(source)
        guard case .code(let code, let language)? = blocks.first else {
            return XCTFail("expected fenced code, got \(blocks)")
        }
        XCTAssertEqual(language, "swift")
        XCTAssertEqual(code, "let value = 42\n")

        let content = MarkdownSelectionContent.attributedString(for: blocks, typography: typography)
        XCTAssertTrue(content.string.hasPrefix("swift\nlet value = 42"))
        let codeRange = (content.string as NSString).range(of: "let value")
        XCTAssertNotNil(content.attribute(.backgroundColor, at: codeRange.location, effectiveRange: nil))
    }

    func testLinksImagesAndBareFilePathsRetainNativeActions() {
        let source = "[site](https://example.com) ![diagram](file:///tmp/diagram.png) /tmp/notes.md"
        let content = MarkdownSelectionContent.attributedString(for: source, typography: typography)
        let ns = content.string as NSString

        let site = ns.range(of: "site")
        XCTAssertEqual(
            (content.attribute(.link, at: site.location, effectiveRange: nil) as? URL)?.absoluteString,
            "https://example.com"
        )
        let image = ns.range(of: "[Image: diagram]")
        XCTAssertEqual(
            (content.attribute(.link, at: image.location, effectiveRange: nil) as? URL)?.absoluteString,
            "file:///tmp/diagram.png"
        )
        let path = ns.range(of: "/tmp/notes.md")
        XCTAssertNotNil(content.attribute(.underlineStyle, at: path.location, effectiveRange: nil))
    }

    func testIncompleteStreamingFenceStaysCheapThenSettlesToAST() {
        let source = "```swift\nlet value = "
        let renderer = MarkdownStreamingRenderer()
        renderer.prefersLightweightTail = true

        guard case .full(let tail) = renderer.update(text: source, typography: typography) else {
            return XCTFail("initial streaming update should be full")
        }
        XCTAssertTrue(tail.string.contains("let value = "))
        XCTAssertFalse(tail.string.contains("```"))

        renderer.prefersLightweightTail = false
        guard case .full(let settled) = renderer.reset(text: source, typography: typography) else {
            return XCTFail("settling should rebuild the exact AST renderer")
        }
        XCTAssertTrue(settled.string.hasPrefix("swift\nlet value = "))
        XCTAssertFalse(settled.string.contains("```"))
    }

    func testMalformedMarkdownRemainsVisibleAndCopyable() {
        let source = "[broken]( and **unfinished\n\n| not | a table\nplain"
        let blocks = MarkdownTextView.parse(source)
        XCTAssertFalse(blocks.isEmpty)

        let content = MarkdownSelectionContent.attributedString(for: blocks, typography: typography)
        XCTAssertTrue(content.string.contains("broken"))
        XCTAssertTrue(content.string.contains("unfinished"))
        XCTAssertTrue(content.string.contains("not"))
    }
}
