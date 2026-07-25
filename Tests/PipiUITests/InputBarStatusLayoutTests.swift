import XCTest
@testable import PipiUI

final class InputBarStatusLayoutTests: XCTestCase {
    func testCompactBelowThreshold() {
        XCTAssertTrue(InputBarStatusLayout.isCompact(width: 360))
        XCTAssertTrue(InputBarStatusLayout.isCompact(width: InputBarStatusLayout.compactBelow - 1))
    }

    func testWideAtOrAboveThreshold() {
        XCTAssertFalse(InputBarStatusLayout.isCompact(width: InputBarStatusLayout.compactBelow))
        XCTAssertFalse(InputBarStatusLayout.isCompact(width: 900))
    }

    func testUnsetOrInvalidWidthDefaultsToWide() {
        // Avoid ViewThatFits; before first measure, prefer the single-row layout.
        XCTAssertFalse(InputBarStatusLayout.isCompact(width: 0))
        XCTAssertFalse(InputBarStatusLayout.isCompact(width: -1))
        XCTAssertFalse(InputBarStatusLayout.isCompact(width: CGFloat.nan))
        XCTAssertFalse(InputBarStatusLayout.isCompact(width: CGFloat.infinity))
    }
}
