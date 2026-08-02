import Foundation

/// Sliding settled-history window over a subagent's in-memory log (oldest → newest).
///
/// Mirrors the main transcript's `TranscriptRenderWindow`: the window is a pure
/// function of the top-visible page, so the detail log follows the viewport with
/// no pagination buttons. Pages are 100 log items; at most four pages render.
/// `agent.log` is capped at 800 items (oldest evicted), so the log can shrink
/// between a scroll event and this render; `resolve` clamps the top page into the
/// existing pages instead of producing an invalid window.
struct SubagentLogRenderWindow: Equatable {
    static let pageSize = 100
    /// Maximum rendered pages, also the window-slide step: sliding one page drops
    /// exactly one page at the start and adds one at the end.
    static let maxPages = 4

    let range: Range<Int>
    let totalCount: Int

    var isLatest: Bool { range.upperBound == totalCount }
    var renderedCount: Int { range.count }

    /// Index of the newest page (`p`); 0 for an empty log.
    static func latestPage(itemCount: Int) -> Int {
        let count = max(0, itemCount)
        return max(0, (count + pageSize - 1) / pageSize - 1)
    }

    /// Deterministic window anchor from the current pin state and the live
    /// top-visible item:
    /// - pinned → the newest page, independent of `.scrollPosition` reporting
    ///   (AppKit's pinned clip push can skip SwiftUI position callbacks);
    /// - a resolvable top-visible item index → that item's *current* page, so
    ///   a store-cap eviction that shifts the anchored row moves the window
    ///   with it instead of going stale until the next scroll event;
    /// - otherwise (nil id, bottom anchor, or an anchor evicted by the cap) →
    ///   `previousTopVisiblePage` clamped into [0, newest page]. Right after
    ///   unpinning the caller keeps the previous value at the newest page (the
    ///   user just left the bottom, so the newest window covers the viewport);
    ///   mid-history eviction instead keeps the user's place, never an
    ///   uninvited jump to the newest page.
    static func anchorPage(
        pinned: Bool,
        topVisibleItemIndex: Int?,
        previousTopVisiblePage: Int,
        itemCount: Int
    ) -> Int {
        if pinned { return latestPage(itemCount: itemCount) }
        if let index = topVisibleItemIndex { return index / pageSize }
        return min(max(0, previousTopVisiblePage), latestPage(itemCount: itemCount))
    }

    /// Window invariant: pages [N-1 … N+2] ∩ [0 … p], except N == 0 which renders
    /// only pages [0, 1]. N is clamped into [0, p] so a log that shrank (store cap
    /// eviction) between a scroll event and this render cannot produce an invalid
    /// window. At the latest page the clipping naturally leaves the bottom two
    /// pages, so pinned live mode renders exactly the pages that can be seen;
    /// logs shorter than two pages always render in full (≤ 400 items in total).
    static func resolve(itemCount: Int, topVisiblePage: Int) -> Self {
        let count = max(0, itemCount)
        let lastPage = latestPage(itemCount: count)
        let top = min(max(0, topVisiblePage), lastPage)
        let startPage = max(0, top - 1)
        let endPage: Int
        if top == 0 {
            endPage = min(lastPage + 1, 2)
        } else {
            endPage = min(lastPage + 1, top + maxPages - 1)
        }
        let start = startPage * pageSize
        let end = min(count, endPage * pageSize)
        return Self(range: start..<end, totalCount: count)
    }
}
