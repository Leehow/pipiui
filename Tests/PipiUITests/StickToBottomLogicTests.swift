import XCTest
@testable import PipiUI

final class StickToBottomLogicTests: XCTestCase {
    func testLiveScrollUnpinsInsideSoftBand() {
        // 20pt off bottom is inside the 72pt re-pin band but must still unpin on wheel,
        // otherwise scrollToBottom fights every notch.
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

    func testFarFromBottomUnpinsEvenWithoutLiveScrollFlag() {
        let desired = StickToBottomLogic.desiredPin(
            currentlyPinned: true,
            distanceFromBottom: 100,
            userLiveScroll: false,
            allowUnpin: true
        )
        XCTAssertEqual(desired, false)
    }

    func testNearBottomRepinsWhenUnpinned() {
        let desired = StickToBottomLogic.desiredPin(
            currentlyPinned: false,
            distanceFromBottom: 10,
            userLiveScroll: false,
            allowUnpin: true
        )
        XCTAssertEqual(desired, true)
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

    // MARK: - Prepend compensation geometry (exact-top history loading)

    func testDistanceFromDocumentEndFlipped() {
        // Flipped (top = 0): viewport bottom edge is 500pt above the document end.
        let visible = CGRect(x: 0, y: 100, width: 300, height: 400)
        XCTAssertEqual(
            StickToBottomLogic.distanceFromDocumentEnd(
                visible: visible,
                contentHeight: 1000,
                documentIsFlipped: true
            ),
            500
        )
    }

    func testDistanceFromDocumentEndNonFlipped() {
        // Non-flipped (bottom = 0): the viewport's bottom edge sits at minY.
        let visible = CGRect(x: 0, y: 200, width: 300, height: 400)
        XCTAssertEqual(
            StickToBottomLogic.distanceFromDocumentEnd(
                visible: visible,
                contentHeight: 1000,
                documentIsFlipped: false
            ),
            200
        )
    }

    func testDistanceFromDocumentEndClampsElasticOverscrollAtZero() {
        // Non-flipped elastic overscroll at the bottom pushes minY negative.
        let visible = CGRect(x: 0, y: -6, width: 300, height: 400)
        XCTAssertEqual(
            StickToBottomLogic.distanceFromDocumentEnd(
                visible: visible,
                contentHeight: 1000,
                documentIsFlipped: false
            ),
            0
        )
        // Flipped elastic overscroll at the top: maxY may exceed content height.
        let overTop = CGRect(x: 0, y: -8, width: 300, height: 400)
        XCTAssertEqual(
            StickToBottomLogic.distanceFromDocumentEnd(
                visible: overTop,
                contentHeight: 1000,
                documentIsFlipped: true
            ),
            608
        )
    }

    func testRestoredOriginFlippedKeepsSnapshotDistance() {
        // Snapshot: 200pt from the newest edge. After the prepend the document
        // grew by 300pt (700 → 1000); the origin must move down by exactly 300
        // so the *same content* stays under the cursor.
        let distance = StickToBottomLogic.distanceFromDocumentEnd(
            visible: CGRect(x: 0, y: 100, width: 300, height: 400),
            contentHeight: 700,
            documentIsFlipped: true
        )
        XCTAssertEqual(distance, 200)
        let origin = StickToBottomLogic.restoredOriginY(
            snapshotDistanceFromEnd: distance,
            contentHeight: 1000,
            viewportHeight: 400,
            documentIsFlipped: true
        )
        XCTAssertEqual(origin, 400)
        // The restored geometry reports exactly the snapshot's distance.
        let restored = CGRect(x: 0, y: origin, width: 300, height: 400)
        XCTAssertEqual(
            StickToBottomLogic.distanceFromDocumentEnd(
                visible: restored,
                contentHeight: 1000,
                documentIsFlipped: true
            ),
            distance
        )
    }

    func testRestoredOriginNonFlippedKeepsSnapshotDistance() {
        // Snapshot: 200pt from the newest (bottom) edge. Prepending above never
        // shifts non-flipped content, so the origin stays at the distance.
        let distance = StickToBottomLogic.distanceFromDocumentEnd(
            visible: CGRect(x: 0, y: 200, width: 300, height: 400),
            contentHeight: 1000,
            documentIsFlipped: false
        )
        XCTAssertEqual(distance, 200)
        let origin = StickToBottomLogic.restoredOriginY(
            snapshotDistanceFromEnd: distance,
            contentHeight: 1300,
            viewportHeight: 400,
            documentIsFlipped: false
        )
        XCTAssertEqual(origin, 200)
        let restored = CGRect(x: 0, y: origin, width: 300, height: 400)
        XCTAssertEqual(
            StickToBottomLogic.distanceFromDocumentEnd(
                visible: restored,
                contentHeight: 1300,
                documentIsFlipped: false
            ),
            distance
        )
    }

    func testRestoredOriginClampsToLegalScrollRange() {
        // Short document (content 300 < viewport 400): nothing to scroll — the
        // flipped origin must land at 0, never negative.
        XCTAssertEqual(
            StickToBottomLogic.restoredOriginY(
                snapshotDistanceFromEnd: 200,
                contentHeight: 300,
                viewportHeight: 400,
                documentIsFlipped: true
            ),
            0
        )
        // Flipped: a snapshot distance larger than the document clamps to origin 0.
        XCTAssertEqual(
            StickToBottomLogic.restoredOriginY(
                snapshotDistanceFromEnd: 1500,
                contentHeight: 1000,
                viewportHeight: 400,
                documentIsFlipped: true
            ),
            0
        )
        // Non-flipped: an unreachable distance clamps to the maximum origin.
        XCTAssertEqual(
            StickToBottomLogic.restoredOriginY(
                snapshotDistanceFromEnd: 1500,
                contentHeight: 1000,
                viewportHeight: 400,
                documentIsFlipped: false
            ),
            600
        )
    }
}
