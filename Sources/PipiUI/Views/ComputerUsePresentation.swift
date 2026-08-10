import AppKit
import SwiftUI

/// Transient Computer Use presentation. It only draws a non-activating border
/// around the current target; it never alters the SwiftUI host window's chrome
/// or geometry.
@MainActor
final class ComputerUseWindowPresentation: NSObject {
    static let shared = ComputerUseWindowPresentation()

    private weak var mainWindow: NSWindow?
    /// Readable for tests that assert the border does not resurface after stop.
    private(set) var highlightPanel: NSPanel?
    private var timer: Timer?
    private var highlightedTarget: (processID: Int32, windowID: UInt32?)?
    /// Bumped in `stopHighlight` so any already-enqueued tick cannot
    /// `orderFrontRegardless` the panel after highlighting has ended.
    private var highlightGeneration: UInt64 = 0

    func attach(to window: NSWindow?) {
        guard mainWindow !== window else { return }
        if window == nil { stopHighlight() }
        mainWindow = window
    }

    func update(for coordinator: ComputerCoordinator) {
        if coordinator.isPresentingDesktopOperation {
            updateHighlight(processID: coordinator.activeApplication?.processID,
                            windowID: coordinator.activeWindowID)
        } else {
            stopHighlight()
        }
    }

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
