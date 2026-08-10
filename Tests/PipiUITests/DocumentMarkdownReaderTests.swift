import AppKit
import XCTest
@testable import PipiUI

final class DocumentMarkdownReaderTests: XCTestCase {
    private let typography = ChatTypography.make(fontSize: ChatTypography.defaultFontSize)

    private func documentContext(_ path: String = "/tmp/pipiui-reader/book/guide.md") -> MarkdownRenderContext {
        MarkdownRenderContext.document(documentURL: URL(fileURLWithPath: path))
    }

    private func linkURL(in content: NSAttributedString, label: String) -> URL? {
        let range = (content.string as NSString).range(of: label)
        guard range.location != NSNotFound else { return nil }
        return content.attribute(.link, at: range.location, effectiveRange: nil) as? URL
    }

    func testContextIsolationKeepsChatImageFallbackAndResolvesDocumentRelativeLinks() {
        let source = "[guide](guide.md) ![diagram](assets/diagram.png)"
        let chat = MarkdownSelectionContent.attributedString(
            for: source,
            typography: typography,
            context: .chat
        )
        let document = MarkdownSelectionContent.attributedString(
            for: source,
            typography: typography,
            context: documentContext()
        )

        XCTAssertEqual(chat.string, "guide [Image: diagram]")
        XCTAssertFalse(linkURL(in: chat, label: "guide")?.isFileURL ?? true)
        XCTAssertNil(chat.attribute(.attachment, at: 0, effectiveRange: nil))

        let expectedGuide = "/tmp/pipiui-reader/book/guide.md"
        XCTAssertEqual(linkURL(in: document, label: "guide")?.absoluteURL.path, expectedGuide)
        XCTAssertEqual(
            linkURL(in: document, label: "[Image: diagram]")?.absoluteURL.path,
            "/tmp/pipiui-reader/book/assets/diagram.png"
        )
        XCTAssertEqual(document.string, "guide [Image: diagram]")
    }

    func testDocumentResolverUsesBaseURLAndFiltersUnsafeSchemes() {
        let context = documentContext("/tmp/pipiui-reader/book/chapters/intro.md")

        XCTAssertEqual(
            MarkdownDocumentResourceResolver.target(for: "next.md", context: context),
            .local(URL(fileURLWithPath: "/tmp/pipiui-reader/book/chapters/next.md"))
        )
        XCTAssertEqual(
            MarkdownDocumentResourceResolver.target(for: "../assets/diagram.png", context: context),
            .local(URL(fileURLWithPath: "/tmp/pipiui-reader/book/assets/diagram.png"))
        )
        XCTAssertEqual(
            MarkdownDocumentResourceResolver.target(for: "/tmp/standalone.txt", context: context),
            .local(URL(fileURLWithPath: "/tmp/standalone.txt"))
        )

        guard case .external(let httpsURL)? = MarkdownDocumentResourceResolver.target(
            for: "https://example.com/docs",
            context: context
        ) else {
            return XCTFail("https should be an approved external target")
        }
        XCTAssertEqual(httpsURL.absoluteString, "https://example.com/docs")

        guard case .external(let mailURL)? = MarkdownDocumentResourceResolver.target(
            for: "mailto:reader@example.com",
            context: context
        ) else {
            return XCTFail("mailto should be an approved external target")
        }
        XCTAssertEqual(mailURL.scheme, "mailto")

        for unsafe in ["javascript:alert(1)", "data:text/html,hello", "ftp://example.com/file", "//example.com/x"] {
            XCTAssertNil(
                MarkdownDocumentResourceResolver.target(for: unsafe, context: context),
                "\(unsafe) must not become a clickable document link"
            )
        }
    }

    func testDocumentLinkActionUsesTabsForDocumentsFinderForOtherLocalFilesAndAllowlistForExternal() {
        XCTAssertEqual(
            MarkdownDocumentResourceResolver.linkAction(
                for: URL(fileURLWithPath: "/tmp/pipiui-reader/next.md")
            ),
            .openDocument(URL(fileURLWithPath: "/tmp/pipiui-reader/next.md"))
        )
        XCTAssertEqual(
            MarkdownDocumentResourceResolver.linkAction(
                for: URL(fileURLWithPath: "/tmp/pipiui-reader/diagram.png")
            ),
            .revealInFinder(URL(fileURLWithPath: "/tmp/pipiui-reader/diagram.png"))
        )
        XCTAssertEqual(
            MarkdownDocumentResourceResolver.linkAction(for: URL(string: "https://example.com")!),
            .openExternal(URL(string: "https://example.com")!)
        )
        XCTAssertEqual(
            MarkdownDocumentResourceResolver.linkAction(for: URL(string: "javascript:alert(1)")!),
            .blocked
        )
    }

