import XCTest
import AppKit
@testable import PipiUI

final class ComputerHostSelfProtectionTests: XCTestCase {
    private let hostPID: Int32 = 4242
    private let hostBundle = CuaDriverProcessRuntime.hostBundleID

    private var protection: ComputerHostSelfProtection {
        ComputerHostSelfProtection(processID: hostPID)
    }

    func testHostBundleAndPIDAreBothIndependentFailClosedMatches() {
        XCTAssertTrue(protection.match(
            processID: 99,
            bundleID: hostBundle
        ).isHost)
        XCTAssertTrue(protection.match(
            processID: hostPID,
            bundleID: "com.example.Editor"
        ).isHost)
        XCTAssertFalse(protection.match(
            processID: 99,
            bundleID: "com.example.Editor"
        ).isHost)
        XCTAssertTrue(protection.matches(windowOwnerPID: hostPID))
        XCTAssertFalse(protection.matches(windowOwnerPID: 99))
    }

    func testCuaValidatorCannotBeConfiguredToAcceptHostTarget() {
        let coordinator = ComputerCoordinator(
            supportsInputMonitoring: false,
            computerUseEnabledProvider: { true },
            cuaDriver: NoopDriver(),
            hostSelfProtection: protection,
            cuaTargetValidator: { _ in true }
        )
        XCTAssertFalse(coordinator.cuaTargetValidator(target(
            processID: hostPID,
            bundleID: "com.example.Editor"
        )))
        XCTAssertFalse(coordinator.cuaTargetValidator(target(
            processID: 99,
            bundleID: hostBundle
        )))
        XCTAssertTrue(coordinator.cuaTargetValidator(target(
            processID: 99,
            bundleID: "com.example.Editor"
        )))
    }

    @MainActor
    func testCuaOpenApplicationRejectsHostBundleBeforeDriverLaunch() async {
        let driver = NoopDriver()
        let coordinator = ComputerCoordinator(
            supportsInputMonitoring: false,
            computerUseEnabledProvider: { true },
            cuaDriver: driver,
            hostSelfProtection: protection,
            cuaTargetValidator: { _ in true }
        )
        let response = await withCheckedContinuation { continuation in
            coordinator.handleOpenApplication(
                request: J([
                    "requestID": UUID().uuidString,
                    "bundle_identifier": hostBundle,
                ]),
                sessionKey: "test"
            ) { continuation.resume(returning: $0) }
        }
        XCTAssertEqual(
            response["errorCode"] as? String,
            ComputerHostSelfProtectionError.code
        )
        XCTAssertEqual(driver.callCount, 0)
    }

    @MainActor
    func testCuaReconcileAndNativeInputFailClosedBeforeDriverDispatch() async throws {
        let host = ComputerApplicationIdentity(
            bundleID: hostBundle,
            name: "PipiUI",
            processID: hostPID,
            windowTitle: nil
        )
        for action in [
            ["type": "key", "keys": ["CMD", "Q"]],
            ["type": "key", "keys": ["CMD", "W"]],
            ["type": "left_click", "x": 10, "y": 10],
            ["type": "type", "text": "redacted"],
        ] as [[String: Any]] {
            let driver = RecordingDriver(pngBase64: try png())
            let coordinator = makeCuaCoordinator(
                driver: driver,
                frontmost: { host }
            )
            coordinator.cuaSessionTargets["test"] = target(
                processID: 99,
                bundleID: "com.example.Editor"
            )
            let response = await batch(coordinator, actions: [action])
            XCTAssertEqual(
                response["errorCode"] as? String,
                ComputerHostSelfProtectionError.code
            )
            XCTAssertFalse(driver.tools.contains { tool in
                ["click", "drag", "press_key", "hotkey", "type_text", "scroll"]
                    .contains(tool)
            })
        }

        let driver = RecordingDriver(pngBase64: try png())
        let coordinator = makeCuaCoordinator(
            driver: driver,
            frontmost: { host }
        )
        coordinator.cuaSessionTargets["test"] = target(
            processID: hostPID,
            bundleID: "com.example.Editor"
        )
        let response = await batch(coordinator, actions: [["type": "screenshot"]])
        XCTAssertEqual(
            response["errorCode"] as? String,
            ComputerHostSelfProtectionError.code
        )
        XCTAssertNil(coordinator.cuaSessionTargets["test"])
    }

    @MainActor
    func testCuaOrdinaryTargetStillAllowsCommandQAndCommandW() async throws {
        let ordinary = ComputerApplicationIdentity(
            bundleID: "com.example.Editor",
            name: "Editor",
            processID: 99,
            windowTitle: nil
        )
        for key in ["Q", "W"] {
            let driver = RecordingDriver(pngBase64: try png())
            let coordinator = makeCuaCoordinator(
                driver: driver,
                frontmost: { ordinary }
            )
            coordinator.cuaSessionTargets["test"] = target(
                processID: ordinary.processID,
                bundleID: ordinary.bundleID
            )
            let response = await batch(coordinator, actions: [[
                "type": "key", "keys": ["CMD", key],
            ]])
            XCTAssertEqual(response["ok"] as? Bool, true)
            XCTAssertTrue(driver.tools.contains("hotkey"))
        }
    }

