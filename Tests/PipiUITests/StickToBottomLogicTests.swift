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
