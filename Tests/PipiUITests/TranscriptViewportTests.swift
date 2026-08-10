import XCTest
@testable import PipiUI

/// Pure logic seam B: viewport / jump reducer — modes, generation invalidation,
/// cancel sources, and scroll-ownership flags (seek vs history pager vs streaming).
final class TranscriptViewportTests: XCTestCase {

    private typealias VP = TranscriptViewport

    private func liveState(
        sessionKey: String = "s1",
        itemCount: Int = 1_000,
        generation: UInt64 = 0
    ) -> VP.State {
        VP.State(
            sessionKey: sessionKey,
            itemCount: itemCount,
            mode: .liveLatest,
            generation: generation,
            scrollOwner: .live,
            pinToBottom: true,
            correctionsRemaining: 0
        )
    }

    // MARK: - Seek range

    func testSeekRangeContainsTargetAndIsBounded() {
        let windowSize = 128
        let count = 10_000
        for target in [0, 1, 64, 500, 5_000, 9_935, 9_999] {
            let range = VP.seekRange(
                targetIndex: target,
                itemCount: count,
                windowSize: windowSize
            )
            XCTAssertTrue(range.contains(target), "target \(target) not in \(range)")
            XCTAssertEqual(range.count, windowSize)
            XCTAssertGreaterThanOrEqual(range.lowerBound, 0)
            XCTAssertLessThanOrEqual(range.upperBound, count)
        }
    }

    func testSeekRangeNeverFormsTargetToLatestFullSpan() {
        let windowSize = 128
        let count = 5_000
        // Ancient target: upper bound must stay near the target, not at latest.
        let range = VP.seekRange(targetIndex: 10, itemCount: count, windowSize: windowSize)
        XCTAssertTrue(range.contains(10))
        XCTAssertEqual(range.count, windowSize)
        XCTAssertLessThan(range.upperBound, count)
        XCTAssertNotEqual(range, 10..<count)
        // Distance from target to latest far exceeds the window.
        XCTAssertLessThan(range.count, count - 10)
    }

    func testSeekRangeShrinksAtTranscriptEdges() {
        let windowSize = 128
        // Short transcript: full mount is OK (not a long target→latest span).
        XCTAssertEqual(
            VP.seekRange(targetIndex: 3, itemCount: 40, windowSize: windowSize),
            0..<40
        )
        // Empty.
        XCTAssertEqual(
            VP.seekRange(targetIndex: 0, itemCount: 0, windowSize: windowSize),
            0..<0
        )
        // Near start of a long transcript.
        let head = VP.seekRange(targetIndex: 2, itemCount: 1_000, windowSize: windowSize)
        XCTAssertEqual(head.lowerBound, 0)
        XCTAssertEqual(head.count, windowSize)
        XCTAssertTrue(head.contains(2))
        // Near end.
        let tail = VP.seekRange(targetIndex: 999, itemCount: 1_000, windowSize: windowSize)
        XCTAssertEqual(tail.upperBound, 1_000)
        XCTAssertEqual(tail.count, windowSize)
        XCTAssertTrue(tail.contains(999))
    }

    func testSeekRangeClampsOutOfBoundsTarget() {
        let range = VP.seekRange(targetIndex: -20, itemCount: 500, windowSize: 64)
        XCTAssertTrue(range.contains(0))
        let high = VP.seekRange(targetIndex: 9_999, itemCount: 500, windowSize: 64)
        XCTAssertTrue(high.contains(499))
    }

    func testSeekRangeRespectsConfiguredWindowSize() {
        let small = VP.seekRange(targetIndex: 200, itemCount: 1_000, windowSize: 16)
        let large = VP.seekRange(targetIndex: 200, itemCount: 1_000, windowSize: 256)
        XCTAssertEqual(small.count, 16)
        XCTAssertEqual(large.count, 256)
        XCTAssertTrue(small.contains(200))
        XCTAssertTrue(large.contains(200))
    }

    // MARK: - Navigate / return

    func testNavigateEntersSeekExitsPinAndOwnsScroll() {
        var state = liveState()
        let effects = VP.reduce(&state, .navigate(targetIndex: 42), config: .init(seekWindowSize: 128))

        guard case .seek(let target, let range) = state.mode else {
            return XCTFail("expected seek mode")
        }
        XCTAssertEqual(target, 42)
        XCTAssertTrue(range.contains(42))
        XCTAssertEqual(range.count, 128)
        XCTAssertFalse(state.pinToBottom)
        XCTAssertEqual(state.scrollOwner, .jumpCoordinator)
        XCTAssertTrue(state.jumpCoordinatorMayWriteScroll)
        XCTAssertFalse(state.historyPagerMayWriteScroll)
        XCTAssertFalse(state.streamingMayWriteScroll)
        XCTAssertEqual(state.generation, 1)
        XCTAssertEqual(effects.first, .cancelPendingJumpWork)
        XCTAssertTrue(effects.contains(.invalidateHistoryPager))
        XCTAssertEqual(
            effects.last,
            .scrollToIndex(42, sessionKey: "s1", generation: 1)
        )
    }

    func testReturnToLatestRestoresLiveSemantics() {
        var state = liveState()
        _ = VP.reduce(&state, .navigate(targetIndex: 10))
        let effects = VP.reduce(&state, .returnToLatest)

        XCTAssertEqual(state.mode, .liveLatest)
        XCTAssertTrue(state.pinToBottom)
        XCTAssertEqual(state.scrollOwner, .live)
        XCTAssertEqual(state.correctionsRemaining, 0)
        XCTAssertTrue(state.streamingMayWriteScroll)
        XCTAssertTrue(state.historyPagerMayWriteScroll)
        XCTAssertFalse(state.isSeeking)
        XCTAssertEqual(effects, [.cancelPendingJumpWork, .invalidateHistoryPager])
    }

    func testConsecutiveNavigateSupersedesPreviousGeneration() {
        var state = liveState()
        let first = VP.reduce(&state, .navigate(targetIndex: 10))
        let gen1 = state.generation
        let second = VP.reduce(&state, .navigate(targetIndex: 80))
        let gen2 = state.generation

        XCTAssertNotEqual(gen1, gen2)
        guard case .seek(let target, _) = state.mode else {
            return XCTFail("expected seek")
        }
        XCTAssertEqual(target, 80)
        // Late first scroll must not match.
        XCTAssertFalse(VP.isCurrent(sessionKey: "s1", generation: gen1, state: state))
        XCTAssertTrue(VP.isCurrent(sessionKey: "s1", generation: gen2, state: state))
        XCTAssertEqual(
            first.last,
            .scrollToIndex(10, sessionKey: "s1", generation: gen1)
        )
        XCTAssertEqual(
            second.last,
            .scrollToIndex(80, sessionKey: "s1", generation: gen2)
        )
    }

