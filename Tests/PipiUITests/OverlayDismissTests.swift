import XCTest
import AppKit
@testable import PipiUI

/// Records how many times `Coordinator`/`LocatorView` hand off a window, without
/// holding any window strongly (so the test can prove the window deallocates).
private final class ReportSink {
    var count = 0
    var lastIdentity: ObjectIdentifier?

    func record(_ window: NSWindow) {
        count += 1
        lastIdentity = ObjectIdentifier(window)
    }
}

/// Captures the local-monitor event handler so a test can drive it directly
/// (the production `addMonitor` would otherwise install a real NSEvent monitor).
private final class EventHandlerBox {
    var handler: OverlayDismissMonitor.EventHandler?
}

/// NSWindow subclass that forces `sheetParent`/`isKeyWindow` so the monitor's
/// hit-test can be exercised without a real modal sheet session (which would
/// block the test and order windows front). Never ordered front.
private final class TestSheetWindow: NSWindow {
    var forcedSheetParent: NSWindow?
    var forcedIsKeyWindow = false
    override var sheetParent: NSWindow? { forcedSheetParent }
    override var isKeyWindow: Bool { forcedIsKeyWindow }
}

/// Simple error for source-contract helper failures.
private struct TestError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

/// Pure hit-test logic for "click outside the sheet to dismiss". The monitor
/// plumbing around it is window/AppKit-bound; this decision function is the part
/// that must be deterministic and side-effect free.
final class OverlayDismissTests: XCTestCase {
    private let sheetFrame = CGRect(x: 100, y: 100, width: 640, height: 620)

    /// Off-screen, borderless, never ordered front — never visible on the desktop.
    private func makeOffscreenWindow() -> NSWindow {
        NSWindow(
            contentRect: CGRect(x: -10000, y: -10000, width: 100, height: 100),
            styleMask: [],
            backing: .buffered,
            defer: false
        )
    }

    /// Reads `OverlayDismiss.swift` for source-level wiring contracts.
    private func overlayDismissSource() throws -> String {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        return try String(contentsOf:
            root.appendingPathComponent("Sources/PipiUI/Views/OverlayDismiss.swift"))
    }

    /// Extracts the brace-delimited body (braces included) of the first method
    /// whose declaration contains `fragment`. Used for source-level contracts.
    private func methodBody(in source: String, containing fragment: String) throws -> String {
        guard let signature = source.range(of: fragment) else {
            throw TestError("signature not found: \(fragment)")
        }
        let rest = source[signature.upperBound...]
        guard let openBrace = rest.firstIndex(of: "{") else {
            throw TestError("no opening brace after: \(fragment)")
        }
        var depth = 0
        var idx = openBrace
        while idx < rest.endIndex {
            let c = rest[idx]
            if c == "{" { depth += 1 }
            if c == "}" {
                depth -= 1
                if depth == 0 { return String(rest[openBrace...idx]) }
            }
            idx = rest.index(after: idx)
        }
        throw TestError("unbalanced braces for: \(fragment)")
    }

    func testParentWindowOutsideClickDismisses() {
        XCTAssertTrue(OverlayDismissHitTest.shouldDismiss(
            eventWindowRole: .parent,
            point: CGPoint(x: 50, y: 50),
            sheetFrame: sheetFrame,
            sheetWindowIsKey: true
        ))
    }

    func testParentWindowPointInsideSheetDoesNotDismiss() {
        XCTAssertFalse(OverlayDismissHitTest.shouldDismiss(
            eventWindowRole: .parent,
            point: CGPoint(x: 420, y: 410),
            sheetFrame: sheetFrame,
            sheetWindowIsKey: true
        ))
    }

    func testSheetWindowEventPassesThrough() {
        XCTAssertFalse(OverlayDismissHitTest.shouldDismiss(
            eventWindowRole: .sheet,
            point: CGPoint(x: 50, y: 50),
            sheetFrame: sheetFrame,
            sheetWindowIsKey: true
        ))
    }

    func testOtherPipiUIWindowEventPassesThrough() {
        XCTAssertFalse(OverlayDismissHitTest.shouldDismiss(
            eventWindowRole: .other,
            point: CGPoint(x: 50, y: 50),
            sheetFrame: sheetFrame,
            sheetWindowIsKey: true
        ))
    }

