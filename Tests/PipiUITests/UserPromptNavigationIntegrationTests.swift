import XCTest
@testable import PipiUI

/// High-level black-box seam: user-prompt seek navigation host used by ChatDetailView.
///
/// Covers bounded seek windows, last-click-wins generation, return-to-latest, and
/// stale session/effect guards without mounting SwiftUI.
final class UserPromptNavigationIntegrationTests: XCTestCase {

    private func makeCoordinator(
        seekWindowSize: Int = 128,
        maxCorrectionSteps: Int = 3
    ) -> UserPromptNavigationCoordinator {
        UserPromptNavigationCoordinator(
            config: .init(
                seekWindowSize: seekWindowSize,
                maxCorrectionSteps: maxCorrectionSteps
            )
        )
    }

    // MARK: - Bounded seek on long transcripts

    func testSeekFirstOfThousandPlusIsBoundedAndContainsTarget() throws {
        var nav = makeCoordinator(seekWindowSize: 128)
        let itemCount = 1_200
        _ = nav.reset(sessionKey: "s1", itemCount: itemCount)

        let effects = nav.navigateToUserPrompt(
            messageID: "u-first",
            transcriptIndex: 0,
            itemCount: itemCount,
            sessionKey: "s1"
        )

        XCTAssertTrue(nav.isSeeking)
        XCTAssertFalse(nav.pinToBottom)
        XCTAssertEqual(nav.pendingUserPromptID, "u-first")
        XCTAssertNil(nav.currentUserPromptID)

        let range = try XCTUnwrap(nav.seekMountedRange)
        XCTAssertTrue(range.contains(0), "target must stay inside mounted range")
        XCTAssertEqual(range.count, 128)
        XCTAssertLessThan(range.upperBound, itemCount)
        // Must not mount target→latest full span.
        XCTAssertNotEqual(range, 0..<itemCount)
        XCTAssertLessThan(range.count, itemCount)

        XCTAssertEqual(effects.first, .cancelPendingJumpWork)
        XCTAssertTrue(effects.contains(.invalidateHistoryPager))
        XCTAssertEqual(
            effects.last,
            .scrollToIndex(0, sessionKey: "s1", generation: nav.generation)
        )
        XCTAssertFalse(nav.historyPagerMayWriteScroll)
        XCTAssertFalse(nav.streamingMayWriteScroll)
        XCTAssertTrue(nav.jumpCoordinatorMayWriteScroll)
    }

    func testSeekAncientTargetDoesNotMountThroughLatest() throws {
        var nav = makeCoordinator(seekWindowSize: 64)
        let itemCount = 5_000
        _ = nav.reset(sessionKey: "s1", itemCount: itemCount)

        _ = nav.navigateToUserPrompt(
            messageID: "u-early",
            transcriptIndex: 12,
            itemCount: itemCount,
            sessionKey: "s1"
        )

        let range = try XCTUnwrap(nav.seekMountedRange)
        XCTAssertTrue(range.contains(12))
        XCTAssertEqual(range.count, 64)
        XCTAssertLessThan(range.upperBound, itemCount - 100)
        XCTAssertNotEqual(range, 12..<itemCount)
    }

    // MARK: - Consecutive requests

    func testConsecutiveNavigateLastWins() {
        var nav = makeCoordinator(seekWindowSize: 48)
        _ = nav.reset(sessionKey: "s1", itemCount: 800)

        let first = nav.navigateToUserPrompt(
            messageID: "u-a",
            transcriptIndex: 10,
            itemCount: 800,
            sessionKey: "s1"
        )
        let gen1 = nav.generation
        XCTAssertEqual(nav.pendingUserPromptID, "u-a")

        let second = nav.navigateToUserPrompt(
            messageID: "u-b",
            transcriptIndex: 400,
            itemCount: 800,
            sessionKey: "s1"
        )
        let gen2 = nav.generation

        XCTAssertNotEqual(gen1, gen2)
        XCTAssertEqual(nav.pendingUserPromptID, "u-b")
        XCTAssertEqual(nav.seekTargetIndex, 400)
        XCTAssertTrue(nav.seekMountedRange?.contains(400) == true)
        XCTAssertFalse(nav.isCurrent(sessionKey: "s1", generation: gen1))
        XCTAssertTrue(nav.isCurrent(sessionKey: "s1", generation: gen2))

        // Late first scroll must not mark current or arm corrections.
        XCTAssertEqual(nav.jumpScrollApplied(generation: gen1), [])
        XCTAssertNil(nav.currentUserPromptID)
        XCTAssertEqual(nav.pendingUserPromptID, "u-b")

        let armed = nav.jumpScrollApplied(generation: gen2)
        XCTAssertEqual(nav.currentUserPromptID, "u-b")
        XCTAssertNil(nav.pendingUserPromptID)
        XCTAssertEqual(
            armed,
            [.runCorrection(sessionKey: "s1", generation: gen2)]
        )

        XCTAssertEqual(
            first.last,
            .scrollToIndex(10, sessionKey: "s1", generation: gen1)
        )
        XCTAssertEqual(
            second.last,
            .scrollToIndex(400, sessionKey: "s1", generation: gen2)
        )
    }