    // MARK: - Generation / late effects

    func testLateJumpScrollAndCorrectionNoOp() {
        var state = liveState()
        _ = VP.reduce(&state, .navigate(targetIndex: 5))
        let staleGen = state.generation
        _ = VP.reduce(&state, .navigate(targetIndex: 90))
        let liveGen = state.generation

        XCTAssertEqual(VP.reduce(&state, .jumpScrollApplied(generation: staleGen)), [])
        XCTAssertEqual(state.correctionsRemaining, 0)

        let armed = VP.reduce(
            &state,
            .jumpScrollApplied(generation: liveGen),
            config: .init(maxCorrectionSteps: 2)
        )
        XCTAssertEqual(state.correctionsRemaining, 2)
        XCTAssertEqual(armed, [.runCorrection(sessionKey: "s1", generation: liveGen)])

        // Stale correction after a newer navigate.
        _ = VP.reduce(&state, .navigate(targetIndex: 1))
        XCTAssertEqual(VP.reduce(&state, .correctionApplied(generation: liveGen)), [])
        XCTAssertEqual(state.correctionsRemaining, 0)
    }

    func testFiniteCorrectionsThenStop() {
        var state = liveState()
        _ = VP.reduce(&state, .navigate(targetIndex: 20))
        let gen = state.generation
        _ = VP.reduce(&state, .jumpScrollApplied(generation: gen), config: .init(maxCorrectionSteps: 2))

        let c1 = VP.reduce(&state, .correctionApplied(generation: gen))
        XCTAssertEqual(state.correctionsRemaining, 1)
        XCTAssertEqual(c1, [.runCorrection(sessionKey: "s1", generation: gen)])

        let c2 = VP.reduce(&state, .correctionApplied(generation: gen))
        XCTAssertEqual(state.correctionsRemaining, 0)
        XCTAssertEqual(c2, [])

        // Extra ticks are no-ops.
        XCTAssertEqual(VP.reduce(&state, .correctionApplied(generation: gen)), [])
    }

    func testZeroCorrectionBudgetSkipsCorrectionEffects() {
        var state = liveState()
        _ = VP.reduce(&state, .navigate(targetIndex: 3))
        let gen = state.generation
        let effects = VP.reduce(
            &state,
            .jumpScrollApplied(generation: gen),
            config: .init(maxCorrectionSteps: 0)
        )
        XCTAssertEqual(state.correctionsRemaining, 0)
        XCTAssertEqual(effects, [])
    }

    // MARK: - User scroll cancels correction

    func testUserScrollDuringSeekCancelsCoordinatorAndCorrections() {
        var state = liveState()
        _ = VP.reduce(&state, .navigate(targetIndex: 50))
        let gen = state.generation
        _ = VP.reduce(&state, .jumpScrollApplied(generation: gen), config: .init(maxCorrectionSteps: 3))
        XCTAssertEqual(state.correctionsRemaining, 3)

        let effects = VP.reduce(&state, .userScrolled)
        XCTAssertEqual(state.scrollOwner, .user)
        XCTAssertEqual(state.correctionsRemaining, 0)
        XCTAssertTrue(state.isSeeking, "user takeover keeps seek window")
        XCTAssertFalse(state.jumpCoordinatorMayWriteScroll)
        XCTAssertFalse(state.historyPagerMayWriteScroll)
        XCTAssertFalse(state.streamingMayWriteScroll)
        XCTAssertEqual(effects, [.cancelPendingJumpWork, .invalidateHistoryPager])
        // Previous generation is stale.
        XCTAssertFalse(VP.isCurrent(sessionKey: "s1", generation: gen, state: state))
        XCTAssertEqual(VP.reduce(&state, .correctionApplied(generation: gen)), [])
    }

    // MARK: - Session switch

    func testSessionSwitchDropsLateEffectsFromPriorSession() {
        var state = liveState(sessionKey: "a", itemCount: 200)
        _ = VP.reduce(&state, .navigate(targetIndex: 10))
        let oldToken = VP.token(for: state)

        let effects = VP.reduce(&state, .reset(sessionKey: "b", itemCount: 80))
        XCTAssertEqual(state.sessionKey, "b")
        XCTAssertEqual(state.mode, .liveLatest)
        XCTAssertTrue(state.pinToBottom)
        XCTAssertEqual(state.scrollOwner, .live)
        XCTAssertEqual(state.itemCount, 80)
        XCTAssertEqual(effects, [.cancelPendingJumpWork, .invalidateHistoryPager])
        XCTAssertFalse(VP.isCurrent(oldToken, state: state))

        // Late callback from session a must no-op.
        XCTAssertEqual(
            VP.reduce(&state, .jumpScrollApplied(generation: oldToken.generation)),
            []
        )
    }

    // MARK: - History pager ownership

    func testHistoryExpandFromLive() {
        var state = liveState(itemCount: 200)
        // latestStartPage(200) = 3; expand → 2
        let effects = VP.reduce(&state, .requestHistoryPage)
        XCTAssertEqual(effects, [])
        guard case .history(let page) = state.mode else {
            return XCTFail("expected history mode")
        }
        XCTAssertEqual(page, 2)
        XCTAssertFalse(state.pinToBottom)
        XCTAssertEqual(state.scrollOwner, .historyPager)
        XCTAssertTrue(state.historyPagerMayWriteScroll)
        XCTAssertFalse(state.streamingMayWriteScroll)
    }

    func testHistoryRequestDuringSeekIsIgnored() {
        var state = liveState(itemCount: 500)
        _ = VP.reduce(&state, .navigate(targetIndex: 20), config: .init(seekWindowSize: 64))
        let before = state

        XCTAssertEqual(VP.reduce(&state, .requestHistoryPage), [])
        XCTAssertEqual(state.mode, before.mode)
        XCTAssertEqual(state.scrollOwner, .jumpCoordinator)
        XCTAssertFalse(state.historyPagerMayWriteScroll)

        // Async apply also denied while seeking.
        XCTAssertEqual(VP.reduce(&state, .applyHistoryPage(oldestLoadedPage: 0)), [])
        XCTAssertEqual(state.scrollOwner, .jumpCoordinator)
        guard case .seek = state.mode else {
            return XCTFail("must remain seek")
        }
    }

    func testApplyHistoryPageOutsideSeek() {
        var state = liveState(itemCount: 200)
        _ = VP.reduce(&state, .requestHistoryPage)
        _ = VP.reduce(&state, .applyHistoryPage(oldestLoadedPage: 3))
        guard case .history(let page) = state.mode else {
            return XCTFail("expected history")
        }
        XCTAssertEqual(page, 3)
    }

    // MARK: - Streaming

