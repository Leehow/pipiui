import SwiftUI
import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        SelfTest.runIfRequested()
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationWillTerminate(_ notification: Notification) {
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

    private let sidebarCollapseWidth: CGFloat = 720

    var body: some View {
        // 整体缩放：内容按 1/scale 布局再放大 scale 倍，UI 和文字一起缩放
        GeometryReader { geo in
            let logicalWidth = geo.size.width / store.uiScale

            splitView(logicalWidth: logicalWidth)
                .frame(
                    width: logicalWidth,
                    height: geo.size.height / store.uiScale
                )
                .scaleEffect(store.uiScale, anchor: .topLeading)
                .onAppear {
                    updateSidebarVisibility(for: logicalWidth)
                }
                .onChange(of: logicalWidth) { _, width in
                    updateSidebarVisibility(for: width)
                }
        }
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
                ChatDetailView(session: session)
                    .id(session.id)
            } else {
                EmptyStateView()
            }
        }
        .navigationSplitViewStyle(.prominentDetail)
    }

    private func updateSidebarVisibility(for logicalWidth: CGFloat) {
        let shouldCollapse = logicalWidth < sidebarCollapseWidth
        guard shouldCollapse != sidebarCollapsedForWidth else { return }

        sidebarCollapsedForWidth = shouldCollapse
        columnVisibility = shouldCollapse ? .detailOnly : .all
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
