import XCTest
@testable import PipiUI

final class ToolCallHealthTests: XCTestCase {

    // MARK: - Helpers

    private func user(_ text: String = "do it") -> ChatItem {
        ChatItem(id: UUID().uuidString, role: "user", blocks: [.text(text)])
    }

    private func assistant(_ blocks: [ChatBlock]) -> ChatItem {
        ChatItem(id: UUID().uuidString, role: "assistant", blocks: blocks)
    }

    private func call(_ name: String) -> ChatBlock {
        .toolCall(ToolCallBlock(
            id: UUID().uuidString,
            name: name,
            argsSummary: "",
            durationSeconds: 1
        ))
    }

    // MARK: - Rounds

    func testRoundIsDelimitedByUserMessagesNotByItems() {
        // The shape of every ordinary agent turn: calls first, prose last. Counting
        // per item would call the closing prose item a tool-free round.
        let report = ToolCallHealth.compute(items: [
            user(),
            assistant([call("bash")]),
            assistant([.text("done")]),
        ])
        XCTAssertEqual(report.rounds, 1)
        XCTAssertEqual(report.toolFreeRounds, 0)
        XCTAssertTrue(report.isClean)
    }

    func testToolFreeRoundCounted() {
        let report = ToolCallHealth.compute(items: [
            user(),
            assistant([.text("这个我做不到")]),
        ])
        XCTAssertEqual(report.rounds, 1)
        XCTAssertEqual(report.toolFreeRounds, 1)
        XCTAssertFalse(report.isClean)
    }

    func testMixedRoundsCountedIndependently() {
        let report = ToolCallHealth.compute(items: [
            user(),
            assistant([call("read"), .text("ok")]),
            user(),
            assistant([.thinking("hmm"), .text("no can do")]),
            user(),
            assistant([call("bash")]),
        ])
        XCTAssertEqual(report.rounds, 3)
        XCTAssertEqual(report.toolFreeRounds, 1)
    }

    func testRoundWithNoAssistantBlockIsNotCounted() {
        // A user message still in flight has no round to judge yet.
        let report = ToolCallHealth.compute(items: [user(), user()])
        XCTAssertEqual(report.rounds, 0)
        XCTAssertEqual(report.toolFreeRounds, 0)
        XCTAssertTrue(report.isClean)
    }

    func testAssistantBeforeAnyUserMessageStillFormsARound() {
        let report = ToolCallHealth.compute(items: [assistant([.text("hi")])])
        XCTAssertEqual(report.rounds, 1)
        XCTAssertEqual(report.toolFreeRounds, 1)
    }

    func testEmptyTranscriptIsClean() {
        let report = ToolCallHealth.compute(items: [])
        XCTAssertEqual(report.rounds, 0)
        XCTAssertTrue(report.leakedTokens.isEmpty)
        XCTAssertTrue(report.isClean)
    }

    // MARK: - Leaked control tokens

    func testAsciiSentinelDetected() {
        XCTAssertEqual(
            ToolCallHealth.leakedControlTokens(in: "sure <|DSML|tool_calls|> now"),
            ["<|DSML|tool_calls|>"]
        )
    }

    func testFullwidthSentinelDetected() {
        XCTAssertEqual(
            ToolCallHealth.leakedControlTokens(in: "<｜tool▁calls▁begin｜>"),
            ["<｜tool▁calls▁begin｜>"]
        )
    }

    func testUnknownTokenSpellingStillCaughtAndReportedVerbatim() {
        // The whole point of matching by shape: a spelling nobody has seen yet
        // identifies itself instead of slipping through a registry.
        XCTAssertEqual(
            ToolCallHealth.leakedControlTokens(in: "<|totally_new_marker|>"),
            ["<|totally_new_marker|>"]
        )
    }

    func testMultipleSentinelsInOneTextAllCounted() {
        XCTAssertEqual(
            ToolCallHealth.leakedControlTokens(in: "<|a|> mid <|b|>"),
            ["<|a|>", "<|b|>"]
        )
    }

    func testProseSpanningDelimitersIsNotAToken() {
        let long = String(repeating: "x", count: 80)
        XCTAssertTrue(ToolCallHealth.leakedControlTokens(in: "<|\(long)|>").isEmpty)
    }

    func testNewlineInsideDelimitersIsNotAToken() {
        XCTAssertTrue(ToolCallHealth.leakedControlTokens(in: "<|a\nb|>").isEmpty)
    }

    func testUnclosedDelimiterIsNotAToken() {
        XCTAssertTrue(ToolCallHealth.leakedControlTokens(in: "a <| b c").isEmpty)
    }

    func testLeakedTokensAggregatedAndSortedByCount() {
        let report = ToolCallHealth.compute(items: [
            user(),
            assistant([.text("<|a|> <|b|> <|a|>")]),
            user(),
            assistant([.text("<|a|>"), call("bash")]),
        ])
        XCTAssertEqual(report.leakedTokens.map(\.token), ["<|a|>", "<|b|>"])
        XCTAssertEqual(report.leakedTokens.map(\.count), [3, 1])
        XCTAssertEqual(report.leakedTokenCount, 4)
        XCTAssertFalse(report.isClean)
    }

    func testLeaksAreReadOnlyFromAssistantVisibleText() {
        // A user pasting a token, or the model reasoning about one, is not a leak.
        let report = ToolCallHealth.compute(items: [
            ChatItem(id: "u", role: "user", blocks: [.text("<|pasted|>")]),
            assistant([.thinking("<|internal|>"), call("bash")]),
        ])
        XCTAssertTrue(report.leakedTokens.isEmpty)
        XCTAssertTrue(report.isClean)
    }
}