    func testStreamAppendInLiveKeepsStickOwnership() {
        var state = liveState(itemCount: 100)
        XCTAssertTrue(state.streamingMayWriteScroll)
        _ = VP.reduce(&state, .streamAppended(itemCount: 140))
        XCTAssertEqual(state.itemCount, 140)
        XCTAssertEqual(state.mode, .liveLatest)
        XCTAssertTrue(state.pinToBottom)
        XCTAssertEqual(state.scrollOwner, .live)
        XCTAssertTrue(state.streamingMayWriteScroll)
    }

    /// Regression seam: real user scroll ownership changes synchronously while
    /// StickToBottom's persistent `pinToBottom = false` is still coalesced. A
    /// stream append in that gap must already be denied write access.
    func testUserTakeoverImmediatelyBlocksStreamingBeforePersistentUnpin() {
        var state = liveState(itemCount: 100)
        XCTAssertTrue(state.pinToBottom)
        XCTAssertTrue(state.streamingMayWriteScroll)

        _ = VP.reduce(&state, .userScrolled)
        XCTAssertTrue(state.pinToBottom, "persistent pin is intentionally deferred elsewhere")
        XCTAssertEqual(state.scrollOwner, .user)
        XCTAssertFalse(state.streamingMayWriteScroll)

        _ = VP.reduce(&state, .streamAppended(itemCount: 101))
        XCTAssertEqual(state.itemCount, 101)
        XCTAssertEqual(state.scrollOwner, .user)
        XCTAssertFalse(state.streamingMayWriteScroll)

        // Explicit latest return restores the live writer.
        _ = VP.reduce(&state, .returnToLatest)
        XCTAssertEqual(state.scrollOwner, .live)
        XCTAssertTrue(state.streamingMayWriteScroll)
    }

    /// The host only writes @State / runs cancellation effects when the reducer
    /// changes semantic viewport state. Repeated explicit-latest callbacks after
    /// recovery must be no-ops, not generation churn on every bounds pulse.
    func testFiveHundredExplicitLatestCallbacksRestoreOnlyOnce() {
        var state = liveState(itemCount: 320)
        _ = VP.reduce(&state, .userScrolled)
        XCTAssertEqual(state.scrollOwner, .user)

        var stateMutations = 0
        var restoreTransitions = 0
        var cancellationEffects = 0
        var historyInvalidations = 0
        for _ in 0..<500 {
            let before = state
            let effects = VP.reduce(&state, .returnToLatest)
            if state != before {
                stateMutations += 1
            }
            if before.scrollOwner != .live, state.scrollOwner == .live {
                restoreTransitions += 1
            }
            cancellationEffects += effects.filter { $0 == .cancelPendingJumpWork }.count
            historyInvalidations += effects.filter { $0 == .invalidateHistoryPager }.count
        }

        XCTAssertEqual(stateMutations, 1)
        XCTAssertEqual(restoreTransitions, 1)
        XCTAssertEqual(cancellationEffects, 1)
        XCTAssertEqual(historyInvalidations, 1)
        XCTAssertEqual(state.scrollOwner, .live)
        XCTAssertTrue(state.streamingMayWriteScroll)
    }

    func testUserOwnedHistoryCommitUnpinsWithoutGivingPagerOwnership() {
        var state = liveState(itemCount: 320)
        _ = VP.reduce(&state, .userScrolled)
        let generationBefore = state.generation

        let effects = VP.reduce(&state, .historyCommitBegan)
        XCTAssertEqual(effects, [])
        XCTAssertEqual(state.mode, .liveLatest, "prepared history owns its own window reducer")
        XCTAssertEqual(state.scrollOwner, .user)
        XCTAssertFalse(state.pinToBottom)
        XCTAssertFalse(state.streamingMayWriteScroll)
        XCTAssertEqual(state.generation, generationBefore, "request token remains valid through commit")

        _ = VP.reduce(&state, .streamAppended(itemCount: 321))
        XCTAssertEqual(state.scrollOwner, .user)
        XCTAssertFalse(state.pinToBottom)
    }

    func testStreamAppendInSeekDoesNotStealScrollOrExpandToLatest() {
        var state = liveState(itemCount: 1_000)
        _ = VP.reduce(&state, .navigate(targetIndex: 30), config: .init(seekWindowSize: 64))
        guard case .seek(_, let originalRange) = state.mode else {
            return XCTFail("expected seek")
        }
        XCTAssertFalse(state.streamingMayWriteScroll)

        _ = VP.reduce(&state, .streamAppended(itemCount: 1_200))
        guard case .seek(let target, let range) = state.mode else {
            return XCTFail("expected seek after append")
        }
        XCTAssertEqual(target, 30)
        XCTAssertEqual(range, originalRange, "append must not re-center or grow toward latest")
        XCTAssertLessThan(range.count, 1_200 - 30)
        XCTAssertEqual(state.scrollOwner, .jumpCoordinator)
        XCTAssertFalse(state.streamingMayWriteScroll)
        XCTAssertFalse(state.pinToBottom)
    }

    // MARK: - Mounted range

    func testMountedRangeLiveMatchesRenderWindow() {
        var state = liveState(itemCount: 200)
        XCTAssertEqual(
            state.mountedRange(),
            TranscriptRenderWindow.resolve(itemCount: 200, oldestLoadedPage: nil).range
        )
        _ = VP.reduce(&state, .requestHistoryPage)
        guard case .history(let page) = state.mode else {
            return XCTFail("history")
        }
        XCTAssertEqual(
            state.mountedRange(),
            TranscriptRenderWindow.resolve(itemCount: 200, oldestLoadedPage: page).range
        )
    }

    func testMountedRangeSeekIsConfiguredBound() {
        var state = liveState(itemCount: 2_000)
        let config = VP.Config(seekWindowSize: 48)
        _ = VP.reduce(&state, .navigate(targetIndex: 900), config: config)
        let mounted = state.mountedRange(config: config)
        XCTAssertEqual(mounted.count, 48)
        XCTAssertTrue(mounted.contains(900))
        // Prove we did not mount target→latest.
        XCTAssertNotEqual(mounted.upperBound, 2_000)
        XCTAssertLessThan(mounted.count, 2_000 - 900)
    }

    // MARK: - Return / navigate cancel history

    func testNavigateFromHistoryEntersSeek() {
        var state = liveState(itemCount: 200)
        _ = VP.reduce(&state, .requestHistoryPage)
        _ = VP.reduce(&state, .navigate(targetIndex: 12), config: .init(seekWindowSize: 32))
        guard case .seek(let target, let range) = state.mode else {
            return XCTFail("expected seek from history")
        }
        XCTAssertEqual(target, 12)
        XCTAssertTrue(range.contains(12))
        XCTAssertEqual(state.scrollOwner, .jumpCoordinator)
        XCTAssertFalse(state.historyPagerMayWriteScroll)
    }

