import CoreGraphics

/// Bottom status row (model / thinking / activity / metrics) layout choice.
///
/// Formerly used `ViewThatFits`, which runs `SizeFittingLayoutComputer` and can
/// form AttributeGraph cycles with borderless `Menu` + `.fixedSize()` — main-thread
/// hang under session switch. Branch on a measured width instead.
enum InputBarStatusLayout {
    /// Below this width, stack menus above activity/metrics.
    static let compactBelow: CGFloat = 520

    static func isCompact(width: CGFloat) -> Bool {
        guard width.isFinite, width > 0 else { return false }
        return width < compactBelow
    }
}
