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

    // MARK: - Sliding window invariants

    func testInitialPinnedWindowRendersLatestTwoPages() {
        // 1085 items → pages 0…33; the latest page is 33.
        let window = TranscriptRenderWindow.resolve(
            itemCount: 1_085,
            topVisiblePage: 33
        )

        XCTAssertEqual(TranscriptRenderWindow.pageSize, 32)
        XCTAssertEqual(window.range, 1_024..<1_085)
        XCTAssertEqual(window.renderedCount, 61)
        XCTAssertTrue(window.isLatest)
    }

    func testWindowIsPagesAroundTopVisiblePageClippedToExistingPages() {
        // 200 items → pages 0…6.
        let middle = TranscriptRenderWindow.resolve(
            itemCount: 200,
            topVisiblePage: 3
        )
        XCTAssertEqual(middle.range, 64..<192) // pages [2,3,4,5]
        XCTAssertLessThanOrEqual(middle.renderedCount, 4 * TranscriptRenderWindow.pageSize)

        let oldest = TranscriptRenderWindow.resolve(
            itemCount: 200,
            topVisiblePage: 0
        )
        XCTAssertEqual(oldest.range, 0..<64) // N == 0 renders the top two pages only

        let latest = TranscriptRenderWindow.resolve(
            itemCount: 200,
            topVisiblePage: 6
        )
        XCTAssertEqual(latest.range, 160..<200) // pages [5,6]
        XCTAssertTrue(latest.isLatest)
    }

    func testWindowSlidesDropOnePageAboveAndAddOneBelow() {
        let up = TranscriptRenderWindow.resolve(
            itemCount: 200,
            topVisiblePage: 2
        )
        let down = TranscriptRenderWindow.resolve(
            itemCount: 200,
            topVisiblePage: 3
        )

        XCTAssertEqual(up.range, 32..<160)
        XCTAssertEqual(down.range, 64..<192)
        XCTAssertEqual(up.renderedCount, down.renderedCount)
        XCTAssertEqual(Set(down.range).subtracting(Set(up.range)).count, TranscriptRenderWindow.pageSize)
        XCTAssertEqual(Set(up.range).subtracting(Set(down.range)).count, TranscriptRenderWindow.pageSize)
    }

    func testWindowNeverExceedsFourPagesForAnySizeAndPage() {
        for count in [0, 1, 31, 32, 33, 64, 65, 70, 200, 1_085] {
            let pages = TranscriptRenderWindow.latestPage(itemCount: count)
            for page in 0...pages {
                let window = TranscriptRenderWindow.resolve(
                    itemCount: count,
                    topVisiblePage: page
                )
                XCTAssertLessThanOrEqual(
                    window.renderedCount,
                    4 * TranscriptRenderWindow.pageSize,
                    "count=\(count) page=\(page)"
                )
                XCTAssertLessThanOrEqual(window.renderedCount, max(0, count))
                XCTAssertGreaterThanOrEqual(window.range.lowerBound, 0)
                XCTAssertLessThanOrEqual(window.range.upperBound, max(0, count))
                if page == 0 {
                    XCTAssertLessThanOrEqual(
                        window.renderedCount,
                        2 * TranscriptRenderWindow.pageSize,
                        "oldest page must render at most two pages"
                    )
                }
            }
        }
    }

    func testTopVisiblePageIsClampedWhenTranscriptShrinks() {
        let window = TranscriptRenderWindow.resolve(
            itemCount: 10,
            topVisiblePage: 5
        )

        XCTAssertEqual(window.range, 0..<10)
    }

    func testPinnedLatestWindowFollowsAppendedItems() {
        // Pinned at the newest page: N := p, so the window tracks growth.
        let before = TranscriptRenderWindow.resolve(itemCount: 100, topVisiblePage: 3)
        let after = TranscriptRenderWindow.resolve(itemCount: 140, topVisiblePage: 4)

        XCTAssertEqual(before.range, 64..<100)
        XCTAssertEqual(after.range, 96..<140)
        XCTAssertTrue(before.isLatest)
        XCTAssertTrue(after.isLatest)
    }

    func testUnpinnedWindowAbsorbsAppendsUntilItsFourPageCap() {
        // Unpinned at page 2: pages [1,2,3,4]; appended items land inside the window
        // until the 4-page cap, after which the newest page waits for N to advance.
        let before = TranscriptRenderWindow.resolve(itemCount: 100, topVisiblePage: 2)
        let absorbed = TranscriptRenderWindow.resolve(itemCount: 150, topVisiblePage: 2)
        let capped = TranscriptRenderWindow.resolve(itemCount: 200, topVisiblePage: 2)

        XCTAssertEqual(before.range, 32..<100)
        XCTAssertEqual(absorbed.range, 32..<150)
        XCTAssertEqual(capped.range, 32..<160)
        XCTAssertTrue(absorbed.isLatest)
        XCTAssertFalse(capped.isLatest)
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
        XCTAssertTrue(transcript.contains("TranscriptRenderWindow.pageSize"))
        XCTAssertTrue(transcript.contains("session.transcriptPlanner.invalidate()"))
        XCTAssertTrue(transcript.contains("onReturnLatest()"))
        XCTAssertTrue(transcript.contains("VStack(alignment: .leading"))
        XCTAssertFalse(transcript.contains("LazyVStack"))
        XCTAssertFalse(transcript.contains("LazyStack"))
        XCTAssertFalse(transcript.contains("session.transcriptVisibleCount"))
        XCTAssertFalse(transcript.contains("+= 200"))
        XCTAssertTrue(transcript.contains("pinEdge: .documentEnd"))
        XCTAssertFalse(transcript.contains(".reversed()"))
        XCTAssertFalse(transcript.contains(".transcriptFlip()"))
        // Sliding-window invariants: no page buttons, no whole-window replacement id,
        // and the top-visible page drives the window.
        XCTAssertFalse(transcript.contains("renderIdentity"))
        XCTAssertFalse(transcript.contains("transcriptHistoryWindowEnd"))
        XCTAssertFalse(transcript.contains("earlierPreferredEnd"))
        XCTAssertFalse(transcript.contains("laterPreferredEnd"))
        XCTAssertFalse(transcript.contains("preferredEnd"))
        XCTAssertFalse(transcript.contains("显示更早的"))
        XCTAssertFalse(transcript.contains("显示后面的"))
        XCTAssertTrue(transcript.contains("返回最新消息"))
        XCTAssertTrue(transcript.contains("正在刷新…"))
        XCTAssertTrue(transcript.contains("topVisiblePage"))
        XCTAssertTrue(transcript.contains("lastPlannedRange"))
        XCTAssertTrue(transcript.contains("scrollTopID"))

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

    func testScrollPositionAnchorsTopVisibleRowWithoutWindowReplacement() throws {
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
        XCTAssertTrue(content.contains("scrollTopID: scrollTopID"))
        XCTAssertTrue(content.contains("defaultScrollAnchor(.bottom)"))
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
