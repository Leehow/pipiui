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
}