    // MARK: - Return to latest

    func testReturnToLatestRestoresLive() {
        var nav = makeCoordinator()
        _ = nav.reset(sessionKey: "s1", itemCount: 500)
        _ = nav.navigateToUserPrompt(
            messageID: "u1",
            transcriptIndex: 20,
            itemCount: 500,
            sessionKey: "s1"
        )
        _ = nav.jumpScrollApplied(generation: nav.generation)
        XCTAssertEqual(nav.currentUserPromptID, "u1")
        XCTAssertTrue(nav.isSeeking)

        let effects = nav.returnToLatest()
        XCTAssertEqual(nav.viewport.mode, .liveLatest)
        XCTAssertTrue(nav.pinToBottom)
        XCTAssertEqual(nav.viewport.scrollOwner, .live)
        XCTAssertNil(nav.seekMountedRange)
        XCTAssertNil(nav.currentUserPromptID)
        XCTAssertNil(nav.pendingUserPromptID)
        XCTAssertFalse(nav.isSeeking)
        XCTAssertTrue(nav.streamingMayWriteScroll)
        XCTAssertTrue(nav.historyPagerMayWriteScroll)
        XCTAssertEqual(effects, [.cancelPendingJumpWork, .invalidateHistoryPager])
    }

    // MARK: - Stale session / generation

    func testOldSessionEffectIsInvalid() {
        var nav = makeCoordinator(maxCorrectionSteps: 2)
        _ = nav.reset(sessionKey: "session-a", itemCount: 300)
        _ = nav.navigateToUserPrompt(
            messageID: "u-old",
            transcriptIndex: 5,
            itemCount: 300,
            sessionKey: "session-a"
        )
        let oldGen = nav.generation
        let oldToken = TranscriptViewport.token(for: nav.viewport)

        let resetEffects = nav.reset(sessionKey: "session-b", itemCount: 80)
        XCTAssertEqual(resetEffects, [.cancelPendingJumpWork, .invalidateHistoryPager])
        XCTAssertEqual(nav.sessionKey, "session-b")
        XCTAssertEqual(nav.viewport.mode, .liveLatest)
        XCTAssertTrue(nav.pinToBottom)
        XCTAssertNil(nav.currentUserPromptID)
        XCTAssertFalse(nav.isCurrent(sessionKey: oldToken.sessionKey, generation: oldToken.generation))
        XCTAssertFalse(nav.isCurrent(sessionKey: "session-a", generation: oldGen))

        XCTAssertEqual(nav.jumpScrollApplied(generation: oldGen), [])
        XCTAssertEqual(nav.correctionApplied(generation: oldGen), [])
        XCTAssertNil(nav.currentUserPromptID)
    }

    func testUserScrollCancelsInFlightCorrections() {
        var nav = makeCoordinator(maxCorrectionSteps: 3)
        _ = nav.reset(sessionKey: "s1", itemCount: 400)
        _ = nav.navigateToUserPrompt(
            messageID: "u1",
            transcriptIndex: 40,
            itemCount: 400,
            sessionKey: "s1"
        )
        let gen = nav.generation
        _ = nav.jumpScrollApplied(generation: gen)
        XCTAssertEqual(nav.viewport.correctionsRemaining, 3)

        let effects = nav.userScrolled()
        XCTAssertEqual(effects, [.cancelPendingJumpWork, .invalidateHistoryPager])
        XCTAssertEqual(nav.viewport.scrollOwner, .user)
        XCTAssertEqual(nav.viewport.correctionsRemaining, 0)
        XCTAssertTrue(nav.isSeeking)
        XCTAssertFalse(nav.jumpCoordinatorMayWriteScroll)
        XCTAssertFalse(nav.isCurrent(sessionKey: "s1", generation: gen))
        XCTAssertEqual(nav.correctionApplied(generation: gen), [])

        // High-frequency repeats while already user-owned are no-ops.
        XCTAssertEqual(nav.userScrolled(), [])
    }

