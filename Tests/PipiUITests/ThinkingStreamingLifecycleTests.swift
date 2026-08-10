import XCTest
@testable import PipiUI

final class ThinkingStreamingLifecycleTests: XCTestCase {
    private func makeSession() -> ChatSession {
        ChatSession(
            id: UUID().uuidString,
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: nil,
            blockedReason: "test-only"
        )
    }

    private func startEvent() -> J {
        J([
            "type": "message_start",
            "message": ["role": "assistant", "content": [] as [Any]],
        ])
    }

    private func delta(_ event: [String: Any]) -> J {
        J(["type": "message_update", "assistantMessageEvent": event])
    }

    private func thinkingTexts(_ item: ChatItem) -> [String] {
        item.blocks.compactMap { block in
            guard case .thinking(let text) = block else { return nil }
            return text
        }
    }

    func testManyThinkingSegmentsMergeInOrderIntoOneLiveCard() throws {
        let session = makeSession()
        session.handleEvent(startEvent())

        for index in 0..<12 {
            session.handleEvent(delta(["type": "thinking_start", "contentIndex": index]))
            session.handleEvent(delta([
                "type": "thinking_delta", "contentIndex": index, "delta": "segment-\(index)",
            ]))
            if index < 11 {
                session.handleEvent(delta(["type": "thinking_end", "contentIndex": index]))
            }
        }
        session.materializeStreamingForSnapshot()

        let item = try XCTUnwrap(session.streamingItem)
        XCTAssertEqual(thinkingTexts(item), (0..<12).map { "segment-\($0)" })
        XCTAssertEqual(item.activeThinkingBlockIndex, 11)

        let plan = AssistantBlockLayout.plan(blocks: item.blocks, groupFinished: false)
        let merged = try XCTUnwrap(AssistantSegmentsView.mergedStreamingThinking(in: plan))
        XCTAssertEqual(merged.firstSegmentIndex, 0)
        XCTAssertEqual(merged.text, (0..<12).map { "segment-\($0)" }.joined(separator: "\n\n"))
        XCTAssertEqual(
            ThinkingTokenEstimate.labelSuffix(for: merged.text),
            ThinkingTokenEstimate.labelSuffix(for: (0..<12).map { "segment-\($0)" }.joined(separator: "\n\n"))
        )
    }

    func testThinkingActiveLifecycleClosesOnEndAndBodyTextAndTurnCompletion() throws {
        let session = makeSession()
        session.handleEvent(startEvent())
        session.handleEvent(delta(["type": "thinking_start", "contentIndex": 0]))
        session.handleEvent(delta(["type": "thinking_delta", "contentIndex": 0, "delta": "first"]))
        session.materializeStreamingForSnapshot()
        XCTAssertEqual(session.streamingItem?.activeThinkingBlockIndex, 0)

        session.handleEvent(delta(["type": "thinking_end", "contentIndex": 0]))
        session.materializeStreamingForSnapshot()
        XCTAssertNil(session.streamingItem?.activeThinkingBlockIndex)

        session.handleEvent(delta(["type": "thinking_start", "contentIndex": 1]))
        session.handleEvent(delta(["type": "thinking_delta", "contentIndex": 1, "delta": "second"]))
        session.materializeStreamingForSnapshot()
        let secondActive = try XCTUnwrap(session.streamingItem)
        XCTAssertEqual(secondActive.activeThinkingBlockIndex, 1)
        XCTAssertEqual(thinkingTexts(secondActive), ["first", "second"])

        session.handleEvent(delta(["type": "text_start", "contentIndex": 2]))
        session.handleEvent(delta(["type": "text_delta", "contentIndex": 2, "delta": "answer"]))
        session.materializeStreamingForSnapshot()
        XCTAssertNil(session.streamingItem?.activeThinkingBlockIndex)

        // Even an out-of-order later thinking event cannot reactivate after body text.
        session.handleEvent(delta(["type": "thinking_start", "contentIndex": 3]))
        session.handleEvent(delta(["type": "thinking_delta", "contentIndex": 3, "delta": "late"]))
        session.materializeStreamingForSnapshot()
        XCTAssertNil(session.streamingItem?.activeThinkingBlockIndex)

        session.handleEvent(J([
            "type": "message_end",
            "message": ["role": "assistant", "content": "answer"],
        ]))
        XCTAssertNil(session.streamingItem)
    }

    func testMergedThinkingIsIsolatedPerAssistantItem() throws {
        let first = ChatItem(
            id: "turn-1",
            role: "assistant",
            blocks: [
                .thinking("one"),
                .toolCall(ToolCallBlock(id: "tool-1", name: "read", argsSummary: "file")),
                .thinking("two"),
                .text("answer"),
            ],
            activeThinkingBlockIndex: 2
        )
        let second = ChatItem(
            id: "turn-2",
            role: "assistant",
            blocks: [
                .thinking("three"),
                .text("other answer"),
                .thinking("four"),
            ],
            activeThinkingBlockIndex: 2
        )

        let firstMerged = try XCTUnwrap(AssistantSegmentsView.mergedStreamingThinking(
            in: AssistantBlockLayout.plan(blocks: first.blocks, groupFinished: false)
        ))
        let secondMerged = try XCTUnwrap(AssistantSegmentsView.mergedStreamingThinking(
            in: AssistantBlockLayout.plan(blocks: second.blocks, groupFinished: false)
        ))
        XCTAssertEqual(firstMerged.text, "one\n\ntwo")
        XCTAssertEqual(secondMerged.text, "three\n\nfour")
        XCTAssertFalse(firstMerged.text.contains("three"))
        XCTAssertFalse(secondMerged.text.contains("one"))
    }
}
