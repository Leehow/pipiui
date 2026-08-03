import XCTest
@testable import PipiUI

/// Near-top prefetch and one-page admission contracts. The legacy filename is
/// retained so this focused regression suite stays discoverable in existing CI.
final class TranscriptExactTopTriggerTests: XCTestCase {
    func testApproachBandStartsBeforeHardTop() {
        var state = TranscriptHistoryPrefetchTrigger.State()
        XCTAssertFalse(TranscriptHistoryPrefetchTrigger.step(
            state: &state,
            distanceFromDocumentStart: 600,
            enabled: true
        ))
        XCTAssertTrue(TranscriptHistoryPrefetchTrigger.step(
            state: &state,
            distanceFromDocumentStart: 300,
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

    func testThresholdBoundaryIsInclusive() {
        var at = TranscriptHistoryPrefetchTrigger.State()
        XCTAssertTrue(TranscriptHistoryPrefetchTrigger.step(
            state: &at,
            distanceFromDocumentStart: TranscriptHistoryPrefetchTrigger.approachThreshold,
            enabled: true
        ))
        var past = TranscriptHistoryPrefetchTrigger.State()
        XCTAssertFalse(TranscriptHistoryPrefetchTrigger.step(
            state: &past,
            distanceFromDocumentStart: TranscriptHistoryPrefetchTrigger.approachThreshold + 0.5,
            enabled: true
        ))
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
