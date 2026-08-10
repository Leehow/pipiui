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

    /// True when `scrollView` already carries the overlay configuration that
    /// `applyIfNeeded` installs. Centralises the installer's idempotency guard
    /// so it is unit-testable instead of buried inside the NSViewRepresentable.
    static func isCorrectlyConfigured(_ scrollView: NSScrollView) -> Bool {
        scrollView.hasVerticalScroller
            && scrollView.scrollerStyle == .overlay
            && scrollView.autohidesScrollers
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

    /// Discovery retry budget while no scroll view is attached yet (50 ms each).
    /// Bounded so a never-mounted host cannot spin forever.
    fileprivate static let discoveryRetryLimit = 16

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
        /// Bounded so a never-mounted host cannot spin forever.
        private var discoveryAttempts = 0
        /// Strictly bounded post-install re-confirm window (50 ms ticks). Armed
        /// ONLY when a real scroller-flag change was applied this pass; the
        /// timer chain then consumes it without re-arming. A steady-state body
        /// pass (live badges, selection, hover, search) finds every scroll view
        /// already correctly styled and schedules nothing — the previous logic
        /// re-armed this 16×50ms chain on every single body re-render.
        private var confirmTicksRemaining = 0
        private var workItem: DispatchWorkItem?
        /// Per-scroll-view idempotency guard: once a scroll view is confirmed
        /// overlay-styled, later passes skip it (and skip re-arming any timer)
        /// unless SwiftUI reset its flags or rebuilt it as a new instance.
        private var styled = Set<ObjectIdentifier>()
        /// Weakly retained targets so every pass re-applies without depending on
        /// re-discovery (mirrors `StickToBottomTracker.attachedScrollView`). Weak
        /// references — AppKit owns the scroll views, so there is no retain cycle.
        private var retained: [WeakScrollViewBox] = []

        func ensureInstalled(from view: NSView) {
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
                scheduleDiscoveryRetry(from: view)
                return
            }
            // Scroll views found: reset the discovery budget and remember targets.
            discoveryAttempts = 0
            retained = scrollViews.map(WeakScrollViewBox.init)
            let ids = Set(scrollViews.map(ObjectIdentifier.init))

            var appliedChange = false
            for sv in scrollViews {
                let id = ObjectIdentifier(sv)
                // Idempotency guard: already styled AND still correctly configured
                // ⇒ no work, no timer re-arm this pass.
                if styled.contains(id), OverlayScrollers.isCorrectlyConfigured(sv) {
                    continue
                }
                let didChange = OverlayScrollers.applyIfNeeded(to: sv)
                if didChange || sv.scrollerStyle == .overlay {
                    styled.insert(id)
                }
                if didChange { appliedChange = true }
            }
            // Drop ids for scroll views that have left the hierarchy.
            styled.formIntersection(ids)

            if appliedChange {
                // SwiftUI can reset scroller flags during the layout pass right
                // after install with no following body pass to re-apply. Re-confirm
                // briefly through one bounded timer (idempotent, no extra timers).
                confirmTicksRemaining = OverlayScrollerInstaller.postSuccessTicks
                scheduleTick(from: view)
            } else if confirmTicksRemaining > 0 {
                confirmTicksRemaining -= 1
                scheduleTick(from: view)
            }
            // else: steady state — every scroll view is correct and the confirm
            // window has expired. Nothing is scheduled; the next body pass
            // rechecks cheaply (collect + isCorrectlyConfigured) and reschedules
            // only if a flag was reset (e.g. SwiftUI rebuilt the scroll view).
        }

        private func scheduleDiscoveryRetry(from view: NSView) {
            guard discoveryAttempts < OverlayScrollerInstaller.discoveryRetryLimit else { return }
            discoveryAttempts += 1
            scheduleTick(from: view)
        }

        private func scheduleTick(from view: NSView) {
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
            retained.removeAll()
            confirmTicksRemaining = 0
            discoveryAttempts = 0
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
