import XCTest
import AppKit
import SwiftUI
@testable import PipiUI

@MainActor
final class ComputerUsePresentationTests: XCTestCase {
    func testHighlightPanelIsNonActivatingAndMouseTransparent() {
        let panel = ComputerUseWindowPresentation.makeHighlightPanel()

        XCTAssertFalse(panel.canBecomeKey)
        XCTAssertFalse(panel.canBecomeMain)
        XCTAssertTrue(panel.ignoresMouseEvents)
        XCTAssertFalse(panel.hidesOnDeactivate)
        XCTAssertTrue(panel.styleMask.contains(.nonactivatingPanel))
        XCTAssertFalse(panel.isOpaque)
        XCTAssertEqual(panel.backgroundColor, .clear)
        XCTAssertEqual(panel.level, .screenSaver)
        XCTAssertTrue(panel.collectionBehavior.contains(.canJoinAllSpaces))
        XCTAssertTrue(panel.collectionBehavior.contains(.fullScreenAuxiliary))
    }

    func testQuartzWindowBoundsConvertAcrossDisplayArrangements() {
        XCTAssertEqual(
            ComputerUseWindowPresentation.appKitBounds(
                forQuartzBounds: CGRect(x: -1280, y: -900, width: 1280, height: 900),
                mainScreenMaxY: 1080
            ),
            NSRect(x: -1280, y: 1080, width: 1280, height: 900)
        )
        XCTAssertEqual(
            ComputerUseWindowPresentation.appKitBounds(
                forQuartzBounds: CGRect(x: 0, y: 1080, width: 1920, height: 1080),
                mainScreenMaxY: 1080
            ),
            NSRect(x: 0, y: -1080, width: 1920, height: 1080)
        )
    }

    func testMiniProgressSizeIsBelowPersistedWindowMinimum() {
        let size = ComputerUseWindowPresentation.miniContentSize
        XCTAssertLessThan(size.width, LayoutPersistence.minimumWindowContentSize.width)
        XCTAssertLessThan(size.height, LayoutPersistence.minimumWindowContentSize.height)

        let suiteName = "pipiui.test.presentation.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }
        LayoutPersistence.saveWindowContentSize(size, defaults: defaults)
        LayoutPersistence.flushPendingWrites()
        XCTAssertNil(LayoutPersistence.storedWindowContentSize(defaults: defaults))
    }

    func testExecutionPresentationTracksNativeExecution() {
        let coordinator = ComputerCoordinator(computerUseEnabledProvider: { true })
        XCTAssertFalse(coordinator.isPresentingDesktopOperation)
        coordinator.inFlightExecution = ComputerInFlightExecution(
            requestID: UUID().uuidString, sessionKey: "test", generation: 1,
            gate: ComputerExecutionGate(), reply: ComputerResponseGate { _ in }
        )
        coordinator.isDesktopOperationActive = true
        XCTAssertTrue(coordinator.isPresentingDesktopOperation)
        coordinator.inFlightExecution = nil
        coordinator.clearLeasePresentation()
        XCTAssertFalse(coordinator.isPresentingDesktopOperation)
    }

