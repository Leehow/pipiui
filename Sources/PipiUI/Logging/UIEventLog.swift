import AppKit

/// Subscribes to AppKit lifecycle notifications and turns them into log lines.
///
/// Deliberately implemented as an observer rather than call sites sprinkled
/// through the views: it gives a full window/app timeline without any view code
/// knowing about logging, which is what you want when chasing "白屏" — the
/// interesting fact is usually the *absence* of an event (no `didBecomeKey`,
/// no `didResize`) rather than something a view thought worth reporting.
public final class UIEventLog {
    public static let shared = UIEventLog()

    private var isInstalled = false
    private var tokens: [NSObjectProtocol] = []

    private init() {}

    /// Idempotent. Call on the main thread once AppKit exists.
    public func install(center: NotificationCenter = .default) {
        guard !isInstalled else { return }
        isInstalled = true

        observe(NSApplication.didFinishLaunchingNotification, "app didFinishLaunching", center: center)
        observe(NSApplication.didBecomeActiveNotification, "app didBecomeActive", center: center)
        observe(NSApplication.didResignActiveNotification, "app didResignActive", center: center)
        observe(NSApplication.willTerminateNotification, "app willTerminate", center: center)

        observeWindow(NSWindow.didBecomeKeyNotification, "didBecomeKey", center: center)
        observeWindow(NSWindow.willCloseNotification, "willClose", center: center)
        observeWindow(NSWindow.didMiniaturizeNotification, "didMiniaturize", center: center)
        observeWindow(NSWindow.didDeminiaturizeNotification, "didDeminiaturize", center: center)
        observeWindow(NSWindow.didChangeScreenNotification, "didChangeScreen", center: center)
        observeWindow(NSWindow.didChangeOcclusionStateNotification, "didChangeOcclusionState", center: center)
        // Resize is high frequency; keep it at debug so INFO logs stay readable.
        observeWindow(NSWindow.didResizeNotification, "didResize", center: center, level: .debug)
    }

    // MARK: - Internals

    private func observe(_ name: Notification.Name, _ label: String, center: NotificationCenter) {
        let token = center.addObserver(forName: name, object: nil, queue: .main) { _ in
            Log.info(label, category: .ui)
        }
        tokens.append(token)
    }

    private func observeWindow(
        _ name: Notification.Name,
        _ label: String,
        center: NotificationCenter,
        level: LogLevel = .info
    ) {
        let token = center.addObserver(forName: name, object: nil, queue: .main) { notification in
            guard let window = notification.object as? NSWindow else { return }
            let message = "window \(label): \(Self.describe(window))"
            switch level {
            case .debug: Log.debug(message, category: .ui)
            default: Log.info(message, category: .ui)
            }
        }
        tokens.append(token)
    }

    /// Compact one-line window description shared with ``LaunchDiagnostics``.
    static func describe(_ window: NSWindow) -> String {
        let content = window.contentView?.frame.size ?? .zero
        return String(
            format: "\"%@\" content=%.0fx%.0f visible=%@ occluded=%@",
            window.title,
            content.width, content.height,
            window.isVisible ? "yes" : "no",
            window.occlusionState.contains(.visible) ? "no" : "yes"
        )
    }

    deinit {
        for token in tokens {
            NotificationCenter.default.removeObserver(token)
        }
    }
}
