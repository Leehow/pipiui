import XCTest
@testable import PipiUI

final class UserMessageCollapseTests: XCTestCase {

    // MARK: - shouldCollapse

    func testShortTextDoesNotCollapse() {
        let text = (0..<5).map { "line\($0)" }.joined(separator: "\n")
        XCTAssertFalse(UserMessageCollapse.shouldCollapse(text))
    }

    func testSixLinesCollapses() {
        let text = (0..<6).map { "line\($0)" }.joined(separator: "\n")
        XCTAssertTrue(UserMessageCollapse.shouldCollapse(text))
    }

    func testOver1000CharsCollapsesEvenOneLine() {
        let text = String(repeating: "a", count: 1001)
        XCTAssertTrue(UserMessageCollapse.shouldCollapse(text))
    }

    func testExactly1000CharsAndFiveLinesDoesNotCollapse() {
        // 5 short lines under char limit
        let text = (0..<5).map { "\($0)" }.joined(separator: "\n")
        XCTAssertFalse(UserMessageCollapse.shouldCollapse(text))
        let oneLine = String(repeating: "b", count: 1000)
        XCTAssertFalse(UserMessageCollapse.shouldCollapse(oneLine))
    }

    // MARK: - preview

    func testPreviewKeepsFirstFiveLines() {
        let text = (0..<10).map { "L\($0)" }.joined(separator: "\n")
        let preview = UserMessageCollapse.preview(text)
        XCTAssertEqual(preview, "L0\nL1\nL2\nL3\nL4")
    }

    func testPreviewHardCapsCharacters() {
        let longLine = String(repeating: "x", count: 500)
        let preview = UserMessageCollapse.preview(longLine, maxLines: 5, maxChars: 400)
        XCTAssertEqual(preview.count, 400)
        XCTAssertTrue(preview.allSatisfy { $0 == "x" })
    }

    func testPreviewAppliesCharCapAfterLineTrim() {
        let lines = (0..<6).map { _ in String(repeating: "y", count: 100) }.joined(separator: "\n")
        let preview = UserMessageCollapse.preview(lines, maxLines: 5, maxChars: 400)
        // 5 lines of 100 + 4 newlines = 504 → capped to 400
        XCTAssertEqual(preview.count, 400)
        XCTAssertFalse(preview.contains("\n\n")) // still a prefix of the joined first 5 lines
        let expectedPrefix = (0..<5).map { _ in String(repeating: "y", count: 100) }.joined(separator: "\n")
        XCTAssertTrue(expectedPrefix.hasPrefix(preview) || preview == String(expectedPrefix.prefix(400)))
        XCTAssertEqual(preview, String(expectedPrefix.prefix(400)))
    }

    func testPreviewOfShortTextIsIdentity() {
        let text = "hello\nworld"
        XCTAssertEqual(UserMessageCollapse.preview(text), text)
    }
}
