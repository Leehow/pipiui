import Foundation

enum SidebarListLimits {
    static let projects = 6
    static let pinned = 10
    static let sessions = 10

    /// When collapsed and over `limit`, return prefix; `showsToggle` when `items.count > limit`.
    static func visiblePrefix<T>(of items: [T], limit: Int, expanded: Bool) -> (items: [T], showsToggle: Bool) {
        let showsToggle = items.count > limit
        if expanded || !showsToggle {
            return (items, showsToggle)
        }
        return (Array(items.prefix(limit)), true)
    }

    static func splitVisibleCounts(
        leadingCount: Int,
        trailingCount: Int,
        limit: Int,
        expanded: Bool
    ) -> (leading: Int, trailing: Int, showsToggle: Bool) {
        let total = leadingCount + trailingCount
        let showsToggle = total > limit
        if expanded || !showsToggle {
            return (leadingCount, trailingCount, showsToggle)
        }
        let leading = min(leadingCount, limit)
        let trailing = min(trailingCount, max(0, limit - leading))
        return (leading, trailing, true)
    }
}