    func testReturnToLatestFromHistoryRestoresWarmWindowIdempotently() {
        var state = liveState(itemCount: 200)
        _ = VP.reduce(&state, .requestHistoryPage)
        _ = VP.reduce(&state, .returnToLatest)
        XCTAssertEqual(state.mode, .liveLatest)
        XCTAssertTrue(state.pinToBottom)
        XCTAssertEqual(state.scrollOwner, .live)
        XCTAssertEqual(state.mountedRange(), 96..<200)
        XCTAssertEqual(VP.reduce(&state, .returnToLatest), [])
        XCTAssertEqual(state.mountedRange(), 96..<200)
    }

    // MARK: - Default config alignment

    func testDefaultSeekWindowMatchesEagerRenderCap() {
        XCTAssertEqual(
            VP.Config.default.seekWindowSize,
            TranscriptRenderWindow.maxPages * TranscriptRenderWindow.pageSize
        )
        XCTAssertEqual(VP.Config.default.maxCorrectionSteps, 3)
    }

    // MARK: - Seek first-scroll pipeline (injectable host)

    @MainActor
    func testSeekFirstScrollPipelinePrepareMountedScrollOrder() async {
        let request = SeekFirstScrollPipeline.Request(
            targetIndex: 12,
            targetRowID: "s1:u-12",
            sessionKey: "s1",
            generation: 3
        )
        var events: [SeekFirstScrollPipeline.Event] = []
        var scrollCount = 0

        let scrolled = await SeekFirstScrollPipeline.run(
            request: request,
            isCurrent: { true },
            host: .init(
                waitForMount: { _ in .mounted },
                performScroll: { _ in scrollCount += 1 }
            ),
            onEvent: { events.append($0) }
        )

        XCTAssertTrue(scrolled)
        XCTAssertEqual(scrollCount, 1)
        XCTAssertEqual(
            events,
            [
                .prepare(sessionKey: "s1", generation: 3, targetIndex: 12),
                .mounted(sessionKey: "s1", generation: 3, targetIndex: 12),
                .scroll(sessionKey: "s1", generation: 3, targetIndex: 12),
            ]
        )
    }

    @MainActor
    func testSeekFirstScrollPipelineStaleGenerationNoScroll() async {
        let request = SeekFirstScrollPipeline.Request(
            targetIndex: 1,
            targetRowID: "s1:u-1",
            sessionKey: "s1",
            generation: 1
        )
        var events: [SeekFirstScrollPipeline.Event] = []
        var currentGen: UInt64 = 1
        var scrollCount = 0

        let scrolled = await SeekFirstScrollPipeline.run(
            request: request,
            isCurrent: { currentGen == 1 },
            host: .init(
                waitForMount: { _ in
                    // Superseded while waiting for mount.
                    currentGen = 2
                    return .mounted
                },
                performScroll: { _ in scrollCount += 1 }
            ),
            onEvent: { events.append($0) }
        )

        XCTAssertFalse(scrolled)
        XCTAssertEqual(scrollCount, 0)
        XCTAssertEqual(events.first, .prepare(sessionKey: "s1", generation: 1, targetIndex: 1))
        XCTAssertEqual(events.last, .skipped(.stale))
    }

    @MainActor
    func testSeekFirstScrollPipelineStaleSessionNoScroll() async {
        let request = SeekFirstScrollPipeline.Request(
            targetIndex: 4,
            targetRowID: "a:u-4",
            sessionKey: "a",
            generation: 9
        )
        var session = "a"
        var scrollCount = 0

        let scrolled = await SeekFirstScrollPipeline.run(
            request: request,
            isCurrent: { session == "a" },
            host: .init(
                waitForMount: { _ in
                    session = "b"
                    return .mounted
                },
                performScroll: { _ in scrollCount += 1 }
            )
        )

        XCTAssertFalse(scrolled)
        XCTAssertEqual(scrollCount, 0)
    }

    @MainActor
    func testSeekFirstScrollPipelineCancelAndTimeoutNoScroll() async {
        let request = SeekFirstScrollPipeline.Request(
            targetIndex: 0,
            targetRowID: "s1:u-0",
            sessionKey: "s1",
            generation: 2
        )

        for mount in [SeekFirstScrollPipeline.MountResult.cancelled, .timedOut] {
            var scrollCount = 0
            var events: [SeekFirstScrollPipeline.Event] = []
            let scrolled = await SeekFirstScrollPipeline.run(
                request: request,
                isCurrent: { true },
                host: .init(
                    waitForMount: { _ in mount },
                    performScroll: { _ in scrollCount += 1 }
                ),
                onEvent: { events.append($0) }
            )
            XCTAssertFalse(scrolled)
            XCTAssertEqual(scrollCount, 0)
            XCTAssertEqual(events.first?.isPrepare, true)
            switch mount {
            case .cancelled:
                XCTAssertEqual(events.last, .skipped(.cancelled))
            case .timedOut:
                XCTAssertEqual(events.last, .skipped(.timedOut))
            case .mounted:
                XCTFail("not under test")
            }
        }
    }

    @MainActor
    func testSeekMountAckBoxMatchesRowAndIsCancelable() async {
        let request = SeekFirstScrollPipeline.Request(
            targetIndex: 5,
            targetRowID: "s1:item-5",
            sessionKey: "s1",
            generation: 4
        )
        let box = SeekMountAcknowledgementBox(request: request)

        let waitTask = Task { @MainActor in
            await box.wait(timeoutNanoseconds: 500_000_000)
        }
        // Wrong id is ignored.
        box.acknowledge(rowID: "s1:other")
        box.acknowledge(rowID: "s1:item-5")
        let result = await waitTask.value
        XCTAssertEqual(result, .mounted)

        let box2 = SeekMountAcknowledgementBox(request: request)
        let wait2 = Task { @MainActor in
            await box2.wait(timeoutNanoseconds: 500_000_000)
        }
        box2.cancel()
        let cancelled = await wait2.value
        XCTAssertEqual(cancelled, .cancelled)
    }

    func testHistoryPagerInvalidateInFlightDropsLoading() {
        var state = TranscriptHistoryPager.State.idle
        XCTAssertEqual(TranscriptHistoryPager.begin(currentStartPage: 4, state: &state), 3)
        XCTAssertEqual(state, .loading(targetPage: 3))

        TranscriptHistoryPager.invalidateInFlight(&state)
        XCTAssertEqual(state, .idle)

        // Late complete after invalidate must not be applied by hosts that
        // also bump load generation; pure state returns to idle admitting a new page.
        XCTAssertEqual(TranscriptHistoryPager.begin(currentStartPage: 4, state: &state), 3)

        state = .exhausted
        TranscriptHistoryPager.invalidateInFlight(&state)
        XCTAssertEqual(state, .exhausted, "exhausted is sticky until hard reset")
    }

