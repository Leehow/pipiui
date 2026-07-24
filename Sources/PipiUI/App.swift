import SwiftUI
import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        Log.bootstrap() // idempotent; covers library/test hosts that skip AppEntry
        CrashReporting.install() // idempotent; same reason
        Log.info(
            "applicationDidFinishLaunching (restored windows: \(NSApp.windows.count))",
            category: .app
        )
        SelfTest.runIfRequested()
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        UIEventLog.shared.install()
        ScrollDiagnostics.shared.install()
        LaunchDiagnostics.scheduleSnapshots()
    }

    func applicationWillTerminate(_ notification: Notification) {
        Log.info("applicationWillTerminate", category: .app)
        PipiLogger.shared.flushSync()
        AppStore.shared.shutdown()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}

public struct PipiUIApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var store = AppStore.shared

    public init() {}

    public var body: some Scene {
        WindowGroup("Pipi UI") {
            ContentView()
                .environmentObject(store)
                .frame(minWidth: 800, minHeight: 560)
                .background(WindowSizePersistenceView())
        }
        .windowStyle(.automatic)
        .commands {
            LogCommands()
            CommandGroup(after: .toolbar) {
                Button("放大") { store.setUIScale(store.uiScale + 0.1) }
                    .keyboardShortcut("=", modifiers: .command)
                Button("缩小") { store.setUIScale(store.uiScale - 0.1) }
                    .keyboardShortcut("-", modifiers: .command)
                Button("实际大小") { store.setUIScale(1.0) }
                    .keyboardShortcut("0", modifiers: .command)
            }
        }
    }
}

struct ContentView: View {
    @EnvironmentObject var store: AppStore
    @State private var columnVisibility: NavigationSplitViewVisibility = .all
    @State private var sidebarCollapsedForWidth = false
    @State private var sidebarWidthRatio = LayoutPersistence.sidebarWidthRatio()

    /// Resize throttling. SwiftUI fires one `GeometryReader` update per live-resize
    /// frame (often >120Hz on a fast display); letting every frame re-frame the
    /// whole `NavigationSplitView` saturates the main thread — visibly so when a
    /// streaming session is also rewriting its rows every ~50ms. `settledLogicalSize`
    /// is the size downstream layout actually sees, updated at most ~60fps. Frames
    /// dropped inside the cooldown are stashed in `pendingLogicalSize` and flushed
    /// on `didEndLiveResizeNotification` so the window still lands on its exact
    /// final pixel size when the user lets go.
    @State private var settledLogicalSize: CGSize?
    @State private var pendingLogicalSize: CGSize?
    @State private var lastResizeEmitAt: Date?

    private let sidebarCollapseWidth: CGFloat = 720

    var body: some View {
        // 整体缩放：内容按 1/scale 布局再放大 scale 倍，UI 和文字一起缩放
        GeometryReader { geo in
            let metrics = RootLayoutMetrics.resolve(available: geo.size, uiScale: store.uiScale)

            scaledContent(metrics: metrics)
                .onAppear {
                    applyResize(metrics, force: true)
                }
                .onChange(of: metrics.logicalSize) { _, _ in
                    applyResize(metrics, force: false)
                }
                .onReceive(NotificationCenter.default.publisher(for: NSWindow.didEndLiveResizeNotification)) { _ in
                    // Live resize ended: flush whatever final size we dropped, so the
                    // window settles on the exact pixel the user stopped at rather than
                    // the last frame that slipped inside the ~60fps window.
                    if let pending = pendingLogicalSize, pending != settledLogicalSize {
                        settledLogicalSize = pending
                    }
                    pendingLogicalSize = nil
                }
        }
    }

    /// Routes a fresh `RootLayoutMetrics` through the resize throttle: the first
    /// frame and any frame past the cooldown updates `settledLogicalSize`; frames
    /// inside the cooldown are stashed as `pendingLogicalSize` for the
    /// `didEndLiveResize` flush. `force: true` bypasses the throttle (onAppear /
    /// non-resize-driven changes).
    private func applyResize(_ metrics: RootLayoutMetrics, force: Bool) {
        noteRootLayout(metrics)
        updateSidebarVisibility(for: metrics.logicalSize.width)
        let now = Date()
        let emit = force || ResizeThrottle.shouldEmit(now: now, lastEmittedAt: lastResizeEmitAt)
        if emit {
            settledLogicalSize = metrics.logicalSize
            pendingLogicalSize = nil
            lastResizeEmitAt = now
        } else {
            pendingLogicalSize = metrics.logicalSize
        }
    }

