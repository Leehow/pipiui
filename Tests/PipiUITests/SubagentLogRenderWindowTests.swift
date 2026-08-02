import XCTest
@testable import PipiUI

final class SubagentLogRenderWindowTests: XCTestCase {
    func testLatestPageBoundaries() {
        XCTAssertEqual(SubagentLogRenderWindow.latestPage(itemCount: 0), 0)
        XCTAssertEqual(SubagentLogRenderWindow.latestPage(itemCount: 1), 0)
        XCTAssertEqual(SubagentLogRenderWindow.latestPage(itemCount: 100), 0)
        XCTAssertEqual(SubagentLogRenderWindow.latestPage(itemCount: 101), 1)
        XCTAssertEqual(SubagentLogRenderWindow.latestPage(itemCount: 200), 1)
        XCTAssertEqual(SubagentLogRenderWindow.latestPage(itemCount: 201), 2)
        XCTAssertEqual(SubagentLogRenderWindow.latestPage(itemCount: 800), 7)
    }

    func testPinnedLatestWindowShowsBottomTwoPages() {
        // 1000 items → pages 0…9; pinned at the latest page renders pages [8, 9].
        let window = SubagentLogRenderWindow.resolve(
            itemCount: 1000,
            topVisiblePage: SubagentLogRenderWindow.latestPage(itemCount: 1000)
        )
        XCTAssertEqual(window.range, 800..<1000)
        XCTAssertEqual(window.renderedCount, 200)
        XCTAssertTrue(window.isLatest)
    }

    func testInitialSmallLogRendersEverything() {
        // count < 200 (two pages) → the whole log is always inside the window.
        XCTAssertEqual(SubagentLogRenderWindow.resolve(itemCount: 199, topVisiblePage: 0).range, 0..<199)
        XCTAssertEqual(
            SubagentLogRenderWindow.resolve(
                itemCount: 199,
                topVisiblePage: SubagentLogRenderWindow.latestPage(itemCount: 199)
            ).range,
            0..<199
        )
        XCTAssertEqual(SubagentLogRenderWindow.resolve(itemCount: 0, topVisiblePage: 0).range, 0..<0)
    }

    func testTopOfLogRendersFirstTwoPages() {
        XCTAssertEqual(SubagentLogRenderWindow.resolve(itemCount: 1000, topVisiblePage: 0).range, 0..<200)
    }

    func testMiddleWindowRendersFourPagesAroundTopVisiblePage() {
        // N = 4 → pages [3, 4, 5, 6] → items 300…700.
        let window = SubagentLogRenderWindow.resolve(itemCount: 1000, topVisiblePage: 4)
        XCTAssertEqual(window.range, 300..<700)
        XCTAssertEqual(window.renderedCount, 400)
    }

    func testEveryWindowIsAtMostFourPages() {
        for count in [0, 1, 50, 199, 200, 450, 800, 1000, 10_000] {
            for page in -2...20 {
                let window = SubagentLogRenderWindow.resolve(itemCount: count, topVisiblePage: page)
                XCTAssertLessThanOrEqual(window.renderedCount, 400, "count=\(count) page=\(page)")
                XCTAssertLessThanOrEqual(window.range.lowerBound, window.range.upperBound)
            }
        }
    }

    func testPageSlideAddsAndDropsExactlyOneHundredItems() {
        let before = SubagentLogRenderWindow.resolve(itemCount: 1000, topVisiblePage: 4)
        let after = SubagentLogRenderWindow.resolve(itemCount: 1000, topVisiblePage: 5)
        XCTAssertEqual(after.range.lowerBound - before.range.lowerBound, 100)
        XCTAssertEqual(after.range.upperBound - before.range.upperBound, 100)
        XCTAssertEqual(before.renderedCount, after.renderedCount)
        // The anchored row (top of page N) stays inside the new window.
        XCTAssertTrue(after.range.contains(4 * SubagentLogRenderWindow.pageSize))
    }

    func testWindowClampsWhenLogShrinksOrPageIsInvalid() {
        // N beyond the last page clamps to p (store cap eviction mid-scroll).
        XCTAssertEqual(
            SubagentLogRenderWindow.resolve(itemCount: 1000, topVisiblePage: 99).range,
            800..<1000
        )
        // Negative N clamps to 0.
        XCTAssertEqual(SubagentLogRenderWindow.resolve(itemCount: 1000, topVisiblePage: -3).range, 0..<200)
        // Empty log → empty window, no crash.
        XCTAssertTrue(SubagentLogRenderWindow.resolve(itemCount: 0, topVisiblePage: 3).range.isEmpty)
    }

    func testPinnedWindowFollowsAppendingLog() {
        // 150 items (< 2 pages): the whole log.
        var window = SubagentLogRenderWindow.resolve(
            itemCount: 150,
            topVisiblePage: SubagentLogRenderWindow.latestPage(itemCount: 150)
        )
        XCTAssertEqual(window.range, 0..<150)
        XCTAssertTrue(window.isLatest)

        // Grow past 200 while pinned: window becomes the bottom two pages.
        window = SubagentLogRenderWindow.resolve(
            itemCount: 350,
            topVisiblePage: SubagentLogRenderWindow.latestPage(itemCount: 350)
        )
        XCTAssertEqual(window.range, 200..<350)
        XCTAssertTrue(window.isLatest)

        // Each appended item extends the pinned window until the next page slide.
        window = SubagentLogRenderWindow.resolve(
            itemCount: 351,
            topVisiblePage: SubagentLogRenderWindow.latestPage(itemCount: 351)
        )
        XCTAssertEqual(window.range, 200..<351)
        XCTAssertTrue(window.isLatest)
    }

    func testTopVisibleRowPageIsAlwaysInsideItsOwnWindow() {
        // The anchored row is in page N; every valid window for N must contain it,
        // so `.scrollPosition` never has to chase a row outside the render range.
        for count in [200, 350, 800, 1000] {
            let lastPage = SubagentLogRenderWindow.latestPage(itemCount: count)
            for page in 0...lastPage {
                let window = SubagentLogRenderWindow.resolve(itemCount: count, topVisiblePage: page)
                let anchorIndex = page * SubagentLogRenderWindow.pageSize
                XCTAssertTrue(
                    window.range.contains(anchorIndex),
                    "count=\(count) page=\(page): \(anchorIndex) not in \(window.range)"
                )
            }
        }
    }
}
