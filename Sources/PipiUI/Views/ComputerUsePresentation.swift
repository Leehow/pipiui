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
    private var normalContentView: NSView?
    private var highlightPanel: NSPanel?
    private var timer: Timer?
    private var highlightedTarget: (processID: Int32, windowID: UInt32?)?

    func attach(to window: NSWindow?) {
        // Replacing the main content view intentionally dismantles the
        // attachment representable. Keep the saved full UI alive until the
        // operation ends instead of interpreting that detach as window loss.
        if window == nil, normalContentView != nil {
            return
        }
        guard mainWindow !== window else { return }
        restoreMainWindow()
        if window == nil { stopHighlight() }
        mainWindow = window
    }

    func update(for coordinator: ComputerCoordinator) {
        if coordinator.isPresentingDesktopOperation {
            presentMiniWindow()
            updateHighlight(processID: coordinator.activeApplication?.processID,
                            windowID: coordinator.activeWindowID)
        } else {
            stopHighlight()
            restoreMainWindow()
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
            normalContentView = window.contentView
            window.contentView = NSHostingView(rootView: ComputerUseMiniProgressView())
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
        guard let window = mainWindow else { return }
        if let normalStyleMask { window.styleMask = normalStyleMask }
        if let normalTitleVisibility { window.titleVisibility = normalTitleVisibility }
        if let normalTitlebarAppearsTransparent {
            window.titlebarAppearsTransparent = normalTitlebarAppearsTransparent
        }
        if let normalToolbarIsVisible { window.toolbar?.isVisible = normalToolbarIsVisible }
        if let normalContentView { window.contentView = normalContentView }
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
        // The SwiftUI root content view was detached while the window sat in mini
        // full-size-content mode (titlebar hidden, toolbar off, tiny frame). Its
        // safe-area insets were staled to that geometry; AppKit does not always
        // re-derive them on reattach, so the transcript paints under the title/
        // toolbar. Force a full layout + redraw pass so the restored content is
        // re-inset below the titlebar instead of overlapping it.
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
        normalContentView = nil
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
        positionHighlight(processID: processID, windowID: windowID)
        if timer == nil {
            timer = Timer.scheduledTimer(withTimeInterval: 1 / 30, repeats: true) {
                [weak self] _ in
                Task { @MainActor in
                    self?.positionHighlight(processID: processID, windowID: windowID)
                }
            }
        }
    }

    private func positionHighlight(processID: Int32, windowID: UInt32?) {
        guard let bounds = Self.targetBounds(processID: processID, windowID: windowID) else {
            highlightPanel?.orderOut(nil)
            return
        }
        highlightPanel?.setFrame(bounds.insetBy(dx: -3, dy: -3), display: true)
        highlightPanel?.orderFrontRegardless()
    }

    private func stopHighlight() {
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