    func testPresentationReplacesAndRestoresMainWindowContent() {
        let coordinator = ComputerCoordinator(computerUseEnabledProvider: { true })
        let controller = ComputerUseWindowPresentation()
        let originalContent = NSView(frame: NSRect(x: 0, y: 0, width: 1000, height: 700))
        // A test-only window substitute intercepts every AppKit fronting call.
        // The production presentMiniWindow() still calls orderFrontRegardless()
        // (verified via orderFrontRegardlessCallCount below), but the dynamic
        // dispatch lands here as a no-op so the fixture never reaches the
        // real desktop.
        let window = NonOrderingTestWindow(
            contentRect: originalContent.frame,
            styleMask: [.titled, .resizable],
            backing: .buffered,
            defer: false
        )
        window.contentView = originalContent
        window.toolbar = NSToolbar(identifier: "ComputerUsePresentationTests")
        window.toolbar?.isVisible = true
        window.contentMinSize = NSSize(width: 800, height: 560)
        let originalMinSize = window.minSize
        let originalContentMinSize = window.contentMinSize
        let originalFrame = window.frame
        let originalContentSize = window.contentRect(forFrameRect: window.frame).size
        let originalCollectionBehavior = window.collectionBehavior
        let originalStyleMask = window.styleMask
        controller.attach(to: window)

        coordinator.isDesktopOperationActive = true
        coordinator.statusMessage = "正在操作 TextEdit…"
        controller.update(for: coordinator)

        XCTAssertEqual(window.level, .floating)
        XCTAssertEqual(window.frame.size, ComputerUseWindowPresentation.miniContentSize)
        XCTAssertFalse(window.contentView === originalContent)
        XCTAssertTrue(window.styleMask.contains(.fullSizeContentView))
        XCTAssertEqual(window.titleVisibility, .hidden)
        XCTAssertTrue(window.titlebarAppearsTransparent)
        XCTAssertFalse(window.toolbar?.isVisible ?? true)
        XCTAssertTrue(window.standardWindowButton(.closeButton)?.isHidden ?? false)
        XCTAssertTrue(window.standardWindowButton(.miniaturizeButton)?.isHidden ?? false)
        XCTAssertTrue(window.standardWindowButton(.zoomButton)?.isHidden ?? false)
        XCTAssertLessThanOrEqual(window.minSize.width, ComputerUseWindowPresentation.miniContentSize.width)
        XCTAssertLessThanOrEqual(window.minSize.height, ComputerUseWindowPresentation.miniContentSize.height)
        XCTAssertLessThanOrEqual(
            window.contentMinSize.width,
            ComputerUseWindowPresentation.miniContentSize.width
        )
        XCTAssertLessThanOrEqual(
            window.contentMinSize.height,
            ComputerUseWindowPresentation.miniContentSize.height
        )
        XCTAssertTrue(window.collectionBehavior.contains(.canJoinAllSpaces))

        // The mini-mode fronting path was reached exactly once, yet the
        // substitute kept the window off-screen — the fixture must never
        // become visible during the test.
        XCTAssertEqual(window.orderFrontRegardlessCallCount, 1)
        XCTAssertEqual(window.orderFrontCallCount, 0)
        XCTAssertFalse(window.isVisible)

        // SwiftUI dismantles the attachment as a consequence of the deliberate
        // content swap. This must not immediately undo mini mode.
        controller.attach(to: nil)
        XCTAssertFalse(window.contentView === originalContent)

        coordinator.isDesktopOperationActive = false
        controller.update(for: coordinator)
        XCTAssertTrue(window.contentView === originalContent)
        XCTAssertEqual(window.frame, originalFrame)
        XCTAssertEqual(window.contentRect(forFrameRect: window.frame).size, originalContentSize)
        XCTAssertEqual(window.minSize, originalMinSize)
        XCTAssertEqual(window.contentMinSize, originalContentMinSize)
        XCTAssertEqual(window.collectionBehavior, originalCollectionBehavior)
        XCTAssertEqual(window.styleMask, originalStyleMask)
        XCTAssertEqual(window.titleVisibility, .visible)
        XCTAssertFalse(window.titlebarAppearsTransparent)
        XCTAssertTrue(window.toolbar?.isVisible ?? false)
        XCTAssertFalse(window.standardWindowButton(.closeButton)?.isHidden ?? true)

        // Restoration must not surface the window either.
        XCTAssertEqual(window.orderFrontRegardlessCallCount, 1)
        XCTAssertFalse(window.isVisible)
    }

