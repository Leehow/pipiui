import XCTest
@testable import PipiUI

/// Near-top prefetch and one-page admission contracts. The legacy filename is
/// retained so this focused regression suite stays discoverable in existing CI.
final class TranscriptExactTopTriggerTests: XCTestCase {
    func testApproachBandStartsBeforeHardTop() {
        var state = TranscriptHistoryPrefetchTrigger.State()
        XCTAssertFalse(TranscriptHistoryPrefetchTrigger.step(
            state: &state,
            distanceFromDocumentStart: 1_300,
            enabled: true
        ))
        XCTAssertTrue(TranscriptHistoryPrefetchTrigger.step(
            state: &state,
            distanceFromDocumentStart: 600,
            enabled: true
        ))
        XCTAssertTrue(state.isInsideApproachBand)
    }

    func testSustainedApproachBandDoesNotRepeat() {
        var state = TranscriptHistoryPrefetchTrigger.State()
        XCTAssertTrue(TranscriptHistoryPrefetchTrigger.step(
            state: &state,
            distanceFromDocumentStart: 200,
            enabled: true
        ))
        for distance: CGFloat in [150, 20, 0, -3] {
            XCTAssertFalse(TranscriptHistoryPrefetchTrigger.step(
                state: &state,
                distanceFromDocumentStart: distance,
                enabled: true
            ))
        }
    }

    /// Bounds callbacks continue at display cadence inside the prefetch band.
    /// The edge reducer admits one plan/commit lifecycle only; no per-pixel
    /// planner work or structured lifecycle logging may be produced.
    func testFiveHundredNearTopCallbacksAdmitOnePreparedHistoryLifecycle() throws {
        var edge = TranscriptHistoryPrefetchTrigger.State()
        var preparation = TranscriptHistoryPreparation.State()
        var prepareAdmissions = 0
        var lifecycleLogTransitions = 0
        var commits = 0

        for _ in 0..<500 {
            guard TranscriptHistoryPrefetchTrigger.step(
                state: &edge,
                distanceFromDocumentStart: 120,
                enabled: true
            ) else { continue }

            let request = try XCTUnwrap(TranscriptHistoryPreparation.request(
                state: &preparation,
                sessionKey: "s",
                viewportGeneration: 1,
                itemCount: 320
            ))
            prepareAdmissions += 1
            lifecycleLogTransitions += 1 // prepare begin
            XCTAssertTrue(TranscriptHistoryPreparation.prepared(request, state: &preparation))
            lifecycleLogTransitions += 1 // prepare end
            XCTAssertTrue(TranscriptHistoryPreparation.beginCommit(request, state: &preparation))
            lifecycleLogTransitions += 1 // commit begin
            XCTAssertTrue(TranscriptHistoryPreparation.finishCommit(request, state: &preparation))
            lifecycleLogTransitions += 1 // commit end
            commits += 1
        }

        XCTAssertEqual(prepareAdmissions, 1)
        XCTAssertEqual(commits, 1)
        XCTAssertEqual(lifecycleLogTransitions, 4)
        XCTAssertTrue(edge.isInsideApproachBand)
    }

    func testLeavingBandRearmsNextPage() {
        var state = TranscriptHistoryPrefetchTrigger.State()
        XCTAssertTrue(TranscriptHistoryPrefetchTrigger.step(
            state: &state,
            distanceFromDocumentStart: 250,
            enabled: true
        ))
        XCTAssertFalse(TranscriptHistoryPrefetchTrigger.step(
            state: &state,
            distanceFromDocumentStart: 900,
            enabled: true
        ))
        XCTAssertTrue(TranscriptHistoryPrefetchTrigger.step(
            state: &state,
            distanceFromDocumentStart: 319,
            enabled: true
        ))
    }

    func testDisabledResetsBandAndNeverTriggers() {
        var state = TranscriptHistoryPrefetchTrigger.State(isInsideApproachBand: true)
        XCTAssertFalse(TranscriptHistoryPrefetchTrigger.step(
            state: &state,
            distanceFromDocumentStart: 0,
            enabled: false
        ))
        XCTAssertFalse(state.isInsideApproachBand)
        XCTAssertTrue(TranscriptHistoryPrefetchTrigger.step(
            state: &state,
            distanceFromDocumentStart: 0,
            enabled: true
        ))
    }

