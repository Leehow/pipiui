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
        #if DEBUG
        // Global clip-view observers — keep off release scroll path.
        ScrollDiagnostics.shared.install()
        #endif
        LaunchDiagnostics.scheduleSnapshots()
        AppStore.shared.startAutomations()
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
            ComputerUseSceneRoot(store: store, notifier: TaskNotifier.shared)
        }
        .windowStyle(.automatic)
        // Compact unified titlebar: shortens the empty band above the right panel
        // without changing drag regions or Computer Use mini-mode titlebar swaps.
        .windowToolbarStyle(.unifiedCompact)
        .commands {
            LogCommands()
            CommandGroup(after: .toolbar) {
                Button("自动任务…") { store.presentAutomations() }
                    .keyboardShortcut("a", modifiers: [.command, .shift])
                Divider()
                Button("放大") { store.setUIScale(store.uiScale + 0.1) }
                    .keyboardShortcut("=", modifiers: .command)
                Button("缩小") { store.setUIScale(store.uiScale - 0.1) }
                    .keyboardShortcut("-", modifiers: .command)
                Button("实际大小") { store.setUIScale(1.0) }
                    .keyboardShortcut("0", modifiers: .command)
                Divider()
                Button("聊天字号放大") { store.setChatFontSize(store.chatFontSize + 1) }
                    .keyboardShortcut("=", modifiers: [.command, .shift])
                Button("聊天字号缩小") { store.setChatFontSize(store.chatFontSize - 1) }
                    .keyboardShortcut("-", modifiers: [.command, .shift])
                Button("聊天字号默认") { store.setChatFontSize(Double(ChatTypography.defaultFontSize)) }
                    .keyboardShortcut("0", modifiers: [.command, .shift])
                Divider()
                // Debug / experimental: NSTableView transcript POC (phase-1).
                Button(TableTranscriptFeature.isEnabled
                       ? "使用经典 Transcript"
                       : "实验性表格 Transcript") {
                    TableTranscriptFeature.setEnabled(!TableTranscriptFeature.isEnabled)
                }
            }
        }
    }
}

private struct ComputerUseSceneRoot: View {
    @ObservedObject var store: AppStore
    @ObservedObject var notifier: TaskNotifier

    var body: some View {
        ContentView()
            .environmentObject(store)
            .environment(
                \.chatTypography,
                ChatTypography.make(fontSize: CGFloat(store.chatFontSize))
            )
            .frame(minWidth: 800, minHeight: 560)
            .background(WindowSizePersistenceView())
            .background(ComputerUseWindowPresentationView())
            // 任务提醒横幅：叠在缩放内容之上，按未缩放的窗口坐标绘制（顶部居中）。
            .overlay(alignment: .top) {
                if let toast = notifier.toast {
                    toastBanner(toast)
                }
            }
            .animation(.easeOut(duration: 0.25), value: notifier.toast)
            .sheet(isPresented: $store.isAutomationsPresented) {
                AutomationsView(
                    scheduler: store.automations
                )
                .environmentObject(store)
            }
    }

    /// 小横幅：毛玻璃圆角、图标 + 文本、点击立即关闭。
    private func toastBanner(_ toast: Toast) -> some View {
        HStack(spacing: 8) {
            Image(systemName: toast.kind == .completion
                  ? "checkmark.circle.fill"
                  : "exclamationmark.triangle.fill")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(toast.kind == .completion ? Color.green : Color.orange)
            Text(toast.message)
                .font(.callout)
                .lineLimit(2)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(.ultraThinMaterial)
                .shadow(color: .black.opacity(0.15), radius: 8, y: 2)
        )
        .padding(.top, 12)
        .transition(.move(edge: .top).combined(with: .opacity))
        .onTapGesture { notifier.dismissToast() }
    }
}

struct ContentView: View {
    @EnvironmentObject var store: AppStore
    @State private var columnVisibility: NavigationSplitViewVisibility = .all
    @State private var sidebarCollapsedForWidth = false
    @State private var sidebarWidthRatio = LayoutPersistence.sidebarWidthRatio()
    /// Absolute sidebar width fed to NavigationSplitView. Kept stable across session
    /// switches — recomputing `ratio * logicalWidth` every body pass made the column pulse
    /// when GeometryReader briefly jittered during detail rebuild.
    @State private var sidebarColumnWidth: CGFloat = 250