    func testNavigateAndReturnInvalidateHistoryPagerEffect() {
        var state = liveState(itemCount: 400)
        let navEffects = VP.reduce(&state, .navigate(targetIndex: 8))
        XCTAssertTrue(navEffects.contains(.invalidateHistoryPager))

        let retEffects = VP.reduce(&state, .returnToLatest)
        XCTAssertTrue(retEffects.contains(.invalidateHistoryPager))

        _ = VP.reduce(&state, .navigate(targetIndex: 2))
        let userEffects = VP.reduce(&state, .userScrolled)
        XCTAssertTrue(userEffects.contains(.invalidateHistoryPager))
    }

    // MARK: - Current node association (mounted window only)

    func testNearestUserPromptToReadingBaseline() {
        let anchors: [UserPromptCurrentAssociation.Anchor] = [
            .init(messageID: "u-far", midY: 10),
            .init(messageID: "u-near", midY: 120),
            .init(messageID: "u-below", midY: 280),
        ]
        let baseline = UserPromptCurrentAssociation.baselineY(viewportHeight: 400, fraction: 0.33)
        // 400 * 0.33 = 132 → nearest is u-near at 120.
        XCTAssertEqual(
            UserPromptCurrentAssociation.nearestMessageID(anchors: anchors, baselineY: baseline),
            "u-near"
        )
        XCTAssertNil(
            UserPromptCurrentAssociation.nearestMessageID(anchors: [], baselineY: baseline)
        )
    }

    func testAnchorsInMountedSetFiltersWithoutFullScanSemantics() {
        let anchors: [UserPromptCurrentAssociation.Anchor] = [
            .init(messageID: "u1", midY: 40),
            .init(messageID: "u2", midY: 140),
            .init(messageID: "u3", midY: 240),
        ]
        let filtered = UserPromptCurrentAssociation.anchorsInMountedSet(
            anchors,
            allowedMessageIDs: ["u2", "u3"]
        )
        XCTAssertEqual(filtered.map(\.messageID), ["u2", "u3"])
        XCTAssertEqual(
            UserPromptCurrentAssociation.anchorsInMountedSet(anchors, allowedMessageIDs: nil).count,
            3
        )
    }

    func testTranscriptFlipMapsLayoutClipAndVisualReadingLine() {
        let viewport = UserPromptCurrentAssociation.Viewport(
            layoutVisibleRect: CGRect(x: 0, y: 100, width: 600, height: 300)
        )

        // `.transcriptFlip()` makes visual top map to the layout clip's maxY.
        XCTAssertEqual(
            UserPromptCurrentAssociation.visualY(forLayoutY: 400, viewport: viewport),
            0
        )
        XCTAssertEqual(
            UserPromptCurrentAssociation.visualY(forLayoutY: 100, viewport: viewport),
            300
        )
        XCTAssertEqual(
            UserPromptCurrentAssociation.layoutY(forVisualY: 99, viewport: viewport),
            301
        )
        XCTAssertEqual(
            UserPromptCurrentAssociation.layoutBaselineY(viewport: viewport),
            301
        )

        let visual = UserPromptCurrentAssociation.visualFrame(
            for: CGRect(x: 20, y: 300, width: 80, height: 40),
            viewport: viewport
        )
        XCTAssertEqual(visual, CGRect(x: 20, y: 60, width: 80, height: 40))

        // AppKit's rare non-flipped document path is explicitly normalized to the
        // same y-down pre-flip layout axis used by the SwiftUI anchor cache.
        XCTAssertEqual(
            UserPromptCurrentAssociation.layoutVisibleRect(
                documentVisibleRect: CGRect(x: 0, y: 200, width: 600, height: 100),
                documentBounds: CGRect(x: 0, y: 0, width: 600, height: 1_000),
                documentIsFlipped: false
            ),
            CGRect(x: 0, y: 700, width: 600, height: 100)
        )
    }

    func testVisibleAssociationExcludesOffscreenMountedRows() {
        let viewport = UserPromptCurrentAssociation.Viewport(
            layoutVisibleRect: CGRect(x: 0, y: 0, width: 600, height: 300)
        )
        let anchors: [UserPromptCurrentAssociation.Anchor] = [
            // Visible but far from the layout baseline (201).
            .init(messageID: "visible", layoutFrame: CGRect(x: 0, y: 0, width: 300, height: 20)),
            // Numerically closer, but exactly outside the clip and therefore ineligible.
            .init(messageID: "offscreen", layoutFrame: CGRect(x: 0, y: 300, width: 300, height: 20)),
        ]

        XCTAssertEqual(
            UserPromptCurrentAssociation.nearestMessageID(
                anchors: anchors,
                baselineY: UserPromptCurrentAssociation.layoutBaselineY(viewport: viewport)
            ),
            "offscreen",
            "control: center-only association would choose the off-screen row"
        )
        XCTAssertEqual(
            UserPromptCurrentAssociation.visibleAnchors(anchors, in: viewport).map(\.messageID),
            ["visible"]
        )
        XCTAssertEqual(
            UserPromptCurrentAssociation.nearestVisibleMessageID(
                anchors: anchors,
                viewport: viewport
            ),
            "visible"
        )
    }

    func testCachedLiveAnchorsUpdateImmediatelyOnFirstUserScroll() {
        var nav = UserPromptNavigationCoordinator(
            config: .init(seekWindowSize: 64, maxCorrectionSteps: 0)
        )
        _ = nav.reset(sessionKey: "s1", itemCount: 800)
        nav.currentUserPromptID = "u-last"
        var tracker = MountedUserPromptCurrentTracker()

        // Preferences may arrive while live code still owns scrolling. Cache them
        // anyway; do not let them overwrite the live/latest rail selection yet.
        tracker.replaceMountedAnchors([
            .init(messageID: "u-older", layoutFrame: CGRect(x: 0, y: 250, width: 300, height: 40)),
            .init(messageID: "u-last", layoutFrame: CGRect(x: 0, y: 50, width: 300, height: 40)),
        ])
        XCTAssertEqual(tracker.mountedAnchors.map(\.messageID), ["u-older", "u-last"])
        XCTAssertFalse(tracker.refreshCurrent(navigation: &nav))
        XCTAssertEqual(nav.currentUserPromptID, "u-last")
        XCTAssertEqual(nav.viewport.scrollOwner, .live)

        // No new Preference is sent here. The AppKit user-scroll callback supplies
        // the clip and must use the already-cached anchors immediately.
        XCTAssertEqual(
            tracker.userScrolled(
                navigation: &nav,
                viewport: .init(layoutVisibleRect: CGRect(x: 0, y: 0, width: 600, height: 400))
            ),
            []
        )
        XCTAssertEqual(nav.viewport.scrollOwner, .user)
        XCTAssertEqual(nav.currentUserPromptID, "u-older")
    }