    func testViewportDerivedThresholdClampsAndBoundaryIsInclusive() {
        XCTAssertEqual(TranscriptHistoryPrefetchTrigger.threshold(viewportHeight: 200), 640)
        XCTAssertEqual(TranscriptHistoryPrefetchTrigger.threshold(viewportHeight: 500), 1_000)
        XCTAssertEqual(TranscriptHistoryPrefetchTrigger.threshold(viewportHeight: 2_000), 2_400)
        let threshold = TranscriptHistoryPrefetchTrigger.threshold(viewportHeight: 500)
        var at = TranscriptHistoryPrefetchTrigger.State()
        XCTAssertTrue(TranscriptHistoryPrefetchTrigger.step(
            state: &at, distanceFromDocumentStart: threshold, enabled: true, threshold: threshold
        ))
        var past = TranscriptHistoryPrefetchTrigger.State()
        XCTAssertFalse(TranscriptHistoryPrefetchTrigger.step(
            state: &past, distanceFromDocumentStart: threshold + 0.5, enabled: true, threshold: threshold
        ))
    }

    func testFollowSuppressionIsImmediateAndPersistentWritesCoalesce() {
        var state = TranscriptFollowSuppression.State()
        XCTAssertTrue(state.allowsFollow(isPinned: true))
        state.suppressImmediately()
        XCTAssertFalse(state.allowsFollow(isPinned: true), "stream must not follow during pin-write gap")
        XCTAssertTrue(state.enqueuePersistentPin(false))
        for _ in 0..<12 {
            XCTAssertFalse(state.enqueuePersistentPin(false))
        }
        XCTAssertEqual(state.takePersistentPin(), false)
        XCTAssertNil(state.takePersistentPin())
        // Only an explicit latest intent may reopen follow after detach.
        state.resumeForExplicitLatest()
        XCTAssertTrue(state.enqueuePersistentPin(true))
        XCTAssertEqual(state.takePersistentPin(), true)
        state.didWritePersistentPin(true)
        XCTAssertTrue(state.allowsFollow(isPinned: true))
    }

    func testPreparationRejectsDuplicateAndStaleCommit() {
        var state = TranscriptHistoryPreparation.State()
        let first = TranscriptHistoryPreparation.request(
            state: &state, sessionKey: "s", viewportGeneration: 1, itemCount: 160
        )!
        XCTAssertNil(TranscriptHistoryPreparation.request(
            state: &state, sessionKey: "s", viewportGeneration: 1, itemCount: 160
        ))
        XCTAssertTrue(TranscriptHistoryPreparation.prepared(first, state: &state))
        TranscriptHistoryPreparation.invalidate(&state, clearCommittedPage: true)
        XCTAssertFalse(TranscriptHistoryPreparation.beginCommit(first, state: &state))

        let next = TranscriptHistoryPreparation.request(
            state: &state, sessionKey: "s", viewportGeneration: 2, itemCount: 160
        )!
        XCTAssertTrue(TranscriptHistoryPreparation.prepared(next, state: &state))
        XCTAssertTrue(TranscriptHistoryPreparation.beginCommit(next, state: &state))
        XCTAssertTrue(TranscriptHistoryPreparation.finishCommit(next, state: &state))
        XCTAssertEqual(state.committedPage, next.targetPage)
    }

    /// User-owned history prefetch may start before the old 4pt distance release.
    /// The commit transaction must therefore detach synchronously before its window
    /// changes, and retain that detach through document/proxy/anchor callbacks.
    func testUserOwnedPreparedCommitSuppressesFollowWhileLatestWarmWindowSlidesAcrossThreePages() {
        var viewport = TranscriptViewport.State(
            sessionKey: "s",
            itemCount: 320,
            mode: .liveLatest,
            generation: 0,
            scrollOwner: .live,
            pinToBottom: true,
            correctionsRemaining: 0
        )
        _ = TranscriptViewport.reduce(&viewport, .userScrolled)
        XCTAssertEqual(viewport.scrollOwner, .user)
        XCTAssertTrue(viewport.pinToBottom, "this is the pre-threshold user-scroll gap")

        let intent = TranscriptFollowIntent()
        var preparation = TranscriptHistoryPreparation.State()
        var priorWindow = TranscriptRenderWindow.resolve(
            itemCount: viewport.itemCount,
            oldestLoadedPage: nil
        )
        var bottomFollowEffects = 0

        for _ in 0..<3 {
            let request = try! XCTUnwrap(TranscriptHistoryPreparation.request(
                state: &preparation,
                sessionKey: "s",
                viewportGeneration: viewport.generation,
                itemCount: viewport.itemCount
            ))
            XCTAssertTrue(TranscriptHistoryPreparation.prepared(request, state: &preparation))
            XCTAssertTrue(preparation.isLoading, "loading overlay remains fixed while preparing")

            // `beginCommit` is reducer-local; suppression and the durable user
            // detach must both land before `finishCommit` exposes the new range.
            XCTAssertTrue(TranscriptHistoryPreparation.beginCommit(request, state: &preparation))
            _ = TranscriptViewport.reduce(&viewport, .historyCommitBegan)
            let token = intent.beginHistoryCommit(request: request)
            XCTAssertEqual(viewport.scrollOwner, .user)
            XCTAssertFalse(viewport.pinToBottom)
            XCTAssertTrue(intent.isHistoryCommitActive)
            XCTAssertFalse(intent.enqueuePersistentPin(true), "stale re-pin loses to history detach")

            // stream append, document frame, bounds, pinned follow, proxy retry,
            // resize recovery, programmatic anchor restore, didEndLiveScroll.
            for _ in 0..<8 where intent.allowsAutomaticFollow(isPinned: true) {
                bottomFollowEffects += 1
            }

            // The latest warm window is already at the four-page ceiling, so
            // every admitted older page slides exactly one raw page toward history.
            XCTAssertEqual(request.window.range.lowerBound, priorWindow.range.lowerBound - 32)
            XCTAssertEqual(request.window.range.upperBound, priorWindow.range.upperBound - 32)
            XCTAssertLessThanOrEqual(
                request.window.range.count,
                TranscriptRenderWindow.maxPages * TranscriptRenderWindow.pageSize
            )

            XCTAssertTrue(TranscriptHistoryPreparation.finishCommit(request, state: &preparation))
            XCTAssertTrue(intent.completeHistoryCommit(token))
            priorWindow = request.window
            XCTAssertFalse(intent.isHistoryCommitActive)
            XCTAssertFalse(
                intent.allowsAutomaticFollow(isPinned: true),
                "commit completion must not re-pin a detached user"
            )
        }

        XCTAssertEqual(bottomFollowEffects, 0)
        XCTAssertEqual(viewport.scrollOwner, .user)
        XCTAssertFalse(viewport.pinToBottom, "all committed pages retain persistent detach")
        _ = TranscriptViewport.reduce(&viewport, .returnToLatest)
        intent.resumeForExplicitLatest()
        XCTAssertTrue(intent.allowsAutomaticFollow(isPinned: true))
    }


