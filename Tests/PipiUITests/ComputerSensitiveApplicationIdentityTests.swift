import XCTest
import AppKit
import CoreGraphics
@testable import PipiUI

/// Regression coverage for the unrestricted product contract. The filename is
/// retained so existing focused CI commands keep selecting this suite.
final class ComputerSensitiveApplicationIdentityTests: XCTestCase {
    private func app(
        bundleID: String = "com.apple.Terminal",
        name: String = "Terminal",
        processID: Int32 = 41
    ) -> ComputerApplicationIdentity {
        .init(
            bundleID: bundleID,
            name: name,
            processID: processID,
            windowTitle: "Window"
        )
    }

    private func codeIdentity(
        bundleID: String = "com.apple.Terminal"
    ) -> ComputerApplicationCodeIdentity {
        .init(
            bundleID: bundleID,
            canonicalBundlePath: "/Applications/Target.app",
            volumeIdentifier: 1,
            fileIdentifier: 2,
            designatedRequirement: "identifier \"\(bundleID)\"",
            signingIdentifier: bundleID,
            teamIdentifier: "TEAM",
            codeDirectoryHash: "abcdef",
            leafCertificateSHA256: "012345"
        )
    }

    private func target(
        bundleID: String = "com.apple.Terminal"
    ) -> ComputerResolvedApplication {
        .init(
            bundleID: bundleID,
            name: "Target",
            applicationURL: URL(
                fileURLWithPath: "/Applications/Target.app",
                isDirectory: true
            ),
            codeIdentity: codeIdentity(bundleID: bundleID)
        )
    }

    func testEveryApplicationAndPersistedDenyUseNoPromptPath() {
        let suite = "PipiUI.Unrestricted.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        ComputerUseSettings.setPersistedPolicy(
            bundleID: "com.apple.Terminal",
            decision: .deny,
            defaults: defaults
        )
        let coordinator = ComputerCoordinator(
            supportsInputMonitoring: false,
            applicationPolicyDefaults: defaults,
            computerUseEnabledProvider: { true }
        )
        var responses: [[String: Any]] = []