    /// Layout size the split view actually uses. During AppKit live window resize
    /// this is frozen (new proposals go to `pendingLogicalSize` only) so the
    /// transcript does not reflow every drag frame. Flushed on
    /// `didEndLiveResizeNotification`. When not live-resizing, still throttled
    /// to ~60fps via `ResizeThrottle`.
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
                    // Live resize ended: one layout pass at the final size (layout was
                    // frozen for the whole drag — see `shouldUpdateSettledLayout`).
                    if let pending = pendingLogicalSize {
                        updateSidebarVisibility(for: pending.width)
                        if pending != settledLogicalSize {
                            settledLogicalSize = pending
                        }
                        lastResizeEmitAt = Date()
                    }
                    pendingLogicalSize = nil
                }
        }
    }

    /// Routes a fresh `RootLayoutMetrics` through the resize throttle. During
    /// AppKit live window resize we **freeze** `settledLogicalSize` (stash only)
    /// so the transcript does not reflow every drag frame — that was the lag and
    /// the sticky bar swimming. Flush happens on `didEndLiveResize`.
    private func applyResize(_ metrics: RootLayoutMetrics, force: Bool) {
        noteRootLayout(metrics)
        let inLiveResize = NSApp.keyWindow?.inLiveResize == true
        let now = Date()
        let emit = ResizeThrottle.shouldUpdateSettledLayout(
            force: force,
            inLiveResize: inLiveResize,
            now: now,
            lastEmittedAt: lastResizeEmitAt
        )
        if emit {
            updateSidebarVisibility(for: metrics.logicalSize.width)
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
        // TEMP RESIZE DIAG: skip during live resize — walking the NSView tree on
        // every proposal made drag jank worse while we were diagnosing it.
        if NSApp.keyWindow?.inLiveResize != true {
            Self.dumpResizeScrollViews()
        }
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
                    ideal: sidebarColumnWidth,
                    max: 340
                )
                .onAppear {
                    syncSidebarColumnWidth(totalLogicalWidth: logicalWidth)
                }
                .onChange(of: logicalWidth) { oldWidth, newWidth in
                    // Session-switch layout often jitters a few points; only rescale
                    // the sidebar when the window actually resized.
                    guard abs(oldWidth - newWidth) > 8 else { return }
                    syncSidebarColumnWidth(totalLogicalWidth: newWidth)
                }
        } detail: {
            if let session = store.currentSession {
                // Reuse the detail chrome across warm switches. The transcript owns the
                // session-scoped identity that resets its scroll origin; keeping that identity
                // narrow avoids rebuilding the toolbar, panels, composer, and their AppKit views.
                ChatDetailView(session: session)
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

    private func syncSidebarColumnWidth(totalLogicalWidth: CGFloat) {
        guard totalLogicalWidth.isFinite, totalLogicalWidth > 0 else { return }
        let next: CGFloat
        if let sidebarWidthRatio {
            next = min(max(sidebarWidthRatio * totalLogicalWidth, 200), 340)
        } else {
            next = 250
        }
        // Ignore sub-point jitter from session-switch layout passes.
        guard abs(sidebarColumnWidth - next) > 1.5 else { return }
        sidebarColumnWidth = next
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
        if abs(sidebarColumnWidth - sidebarWidth) > 0.5 {
            sidebarColumnWidth = min(max(sidebarWidth, 200), 340)
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
        /// Pointer went down near the divider — not yet a resize until dragged past threshold.
        private var dividerPressActive = false
        private var isDraggingDivider = false
        private var pressOriginX: CGFloat = 0
        private var resolveGeneration = 0
        private var layoutIdentity: CGFloat
        /// Ignore micro-movements from normal clicks in the widened hit slop.
        private static let dragStartThreshold: CGFloat = 3

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
                    // Do NOT mark as dragging yet — session clicks near the trailing
                    // edge used to arm a 0.2s drag lease; layout from switching chats
                    // then wrote a new width ratio and the column pulsed.
                    dividerPressActive = true
                    isDraggingDivider = false
                    pressOriginX = splitView.convert(event.locationInWindow, from: nil).x
                } else {
                    clearDragIntent()
                }
            case .leftMouseDragged:
                guard dividerPressActive else { break }
                let x = splitView.convert(event.locationInWindow, from: nil).x
                if !isDraggingDivider {
                    guard abs(x - pressOriginX) >= Self.dragStartThreshold else { break }
                    isDraggingDivider = true
                }
                // Drive resize ourselves so the widened hit slop still moves the pane
                // when the pointer is outside AppKit's thin native divider.
                applyDividerPosition(for: event, splitView: splitView)
                reportWidthAfterLayout()
            case .leftMouseUp:
                if isDraggingDivider {
                    reportWidthAfterLayout()
                }
                clearDragIntent()
            default:
                break
            }
        }

        private func applyDividerPosition(for event: NSEvent, splitView: NSSplitView) {
            guard splitView.subviews.count >= 2 else { return }
            let point = splitView.convert(event.locationInWindow, from: nil)
            let minW: CGFloat = 200
            let maxW: CGFloat = 340
            let position = min(max(point.x, minW), maxW)
            splitView.setPosition(position, ofDividerAt: 0)
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
            // Visible resize grip. Hit target is further widened in `isNearSidebarDivider`.
            splitView.dividerStyle = .paneSplitter
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

        private func clearDragIntent() {
            dividerPressActive = false
            isDraggingDivider = false
        }

        /// Half-width of the resize hit band around the sidebar trailing edge (pt).
        private static let dividerHitSlop: CGFloat = 16

        private func isNearSidebarDivider(
            _ event: NSEvent,
            splitView: NSSplitView,
            sidebarPane: NSView
        ) -> Bool {
            let point = splitView.convert(event.locationInWindow, from: nil)
            let verticalTolerance: CGFloat = 8
            let dividerTolerance = max(splitView.dividerThickness / 2 + Self.dividerHitSlop, Self.dividerHitSlop)
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
    @State private var showAddModel = false

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
            Button {
                showAddModel = true
            } label: {
                Label("添加 API key / 登录", systemImage: "key.fill")
            }
            .controlSize(.large)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .textBackgroundColor))
        .sheet(isPresented: $showAddModel) {
            // 复用 SettingsSheet 里的 AddModelSheet：API key 直写 ~/.pi/agent/.env，
            // 或走 OAuth 浏览器授权（等同 pi /login）。空白页保存后无需刷新凭据列表。
            AddModelSheet { /* saved; sheet dismisses itself */ }
                .environmentObject(store)
                .dismissOnOutsideClick { showAddModel = false }
        }
    }
}
