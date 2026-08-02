import XCTest
@testable import PipiUI

/// Edge-state contract for the near-top history-prepend trigger
/// (`TranscriptNearTopTrigger`), driven by AppKit clip/document geometry in
/// `StickToBottomTracker.Coordinator`.
final class TranscriptNearTopTriggerTests: XCTestCase {
    func testDisabledResetsNearStateAndNeverTriggers() {
        // Disabled (pinned, or effective start page == 0) must reset to not-near.
        var state = TranscriptNearTopTrigger.State(isNearTop: true)
        XCTAssertFalse(
            TranscriptNearTopTrigger.step(
                state: &state,
                distanceFromDocumentStart: 0,
                enabled: false
            )
        )
        XCTAssertFalse(state.isNearTop)
    }

    func testFalseToTrueEdgeTriggersExactlyOnce() {
        var state = TranscriptNearTopTrigger.State()
        // Mid-document first: no trigger, still not-near.
        XCTAssertFalse(
            TranscriptNearTopTrigger.step(
                state: &state,
                distanceFromDocumentStart: 500,
                enabled: true
            )
        )
        XCTAssertFalse(state.isNearTop)
        // Entering the top band fires exactly once.
        XCTAssertTrue(
            TranscriptNearTopTrigger.step(
                state: &state,
                distanceFromDocumentStart: 0,
                enabled: true
            )
        )
        XCTAssertTrue(state.isNearTop)
    }

    func testSustainedNearTopDoesNotRepeat() {
        var state = TranscriptNearTopTrigger.State()
        XCTAssertTrue(
            TranscriptNearTopTrigger.step(
                state: &state,
                distanceFromDocumentStart: 0,
                enabled: true
            )
        )
        // Same band, more geometry notifications (document frame settling,
        // clip re-anchoring) must not fire again.
        XCTAssertFalse(
            TranscriptNearTopTrigger.step(
                state: &state,
                distanceFromDocumentStart: 10,
                enabled: true
            )
        )
        XCTAssertFalse(
            TranscriptNearTopTrigger.step(
                state: &state,
                distanceFromDocumentStart: 0,
                enabled: true
            )
        )
        XCTAssertTrue(state.isNearTop)
    }

    func testLeavingTopRearmsAndCanFireAgain() {
        var state = TranscriptNearTopTrigger.State()
        XCTAssertTrue(
            TranscriptNearTopTrigger.step(
                state: &state,
                distanceFromDocumentStart: 0,
                enabled: true
            )
        )
        // A prepend grows the document: the anchored row stays put, so the
        // distance from the document start grows past the threshold → re-arm.
        XCTAssertFalse(
            TranscriptNearTopTrigger.step(
                state: &state,
                distanceFromDocumentStart: 1_200,
                enabled: true
            )
        )
        XCTAssertFalse(state.isNearTop)
        // The next trip back to the top fires again.
        XCTAssertTrue(
            TranscriptNearTopTrigger.step(
                state: &state,
                distanceFromDocumentStart: 16,
                enabled: true
            )
        )
    }

    func testThresholdToleratesTopPaddingAndRejectsPastIt() {
        var state = TranscriptNearTopTrigger.State()
        // 16pt transcript padding + slack still counts as near top.
        XCTAssertTrue(
            TranscriptNearTopTrigger.step(
                state: &state,
                distanceFromDocumentStart: TranscriptNearTopTrigger.nearTopThreshold - 1,
                enabled: true
            )
        )
        var past = TranscriptNearTopTrigger.State()
        XCTAssertFalse(
            TranscriptNearTopTrigger.step(
                state: &past,
                distanceFromDocumentStart: TranscriptNearTopTrigger.nearTopThreshold + 1,
                enabled: true
            )
        )
    }

    func testStartPageZeroOrPinnedEquivalentStaysDisabledInsideBand() {
        // The caller passes `enabled: false` for pin == true or start page 0;
        // even while inside the band the state must reset so the next browsing
        // session starts clean instead of inheriting a stale "near" edge.
        var state = TranscriptNearTopTrigger.State(isNearTop: true)
        XCTAssertFalse(
            TranscriptNearTopTrigger.step(
                state: &state,
                distanceFromDocumentStart: 0,
                enabled: false
            )
        )
        XCTAssertFalse(state.isNearTop)
        // Re-enabled at the top afterwards: fresh false→true edge fires.
        XCTAssertTrue(
            TranscriptNearTopTrigger.step(
                state: &state,
                distanceFromDocumentStart: 0,
                enabled: true
            )
        )
    }
}