    func testDocumentLocalImageUsesBoundedAttachmentAndMissingAssetFallsBackToLinkedAltText() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-markdown-image-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let imageURL = directory.appendingPathComponent("diagram.png")
        let image = NSImage(size: NSSize(width: 1200, height: 600))
        image.lockFocus()
        NSColor.systemBlue.setFill()
        NSBezierPath(rect: NSRect(x: 0, y: 0, width: 1200, height: 600)).fill()
        image.unlockFocus()
        let tiff = try XCTUnwrap(image.tiffRepresentation)
        let bitmap = try XCTUnwrap(NSBitmapImageRep(data: tiff))
        let png = try XCTUnwrap(bitmap.representation(using: .png, properties: [:]))
        try png.write(to: imageURL)

        let context = MarkdownRenderContext.document(
            documentURL: directory.appendingPathComponent("reader.md")
        )
        let embedded = MarkdownSelectionContent.attributedString(
            for: "![diagram](diagram.png)",
            typography: typography,
            context: context
        )
        let attachment = embedded.attribute(.attachment, at: 0, effectiveRange: nil)
            as? MarkdownDocumentImageAttachment
        XCTAssertNotNil(attachment)
        XCTAssertLessThanOrEqual(attachment?.bounds.width ?? .greatestFiniteMagnitude, 560)
        XCTAssertEqual(embedded.string, "\u{FFFC}")

