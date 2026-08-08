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

    // MARK: - Bounded one-way window (maxPages hard cap)

    func testPageSizeAndLatestPageMath() {
        XCTAssertEqual(TranscriptRenderWindow.pageSize, 32)
        XCTAssertEqual(TranscriptRenderWindow.maxPages, 4)
        XCTAssertEqual(TranscriptRenderWindow.latestPage(itemCount: 0), 0)
        XCTAssertEqual(TranscriptRenderWindow.latestPage(itemCount: 1), 0)
        XCTAssertEqual(TranscriptRenderWindow.latestPage(itemCount: 32), 0)
        XCTAssertEqual(TranscriptRenderWindow.latestPage(itemCount: 33), 1)
        XCTAssertEqual(TranscriptRenderWindow.latestPage(itemCount: 64), 1)
        XCTAssertEqual(TranscriptRenderWindow.latestPage(itemCount: 65), 2)
        XCTAssertEqual(TranscriptRenderWindow.latestPage(itemCount: 1_085), 33)

        XCTAssertEqual(TranscriptRenderWindow.latestStartPage(itemCount: 0), 0)
        XCTAssertEqual(TranscriptRenderWindow.latestStartPage(itemCount: 32), 0)
        XCTAssertEqual(TranscriptRenderWindow.latestStartPage(itemCount: 64), 1)
        XCTAssertEqual(TranscriptRenderWindow.latestStartPage(itemCount: 65), 2)
        XCTAssertEqual(TranscriptRenderWindow.latestStartPage(itemCount: 200), 6)
        XCTAssertEqual(TranscriptRenderWindow.latestStartPage(itemCount: 1_085), 33)
    }

    func testInitialAndRepinnedWindowIsLatestPage() {
        // 200 items → latest page 6: the initial window is exactly that page —
        // no second-page preload.
        let initial = TranscriptRenderWindow.resolve(itemCount: 200, oldestLoadedPage: nil)
        XCTAssertEqual(initial.range, 192..<200)
        XCTAssertEqual(initial.renderedCount, 8)
        XCTAssertTrue(initial.isLatest)

        // Transcript shorter than one page renders everything.
        XCTAssertEqual(
            TranscriptRenderWindow.resolve(itemCount: 40, oldestLoadedPage: nil).range,
            32..<40
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

        XCTAssertEqual(before.range, 96..<100)
        XCTAssertEqual(after.range, 128..<140)
        XCTAssertTrue(before.isLatest)
        XCTAssertTrue(after.isLatest)
    }

    func testHistoryExpansionGrowsOldestEndUntilMaxPagesThenSlides() {
        // 200 items, latest page 6. Near the newest end the window still ends at
        // itemCount; past maxPages the capped window slides and drops the newest.
        let first = TranscriptRenderWindow.resolve(itemCount: 200, oldestLoadedPage: 5)
        XCTAssertEqual(first.range, 160..<200)
        XCTAssertTrue(first.isLatest)

        let second = TranscriptRenderWindow.resolve(itemCount: 200, oldestLoadedPage: 4)
        XCTAssertEqual(second.range, 128..<200)
        XCTAssertTrue(second.isLatest)

        let atCap = TranscriptRenderWindow.resolve(itemCount: 200, oldestLoadedPage: 3)
        XCTAssertEqual(atCap.range, 96..<200)
        XCTAssertEqual(atCap.renderedCount, 104)
        XCTAssertTrue(atCap.isLatest)

        let slid = TranscriptRenderWindow.resolve(itemCount: 200, oldestLoadedPage: 2)
        XCTAssertEqual(slid.range, 64..<192)
        XCTAssertEqual(slid.renderedCount, TranscriptRenderWindow.maxPages * TranscriptRenderWindow.pageSize)
        XCTAssertFalse(slid.isLatest)

        let oldest = TranscriptRenderWindow.resolve(itemCount: 200, oldestLoadedPage: 0)
        XCTAssertEqual(oldest.range, 0..<128)
        XCTAssertEqual(oldest.renderedCount, 128)
        XCTAssertFalse(oldest.isLatest)
    }

    func testLargeItemCountWindowNeverExceedsMaxPages() {
        // Continuous history expansion across a long session must stay bounded.
        let count = 1_085
        let lastPage = TranscriptRenderWindow.latestPage(itemCount: count)
        var head: Int? = nil
        var sawNonLatest = false
        for _ in 0...(lastPage + 2) {
            let window = TranscriptRenderWindow.resolve(itemCount: count, oldestLoadedPage: head)
            XCTAssertLessThanOrEqual(
                window.renderedCount,
                TranscriptRenderWindow.maxPages * TranscriptRenderWindow.pageSize,
                "head=\(String(describing: head))"
            )
            XCTAssertLessThanOrEqual(window.range.upperBound, count)
            if !window.isLatest { sawNonLatest = true }
            let current = head ?? TranscriptRenderWindow.latestStartPage(itemCount: count)
            head = TranscriptHistoryExpander.expand(currentStartPage: current)
        }
        XCTAssertTrue(sawNonLatest, "deep history must eventually leave the latest end")
        let deepest = TranscriptRenderWindow.resolve(itemCount: count, oldestLoadedPage: 0)
        XCTAssertEqual(deepest.range, 0..<128)
        XCTAssertFalse(deepest.isLatest)
    }

    func testExpanderAddsExactlyOnePageUntilPageZero() {
        // Each exact-top arrival decrements the start page by exactly one.
        XCTAssertEqual(TranscriptHistoryExpander.expand(currentStartPage: 6), 5)
        XCTAssertEqual(TranscriptHistoryExpander.expand(currentStartPage: 2), 1)
        XCTAssertEqual(TranscriptHistoryExpander.expand(currentStartPage: 1), 0)
        // No older page: stop. No visible-page bookkeeping exists anymore.
        XCTAssertNil(TranscriptHistoryExpander.expand(currentStartPage: 0))
        XCTAssertNil(TranscriptHistoryExpander.expand(currentStartPage: -1))
    }

    func testInitialWindowGrowsOnePagePerTopArrival() {
        // 200 items: initial window is page 6 alone; each top arrival adds one
        // page (1 → 2 → 3 pages), always ending at the newest item.
        var head: Int? = nil
        var ranges: [Range<Int>] = []
        for _ in 0..<3 {
            ranges.append(
                TranscriptRenderWindow.resolve(itemCount: 200, oldestLoadedPage: head).range
            )
            let current = head ?? TranscriptRenderWindow.latestStartPage(itemCount: 200)
            head = TranscriptHistoryExpander.expand(currentStartPage: current)
        }
        XCTAssertEqual(ranges[0], 192..<200)
        XCTAssertEqual(ranges[1], 160..<200)
        XCTAssertEqual(ranges[2], 128..<200)
    }

    func testWindowClampsOutOfRangeOldestLoadedPage() {
        // Stale head after a transcript reload: page 9 no longer exists (last is 6).
        XCTAssertEqual(
            TranscriptRenderWindow.resolve(itemCount: 200, oldestLoadedPage: 9).range,
            192..<200
        )
        XCTAssertEqual(
            TranscriptRenderWindow.resolve(itemCount: 200, oldestLoadedPage: -2).range,
            192..<200
        )
        let empty = TranscriptRenderWindow.resolve(itemCount: 0, oldestLoadedPage: 3)
        XCTAssertEqual(empty.range, 0..<0)
        XCTAssertTrue(empty.range.isEmpty)
    }

    func testAppendsKeepStartPageAndExtendEndWhileBrowsingWithinCap() {
        // Unpinned at page 2 within the cap; appended messages grow the newest end
        // but must never move the history head.
        let before = TranscriptRenderWindow.resolve(itemCount: 100, oldestLoadedPage: 2)
        let after = TranscriptRenderWindow.resolve(itemCount: 150, oldestLoadedPage: 2)

        XCTAssertEqual(before.range, 64..<100)
        XCTAssertEqual(after.range, 64..<150)
        XCTAssertEqual(before.range.lowerBound, after.range.lowerBound)
        XCTAssertTrue(after.isLatest)
    }

    func testAppendsDoNotGrowCappedMidHistoryWindow() {
        // Deep history already at maxPages: new arrivals at the newest end must
        // not enlarge the eager window past the cap or move the head.
        let before = TranscriptRenderWindow.resolve(itemCount: 200, oldestLoadedPage: 0)
        let after = TranscriptRenderWindow.resolve(itemCount: 260, oldestLoadedPage: 0)
        XCTAssertEqual(before.range, 0..<128)
        XCTAssertEqual(after.range, 0..<128)
        XCTAssertEqual(before.renderedCount, after.renderedCount)
        XCTAssertFalse(after.isLatest)
    }

    func testWindowNeverExceedsItemCountOrMaxPagesForAnyHead() {
        let maxRendered = TranscriptRenderWindow.maxPages * TranscriptRenderWindow.pageSize
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
                XCTAssertLessThanOrEqual(window.renderedCount, maxRendered)
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
        XCTAssertTrue(transcript.contains("pinEdge: .documentStart"))
        XCTAssertTrue(transcript.contains("ForEach(presentation.rows.reversed()"))
        XCTAssertTrue(transcript.contains(".transcriptFlip()"))
        // Bounded head-driven window: no page buttons, no whole-window replacement id.
        XCTAssertFalse(transcript.contains("renderIdentity"))
        XCTAssertFalse(transcript.contains("transcriptHistoryWindowEnd"))
        XCTAssertFalse(transcript.contains("earlierPreferredEnd"))
        XCTAssertFalse(transcript.contains("laterPreferredEnd"))
        XCTAssertFalse(transcript.contains("preferredEnd"))
        XCTAssertFalse(transcript.contains("显示更早的"))
        XCTAssertFalse(transcript.contains("显示后面的"))
        XCTAssertTrue(transcript.contains("返回最新消息"))
        XCTAssertTrue(transcript.contains("正在刷新…"))
        // Hard eager ceiling — continuous history load cannot mount the session.
        XCTAssertTrue(source.contains("static let maxPages = 4"))
        XCTAssertTrue(source.contains("start + maxPages * pageSize"))
        // The old top-visible-page-driven bidirectional window and its body side
        // effects are gone.
        XCTAssertFalse(transcript.contains("topVisiblePage"))
        XCTAssertFalse(transcript.contains("lastPlannedRange"))
        XCTAssertFalse(transcript.contains("trackPlannedWindow"))
        XCTAssertTrue(transcript.contains("transcriptOldestLoadedPage"))
        // One explicit pager owns both non-scrollable safety backfill and
        // user-driven near-top prefetch.
        XCTAssertTrue(transcript.contains("TranscriptHistoryPager.begin"))
        XCTAssertTrue(transcript.contains("historyPageLoadState"))
        XCTAssertTrue(transcript.contains("historyLoadingEnabled"))
        XCTAssertTrue(transcript.contains("onReachedTop:"))
        XCTAssertFalse(transcript.contains("onNearTop"))
        XCTAssertFalse(transcript.contains("visiblePage"))
        XCTAssertFalse(transcript.contains("lastPrependTriggerID"))

        let history = try XCTUnwrap(transcript.range(of: "ForEach(presentation.rows")?.lowerBound)
        let streaming = try XCTUnwrap(
            transcript.range(of: "let streamingItem = streaming.streamingItem")?.lowerBound
        )
        let bottom = try XCTUnwrap(
            transcript.range(of: ".id(transcriptID(\"bottom\"))")?.lowerBound
        )
        let elapsed = try XCTUnwrap(transcript.range(of: "TurnElapsedText(")?.lowerBound)
        let streamingRow = try XCTUnwrap(
            transcript.range(of: "MessageRow(", range: streaming..<transcript.endIndex)?.lowerBound
        )
        // Inverted layout is bottom-to-top: bottom extras first, newest-first
        // settled rows later. Older history appends at the layout end.
        XCTAssertLessThan(bottom, streaming)
        XCTAssertLessThan(streaming, elapsed)
        XCTAssertLessThan(elapsed, streamingRow)
        XCTAssertLessThan(streamingRow, history)
    }

    func testHistoryLoadingUsesNearTopGeometryNotRowIds() throws {
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
        XCTAssertFalse(transcript.contains("scrollTopID"))
        XCTAssertFalse(transcript.contains(".scrollPosition("))
        // The tracker receives the loading gate and near-top callback.
        XCTAssertTrue(transcript.contains("topLoadingEnabled:"))
        XCTAssertTrue(transcript.contains("onReachedTop:"))
        XCTAssertTrue(transcript.contains("StickToBottomTracker("))
        XCTAssertTrue(transcript.contains("pinEdge: .documentStart"))
        XCTAssertTrue(source.contains("distanceFromDocumentEnd("))
        // The callback goes through the one-page pager. Pinned non-scrollable
        // windows are intentionally allowed to safety-backfill.
        XCTAssertTrue(transcript.contains("TranscriptHistoryPager.begin"))
        XCTAssertFalse(transcript.contains("guard !session.pinTranscriptToBottom"))
        XCTAssertTrue(transcript.contains("transcriptOldestLoadedPage"))
        XCTAssertTrue(transcript.contains("latestStartPage(itemCount: items.count)"))
        XCTAssertTrue(transcript.contains("正在加载更早消息…"))
        XCTAssertTrue(transcript.contains("还没有消息"))
        XCTAssertTrue(transcript.contains("forcedVisibleSettledRowID"))
    }

    func testMainTranscriptHasNoScrollPositionAnchorOrMessageIDTrigger() throws {
        let source = try chatDetailSource()
        // No identity or offset compensation route remains. The inverted eager
        // stack preserves position structurally by appending older rows.
        XCTAssertFalse(source.contains(".scrollPosition(id:"))
        XCTAssertFalse(source.contains("scrollTopID"))
        XCTAssertFalse(source.contains("onNearTop"))
        XCTAssertFalse(source.contains("TranscriptNearTopTrigger"))
        // Explicit ScrollViewReader jumps (bottom / message targets) remain.
        XCTAssertTrue(source.contains("proxy.scrollTo(transcriptID(\"bottom\"), anchor: .top)"))
        XCTAssertTrue(source.contains("proxy.scrollTo(target, anchor: jumpAnchor)"))
    }

    func testInitialOffsetBottomAnchorIsRoleScoped() throws {
        let source = try chatDetailSource()
        let anchorStart = try XCTUnwrap(
            source.range(of: "private struct InitialBottomOffsetAnchor: ViewModifier")?.lowerBound
        )
        let anchorEnd = try XCTUnwrap(
            source.range(
                of: "private struct TranscriptViewportHeightKey: PreferenceKey",
                range: anchorStart..<source.endIndex
            )?.lowerBound
        )
        let initialAnchor = String(source[anchorStart..<anchorEnd])
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

        // macOS 15+: one role-scoped modifier shape stays mounted across pin
        // changes. Only its initial anchor value changes, so the native scroll
        // root is not replaced; warm unpinned history starts naturally at top.
        XCTAssertTrue(initialAnchor.contains("#available(macOS 15.0, *)"))
        XCTAssertTrue(
            initialAnchor.contains(
                ".defaultScrollAnchor(pinned ? .top : .bottom, for: .initialOffset)"
            )
        )
        XCTAssertFalse(initialAnchor.contains("#available(macOS 15.0, *), pinned"))
        XCTAssertFalse(initialAnchor.contains("if pinned"))
        XCTAssertFalse(initialAnchor.contains(".defaultScrollAnchor(.bottom)"))
        XCTAssertFalse(initialAnchor.contains("defaultScrollAnchor(_ anchor"))
        // macOS 14 fallback: the settled-key cover hides the fresh root until the
        // explicit pinned jump lands.
        XCTAssertTrue(content.contains(".opacity(transcriptCoveredByBottomSettle ? 0 : 1)"))
        XCTAssertTrue(content.contains(".modifier(InitialBottomOffsetAnchor"))
        XCTAssertTrue(source.contains("BottomSettledCover.needsCover"))
        XCTAssertTrue(source.contains("bottomSettledSessionKey"))
        XCTAssertTrue(source.contains("proxy.scrollTo(transcriptID(\"bottom\"), anchor: .top)"))
        XCTAssertTrue(source.contains("markBottomSettledIfCurrent"))
        // Stale jump/settle callbacks must be key-guarded.
        XCTAssertTrue(source.contains("session.bridgeRoutingKey == key"))
    }

    func testLatestStartPageIsLatestPageNoPreload() throws {
        let source = try chatDetailSource()
        // The default window is the newest single page: no second-page preload.
        XCTAssertTrue(source.contains("static func latestStartPage(itemCount: Int) -> Int {"))
        XCTAssertTrue(source.contains("max(0, latestPage(itemCount: itemCount))"))
        XCTAssertEqual(TranscriptRenderWindow.latestStartPage(itemCount: 200), 6)
        XCTAssertEqual(
            TranscriptRenderWindow.resolve(itemCount: 200, oldestLoadedPage: nil).range,
            192..<200
        )
    }

    func testTrackerOwnsInvertedHistoryPrefetchWithoutAppendCompensation() throws {
        let source = try chatDetailSource()
        let trackerStart = try XCTUnwrap(
            source.range(of: "struct StickToBottomTracker: NSViewRepresentable")?.lowerBound
        )
        let tracker = String(source[trackerStart..<source.endIndex])

        // Near-top callback reports whether one older page was admitted.
        XCTAssertTrue(tracker.contains("var onReachedTop: (() -> Bool)?"))
        XCTAssertTrue(tracker.contains("TranscriptHistoryPrefetchTrigger"))
        XCTAssertFalse(tracker.contains("onNearTop"))
        XCTAssertFalse(tracker.contains("TranscriptNearTopTrigger"))
        XCTAssertTrue(source.contains("approachThreshold"))
        XCTAssertTrue(source.contains("distanceFromDocumentEnd("))
        XCTAssertTrue(tracker.contains("case .documentStart:"))
        XCTAssertFalse(tracker.contains("PendingPrependSnapshot"))
        XCTAssertFalse(tracker.contains("anchorYBefore"))
        XCTAssertFalse(tracker.contains("clipOriginYBefore"))
        XCTAssertFalse(tracker.contains("PrependAnchorCompensation"))
        XCTAssertFalse(tracker.contains("applyPendingCompensation"))
        // One clip mutation remains exclusively for pinned latest-content growth,
        // gated so a scroller-knob drag cannot be fought by streaming reflow.
        XCTAssertTrue(tracker.contains("clip.scroll(to:"))
        XCTAssertTrue(tracker.contains("allowsPinnedContentFollow"))
        XCTAssertTrue(tracker.contains("allowRepin: false"))
        XCTAssertTrue(source.contains("static func allowsPinnedContentFollow"))
        XCTAssertFalse(tracker.contains("clearPendingCompensation"))
        XCTAssertFalse(source.contains("restoredOriginY"))
        XCTAssertTrue(tracker.contains("boundsUpdateGeneration"))
        // User-scroll gating applies after content becomes scrollable; a raw
        // window too short to scroll must auto-backfill instead.
        XCTAssertTrue(tracker.contains("hasObservedUserScroll"))
        XCTAssertTrue(tracker.contains("documentNeedsBackfill"))
        XCTAssertTrue(tracker.contains("hasObservedUserScroll || documentNeedsBackfill"))
        XCTAssertFalse(tracker.contains("anchorFrameObs"))
        XCTAssertFalse(tracker.contains("anchorLayoutObserved"))
        XCTAssertTrue(tracker.contains("static func dismantleNSView"))
        XCTAssertTrue(tracker.contains("coordinator.detach()"))
        XCTAssertFalse(tracker.contains("schedulePendingCleanup"))
        XCTAssertFalse(tracker.contains("pendingCleanupToken"))
    }

    func testInvertedLayoutPlacesBottomExtrasBeforeNewestFirstSettledRows() throws {
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

        // Layout order is the reverse of visual order: bottom extras precede
        // settled rows, and the observer follows the newest-first ForEach.
        let rows = try XCTUnwrap(transcript.range(of: "ForEach(presentation.rows")?.lowerBound)
        let tracker = try XCTUnwrap(transcript.range(of: "StickToBottomTracker(")?.lowerBound)
        let streaming = try XCTUnwrap(
            transcript.range(of: "let streamingItem = streaming.streamingItem")?.lowerBound
        )
        let returnButton = try XCTUnwrap(transcript.range(of: "返回最新消息")?.lowerBound)
        let waiting = try XCTUnwrap(
            transcript.range(of: "WaitingPlaceholderView(")?.lowerBound
        )
        let bottomSentinel = try XCTUnwrap(
            transcript.range(of: ".id(transcriptID(\"bottom\"))")?.lowerBound
        )
        XCTAssertLessThan(rows, tracker, "anchor must follow the settled rows")
        // Empty production rows (the reachable initialization state) must not
        // mount the settled container at all: an always-declared zero-height
        // VStack is still a real child of the outer VStack and would be counted
        // for outer spacing (an extra `messageSpacing` gap). The guard must sit
        // before the container, and the tracker overlay must stay inside it.
        let emptyRowsGuard = try XCTUnwrap(
            transcript.range(of: "if !presentation.rows.isEmpty {")?.lowerBound
        )
        XCTAssertLessThan(emptyRowsGuard, rows, "the empty-rows guard must precede the settled container")
        XCTAssertLessThan(emptyRowsGuard, tracker, "the empty-rows guard must precede the tracker overlay")
        XCTAssertLessThan(streaming, tracker, "streaming extra must precede rows in inverted layout")
        XCTAssertLessThan(waiting, tracker, "waiting extra must precede rows in inverted layout")
        XCTAssertLessThan(returnButton, tracker, "return control must precede rows in inverted layout")
        XCTAssertLessThan(bottomSentinel, tracker, "bottom sentinel must start inverted layout")
        // The sentinel no longer hosts the tracker in its background.
        XCTAssertFalse(transcript.contains(".background {\n                    // Always mounted"))

        // The settled ForEach must live inside its own real eager VStack
        // container (same spacing as the outer VStack) and the tracker overlay
        // must chain to THAT container, never directly to the ForEach: a direct
        // ForEach.overlay flattens into one per-row host that rebinds on
        // head insertions (measured by the OverlayAnchorGeometryIntegrationTests
        // legacy probe), so the anchor could never move in document
        // coordinates. Exactly one tracker may be mounted in the transcript.
        XCTAssertTrue(
            source.contains(
                "if !presentation.rows.isEmpty {\n"
                    + "                VStack(alignment: .leading, spacing: chatTypography.messageSpacing) {\n"
                    + "                    ForEach(presentation.rows.reversed(), id: \\.id)"
            ),
            "the settled ForEach must sit inside its own eager VStack container behind the empty-rows guard"
        )
        XCTAssertEqual(
            transcript.components(separatedBy: "StickToBottomTracker(").count - 1, 1,
            "exactly one tracker overlay must be mounted in the transcript content"
        )
        // The zero-height representable contract: the overlay host is sized
        // from an explicit sizeThatFits (height 0), not from a bare zero frame.
        XCTAssertTrue(source.contains("func sizeThatFits(_ proposal: ProposedViewSize, nsView: NSView, context: Context) -> CGSize?"))
        XCTAssertTrue(source.contains("CGSize(width: proposal.width ?? 0, height: 0)"))
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
