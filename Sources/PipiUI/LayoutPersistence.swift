import SwiftUI
import AppKit

enum LayoutPersistence {
    enum Key {
        static let windowWidth = "pipiui.windowWidth"
        static let windowHeight = "pipiui.windowHeight"
        static let sidebarWidthRatio = "pipiui.sidebarWidthRatio"
        static let rightPanelWidthRatio = "pipiui.rightPanelWidthRatio"
    }

    static let minimumWindowContentSize = NSSize(width: 800, height: 560)
    static let sidebarRatioRange: ClosedRange<CGFloat> = 0.03...0.75
    static let rightPanelRatioRange: ClosedRange<CGFloat> = 0.03...0.75
    static let defaultRightPanelWidthRatio: CGFloat = 0.46

    static func storedWindowContentSize(defaults: UserDefaults = .standard) -> NSSize? {
        let pendingWidth = pendingValue(forKey: Key.windowWidth, defaults: defaults)
        let pendingHeight = pendingValue(forKey: Key.windowHeight, defaults: defaults)
        guard pendingWidth != nil || defaults.object(forKey: Key.windowWidth) != nil,
              pendingHeight != nil || defaults.object(forKey: Key.windowHeight) != nil else {
            return nil
        }
        let width = pendingWidth ?? defaults.double(forKey: Key.windowWidth)
        let height = pendingHeight ?? defaults.double(forKey: Key.windowHeight)
        guard width.isFinite, height.isFinite, width > 0, height > 0 else { return nil }
        return NSSize(width: width, height: height)
    }

    static func saveWindowContentSize(_ size: NSSize, defaults: UserDefaults = .standard) {
        guard size.width.isFinite, size.height.isFinite,
              size.width >= minimumWindowContentSize.width,
              size.height >= minimumWindowContentSize.height else {
            return
        }
        // T23: live resize fires one notification per frame — cache in memory and
        // let the debounced flush persist once the storm settles.
        cachePending(Double(size.width), forKey: Key.windowWidth, defaults: defaults)
        cachePending(Double(size.height), forKey: Key.windowHeight, defaults: defaults)
    }

    static func sidebarWidthRatio(defaults: UserDefaults = .standard) -> CGFloat? {
        storedRatio(forKey: Key.sidebarWidthRatio, in: sidebarRatioRange, defaults: defaults)
    }

    static func rightPanelWidthRatio(defaults: UserDefaults = .standard) -> CGFloat? {
        storedRatio(forKey: Key.rightPanelWidthRatio, in: rightPanelRatioRange, defaults: defaults)
    }

    @discardableResult
    static func saveSidebarWidthRatio(_ ratio: CGFloat, defaults: UserDefaults = .standard) -> CGFloat? {
        saveRatio(ratio, forKey: Key.sidebarWidthRatio, in: sidebarRatioRange, defaults: defaults)
    }

    @discardableResult
    static func saveRightPanelWidthRatio(_ ratio: CGFloat, defaults: UserDefaults = .standard) -> CGFloat? {
        saveRatio(ratio, forKey: Key.rightPanelWidthRatio, in: rightPanelRatioRange, defaults: defaults)
    }

    /// Per-provider selected quota window (so a Grok user's pick doesn't affect GLM).
    private static func quotaWindowKey(provider: QuotaProvider) -> String {
        "pipiui.quotaWindow.\(provider.rawValue)"
    }
    static func quotaSelectedWindow(provider: QuotaProvider, defaults: UserDefaults = .standard) -> String? {
        defaults.string(forKey: quotaWindowKey(provider: provider))
    }
    static func setQuotaSelectedWindow(_ id: String, provider: QuotaProvider, defaults: UserDefaults = .standard) {
        defaults.set(id, forKey: quotaWindowKey(provider: provider))
    }

    static func clampedRestoredWindowContentSize(_ savedSize: NSSize, for window: NSWindow) -> NSSize {
        let screen = window.screen ?? NSScreen.main
        let maximumSize = screen.map { window.contentRect(forFrameRect: $0.visibleFrame).size }
        let maximumWidth = max(minimumWindowContentSize.width, maximumSize?.width ?? savedSize.width)
        let maximumHeight = max(minimumWindowContentSize.height, maximumSize?.height ?? savedSize.height)

        return NSSize(
            width: min(max(savedSize.width, minimumWindowContentSize.width), maximumWidth),
            height: min(max(savedSize.height, minimumWindowContentSize.height), maximumHeight)
        )
    }

    private static func storedRatio(
        forKey key: String,
        in range: ClosedRange<CGFloat>,
        defaults: UserDefaults
    ) -> CGFloat? {
        // Read-through: a debounced write that has not hit disk yet still wins,
        // so back-to-back read/modify cycles observe the latest value.
        let pending = pendingValue(forKey: key, defaults: defaults)
        guard pending != nil || defaults.object(forKey: key) != nil else { return nil }
        let value = pending ?? defaults.double(forKey: key)
        guard value.isFinite else { return nil }
        let ratio = CGFloat(value)
        guard range.contains(ratio) else { return nil }
        return ratio
    }

