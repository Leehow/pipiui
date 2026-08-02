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