    func testNilOrMenuWindowEventPassesThrough() {
        XCTAssertFalse(OverlayDismissHitTest.shouldDismiss(
            eventWindowRole: .none,
            point: CGPoint(x: 50, y: 50),
            sheetFrame: sheetFrame,
            sheetWindowIsKey: true
        ))
    }

    func testNonKeySheetNeverDismissesParentClick() {
        XCTAssertFalse(OverlayDismissHitTest.shouldDismiss(
            eventWindowRole: .parent,
            point: CGPoint(x: 50, y: 50),
            sheetFrame: sheetFrame,
            sheetWindowIsKey: false
        ))
    }

    @MainActor
    func testMonitorRegistersOnceAndDetachesOnce() {
        var addCount = 0
        var removeCount = 0
        let token = NSObject()
        let monitor = OverlayDismissMonitor(
            addMonitor: { _ in
                addCount += 1
                return token
            },
            removeMonitor: { removed in
                removeCount += 1
                XCTAssertTrue((removed as AnyObject) === token)
            }
        )
        let window = NSWindow(
            contentRect: sheetFrame,
            styleMask: [],
            backing: .buffered,
            defer: false
        )

        monitor.attach(window: window)
        monitor.attach(window: window)
        XCTAssertEqual(addCount, 1, "body updates must not stack local monitors")

        monitor.detach()
        monitor.detach()
        XCTAssertEqual(removeCount, 1, "dismiss/onDisappear must remove exactly one token")
    }

    // MARK: - Sheet-close crash regression (OverlayDismiss.swift)

    /// `Coordinator` is a stateless forwarder: every report is delivered (dedup
    /// is the monitor's job, not the coordinator's), it retains no window, and
    /// `dismantle` stops further forwarding.
    @MainActor
    func testCoordinatorForwardsEveryReportRetainsNoWindowAndStopsAfterDismantle() {
        let sink = ReportSink()
        let coordinator = SheetWindowLocator.Coordinator(
            onWindow: { sink.record($0) },
            onUpdate: {}
        )

        weak var weakA: NSWindow?
        autoreleasepool {
            let a = makeOffscreenWindow()
            weakA = a
            coordinator.report(a)
            coordinator.report(a)  // forwards every call; dedup is the monitor's job
            XCTAssertEqual(sink.count, 2)
            XCTAssertEqual(sink.lastIdentity, ObjectIdentifier(a))
        }
        XCTAssertNil(weakA, "Coordinator must not retain the reported window")
        XCTAssertEqual(sink.count, 2, "window dealloc must not produce another report")

        // dismantle neutralizes the coordinator: no further forwarding.
        coordinator.dismantle()
        autoreleasepool {
            let b = makeOffscreenWindow()
            coordinator.report(b)
            XCTAssertEqual(sink.count, 2, "dismantled coordinator must not forward")
        }
    }

    /// The only report comes from the stable `viewDidMoveToWindow` attach.
    /// Releasing the window (which drives `viewDidMoveToWindow(nil)`) must not
    /// re-report or crash — this is the precise teardown moment the old
    /// eager-updateNSView path would `objc_storeWeak` a dying window and abort.
    @MainActor
    func testLocatorReportsOnceOnAttachAndSurvivesWindowDealloc() {
        let sink = ReportSink()
        let coordinator = SheetWindowLocator.Coordinator(
            onWindow: { sink.record($0) },
            onUpdate: {}
        )
        let locator = SheetWindowLocator.LocatorView()
        SheetWindowLocator.installReport(on: locator, coordinator: coordinator)

        weak var weakWindow: NSWindow?
        autoreleasepool {
            let window = makeOffscreenWindow()
            weakWindow = window
            window.contentView = locator  // viewDidMoveToWindow -> report #1
            XCTAssertEqual(sink.count, 1)
            XCTAssertEqual(sink.lastIdentity, ObjectIdentifier(window))
        }
        XCTAssertNil(weakWindow, "window must deallocate; the locator must not retain it")
        XCTAssertEqual(sink.count, 1, "dealloc/teardown must not produce another report")
    }