    func testPinnedSafetyBackfillDoesNotSuppressNormalFollow() {
        var viewport = TranscriptViewport.State(
            sessionKey: "s",
            itemCount: 96,
            mode: .liveLatest,
            generation: 0,
            scrollOwner: .live,
            pinToBottom: true,
            correctionsRemaining: 0
        )
        let intent = TranscriptFollowIntent()

        // Safety backfill has no real user owner, so it must retain normal live
        // follow rather than taking the history-detach path.
        _ = TranscriptViewport.reduce(&viewport, .historyCommitBegan)
        XCTAssertEqual(viewport.scrollOwner, .live)
        XCTAssertTrue(viewport.pinToBottom)
        XCTAssertTrue(intent.allowsAutomaticFollow(isPinned: true))
    }

    func testPagerRejectsDuplicateAndStopsAtPageZero() {
        var state = TranscriptHistoryPager.State.idle
        XCTAssertEqual(TranscriptHistoryPager.begin(currentStartPage: 3, state: &state), 2)
        XCTAssertEqual(state, .loading(targetPage: 2))
        XCTAssertNil(TranscriptHistoryPager.begin(currentStartPage: 3, state: &state))

        state = TranscriptHistoryPager.complete(loadedPage: 2)
        XCTAssertEqual(state, .idle)
        XCTAssertEqual(TranscriptHistoryPager.begin(currentStartPage: 1, state: &state), 0)
        state = TranscriptHistoryPager.complete(loadedPage: 0)
        XCTAssertEqual(state, .exhausted)
        XCTAssertNil(TranscriptHistoryPager.begin(currentStartPage: 0, state: &state))
    }

    func testPagerInvalidateInFlightClearsLoadingOnly() {
        var state = TranscriptHistoryPager.State.loading(targetPage: 2)
        TranscriptHistoryPager.invalidateInFlight(&state)
        XCTAssertEqual(state, .idle)

        state = .exhausted
        TranscriptHistoryPager.invalidateInFlight(&state)
        XCTAssertEqual(state, .exhausted)

        state = .idle
        TranscriptHistoryPager.invalidateInFlight(&state)
        XCTAssertEqual(state, .idle)
    }

    func testAllCollapsedWindowForcesExactlyLatestRow() {
        XCTAssertEqual(
            TranscriptVisibleRowFallback.forcedRowID(
                orderedRowIDs: ["thinking-a", "thinking-b"],
                naturallyVisibleRowIDs: []
            ),
            "thinking-b"
        )
        XCTAssertNil(TranscriptVisibleRowFallback.forcedRowID(
            orderedRowIDs: ["a", "b"],
            naturallyVisibleRowIDs: ["a"]
        ))
        XCTAssertNil(TranscriptVisibleRowFallback.forcedRowID(
            orderedRowIDs: [],
            naturallyVisibleRowIDs: []
        ))
    }
}
