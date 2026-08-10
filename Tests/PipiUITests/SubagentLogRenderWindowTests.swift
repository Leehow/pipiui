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

    // MARK: - Anchor resolution (pinned growth / unpin / cap eviction)

    func testPinnedGrowthResolvesNewestPageRegardlessOfStaleCachedPage() {
        // Pinned across multi-page growth: an arbitrarily stale cached previous
        // page must resolve to the newest page.
        let page = SubagentLogRenderWindow.anchorPage(
            pinned: true,
            topVisibleItemIndex: 2,
            previousTopVisiblePage: 0,
            itemCount: 1500
        )
        XCTAssertEqual(page, 14)
        XCTAssertEqual(page, SubagentLogRenderWindow.latestPage(itemCount: 1500))
        // Empty log while pinned: newest page is 0.
        XCTAssertEqual(
            SubagentLogRenderWindow.anchorPage(
                pinned: true, topVisibleItemIndex: nil, previousTopVisiblePage: 3, itemCount: 0
            ),
            0
        )
    }

    func testUnpinnedResolvesLiveItemToItsCurrentPage() {
        // Pin→unpin with a valid live item id → the page of its current index.
        XCTAssertEqual(
            SubagentLogRenderWindow.anchorPage(
                pinned: false, topVisibleItemIndex: 450, previousTopVisiblePage: 14, itemCount: 1000
            ),
            4
        )
        // Page boundaries of the index→page mapping.
        XCTAssertEqual(
            SubagentLogRenderWindow.anchorPage(
                pinned: false, topVisibleItemIndex: 199, previousTopVisiblePage: 0, itemCount: 1000
            ),
            1
        )
        XCTAssertEqual(
            SubagentLogRenderWindow.anchorPage(
                pinned: false, topVisibleItemIndex: 200, previousTopVisiblePage: 0, itemCount: 1000
            ),
            2
        )
        // Cap eviction that shifts the anchor (item 350 after 50 evictions):
        // keep the anchor's new index page (3), not the stale cached page (5).
        XCTAssertEqual(
            SubagentLogRenderWindow.anchorPage(
                pinned: false, topVisibleItemIndex: 350, previousTopVisiblePage: 5, itemCount: 800
            ),
            3
        )
    }

    func testUnpinnedUnresolvableAnchorFallsBackDeterministically() {
        // Pin→unpin with an unresolvable id (nil / bottom anchor / cap-evicted):
        // the caller passes the newest page as the previous value, so the clamp
        // lands on the newest page — the viewport was at the bottom.
        let newest = SubagentLogRenderWindow.latestPage(itemCount: 812)
        XCTAssertEqual(
            SubagentLogRenderWindow.anchorPage(
                pinned: false, topVisibleItemIndex: nil, previousTopVisiblePage: newest, itemCount: 812
            ),
            newest
        )
        // Mid-history eviction: keep the previous page (clamped into range),
        // never an uninvited jump to the newest page.
        XCTAssertEqual(
            SubagentLogRenderWindow.anchorPage(
                pinned: false, topVisibleItemIndex: nil, previousTopVisiblePage: 5, itemCount: 800
            ),
            5
        )
        // Out-of-range previous pages clamp deterministically.
        XCTAssertEqual(
            SubagentLogRenderWindow.anchorPage(
                pinned: false, topVisibleItemIndex: nil, previousTopVisiblePage: 99, itemCount: 800
            ),
            7
        )
        XCTAssertEqual(
            SubagentLogRenderWindow.anchorPage(
                pinned: false, topVisibleItemIndex: nil, previousTopVisiblePage: -3, itemCount: 800
            ),
            0
        )
        // An anchor resolved on a log that shrank out from under it still maps
        // to an existing page (no crash; `resolve` clamps the window too).
        XCTAssertEqual(
            SubagentLogRenderWindow.anchorPage(
                pinned: false, topVisibleItemIndex: 1, previousTopVisiblePage: 1, itemCount: 0
            ),
            0
        )
    }

    // MARK: - Hard mount ceiling + overscan (goal 1)

    func testMaxRenderedItemsMatchesWindowCeiling() {
        XCTAssertEqual(
            SubagentLogRenderWindow.maxRenderedItems,
            SubagentLogRenderWindow.maxPages * SubagentLogRenderWindow.pageSize
        )
        XCTAssertEqual(SubagentLogRenderWindow.maxRenderedItems, 400)
    }

    func testNoWindowEverExceedsMountCeiling() {
        // The render window is the only set of items available to mount; a lazy
        // container cannot exceed it. This must hold for every log length and
        // every (even out-of-range) anchor page.
        let ceiling = SubagentLogRenderWindow.maxRenderedItems
        for count in [0, 1, 50, 199, 200, 350, 399, 400, 401, 800, 801, 5_000] {
            for page in -3...60 {
                let window = SubagentLogRenderWindow.resolve(itemCount: count, topVisiblePage: page)
                XCTAssertLessThanOrEqual(
                    window.renderedCount, ceiling,
                    "count=\(count) page=\(page) rendered \(window.renderedCount)"
                )
            }
        }
    }

    func testMountedCeilingStaysStableAsLogGrowsPinned() {
        // Pinned live growth: each appended item extends the newest window until
        // the next page slide, but the rendered count never exceeds the ceiling.
        let ceiling = SubagentLogRenderWindow.maxRenderedItems
        var rendered = 0
        for count in 1...2_000 {
            let window = SubagentLogRenderWindow.resolve(
                itemCount: count,
                topVisiblePage: SubagentLogRenderWindow.latestPage(itemCount: count)
            )
            XCTAssertTrue(window.isLatest, "count=\(count)")
            XCTAssertLessThanOrEqual(window.renderedCount, ceiling)
            rendered = window.renderedCount
        }
        // At 2000 items the pinned window is the bottom two pages (still ≤ ceiling).
        XCTAssertEqual(rendered, 200)
    }

    // MARK: - Hysteresis / threshold / dedup window anchor (goal 2)

    func testStableAnchorKeepsCommittedWhileAnchorInsideWindow() {
        // committed page 4 → window 300..<700. Any anchor inside keeps page 4,
        // even when it crosses an internal page boundary (no whole-page flap).
        let anchorIndices = [300, 399, 400, 500, 600, 699]
        for index in anchorIndices {
            XCTAssertEqual(
                SubagentLogRenderWindow.stableAnchorPage(
                    itemCount: 1000, committedTopVisiblePage: 4, liveAnchorIndex: index
                ),
                4,
                "index=\(index)"
            )
        }
    }

    func testStableAnchorDoesNotFlapAcrossPageBoundaryInsideWindow() {
        // The classic flap: top row oscillates between the last item of page 3
        // (index 399) and the first of page 4 (index 400). Both sit inside the
        // committed window for page 4, so the window never moves.
        let a = SubagentLogRenderWindow.stableAnchorPage(
            itemCount: 1000, committedTopVisiblePage: 4, liveAnchorIndex: 399
        )
        let b = SubagentLogRenderWindow.stableAnchorPage(
            itemCount: 1000, committedTopVisiblePage: 4, liveAnchorIndex: 400
        )
        XCTAssertEqual(a, 4)
        XCTAssertEqual(b, 4)
        XCTAssertEqual(a, b)
    }

    func testStableAnchorSlidesOnlyWhenAnchorLeavesWindow() {
        // Anchor leaves the top edge → slide down to its page.
        XCTAssertEqual(
            SubagentLogRenderWindow.stableAnchorPage(
                itemCount: 1000, committedTopVisiblePage: 4, liveAnchorIndex: 700
            ),
            7
        )
        // Anchor leaves the bottom edge → slide up to its page.
        XCTAssertEqual(
            SubagentLogRenderWindow.stableAnchorPage(
                itemCount: 1000, committedTopVisiblePage: 4, liveAnchorIndex: 299
            ),
            2
        )
        // After sliding down to 7, scrolling back into the overlap (600..<700)
        // keeps page 7 — no flap back to 4 (hysteresis).
        XCTAssertEqual(
            SubagentLogRenderWindow.stableAnchorPage(
                itemCount: 1000, committedTopVisiblePage: 7, liveAnchorIndex: 650
            ),
            7
        )
    }

    func testStableAnchorSlidesAtMostOncePerThresholdCrossing() {
        // Walk the anchor from 300 to 800 one item at a time and assert the
        // committed page is a non-decreasing step function that only advances
        // when the anchor leaves the current window (no oscillation).
        var committed = 4
        var advances = 0
        for index in 300...800 {
            let next = SubagentLogRenderWindow.stableAnchorPage(
                itemCount: 1000, committedTopVisiblePage: committed, liveAnchorIndex: index
            )
            XCTAssertGreaterThanOrEqual(next, committed, "regressed at index \(index)")
            if next != committed { advances += 1 }
            committed = next
            // Every committed page's window must cover the anchor (viewport safety).
            XCTAssertTrue(
                SubagentLogRenderWindow.resolve(itemCount: 1000, topVisiblePage: committed)
                    .range.contains(index),
                "index \(index) uncovered after committing page \(committed)"
            )
        }
        XCTAssertEqual(advances, 1, "expected a single threshold slide 4→7")
        XCTAssertEqual(committed, 7)
    }

    func testStableAnchorDedupesIdenticalInputs() {
        // Pure function: identical inputs → identical page (call site skips the
        // state write, so equal windows re-render nothing).
        for committed in 0...8 {
            for index in 0..<1000 {
                let lhs = SubagentLogRenderWindow.stableAnchorPage(
                    itemCount: 1000, committedTopVisiblePage: committed, liveAnchorIndex: index
                )
                let rhs = SubagentLogRenderWindow.stableAnchorPage(
                    itemCount: 1000, committedTopVisiblePage: committed, liveAnchorIndex: index
                )
                XCTAssertEqual(lhs, rhs)
            }
        }
    }

    func testStableAnchorUnresolvableKeepsCommittedPage() {
        // nil (bottom anchor / unknown id), negative, and ≥ count all keep the
        // committed page — the caller seeds it, so there is never an uninvited jump.
        let committed = 5
        XCTAssertEqual(
            SubagentLogRenderWindow.stableAnchorPage(
                itemCount: 1000, committedTopVisiblePage: committed, liveAnchorIndex: nil
            ),
            committed
        )
        XCTAssertEqual(
            SubagentLogRenderWindow.stableAnchorPage(
                itemCount: 1000, committedTopVisiblePage: committed, liveAnchorIndex: -1
            ),
            committed
        )
        XCTAssertEqual(
            SubagentLogRenderWindow.stableAnchorPage(
                itemCount: 1000, committedTopVisiblePage: committed, liveAnchorIndex: 1000
            ),
            committed
        )
        XCTAssertEqual(
            SubagentLogRenderWindow.stableAnchorPage(
                itemCount: 1000, committedTopVisiblePage: committed, liveAnchorIndex: 5_000
            ),
            committed
        )
        // Empty log: any anchor keeps committed (no crash).
        XCTAssertEqual(
            SubagentLogRenderWindow.stableAnchorPage(
                itemCount: 0, committedTopVisiblePage: 3, liveAnchorIndex: 0
            ),
            3
        )
    }

    // MARK: - Append follow-bottom / off-bottom semantics (goal 4)

    func testPinnedAppendFollowsBottomWithoutExceedingCeiling() {
        // While pinned, appending items keeps the window at the newest pages and
        // never exceeds the mount ceiling — auto-follow stays cheap as the log grows.
        let ceiling = SubagentLogRenderWindow.maxRenderedItems
        var committed = SubagentLogRenderWindow.latestPage(itemCount: 350)
        for appended in 351...1_500 {
            let window = SubagentLogRenderWindow.resolve(
                itemCount: appended, topVisiblePage: committed
            )
            XCTAssertTrue(window.isLatest, "appended=\(appended)")
            XCTAssertLessThanOrEqual(window.renderedCount, ceiling)
            committed = SubagentLogRenderWindow.latestPage(itemCount: appended)
        }
        XCTAssertEqual(committed, SubagentLogRenderWindow.latestPage(itemCount: 1_500))
    }

    func testUnpinnedHistoryStaysPutWhileLogAppendsBelow() {
        // User browsed up to page 2 (window 100..<500) and the live agent keeps
        // appending at the bottom: the history window does not get pulled to the
        // newest — the viewport stays where the user left it.
        let committed = 2
        let anchor = 250  // inside 100..<500
        for appended in 1_000...1_400 {
            let page = SubagentLogRenderWindow.stableAnchorPage(
                itemCount: appended, committedTopVisiblePage: committed, liveAnchorIndex: anchor
            )
            XCTAssertEqual(page, 2, "appended=\(appended)")
            let window = SubagentLogRenderWindow.resolve(itemCount: appended, topVisiblePage: page)
            XCTAssertTrue(window.range.contains(anchor), "appended=\(appended)")
            XCTAssertFalse(window.isLatest, "appended=\(appended) — must not jump to newest")
        }
    }

    func testUnpinnedWindowSurvivesCapEvictionKeepingAnchorCovered() {
        // Store caps at 800; appending past it evicts the oldest item, shifting
        // every index down by 1. The anchored row must stay inside its window.
        var committed = 4  // window 300..<700 at count 1000 (capped → 800)
        for evictedCount in 0...200 {
            let count = 800
            // Anchor drifts down as items are evicted from the front.
            let anchor = max(0, 450 - evictedCount)
            let page = SubagentLogRenderWindow.stableAnchorPage(
                itemCount: count, committedTopVisiblePage: committed, liveAnchorIndex: anchor
            )
            let window = SubagentLogRenderWindow.resolve(itemCount: count, topVisiblePage: page)
            XCTAssertTrue(
                window.range.contains(anchor),
                "evicted=\(evictedCount) anchor=\(anchor) page=\(page) window=\(window.range)"
            )
            XCTAssertLessThanOrEqual(window.renderedCount, SubagentLogRenderWindow.maxRenderedItems)
            committed = page
        }
    }
}