    private static func saveRatio(
        _ ratio: CGFloat,
        forKey key: String,
        in range: ClosedRange<CGFloat>,
        defaults: UserDefaults
    ) -> CGFloat? {
        guard ratio.isFinite, range.contains(ratio) else { return nil }
        // T23: divider drags call this per mouseDragged event — persist via the
        // debounced flush instead of one UserDefaults write per event.
        cachePending(Double(ratio), forKey: key, defaults: defaults)
        return ratio
    }

    // MARK: - Debounced writes (T23)

    /// Writes are coalesced for this long before hitting UserDefaults.
    static let writeDebounceInterval: TimeInterval = 0.3

    private static let writeLock = NSLock()
    private static var pendingWrites: [String: (value: Double, defaults: UserDefaults)] = [:]
    private static var flushWorkItem: DispatchWorkItem?

    private static func cachePending(_ value: Double, forKey key: String, defaults: UserDefaults) {
        writeLock.lock()
        pendingWrites[key] = (value, defaults)
        if flushWorkItem == nil {
            let work = DispatchWorkItem { flushPendingWrites() }
            flushWorkItem = work
            DispatchQueue.main.asyncAfter(deadline: .now() + writeDebounceInterval, execute: work)
        }
        writeLock.unlock()
    }

    private static func pendingValue(forKey key: String, defaults: UserDefaults) -> Double? {
        writeLock.lock()
        defer { writeLock.unlock() }
        guard let entry = pendingWrites[key], entry.defaults === defaults else { return nil }
        return entry.value
    }

    /// Persist every coalesced write now. Called automatically ~300ms after the
    /// first write of a burst; also exposed for tests and app-termination hooks.
    static func flushPendingWrites() {
        writeLock.lock()
        let writes = pendingWrites
        pendingWrites.removeAll()
        flushWorkItem?.cancel()
        flushWorkItem = nil
        writeLock.unlock()
        for (key, entry) in writes {
            entry.defaults.set(entry.value, forKey: key)
        }
    }
}

/// Attaches to the scene's NSWindow without changing its placement. Restoration
/// happens before resize observation begins so attach/layout notifications do not
/// immediately overwrite the saved value.
struct WindowSizePersistenceView: NSViewRepresentable {
    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> WindowAttachmentView {
        let view = WindowAttachmentView()
        view.onWindowChange = { [weak coordinator = context.coordinator] window in
            coordinator?.attach(to: window)
        }
        return view
    }

    func updateNSView(_ nsView: WindowAttachmentView, context: Context) {
        context.coordinator.attach(to: nsView.window)
    }

    static func dismantleNSView(_ nsView: WindowAttachmentView, coordinator: Coordinator) {
        nsView.onWindowChange = nil
        coordinator.detach()
    }

    final class Coordinator: NSObject {
        private weak var window: NSWindow?
        private var attachmentGeneration = 0
        private var isObserving = false

        func attach(to newWindow: NSWindow?) {
            guard window !== newWindow else { return }
            detach()
            guard let newWindow else { return }

            window = newWindow
            attachmentGeneration += 1
            let generation = attachmentGeneration

            DispatchQueue.main.async { [weak self, weak newWindow] in
                guard let self, let newWindow,
                      self.window === newWindow,
                      self.attachmentGeneration == generation else {
                    return
                }
                self.restoreIfAvailable(window: newWindow)

                // setContentSize can schedule another layout pass. Observe only
                // after that pass so restoration cannot write a transient size.
                DispatchQueue.main.async { [weak self, weak newWindow] in
                    guard let self, let newWindow,
                          self.window === newWindow,
                          self.attachmentGeneration == generation else {
                        return
                    }
                    self.startObserving(window: newWindow)
                }
            }
        }

        func detach() {
            if isObserving {
                NotificationCenter.default.removeObserver(
                    self,
                    name: NSWindow.didResizeNotification,
                    object: window
                )
            }
            isObserving = false
            window = nil
            attachmentGeneration += 1
        }

        private func restoreIfAvailable(window: NSWindow) {
            guard let savedSize = LayoutPersistence.storedWindowContentSize() else { return }
            let restoredSize = LayoutPersistence.clampedRestoredWindowContentSize(savedSize, for: window)
            window.setContentSize(restoredSize)
        }

        private func startObserving(window: NSWindow) {
            guard !isObserving else { return }
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(windowDidResize(_:)),
                name: NSWindow.didResizeNotification,
                object: window
            )
            isObserving = true
        }

        @objc private func windowDidResize(_ notification: Notification) {
            guard let window = notification.object as? NSWindow,
                  self.window === window else {
                return
            }
            let contentSize = window.contentRect(forFrameRect: window.frame).size
            LayoutPersistence.saveWindowContentSize(contentSize)
        }

        deinit {
            NotificationCenter.default.removeObserver(self)
        }
    }
}

final class WindowAttachmentView: NSView {
    var onWindowChange: ((NSWindow?) -> Void)?

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        onWindowChange?(window)
    }
}