    func testContinuousUserScrollClipOffsetsAdvanceCurrentAcrossPrompts() {
        var nav = UserPromptNavigationCoordinator(
            config: .init(seekWindowSize: 64, maxCorrectionSteps: 0)
        )
        _ = nav.reset(sessionKey: "s1", itemCount: 800)
        nav.currentUserPromptID = "u-new"
        var tracker = MountedUserPromptCurrentTracker()
        tracker.replaceMountedAnchors([
            .init(messageID: "u-new", layoutFrame: CGRect(x: 0, y: 180, width: 300, height: 40)),
            .init(messageID: "u-middle", layoutFrame: CGRect(x: 0, y: 430, width: 300, height: 40)),
            .init(messageID: "u-old", layoutFrame: CGRect(x: 0, y: 730, width: 300, height: 40)),
        ])

        // In the flipped transcript, larger layout offsets are visually older.
        _ = tracker.userScrolled(
            navigation: &nav,
            viewport: .init(layoutVisibleRect: CGRect(x: 0, y: 0, width: 600, height: 300))
        )
        XCTAssertEqual(nav.currentUserPromptID, "u-new")

        _ = tracker.userScrolled(
            navigation: &nav,
            viewport: .init(layoutVisibleRect: CGRect(x: 0, y: 250, width: 600, height: 300))
        )
        XCTAssertEqual(nav.currentUserPromptID, "u-middle")

        _ = tracker.userScrolled(
            navigation: &nav,
            viewport: .init(layoutVisibleRect: CGRect(x: 0, y: 550, width: 600, height: 300))
        )
        XCTAssertEqual(nav.currentUserPromptID, "u-old")
    }

    func testProgrammaticSeekKeepsLandedTargetUntilRealUserScroll() {
        var nav = UserPromptNavigationCoordinator(
            config: .init(seekWindowSize: 64, maxCorrectionSteps: 0)
        )
        _ = nav.reset(sessionKey: "s1", itemCount: 500)
        _ = nav.navigateToUserPrompt(
            messageID: "u-target",
            transcriptIndex: 42,
            itemCount: 500,
            sessionKey: "s1"
        )
        let generation = nav.generation
        _ = nav.jumpScrollApplied(generation: generation)
        XCTAssertEqual(nav.currentUserPromptID, "u-target")
        XCTAssertEqual(nav.viewport.scrollOwner, .jumpCoordinator)

        var tracker = MountedUserPromptCurrentTracker()
        tracker.replaceMountedAnchors([
            .init(messageID: "u-other", layoutFrame: CGRect(x: 0, y: 250, width: 300, height: 40)),
            .init(messageID: "u-target", layoutFrame: CGRect(x: 0, y: 40, width: 300, height: 40)),
        ])
        tracker.recordViewport(.init(
            layoutVisibleRect: CGRect(x: 0, y: 0, width: 600, height: 400)
        ))

        // A programmatic landed scroll may update the clip cache, but it never
        // invokes `userScrolled` and cannot steal the seek target.
        XCTAssertFalse(tracker.refreshCurrent(navigation: &nav))
        XCTAssertEqual(nav.currentUserPromptID, "u-target")

        _ = tracker.userScrolled(
            navigation: &nav,
            viewport: .init(layoutVisibleRect: CGRect(x: 0, y: 0, width: 600, height: 400))
        )
        XCTAssertEqual(nav.viewport.scrollOwner, .user)
        XCTAssertEqual(nav.currentUserPromptID, "u-other")
    }

    func testWindowInvalidationRefreshesAnchorsWithoutFallingBackToLatest() {
        var nav = UserPromptNavigationCoordinator(
            config: .init(seekWindowSize: 64, maxCorrectionSteps: 0)
        )
        _ = nav.reset(sessionKey: "s1", itemCount: 800)
        nav.currentUserPromptID = "u-last"
        var tracker = MountedUserPromptCurrentTracker()
        let viewport = UserPromptCurrentAssociation.Viewport(
            layoutVisibleRect: CGRect(x: 0, y: 0, width: 600, height: 400)
        )
        let liveRange = 768..<800
        let historyRange = 736..<768
        tracker.replaceMountedAnchors([
            .init(messageID: "u-live", layoutFrame: CGRect(x: 0, y: 250, width: 300, height: 40)),
        ], mountedRange: liveRange)
        _ = tracker.userScrolled(
            navigation: &nav,
            viewport: viewport,
            mountedRange: liveRange
        )
        XCTAssertEqual(nav.currentUserPromptID, "u-live")

        // History/seek window changes keep the old selection while geometry for
        // the incoming range is absent. Old live-range anchors cannot compete.
        tracker.mountedWindowDidChange(historyRange)
        _ = tracker.userScrolled(
            navigation: &nav,
            viewport: viewport,
            mountedRange: historyRange
        )
        XCTAssertEqual(nav.currentUserPromptID, "u-live")

        // A late stale live-range preference is retained only under its own tag;
        // it still cannot update current while the AppKit callback says history.
        tracker.replaceMountedAnchors([
            .init(messageID: "u-stale-live", layoutFrame: CGRect(x: 0, y: 250, width: 300, height: 40)),
        ], mountedRange: liveRange)
        XCTAssertFalse(tracker.refreshCurrent(navigation: &nav))
        XCTAssertEqual(nav.currentUserPromptID, "u-live")

        tracker.replaceMountedAnchors([
            .init(messageID: "u-history", layoutFrame: CGRect(x: 0, y: 250, width: 300, height: 40)),
        ], mountedRange: historyRange)
        XCTAssertTrue(tracker.refreshCurrent(navigation: &nav))
        XCTAssertEqual(nav.currentUserPromptID, "u-history")
    }

    func testCoordinatorKeepsJumpTargetUntilUserScrollThenFollowsBaseline() {
        var nav = UserPromptNavigationCoordinator(
            config: .init(seekWindowSize: 64, maxCorrectionSteps: 1)
        )
        _ = nav.reset(sessionKey: "s1", itemCount: 500)
        _ = nav.navigateToUserPrompt(
            messageID: "u-target",
            transcriptIndex: 40,
            itemCount: 500,
            sessionKey: "s1"
        )
        let gen = nav.generation
        _ = nav.jumpScrollApplied(generation: gen)
        XCTAssertEqual(nav.currentUserPromptID, "u-target")
        XCTAssertFalse(nav.mayUpdateCurrentFromVisibleAnchors)

        // While coordinator still owns scroll, visibility must not steal the target.
        let anchors: [UserPromptCurrentAssociation.Anchor] = [
            .init(messageID: "u-other", midY: 50),
            .init(messageID: "u-target", midY: 300),
        ]
        XCTAssertFalse(
            nav.applyVisibleUserPromptAnchors(anchors, viewportHeight: 400)
        )
        XCTAssertEqual(nav.currentUserPromptID, "u-target")

        // User takeover → association may update from mounted anchors only.
        _ = nav.userScrolled()
        XCTAssertTrue(nav.mayUpdateCurrentFromVisibleAnchors)
        XCTAssertTrue(
            nav.applyVisibleUserPromptAnchors(anchors, viewportHeight: 400)
        )
        XCTAssertEqual(nav.currentUserPromptID, "u-other")

        // Empty mounted set does not clear the last association.
        XCTAssertFalse(nav.applyVisibleUserPromptAnchors([], viewportHeight: 400))
        XCTAssertEqual(nav.currentUserPromptID, "u-other")
    }

