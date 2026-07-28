import Foundation
import XCTest

final class TranscriptSelectionOverlayTests: XCTestCase {
    private var repositoryRoot: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    private func source(_ relativePath: String) throws -> String {
        try String(
            contentsOf: repositoryRoot.appendingPathComponent(relativePath),
            encoding: .utf8
        )
    }

    /// Source slice from `startMarker` up to (not including) the first later
    /// occurrence of `endMarker`. Mirrors the helper in
    /// `FinishedNonTextGroupPresentationTests` so both tests reason about the same
    /// structural sections of MessageViews.swift.
    private func section(
        named startMarker: String,
        endingAt endMarker: String,
        in source: String
    ) throws -> String {
        let start = try XCTUnwrap(source.range(of: startMarker)?.lowerBound)
        let end = try XCTUnwrap(
            source.range(of: endMarker, range: start..<source.endIndex)?.lowerBound
        )
        return String(source[start..<end])
    }

    private func matchCount(
        _ regex: NSRegularExpression,
        in contents: String
    ) -> Int {
        let range = NSRange(contents.startIndex..<contents.endIndex, in: contents)
        return regex.numberOfMatches(in: contents, range: range)
    }

    func testTranscriptHotPathDoesNotInstallSwiftUISelectionOverlay() throws {
        let modifier = try NSRegularExpression(
            pattern: #"\.textSelection\s*\(\s*\.enabled\s*\)"#
        )

        // MarkdownView and PathLinkedText are the per-message transcript text
        // primitives. They must keep using native selection (SelectableMarkdownTextView)
        // and the whole-text copy button, never SwiftUI's `.textSelection` overlay,
        // which is too costly to install on every transcript bubble.
        for relativePath in [
            "Sources/PipiUI/Views/MarkdownView.swift",
            "Sources/PipiUI/Views/PathLinkedText.swift",
        ] {
            let contents = try source(relativePath)
            XCTAssertEqual(
                matchCount(modifier, in: contents),
                0,
                "\(relativePath) must not install SwiftUI .textSelection on the transcript hot path."
            )
        }

        // MessageViews.swift renders the per-message transcript and also hosts the
        // on-demand FileChangeDiffInspector. SwiftUI selection is permitted only inside
        // that dedicated, bounded detail view (so users can select/copy diff lines); it
        // must never leak into the per-message transcript rendering. The inspector is
        // intentionally colocated in MessageViews.swift — see
        // FinishedNonTextGroupPresentationTests, which counts its ScrollView as one of
        // the detached detail view's two scrollers.
        let messages = try source("Sources/PipiUI/Views/MessageViews.swift")
        let inspector = try section(
            named: "struct FileChangeDiffInspector: View",
            endingAt: "struct WaitingPlaceholderView: View",
            in: messages
        )
        let fileCount = matchCount(modifier, in: messages)
        let inspectorCount = matchCount(modifier, in: inspector)
        XCTAssertEqual(
            fileCount,
            inspectorCount,
            "SwiftUI .textSelection(.enabled) in MessageViews.swift must live only inside FileChangeDiffInspector, not the transcript hot path."
        )
        XCTAssertGreaterThanOrEqual(
            inspectorCount,
            1,
            "FileChangeDiffInspector must keep its diff content selectable so users can copy diff lines."
        )
    }

    func testAssistantMarkdownStillUsesNativeSelectableTextView() throws {
        let markdown = try source(
            "Sources/PipiUI/Views/MarkdownView.swift"
        )
        let messages = try source(
            "Sources/PipiUI/Views/MessageViews.swift"
        )

        XCTAssertTrue(markdown.contains(
            "SelectableMarkdownTextView("
        ))
        XCTAssertTrue(markdown.contains(
            "textView.isSelectable = true"
        ))
        XCTAssertTrue(messages.contains(
            "MarkdownTextView(text: text, onFlash: onFlash)"
        ))
    }

    func testPathLinkedTextRetainsWholeTextCopyWithoutSelectionOverlay() throws {
        let pathLinked = try source(
            "Sources/PipiUI/Views/PathLinkedText.swift"
        )

        XCTAssertTrue(pathLinked.contains("Button(\"复制\")"))
        XCTAssertTrue(pathLinked.contains(
            "NSPasteboard.general.setString(plainText"
        ))
    }
}