    @ViewBuilder
    private func scaledContent(metrics: RootLayoutMetrics) -> some View {
        // Prefer the throttled size; fall back to the raw metrics for the very
        // first render (before onAppear has run) and for any zero/NaN proposal
        // that must use the unscaled fallback path below.
        let size = settledLogicalSize ?? metrics.logicalSize
        if metrics.isUsable {
            splitView(logicalWidth: size.width)
                .frame(width: size.width, height: size.height)
                .scaleEffect(metrics.scale, anchor: .topLeading)
        } else {
            // Zero / NaN proposal (window restoration, a resize animation passing
            // through zero). Pinning to that size renders an empty window, so lay
            // out unscaled and let the next pass — which has a real size — take over.
            splitView(logicalWidth: sidebarCollapseWidth)
        }
    }

    private func noteRootLayout(_ metrics: RootLayoutMetrics) {
        LaunchDiagnostics.rootLayoutCount += 1
        LaunchDiagnostics.lastRootGeometry = metrics.logicalSize
        if metrics.isUsable {
            Log.debug("root layout \(metrics.logDescription)", category: .ui)
        } else {
            Log.warn(
                "root layout unusable \(metrics.logDescription) — rendering unscaled fallback",
                category: .ui
            )
        }
        // TEMP RESIZE DIAG: dump every sizable scroll view on each layout pass
        // (throttled) to find what is actually relayouting during window resize.
        // Remove after resize perf is diagnosed.
        Self.dumpResizeScrollViews()
    }

    // TEMP RESIZE DIAG — delete after root cause is found.
    private static var lastResizeDiagAt: Date = .distantPast
    private static func dumpResizeScrollViews() {
        let now = Date()
        guard now.timeIntervalSince(lastResizeDiagAt) > 0.3 else { return }
        lastResizeDiagAt = now
        guard let window = NSApp?.keyWindow,
              let root = window.contentView else { return }
        var idx = 0
        var queue: [(NSView, Int)] = [(root, 0)]
        while !queue.isEmpty, idx < 40 {
            let (view, depth) = queue.removeFirst()
            if let sv = view as? NSScrollView, sv.bounds.width >= 100 {
                let doc = sv.documentView
                let docH = doc?.frame.height ?? 0
                let docKind = doc.map { String(describing: type(of: $0)) } ?? "nil"
                let docSubviews = doc?.subviews.count ?? 0
                // Ancestors help tell transcript vs subagent-log vs web apart.
                let parentChain = Self.parentChain(of: sv, maxLength: 3)
                Log.info(
                    "RESIZE-DIAG sv[\(idx)] d\(depth) frame=\(String(format: "%.0fx%.0f@%.0f,%.0f", sv.frame.width, sv.frame.height, sv.frame.minX, sv.frame.minY)) docH=\(String(format: "%.0f", docH)) docKind=\(docKind) docSubViews=\(docSubviews) clip=\(String(format: "%.0fx%.0f", sv.contentView.bounds.width, sv.contentView.bounds.height)) parents=\(parentChain)",
                    category: .ui
                )
                idx += 1
            }
            queue.append(contentsOf: view.subviews.map { ($0, depth + 1) })
        }
        if idx == 0 {
            Log.info("RESIZE-DIAG no sizable scroll view found", category: .ui)
        }
    }

    private static func parentChain(of view: NSView, maxLength: Int) -> String {
        var parts: [String] = []
        var current: NSView? = view.superview
        while let v = current, parts.count < maxLength {
            parts.append(String(describing: type(of: v)))
            current = v.superview
        }
        return parts.joined(separator: "→")
    }

