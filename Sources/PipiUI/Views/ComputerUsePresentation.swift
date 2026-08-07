import AppKit
import SwiftUI

/// Transient Computer Use chrome. It never becomes key and its target border
/// ignores mouse events, so desktop input continues to reach the target app.
@MainActor
final class ComputerUseWindowPresentation: NSObject {
    static let shared = ComputerUseWindowPresentation()
    static let miniContentSize = NSSize(width: 420, height: 44)

    private weak var mainWindow: NSWindow?
    private var normalFrame: NSRect?
    private var normalContentSize: NSSize?
    private var normalContentMinSize: NSSize?
    private var normalLevel: NSWindow.Level?
    private var normalCollectionBehavior: NSWindow.CollectionBehavior?
    private var normalStyleMask: NSWindow.StyleMask?
    private var normalTitleVisibility: NSWindow.TitleVisibility?
    private var normalTitlebarAppearsTransparent: Bool?
    private var normalToolbarIsVisible: Bool?
    private var normalButtonHidden: [NSWindow.ButtonType: Bool] = [:]
    /// Opaque mini-progress overlay kept on top of the attached main content.
    /// Never swap `window.contentView` — detaching the SwiftUI hosting view
    /// stales its unified-titlebar safe-area insets and the transcript paints
    /// under the title after restore.
    private(set) var miniOverlayView: NSView?
    /// Session that last entered mini mode. Same-session begin reuses chrome
    /// without another `orderFrontRegardless` (avoids grace-window micro-flash).
    private var miniPresentedSessionKey: String?
    /// Readable for tests that assert the border does not resurface after stop.
    private(set) var highlightPanel: NSPanel?
    private var timer: Timer?
    private var highlightedTarget: (processID: Int32, windowID: UInt32?)?
    /// Bumped in `stopHighlight` so any already-enqueued tick cannot
    /// `orderFrontRegardless` the panel after highlighting has ended.
    private var highlightGeneration: UInt64 = 0

    func attach(to window: NSWindow?) {
        guard mainWindow !== window else { return }
        restoreMainWindow()
        if window == nil { stopHighlight() }
        mainWindow = window
    }

    func update(for coordinator: ComputerCoordinator) {
        if coordinator.isPresentingDesktopOperation {
            let sessionKey = coordinator.activeSessionKey
            let alreadyMiniForSession = normalContentSize != nil
                && miniPresentedSessionKey != nil
                && miniPresentedSessionKey == sessionKey
            if !alreadyMiniForSession {
                presentMiniWindow()
                // Only record the session when chrome actually attached. An
                // unattached controller must not sticky-skip a later present.
                if normalContentSize != nil {
                    miniPresentedSessionKey = sessionKey
                }
            }
            updateHighlight(processID: coordinator.activeApplication?.processID,
                            windowID: coordinator.activeWindowID)
        } else {
            stopHighlight()
            restoreMainWindow()
            miniPresentedSessionKey = nil
        }
    }

