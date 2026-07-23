import XCTest
import PipiUI

final class SessionTitleLogicTests: XCTestCase {
    func testParseStripsQuotesAndLabel() {
        XCTAssertEqual(SessionTitleLogic.parseModelTitle("「侧栏品牌与会话标题」"), "侧栏品牌与会话标题")
        XCTAssertEqual(SessionTitleLogic.parseModelTitle("标题：Foo bar"), "Foo bar")
        XCTAssertEqual(SessionTitleLogic.parseModelTitle("Title: Hello\nmore"), "Hello")
    }

    func testParseRejectsEmptyAndTooLong() {
        XCTAssertNil(SessionTitleLogic.parseModelTitle("   "))
        XCTAssertNil(SessionTitleLogic.parseModelTitle(String(repeating: "字", count: 41)))
    }

    func testPlaceholder() {
        XCTAssertTrue(SessionTitleLogic.isPlaceholderName(nil))
        XCTAssertTrue(SessionTitleLogic.isPlaceholderName("新会话"))
        XCTAssertTrue(SessionTitleLogic.isPlaceholderName("  "))
        XCTAssertFalse(SessionTitleLogic.isPlaceholderName("侧栏标题"))
    }

    func testProvisionalTitleCJK() {
        let long = "修复会话自动标题显示ISO日期文件名而不是真实标题的问题需要尽快处理"
        let t = SessionTitleLogic.provisionalTitle(from: long)
        XCTAssertNotNil(t)
        XCTAssertLessThanOrEqual(t!.count, 16)
        XCTAssertTrue(long.hasPrefix(t!))

        let punct = "侧栏品牌与会话标题。继续很长的说明文字不该进入标题"
        let p = SessionTitleLogic.provisionalTitle(from: punct)
        XCTAssertEqual(p, "侧栏品牌与会话标题")
    }

    func testProvisionalTitleEnglishAndFilters() {
        let eng = SessionTitleLogic.provisionalTitle(from: "Fix session auto title showing ISO date filenames instead of real titles please")
        XCTAssertNotNil(eng)
        XCTAssertLessThanOrEqual(eng!.count, 24)
        XCTAssertTrue(eng!.lowercased().contains("fix") || eng!.lowercased().hasPrefix("Fix"))

        XCTAssertNil(SessionTitleLogic.provisionalTitle(from: "   "))
        XCTAssertNil(SessionTitleLogic.provisionalTitle(from: "[PipiUI internal — session title] ignore"))

        // Avoid greeting fillers ("hello ") — attachment strip should keep the real prose.
        let withAttach = "sidebar title fix\nAttached image file: /tmp/x.png"
        XCTAssertEqual(SessionTitleLogic.provisionalTitle(from: withAttach), "sidebar title fix")
    }

    func testIsJunkAutoTitle() {
        XCTAssertTrue(SessionTitleLogic.isJunkAutoTitle(""))
        XCTAssertTrue(SessionTitleLogic.isJunkAutoTitle("新会话"))
        XCTAssertTrue(SessionTitleLogic.isJunkAutoTitle("2026-07-23T15-31-40-489Z_019f8f9a-abc"))
        XCTAssertTrue(SessionTitleLogic.isJunkAutoTitle("path/to/session"))
        XCTAssertTrue(SessionTitleLogic.isJunkAutoTitle("foo.jsonl"))
        XCTAssertTrue(SessionTitleLogic.isJunkAutoTitle("docs/readme"))
        XCTAssertTrue(SessionTitleLogic.isJunkAutoTitle("contains PipiUI internal marker"))
        XCTAssertTrue(SessionTitleLogic.isJunkAutoTitle(String(repeating: "a", count: 41)))
        XCTAssertTrue(SessionTitleLogic.isJunkAutoTitle("**bold title**"))
        XCTAssertTrue(SessionTitleLogic.isJunkAutoTitle("# Heading"))
        XCTAssertTrue(SessionTitleLogic.isJunkAutoTitle("Write a short session title for this user message"))
        XCTAssertTrue(SessionTitleLogic.isJunkAutoTitle("Write a short session title"))
        XCTAssertFalse(SessionTitleLogic.isJunkAutoTitle("侧栏标题"))
        XCTAssertFalse(SessionTitleLogic.isJunkAutoTitle("Fix auto title"))
    }

    func testProvisionalTitleStripsLeadingFillerCJK() {
        let t1 = SessionTitleLogic.provisionalTitle(from: "有个问题，我的窗口会频繁切换")
        XCTAssertNotNil(t1)
        XCTAssertFalse(t1!.hasPrefix("有个问题"), "should strip filler prefix, got: \(t1!)")
        XCTAssertTrue(t1!.hasPrefix("我的窗口") || t1!.contains("窗口"), "expected substance about window, got: \(t1!)")

        let t2 = SessionTitleLogic.provisionalTitle(from: "请问一下，已归档的会话怎么折叠")
        XCTAssertNotNil(t2)
        XCTAssertFalse(t2!.hasPrefix("请问"), "should strip 请问 filler, got: \(t2!)")
        XCTAssertTrue(t2!.contains("归档") || t2!.hasPrefix("已归档"), "expected substance about archive, got: \(t2!)")
    }

    func testProvisionalTitleRejectsTooShortAndFillerOnly() {
        XCTAssertNil(SessionTitleLogic.provisionalTitle(from: "A"))
        XCTAssertNil(SessionTitleLogic.provisionalTitle(from: "b"))
        XCTAssertNil(SessionTitleLogic.provisionalTitle(from: "hi"))
    }

    func testIsJunkAutoTitleSingleCharAndContinue() {
        XCTAssertTrue(SessionTitleLogic.isJunkAutoTitle("A"))
        XCTAssertTrue(SessionTitleLogic.isJunkAutoTitle("b"))
        XCTAssertFalse(SessionTitleLogic.isJunkAutoTitle("继续"))
        XCTAssertTrue(SessionTitleLogic.isJunkAutoTitle("新会话"))
    }

    func testProvisionalTitleEnglishRegressionWithTrailingPlease() {
        let eng = SessionTitleLogic.provisionalTitle(from: "Fix session auto title showing ISO date filenames instead of real titles please")
        XCTAssertNotNil(eng)
        XCTAssertLessThanOrEqual(eng!.count, 24)
        XCTAssertTrue(eng!.lowercased().contains("fix") || eng!.lowercased().hasPrefix("fix"))
    }

    func testTitlePromptFingerprintStable() {
        XCTAssertEqual(
            SessionTitleClient.titlePromptFingerprint,
            "Write a short session title for this user message"
        )
    }

    func testParseRejectsJunk() {
        XCTAssertNil(SessionTitleLogic.parseModelTitle("2026-07-23T15-31-40-489Z_x"))
        XCTAssertNil(SessionTitleLogic.parseModelTitle("# not a title"))
        XCTAssertNil(SessionTitleLogic.parseModelTitle("path/to/x"))
        XCTAssertEqual(SessionTitleLogic.parseModelTitle("好标题"), "好标题")
    }

    func testTruncateUserMessageForPrompt() {
        XCTAssertEqual(SessionTitleClient.truncateUserMessageForPrompt("  hi  "), "hi")
        XCTAssertEqual(SessionTitleClient.truncateUserMessageForPrompt("short"), "short")
        let long = String(repeating: "a", count: 600)
        let t = SessionTitleClient.truncateUserMessageForPrompt(long, maxChars: 500)
        XCTAssertEqual(t.count, 500)
        XCTAssertTrue(long.hasPrefix(t))
        XCTAssertEqual(SessionTitleClient.truncateUserMessageForPrompt(""), "")
    }
}