    /// Guards the detach→reattach regression (re-opening settings): if the
    /// report closure is ever lost, `updateNSView`'s `installReport` + `refresh`
    /// must restore it so the next attach reports again. Exercises the real
    /// production helpers and verifies `dismantle` halts reporting.
    @MainActor
    func testLocatorReinstallsReportClosureOnUpdateAndReportsAgainOnReattach() {
        let sink = ReportSink()
        let coordinator = SheetWindowLocator.Coordinator(
            onWindow: { sink.record($0) },
            onUpdate: {}
        )
        let locator = SheetWindowLocator.LocatorView()
        let a = makeOffscreenWindow()
        let b = makeOffscreenWindow()
        defer {
            a.contentView = NSView()
            b.contentView = NSView()
        }

        // makeNSView: install report closure + refresh. Attach A -> report #1.
        SheetWindowLocator.installReport(on: locator, coordinator: coordinator)
        SheetWindowLocator.refresh(coordinator: coordinator, onUpdate: {})
        a.contentView = locator
        XCTAssertEqual(sink.count, 1)
        XCTAssertEqual(sink.lastIdentity, ObjectIdentifier(a))

        // Detach from A (window -> nil): no report.
        a.contentView = NSView()
        XCTAssertNil(locator.window)
        XCTAssertEqual(sink.count, 1)

        // Simulate the closure being lost (the old viewDidMoveToWindow(nil)
        // symptom that broke re-presentation).
        locator.report = nil
        b.contentView = locator
        XCTAssertEqual(sink.count, 1, "a cleared closure must not report on attach")
        b.contentView = NSView()
        XCTAssertNil(locator.window)

        // updateNSView: reinstall closure + refresh (no window, no report).
        SheetWindowLocator.installReport(on: locator, coordinator: coordinator)
        SheetWindowLocator.refresh(coordinator: coordinator, onUpdate: {})
        b.contentView = locator
        XCTAssertEqual(sink.count, 2, "reinstalled closure must report the new attach")
        XCTAssertEqual(sink.lastIdentity, ObjectIdentifier(b))

        // dismantle helper (the static hook delegates here): no further report.
        SheetWindowLocator.dismantle(locator, coordinator: coordinator)
        XCTAssertNil(locator.report, "dismantle must clear the report closure")
        a.contentView = locator
        XCTAssertEqual(sink.count, 2, "after dismantle, moving windows must not report")
    }

    /// `OverlayDismissMonitor` must re-bind to a NEW window across a
    /// detach→reattach (so re-opening settings works), never stack monitors on
    /// repeated attach, and clear its binding on detach. The only
    /// `sheetWindow = window` write happens on the stable, first-attach path.
    @MainActor
    func testMonitorReattachBindsNewWindowWithoutStacking() {
        var addCount = 0
        var removeCount = 0
        let monitor = OverlayDismissMonitor(
            addMonitor: { _ in
                addCount += 1
                return NSObject()
            },
            removeMonitor: { _ in
                removeCount += 1
            }
        )
        let a = makeOffscreenWindow()
        let b = makeOffscreenWindow()

        // First stable attach: one monitor, bound to A.
        monitor.attach(window: a)
        XCTAssertEqual(addCount, 1)
        XCTAssertTrue(monitor.boundSheetWindow === a)

        // Repeated attach (even a different window) must not stack or rebind.
        monitor.attach(window: a)
        monitor.attach(window: b)
        XCTAssertEqual(addCount, 1, "repeat attach must not stack monitors")
        XCTAssertTrue(monitor.boundSheetWindow === a, "repeat attach must not rebind")

        // Detach, then reattach a new window: re-created, bound to B.
        monitor.detach()
        XCTAssertEqual(removeCount, 1)
        XCTAssertNil(monitor.boundSheetWindow)

        monitor.attach(window: b)
        XCTAssertEqual(addCount, 2)
        XCTAssertTrue(monitor.boundSheetWindow === b)

        monitor.attach(window: b)
        XCTAssertEqual(addCount, 2)
        XCTAssertTrue(monitor.boundSheetWindow === b)

        monitor.detach()
        XCTAssertEqual(removeCount, 2)
        XCTAssertNil(monitor.boundSheetWindow)
    }