    /// Live browsing: real user scroll hands ownership to `.user` without forcing
    /// pin off (StickToBottom owns pin). Mounted visible anchors may then move
    /// current from the latest node to an older on-screen user prompt — no window expand.
    func testLiveUserScrollHandsOwnershipThenMountedAnchorsUpdateCurrent() {
        var nav = UserPromptNavigationCoordinator(
            config: .init(seekWindowSize: 64, maxCorrectionSteps: 0)
        )
        _ = nav.reset(sessionKey: "s1", itemCount: 800)
        // Simulate rail/live default: current is the last user node.
        nav.currentUserPromptID = "u-last"
        XCTAssertEqual(nav.viewport.mode, .liveLatest)
        XCTAssertTrue(nav.pinToBottom)
        XCTAssertEqual(nav.viewport.scrollOwner, .live)
        XCTAssertFalse(nav.mayUpdateCurrentFromVisibleAnchors)

        let genBefore = nav.generation
        let effects = nav.userScrolled()
        XCTAssertEqual(effects, [])
        XCTAssertEqual(nav.generation, genBefore, "live user scroll must not bump generation")
        XCTAssertEqual(nav.viewport.scrollOwner, .user)
        XCTAssertTrue(nav.pinToBottom, "StickToBottom owns pin; reducer must not force unpin")
        XCTAssertEqual(nav.viewport.mode, .liveLatest)
        XCTAssertNil(nav.seekMountedRange)
        XCTAssertTrue(nav.mayUpdateCurrentFromVisibleAnchors)

        // Last node still “current” until mounted anchors say otherwise.
        XCTAssertEqual(nav.currentUserPromptID, "u-last")

        // Visible older user prompt nearest baseline becomes current; no expand.
        let anchors: [UserPromptCurrentAssociation.Anchor] = [
            .init(messageID: "u-old", midY: 120),
            .init(messageID: "u-mid", midY: 260),
            .init(messageID: "u-last", midY: 520),
        ]
        // baseline ≈ 400 * 0.33 = 132 → nearest u-old at 120.
        XCTAssertTrue(
            nav.applyVisibleUserPromptAnchors(anchors, viewportHeight: 400)
        )
        XCTAssertEqual(nav.currentUserPromptID, "u-old")
        XCTAssertEqual(nav.viewport.mode, .liveLatest)
        XCTAssertNil(nav.seekMountedRange)

        // Repeat user scroll while already user-owned is a no-op.
        XCTAssertEqual(nav.userScrolled(), [])
        XCTAssertEqual(nav.viewport.scrollOwner, .user)
        XCTAssertEqual(nav.generation, genBefore)
    }

    func testHistoryPagerUserScrollHandsOwnershipToUser() {
        var state = liveState(itemCount: 200)
        _ = VP.reduce(&state, .requestHistoryPage)
        guard case .history = state.mode else {
            return XCTFail("expected history mode")
        }
        XCTAssertEqual(state.scrollOwner, .historyPager)
        XCTAssertFalse(state.pinToBottom)

        let genBefore = state.generation
        let effects = VP.reduce(&state, .userScrolled)
        XCTAssertEqual(effects, [])
        XCTAssertEqual(state.scrollOwner, .user)
        XCTAssertEqual(state.generation, genBefore)
        guard case .history = state.mode else {
            return XCTFail("user scroll must keep history window")
        }
        XCTAssertFalse(state.pinToBottom)
    }

    func testPendingNavigateBlocksVisibleAssociation() {
        var nav = UserPromptNavigationCoordinator(
            config: .init(seekWindowSize: 32, maxCorrectionSteps: 0)
        )
        _ = nav.reset(sessionKey: "s1", itemCount: 200)
        _ = nav.navigateToUserPrompt(
            messageID: "u-pending",
            transcriptIndex: 10,
            itemCount: 200,
            sessionKey: "s1"
        )
        // Force user owner without clearing pending (should not happen in prod,
        // but guards the pending check independently).
        nav.viewport.scrollOwner = .user
        XCTAssertEqual(nav.pendingUserPromptID, "u-pending")
        XCTAssertFalse(nav.mayUpdateCurrentFromVisibleAnchors)
        XCTAssertFalse(
            nav.applyVisibleUserPromptAnchors(
                [.init(messageID: "u-visible", midY: 80)],
                viewportHeight: 300
            )
        )
        XCTAssertNil(nav.currentUserPromptID)
    }

    /// Acceptance #1 (geometry feedback): when mounted user-prompt coordinates shift
    /// every scroll frame but the nearest prompt (the discrete semantic) is unchanged,
    /// `applyVisibleUserPromptAnchors` must be a no-op. Combined with the host's
    /// `@State` equality guard (`mutateUserPromptNavigation` only writes when the
    /// `Equatable` coordinator actually changed), this stops the per-frame Geometry /
    /// Preference feedback loop from invalidating `ChatDetailViewBody`.
    func testVisibleAnchorsNoOpWhenNearestPromptUnchanged() {
        var nav = UserPromptNavigationCoordinator(
            config: .init(seekWindowSize: 64, maxCorrectionSteps: 0)
        )
        _ = nav.reset(sessionKey: "s1", itemCount: 800)
        nav.currentUserPromptID = "u-last"
        // Live user scroll hands current-association ownership to the user; only then
        // may mounted visible anchors move `currentUserPromptID`.
        _ = nav.userScrolled()
        XCTAssertTrue(nav.mayUpdateCurrentFromVisibleAnchors)

        // baseline = 400 * 0.33 = 132. u-old (130) is nearest.
        let first: [UserPromptCurrentAssociation.Anchor] = [
            .init(messageID: "u-old", midY: 130),
            .init(messageID: "u-last", midY: 480),
        ]
        XCTAssertTrue(nav.applyVisibleUserPromptAnchors(first, viewportHeight: 400))
        XCTAssertEqual(nav.currentUserPromptID, "u-old")

        // Same prompts, only midY drifted (a coordinate-only change). Nearest is still
        // u-old → the reducer must return false and leave currentUserPromptID alone.
        let drifted: [UserPromptCurrentAssociation.Anchor] = [
            .init(messageID: "u-old", midY: 122),
            .init(messageID: "u-last", midY: 510),
        ]
        XCTAssertFalse(
            nav.applyVisibleUserPromptAnchors(drifted, viewportHeight: 400),
            "coordinate-only change with the same nearest prompt must be a no-op"
        )
        XCTAssertEqual(nav.currentUserPromptID, "u-old")

        // Nearest actually flips to a different prompt → change.
        let flipped: [UserPromptCurrentAssociation.Anchor] = [
            .init(messageID: "u-old", midY: 360),
            .init(messageID: "u-last", midY: 140),
        ]
        XCTAssertTrue(nav.applyVisibleUserPromptAnchors(flipped, viewportHeight: 400))
        XCTAssertEqual(nav.currentUserPromptID, "u-last")
    }

