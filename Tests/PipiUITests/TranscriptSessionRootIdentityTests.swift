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

    // MARK: - Session root identity (unchanged invariants)

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

    // MARK: - One-way window: newest end is never deleted

    func testPageSizeAndLatestPageMath() {
        XCTAssertEqual(TranscriptRenderWindow.pageSize, 32)
        XCTAssertEqual(TranscriptRenderWindow.latestPage(itemCount: 0), 0)
        XCTAssertEqual(TranscriptRenderWindow.latestPage(itemCount: 1), 0)
        XCTAssertEqual(TranscriptRenderWindow.latestPage(itemCount: 32), 0)
        XCTAssertEqual(TranscriptRenderWindow.latestPage(itemCount: 33), 1)
        XCTAssertEqual(TranscriptRenderWindow.latestPage(itemCount: 64), 1)
        XCTAssertEqual(TranscriptRenderWindow.latestPage(itemCount: 65), 2)
        XCTAssertEqual(TranscriptRenderWindow.latestPage(itemCount: 1_085), 33)

        XCTAssertEqual(TranscriptRenderWindow.latestStartPage(itemCount: 0), 0)
        XCTAssertEqual(TranscriptRenderWindow.latestStartPage(itemCount: 32), 0)
        XCTAssertEqual(TranscriptRenderWindow.latestStartPage(itemCount: 64), 0)
        XCTAssertEqual(TranscriptRenderWindow.latestStartPage(itemCount: 65), 1)
        XCTAssertEqual(TranscriptRenderWindow.latestStartPage(itemCount: 200), 5)
    }

    func testInitialAndRepinnedWindowIsLatestTwoPages() {
        // 200 items → pages 0…6; latest two pages are [5,6].
        let initial = TranscriptRenderWindow.resolve(itemCount: 200, oldestLoadedPage: nil)
        XCTAssertEqual(initial.range, 160..<200)
        XCTAssertEqual(initial.renderedCount, 40)
        XCTAssertTrue(initial.isLatest)

        // Transcript shorter than two pages renders everything.
        XCTAssertEqual(
            TranscriptRenderWindow.resolve(itemCount: 40, oldestLoadedPage: nil).range,
            0..<40
        )
        XCTAssertEqual(
            TranscriptRenderWindow.resolve(itemCount: 10, oldestLoadedPage: nil).range,
            0..<10
        )
    }

    func testPinnedLatestWindowFollowsAppendedItems() {
        // Pinned window re-anchors at the newest page on growth.
        let before = TranscriptRenderWindow.resolve(itemCount: 100, oldestLoadedPage: nil)
        let after = TranscriptRenderWindow.resolve(itemCount: 140, oldestLoadedPage: nil)

        XCTAssertEqual(before.range, 64..<100)
        XCTAssertEqual(after.range, 96..<140)
        XCTAssertTrue(before.isLatest)
        XCTAssertTrue(after.isLatest)
    }

    func testHistoryPrependOnlyGrowsOldestEnd() {
        // 200 items, latest start page 5. Each prepend adds exactly one older page
        // and the newest end (200) is never dropped while browsing.
        let first = TranscriptRenderWindow.resolve(itemCount: 200, oldestLoadedPage: 4)
        XCTAssertEqual(first.range, 128..<200)

        let second = TranscriptRenderWindow.resolve(itemCount: 200, oldestLoadedPage: 3)
        XCTAssertEqual(second.range, 96..<200)

        let oldest = TranscriptRenderWindow.resolve(itemCount: 200, oldestLoadedPage: 0)
        XCTAssertEqual(oldest.range, 0..<200)

        for window in [first, second, oldest] {
            XCTAssertEqual(window.range.upperBound, 200, "newest end must never be deleted")
            XCTAssertTrue(window.isLatest)
        }
    }

    func testPrependerAddsExactlyOnePageAndIsIdempotentForSameVisiblePage() {
        // Top-visible page reached the oldest loaded page (5) → exactly one prepend.
        XCTAssertEqual(
            TranscriptHistoryPrepender.prepend(currentStartPage: 5, visiblePage: 5),
            4
        )
        // Same visible page reported again: the new start (4) lies below the
        // report, so a second call must not keep decrementing.
        XCTAssertNil(TranscriptHistoryPrepender.prepend(currentStartPage: 4, visiblePage: 5))
        // Visible page still inside the window but not at its head → no prepend.
        XCTAssertNil(TranscriptHistoryPrepender.prepend(currentStartPage: 5, visiblePage: 6))
        // Marker rows map to the latest page (visible > start) → never prepend.
        XCTAssertNil(TranscriptHistoryPrepender.prepend(currentStartPage: 5, visiblePage: 6))
        // Repeated sequence down to page 0, then stops.
        XCTAssertEqual(TranscriptHistoryPrepender.prepend(currentStartPage: 2, visiblePage: 2), 1)
        XCTAssertEqual(TranscriptHistoryPrepender.prepend(currentStartPage: 1, visiblePage: 1), 0)
        XCTAssertNil(TranscriptHistoryPrepender.prepend(currentStartPage: 0, visiblePage: 0))
        // Already at the newest page with no prepend possible below it.
        XCTAssertNil(TranscriptHistoryPrepender.prepend(currentStartPage: 0, visiblePage: 0))
    }

    func testWindowClampsOutOfRangeOldestLoadedPage() {
        // Stale head after a transcript reload: page 9 no longer exists (last is 6).
        XCTAssertEqual(
            TranscriptRenderWindow.resolve(itemCount: 200, oldestLoadedPage: 9).range,
            160..<200
        )
        XCTAssertEqual(
            TranscriptRenderWindow.resolve(itemCount: 200, oldestLoadedPage: -2).range,
            160..<200
        )
        let empty = TranscriptRenderWindow.resolve(itemCount: 0, oldestLoadedPage: 3)
        XCTAssertEqual(empty.range, 0..<0)
        XCTAssertTrue(empty.range.isEmpty)
    }

    func testAppendsKeepStartPageAndExtendEndWhileBrowsing() {
        // Unpinned at page 2; appended messages grow the newest end but must never
        // move the history head.
        let before = TranscriptRenderWindow.resolve(itemCount: 100, oldestLoadedPage: 2)
        let after = TranscriptRenderWindow.resolve(itemCount: 150, oldestLoadedPage: 2)

        XCTAssertEqual(before.range, 64..<100)
        XCTAssertEqual(after.range, 64..<150)
        XCTAssertEqual(before.range.lowerBound, after.range.lowerBound)
        XCTAssertTrue(after.isLatest)
    }

    func testWindowNeverExceedsItemCountForAnyHead() {
        for count in [0, 1, 31, 32, 33, 64, 65, 70, 200, 1_085] {
            let lastPage = TranscriptRenderWindow.latestPage(itemCount: count)
            let heads: [Int?] = [nil, -1, 0, lastPage, lastPage + 1] + (
                lastPage > 1 ? [1, lastPage - 1] : []
            )
            for head in heads {
                let window = TranscriptRenderWindow.resolve(
                    itemCount: count,
                    oldestLoadedPage: head
                )
                XCTAssertGreaterThanOrEqual(window.range.lowerBound, 0)
                XCTAssertLessThanOrEqual(window.range.upperBound, max(0, count))
                XCTAssertLessThanOrEqual(window.renderedCount, max(0, count))
            }
        }
    }

    // MARK: - Source invariants

    func testTranscriptUsesContinuousScrollWithoutPaginationButtons() throws {
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
        XCTAssertTrue(transcript.contains("TranscriptRenderWindow.resolve"))
        XCTAssertTrue(transcript.contains("VStack(alignment: .leading"))
        XCTAssertFalse(transcript.contains("LazyVStack"))
        XCTAssertFalse(transcript.contains("LazyStack"))
        XCTAssertFalse(transcript.contains("session.transcriptVisibleCount"))
        XCTAssertFalse(transcript.contains("+= 200"))
        XCTAssertTrue(transcript.contains("pinEdge: .documentEnd"))
        XCTAssertFalse(transcript.contains(".reversed()"))
        XCTAssertFalse(transcript.contains(".transcriptFlip()"))
        // One-way window: no page buttons, no whole-window replacement id.
        XCTAssertFalse(transcript.contains("renderIdentity"))
        XCTAssertFalse(transcript.contains("transcriptHistoryWindowEnd"))
        XCTAssertFalse(transcript.contains("earlierPreferredEnd"))
        XCTAssertFalse(transcript.contains("laterPreferredEnd"))
        XCTAssertFalse(transcript.contains("preferredEnd"))
        XCTAssertFalse(transcript.contains("显示更早的"))
        XCTAssertFalse(transcript.contains("显示后面的"))
        XCTAssertTrue(transcript.contains("返回最新消息"))
        XCTAssertTrue(transcript.contains("正在刷新…"))
        // The old top-visible-page-driven bidirectional window and its body side
        // effects are gone.
        XCTAssertFalse(transcript.contains("topVisiblePage"))
        XCTAssertFalse(transcript.contains("lastPlannedRange"))
        XCTAssertFalse(transcript.contains("trackPlannedWindow"))
        XCTAssertTrue(transcript.contains("transcriptOldestLoadedPage"))
        XCTAssertTrue(transcript.contains("TranscriptHistoryPrepender.prepend"))
        // History loading may only act while unpinned (the near-top gate).
        XCTAssertTrue(transcript.contains("guard !session.pinTranscriptToBottom"))
        XCTAssertTrue(transcript.contains("topLoadingEnabled"))

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

    func testHistoryTopLoadingUsesClipGeometryEdgeNotRowIds() throws {
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

        // The id-report loading pipeline is gone entirely: no handler, no
        // per-anchor dedupe key, no id→page mapping, no scrollTopID observation.
        XCTAssertFalse(transcript.contains("handleScrollTopReport"))
        XCTAssertFalse(transcript.contains("lastPrependTriggerID"))
        XCTAssertFalse(transcript.contains("visiblePage(from:"))
        XCTAssertFalse(transcript.contains(".onChange(of: scrollTopID)"))
        // The tracker receives the top-loading gate and the one-page prepend edge.
        XCTAssertTrue(transcript.contains("topLoadingEnabled:"))
        XCTAssertTrue(transcript.contains("onNearTop:"))
        XCTAssertTrue(transcript.contains("StickToBottomTracker("))
        XCTAssertTrue(transcript.contains("pinEdge: .documentEnd"))
        // The callback still goes through the pure one-way prepender and guards pin.
        XCTAssertTrue(transcript.contains("TranscriptHistoryPrepender.prepend"))
        XCTAssertTrue(transcript.contains("guard !session.pinTranscriptToBottom"))
        XCTAssertTrue(transcript.contains("transcriptOldestLoadedPage"))
        XCTAssertTrue(transcript.contains("latestStartPage(itemCount: items.count)"))
    }

    func testScrollPositionReportsTopRowWithoutWindowReplacement() throws {
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

        XCTAssertTrue(content.contains(".scrollPosition(id: $scrollTopID, anchor: .top)"))
        // scrollTopID survives purely as the prepend anchor; it no longer feeds
        // a loading trigger (see testHistoryTopLoadingUsesClipGeometryEdgeNotRowIds).
        XCTAssertFalse(content.contains("handleScrollTopReport"))
        // Bottom pinning must not compete with the user while browsing history.
        XCTAssertFalse(content.contains(".defaultScrollAnchor(.bottom)"))
        XCTAssertFalse(content.contains("defaultScrollAnchor"))
        XCTAssertFalse(content.contains("historyWindowEnd"))
        XCTAssertFalse(content.contains("transcriptHistoryWindowEnd"))
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
