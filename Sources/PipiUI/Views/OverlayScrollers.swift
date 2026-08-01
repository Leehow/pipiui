import AppKit
import SwiftUI

/// System overlay scrollbars: thin when idle, thicken on hover/drag, shrink again
/// when the pointer leaves. Do not force `controlSize` — that breaks collapse.
enum OverlayScrollers {
    @discardableResult
    static func applyIfNeeded(to scrollView: NSScrollView) -> Bool {
        var changed = false
        if !scrollView.hasVerticalScroller {
            scrollView.hasVerticalScroller = true
            changed = true
        }
        if scrollView.scrollerStyle != .overlay {
            scrollView.scrollerStyle = .overlay
            changed = true
        }
        if !scrollView.autohidesScrollers {
            scrollView.autohidesScrollers = true
            changed = true
        }
        if scrollView.scrollerKnobStyle != .default {
            scrollView.scrollerKnobStyle = .default
            changed = true
        }
        // Undo any leftover `.mini` pin from older builds.
        if let vs = scrollView.verticalScroller, vs.controlSize == .mini {
            vs.controlSize = .regular
            changed = true
        }
        if let hs = scrollView.horizontalScroller, hs.controlSize == .mini {
            hs.controlSize = .regular
            changed = true
        }
        return changed
    }

    static func apply(to scrollView: NSScrollView) {
        _ = applyIfNeeded(to: scrollView)
    }

    static func collect(from root: NSView) -> [NSScrollView] {
        var found: [NSScrollView] = []
        var seen = Set<ObjectIdentifier>()
        func add(_ sv: NSScrollView) {
            let id = ObjectIdentifier(sv)
            guard !seen.contains(id) else { return }
            seen.insert(id)
            found.append(sv)
        }
        if let enclosing = root.enclosingScrollView {
            add(enclosing)
        }
        var stack: [NSView] = [root]
        while let view = stack.popLast() {
            if let sv = view as? NSScrollView { add(sv) }
            stack.append(contentsOf: view.subviews)
        }
        return found
    }
}

/// Idempotent installer. Prefer `.background` on **scroll content** so
/// `enclosingScrollView` resolves (List/ScrollView chrome is often a sibling).
private struct OverlayScrollerInstaller: NSViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> InstallerView {
        let view = InstallerView(frame: .zero)
        view.isHidden = true
        view.onAttach = { [weak coordinator = context.coordinator] host in
            coordinator?.ensureInstalled(from: host)
        }
        return view
    }

    func updateNSView(_ nsView: InstallerView, context: Context) {
        context.coordinator.ensureInstalled(from: nsView)
    }

    static func dismantleNSView(_ nsView: InstallerView, coordinator: Coordinator) {
        coordinator.cancel()
        nsView.onAttach = nil
    }

    final class InstallerView: NSView {
        var onAttach: ((NSView) -> Void)?

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            if window != nil { onAttach?(self) }
        }

        override func viewDidMoveToSuperview() {
            super.viewDidMoveToSuperview()
            if superview != nil { onAttach?(self) }
        }
    }

    final class Coordinator {
        private var attempts = 0
        private var workItem: DispatchWorkItem?
        private var styled = Set<ObjectIdentifier>()

        func ensureInstalled(from view: NSView) {
            let scrollViews = OverlayScrollers.collect(from: view)
            if scrollViews.isEmpty {
                scheduleRetry(from: view)
                return
            }
            attempts = 0
            for sv in scrollViews {
                let id = ObjectIdentifier(sv)
                if styled.contains(id),
                   sv.scrollerStyle == .overlay,
                   sv.autohidesScrollers {
                    continue
                }
                if OverlayScrollers.applyIfNeeded(to: sv) || sv.scrollerStyle == .overlay {
                    styled.insert(id)
                }
            }
            styled = styled.intersection(Set(scrollViews.map(ObjectIdentifier.init)))
        }

        private func scheduleRetry(from view: NSView) {
            guard attempts < 16 else { return }
            attempts += 1
            workItem?.cancel()
            let item = DispatchWorkItem { [weak self, weak view] in
                guard let self, let view else { return }
                self.ensureInstalled(from: view)
            }
            workItem = item
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05, execute: item)
        }

        func cancel() {
            workItem?.cancel()
            workItem = nil
            styled.removeAll()
        }

        deinit { cancel() }
    }
}

extension View {
    /// Thin overlay scrollbars (transcript, sidebar, right panels).
    func overlayScrollers() -> some View {
        background(OverlayScrollerInstaller())
    }
}
