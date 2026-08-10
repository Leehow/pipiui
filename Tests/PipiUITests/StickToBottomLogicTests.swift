import XCTest
@testable import PipiUI

final class StickToBottomLogicTests: XCTestCase {
    func testLiveScrollUnpinsBeyondEdgeEpsilon() {
        // A real wheel/trackpad move beyond the edge epsilon must unpin before
        // scrollToBottom can fight the gesture.
        let desired = StickToBottomLogic.desiredPin(
            currentlyPinned: true,
            distanceFromBottom: 20,
            userLiveScroll: true,
            allowUnpin: true
        )
        XCTAssertEqual(desired, false)
    }

    func testLiveScrollDoesNotUnpinWhenGluedToBottom() {
        let desired = StickToBottomLogic.desiredPin(
            currentlyPinned: true,
            distanceFromBottom: 2,
            userLiveScroll: true,
            allowUnpin: true
        )
        XCTAssertNil(desired)
    }

    func testScrollerKnobDragUsesLiveScrollUnpinDistance() {
        // Knob drags are delivered through clip-bounds notifications rather than
        // didLiveScroll, but once attributed to the user they must use the same
        // immediate 4pt release rule as wheel/trackpad scrolling.
        let desired = StickToBottomLogic.desiredPin(
            currentlyPinned: true,
            distanceFromBottom: StickToBottomLogic.liveScrollUnpinDistance + 1,
            userLiveScroll: true,
            allowUnpin: true
        )
        XCTAssertEqual(desired, false)
    }

    func testProgrammaticDriftInsideBandDoesNotUnpin() {
        // Content growth / estimated height jitter without a live scroll must keep pin.
        let desired = StickToBottomLogic.desiredPin(
            currentlyPinned: true,
            distanceFromBottom: 20,
            userLiveScroll: false,
            allowUnpin: true
        )
        XCTAssertNil(desired)
    }

    func testProgrammaticGeometryFarFromBottomDoesNotUnpin() {
        let desired = StickToBottomLogic.desiredPin(
            currentlyPinned: true,
            distanceFromBottom: 100,
            userLiveScroll: false,
            allowUnpin: true
        )
        XCTAssertNil(desired)
    }

    func testProgrammaticGeometryNearBottomDoesNotRepinWhenUnpinned() {
        let desired = StickToBottomLogic.desiredPin(
            currentlyPinned: false,
            distanceFromBottom: 0,
            userLiveScroll: false,
            allowUnpin: true
        )
        XCTAssertNil(desired)
    }

    func testUserLiveScrollAtBottomRepinsWhenUnpinned() {
        let desired = StickToBottomLogic.desiredPin(
            currentlyPinned: false,
            distanceFromBottom: StickToBottomLogic.rePinThreshold,
            userLiveScroll: true,
            allowUnpin: true
        )
        XCTAssertEqual(desired, true)
    }

    func testKnobDragDoesNotRepinWhileButtonHeld() {
        // Scroller-knob path: unpin on drag-away is fine, but auto re-pin while
        // the thumb is still held would yank the origin back under the cursor.
        let unpin = StickToBottomLogic.desiredPin(
            currentlyPinned: true,
            distanceFromBottom: 40,
            userLiveScroll: true,
            allowUnpin: true,
            allowRepin: false
        )
        XCTAssertEqual(unpin, false)

        let noRepin = StickToBottomLogic.desiredPin(
            currentlyPinned: false,
            distanceFromBottom: 0,
            userLiveScroll: true,
            allowUnpin: true,
            allowRepin: false
        )
        XCTAssertNil(noRepin)
    }

    func testAfterKnobReleaseRepinAllowedAgain() {
        // Mouse-up restores the normal live-scroll contract: near-bottom may re-pin.
        let desired = StickToBottomLogic.desiredPin(
            currentlyPinned: false,
            distanceFromBottom: 0,
            userLiveScroll: true,
            allowUnpin: true,
            allowRepin: true
        )
        XCTAssertEqual(desired, true)
    }

    func testPinnedContentFollowBlockedDuringKnobDrag() {
        XCTAssertFalse(
            StickToBottomLogic.allowsPinnedContentFollow(
                isPinned: true,
                mouseButtonsDown: 1,
                windowInLiveResize: false
            )
        )
        // Secondary button also counts as a held-button knob interaction.
        XCTAssertFalse(
            StickToBottomLogic.allowsPinnedContentFollow(
                isPinned: true,
                mouseButtonsDown: 2,
                windowInLiveResize: false
            )
        )
    }

    func testPinnedContentFollowAllowedWhenPinnedAndNotDragging() {
        XCTAssertTrue(
            StickToBottomLogic.allowsPinnedContentFollow(
                isPinned: true,
                mouseButtonsDown: 0,
                windowInLiveResize: false
            )
        )
    }

    func testPinnedContentFollowDeniedWhenUnpinnedEvenWithoutDrag() {
        XCTAssertFalse(
            StickToBottomLogic.allowsPinnedContentFollow(
                isPinned: false,
                mouseButtonsDown: 0,
                windowInLiveResize: false
            )
        )
    }

