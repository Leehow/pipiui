import XCTest
@testable import PipiUI

final class StreamingVisibilityTests: XCTestCase {
    private final class Visibility {
        var isSelected = false
    }

    private func makeSession(_ id: String = UUID().uuidString) -> ChatSession {
        ChatSession(
            id: id,
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: nil,
            blockedReason: "test-only"
        )
    }

    private func messageUpdate(_ text: String) -> J {
        J([
            "type": "message_update",
            "message": [
                "role": "assistant",
                "content": text,
            ],
        ])
    }

    private func toolUpdate(_ output: String) -> J {
        J([
            "type": "tool_execution_update",
            "toolCallId": "tool-1",
            "partialResult": ["content": output],
        ])
    }

    private func waitForDeferredFlush() {
        let expectation = expectation(description: "stream flush deadline")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
            expectation.fulfill()
        }
        wait(for: [expectation], timeout: 1)
    }

    private func streamText(_ session: ChatSession) -> String? {
        session.streamingItem.map(ChatSession.plainText(of:))
    }

    func testHiddenScheduledFlushRetainsLatestStreamAndToolUpdates() {
        let visibility = Visibility()
        let session = makeSession()
        session.isSelectedCheck = { visibility.isSelected }
        session.streaming.streamingItem = ChatItem(
            id: "streaming", role: "assistant", blocks: [.text("before")]
        )
        session.streaming.updateToolRun(
            ToolRun(isRunning: true, output: "before"),
            for: "tool-1"
        )

        // Queue both coalesced flushes while visible, then switch away before the
        // 50 ms deadline. Neither conversion/publication may occur while hidden.
        visibility.isSelected = true
        session.handleEvent(messageUpdate("stale stream"))
        session.handleEvent(messageUpdate("latest stream"))
        session.handleEvent(toolUpdate("stale tool"))
        session.handleEvent(toolUpdate("latest tool"))
        visibility.isSelected = false
        waitForDeferredFlush()

        XCTAssertEqual(streamText(session), "before")
        XCTAssertEqual(session.toolRuns["tool-1"]?.output, "before")

        // Pending raw data survived the skipped flush and can be materialized later.
        visibility.isSelected = true
        session.flushPendingStreamingForSelection()
        XCTAssertEqual(streamText(session), "latest stream")
        XCTAssertEqual(session.toolRuns["tool-1"]?.output, "latest tool")
    }

    func testMaterializeStreamingForSnapshotAndSnapshotInputUseLatestPendingMessage() {
        let visibility = Visibility()
        let session = makeSession()
        session.isSelectedCheck = { visibility.isSelected }

        // A hidden session schedules no UI flush; explicit snapshot materialization
        // must still reflect the newest raw message.
        session.handleEvent(messageUpdate("materialized directly"))
        XCTAssertNil(session.streamingItem)
        session.materializeStreamingForSnapshot()
        XCTAssertEqual(streamText(session), "materialized directly")

        session.handleEvent(messageUpdate("materialized by snapshot input"))
        let input = RemoteSnapshotCacheInput(
            sessionID: "remote-session",
            session: session,
            homeDirectory: "/tmp"
        )
        XCTAssertEqual(input.streamingItem.map(ChatSession.plainText(of:)), "materialized by snapshot input")
    }

    func testSelectionFlushImmediatelyMaterializesHiddenPendingUpdate() {
        let visibility = Visibility()
        let session = makeSession()
        session.isSelectedCheck = { visibility.isSelected }

        session.handleEvent(messageUpdate("ready on selection"))
        XCTAssertNil(session.streamingItem)

        visibility.isSelected = true
        session.flushPendingStreamingForSelection()
        XCTAssertEqual(streamText(session), "ready on selection")
    }

    func testHiddenMessageEndStillIngestsFinalTranscriptAndDropsPendingLiveState() {
        let visibility = Visibility()
        let session = makeSession()
        session.isSelectedCheck = { visibility.isSelected }

        session.handleEvent(messageUpdate("partial"))
        session.handleEvent(J([
            "type": "message_end",
            "message": [
                "role": "assistant",
                "content": "final answer",
            ],
        ]))

        XCTAssertEqual(session.transcript.count, 1)
        XCTAssertEqual(ChatSession.plainText(of: session.transcript[0]), "final answer")
        XCTAssertNil(session.streamingItem)
        session.materializeStreamingForSnapshot()
        XCTAssertNil(session.streamingItem)
    }

    func testNilSelectionCheckRetainsExistingFiftyMillisecondFlushBehavior() {
        let session = makeSession()
        session.handleEvent(messageUpdate("visible by default"))
        waitForDeferredFlush()

        XCTAssertEqual(streamText(session), "visible by default")
    }
}
