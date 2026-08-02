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
    /// Post-attachment re-apply window length (50 ms ticks). Bounded: SwiftUI
    /// can reset scroller flags during the layout pass right after install with
    /// no following body pass to re-apply from. Same budget the old
    /// `SidebarVerticalScrollerHider` used (16 × 50 ms).
    fileprivate static let postSuccessTicks = 16

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
        /// Discovery retries while the scroll view is not yet in the hierarchy.
        private var attempts = 0
        /// Strictly bounded post-layout re-apply window (ticks), re-armed only by
        /// direct SwiftUI passes (attach hooks / updateNSView). Retry ticks
        /// consume it without re-arming, so the chain stops while the sidebar is
        /// idle — never a self-perpetuating timer.
        private var reapplyTicksRemaining = 0
        private var workItem: DispatchWorkItem?
        private var styled = Set<ObjectIdentifier>()
        /// Weakly retained targets so every pass re-applies without depending on
        /// re-discovery (mirrors `StickToBottomTracker.attachedScrollView`). Weak
        /// references — AppKit owns the scroll views, so there is no retain cycle.
        private var retained: [WeakScrollViewBox] = []

        func ensureInstalled(from view: NSView) {
            ensureInstalled(from: view, rearmPostWindow: true)
        }

        private func ensureInstalled(from view: NSView, rearmPostWindow: Bool) {
            var scrollViews = OverlayScrollers.collect(from: view)
            // Merge retained targets back in: during a content rebuild the
            // installer can sit between hierarchies where collect() alone would
            // miss the scroll view SwiftUI just restyled.
            for box in retained {
                guard let sv = box.scrollView, sv.window != nil else { continue }
                if !scrollViews.contains(where: { $0 === sv }) {
                    scrollViews.append(sv)
                }
            }
            guard !scrollViews.isEmpty else {
                scheduleRetry(from: view)
                return
            }
            if rearmPostWindow {
                attempts = 0
                // SwiftUI can reset the AppKit scroller flags shortly after
                // attachment (scroll-indicator materialization) with no body pass
                // after it. The transcript survives that via StickToBottomTracker's
                // per-pass re-apply; here re-apply briefly through the same single
                // bounded timer — idempotent, no extra timers.
                reapplyTicksRemaining = OverlayScrollerInstaller.postSuccessTicks
            }
            retained = scrollViews.map(WeakScrollViewBox.init)
            let ids = Set(scrollViews.map(ObjectIdentifier.init))
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
            styled.formIntersection(ids)
            if reapplyTicksRemaining > 0 {
                reapplyTicksRemaining -= 1
                scheduleRetry(from: view)
            }
        }

        private func scheduleRetry(from view: NSView) {
            guard attempts < 16 else { return }
            attempts += 1
            workItem?.cancel()
            let item = DispatchWorkItem { [weak self, weak view] in
                guard let self, let view else { return }
                // Retry ticks never re-arm the post-layout window: the chain
                // always terminates on its own while nothing keeps updating.
                self.ensureInstalled(from: view, rearmPostWindow: false)
            }
            workItem = item
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05, execute: item)
        }

        func cancel() {
            workItem?.cancel()
            workItem = nil
            styled.removeAll()
            retained.removeAll()
        }

        deinit { cancel() }
    }
}

/// Weak box so `Coordinator` can retain target scroll views without a cycle.
private final class WeakScrollViewBox {
    weak var scrollView: NSScrollView?
    init(_ scrollView: NSScrollView) { self.scrollView = scrollView }
}

extension View {
    /// Thin overlay scrollbars (transcript, sidebar, right panels).
    func overlayScrollers() -> some View {
        background(OverlayScrollerInstaller())
    }
}
