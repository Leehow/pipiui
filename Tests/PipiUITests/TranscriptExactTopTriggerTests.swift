import XCTest
@testable import PipiUI

/// Edge-state contract for the exact-top history-prepend trigger
/// (`TranscriptExactTopTrigger`), driven by AppKit clip/document geometry in
/// `StickToBottomTracker.Coordinator`. There is deliberately no approach-band
/// preload: a page is only prepended when the user *really* reaches the
/// document top (≤ a tiny epsilon), never while merely approaching it.
final class TranscriptExactTopTriggerTests: XCTestCase {
    func testDisabledResetsExactTopStateAndNeverTriggers() {
        // Disabled (pinned, or effective start page == 0) must reset to not-at-top.
        var state = TranscriptExactTopTrigger.State(isAtExactTop: true)
        XCTAssertFalse(
            TranscriptExactTopTrigger.step(
                state: &state,
                distanceFromDocumentStart: 0,
                enabled: false
            )
        )
        XCTAssertFalse(state.isAtExactTop)
    }

    func testOutsideEpsilonNeverTriggers() {
        // 5pt below the 4pt epsilon is not an exact top — and certainly not the
        // old 72–96pt near-top band. No approach-band preloading.
        var state = TranscriptExactTopTrigger.State()
        for distance: CGFloat in [5, 8, 16, 40, 96, 500, 4_000] {
            XCTAssertFalse(
                TranscriptExactTopTrigger.step(
                    state: &state,
                    distanceFromDocumentStart: distance,
                    enabled: true
                )
            )
        }
        XCTAssertFalse(state.isAtExactTop)
    }

    func testFalseToTrueEdgeTriggersExactlyOnce() {
        var state = TranscriptExactTopTrigger.State()
        // Mid-document first: no trigger, still not at top.
        XCTAssertFalse(
            TranscriptExactTopTrigger.step(
                state: &state,
                distanceFromDocumentStart: 500,
                enabled: true
            )
        )
        XCTAssertFalse(state.isAtExactTop)
        // Entering the epsilon fires exactly once.
        XCTAssertTrue(
            TranscriptExactTopTrigger.step(
                state: &state,
                distanceFromDocumentStart: 0,
                enabled: true
            )
        )
        XCTAssertTrue(state.isAtExactTop)
        // Elastic overscroll may push the distance slightly negative: still in band.
        XCTAssertFalse(
            TranscriptExactTopTrigger.step(
                state: &state,
                distanceFromDocumentStart: -2,
                enabled: true
            )
        )
    }

    func testSustainedExactTopDoesNotRepeat() {
        var state = TranscriptExactTopTrigger.State()
        XCTAssertTrue(
            TranscriptExactTopTrigger.step(
                state: &state,
                distanceFromDocumentStart: 0,
                enabled: true
            )
        )
        // More geometry notifications while still at the top (document frame
        // settling, clip re-anchoring) must not fire again.
        XCTAssertFalse(
            TranscriptExactTopTrigger.step(
                state: &state,
                distanceFromDocumentStart: 2,
                enabled: true
            )
        )
        XCTAssertFalse(
            TranscriptExactTopTrigger.step(
                state: &state,
                distanceFromDocumentStart: 0,
                enabled: true
            )
        )
        XCTAssertTrue(state.isAtExactTop)
    }

    func testLeavingTopRearmsAndCanFireAgain() {
        var state = TranscriptExactTopTrigger.State()
        XCTAssertTrue(
            TranscriptExactTopTrigger.step(
                state: &state,
                distanceFromDocumentStart: 0,
                enabled: true
            )
        )
        // After the prepend compensation the viewport sits below the new top.
        XCTAssertFalse(
            TranscriptExactTopTrigger.step(
                state: &state,
                distanceFromDocumentStart: 1_200,
                enabled: true
            )
        )
        XCTAssertFalse(state.isAtExactTop)
        // The next trip back to the top fires again.
        XCTAssertTrue(
            TranscriptExactTopTrigger.step(
                state: &state,
                distanceFromDocumentStart: 3,
                enabled: true
            )
        )
    }

    func testThresholdToleratesFloatRoundingAndElasticSlack() {
        var state = TranscriptExactTopTrigger.State()
        // Exactly at the epsilon counts as an exact top.
        XCTAssertTrue(
            TranscriptExactTopTrigger.step(
                state: &state,
                distanceFromDocumentStart: TranscriptExactTopTrigger.exactTopThreshold,
                enabled: true
            )
        )
        var past = TranscriptExactTopTrigger.State()
        // Half a point past the epsilon does not.
        XCTAssertFalse(
            TranscriptExactTopTrigger.step(
                state: &past,
                distanceFromDocumentStart: TranscriptExactTopTrigger.exactTopThreshold + 0.5,
                enabled: true
            )
        )
    }

    func testDisabledInsideBandResetsSoNextBrowsingSessionStartsClean() {
        // The caller passes `enabled: false` for pin == true or start page 0;
        // even while inside the epsilon the state must reset so the next browsing
        // session starts clean instead of inheriting a stale "at top" edge.
        var state = TranscriptExactTopTrigger.State(isAtExactTop: true)
        XCTAssertFalse(
            TranscriptExactTopTrigger.step(
                state: &state,
                distanceFromDocumentStart: 0,
                enabled: false
            )
        )
        XCTAssertFalse(state.isAtExactTop)
        // Re-enabled at the top afterwards: fresh false→true edge fires.
        XCTAssertTrue(
            TranscriptExactTopTrigger.step(
                state: &state,
                distanceFromDocumentStart: 0,
                enabled: true
            )
        )
    }

    func testAttachSeedAndProgrammaticScrollsCannotAutoLoad() {
        // The coordinator passes `enabled: topLoadingEnabled && hasObservedUserScroll`:
        // an attachment that has not yet observed a real user scroll (attach seed,
        // initial layout, programmatic bottom scrolls) behaves exactly like a
        // disabled gate — even at the very top it must not fire, and it resets
        // the state so the first real user scroll to the top fires afresh.
        var state = TranscriptExactTopTrigger.State(isAtExactTop: true)
        for _ in 0..<3 {
            XCTAssertFalse(
                TranscriptExactTopTrigger.step(
                    state: &state,
                    distanceFromDocumentStart: 0,
                    enabled: false
                ),
                "no user scroll observed yet: seed evaluations must never prepend"
            )
            XCTAssertFalse(state.isAtExactTop)
        }
        // The user scrolls (wheel/trackpad/knob) and reaches the top: fires once.
        XCTAssertTrue(
            TranscriptExactTopTrigger.step(
                state: &state,
                distanceFromDocumentStart: 0,
                enabled: true
            )
        )
    }
}