    /// Direct live upward browse (no seek): ownership → `.user`, then mounted
    /// visible anchors move current from last user node to an older on-screen node.
    func testLiveDirectScrollUpdatesCurrentFromLastToVisibleOlderUserNode() {
        var nav = makeCoordinator()
        _ = nav.reset(sessionKey: "s1", itemCount: 600)
        nav.currentUserPromptID = "u-last"
        XCTAssertEqual(nav.viewport.scrollOwner, .live)
        XCTAssertFalse(nav.mayUpdateCurrentFromVisibleAnchors)

        XCTAssertEqual(nav.userScrolled(), [])
        XCTAssertEqual(nav.viewport.scrollOwner, .user)
        XCTAssertTrue(nav.pinToBottom, "live pin remains StickToBottom-owned")
        XCTAssertTrue(nav.mayUpdateCurrentFromVisibleAnchors)
        XCTAssertEqual(nav.currentUserPromptID, "u-last")

        let anchors: [UserPromptCurrentAssociation.Anchor] = [
            .init(messageID: "u-older", midY: 130),
            .init(messageID: "u-last", midY: 480),
        ]
        XCTAssertTrue(
            nav.applyVisibleUserPromptAnchors(anchors, viewportHeight: 400)
        )
        XCTAssertEqual(nav.currentUserPromptID, "u-older")
        XCTAssertEqual(nav.viewport.mode, .liveLatest)
        XCTAssertNil(nav.seekMountedRange)
    }

    func testStreamAppendDuringSeekDoesNotExpandToLatestOrStealScroll() throws {
        var nav = makeCoordinator(seekWindowSize: 64)
        _ = nav.reset(sessionKey: "s1", itemCount: 1_000)
        _ = nav.navigateToUserPrompt(
            messageID: "u1",
            transcriptIndex: 30,
            itemCount: 1_000,
            sessionKey: "s1"
        )
        let original = try XCTUnwrap(nav.seekMountedRange)

        _ = nav.streamAppended(itemCount: 1_400)
        XCTAssertEqual(nav.seekMountedRange, original)
        XCTAssertEqual(nav.seekTargetIndex, 30)
        XCTAssertFalse(nav.streamingMayWriteScroll)
        XCTAssertFalse(nav.pinToBottom)
        XCTAssertTrue(nav.jumpCoordinatorMayWriteScroll)
    }

    func testUnknownMessageIDIsNoOp() {
        var nav = makeCoordinator()
        _ = nav.reset(sessionKey: "s1", itemCount: 100)
        let before = nav
        let effects = nav.navigateToUserPrompt(
            messageID: "missing",
            transcriptIndex: nil,
            itemCount: 100,
            sessionKey: "s1"
        )
        XCTAssertEqual(effects, [])
        XCTAssertEqual(nav.viewport.mode, before.viewport.mode)
        XCTAssertEqual(nav.generation, before.generation)
        XCTAssertNil(nav.pendingUserPromptID)
    }

    // MARK: - Production scroll wiring

    /// Exercises the same production seam ChatDetailView uses: preferences cache
    /// mounted layout rectangles first, then the AppKit-attributed user callback
    /// delivers the current clip. This deliberately does not inspect source text.
    func testProductionScrollWiringUsesCachedAnchorsAndRefreshesWindows() {
        var nav = makeCoordinator(maxCorrectionSteps: 0)
        _ = nav.reset(sessionKey: "s1", itemCount: 800)
        nav.currentUserPromptID = "u-last"
        var tracker = MountedUserPromptCurrentTracker()
        let liveRange = 768..<800
        let historyRange = 736..<768

        // Preference delivery while live/programmatic ownership is active caches
        // geometry but must not steal the live latest selection.
        tracker.replaceMountedAnchors([
            .init(messageID: "u-reading", layoutFrame: CGRect(x: 0, y: 250, width: 300, height: 40)),
            .init(messageID: "u-last", layoutFrame: CGRect(x: 0, y: 40, width: 300, height: 40)),
        ], mountedRange: liveRange)
        XCTAssertFalse(tracker.refreshCurrent(navigation: &nav))
        XCTAssertEqual(nav.currentUserPromptID, "u-last")
        XCTAssertEqual(nav.viewport.scrollOwner, .live)

        // This is the tracker callback for a real wheel/trackpad/knob event. No
        // second preference arrives, but cached document-space anchors update now.
        let effects = tracker.userScrolled(
            navigation: &nav,
            viewport: .init(layoutVisibleRect: CGRect(x: 0, y: 0, width: 600, height: 400)),
            mountedRange: liveRange
        )
        XCTAssertEqual(effects, [])
        XCTAssertEqual(nav.viewport.scrollOwner, .user)
        XCTAssertEqual(nav.currentUserPromptID, "u-reading")

        // A history/seek window swap scopes the incoming cache to a new range.
        // Until its anchors arrive, stale live rows cannot win and current never
        // falls back to the newest full-session prompt.
        tracker.mountedWindowDidChange(historyRange)
        _ = tracker.userScrolled(
            navigation: &nav,
            viewport: .init(layoutVisibleRect: CGRect(x: 0, y: 0, width: 600, height: 400)),
            mountedRange: historyRange
        )
        XCTAssertEqual(nav.currentUserPromptID, "u-reading")
        tracker.replaceMountedAnchors([
            .init(messageID: "u-history", layoutFrame: CGRect(x: 0, y: 250, width: 300, height: 40)),
        ], mountedRange: historyRange)
        XCTAssertTrue(tracker.refreshCurrent(navigation: &nav))
        XCTAssertEqual(nav.currentUserPromptID, "u-history")
    }

