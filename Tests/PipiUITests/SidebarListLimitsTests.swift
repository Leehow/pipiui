import XCTest
@testable import PipiUI

final class SidebarListLimitsTests: XCTestCase {
    func testConstants() {
        XCTAssertEqual(SidebarListLimits.projects, 6)
        XCTAssertEqual(SidebarListLimits.pinned, 10)
        XCTAssertEqual(SidebarListLimits.sessions, 20)
    }

    func testCollapsedTruncatesAndShowsToggle() {
        let items = Array(0..<25)
        let out = SidebarListLimits.visiblePrefix(of: items, limit: 20, expanded: false)
        XCTAssertEqual(out.items, Array(0..<20))
        XCTAssertTrue(out.showsToggle)
    }

    func testExpandedShowsAllAndStillShowsToggle() {
        let items = Array(0..<25)
        let out = SidebarListLimits.visiblePrefix(of: items, limit: 20, expanded: true)
        XCTAssertEqual(out.items, items)
        XCTAssertTrue(out.showsToggle)
    }

    func testAtOrUnderLimitNoToggle() {
        let items = Array(0..<6)
        let out = SidebarListLimits.visiblePrefix(of: items, limit: 6, expanded: false)
        XCTAssertEqual(out.items, items)
        XCTAssertFalse(out.showsToggle)
    }

    func testEmpty() {
        let out = SidebarListLimits.visiblePrefix(of: [Int](), limit: 6, expanded: false)
        XCTAssertTrue(out.items.isEmpty)
        XCTAssertFalse(out.showsToggle)
    }

    func testSplitVisibleCounts() {
        let out = SidebarListLimits.splitVisibleCounts(
            leadingCount: 3,
            trailingCount: 20,
            limit: 20,
            expanded: false
        )
        XCTAssertEqual(out.leading, 3)
        XCTAssertEqual(out.trailing, 17)
        XCTAssertTrue(out.showsToggle)
    }
}
