import XCTest
@testable import PipiUI

/// Pure geometry/state tests for the internal-anchor prepend compensation
/// (`PrependAnchorCompensation`, `PendingCleanupGuard`).
///
/// The compensation signal is the displacement of a stable zero-height anchor
/// NSView placed *after* the settled window rows and *before* all bottom
/// extras. Bottom churn (the return-to-latest button appearing, the streaming
/// item / waiting placeholder disappearing, token appends growing the document
/// end) must never pollute the delta — only a real prepend moves the anchor.
final class PrependAnchorCompensationTests: XCTestCase {
    // MARK: - Anchor-delta compensation

    func testFlippedStylePrependMovesOriginByAnchorDelta() {
        // Flipped document: the prepend shifts the anchor down by the page
        // height (700 → 1450); the clip origin must follow by the same delta.
        let target = PrependAnchorCompensation.targetOriginY(
            clipOriginYBefore: 320,
            anchorYBefore: 700,
            anchorYNow: 1_450,
            contentHeight: 3_000,
            viewportHeight: 600
        )
        XCTAssertEqual(target, 1_070) // 320 + 750
    }

    func testNonFlippedStylePrependKeepsOrigin() {
        // Non-flipped document: content grows upward, so the anchor does not
        // move (delta 0). No apply is signalled — the origin stays put, which
        // is exactly the correct non-flipped behavior (existing content keeps
        // its document coordinates under a top prepend).
        XCTAssertNil(PrependAnchorCompensation.targetOriginY(
            clipOriginYBefore: 120,
            anchorYBefore: 900,
            anchorYNow: 900,
            contentHeight: 3_400,
            viewportHeight: 600
        ))
    }

    func testBottomChurnDoesNotPolluteTarget() {
        // The streaming item / return button / token appends grow (or shrink)
        // the document end by hundreds of points. As long as the anchor delta
        // is fixed, the target origin is identical.
        let base = PrependAnchorCompensation.targetOriginY(
            clipOriginYBefore: 320,
            anchorYBefore: 700,
            anchorYNow: 1_450,
            contentHeight: 3_000,
            viewportHeight: 600
        )
        let churnedTaller = PrependAnchorCompensation.targetOriginY(
            clipOriginYBefore: 320,
            anchorYBefore: 700,
            anchorYNow: 1_450,
            contentHeight: 3_800, // +800pt of bottom extras
            viewportHeight: 600
        )
        let churnedShorter = PrependAnchorCompensation.targetOriginY(
            clipOriginYBefore: 320,
            anchorYBefore: 700,
            anchorYNow: 1_450,
            contentHeight: 2_900, // −100pt of bottom extras
            viewportHeight: 600
        )
        XCTAssertEqual(churnedTaller, base)
        XCTAssertEqual(churnedShorter, base)
    }

    func testAnchorNotMovedMeansNoApplyEvenWhenDocumentGrew() {
        // The document grew but the settled rows (and anchor) never moved:
        // a bottom-only change must never apply.
        XCTAssertNil(PrependAnchorCompensation.targetOriginY(
            clipOriginYBefore: 100,
            anchorYBefore: 500,
            anchorYNow: 500,
            contentHeight: 3_000,
            viewportHeight: 600
        ))
        // Sub-epsilon drift is float noise, not a laid-out prepend.
        XCTAssertNil(PrependAnchorCompensation.targetOriginY(
            clipOriginYBefore: 100,
            anchorYBefore: 500,
            anchorYNow: 500.4,
            contentHeight: 3_000,
            viewportHeight: 600
        ))
    }

    func testTargetClampsToLegalScrollRange() {
        // Short document: origin clamps to 0, never negative.
        XCTAssertEqual(PrependAnchorCompensation.targetOriginY(
            clipOriginYBefore: 100,
            anchorYBefore: 500,
            anchorYNow: 900,
            contentHeight: 300,
            viewportHeight: 600
        ), 0)
        // A huge delta past the bottom clamps to the maximum origin.
        XCTAssertEqual(PrependAnchorCompensation.targetOriginY(
            clipOriginYBefore: 100,
            anchorYBefore: 500,
            anchorYNow: 4_000,
            contentHeight: 3_000,
            viewportHeight: 600
        ), 2_400)
    }

    // MARK: - Pending cleanup lifecycle

    func testCleanupTokenOldTimerCannotClearNewPending() {
        // A timer armed for token 1 fires after a second pending (token 2) was
        // armed: it must not clear the newer pending.
        XCTAssertFalse(PendingCleanupGuard.shouldClear(
            timerToken: 1,
            currentToken: 2,
            hasPending: true
        ))
        // The current token's own timer clears its pending exactly once.
        XCTAssertTrue(PendingCleanupGuard.shouldClear(
            timerToken: 2,
            currentToken: 2,
            hasPending: true
        ))
        // No pending at all: never clear.
        XCTAssertFalse(PendingCleanupGuard.shouldClear(
            timerToken: 2,
            currentToken: 2,
            hasPending: false
        ))
        // After a clear bumped the token, the old timer is doubly stale.
        XCTAssertFalse(PendingCleanupGuard.shouldClear(
            timerToken: 2,
            currentToken: 3,
            hasPending: true
        ))
    }

    func testCleanupTokenBumpOnEveryArmAndClear() {
        // Simulate: arm (token 1) → apply/clear (token 2) → arm (token 3).
        // Only the timer carrying token 3 may clear the final pending.
        XCTAssertFalse(PendingCleanupGuard.shouldClear(
            timerToken: 1,
            currentToken: 3,
            hasPending: true
        ))
        XCTAssertFalse(PendingCleanupGuard.shouldClear(
            timerToken: 2,
            currentToken: 3,
            hasPending: true
        ))
        XCTAssertTrue(PendingCleanupGuard.shouldClear(
            timerToken: 3,
            currentToken: 3,
            hasPending: true
        ))
    }
}
