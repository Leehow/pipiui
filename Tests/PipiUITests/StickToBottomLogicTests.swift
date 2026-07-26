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
}
