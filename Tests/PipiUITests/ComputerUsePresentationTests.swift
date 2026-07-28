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
        let window = NSWindow(
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
    }
}