    private func splitView(logicalWidth: CGFloat) -> some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            SidebarView()
                .background {
                    SidebarDividerDragObserver(layoutIdentity: logicalWidth) { sidebarWidth in
                        recordSidebarWidth(sidebarWidth, totalLogicalWidth: logicalWidth)
                    }
                }
                .navigationSplitViewColumnWidth(
                    min: 200,
                    ideal: sidebarIdealWidth(for: logicalWidth),
                    max: 340
                )
        } detail: {
            if let session = store.currentSession {
                // Force identity change on session switch. Per-session state that must survive
                // (transcriptVisibleCount / pinTranscriptToBottom) lives on ChatSession, so the
                // rebuilt detail view reads it back immediately; only transient scroll/drag @State
                // resets, which is what we want on switch.
                //
                // Do NOT remove this .id: without it SwiftUI reuses ChatDetailView across sessions
                // and diffs the old+new transcript arrays in one pass. MessageRow.== compares inline
                // ImageBlock.data byte-for-byte, so a switch into an image-heavy session freezes the
                // main thread for seconds (the "切会话卡死" regression).
                ChatDetailView(session: session)
                    .id(session.id)
            } else {
                EmptyStateView()
            }
        }
        .navigationSplitViewStyle(.prominentDetail)
    }

    private func updateSidebarVisibility(for logicalWidth: CGFloat) {
        // A degenerate width would collapse the sidebar on a proposal that means
        // "not laid out yet", not "narrow window".
        guard RootLayoutMetrics.isUsable(CGSize(width: logicalWidth, height: 1)) else { return }

        let shouldCollapse = logicalWidth < sidebarCollapseWidth
        guard shouldCollapse != sidebarCollapsedForWidth else { return }

        sidebarCollapsedForWidth = shouldCollapse
        columnVisibility = shouldCollapse ? .detailOnly : .all
        Log.info(
            String(
                format: "sidebar visibility → %@ (logicalWidth=%.0f)",
                shouldCollapse ? "detailOnly" : "all", logicalWidth
            ),
            category: .ui
        )
    }

    private func sidebarIdealWidth(for logicalWidth: CGFloat) -> CGFloat {
        guard let sidebarWidthRatio else { return 250 }
        return min(max(sidebarWidthRatio * logicalWidth, 200), 340)
    }

    private func recordSidebarWidth(_ sidebarWidth: CGFloat, totalLogicalWidth: CGFloat) {
        guard !sidebarCollapsedForWidth,
              columnVisibility == .all,
              totalLogicalWidth >= sidebarCollapseWidth,
              totalLogicalWidth.isFinite,
              sidebarWidth.isFinite,
              sidebarWidth >= 190,
              sidebarWidth <= 350 else {
            return
        }

        let ratio = sidebarWidth / totalLogicalWidth
        guard let validRatio = LayoutPersistence.saveSidebarWidthRatio(ratio) else { return }
        if sidebarWidthRatio == nil || abs((sidebarWidthRatio ?? 0) - validRatio) > 0.001 {
            sidebarWidthRatio = validRatio
        }
    }
}