    private func presentMiniWindow() {
        // Only the explicitly attached PipiUI main window may be reshaped
        // into the mini progress chrome. A host process (notably the XCTest
        // target) never attaches one, so a fallback to the first visible
        // NSApp window would grab and orderFrontRegardless() an unrelated
        // window — a stray test fixture or a leftover panel — and strand it
        // on screen. In production the attachment representable realizes
        // the main window during the first layout pass, well before any
        // desktop operation can start, so requiring the attachment never
        // silently drops the chrome.
        guard let window = mainWindow else { return }
        if normalContentSize == nil {
            normalFrame = window.frame
            normalContentSize = window.contentRect(forFrameRect: window.frame).size
            normalContentMinSize = window.contentMinSize
            normalLevel = window.level
            normalCollectionBehavior = window.collectionBehavior
            normalStyleMask = window.styleMask
            normalTitleVisibility = window.titleVisibility
            normalTitlebarAppearsTransparent = window.titlebarAppearsTransparent
            normalToolbarIsVisible = window.toolbar?.isVisible
            normalButtonHidden = Dictionary(
                uniqueKeysWithValues: Self.standardButtonTypes.compactMap { type in
                    window.standardWindowButton(type).map { (type, $0.isHidden) }
                }
            )
            // Keep the main SwiftUI content view attached for the whole CU
            // cycle. Present mini progress as an opaque overlay so safe-area
            // tracking stays continuous (no stale titlebar inset on restore).
            if miniOverlayView == nil, let contentView = window.contentView {
                let overlay = NSHostingView(rootView: ComputerUseMiniProgressView())
                overlay.wantsLayer = true
                overlay.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
                overlay.autoresizingMask = [.width, .height]
                overlay.frame = contentView.bounds
                contentView.addSubview(overlay)
                miniOverlayView = overlay
            }
        }
        // AppKit derives frame minSize from contentMinSize (including the
        // title-bar height). Mutating both creates an inconsistent pair that
        // cannot be restored exactly.
        window.contentMinSize = .zero
        window.level = .floating
        window.collectionBehavior.insert([.canJoinAllSpaces, .fullScreenAuxiliary])
        window.toolbar?.isVisible = false
        window.styleMask.insert(.fullSizeContentView)
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        Self.standardButtonTypes.forEach {
            window.standardWindowButton($0)?.isHidden = true
        }
        let topLeft = NSPoint(x: window.frame.minX, y: window.frame.maxY)
        window.setFrame(
            NSRect(
                x: topLeft.x,
                y: topLeft.y - Self.miniContentSize.height,
                width: Self.miniContentSize.width,
                height: Self.miniContentSize.height
            ),
            display: true
        )
        window.orderFrontRegardless()
    }

    private func restoreMainWindow() {
        miniPresentedSessionKey = nil
        guard let window = mainWindow else { return }
        if let normalStyleMask { window.styleMask = normalStyleMask }
        if let normalTitleVisibility { window.titleVisibility = normalTitleVisibility }
        if let normalTitlebarAppearsTransparent {
            window.titlebarAppearsTransparent = normalTitlebarAppearsTransparent
        }
        if let normalToolbarIsVisible { window.toolbar?.isVisible = normalToolbarIsVisible }
        // Tear down the mini overlay; the original content view stayed attached.
        miniOverlayView?.removeFromSuperview()
        miniOverlayView = nil
        if let normalFrame {
            window.setFrame(normalFrame, display: true)
        } else if let normalContentSize {
            window.setContentSize(normalContentSize)
        }
        if let normalContentMinSize { window.contentMinSize = normalContentMinSize }
        if let normalLevel { window.level = normalLevel }
        if let normalCollectionBehavior {
            window.collectionBehavior = normalCollectionBehavior
        }
        for (type, hidden) in normalButtonHidden {
            window.standardWindowButton(type)?.isHidden = hidden
        }
        // Belt-and-suspenders redraw. Continuity of the attached content view
        // is what keeps titlebar safe-area insets correct; this is not the fix.
        window.contentView?.needsLayout = true
        window.contentView?.layoutSubtreeIfNeeded()
        window.contentView?.needsDisplay = true
        normalFrame = nil
        normalContentSize = nil
        normalContentMinSize = nil
        normalLevel = nil
        normalCollectionBehavior = nil
        normalStyleMask = nil
        normalTitleVisibility = nil
        normalTitlebarAppearsTransparent = nil
        normalToolbarIsVisible = nil
        normalButtonHidden = [:]
    }

    private static let standardButtonTypes: [NSWindow.ButtonType] = [
        .closeButton, .miniaturizeButton, .zoomButton
    ]

    private func updateHighlight(processID: Int32?, windowID: UInt32?) {
        guard let processID else { stopHighlight(); return }
        if highlightedTarget?.processID != processID
            || highlightedTarget?.windowID != windowID {
            stopHighlight()
            highlightedTarget = (processID, windowID)
        }
        if highlightPanel == nil {
            highlightPanel = Self.makeHighlightPanel()
        }
        let generation = highlightGeneration
        positionHighlight(processID: processID, windowID: windowID, generation: generation)
        if timer == nil {
            // Already @MainActor; call directly so a tick cannot outlive
            // `stopHighlight` via an enqueued Task hop.
            timer = Timer.scheduledTimer(withTimeInterval: 1 / 30, repeats: true) {
                [weak self] _ in
                guard let self else { return }
                MainActor.assumeIsolated {
                    self.positionHighlight(
                        processID: processID,
                        windowID: windowID,
                        generation: generation
                    )
                }
            }
        }
    }