    func testPinnedContentFollowAllowedDuringLiveWindowResizeWithMouseDown() {
        // Window chrome drag holds a button but must keep pin-edge follow so
        // width reflow does not leave the viewport mid-history.
        XCTAssertTrue(
            StickToBottomLogic.allowsPinnedContentFollow(
                isPinned: true,
                mouseButtonsDown: 1,
                windowInLiveResize: true
            )
        )
    }

    func testEndOfUpwardLiveScrollCannotReverseItsUnpinInsideFormerSoftBand() {
        let unpin = StickToBottomLogic.desiredPin(
            currentlyPinned: true,
            distanceFromBottom: 20,
            userLiveScroll: true,
            allowUnpin: true
        )
        XCTAssertEqual(unpin, false)

        // didEndLiveScroll can report the same gesture again. At 20pt from the
        // bottom it must remain unpinned rather than re-entering the old 72pt band.
        let endOfSameGesture = StickToBottomLogic.desiredPin(
            currentlyPinned: false,
            distanceFromBottom: 20,
            userLiveScroll: true,
            allowUnpin: true
        )
        XCTAssertNil(endOfSameGesture)
    }

    /// Regression: a user release is immediate, while the persistent pin binding
    /// is intentionally coalesced. Any stale automatic re-pin that arrives in
    /// that gap must not overwrite the pending user-unpin or reopen follow.
    func testPendingUserUnpinRejectsStaleRepinAndBlocksAllAutomaticFollow() {
        var follow = TranscriptFollowSuppression.State()

        // An older re-pin was already queued when the user starts scrolling up.
        XCTAssertTrue(follow.enqueuePersistentPin(true))
        let scheduledFollowGeneration = follow.generation
        follow.suppressImmediately()
        XCTAssertFalse(follow.isCurrent(scheduledFollowGeneration))
        XCTAssertFalse(follow.allowsFollow(isPinned: true))

        // The real user-unpin supersedes it. Simulate a late stream/document/
        // resize callback attempting the stale re-pin before the coalesced write.
        XCTAssertFalse(follow.enqueuePersistentPin(false))
        XCTAssertFalse(follow.enqueuePersistentPin(true))

        // Exactly one persistent write remains, and it preserves user intent.
        XCTAssertEqual(follow.takePersistentPin(), false)
        XCTAssertNil(follow.takePersistentPin())
        follow.didWritePersistentPin(false)
        // Defense against a stale write that escaped a prior queue turn.
        follow.didWritePersistentPin(true)

        // Every automatic entry point shares this gate while detached.
        for _ in 0..<3 { // stream append, document-frame, pinned-content follow
            XCTAssertFalse(follow.allowsFollow(isPinned: true))
        }
    }

    func testExplicitLatestResumeCancelsDeferredUnpinAndRestoresFollow() {
        var follow = TranscriptFollowSuppression.State()
        follow.suppressImmediately()
        XCTAssertTrue(follow.enqueuePersistentPin(false))
        XCTAssertFalse(follow.allowsFollow(isPinned: true))

        // Jump-to-latest is an explicit user intent, not a geometry callback.
        follow.resumeForExplicitLatest()
        XCTAssertNil(follow.takePersistentPin(), "obsolete unpin must not land after jump")
        XCTAssertTrue(follow.allowsFollow(isPinned: true))
    }

    /// Hot-path regression: AppKit may deliver hundreds of bounds/live-scroll
    /// notifications before SwiftUI commits the coalesced pin binding. A single
    /// user takeover must have O(1) semantic work rather than O(callbacks).
    func testFiveHundredUserTakeoverCallbacksAreEdgeTriggered() {
        var follow = TranscriptFollowSuppression.State()
        var viewport = TranscriptViewport.State(
            sessionKey: "s",
            itemCount: 320,
            mode: .liveLatest,
            generation: 0,
            scrollOwner: .live,
            pinToBottom: true,
            correctionsRemaining: 0
        )
        var userOwnerTransitions = 0
        var observableStateMutations = 0
        var suppressionInvalidations = 0
        var persistentFalseEnqueues = 0
        var persistentFalseWrites = 0
        var automaticFollowEffectsWhileDetached = 0

        for _ in 0..<500 {
            let viewportBefore = viewport
            _ = TranscriptViewport.reduce(&viewport, .userScrolled)
            if viewport.scrollOwner != viewportBefore.scrollOwner {
                userOwnerTransitions += 1
            }
            if viewport != viewportBefore {
                observableStateMutations += 1
            }

            let generationBefore = follow.generation
            follow.suppressImmediately()
            if follow.generation != generationBefore {
                suppressionInvalidations += 1
            }
            if follow.enqueuePersistentPin(false) {
                persistentFalseEnqueues += 1
            }
            if follow.allowsFollow(isPinned: true) || viewport.streamingMayWriteScroll {
                automaticFollowEffectsWhileDetached += 1
            }
        }

        if follow.takePersistentPin() == false {
            persistentFalseWrites += 1
        }

        XCTAssertEqual(userOwnerTransitions, 1)
        XCTAssertEqual(observableStateMutations, 1)
        XCTAssertEqual(suppressionInvalidations, 1)
        XCTAssertEqual(persistentFalseEnqueues, 1)
        XCTAssertEqual(persistentFalseWrites, 1)
        XCTAssertEqual(automaticFollowEffectsWhileDetached, 0)

        // Re-entering the latest edge is another single semantic transition;
        // repeated near-bottom callbacks cannot keep invalidating or requeueing.
        var recoveryTransitions = 0
        var persistentTrueEnqueues = 0
        var persistentTrueWrites = 0
        for _ in 0..<500 {
            let generationBefore = follow.generation
            follow.resumeAfterUserRepin()
            if follow.generation != generationBefore {
                recoveryTransitions += 1
            }
            if follow.enqueuePersistentPin(true) {
                persistentTrueEnqueues += 1
            }
        }
        if follow.takePersistentPin() == true {
            persistentTrueWrites += 1
        }

        XCTAssertEqual(recoveryTransitions, 1)
        XCTAssertEqual(persistentTrueEnqueues, 1)
        XCTAssertEqual(persistentTrueWrites, 1)
        XCTAssertTrue(follow.allowsFollow(isPinned: true))
    }