    // MARK: - Mounted-row hard ceiling (acceptance: bounded render window)

    /// Production transcript mount ceiling: the eagerly mounted row count must
    /// have a hard upper bound that is independent of the full history length,
    /// across live / history / seek modes. This is what keeps long sessions
    /// scrollable without mounting the whole transcript into the inverted VStack.
    func testMountedRowsHaveHardCeilingIndependentOfTranscriptLength() {
        let ceiling = TranscriptRenderWindow.maxPages * TranscriptRenderWindow.pageSize
        XCTAssertEqual(ceiling, 128, "production eager ceiling is maxPages * pageSize")
        XCTAssertEqual(VP.Config.default.seekWindowSize, ceiling)

        // A wide range of transcript lengths, including very long ones.
        for count in [0, 1, 32, 33, 127, 128, 129, 1_000, 10_000, 100_000, 1_000_000] {
            // Live / pinned window.
            let live = TranscriptRenderWindow.resolve(itemCount: count, oldestLoadedPage: nil).range
            XCTAssertLessThanOrEqual(
                live.count, ceiling,
                "live window exceeded ceiling at count=\(count): \(live)"
            )

            // History window walked all the way to the oldest page.
            let lastPage = TranscriptRenderWindow.latestPage(itemCount: count)
            let deepest = TranscriptRenderWindow.resolve(
                itemCount: count, oldestLoadedPage: lastPage
            ).range
            XCTAssertLessThanOrEqual(
                deepest.count, ceiling,
                "history window exceeded ceiling at count=\(count): \(deepest)"
            )

            // Seek window at start / middle / end targets.
            let targets: [Int] = [
                0,
                count / 2,
                max(0, count - 1),
            ]
            for target in targets where count > 0 {
                let seek = VP.seekRange(
                    targetIndex: target,
                    itemCount: count,
                    windowSize: VP.Config.default.seekWindowSize
                )
                XCTAssertLessThanOrEqual(
                    seek.count, ceiling,
                    "seek window exceeded ceiling at count=\(count) target=\(target): \(seek)"
                )
                XCTAssertTrue(seek.contains(target), "seek must contain target")
            }
        }
    }

    /// Behavior: after a seek on a very long transcript, repeated streaming
    /// appends must keep the mounted window bounded and the seek target stable
    /// (never expands toward latest). Combines the seek + stream invariants
    /// under one long-transcript scenario.
    func testSeekAndStreamKeepMountedWindowBoundedOnLongTranscript() {
        let ceiling = TranscriptRenderWindow.maxPages * TranscriptRenderWindow.pageSize
        var state = liveState(itemCount: 50_000)

        _ = VP.reduce(&state, .navigate(targetIndex: 100), config: .default)
        XCTAssertTrue(state.isSeeking)
        var mounted = state.mountedRange()
        XCTAssertLessThanOrEqual(mounted.count, ceiling)
        XCTAssertTrue(mounted.contains(100), "seek target must be mounted")
        XCTAssertLessThan(mounted.upperBound, 50_000, "must not mount through latest")

        // Stream many appends — window stays bounded, target stays mounted.
        for appended in [60_000, 100_000, 1_000_000] {
            _ = VP.reduce(&state, .streamAppended(itemCount: appended))
            mounted = state.mountedRange()
            XCTAssertLessThanOrEqual(
                mounted.count, ceiling,
                "window grew after append to \(appended): \(mounted)"
            )
            XCTAssertTrue(
                mounted.contains(100),
                "seek target must remain mounted after append to \(appended): \(mounted)"
            )
            XCTAssertLessThan(
                mounted.upperBound, appended,
                "window must not expand to latest after append to \(appended)"
            )
            XCTAssertEqual(state.scrollOwner, .jumpCoordinator)
            XCTAssertFalse(state.pinToBottom)
        }

        // Return to latest restores the bounded live window at the newest end.
        _ = VP.reduce(&state, .returnToLatest)
        let live = state.mountedRange()
        XCTAssertLessThanOrEqual(live.count, ceiling)
        XCTAssertEqual(live.upperBound, 1_000_000, "live window ends at the newest item")
        XCTAssertTrue(state.pinToBottom)
        XCTAssertTrue(state.streamingMayWriteScroll)
    }

    /// History browsing on a long transcript: every admitted older page keeps
    /// the eager window within the ceiling — the head moves but `resolve` caps
    /// the span (sliding off the newest end once past `maxPages`).
    func testHistoryPagingOnLongTranscriptStaysWithinCeiling() {
        let ceiling = TranscriptRenderWindow.maxPages * TranscriptRenderWindow.pageSize
        let count = 50_000 // ~1562 pages
        var state = liveState(itemCount: count)

        // Walk several older pages from the live end.
        for _ in 0..<8 {
            _ = VP.reduce(&state, .requestHistoryPage)
        }
        guard case .history(let page) = state.mode else {
            return XCTFail("expected history mode after paging")
        }
        let window = TranscriptRenderWindow.resolve(itemCount: count, oldestLoadedPage: page).range
        XCTAssertLessThanOrEqual(window.count, ceiling)
        XCTAssertLessThan(page, TranscriptRenderWindow.latestPage(itemCount: count))

        // Apply an authoritative head at page 0 (deepest): still bounded.
        _ = VP.reduce(&state, .applyHistoryPage(oldestLoadedPage: 0))
        guard case .history(let deepPage) = state.mode else {
            return XCTFail("expected history mode at page 0")
        }
        XCTAssertEqual(deepPage, 0)
        let deepWindow = TranscriptRenderWindow.resolve(
            itemCount: count, oldestLoadedPage: 0
        ).range
        XCTAssertLessThanOrEqual(deepWindow.count, ceiling)
        XCTAssertEqual(deepWindow.lowerBound, 0, "deepest history window starts at item 0")
    }
}

private extension SeekFirstScrollPipeline.Event {
    var isPrepare: Bool {
        if case .prepare = self { return true }
        return false
    }
}
