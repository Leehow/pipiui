import SwiftUI
import AppKit

/// Click-outside-to-dismiss for a SwiftUI `.sheet` on macOS.
///
/// A modal sheet blocks mouse events to its parent window, but `sendEvent`
/// still runs a local monitor first. We install one while the sheet is on,
/// test the global mouse location against the sheet's own window frame, and
/// dismiss when the click landed outside it (i.e. on the dimmed parent).
///
/// Lifecycle safety:
/// - Only a **local** monitor is used (never global), so it sees only this app's
///   events and cannot fire for, or affect, other applications' windows.
/// - The monitor is owned by the sheet's own view; installing on appear and
///   uninstalling on disappear guarantees there is no leak if the sheet is
///   dismissed any other way (Done / Esc / programmatic).
/// - Dismissal is suppressed unless the sheet window is key, so a child sheet
///   (e.g. Add Model) presented on top of this one is never accidentally closed
///   by a click on the parent.
struct OverlayDismissHitTest {
    /// Window ownership distilled from AppKit identity checks. A local monitor
    /// sees events for every PipiUI window/menu; only this sheet's own parent is
    /// a valid gray-overlay dismissal target.
    enum EventWindowRole: Equatable {
        case sheet
        case parent
        case other
        case none
    }

    /// Pure decision: should a mouse-down at `point` dismiss and be consumed?
    ///
    /// `point` and `sheetFrame` must be in the same coordinate space
    /// (screen/global, origin bottom-left). Parent ownership is mandatory;
    /// sheet/other/nil (including menu) events always pass through untouched.
    static func shouldDismiss(
        eventWindowRole: EventWindowRole,
        point: CGPoint,
        sheetFrame: CGRect,
        sheetWindowIsKey: Bool
    ) -> Bool {
        guard eventWindowRole == .parent, sheetWindowIsKey else { return false }
        return !sheetFrame.contains(point)
    }

    static func eventWindowRole(
        eventWindow: NSWindow?,
        sheetWindow: NSWindow
    ) -> EventWindowRole {
        guard let eventWindow else { return .none }
        if eventWindow === sheetWindow { return .sheet }
        if let parent = sheetWindow.sheetParent, eventWindow === parent { return .parent }
        return .other
    }
}

/// Holds the local monitor token and the sheet window reference, decoupled from
/// SwiftUI view identity so recreation never drops the monitor.
final class OverlayDismissMonitor {
    typealias EventHandler = (NSEvent) -> NSEvent?
    typealias AddMonitor = (@escaping EventHandler) -> Any?
    typealias RemoveMonitor = (Any) -> Void
    typealias PointProvider = () -> CGPoint
    typealias EventWindowProvider = (NSEvent) -> NSWindow?

    fileprivate weak var sheetWindow: NSWindow?
    fileprivate var monitor: Any?
    private let addMonitor: AddMonitor
    private let removeMonitor: RemoveMonitor
    /// Provides the global mouse location used for hit-testing. Injectable so
    /// tests can drive a deterministic outside-click decision without moving
    /// the real cursor. Defaults to `NSEvent.mouseLocation`.
    private let pointProvider: PointProvider
    /// Resolves the event's target window for role classification. Injectable so
    /// tests need not depend on window-server identity resolution for windows
    /// that are never ordered front. Defaults to `event.window`.
    private let eventWindowFor: EventWindowProvider
    /// Called (on the main queue) when an outside click is detected.
    var onDismiss: (() -> Void)?

    init(
        addMonitor: @escaping AddMonitor = { handler in
            NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { event in
                handler(event)
            }
        },
        removeMonitor: @escaping RemoveMonitor = { token in
            NSEvent.removeMonitor(token)
        },
        pointProvider: @escaping PointProvider = { NSEvent.mouseLocation },
        eventWindowFor: @escaping EventWindowProvider = { $0.window }
    ) {
        self.addMonitor = addMonitor
        self.removeMonitor = removeMonitor
        self.pointProvider = pointProvider
        self.eventWindowFor = eventWindowFor
    }

    deinit { detach() }

    func attach(window: NSWindow) {
        // Already attached: never re-write the weak `sheetWindow`. A repeat
        // attach can race with teardown and would perform a fresh
        // `objc_storeWeak` against a window that may be mid-`dealloc` — fatal
        // inside `objc_storeWeak -> _objc_fatal`. The first (and only) attach
        // always happens from `viewDidMoveToWindow` against a freshly live
        // window, so that single weak store is safe.
        guard monitor == nil else { return }
        sheetWindow = window
        monitor = addMonitor { [weak self] event in
            // Bind self explicitly: `self?.handle(event:) ?? event` would yield
            // a double optional (NSEvent??), and `.some(nil) ?? event` resolves
            // to `event` — leaking the consume signal. Bind once, return the
            // handler's result directly.
            guard let self else { return event }
            return self.handle(event: event)
        }
    }

