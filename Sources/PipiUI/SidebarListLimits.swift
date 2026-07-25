import Foundation

enum SidebarListLimits {
    static let projects = 6
    static let pinned = 10
    static let sessions = 20

    /// When collapsed and over `limit`, return prefix; `showsToggle` when `items.count > limit`.
    static func visiblePrefix<T>(of items: [T], limit: Int, expanded: Bool) -> (items: [T], showsToggle: Bool) {
        let showsToggle = items.count > limit
        if expanded || !showsToggle {
            return (items, showsToggle)
        }
        return (Array(items.prefix(limit)), true)
    }
}
