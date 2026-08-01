import Foundation

enum SidebarListLimits {
    static let projects = 6
    static let pinned = 10
    static let sessions = 10

    /// How many extra items a single 「更多」 click reveals on top of the current shown count.
    static let pageSize = 10

    /// Items to show for a given `shown` count. The shown count is clamped to
    /// `[limit, total]` and the list shows `min(total, shown)` items — one click
    /// never dumps the whole list. `showsToggle` is true when `items.count > limit`.
    static func visiblePrefix<T>(of items: [T], limit: Int, shown: Int) -> (items: [T], showsToggle: Bool) {
        let showsToggle = items.count > limit
        let shownCount = min(max(shown, limit), items.count)
        return (Array(items.prefix(shownCount)), showsToggle)
    }

    static func splitVisibleCounts(
        leadingCount: Int,
        trailingCount: Int,
        limit: Int,
        shown: Int
    ) -> (leading: Int, trailing: Int, showsToggle: Bool) {
        let total = leadingCount + trailingCount
        let showsToggle = total > limit
        let shownCount = min(max(shown, limit), total)
        let leading = min(leadingCount, shownCount)
        let trailing = min(trailingCount, max(0, shownCount - leading))
        return (leading, trailing, showsToggle)
    }
}