    func testRestorationReinsetsSwiftUIContentBelowTitlebar() {
        // Regression: after Computer Use the window's SwiftUI content view was
        // swapped out (mini full-size-content chrome) and swapped back, but
        // nothing forced a fresh layout pass, so the reattached content kept
        // its stale safe-area insets from the mini geometry and the transcript
        // painted under the title/toolbar. restoreMainWindow() now forces a
        // layout pass; assert it actually runs and that the restored content
        // ends up re-inset below the titlebar.
        let coordinator = ComputerCoordinator(computerUseEnabledProvider: { true })
        let controller = ComputerUseWindowPresentation()
        let window = NonOrderingTestWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1000, height: 700),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.toolbar = NSToolbar(identifier: "RestorationReinsetTests")
        window.toolbar?.isVisible = true
        window.titleVisibility = .visible
        window.titlebarAppearsTransparent = false
        let hosting = LayoutCountingHostingView(rootView: Text("transcript"))
        window.contentView = hosting
        window.layoutIfNeeded()
        let titlebarSafeArea = hosting.safeAreaInsets.top
        XCTAssertGreaterThan(titlebarSafeArea, 0, "fixture must model a unified titlebar+toolbar inset")

        controller.attach(to: window)
        coordinator.isDesktopOperationActive = true
        coordinator.statusMessage = "正在操作 测试应用…"
        controller.update(for: coordinator)
        // Mini mode collapses the titlebar/toolbar inset.
        XCTAssertLessThan(window.contentView?.safeAreaInsets.top ?? .greatestFiniteMagnitude,
                          titlebarSafeArea)