    func testLegacyFinalPostGateRejectsHostTargetOrForeground() {
        let ordinary = ComputerApplicationIdentity(
            bundleID: "com.example.Editor",
            name: "Editor",
            processID: 99,
            windowTitle: nil
        )
        let host = ComputerApplicationIdentity(
            bundleID: hostBundle,
            name: "PipiUI",
            processID: hostPID,
            windowTitle: nil
        )
        let protection = protection
        let authorize: @Sendable (
            ComputerApplicationIdentity,
            ComputerApplicationIdentity
        ) throws -> Void = { target, foreground in
            guard !protection.match(target).isHost,
                  !protection.match(foreground).isHost else {
                throw ComputerHostSelfProtectionError.hostTarget
            }
        }
        let hostTargetGate = ComputerLivePostGate(
            executionGate: ComputerExecutionGate(),
            targetApplication: host,
            frontmostApplicationProvider: { host },
            authorizeHost: authorize
        )
        XCTAssertThrowsError(try hostTargetGate.poll()) {
            XCTAssertEqual($0 as? ComputerHostSelfProtectionError, .hostTarget)
        }
        let hostForegroundGate = ComputerLivePostGate(
            executionGate: ComputerExecutionGate(),
            targetApplication: ordinary,
            frontmostApplicationProvider: { host },
            authorizeHost: authorize
        )
        XCTAssertThrowsError(try hostForegroundGate.poll())
        let ordinaryGate = ComputerLivePostGate(
            executionGate: ComputerExecutionGate(),
            targetApplication: ordinary,
            frontmostApplicationProvider: { ordinary },
            authorizeHost: authorize
        )
        XCTAssertNoThrow(try ordinaryGate.poll())
    }

    @MainActor
    private func makeCuaCoordinator(
        driver: RecordingDriver,
        frontmost: @escaping @Sendable () -> ComputerApplicationIdentity?
    ) -> ComputerCoordinator {
        ComputerCoordinator(
            supportsInputMonitoring: false,
            frontmostApplicationProvider: frontmost,
            openApplicationPermissionProvider: {
                ComputerPermissionSnapshot(
                    screenRecording: true,
                    accessibility: true
                )
            },
            openApplicationDescriptorProvider: { self.descriptor },
            computerUseEnabledProvider: { true },
            cuaDriver: driver,
            hostSelfProtection: protection,
            cuaTargetValidator: { _ in true }
        )
    }

    @MainActor
    private func batch(
        _ coordinator: ComputerCoordinator,
        actions: [[String: Any]]
    ) async -> [String: Any] {
        await withCheckedContinuation { continuation in
            coordinator.handle(
                request: J([
                    "requestID": UUID().uuidString,
                    "displayID": Int(descriptor.displayID),
                    "displayWidth": descriptor.outputSize.width,
                    "displayHeight": descriptor.outputSize.height,
                    "actions": actions,
                ]),
                sessionKey: "test"
            ) { continuation.resume(returning: $0) }
        }
    }

    private var descriptor: ComputerCaptureDescriptor {
        ComputerCaptureDescriptor(
            displayID: 7,
            outputSize: .init(width: 100, height: 100),
            globalBounds: .init(x: 0, y: 0, width: 100, height: 100)
        )
    }

    private func target(processID: Int32, bundleID: String) -> CuaComputerTarget {
        CuaComputerTarget(
            id: UUID(),
            bundleID: bundleID,
            name: "Target",
            processID: processID,
            windowIDs: [1],
            primaryWindowID: 1,
            revision: 0,
            screenshotIdentity: "test",
            elementTokens: [:],
            transform: try! CuaScreenshotTransform(
                sourceSize: .init(width: 100, height: 100),
                advertisedSize: .init(width: 100, height: 100)
            )
        )
    }

    private func png() throws -> String {
        guard let bitmap = NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: 1,
            pixelsHigh: 1,
            bitsPerSample: 8,
            samplesPerPixel: 4,
            hasAlpha: true,
            isPlanar: false,
            colorSpaceName: .deviceRGB,
            bytesPerRow: 0,
            bitsPerPixel: 0
        ), let data = bitmap.representation(using: .png, properties: [:]) else {
            throw CuaIntegrationError.invalidScreenshotData
        }
        return data.base64EncodedString()
    }

    private final class RecordingDriver: CuaDriverTransport, @unchecked Sendable {
        private let lock = NSLock()
        private let pngBase64: String
        private var recordedTools: [String] = []

        init(pngBase64: String) {
            self.pngBase64 = pngBase64
        }

        var tools: [String] { lock.withLock { recordedTools } }

        func call(tool: String, arguments: [String: Any]) async throws -> CuaToolResult {
            lock.withLock { recordedTools.append(tool) }
            switch tool {
            case "list_windows":
                let pid = (arguments["pid"] as? NSNumber)?.int32Value ?? 0
                return CuaToolResult(structuredContent: ["windows": [[
                    "window_id": 1,
                    "pid": pid,
                    "app_name": "Editor",
                    "title": "Document",
                ]]])
            case "get_window_state":
                return CuaToolResult(
                    content: [[
                        "type": "image", "data": pngBase64,
                        "mimeType": "image/png",
                    ]],
                    structuredContent: [
                        "screenshot_width": 100,
                        "screenshot_height": 100,
                        "snapshot_id": "snapshot",
                    ]
                )
            case "hotkey", "press_key", "click", "drag", "type_text", "scroll":
                return CuaToolResult(structuredContent: ["ok": true])
            default:
                throw CuaDriverError.toolFailure(tool: tool, message: "unexpected")
            }
        }

        func cancelAndStop() {}
    }

    private final class NoopDriver: CuaDriverTransport, @unchecked Sendable {
        private let lock = NSLock()
        private var calls = 0

        var callCount: Int { lock.withLock { calls } }

        func call(tool: String, arguments: [String: Any]) async throws -> CuaToolResult {
            lock.withLock { calls += 1 }
            throw CuaDriverError.toolFailure(tool: tool, message: "unexpected")
        }

        func cancelAndStop() {}
    }
}
