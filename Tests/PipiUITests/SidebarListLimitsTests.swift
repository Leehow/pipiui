import XCTest
@testable import PipiUI

final class SidebarListLimitsTests: XCTestCase {
    func testConstants() {
        XCTAssertEqual(SidebarListLimits.projects, 6)
        XCTAssertEqual(SidebarListLimits.pinned, 10)
        XCTAssertEqual(SidebarListLimits.sessions, 10)
        XCTAssertEqual(SidebarListLimits.pageSize, 10)
    }

    // MARK: - visiblePrefix: per-click pagination semantics

    func testInitialShownCountShowsCapAndToggle() {
        let items = Array(0..<25)
        let out = SidebarListLimits.visiblePrefix(of: items, limit: 6, shown: 6)
        XCTAssertEqual(out.items, Array(0..<6))
        XCTAssertTrue(out.showsToggle)
    }

    func testOneClickShowsCapPlusPageSize() {
        let items = Array(0..<25)
        let out = SidebarListLimits.visiblePrefix(
            of: items,
            limit: 6,
            shown: 6 + SidebarListLimits.pageSize
        )
        XCTAssertEqual(out.items, Array(0..<16))
        XCTAssertTrue(out.showsToggle)
    }

    func testMultipleClicksCapAtTotal() {
        let items = Array(0..<25)
        let out = SidebarListLimits.visiblePrefix(
            of: items,
            limit: 6,
            shown: 6 + SidebarListLimits.pageSize * 10
        )
        XCTAssertEqual(out.items, items)
        XCTAssertTrue(out.showsToggle)
    }

    func testShownCountClampedToLimitWhenBelowCap() {
        let items = Array(0..<25)
        let out = SidebarListLimits.visiblePrefix(of: items, limit: 6, shown: 2)
        XCTAssertEqual(out.items, Array(0..<6))
        XCTAssertTrue(out.showsToggle)
    }

    func testAutoRevealShowsOnlyThroughSelectedIndex() {
        // Selecting a project beyond the cap sets shown = index + 1: the row is
        // revealed without dumping the whole list.
        let items = Array(0..<25)
        let index = 8
        let out = SidebarListLimits.visiblePrefix(of: items, limit: 6, shown: index + 1)
        XCTAssertEqual(out.items, Array(0...index))
        XCTAssertTrue(out.showsToggle)
    }

    func testSearchRevealEquivalentShowsEverything() {
        // Search reveal sets the shown count to Int.max; clamping to total keeps
        // the result identical to the old forced expand.
        let items = Array(0..<25)
        let out = SidebarListLimits.visiblePrefix(of: items, limit: 6, shown: Int.max)
        XCTAssertEqual(out.items, items)
        XCTAssertTrue(out.showsToggle)
    }

    func testAtOrUnderLimitNoToggle() {
        let items = Array(0..<6)
        let out = SidebarListLimits.visiblePrefix(of: items, limit: 6, shown: 6)
        XCTAssertEqual(out.items, items)
        XCTAssertFalse(out.showsToggle)
    }

    func testUnderLimitIgnoresHighShownCount() {
        let items = Array(0..<4)
        let out = SidebarListLimits.visiblePrefix(
            of: items,
            limit: 6,
            shown: 6 + SidebarListLimits.pageSize
        )
        XCTAssertEqual(out.items, items)
        XCTAssertFalse(out.showsToggle)
    }

    func testEmpty() {
        let out = SidebarListLimits.visiblePrefix(of: [Int](), limit: 6, shown: 6)
        XCTAssertTrue(out.items.isEmpty)
        XCTAssertFalse(out.showsToggle)
    }

    // MARK: - splitVisibleCounts: per-project session sections (new:* + metas)

    func testSplitVisibleCountsInitialCap() {
        let out = SidebarListLimits.splitVisibleCounts(
            leadingCount: 3,
            trailingCount: 20,
            limit: 10,
            shown: 10
        )
        XCTAssertEqual(out.leading, 3)
        XCTAssertEqual(out.trailing, 7)
        XCTAssertTrue(out.showsToggle)
    }

    func testSplitVisibleCountsAfterOneClick() {
        let out = SidebarListLimits.splitVisibleCounts(
            leadingCount: 3,
            trailingCount: 20,
            limit: 10,
            shown: 20
        )
        XCTAssertEqual(out.leading, 3)
        XCTAssertEqual(out.trailing, 17)
        XCTAssertTrue(out.showsToggle)
    }

    func testSplitVisibleCountsRevealsAll() {
        let out = SidebarListLimits.splitVisibleCounts(
            leadingCount: 3,
            trailingCount: 20,
            limit: 10,
            shown: Int.max
        )
        XCTAssertEqual(out.leading, 3)
        XCTAssertEqual(out.trailing, 20)
        XCTAssertTrue(out.showsToggle)
    }

    func testSplitVisibleCountsClampedToLimitWhenBelowCap() {
        let out = SidebarListLimits.splitVisibleCounts(
            leadingCount: 3,
            trailingCount: 20,
            limit: 10,
            shown: 1
        )
        XCTAssertEqual(out.leading, 3)
        XCTAssertEqual(out.trailing, 7)
        XCTAssertTrue(out.showsToggle)
    }

    func testSplitVisibleCountsAtOrUnderLimitNoToggle() {
        let out = SidebarListLimits.splitVisibleCounts(
            leadingCount: 2,
            trailingCount: 3,
            limit: 10,
            shown: 10
        )
        XCTAssertEqual(out.leading, 2)
        XCTAssertEqual(out.trailing, 3)
        XCTAssertFalse(out.showsToggle)
    }

    // MARK: - unrelated app-store helpers kept green

    func testPinnedProjectsSortStably() {
        XCTAssertEqual(
            AppStore.orderedProjectPaths(["a", "b", "c", "d"], pinnedPaths: ["b", "d"]),
            ["b", "d", "a", "c"]
        )
    }

    func testProjectDisplayNamePreferencesDropStaleAndBlankEntries() {
        XCTAssertEqual(
            AppStore.sanitizedProjectDisplayNameOverrides(
                ["/one": "  Alpha  ", "/two": "   ", "/stale": "Gone"],
                projectPaths: ["/one", "/two"]
            ),
            ["/one": "Alpha"]
        )
    }
}