    func detach() {
        if let monitor {
            removeMonitor(monitor)
            self.monitor = nil
        }
        sheetWindow = nil
        // Drop the dismiss closure so it (and whatever it captures) is released
        // at deterministic teardown, not held until the monitor itself is freed.
        onDismiss = nil
    }

    /// Read-only accessor for the window the monitor is currently bound to.
    /// Lets tests observe the attach/detach lifecycle (including reattach to a
    /// new window) without synthesizing AppKit events.
    var boundSheetWindow: NSWindow? { sheetWindow }

    private func handle(event: NSEvent) -> NSEvent? {
        guard let window = sheetWindow else { return event }
        let shouldDismiss = OverlayDismissHitTest.shouldDismiss(
            eventWindowRole: OverlayDismissHitTest.eventWindowRole(
                eventWindow: eventWindowFor(event),
                sheetWindow: window
            ),
            point: pointProvider(),
            sheetFrame: window.frame,
            sheetWindowIsKey: window.isKeyWindow
        )
        guard shouldDismiss else { return event }
        // Defer the dismiss out of the event-dispatch call stack, and consume the
        // click so the modal session does not also "bounce" the sheet.
        DispatchQueue.main.async { [weak self] in self?.onDismiss?() }
        return nil
    }
}

/// SwiftUI entry point. Attach to the sheet's content; pass the dismiss action.
struct DismissOnOutsideClick: ViewModifier {
    let onDismiss: () -> Void
    @State private var monitor = OverlayDismissMonitor()

    func body(content: Content) -> some View {
        content
            .background(SheetWindowLocator(
                onWindow: { window in
                    monitor.onDismiss = onDismiss
                    monitor.attach(window: window)
                },
                onUpdate: {
                    // No-window refresh path: keep the dismiss closure current
                    // on every body pass, even when no window has been reported
                    // (the stale-closure fix). Never touches an NSWindow.
                    monitor.onDismiss = onDismiss
                }
            ))
            .onDisappear { monitor.detach() }
    }
}