    private func positionHighlight(processID: Int32, windowID: UInt32?, generation: UInt64) {
        guard generation == highlightGeneration, highlightedTarget != nil else { return }
        guard let bounds = Self.targetBounds(processID: processID, windowID: windowID) else {
            highlightPanel?.orderOut(nil)
            return
        }
        highlightPanel?.setFrame(bounds.insetBy(dx: -3, dy: -3), display: true)
        highlightPanel?.orderFrontRegardless()
    }

    private func stopHighlight() {
        // Fence first so any tick already past the timer callback entry — or
        // still queued from a prior async hop — bails before orderFront.
        highlightGeneration &+= 1
        timer?.invalidate()
        timer = nil
        highlightedTarget = nil
        highlightPanel?.orderOut(nil)
    }

    static func makeHighlightPanel() -> NSPanel {
        let panel = ComputerUseHighlightPanel(
            contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered, defer: false
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.ignoresMouseEvents = true
        panel.hidesOnDeactivate = false
        panel.level = .screenSaver
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.contentView = ComputerUseHighlightView()
        return panel
    }

    private static func targetBounds(processID: Int32, windowID: UInt32?) -> NSRect? {
        let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []
        guard let mainScreen = NSScreen.screens.first else { return nil }
        let matching = windows.compactMap { info -> (NSRect, Int)? in
            guard (info[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == processID,
                  let rawBounds = info[kCGWindowBounds as String] as? NSDictionary,
                  let rect = CGRect(dictionaryRepresentation: rawBounds),
                  rect.width > 1, rect.height > 1 else { return nil }
            let id = (info[kCGWindowNumber as String] as? NSNumber)?.uint32Value
            if let windowID, id != windowID { return nil }
            let appKitRect = appKitBounds(
                forQuartzBounds: rect,
                mainScreenMaxY: mainScreen.frame.maxY
            )
            guard NSScreen.screens.contains(where: { $0.frame.intersects(appKitRect) }) else {
                return nil
            }
            return (appKitRect,
                    (info[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0)
        }
        return matching.sorted { $0.1 < $1.1 }.first?.0
    }

    static func appKitBounds(forQuartzBounds bounds: CGRect,
                             mainScreenMaxY: CGFloat) -> NSRect {
        NSRect(
            x: bounds.minX,
            y: mainScreenMaxY - bounds.maxY,
            width: bounds.width,
            height: bounds.height
        )
    }
}

struct ComputerUseWindowPresentationView: NSViewRepresentable {
    @ObservedObject private var coordinator = ComputerCoordinator.shared

    func makeCoordinator() -> ComputerUseWindowPresentation { .shared }

    func makeNSView(context: Context) -> WindowAttachmentView {
        let view = WindowAttachmentView()
        view.onWindowChange = { [weak controller = context.coordinator] window in
            controller?.attach(to: window)
        }
        return view
    }

    func updateNSView(_ view: WindowAttachmentView, context: Context) {
        context.coordinator.attach(to: view.window)
        context.coordinator.update(for: coordinator)
    }

    static func dismantleNSView(_ view: WindowAttachmentView,
                                coordinator: ComputerUseWindowPresentation) {
        view.onWindowChange = nil
        coordinator.attach(to: nil)
    }
}

private final class ComputerUseHighlightPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

private final class ComputerUseHighlightView: NSView {
    override func draw(_ dirtyRect: NSRect) {
        NSColor.systemCyan.setStroke()
        let path = NSBezierPath(roundedRect: bounds.insetBy(dx: 1.5, dy: 1.5),
                                xRadius: 6, yRadius: 6)
        path.lineWidth = 3
        path.stroke()
    }
}

struct ComputerUseMiniProgressView: View {
    @ObservedObject private var coordinator = ComputerCoordinator.shared

    var body: some View {
        HStack(spacing: 10) {
            Text(coordinator.statusMessage ?? "正在执行 Computer Use…")
                .lineLimit(1)
                .font(.caption.weight(.medium))
            Spacer(minLength: 0)
            Button("急停", role: .destructive) { coordinator.emergencyStop() }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
        }
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