    func testDistanceDocumentEndFlipped() {
        let visible = CGRect(x: 0, y: 100, width: 300, height: 400)
        let d = StickToBottomLogic.distanceFromPinEdge(
            visible: visible,
            contentHeight: 1000,
            documentIsFlipped: true,
            pinEdge: .documentEnd
        )
        XCTAssertEqual(d, 500) // 1000 - 500
    }

    func testDistanceFromDocumentStartFlippedTopIsZero() {
        // Normal flipped transcript: document start at y=0; fully scrolled up → 0.
        let visible = CGRect(x: 0, y: 0, width: 300, height: 400)
        let d = StickToBottomLogic.distanceFromDocumentStart(
            visible: visible,
            contentHeight: 1000,
            documentIsFlipped: true
        )
        XCTAssertEqual(d, 0)
    }

    func testDistanceFromDocumentStartFlippedGrowsWithScroll() {
        // Scrolled 42pt down the flipped document → 42pt from the document start.
        let visible = CGRect(x: 0, y: 42, width: 300, height: 400)
        let d = StickToBottomLogic.distanceFromDocumentStart(
            visible: visible,
            contentHeight: 1000,
            documentIsFlipped: true
        )
        XCTAssertEqual(d, 42)
    }

    func testDistanceFromDocumentStartNonFlippedTopIsZero() {
        // Non-flipped origin is bottom-left: at the document top the viewport's
        // maxY equals the content height.
        let visible = CGRect(x: 0, y: 600, width: 300, height: 400)
        let d = StickToBottomLogic.distanceFromDocumentStart(
            visible: visible,
            contentHeight: 1000,
            documentIsFlipped: false
        )
        XCTAssertEqual(d, 0)
    }

    func testDistanceFromDocumentStartNonFlippedGrowsWithScroll() {
        // 42pt of scroll leaves the top 42pt of the document unreachable.
        let visible = CGRect(x: 0, y: 558, width: 300, height: 400)
        let d = StickToBottomLogic.distanceFromDocumentStart(
            visible: visible,
            contentHeight: 1000,
            documentIsFlipped: false
        )
        XCTAssertEqual(d, 42)
    }

    func testDistanceDocumentStartFlipped() {
        let visible = CGRect(x: 0, y: 40, width: 300, height: 400)
        let d = StickToBottomLogic.distanceFromPinEdge(
            visible: visible,
            contentHeight: 1000,
            documentIsFlipped: true,
            pinEdge: .documentStart
        )
        XCTAssertEqual(d, 40)
    }

    func testPinnedOriginForChronologicalFlippedDocumentEnd() {
        XCTAssertEqual(
            StickToBottomLogic.pinnedOriginY(
                contentHeight: 1000,
                visibleHeight: 400,
                documentIsFlipped: true,
                pinEdge: .documentEnd
            ),
            600
        )
    }

    func testPinnedOriginClampsShortDocumentAtZero() {
        XCTAssertEqual(
            StickToBottomLogic.pinnedOriginY(
                contentHeight: 200,
                visibleHeight: 400,
                documentIsFlipped: true,
                pinEdge: .documentEnd
            ),
            0
        )
    }

    func testPinnedOriginSupportsNonFlippedEdges() {
        XCTAssertEqual(
            StickToBottomLogic.pinnedOriginY(
                contentHeight: 1000,
                visibleHeight: 400,
                documentIsFlipped: false,
                pinEdge: .documentEnd
            ),
            0
        )
        XCTAssertEqual(
            StickToBottomLogic.pinnedOriginY(
                contentHeight: 1000,
                visibleHeight: 400,
                documentIsFlipped: false,
                pinEdge: .documentStart
            ),
            600
        )
    }
}
