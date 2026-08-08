import XCTest
@testable import PipiUI

final class StreamingTerminalTextViewTests: XCTestCase {

    // MARK: - ANSI strip

    func testStripCSIColorSequences() {
        let raw = "\u{1B}[31mred\u{1B}[0m plain"
        XCTAssertEqual(TerminalOutputSanitizer.stripANSI(raw), "red plain")
    }

    func testStripOSCTitleSequences() {
        let raw = "\u{1B}]0;window title\u{07}hello"
        XCTAssertEqual(TerminalOutputSanitizer.stripANSI(raw), "hello")
    }

    func testStripOSCTerminatedByST() {
        let raw = "\u{1B}]8;;https://example.com\u{1B}\\link"
        XCTAssertEqual(TerminalOutputSanitizer.stripANSI(raw), "link")
    }

    func testStripEightBitCSI() {
        // C1 CSI = U+009B
        let raw = "\u{9B}1;32mgreen\u{9B}0m"
        XCTAssertEqual(TerminalOutputSanitizer.stripANSI(raw), "green")
    }

    func testStripLeavesPlainTextUntouched() {
        let plain = "line one\nline two"
        XCTAssertEqual(TerminalOutputSanitizer.stripANSI(plain), plain)
    }

    func testMalformedESCDoesNotDropFollowingContent() {
        // ESC followed by an unknown letter: drop ESC, keep the rest.
        let raw = "pre\u{1B}Xpost"
        XCTAssertEqual(TerminalOutputSanitizer.stripANSI(raw), "preXpost")
    }

    // MARK: - Carriage return

    func testCarriageReturnOverwritesCurrentLine() {
        let raw = "progress 10%\rprogress 20%\rprogress 100%\n done"
        XCTAssertEqual(
            TerminalOutputSanitizer.applyCarriageReturns(raw),
            "progress 100%\n done"
        )
    }

    func testCRLFRemainsNormalNewline() {
        let raw = "one\r\ntwo\r\nthree"
        XCTAssertEqual(
            TerminalOutputSanitizer.applyCarriageReturns(raw),
            "one\ntwo\nthree"
        )
    }

    func testBareCRWithoutFollowingContentClearsLine() {
        let raw = "partial\r"
        XCTAssertEqual(TerminalOutputSanitizer.applyCarriageReturns(raw), "")
    }

    func testMixedNewlinesAndCR() {
        let raw = "a\nb\rc\nd"
        XCTAssertEqual(
            TerminalOutputSanitizer.applyCarriageReturns(raw),
            "a\nc\nd"
        )
    }

    // MARK: - Full display pipeline

    func testDisplayTextStripsANSIThenAppliesCR() {
        let raw = "\u{1B}[32mok\u{1B}[0m 10%\r\u{1B}[32mok\u{1B}[0m 100%\n"
        XCTAssertEqual(
            TerminalOutputSanitizer.displayText(from: raw),
            "ok 100%\n"
        )
    }

    func testDisplayTextTailBoundsHugeOutput() {
        let huge = String(repeating: "x", count: TerminalOutputSanitizer.displayUTF16Limit + 5_000)
        let display = TerminalOutputSanitizer.displayText(from: huge)
        XCTAssertLessThanOrEqual(
            display.utf16.count,
            TerminalOutputSanitizer.displayUTF16Limit + 200 // note overhead
        )
        XCTAssertTrue(display.contains("Output truncated for display"))
        XCTAssertTrue(display.hasSuffix(String(repeating: "x", count: 100)))
    }

    // MARK: - Incremental diff helper

    func testCommonUTF16PrefixLengthASCII() {
        let a = "hello world" as NSString
        let b = "hello there" as NSString
        XCTAssertEqual(
            StreamingTerminalTextView.Coordinator.commonUTF16PrefixLength(a, b),
            6
        )
    }

    func testCommonUTF16PrefixLengthUnicode() {
        let a = "你好世界" as NSString
        let b = "你好朋友" as NSString
        // 你=1 utf16, 好=1 utf16 → common 2
        XCTAssertEqual(
            StreamingTerminalTextView.Coordinator.commonUTF16PrefixLength(a, b),
            2
        )
    }

    func testCommonUTF16PrefixWhenEqual() {
        let a = "same" as NSString
        XCTAssertEqual(
            StreamingTerminalTextView.Coordinator.commonUTF16PrefixLength(a, a),
            4
        )
    }

    func testCommonUTF16PrefixWhenDivergesImmediately() {
        let a = "abc" as NSString
        let b = "xyz" as NSString
        XCTAssertEqual(
            StreamingTerminalTextView.Coordinator.commonUTF16PrefixLength(a, b),
            0
        )
    }
}
