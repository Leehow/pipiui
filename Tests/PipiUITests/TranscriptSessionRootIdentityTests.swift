import Foundation
import XCTest
@testable import PipiUI

final class TranscriptSessionRootIdentityTests: XCTestCase {
    private var repositoryRoot: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    func testDifferentSessionKeysProduceDifferentScrollRoots() {
        let first = TranscriptSessionRootIdentity(
            sessionKey: "session-a"
        )
        let second = TranscriptSessionRootIdentity(
            sessionKey: "session-b"
        )

        XCTAssertNotEqual(first, second)
    }

    func testRepeatedRenderingOfOneSessionKeepsSameScrollRoot() {
        let first = TranscriptSessionRootIdentity(
            sessionKey: "session-a"
        )
        let second = TranscriptSessionRootIdentity(
            sessionKey: "session-a"
        )

        XCTAssertEqual(first, second)
        XCTAssertEqual(Set([first, second]).count, 1)
    }

    func testDistinctChatSessionObjectsCannotShareScrollRoot() {
        let first = ChatSession(
            id: "resume:/same.jsonl",
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: "/same.jsonl",
            blockedReason: "test"
        )
        let second = ChatSession(
            id: "resume:/same.jsonl",
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: "/same.jsonl",
            blockedReason: "test"
        )

        XCTAssertNotEqual(
            TranscriptSessionRootIdentity(
                sessionKey: first.bridgeRoutingKey
            ),
            TranscriptSessionRootIdentity(
                sessionKey: second.bridgeRoutingKey
            )
        )
    }

    func testPersistedIdentityRebindKeepsLogicalSessionScrollRoot() {
        let session = ChatSession(
            id: "new:temporary",
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: nil,
            blockedReason: "test"
        )
        let before = TranscriptSessionRootIdentity(
            sessionKey: session.bridgeRoutingKey
        )

        session.rebindIdentity(to: "resume:/persisted.jsonl")

        XCTAssertEqual(
            TranscriptSessionRootIdentity(
                sessionKey: session.bridgeRoutingKey
            ),
            before
        )
    }

    func testLatestRenderWindowIsExplicitlyBounded() {
        let window = TranscriptRenderWindow.resolve(
            itemCount: 1_085,
            preferredEnd: nil
        )

        XCTAssertEqual(TranscriptRenderWindow.pageSize, 32)
        XCTAssertEqual(window.range, 1_053..<1_085)
        XCTAssertEqual(window.renderedCount, 32)
        XCTAssertEqual(window.hiddenEarlier, 1_053)
        XCTAssertEqual(window.hiddenLater, 0)
        XCTAssertTrue(window.isLatest)
        XCTAssertEqual(window.earlierPreferredEnd, 1_053)
    }

    func testOlderRenderWindowDoesNotGrowWhenNewItemsArrive() {
        let older = TranscriptRenderWindow.resolve(
            itemCount: 1_085,
            preferredEnd: 1_053
        )
        let afterAppend = TranscriptRenderWindow.resolve(
            itemCount: 1_100,
            preferredEnd: 1_053
        )

        XCTAssertEqual(older.range, 1_021..<1_053)
        XCTAssertEqual(afterAppend.range, older.range)
        XCTAssertEqual(afterAppend.renderedCount, 32)
        XCTAssertEqual(afterAppend.hiddenLater, 47)
        XCTAssertFalse(afterAppend.isLatest)
    }

    func testRenderWindowPaginationReachesOlderAndLatestPages() {
        let latest = TranscriptRenderWindow.resolve(itemCount: 70, preferredEnd: nil)
        let middle = TranscriptRenderWindow.resolve(
            itemCount: 70,
            preferredEnd: latest.earlierPreferredEnd
        )
        let oldest = TranscriptRenderWindow.resolve(
            itemCount: 70,
            preferredEnd: middle.earlierPreferredEnd
        )

        XCTAssertEqual(latest.range, 38..<70)
        XCTAssertEqual(middle.range, 6..<38)
        XCTAssertEqual(oldest.range, 0..<6)
        XCTAssertNil(oldest.earlierPreferredEnd)
        XCTAssertEqual(oldest.laterPreferredEnd, 38)
        XCTAssertNil(middle.laterPreferredEnd)
    }

