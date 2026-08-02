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

    /// AppKit content-growth following may move the clip view while streaming.
    /// Those moves must never be mistaken for the user releasing the bottom pin.
    func testStreamingScrollsNeverUnpin() {
        for _ in 0..<100 {
            XCTAssertFalse(ScrollOrigin.classify(mouseButtonsDown: 0).allowsUnpin)
        }
    }

    /// Window resize holds a mouse button on the chrome while the transcript
    /// reflows — must not look like a scroller-knob drag that unpins.
    func testLiveWindowResizeNeverUnpinsEvenWithMouseDown() {
        let origin = ScrollOrigin.classify(mouseButtonsDown: 1, windowInLiveResize: true)
        XCTAssertEqual(origin, .programmaticOrUnknown)
        XCTAssertFalse(origin.allowsUnpin)
    }

    func testProgrammaticBoundsChangeNeverStartsKnobDragTracking() {
        // A programmatic scrollTo also posts a clip-bounds notification. Without
        // the held-button attribution it must not enter the knob-drag path.
        XCTAssertFalse(ScrollOrigin.classify(mouseButtonsDown: 0).allowsUnpin)
    }
}
