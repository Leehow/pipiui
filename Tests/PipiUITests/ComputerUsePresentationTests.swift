import XCTest
import AppKit
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

    func testBatchEndKeepsPresentationDuringGraceWindow() {
        let coordinator = ComputerCoordinator(
            computerUseEnabledProvider: { true }, desktopPresentationGraceInterval: 45
        )
        coordinator.activeSessionKey = "session-a"
        coordinator.activeApplication = ComputerApplicationIdentity(
            bundleID: "com.example.app", name: "Example", processID: 42, windowTitle: nil
        )
        coordinator.activeWindowID = 7
        coordinator.isDesktopOperationActive = true

        coordinator.scheduleDesktopPresentationGrace(
            statusMessage: "桌面操作已完成，等待下一步…"
        )

        XCTAssertTrue(coordinator.isPresentingDesktopOperation)
        XCTAssertEqual(coordinator.activeSessionKey, "session-a")
        XCTAssertEqual(coordinator.activeWindowID, 7)
        XCTAssertEqual(coordinator.statusMessage, "桌面操作已完成，等待下一步…")
        XCTAssertNotNil(coordinator.presentationGraceWork)
    }

    func testPresentationGraceExpiryClearsPresentation() {
        let coordinator = ComputerCoordinator(
            computerUseEnabledProvider: { true }, desktopPresentationGraceInterval: 0
        )
        coordinator.activeSessionKey = "session-a"
        coordinator.activeApplication = ComputerApplicationIdentity(
            bundleID: "com.example.app", name: "Example", processID: 42, windowTitle: nil
        )
        coordinator.isDesktopOperationActive = true

        coordinator.scheduleDesktopPresentationGrace(
            statusMessage: "桌面操作已完成，等待下一步…"
        )

        XCTAssertFalse(coordinator.isPresentingDesktopOperation)
        XCTAssertNil(coordinator.activeSessionKey)
        XCTAssertNil(coordinator.activeApplication)
        XCTAssertNil(coordinator.presentationGraceWork)
    }

    func testEmergencyStopAndMasterToggleClearPresentationImmediately() {
        let emergencyCoordinator = ComputerCoordinator(
            computerUseEnabledProvider: { true }, desktopPresentationGraceInterval: 45
        )
        emergencyCoordinator.activeSessionKey = "session-a"
        emergencyCoordinator.isDesktopOperationActive = true
        emergencyCoordinator.scheduleDesktopPresentationGrace(statusMessage: "等待下一步…")
        emergencyCoordinator.emergencyStop()
        XCTAssertFalse(emergencyCoordinator.isPresentingDesktopOperation)
        XCTAssertNil(emergencyCoordinator.activeSessionKey)
        XCTAssertNil(emergencyCoordinator.presentationGraceWork)
        XCTAssertTrue(emergencyCoordinator.emergencyStopped)

        let toggleCoordinator = ComputerCoordinator(
            computerUseEnabledProvider: { true }, desktopPresentationGraceInterval: 45
        )
        toggleCoordinator.activeSessionKey = "session-a"
        toggleCoordinator.isDesktopOperationActive = true
        toggleCoordinator.scheduleDesktopPresentationGrace(statusMessage: "等待下一步…")
        toggleCoordinator.cancelAllDesktopOperations()
        XCTAssertFalse(toggleCoordinator.isPresentingDesktopOperation)
        XCTAssertNil(toggleCoordinator.activeSessionKey)
        XCTAssertNil(toggleCoordinator.presentationGraceWork)
        XCTAssertFalse(toggleCoordinator.emergencyStopped)
    }

    func testPresentationNeverMutatesMainWindowAcrossPresentSessionChangeAndRestore() {
        let coordinator = ComputerCoordinator(computerUseEnabledProvider: { true })
        let controller = ComputerUseWindowPresentation()
        let content = NSView(frame: NSRect(x: 0, y: 0, width: 1000, height: 700))
        let window = NonOrderingTestWindow(
            contentRect: content.frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        let toolbar = NSToolbar(identifier: "ComputerUsePresentationTests")
        window.contentView = content
        window.toolbar = toolbar
        toolbar.isVisible = true
        window.contentMinSize = NSSize(width: 800, height: 560)
        window.titleVisibility = .visible
        window.titlebarAppearsTransparent = false
        controller.attach(to: window)

        let original = MainWindowState(window: window)
        coordinator.activeSessionKey = "session-a"
        coordinator.isDesktopOperationActive = true
        coordinator.statusMessage = "正在操作 TextEdit…"
        controller.update(for: coordinator)
        assertMainWindow(window, matches: original)

        // An old/new lease transition must not re-front, move, or reshape this window.
        coordinator.activeSessionKey = "session-b"
        controller.update(for: coordinator)
        assertMainWindow(window, matches: original)

        coordinator.isDesktopOperationActive = false
        controller.update(for: coordinator)
        controller.update(for: coordinator) // restore/clear is idempotent.
        assertMainWindow(window, matches: original)
        XCTAssertEqual(window.orderFrontRegardlessCallCount, 0)
        XCTAssertEqual(window.orderFrontCallCount, 0)
    }

    func testReplacingAttachedWindowDoesNotRestoreOrAlterOldLeaseWindow() {
        let coordinator = ComputerCoordinator(computerUseEnabledProvider: { true })
        let controller = ComputerUseWindowPresentation()
        let first = makeWindow()
        let second = makeWindow()
        let firstState = MainWindowState(window: first)
        let secondState = MainWindowState(window: second)

        controller.attach(to: first)
        coordinator.activeSessionKey = "session-a"
        coordinator.isDesktopOperationActive = true
        controller.update(for: coordinator)
        controller.attach(to: second)
        coordinator.activeSessionKey = "session-b"
        controller.update(for: coordinator)
        coordinator.clearLeasePresentation()
        controller.update(for: coordinator)

        assertMainWindow(first, matches: firstState)
        assertMainWindow(second, matches: secondState)
    }

    func testHighlightPanelDoesNotResurfaceAfterStopDrainsPendingTicks() {
        let coordinator = ComputerCoordinator(computerUseEnabledProvider: { true })
        let controller = ComputerUseWindowPresentation()
        let screen = NSScreen.screens.first!.frame
        let target = NSPanel(
            contentRect: NSRect(x: screen.midX - 40, y: screen.midY - 40, width: 80, height: 80),
            styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false
        )
        target.isOpaque = false
        target.backgroundColor = .clear
        target.alphaValue = 0.01
        target.ignoresMouseEvents = true
        target.orderFrontRegardless()
        defer { target.orderOut(nil) }

        coordinator.activeApplication = ComputerApplicationIdentity(
            bundleID: "com.leehow.pipiui.tests", name: "HighlightFenceTest",
            processID: ProcessInfo.processInfo.processIdentifier, windowTitle: nil
        )
        coordinator.isDesktopOperationActive = true
        controller.update(for: coordinator)
        let panel = controller.highlightPanel
        XCTAssertNotNil(panel)
        RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.05))
        XCTAssertTrue(panel?.isVisible == true)

        coordinator.isDesktopOperationActive = false
        controller.update(for: coordinator)
        XCTAssertFalse(panel?.isVisible ?? true)
        let drainUntil = Date(timeIntervalSinceNow: 0.2)
        while Date() < drainUntil {
            RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.01))
        }
        XCTAssertFalse(panel?.isVisible ?? true)
    }

    private func makeWindow() -> NonOrderingTestWindow {
        let window = NonOrderingTestWindow(
            contentRect: NSRect(x: 50, y: 50, width: 1000, height: 700),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.contentView = NSView(frame: NSRect(x: 0, y: 0, width: 1000, height: 700))
        window.toolbar = NSToolbar(identifier: UUID().uuidString)
        window.toolbar?.isVisible = true
        window.contentMinSize = NSSize(width: 800, height: 560)
        return window
    }

    private func assertMainWindow(_ window: NSWindow, matches expected: MainWindowState,
                                  file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(window.frame, expected.frame, file: file, line: line)
        XCTAssertEqual(window.contentMinSize, expected.contentMinSize, file: file, line: line)
        XCTAssertEqual(window.styleMask, expected.styleMask, file: file, line: line)
        XCTAssertEqual(window.titleVisibility, expected.titleVisibility, file: file, line: line)
        XCTAssertEqual(window.titlebarAppearsTransparent, expected.titlebarAppearsTransparent,
                       file: file, line: line)
        XCTAssertTrue(window.toolbar === expected.toolbar, file: file, line: line)
        XCTAssertEqual(window.toolbar?.isVisible, expected.toolbarIsVisible, file: file, line: line)
        XCTAssertTrue(window.contentView === expected.contentView, file: file, line: line)
    }
}

private struct MainWindowState {
    let frame: NSRect
    let contentMinSize: NSSize
    let styleMask: NSWindow.StyleMask
    let titleVisibility: NSWindow.TitleVisibility
    let titlebarAppearsTransparent: Bool
    let toolbar: NSToolbar?
    let toolbarIsVisible: Bool?
    let contentView: NSView?

    init(window: NSWindow) {
        frame = window.frame
        contentMinSize = window.contentMinSize
        styleMask = window.styleMask
        titleVisibility = window.titleVisibility
        titlebarAppearsTransparent = window.titlebarAppearsTransparent
        toolbar = window.toolbar
        toolbarIsVisible = window.toolbar?.isVisible
        contentView = window.contentView
    }
}

private final class NonOrderingTestWindow: NSWindow {
    var orderFrontRegardlessCallCount = 0
    var orderFrontCallCount = 0

    override func orderFrontRegardless() {
        orderFrontRegardlessCallCount += 1
    }

    override func orderFront(_ sender: Any?) {
        orderFrontCallCount += 1
    }
}
