import XCTest
@testable import PipiUI

final class SubagentLogLayoutTests: XCTestCase {
    private func item(
        _ id: Int,
        _ kind: String,
        name: String = "",
        text: String = ""
    ) -> AgentLogItem {
        AgentLogItem(id: id, kind: kind, name: name, text: text, isError: false)
    }

    func testConsecutiveToolsAndImmediateResultsFormOneGroup() {
        let read = item(1, "tool", name: "read")
        let readResult = item(2, "toolResult", text: "file")
        let grep = item(3, "tool", name: "grep")
        let grepResult = item(4, "toolResult", text: "match")

        XCTAssertEqual(
            SubagentLogLayout.plan([read, readResult, grep, grepResult]),
            [.toolGroup([read, readResult, grep, grepResult])]
        )
        XCTAssertEqual(
            SubagentLogLayout.summaryTitle(for: [read, readResult, grep, grepResult]),
            "2 steps · read · grep"
        )
    }

    func testThinkingAndTextBreakToolGroupsAndStayInline() {
        let read = item(1, "tool", name: "read")
        let readResult = item(2, "toolResult")
        let thinking = item(3, "thinking", text: "分析")
        let grep = item(4, "tool", name: "grep")
        let grepResult = item(5, "toolResult")
        let text = item(6, "text", text: "结论")
        let edit = item(7, "tool", name: "edit")
        let editResult = item(8, "toolResult")

        XCTAssertEqual(
            SubagentLogLayout.plan([
                read, readResult, thinking, grep, grepResult, text, edit, editResult,
            ]),
            [
                .toolGroup([read, readResult]),
                .item(thinking),
                .toolGroup([grep, grepResult]),
                .item(text),
                .toolGroup([edit, editResult]),
            ]
        )
    }

    func testSingleToolWithoutResultStaysInline() {
        let tool = item(1, "tool", name: "read")
        XCTAssertEqual(SubagentLogLayout.plan([tool]), [.item(tool)])
    }

    func testToolGroupIdentityRemainsFirstItemAsRowsStreamIn() {
        let read = item(10, "tool", name: "read")
        let result = item(11, "toolResult")
        let grep = item(12, "tool", name: "grep")

        XCTAssertEqual(SubagentLogLayout.plan([read, result]).first?.id, 10)
        XCTAssertEqual(SubagentLogLayout.plan([read, result, grep]).first?.id, 10)
    }

    func testCompactDurationBoundaries() {
        XCTAssertEqual(DurationFormat.compact(59), "59s")
        XCTAssertEqual(DurationFormat.compact(60), "1m0s")
        XCTAssertEqual(DurationFormat.compact(3_600), "1h00m")
        XCTAssertEqual(DurationFormat.compact(3_720), "1h02m")
    }

    func testTurnElapsedDurationBoundaries() {
        XCTAssertEqual(TurnDurationFormat.elapsed(8), "8s")
        XCTAssertEqual(TurnDurationFormat.elapsed(187), "3min07s")
        XCTAssertEqual(TurnDurationFormat.elapsed(81_469), "22h37min49s")
    }
}