    /// `eventWindowRole` must classify by AppKit identity, including the real
    /// `sheetParent` relationship — without a modal `beginSheet` (which would
    /// block the test). Uses `TestSheetWindow` to force `sheetParent`.
    @MainActor
    func testEventWindowRoleAppKitIdentityClassification() {
        let sheet = TestSheetWindow(
            contentRect: CGRect(x: -10000, y: -10000, width: 100, height: 100),
            styleMask: [], backing: .buffered, defer: false
        )
        let parent = makeOffscreenWindow()
        let other = makeOffscreenWindow()

        XCTAssertEqual(OverlayDismissHitTest.eventWindowRole(eventWindow: sheet, sheetWindow: sheet), .sheet)
        XCTAssertEqual(OverlayDismissHitTest.eventWindowRole(eventWindow: nil, sheetWindow: sheet), .none)
        XCTAssertEqual(OverlayDismissHitTest.eventWindowRole(eventWindow: other, sheetWindow: sheet), .other)

        sheet.forcedSheetParent = parent
        XCTAssertEqual(OverlayDismissHitTest.eventWindowRole(eventWindow: parent, sheetWindow: sheet), .parent)
        // A window that is not the recorded sheetParent stays "other".
        XCTAssertEqual(OverlayDismissHitTest.eventWindowRole(eventWindow: other, sheetWindow: sheet), .other)
    }

    /// Guards the stale-closure fix (Medium 1): with no window reported, the
    /// refresh path must still swap the monitor's dismiss closure to the latest
    /// one, so an already-attached monitor never keeps firing a stale closure.
    @MainActor
    func testRefreshSwapsMonitorDismissClosureWithoutWindow() {
        let monitor = OverlayDismissMonitor(
            addMonitor: { _ in NSObject() },
            removeMonitor: { _ in }
        )
        monitor.attach(window: makeOffscreenWindow())

        var oldFired = false
        monitor.onDismiss = { oldFired = true }

        var newFired = false
        let coordinator = SheetWindowLocator.Coordinator(
            onWindow: { _ in },
            onUpdate: { monitor.onDismiss = { newFired = true } }
        )

        // refresh mirrors make/updateNSView: no window access, no report.
        SheetWindowLocator.refresh(coordinator: coordinator, onUpdate: coordinator.onUpdate)

        monitor.onDismiss?()
        XCTAssertTrue(newFired, "refresh must swap in the new dismiss closure")
        XCTAssertFalse(oldFired, "the stale closure must no longer be wired")
    }

    /// Guards the High fix: `dismantleNSView` must be the `static` protocol hook
    /// (this call only compiles because it is static) and must clear the report
    /// closure + neutralize the coordinator so no teardown report fires.
    @MainActor
    func testDismantleNSViewIsStaticHookAndClearsCallback() {
        let sink = ReportSink()
        let coordinator = SheetWindowLocator.Coordinator(
            onWindow: { sink.record($0) },
            onUpdate: {}
        )
        let locator = SheetWindowLocator.LocatorView()
        SheetWindowLocator.installReport(on: locator, coordinator: coordinator)

        let window = makeOffscreenWindow()
        window.contentView = locator
        XCTAssertEqual(sink.count, 1)

        // Static protocol-hook call (would not compile if dismantleNSView were
        // an instance method).
        SheetWindowLocator.dismantleNSView(locator, coordinator: coordinator)
        XCTAssertNil(locator.report, "static dismantleNSView must clear the report closure")

        let other = makeOffscreenWindow()
        other.contentView = locator
        XCTAssertEqual(sink.count, 1, "after dismantleNSView, no report must fire")
        other.contentView = NSView()
        window.contentView = NSView()
    }