/// Invisible `NSView` whose only job is to report the hosting window once the
/// SwiftUI sheet has been installed into it.
///
/// Lifecycle safety (regression guard for the sheet-close crash on macOS 26):
/// - The ONLY report point is the stable `viewDidMoveToWindow` attach, where the
///   window is freshly live. `viewDidMoveToWindow(nil)` reports nothing.
/// - `updateNSView` refreshes the dismiss callback AND re-installs the report
///   closure (so a reused NSView can report again after a detach→reattach), but
///   it NEVER reads `nsView.window` and NEVER reports. During sheet teardown
///   SwiftUI/AppKit can invoke `updateNSView` while the hosting `NSWindow` is
///   already in `dealloc`; any fresh `objc_storeWeak` against that window (e.g.
///   assigning it into a `weak var`) aborts inside `objc_storeWeak ->
///   weak_register_no_lock -> _objc_fatal`.
/// - `Coordinator` holds NO window state — not weak, not by identity. It is a
///   pure forwarder; de-duplication lives in `OverlayDismissMonitor.attach`,
///   which early-returns once it has a token. (An `ObjectIdentifier`/`weak`
///   cache here would either never reset — false "already reported" on address
///   reuse — or re-introduce the fatal weak window store.)
/// - `dismantleNSView` is the `static` protocol hook (an instance method of
///   this name is NOT called by SwiftUI — it would hit the default no-op); it
///   delegates to the `dismantle` helper, clearing the report closure and
///   neutralizing the coordinator.
/// - `makeNSView`/`updateNSView` also call `refresh`, a no-window path that
///   keeps `monitor.onDismiss` current across body passes without reporting.
/// - The only `weak NSWindow` store in the whole feature is
///   `OverlayDismissMonitor.sheetWindow`, written exactly once per attach,
///   guarded by `monitor == nil`, on the stable attach path.
struct SheetWindowLocator: NSViewRepresentable {
    var onWindow: (NSWindow) -> Void
    /// No-window refresh invoked from `makeNSView`/`updateNSView` (e.g. to keep
    /// the monitor's dismiss closure fresh across body passes). Must never touch
    /// an NSWindow.
    var onUpdate: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onWindow: onWindow, onUpdate: onUpdate)
    }

    func makeNSView(context: Context) -> LocatorView {
        let view = LocatorView()
        // Zero-size, fully transparent: pure plumbing, never part of layout.
        view.frame = .zero
        Self.installReport(on: view, coordinator: context.coordinator)
        Self.refresh(coordinator: context.coordinator, onUpdate: onUpdate)
        return view
    }

    func updateNSView(_ nsView: LocatorView, context: Context) {
        // Refresh the dismiss callback AND re-install the report closure, with
        // NO access to the hosting NSWindow and NO active report. During sheet
        // teardown SwiftUI/AppKit can call updateNSView while the hosting
        // NSWindow is already in `dealloc`; any fresh `objc_storeWeak` against
        // that window (e.g. assigning it into a `weak var`) aborts inside
        // `objc_storeWeak -> weak_register_no_lock -> _objc_fatal`.
        context.coordinator.onWindow = onWindow
        context.coordinator.onUpdate = onUpdate
        Self.installReport(on: nsView, coordinator: context.coordinator)
        Self.refresh(coordinator: context.coordinator, onUpdate: onUpdate)
    }

    // Protocol hook. MUST be `static func`: NSViewRepresentable's requirement is
    // static, so an instance method named `dismantleNSView` would NOT override
    // it — SwiftUI would call the default no-op and this cleanup would never
    // run in production.
    static func dismantleNSView(_ nsView: LocatorView, coordinator: Coordinator) {
        dismantle(nsView, coordinator: coordinator)
    }

    /// Installs the closure that forwards a freshly-attached window to the
    /// coordinator. Extracted as an internal helper so `makeNSView`,
    /// `updateNSView`, and tests all exercise the same production logic. It
    /// captures the coordinator weakly (a plain Swift class — safe to
    /// weak-register) and never stores the NSWindow.
    static func installReport(on nsView: LocatorView, coordinator: Coordinator) {
        nsView.report = { [weak coordinator] window in
            coordinator?.report(window)
        }
    }

    /// No-window refresh: stores `onUpdate` on the coordinator and invokes it.
    /// This is the path that keeps `monitor.onDismiss` fresh even when no window
    /// is reported (the stale-closure fix). Extracted so make/updateNSView and
    /// tests share one production code path. Never touches an NSWindow.
    static func refresh(coordinator: Coordinator, onUpdate: @escaping () -> Void) {
        coordinator.onUpdate = onUpdate
        onUpdate()
    }

    /// Pure teardown helper invoked by the static `dismantleNSView` hook.
    /// Clears the report closure and neutralizes the coordinator. Tests call
    /// this directly; the wiring contract test verifies the hook delegates here.
    static func dismantle(_ nsView: LocatorView, coordinator: Coordinator) {
        nsView.report = nil
        coordinator.dismantle()
    }

    final class Coordinator {
        var onWindow: (NSWindow) -> Void
        var onUpdate: () -> Void

        init(onWindow: @escaping (NSWindow) -> Void, onUpdate: @escaping () -> Void) {
            self.onWindow = onWindow
            self.onUpdate = onUpdate
        }

        /// Pure forwarder — no window state, no dedup. Dedup is the monitor's
        /// responsibility (`OverlayDismissMonitor.attach` early-returns once it
        /// has a token). Keeping state out of here is what guarantees we never
        /// weak-register an NSWindow on the report path.
        func report(_ window: NSWindow) {
            onWindow(window)
        }

        /// Called from `dismantleNSView`; releases the dismiss closure chain.
        func dismantle() {
            onWindow = { _ in }
            onUpdate = {}
        }
    }

    final class LocatorView: NSView {
        var report: ((NSWindow) -> Void)?

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            // The single, stable report point. On attach the window is freshly
            // live, so handing it downstream (into the monitor's one weak store)
            // is safe. On `window == nil` we intentionally do NOT clear
            // `report`: clearing it broke detach→reattach, because updateNSView
            // is what must restore the closure. Final cleanup is
            // `dismantleNSView`'s job.
            if let window {
                report?(window)
            }
        }
    }
}

extension View {
    /// Dismiss the enclosing sheet when the user clicks outside it.
    func dismissOnOutsideClick(_ onDismiss: @escaping () -> Void) -> some View {
        modifier(DismissOnOutsideClick(onDismiss: onDismiss))
    }
}
