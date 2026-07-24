import XCTest
@testable import PipiUI

final class AssistantBlockLayoutTests: XCTestCase {

    private func tool(_ id: String, _ name: String) -> ChatBlock {
        .toolCall(ToolCallBlock(id: id, name: name, argsSummary: "args"))
    }

    func testStreamingKeepsIndividuals() {
        let blocks: [ChatBlock] = [
            .thinking("a"),
            tool("1", "read"),
            tool("2", "bash"),
            .text("hello"),
        ]
        let plan = AssistantBlockLayout.plan(blocks: blocks, groupFinished: false)
        XCTAssertEqual(plan, [
            .singleton(.thinking("a")),
            .singleton(tool("1", "read")),
            .singleton(tool("2", "bash")),
            .text("hello"),
        ])
    }

    func testFinishedGroupsConsecutiveNonTextBetweenText() {
        let blocks: [ChatBlock] = [
            .thinking("a"),
            tool("1", "read"),
            tool("2", "read"),
            .text("说明"),
            tool("3", "bash"),
            tool("4", "edit"),
            .text("结尾"),
        ]
        let plan = AssistantBlockLayout.plan(blocks: blocks, groupFinished: true)
        XCTAssertEqual(plan, [
            .finishedGroup([.thinking("a"), tool("1", "read"), tool("2", "read")]),
            .text("说明"),
            .finishedGroup([tool("3", "bash"), tool("4", "edit")]),
            .text("结尾"),
        ])
    }

    func testSingleFinishedItemStaysSingleton() {
        let blocks: [ChatBlock] = [
            .text("hi"),
            tool("1", "read"),
            .text("bye"),
        ]
        let plan = AssistantBlockLayout.plan(blocks: blocks, groupFinished: true)
        XCTAssertEqual(plan, [
            .text("hi"),
            .singleton(tool("1", "read")),
            .text("bye"),
        ])
    }

    func testImageBreaksGroup() {
        let img = ImageBlock(id: "img", data: Data([0x1]), mimeType: "image/png")
        let blocks: [ChatBlock] = [
            tool("1", "read"),
            tool("2", "bash"),
            .image(img),
            tool("3", "edit"),
            tool("4", "read"),
        ]
        let plan = AssistantBlockLayout.plan(blocks: blocks, groupFinished: true)
        XCTAssertEqual(plan, [
            .finishedGroup([tool("1", "read"), tool("2", "bash")]),
            .image(img),
            .finishedGroup([tool("3", "edit"), tool("4", "read")]),
        ])
    }

    func testMergesAdjacentTextBeforePlanning() {
        let blocks: [ChatBlock] = [
            .text("a"),
            .text("b"),
            tool("1", "read"),
            tool("2", "bash"),
        ]
        let plan = AssistantBlockLayout.plan(blocks: blocks, groupFinished: true)
        XCTAssertEqual(plan, [
            .text("a\n\nb"),
            .finishedGroup([tool("1", "read"), tool("2", "bash")]),
        ])
    }

    func testSummaryTitle() {
        let blocks: [ChatBlock] = [
            .thinking("x"),
            tool("1", "read"),
            tool("2", "bash"),
        ]
        XCTAssertEqual(
            AssistantBlockLayout.summaryTitle(for: blocks),
            "3 steps · Thinking · read · bash"
        )
    }

    /// pi 每个 tool 回合是一条 assistant message；文字之间应跨消息收成一个大包。
    func testTranscriptCoalescesConsecutiveAssistantNonTextBetweenText() {
        let items: [ChatItem] = [
            ChatItem(id: "a1", role: "assistant", blocks: [
                .text("目标"),
                .thinking("t1"),
                tool("1", "bash"),
            ]),
            ChatItem(id: "a2", role: "assistant", blocks: [
                .thinking("t2"),
                tool("2", "bash"),
            ]),
            ChatItem(id: "a3", role: "assistant", blocks: [
                tool("3", "read"),
            ]),
            ChatItem(id: "a4", role: "assistant", blocks: [
                .thinking("t3"),
                tool("4", "bash"),
                .text("结论"),
            ]),
        ]
        let rows = AssistantBlockLayout.planTranscript(items: items)
        XCTAssertEqual(rows.count, 1)
        guard case .assistantRun(let id, let segments)? = rows.first else {
            return XCTFail("expected one assistant run")
        }
        XCTAssertEqual(id, "a4")
        XCTAssertEqual(segments, [
            .text("目标"),
            .finishedGroup([
                .thinking("t1"), tool("1", "bash"),
                .thinking("t2"), tool("2", "bash"),
                tool("3", "read"),
                .thinking("t3"), tool("4", "bash"),
            ]),
            .text("结论"),
        ])
    }

    func testTranscriptUserBreaksAssistantCoalesce() {
        let items: [ChatItem] = [
            ChatItem(id: "a1", role: "assistant", blocks: [
                .thinking("t1"),
                tool("1", "bash"),
            ]),
            ChatItem(id: "u1", role: "user", blocks: [.text("继续")]),
            ChatItem(id: "a2", role: "assistant", blocks: [
                .thinking("t2"),
                tool("2", "read"),
            ]),
        ]
        let rows = AssistantBlockLayout.planTranscript(items: items)
        XCTAssertEqual(rows.count, 3)
        guard case .assistantRun(_, let s1) = rows[0] else {
            return XCTFail("row0")
        }
        XCTAssertEqual(s1, [.finishedGroup([.thinking("t1"), tool("1", "bash")])])
        guard case .leaf(let user) = rows[1] else {
            return XCTFail("row1")
        }
        XCTAssertEqual(user.id, "u1")
        guard case .assistantRun(_, let s2) = rows[2] else {
            return XCTFail("row2")
        }
        XCTAssertEqual(s2, [.finishedGroup([.thinking("t2"), tool("2", "read")])])
    }
}