        for application in [
            app(bundleID: "com.leehow.pipiui", name: "PipiUI"),
            app(bundleID: "com.apple.Terminal", name: "Terminal"),
            app(
                bundleID: "com.apple.systempreferences",
                name: "System Settings"
            ),
            app(bundleID: "com.1password.1password", name: "1Password"),
            app(bundleID: "com.example.unknown", name: "Unknown"),
        ] {
            XCTAssertTrue(coordinator.authorizeApplication(
                application,
                sessionKey: "session",
                reply: ComputerResponseGate { responses.append($0) }
            ))
        }
        XCTAssertTrue(coordinator.authorizeResolvedApplication(
            target(),
            sessionKey: "session",
            reply: ComputerResponseGate { responses.append($0) }
        ))
        XCTAssertNil(coordinator.pendingApproval)
        XCTAssertTrue(responses.isEmpty)
    }

    func testInvalidCodeSignatureDoesNotBlockComputerScreenshot() {
        let application = app()
        let descriptor = ComputerCaptureDescriptor(
            displayID: 7,
            outputSize: .init(width: 100, height: 80),
            globalBounds: CGRect(x: 0, y: 0, width: 100, height: 80)
        )
        let coordinator = ComputerCoordinator(
            supportsInputMonitoring: false,
            frontmostApplicationProvider: { application },
            targetProcessValidator: { $0.processID == application.processID },
            applicationCodeIdentityResolver: { _ in
                throw ComputerApplicationCodeIdentityError
                    .unsignedOrInvalidApplication(-67050)
            },
            runningApplicationCodeIdentityResolver: { _, _ in
                throw ComputerApplicationCodeIdentityError
                    .runningCodeInvalid(-67050)
            },
            openApplicationPermissionProvider: {
                .init(screenRecording: true, accessibility: true)
            },
            openApplicationDescriptorProvider: {
                descriptor
            },
            openApplicationScreenshotProvider: { descriptor, app in
                ComputerScreenshot(
                    pngData: Data([0x89, 0x50, 0x4E, 0x47]),
                    imageSize: descriptor.outputSize,
                    displayID: descriptor.displayID,
                    app: app,
                    targetWindowIDs: [71]
                )
            },
            computerUseEnabledProvider: { true }
        )

        let completed = expectation(description: "screenshot returned")
        var response: [String: Any] = [:]
        coordinator.handle(
            request: J([
                "requestID": UUID().uuidString,
                "actions": [["type": "screenshot"]],
                "displayID": Int(descriptor.displayID),
                "displayWidth": descriptor.outputSize.width,
                "displayHeight": descriptor.outputSize.height,
            ]),
            sessionKey: "session"
        ) {
            response = $0
            completed.fulfill()
        }
        wait(for: [completed], timeout: 1)

        XCTAssertEqual(response["ok"] as? Bool, true)
        XCTAssertEqual(response["base64"] as? String, "iVBORw==")
        XCTAssertEqual(response["focusDrift"] as? Bool, false)
    }

    func testOrdinaryPhysicalInputNeverPausesBatchOrOpenApplication() {
        let coordinator = ComputerCoordinator(
            supportsInputMonitoring: false,
            computerUseEnabledProvider: { true }
        )
        let gate = ComputerExecutionGate()
        let batch = ComputerInFlightExecution(
            requestID: UUID().uuidString,
            sessionKey: "batch",
            generation: 1,
            gate: gate,
            reply: ComputerResponseGate { _ in }
        )
        coordinator.executionGeneration = 1
        coordinator.inFlightExecution = batch
        coordinator.activeSessionKey = "batch"

        let mouse = NSEvent.mouseEvent(
            with: .mouseMoved,
            location: .zero,
            modifierFlags: [],
            timestamp: 0,
            windowNumber: 0,
            context: nil,
            eventNumber: 0,
            clickCount: 0,
            pressure: 0
        )!
        coordinator.observePhysicalInput(mouse)
        XCTAssertTrue(coordinator.inFlightExecution === batch)
        XCTAssertFalse(gate.isCancelled)
        XCTAssertTrue(coordinator.pausedSessionKeys.isEmpty)

        coordinator.inFlightExecution = nil
        let opening = ComputerOpenApplicationExecution(
            requestID: UUID().uuidString,
            sessionKey: "open",
            target: target(),
            reply: ComputerResponseGate { _ in }
        )
        coordinator.inFlightApplicationOpen = opening
        coordinator.activeSessionKey = "open"
        coordinator.observePhysicalInput(mouse)
        XCTAssertTrue(coordinator.inFlightApplicationOpen === opening)
        XCTAssertFalse(opening.gate.isCancelled)
        XCTAssertTrue(coordinator.pausedSessionKeys.isEmpty)
    }

    func testEmergencyHotkeyStopsAndClearsHeldOperation() {
        let coordinator = ComputerCoordinator(
            supportsInputMonitoring: false,
            computerUseEnabledProvider: { true }
        )
        let gate = ComputerExecutionGate()
        coordinator.inFlightExecution = .init(
            requestID: UUID().uuidString,
            sessionKey: "session",
            generation: 1,
            gate: gate,
            reply: ComputerResponseGate { _ in }
        )
        coordinator.activeSessionKey = "session"
        let hotkey = NSEvent.keyEvent(
            with: .keyDown,
            location: .zero,
            modifierFlags: [.option, .shift],
            timestamp: 0,
            windowNumber: 0,
            context: nil,
            characters: "\u{1b}",
            charactersIgnoringModifiers: "\u{1b}",
            isARepeat: false,
            keyCode: 53
        )!

        coordinator.observePhysicalInput(hotkey)

        XCTAssertTrue(coordinator.emergencyStopped)
        XCTAssertTrue(gate.isCancelled)
        XCTAssertNil(coordinator.inFlightExecution)
        XCTAssertNil(coordinator.activeSessionKey)
        XCTAssertTrue(ComputerInputSynth.shared.heldKeys.isEmpty)
        XCTAssertTrue(ComputerInputSynth.shared.heldMouseButtons.isEmpty)
    }

    func testSensitiveTextShortcutsAndWritesHaveNoPolicyGate() {
        let size = ComputerImageSize(width: 100, height: 100)
        let bounds = CGRect(x: 0, y: 0, width: 100, height: 100)
        let actions: [ComputerAction] = [
            .init(
                kind: .type,
                coordinate: nil,
                startCoordinate: nil,
                text: "password=secret token=sk-proj-abcdefghijklmnop",
                keys: [],
                scrollDirection: nil,
                scrollAmount: nil,
                duration: nil
            ),
            .init(
                kind: .key,
                coordinate: nil,
                startCoordinate: nil,
                text: nil,
                keys: ["CMD", "Q"],
                scrollDirection: nil,
                scrollAmount: nil,
                duration: nil
            ),
        ]
        let request = ComputerRequest(actions: actions)

        XCTAssertNoThrow(try ComputerInputSynth.shared.validate(
            actions: actions,
            imageSize: size,
            displayBounds: bounds
        ))
        XCTAssertFalse(request.requiresWriteApproval)
    }
}