    func testTranscriptUsesNormalChronologicalLayoutWithoutReverseFlip() throws {
        let source = try chatDetailSource()
        let start = try XCTUnwrap(
            source.range(of: "private struct StreamingTranscriptRows: View")?.lowerBound
        )
        let end = try XCTUnwrap(
            source.range(
                of: "private struct TranscriptLoadingOverlay: View",
                range: start..<source.endIndex
            )?.lowerBound
        )
        let transcript = String(source[start..<end])

        XCTAssertTrue(transcript.contains("ForEach(presentation.rows"))
        XCTAssertTrue(transcript.contains("Array(items[window.range])"))
        XCTAssertTrue(transcript.contains("visibleCount: windowItems.count"))
        XCTAssertTrue(transcript.contains("TranscriptRenderWindow.pageSize"))
        XCTAssertTrue(transcript.contains(".id(transcriptID(window.renderIdentity))"))
        XCTAssertTrue(transcript.contains("session.transcriptPlanner.invalidate()"))
        XCTAssertTrue(transcript.contains("if let laterEnd = window.laterPreferredEnd"))
        XCTAssertTrue(transcript.contains("onReturnLatest()"))
        XCTAssertTrue(transcript.contains("VStack(alignment: .leading"))
        XCTAssertFalse(transcript.contains("LazyVStack"))
        XCTAssertFalse(transcript.contains("LazyStack"))
        XCTAssertFalse(transcript.contains("session.transcriptVisibleCount"))
        XCTAssertFalse(transcript.contains("+= 200"))
        XCTAssertTrue(transcript.contains("pinEdge: .documentEnd"))
        XCTAssertFalse(transcript.contains(".reversed()"))
        XCTAssertFalse(transcript.contains(".transcriptFlip()"))

        let history = try XCTUnwrap(transcript.range(of: "ForEach(presentation.rows")?.lowerBound)
        let streaming = try XCTUnwrap(
            transcript.range(of: "let streamingItem = streaming.streamingItem")?.lowerBound
        )
        let bottom = try XCTUnwrap(
            transcript.range(of: ".id(transcriptID(\"bottom\"))")?.lowerBound
        )
        XCTAssertLessThan(history, streaming)
        XCTAssertLessThan(streaming, bottom)
    }

    func testStreamingFollowUsesAppKitContentGrowthInsteadOfObjectWillChangeScrollTo() throws {
        let source = try chatDetailSource()
        let contentStart = try XCTUnwrap(
            source.range(of: "private var transcriptContent: some View")?.lowerBound
        )
        let contentEnd = try XCTUnwrap(
            source.range(
                of: "private func scheduleChatColumnWidthSettleRepin",
                range: contentStart..<source.endIndex
            )?.lowerBound
        )
        let content = String(source[contentStart..<contentEnd])

        XCTAssertFalse(content.contains("TranscriptFollowObserver"))
        XCTAssertFalse(content.contains("streaming.objectWillChange"))
        XCTAssertFalse(content.contains(".onChange(of: streaming."))

        let trackerStart = try XCTUnwrap(
            source.range(of: "struct StickToBottomTracker: NSViewRepresentable")?.lowerBound
        )
        let tracker = String(source[trackerStart..<source.endIndex])
        XCTAssertTrue(tracker.contains("NSView.frameDidChangeNotification"))
        XCTAssertTrue(tracker.contains("schedulePinnedContentFollow()"))
        XCTAssertTrue(tracker.contains("clip.scroll(to:"))
        XCTAssertFalse(tracker.contains("ScrollViewProxy"))

        let bodyStart = try XCTUnwrap(
            source.range(of: "private struct ChatDetailViewBody: View")?.lowerBound
        )
        let bodyHeaderEnd = try XCTUnwrap(
            source.range(of: "var body: some View", range: bodyStart..<source.endIndex)?.lowerBound
        )
        let bodyHeader = String(source[bodyStart..<bodyHeaderEnd])
        XCTAssertTrue(bodyHeader.contains("let streaming: StreamingState"))
        XCTAssertFalse(bodyHeader.contains("@ObservedObject var streaming: StreamingState"))
    }

    private func chatDetailSource() throws -> String {
        try String(
            contentsOf: repositoryRoot
                .appendingPathComponent("Sources/PipiUI/Views/ChatDetailView.swift"),
            encoding: .utf8
        )
    }
}