        coordinator.isDesktopOperationActive = false
        let layoutsBeforeRestore = hosting.layoutCallCount
        controller.update(for: coordinator)
        // The restore itself must force at least one layout pass on the
        // reattached SwiftUI root — without it the stale mini-geometry insets
        // survive and the transcript overlaps the title.
        XCTAssertTrue(window.contentView === hosting)
        XCTAssertGreaterThan(hosting.layoutCallCount, layoutsBeforeRestore)
        XCTAssertEqual(hosting.safeAreaInsets.top, titlebarSafeArea)
    }

    func testHighlightPanelDoesNotResurfaceAfterStopDrainsPendingTicks() {
        // Regression: a 30 Hz timer tick used to hop via `Task { @MainActor in
        // positionHighlight }` unconditionally. stopHighlight() could then run
        // (timer killed, panel ordered out) while a tick was already enqueued;
        // that tick's later orderFrontRegardless() left the cyan frame frozen
        // until quit. Generation fence + same-turn clear must keep it gone
        // after any drained pending main-queue work.
        let coordinator = ComputerCoordinator(computerUseEnabledProvider: { true })
        let controller = ComputerUseWindowPresentation()

        // On-screen target so targetBounds succeeds and positionHighlight can
        // actually orderFront the border (off-screen windows are filtered out).
        let screen = NSScreen.screens.first!.frame
        let target = NSPanel(
            contentRect: NSRect(
                x: screen.midX - 40,
                y: screen.midY - 40,
                width: 80,
                height: 80
            ),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        target.isOpaque = false
        target.backgroundColor = .clear
        target.alphaValue = 0.01
        target.ignoresMouseEvents = true
        target.orderFrontRegardless()
        defer { target.orderOut(nil) }

        let pid = ProcessInfo.processInfo.processIdentifier
        coordinator.activeApplication = ComputerApplicationIdentity(
            bundleID: "com.leehow.pipiui.tests",
            name: "HighlightFenceTest",
            processID: pid,
            windowTitle: nil
        )
        coordinator.isDesktopOperationActive = true
        controller.update(for: coordinator)

        let panel = controller.highlightPanel
        XCTAssertNotNil(panel, "active desktop op must create the highlight panel")
        // Allow the first placement (+ any immediate runloop work) to run.
        RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.05))
        XCTAssertTrue(
            panel?.isVisible == true,
            "highlight must be showing while the desktop operation is active"
        )

        // End the operation the same way production clearLeasePresentation does:
        // flip the flag then update — stopHighlight bumps the generation fence
        // and orders the panel out.
        coordinator.isDesktopOperationActive = false
        controller.update(for: coordinator)
        XCTAssertFalse(panel?.isVisible ?? true, "stop must hide the highlight immediately")

        // Drain pending main-queue / runloop work long enough for several 30 Hz
        // ticks and any stale Task hops to execute if they were enqueued.
        let drainUntil = Date(timeIntervalSinceNow: 0.2)
        while Date() < drainUntil {
            RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.01))
        }

        XCTAssertFalse(
            panel?.isVisible ?? true,
            "drained late ticks must not orderFront the highlight after stop"
        )
        XCTAssertEqual(controller.highlightPanel?.isVisible, false)
    }

    func testUnattachedPresentationLeavesStrayVisibleWindowAlone() {
        // A host process (the XCTest target) never attaches a PipiUI main
        // window to the presentation. The old presentMiniWindow() fallback
        // grabbed `NSApp.windows.first(where: { $0.isVisible })` and reshaped
        // whichever stray window it found into the mini progress chrome,
        // then orderFrontRegardless()'d it — stranding an unrelated window
        // (a test fixture, a leftover panel) on screen. The fix requires an
        // explicit attachment, so an unattached presentation must be a no-op
        // even when a visible window is available to grab.
        let coordinator = ComputerCoordinator(computerUseEnabledProvider: { true })
        let controller = ComputerUseWindowPresentation()
        // Deliberately do NOT attach: no mainWindow is realized.

        let decoy = NonOrderingTestWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1000, height: 700),
            styleMask: [.titled, .resizable],
            backing: .buffered,
            defer: false
        )
        decoy.reportsVisible = true
        // The decoy is the only window AppKit considers visible, so the old
        // fallback could not have picked a different victim. This makes the
        // regression deterministic rather than dependent on harness state.
        XCTAssertEqual(NSApp.windows.filter { $0.isVisible }, [decoy])

        let originalContentView = decoy.contentView
        let originalFrame = decoy.frame
        let originalLevel = decoy.level
        let originalStyleMask = decoy.styleMask

        coordinator.isDesktopOperationActive = true
        coordinator.statusMessage = "正在操作 测试应用…"
        controller.update(for: coordinator)

        // Nothing was claimed: no mini content swap, no resize, no restyle,
        // and no fronting path reached.
        XCTAssertEqual(decoy.contentView, originalContentView)
        XCTAssertEqual(decoy.frame, originalFrame)
        XCTAssertEqual(decoy.level, originalLevel)
        XCTAssertEqual(decoy.styleMask, originalStyleMask)
        XCTAssertEqual(decoy.orderFrontRegardlessCallCount, 0)
        XCTAssertEqual(decoy.orderFrontCallCount, 0)
    }
}

/// Test-only `NSWindow` substitute that neutralizes AppKit's window-fronting
/// entry points. It records invocations instead of ordering the window front,
/// so tests can prove the production fronting code path ran without ever
/// putting the fixture on the real desktop.
private final class NonOrderingTestWindow: NSWindow {
    /// When true, AppKit's `isVisible` reports the window as on screen even
    /// though no fronting call ran. Simulates a stray visible window — the
    /// kind the old `NSApp.windows` fallback grabbed — without putting a real
    /// window on the desktop. Defaults to false so existing fixtures that
    /// assert `isVisible == false` are unaffected.
    var reportsVisible = false
    override var isVisible: Bool { reportsVisible }

    var orderFrontRegardlessCallCount = 0
    var orderFrontCallCount = 0

    override func orderFrontRegardless() {
        orderFrontRegardlessCallCount += 1
    }

    override func orderFront(_ sender: Any?) {
        orderFrontCallCount += 1
    }
}

/// `NSHostingView` that counts `layout()` invocations so a test can prove a
/// forced layout pass ran as part of the presentation restore.
private final class LayoutCountingHostingView: NSHostingView<Text> {
    var layoutCallCount = 0
    override func layout() {
        layoutCallCount += 1
        super.layout()
    }
}
