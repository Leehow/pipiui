import XCTest
@testable import PipiUI

/// The transcript releases its bottom pin only for scrolls it can attribute to the
/// user. Getting this wrong in either direction is visible: too strict and a
/// scroller-knob drag fights every streaming chunk, too loose and the app's own
/// scroll-to-bottom unpins itself.
final class ScrollOriginTests: XCTestCase {
    func testHeldMouseButtonMeansUser() {
        XCTAssertEqual(ScrollOrigin.classify(mouseButtonsDown: 1), .user)
        XCTAssertTrue(ScrollOrigin.classify(mouseButtonsDown: 1).allowsUnpin)
    }

    func testAnySecondaryButtonAlsoCounts() {
        XCTAssertEqual(ScrollOrigin.classify(mouseButtonsDown: 2), .user)
    }

    func testNoButtonMeansProgrammaticOrUnknown() {
        XCTAssertEqual(ScrollOrigin.classify(mouseButtonsDown: 0), .programmaticOrUnknown)
        XCTAssertFalse(ScrollOrigin.classify(mouseButtonsDown: 0).allowsUnpin)
    }

    /// The app scrolls to the bottom roughly every 50 ms while streaming. Those
    /// moves must never be mistaken for the user letting go of the bottom.
    func testStreamingScrollsNeverUnpin() {
        for _ in 0..<100 {
            XCTAssertFalse(ScrollOrigin.classify(mouseButtonsDown: 0).allowsUnpin)
        }
    }
}