        let fallback = MarkdownSelectionContent.attributedString(
            for: "![missing](missing.png)",
            typography: typography,
            context: context
        )
        XCTAssertEqual(fallback.string, "[Image: missing]")
        XCTAssertEqual(
            linkURL(in: fallback, label: "[Image: missing]")?.absoluteURL.path,
            directory.appendingPathComponent("missing.png").path
        )
    }

    func testDocumentTableUsesASTAlignmentAndReaderVisualTreatment() {
        let source = """
        | Left | Center | Right |
        | :--- | :----: | ---: |
        | x | x | x |
        """
        let blocks = MarkdownTextView.parse(source)
        guard case .table(_, _, let alignments)? = blocks.first else {
            return XCTFail("expected AST table")
        }
        XCTAssertEqual(alignments, [.left, .center, .right])

        let context = documentContext()
        let content = MarkdownSelectionContent.attributedString(
            for: blocks,
            typography: typography,
            context: context
        )
        XCTAssertTrue(content.string.contains("┌"))
        XCTAssertTrue(content.string.contains("│ x    │   x    │     x │"))

        let headerRange = (content.string as NSString).range(of: "Left")
        XCTAssertNotEqual(headerRange.location, NSNotFound)
        XCTAssertNotNil(content.attribute(.backgroundColor, at: headerRange.location, effectiveRange: nil))

        let chatStyle = MarkdownRenderStyle(typography: typography, context: .chat)
        let readerStyle = MarkdownRenderStyle(typography: typography, context: context)
        XCTAssertGreaterThan(readerStyle.headingNSFont(level: 1).pointSize, chatStyle.headingNSFont(level: 1).pointSize)
        XCTAssertGreaterThan(readerStyle.paragraphSpacing, chatStyle.paragraphSpacing)
    }

    func testDocumentPanelWiresDocumentContextAndTabRouting() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let source = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/Views/DocumentPanel.swift"),
            encoding: .utf8
        )

        XCTAssertTrue(source.contains("DocumentTabContent("))
        XCTAssertTrue(source.contains("readerState: readerState"))
        XCTAssertTrue(source.contains("MarkdownRenderContext.document(documentURL: doc.url)"))
        XCTAssertTrue(source.contains("DocumentMarkdownReaderView("))
        XCTAssertTrue(source.contains("onOpenDocument: onOpenDocument"))
        XCTAssertTrue(source.contains("readerState.showFind()"))
        XCTAssertTrue(source.contains("MarkdownDocumentOutline.headings(from: doc.text)"))
        XCTAssertTrue(source.contains("documentReaderMaximumMeasure"))

        let markdown = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/Views/MarkdownView.swift"),
            encoding: .utf8
        )
        XCTAssertTrue(markdown.contains("DocumentReaderScrollRestoration.target("))
        XCTAssertTrue(markdown.contains("scrollRangeToVisible(result)"))
        XCTAssertTrue(markdown.contains("onReaderFind"))
    }

    func testReaderStateIsolatedPerDocumentTab() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-reader-tabs-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let first = directory.appendingPathComponent("first.md")
        let second = directory.appendingPathComponent("second.md")
        try "# First".write(to: first, atomically: true, encoding: .utf8)
        try "# Second".write(to: second, atomically: true, encoding: .utf8)

        let tabs = DocumentTabsStore()
        tabs.open(first)
        let firstID = try XCTUnwrap(tabs.selectedTabID)
        let firstState = try XCTUnwrap(tabs.activeReaderState)
        firstState.captureScrollPosition(DocumentReaderScrollPosition(
            normalizedOffset: 0.72,
            anchorHeadingID: "heading:first#0",
            anchorProgress: 0.4
        ))
        firstState.updateFindQuery("alpha")
        firstState.showFind()

        tabs.open(second)
        let secondID = try XCTUnwrap(tabs.selectedTabID)
        let secondState = try XCTUnwrap(tabs.activeReaderState)
        secondState.updateFindQuery("beta")
        secondState.requestHeadingJump(to: "heading:second#0")

        XCTAssertNotEqual(firstID, secondID)
        XCTAssertEqual(firstState.findQuery, "alpha")
        XCTAssertTrue(firstState.isFindVisible)
        XCTAssertEqual(firstState.scrollPosition.normalizedOffset, 0.72, accuracy: 0.0001)
        XCTAssertEqual(secondState.findQuery, "beta")
        XCTAssertNotEqual(firstState.headingJumpGeneration, secondState.headingJumpGeneration)

        tabs.select(id: firstID)
        XCTAssertTrue(tabs.activeReaderState === firstState)
        tabs.closeTab(id: firstID)
        XCTAssertNil(tabs.readerState(for: firstID))
        XCTAssertTrue(tabs.readerState(for: secondID) === secondState)
    }

    func testReloadRestorationKeepsSemanticHeadingThenFallsBackToNormalizedPosition() {
        let before = MarkdownDocumentOutline.headings(from: """
        # Start
        intro

        ## Keep me
        detail
        """)
        let keep = before.first { $0.title == "Keep me" }!
        let position = DocumentReaderScrollPosition(
            normalizedOffset: 0.63,
            anchorHeadingID: keep.id,
            anchorProgress: 0.45
        )

        let afterEdit = MarkdownDocumentOutline.headings(from: """
        # Start
        inserted content

        ## Keep me
        changed detail
        """)
        XCTAssertEqual(
            DocumentReaderScrollRestoration.target(
                for: position,
                availableHeadings: afterEdit
            ),
            .heading(id: keep.id, progress: 0.45)
        )

        let afterRemoval = MarkdownDocumentOutline.headings(from: "# Start\nreplacement")
        XCTAssertEqual(
            DocumentReaderScrollRestoration.target(
                for: position,
                availableHeadings: afterRemoval
            ),
            .normalized(0.63)
        )
    }

    func testFindStateAndHeadingJumpArePerReaderState() {
        let headings = MarkdownDocumentOutline.headings(from: """
        # Intro *reader*
        ## Details
        ## Details
        """)
        XCTAssertEqual(headings.map(\.title), ["Intro reader", "Details", "Details"])
        XCTAssertEqual(Set(headings.map(\.id)).count, headings.count)
        let rendered = MarkdownSelectionContent.attributedString(
            for: "# Intro *reader*\n## Details\n## Details",
            typography: typography,
            context: documentContext(),
            headingIDs: headings.map(\.id)
        )
        let introRange = (rendered.string as NSString).range(of: "Intro reader")
        XCTAssertEqual(
            rendered.attribute(
                NSAttributedString.Key("PipiUI.DocumentHeadingID"),
                at: introRange.location,
                effectiveRange: nil
            ) as? String,
            headings[0].id
        )

        let first = DocumentReaderState()
        let second = DocumentReaderState()
        first.showFind()
        first.updateFindQuery("reader")
        first.requestHeadingJump(to: headings[1].id)
        second.updateFindQuery("details")
        second.findPrevious()

        XCTAssertTrue(first.isFindVisible)
        XCTAssertEqual(first.findQuery, "reader")
        XCTAssertEqual(first.activeHeadingID, headings[1].id)
        XCTAssertEqual(first.scrollPosition.anchorHeadingID, headings[1].id)
        XCTAssertEqual(second.findQuery, "details")
        XCTAssertFalse(second.isFindVisible)
        XCTAssertEqual(second.findDirection, .previous)
        XCTAssertNotEqual(first.findRequestGeneration, second.findRequestGeneration)
    }
}