/// Reports sidebar width only after an actual pointer drag starts on its divider.
/// Layout changes caused by UI scale, window resize, or automatic collapse never
/// enter this path and therefore cannot overwrite the user's saved ratio.
private struct SidebarDividerDragObserver: NSViewRepresentable {
    let layoutIdentity: CGFloat
    let onDrag: (CGFloat) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(layoutIdentity: layoutIdentity, onDrag: onDrag)
    }

    func makeNSView(context: Context) -> SidebarDividerTrackingView {
        let view = SidebarDividerTrackingView()
        view.onHierarchyChange = { [weak coordinator = context.coordinator] view in
            coordinator?.resolveSplitView(from: view)
        }
        context.coordinator.attach(to: view)
        return view
    }

    func updateNSView(_ nsView: SidebarDividerTrackingView, context: Context) {
        context.coordinator.update(layoutIdentity: layoutIdentity, onDrag: onDrag)
        context.coordinator.attach(to: nsView)
        context.coordinator.resolveSplitView(from: nsView)
    }

    static func dismantleNSView(_ nsView: SidebarDividerTrackingView, coordinator: Coordinator) {
        nsView.onHierarchyChange = nil
        coordinator.detach()
    }

    final class Coordinator: NSObject {
        var onDrag: (CGFloat) -> Void
        private weak var view: SidebarDividerTrackingView?
        private weak var splitView: NSSplitView?
        private weak var sidebarPane: NSView?
        private var eventMonitor: Any?
        private var isDraggingDivider = false
        private var resolveGeneration = 0
        private var dragLeaseGeneration = 0
        private let dragLeaseDuration: TimeInterval = 0.2
        private var layoutIdentity: CGFloat

        init(layoutIdentity: CGFloat, onDrag: @escaping (CGFloat) -> Void) {
            self.layoutIdentity = layoutIdentity
            self.onDrag = onDrag
        }

        func update(layoutIdentity: CGFloat, onDrag: @escaping (CGFloat) -> Void) {
            self.onDrag = onDrag
            if abs(self.layoutIdentity - layoutIdentity) > 0.5 {
                clearDragIntent()
            }
            self.layoutIdentity = layoutIdentity
        }

        func attach(to view: SidebarDividerTrackingView) {
            guard self.view !== view else { return }
            detach()
            self.view = view
            eventMonitor = NSEvent.addLocalMonitorForEvents(
                matching: [.leftMouseDown, .leftMouseDragged, .leftMouseUp]
            ) { [weak self] event in
                self?.handle(event)
                return event
            }
            resolveSplitView(from: view)
        }

        func resolveSplitView(from view: SidebarDividerTrackingView) {
            resolveGeneration += 1
            let generation = resolveGeneration
            DispatchQueue.main.async { [weak self, weak view] in
                guard let self, let view,
                      self.view === view,
                      self.resolveGeneration == generation else {
                    return
                }
                self.attachToNearestSplitView(from: view)
            }
        }

        func detach() {
            if let eventMonitor {
                NSEvent.removeMonitor(eventMonitor)
            }
            eventMonitor = nil
            detachFromSplitView()
            clearDragIntent()
            view = nil
            resolveGeneration += 1
        }

        private func handle(_ event: NSEvent) {
            guard let splitView, let sidebarPane,
                  event.window === splitView.window else {
                clearDragIntent()
                return
            }

            switch event.type {
            case .leftMouseDown:
                if isNearSidebarDivider(
                    event,
                    splitView: splitView,
                    sidebarPane: sidebarPane
                ) {
                    refreshDragIntentLease()
                } else {
                    clearDragIntent()
                }
            case .leftMouseDragged:
                if isDraggingDivider {
                    refreshDragIntentLease()
                    reportWidthAfterLayout()
                }
            case .leftMouseUp:
                if isDraggingDivider {
                    reportWidthAfterLayout()
                }
                clearDragIntent()
            default:
                break
            }
        }

        private func attachToNearestSplitView(from view: NSView) {
            var paneCandidate = view
            var ancestor = view.superview

            while let current = ancestor {
                if let candidate = current as? NSSplitView,
                   candidate.isVertical,
                   candidate.subviews.contains(where: { $0 === paneCandidate }) {
                    attach(splitView: candidate, sidebarPane: paneCandidate)
                    return
                }
                paneCandidate = current
                ancestor = current.superview
            }
        }

        private func attach(splitView: NSSplitView, sidebarPane: NSView) {
            guard self.splitView !== splitView || self.sidebarPane !== sidebarPane else { return }
            detachFromSplitView()
            self.splitView = splitView
            self.sidebarPane = sidebarPane
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(splitViewDidResize(_:)),
                name: NSSplitView.didResizeSubviewsNotification,
                object: splitView
            )
        }

        private func detachFromSplitView() {
            if let splitView {
                NotificationCenter.default.removeObserver(
                    self,
                    name: NSSplitView.didResizeSubviewsNotification,
                    object: splitView
                )
            }
            splitView = nil
            sidebarPane = nil
        }

        @objc private func splitViewDidResize(_ notification: Notification) {
            guard isDraggingDivider,
                  let resizedSplitView = notification.object as? NSSplitView,
                  resizedSplitView === splitView else {
                return
            }
            reportWidthAfterLayout()
        }

        private func refreshDragIntentLease() {
            isDraggingDivider = true
            dragLeaseGeneration += 1
            let generation = dragLeaseGeneration
            DispatchQueue.main.asyncAfter(deadline: .now() + dragLeaseDuration) { [weak self] in
                guard let self, self.dragLeaseGeneration == generation else { return }
                self.isDraggingDivider = false
            }
        }

        private func clearDragIntent() {
            isDraggingDivider = false
            dragLeaseGeneration += 1
        }

        private func isNearSidebarDivider(
            _ event: NSEvent,
            splitView: NSSplitView,
            sidebarPane: NSView
        ) -> Bool {
            let point = splitView.convert(event.locationInWindow, from: nil)
            let verticalTolerance: CGFloat = 8
            let dividerTolerance = max(splitView.dividerThickness + 6, 10)
            return point.y >= splitView.bounds.minY - verticalTolerance
                && point.y <= splitView.bounds.maxY + verticalTolerance
                && abs(point.x - sidebarPane.frame.maxX) <= dividerTolerance
        }

        private func reportWidthAfterLayout() {
            DispatchQueue.main.async { [weak self] in
                guard let self, let splitView = self.splitView,
                      let sidebarPane = self.sidebarPane,
                      splitView.subviews.contains(where: { $0 === sidebarPane }) else {
                    return
                }
                let width = sidebarPane.frame.width
                guard width.isFinite, width > 0 else { return }
                self.onDrag(width)
            }
        }

        deinit {
            if let eventMonitor {
                NSEvent.removeMonitor(eventMonitor)
            }
            NotificationCenter.default.removeObserver(self)
        }
    }
}

private final class SidebarDividerTrackingView: NSView {
    var onHierarchyChange: ((SidebarDividerTrackingView) -> Void)?

    override func viewDidMoveToSuperview() {
        super.viewDidMoveToSuperview()
        onHierarchyChange?(self)
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        onHierarchyChange?(self)
    }

    override func hitTest(_ point: NSPoint) -> NSView? {
        nil
    }
}

struct EmptyStateView: View {
    @EnvironmentObject var store: AppStore

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "terminal")
                .font(.system(size: 44, weight: .light))
                .foregroundStyle(.tertiary)
            BrandMark(size: .hero)
            Text("选择左侧项目并新建会话，或点击下方按钮添加项目文件夹")
                .font(.callout)
                .foregroundStyle(.secondary)
            Button {
                store.addProjectViaPanel()
            } label: {
                Label("添加项目文件夹", systemImage: "folder.badge.plus")
            }
            .controlSize(.large)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .textBackgroundColor))
    }
}
