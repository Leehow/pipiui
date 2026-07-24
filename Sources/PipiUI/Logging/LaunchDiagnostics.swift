import AppKit

/// Records what the UI actually looked like shortly after launch.
///
/// Motivation: the "打开就白屏" reports have no evidence attached — by the time a
/// human looks, the state is gone. These snapshots make the difference between
/// "no window", "window with zero-sized content", "window fine but SwiftUI root
/// never laid out" and "everything normal" readable straight from the log file.
public enum LaunchDiagnostics {
    /// Delays (seconds after `applicationDidFinishLaunching`) at which a snapshot is taken.
    public static let snapshotDelays: [TimeInterval] = [1.0, 3.0]

    /// Last geometry the SwiftUI root reported, set by `ContentView`.
    public static var lastRootGeometry: CGSize?
    /// Number of layout passes the SwiftUI root has performed.
    public static var rootLayoutCount = 0

    public static func scheduleSnapshots() {
        for delay in snapshotDelays {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                snapshot(label: "t+\(delay)s")
            }
        }
    }

    /// Logs one line per window plus a root-layout summary. Safe to call any time.
    public static func snapshot(label: String) {
        let windows = NSApp?.windows ?? []
        let visible = windows.filter { $0.isVisible }
        Log.info(
            "ui snapshot \(label): windows=\(windows.count) visible=\(visible.count) "
                + "active=\(NSApp?.isActive == true) rootLayouts=\(rootLayoutCount) "
                + "rootGeometry=\(describe(lastRootGeometry))",
            category: .ui
        )

        for window in visible {
            Log.info("ui snapshot \(label): \(describe(window))", category: .ui)
        }

        if visible.isEmpty {
            Log.warn("ui snapshot \(label): no visible window — app launched without UI", category: .ui)
        }
        if let size = lastRootGeometry, !isUsable(size) {
            Log.warn(
                "ui snapshot \(label): SwiftUI root geometry is degenerate (\(describe(size))) — "
                    + "content collapses to nothing, this renders as a blank window",
                category: .ui
            )
        }
        if rootLayoutCount == 0 {
            Log.warn("ui snapshot \(label): SwiftUI root never laid out", category: .ui)
        }
    }

    /// A size that can actually show content.
    public static func isUsable(_ size: CGSize) -> Bool {
        size.width.isFinite && size.height.isFinite && size.width >= 1 && size.height >= 1
    }

    private static func describe(_ size: CGSize?) -> String {
        guard let size else { return "nil" }
        return String(format: "%.0fx%.0f", size.width, size.height)
    }

    private static func describe(_ window: NSWindow) -> String {
        let frame = window.frame
        let content = window.contentView?.frame.size ?? .zero
        let subviews = window.contentView?.subviews.count ?? -1
        return String(
            format: "window \"%@\" frame=%.0fx%.0f@%.0f,%.0f content=%.0fx%.0f subviews=%d key=%@ occluded=%@ alpha=%.2f",
            window.title,
            frame.width, frame.height, frame.origin.x, frame.origin.y,
            content.width, content.height,
            subviews,
            window.isKeyWindow ? "yes" : "no",
            window.occlusionState.contains(.visible) ? "no" : "yes",
            window.alphaValue
        )
    }
}