    /// Source/compile contracts: `updateNSView` calls refresh+installReport and
    /// never reads the hosting window or actively reports; `dismantleNSView` is
    /// the static hook delegating to `dismantle`; no forbidden window state.
    func testProductionWiringContracts() throws {
        let src = try overlayDismissSource()

        XCTAssertTrue(src.contains("static func dismantleNSView("),
                      "dismantleNSView must be the static protocol hook")
        XCTAssertTrue(src.contains("static func dismantle("),
                      "teardown logic must live in a static dismantle helper")

        let updateBody = try methodBody(in: src, containing: "func updateNSView(")
        XCTAssertTrue(updateBody.contains("installReport"), "updateNSView must reinstall the report closure")
        XCTAssertTrue(updateBody.contains("refresh"), "updateNSView must refresh the dismiss closure")
        XCTAssertFalse(updateBody.contains("nsView.window"), "updateNSView must not read the hosting window (crash root cause)")
        XCTAssertFalse(updateBody.contains(".report("), "updateNSView must not actively report")
        XCTAssertFalse(updateBody.contains("coordinator.report"), "updateNSView must not actively report")

        let hookBody = try methodBody(in: src, containing: "static func dismantleNSView(")
        XCTAssertTrue(hookBody.contains("dismantle("), "dismantleNSView must delegate to dismantle(...)")

        XCTAssertFalse(src.contains("weak var reportedWindow"))
        XCTAssertFalse(src.contains("reportedID"))
    }

    /// End-to-end through the monitor's event handler: an outside click on the
    /// sheet's parent must be consumed and dispatch the dismiss closure. Uses
    /// injected `pointProvider`/`eventWindowFor` + a forced
    /// `sheetParent`/`isKeyWindow`, so no real cursor move or modal sheet is
    /// needed; nothing is ordered front.
    @MainActor
    func testMonitorHandlerConsumesOutsideClickAndFiresDismiss() {
        let box = EventHandlerBox()
        let sheet = TestSheetWindow(
            contentRect: CGRect(x: -10000, y: -10000, width: 100, height: 100),
            styleMask: [], backing: .buffered, defer: false
        )
        sheet.forcedIsKeyWindow = true
        let parent = makeOffscreenWindow()
        sheet.forcedSheetParent = parent
        let monitor = OverlayDismissMonitor(
            addMonitor: { handler in box.handler = handler; return NSObject() },
            removeMonitor: { _ in },
            pointProvider: { CGPoint(x: 50000, y: 50000) },  // far outside the offscreen sheet frame
            eventWindowFor: { _ in parent }                  // deterministic role = .parent
        )
        monitor.attach(window: sheet)

        var fired = false
        monitor.onDismiss = { fired = true }

        let event = NSEvent.mouseEvent(
            with: .leftMouseDown,
            location: .zero,
            modifierFlags: [],
            timestamp: 0,
            windowNumber: 0,
            context: nil,
            eventNumber: 0,
            clickCount: 1,
            pressure: 1.0
        )!

        guard let handler = box.handler else {
            XCTFail("monitor did not install an event handler"); return
        }
        // Unwrap first: optional chaining would yield `NSEvent??`, making a
        // consumed (nil) result look non-nil at the outer optional level.
        let result = handler(event)
        XCTAssertNil(result, "an outside click on the parent must be consumed (dismiss decided)")

        // onDismiss is dispatched async on the main queue; spin to observe it.
        let deadline = Date().addingTimeInterval(1.0)
        while !fired && Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.01))
        }
        XCTAssertTrue(fired, "the dismiss closure must fire for an outside click")
    }

    func testSettingsSheetOwnsDismissModifierForBothPresentationSites() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let settings = try String(contentsOf:
            root.appendingPathComponent("Sources/PipiUI/Views/SettingsSheet.swift"))
        let sidebar = try String(contentsOf:
            root.appendingPathComponent("Sources/PipiUI/Views/SidebarView.swift"))
        let consent = try String(contentsOf:
            root.appendingPathComponent("Sources/PipiUI/Views/ComputerConsentBar.swift"))

        XCTAssertTrue(settings.contains(".dismissOnOutsideClick { dismiss() }"))
        XCTAssertTrue(sidebar.contains(".sheet(isPresented: $showSettings)"))
        XCTAssertTrue(sidebar.contains("SettingsSheet()"))
        XCTAssertTrue(consent.contains(".sheet(isPresented: $showSettings)"))
        XCTAssertTrue(consent.contains("SettingsSheet()"))
    }
}
