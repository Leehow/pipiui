import XCTest
@testable import PipiUI

final class SessionSubtitleLogicTests: XCTestCase {
    private func userItem(_ text: String) -> ChatItem {
        ChatItem(id: text, role: "user", blocks: [.text(text)])
    }

    func testFirstUserMessageSelectionSkipsSystemAndAssistant() {
        let transcript: [ChatItem] = [
            ChatItem(id: "s", role: "system", blocks: [.text("ignored")]),
            ChatItem(id: "a", role: "assistant", blocks: [.text("answer")]),
            userItem("修复跳转"),
            userItem("第二条消息"),
        ]
        XCTAssertEqual(SessionSubtitleLogic.firstUserMessageText(from: transcript), "修复跳转")
    }

    func testSkipsRuntimeSignalsAndTitleGenerationMarkers() {
        let transcript: [ChatItem] = [
            userItem("[subagent-done] agentId=a"),
            userItem("[worktree-merge-failed] merge failed"),
            userItem("\(ChatSession.sessionTitleJobMarker) generate title"),
            userItem("Write a short session title for this chat"),
            userItem("真实消息"),
        ]
        XCTAssertEqual(SessionSubtitleLogic.firstUserMessageText(from: transcript), "真实消息")
    }

    func testEmptyOrWhitespaceTranscriptFallsBackToNil() {
        XCTAssertNil(SessionSubtitleLogic.firstUserMessageText(from: []))
        XCTAssertNil(SessionSubtitleLogic.firstUserMessageText(from: [userItem("   \n  ")]))
    }

    func testFirstUserMessageTextPreservesFullString() {
        let long = String(repeating: "很长的用户消息内容", count: 50)
        XCTAssertEqual(SessionSubtitleLogic.firstUserMessageText(from: [userItem(long)]), long)
    }

    func testOneLineTruncationAppendsEllipsisAtCap() {
        let long = String(repeating: "x", count: SessionSubtitleLogic.maxCharacters + 1)
        let one = SessionSubtitleLogic.oneLine(long)
        XCTAssertTrue(one.hasSuffix("…"))
        XCTAssertEqual(one.count, SessionSubtitleLogic.maxCharacters + 1)
    }

    func testOneLinePreservesShortTextExactly() {
        let exact = String(repeating: "x", count: SessionSubtitleLogic.maxCharacters)
        XCTAssertEqual(SessionSubtitleLogic.oneLine(exact), exact)
    }

    func testOneLineCollapsesWhitespaceAndNewlines() {
        XCTAssertEqual(SessionSubtitleLogic.oneLine("a\n  b\t c"), "a b c")
        XCTAssertEqual(SessionSubtitleLogic.oneLine(""), "")
    }
}
