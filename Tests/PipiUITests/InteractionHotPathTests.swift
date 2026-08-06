import XCTest
@testable import PipiUI

final class InteractionHotPathTests: XCTestCase {
    func testMarkdownHoverCursorKeepsTextCheapAndPreservesLinks() {
        XCTAssertEqual(
            MarkdownHoverCursorKind.resolve(
                commandDown: false,
                hasPath: false,
                hasAttributedLink: false
            ),
            .text
        )
        XCTAssertEqual(
            MarkdownHoverCursorKind.resolve(
                commandDown: true,
                hasPath: true,
                hasAttributedLink: false
            ),
            .pointingHand
        )
        XCTAssertEqual(
            MarkdownHoverCursorKind.resolve(
                commandDown: false,
                hasPath: false,
                hasAttributedLink: true
            ),
            .pointingHand
        )
    }

    func testMarkdownMouseMovedHotPathDoesNotForwardToNSTextView() throws {
        let source = try source(named: "MarkdownView.swift")
        XCTAssertTrue(source.contains("override func mouseMoved(with event: NSEvent)"))
        XCTAssertFalse(
            source.contains("super.mouseMoved(with: event)"),
            "Ordinary hover must not enter NSTextView.mouseMoved/windowNumberAtPoint"
        )
        XCTAssertTrue(source.contains("NSCursor.iBeam.set()"))
        XCTAssertTrue(source.contains("hasAttributedLink(atCharacterIndex:"))
    }

    func testComposerNativeHostIsScopedToSessionIdentity() throws {
        let source = try source(named: "InputBar.swift")
        XCTAssertTrue(
            source.contains(".id(ObjectIdentifier(session))"),
            "A real session switch must replace the native editor/IME context"
        )
    }

    func testComposerMouseMovedHotPathDoesNotForwardToNSTextView() throws {
        let source = try source(named: "InputBar.swift")
        guard let composerRange = source.range(of: "final class ComposerNSTextView: NSTextView"),
              let nextTypeRange = source.range(
                  of: "final class ComposerPlaceholderLabel",
                  range: composerRange.lowerBound..<source.endIndex
              ) else {
            return XCTFail("ComposerNSTextView definition is missing")
        }
        let composerSource = String(source[composerRange.lowerBound..<nextTypeRange.lowerBound])

        XCTAssertTrue(composerSource.contains("override func mouseMoved(with event: NSEvent)"))
        XCTAssertTrue(composerSource.contains("NSCursor.iBeam.set()"))
        XCTAssertFalse(
            composerSource.contains("super.mouseMoved(with: event)"),
            "Composer hover must not enter NSTextView.mouseMoved/sharing-service lookup"
        )
    }

    private func source(named name: String) throws -> String {
        let repositoryRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        return try String(
            contentsOf: repositoryRoot
                .appendingPathComponent("Sources/PipiUI/Views")
                .appendingPathComponent(name),
            encoding: .utf8
        )
    }
}
