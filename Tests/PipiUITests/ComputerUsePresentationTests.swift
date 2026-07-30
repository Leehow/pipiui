import XCTest
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