    /// Host-level: navigate invalidates in-flight pager; return-to-latest restores live.
    func testNavigateInvalidatesPendingPagerAndReturnRestoresLatest() {
        var nav = makeCoordinator(seekWindowSize: 64)
        _ = nav.reset(sessionKey: "s1", itemCount: 500)

        // Simulate production pager admitted a page just before seek.
        var pager = TranscriptHistoryPager.State.idle
        XCTAssertEqual(TranscriptHistoryPager.begin(currentStartPage: 6, state: &pager), 5)
        XCTAssertEqual(pager, .loading(targetPage: 5))

        let navEffects = nav.navigateToUserPrompt(
            messageID: "u-old",
            transcriptIndex: 10,
            itemCount: 500,
            sessionKey: "s1"
        )
        XCTAssertTrue(navEffects.contains(.invalidateHistoryPager))
        XCTAssertTrue(nav.isSeeking)

        // Host applies invalidate when it sees the effect / generation bump.
        TranscriptHistoryPager.invalidateInFlight(&pager)
        XCTAssertEqual(pager, .idle, "late 60ms complete must not see loading state")

        let returnEffects = nav.returnToLatest()
        XCTAssertTrue(returnEffects.contains(.invalidateHistoryPager))
        XCTAssertEqual(nav.viewport.mode, .liveLatest)
        XCTAssertTrue(nav.pinToBottom)
        XCTAssertTrue(nav.historyPagerMayWriteScroll)
        XCTAssertTrue(nav.streamingMayWriteScroll)
    }

    @MainActor
    func testInjectableMountScrollHostOrderAndStaleNoOp() async {
        var nav = makeCoordinator(seekWindowSize: 32)
        _ = nav.reset(sessionKey: "s1", itemCount: 200)
        let effects = nav.navigateToUserPrompt(
            messageID: "u1",
            transcriptIndex: 20,
            itemCount: 200,
            sessionKey: "s1"
        )
        guard case let .scrollToIndex(index, sessionKey, generation) = effects.last else {
            return XCTFail("expected scrollToIndex effect")
        }

        var events: [SeekFirstScrollPipeline.Event] = []
        var scrolls: [String] = []
        let request = SeekFirstScrollPipeline.Request(
            targetIndex: index,
            targetRowID: TranscriptRenderIdentity.scoped(sessionKey: sessionKey, localID: "u1"),
            sessionKey: sessionKey,
            generation: generation
        )

        // Happy path: prepare → mounted → scroll.
        let ok = await SeekFirstScrollPipeline.run(
            request: request,
            isCurrent: {
                nav.isCurrent(sessionKey: sessionKey, generation: generation)
                    && nav.jumpCoordinatorMayWriteScroll
            },
            host: .init(
                waitForMount: { _ in .mounted },
                performScroll: { req in scrolls.append(req.targetRowID) }
            ),
            onEvent: { events.append($0) }
        )
        XCTAssertTrue(ok)
        XCTAssertEqual(
            events.map(Self.eventLabel),
            ["prepare", "mounted", "scroll"]
        )
        XCTAssertEqual(scrolls.count, 1)

        // Supersede with return-to-latest: old generation must not scroll.
        _ = nav.returnToLatest()
        events.removeAll()
        scrolls.removeAll()
        let late = await SeekFirstScrollPipeline.run(
            request: request,
            isCurrent: {
                nav.isCurrent(sessionKey: sessionKey, generation: generation)
                    && nav.jumpCoordinatorMayWriteScroll
            },
            host: .init(
                waitForMount: { _ in .mounted },
                performScroll: { req in scrolls.append(req.targetRowID) }
            ),
            onEvent: { events.append($0) }
        )
        XCTAssertFalse(late)
        XCTAssertEqual(scrolls, [])
        XCTAssertEqual(events.last, .skipped(.stale))
    }

    private static func eventLabel(_ event: SeekFirstScrollPipeline.Event) -> String {
        switch event {
        case .prepare: return "prepare"
        case .mounted: return "mounted"
        case .scroll: return "scroll"
        case .skipped: return "skipped"
        }
    }

}
