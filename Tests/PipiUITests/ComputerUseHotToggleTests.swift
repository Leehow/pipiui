import XCTest
@testable import PipiUI

/// Hot-swap contract: toggling Computer Use must never restart sessions,
/// shutdown/replace a ChatSession, or abort a session turn. The red 急停 button
/// keeps its original forced semantics through `emergencyStop()`.
final class ComputerUseHotToggleTests: XCTestCase {

    // MARK: - ComputerUseTogglePolicy (exact AppStore decision path)

    private final class ToggleProbe {
        var persisted: Bool?
        var published: [Bool] = []
        var enableCalls = 0
        var disableCalls = 0
    }

    private func makePolicy(
        persisted: Bool,
        emergencyStopped: Bool,
        published: Bool
    ) -> (ComputerUseTogglePolicy, ToggleProbe) {
        let probe = ToggleProbe()
        let policy = ComputerUseTogglePolicy(
            isEnabled: { persisted },
            isEmergencyStopped: { emergencyStopped },
            currentPublished: { published },
            persist: { probe.persisted = $0 },
            publish: { probe.published.append($0) },
            onEnable: { probe.enableCalls += 1 },
            onDisable: { probe.disableCalls += 1 }
        )
        return (policy, probe)
    }

    func testEnablePersistsPublishesAndReArmsWithoutRestartOrAbort() {
        let (policy, probe) = makePolicy(
            persisted: false,
            emergencyStopped: false,
            published: false
        )
        policy.set(true)
        XCTAssertEqual(probe.persisted, true)
        XCTAssertEqual(probe.published, [true])
        XCTAssertEqual(probe.enableCalls, 1)
        XCTAssertEqual(probe.disableCalls, 0)
    }

    func testDisablePersistsPublishesAndRunsDesktopScopedCancelOnly() {
        let (policy, probe) = makePolicy(
            persisted: true,
            emergencyStopped: false,
            published: true
        )
        policy.set(false)
        XCTAssertEqual(probe.persisted, false)
        XCTAssertEqual(probe.published, [false])
        XCTAssertEqual(probe.disableCalls, 1)
        XCTAssertEqual(probe.enableCalls, 0)
    }

    func testReEnableAfterEmergencyStopReArmsWithoutPersisting() {
        let (policy, probe) = makePolicy(
            persisted: true,
            emergencyStopped: true,
            published: true
        )
        policy.set(true)
        XCTAssertNil(probe.persisted)
        XCTAssertEqual(probe.published, [true])
        XCTAssertEqual(probe.enableCalls, 1)
        XCTAssertEqual(probe.disableCalls, 0)
    }

    func testIdempotentToggleIsACompleteNoOp() {
        let (policy, probe) = makePolicy(
            persisted: true,
            emergencyStopped: false,
            published: true
        )
        policy.set(true)
        XCTAssertNil(probe.persisted)
        XCTAssertTrue(probe.published.isEmpty)
        XCTAssertEqual(probe.enableCalls, 0)
        XCTAssertEqual(probe.disableCalls, 0)
    }

    func testRepairPublishesPersistedStateWithoutAnySideEffect() {
        let (policy, probe) = makePolicy(
            persisted: true,
            emergencyStopped: false,
            published: false
        )
        policy.set(true)
        XCTAssertEqual(probe.published, [true])
        XCTAssertNil(probe.persisted)
        XCTAssertEqual(probe.enableCalls, 0)
        XCTAssertEqual(probe.disableCalls, 0)
    }

    // MARK: - Desktop-scoped settings-off cancel vs emergency stop

    func testSettingsOffCancelsAllDesktopWorkWithoutEmergencyCallback() throws {
        let coordinator = ComputerCoordinator(
            supportsInputMonitoring: false,
            openApplicationAuditSink: { _ in }
        )
        coordinator.sessionConsents = ["consented"]
        coordinator.pausedSessionKeys = ["paused"]
        coordinator.pendingApproval = .init(sessionKey: "pending", kind: .session)
        let write = makeWriteApproval(
            requestID: UUID().uuidString,
            sessionKey: "pending-write"
        )
        var writeDenied = false
        coordinator.pendingWriteApproval = write
        coordinator.pendingWriteContinuation = .init(
            approvalID: write.id,
            requestID: write.requestID,
            sessionKey: write.sessionKey,
            fingerprint: write.fingerprint,
            targetApplication: write.targetApplication,
            validateContext: {},
            approve: {},
            deny: { _ in writeDenied = true }
        )
        coordinator.leaseController = ComputerLeaseController()
        _ = try coordinator.leaseController.acquire(
            sessionKey: "active",
            targetBundleID: "com.example.editor",
            actionCount: 1,
            now: Date()
        )
        coordinator.activeSessionKey = "active"
        let gate = ComputerExecutionGate()
        var legacyReply: [String: Any] = [:]
        coordinator.inFlightExecution = .init(
            requestID: UUID().uuidString,
            sessionKey: "active",
            generation: 1,
            gate: gate,
            reply: ComputerResponseGate { legacyReply = $0 }
        )
        var cuaReply: [String: Any] = [:]
        coordinator.cuaInFlightOperation = .init(
            requestID: UUID().uuidString,
            sessionKey: "cua",
            reply: ComputerResponseGate { cuaReply = $0 }
        )
        var openReply: [String: Any] = [:]
        coordinator.inFlightApplicationOpen = .init(
            requestID: UUID().uuidString,
            sessionKey: "opening",
            target: resolvedApplication(),
            reply: ComputerResponseGate { openReply = $0 }
        )
        var emergencyCallbackCalls: [String] = []
        coordinator.configure { emergencyCallbackCalls.append($0) }

        coordinator.cancelAllDesktopOperations()

        // Desktop scoped: everything in flight is cancelled and released…
        XCTAssertNil(coordinator.inFlightExecution)
        XCTAssertNil(coordinator.cuaInFlightOperation)
        XCTAssertNil(coordinator.inFlightApplicationOpen)
        XCTAssertNil(coordinator.pendingApproval)
        XCTAssertNil(coordinator.pendingWriteApproval)
        XCTAssertNil(coordinator.pendingWriteContinuation)
        XCTAssertNil(coordinator.leaseController.lease)
        XCTAssertTrue(coordinator.sessionConsents.isEmpty)
        XCTAssertTrue(coordinator.pausedSessionKeys.isEmpty)
        XCTAssertTrue(gate.isCancelled)
        XCTAssertTrue(writeDenied)
        XCTAssertFalse(legacyReply.isEmpty)
        XCTAssertFalse(cuaReply.isEmpty)
        XCTAssertFalse(openReply.isEmpty)
        XCTAssertTrue(ComputerInputSynth.shared.heldKeys.isEmpty)
        XCTAssertTrue(ComputerInputSynth.shared.heldMouseButtons.isEmpty)
        // …but the emergency latch and session-abort callback are untouched.
        XCTAssertTrue(emergencyCallbackCalls.isEmpty)
        XCTAssertFalse(coordinator.emergencyStopped)
    }

    func testEmergencyStopKeepsForcedAbortSemantics() throws {
        let coordinator = ComputerCoordinator(
            supportsInputMonitoring: false,
            openApplicationAuditSink: { _ in }
        )
        coordinator.sessionConsents = ["consented"]
        coordinator.pausedSessionKeys = ["paused"]
        coordinator.leaseController = ComputerLeaseController()
        _ = try coordinator.leaseController.acquire(
            sessionKey: "active",
            targetBundleID: "com.example.editor",
            actionCount: 1,
            now: Date()
        )
        coordinator.activeSessionKey = "active"
        let gate = ComputerExecutionGate()
        coordinator.inFlightExecution = .init(
            requestID: UUID().uuidString,
            sessionKey: "active",
            generation: 1,
            gate: gate,
            reply: ComputerResponseGate { _ in }
        )
        var aborted: Set<String> = []
        coordinator.configure { aborted.insert($0) }

        coordinator.emergencyStop()

        XCTAssertEqual(aborted, ["consented", "paused", "active"])
        XCTAssertTrue(coordinator.emergencyStopped)
        XCTAssertTrue(gate.isCancelled)
        XCTAssertNil(coordinator.inFlightExecution)
        XCTAssertNil(coordinator.leaseController.lease)
        XCTAssertTrue(coordinator.sessionConsents.isEmpty)
    }

    // MARK: - Host guard rejects new desktop calls once off

    private final class MutableBool: @unchecked Sendable {
        private let lock = NSLock()
        private var value = true

        init(_ value: Bool = true) { self.value = value }

        var current: Bool {
            lock.withLock { value }
        }

        func set(_ newValue: Bool) {
            lock.withLock { value = newValue }
        }
    }

    func testSettingsOffRejectsNewDesktopCallsImmediately() {
        let enabled = MutableBool(true)
        let coordinator = ComputerCoordinator(
            supportsInputMonitoring: false,
            computerUseEnabledProvider: { enabled.current }
        )
        var response: [String: Any] = [:]
        XCTAssertTrue(coordinator.guardSessionAuthorization(
            sessionKey: "session",
            reply: ComputerResponseGate { response = $0 }
        ))
        XCTAssertTrue(response.isEmpty)
        XCTAssertTrue(coordinator.hasConsent(for: "session"))

        enabled.set(false)
        response = [:]
        XCTAssertFalse(coordinator.guardSessionAuthorization(
            sessionKey: "session",
            reply: ComputerResponseGate { response = $0 }
        ))
        XCTAssertTrue(
            (response["error"] as? String)?.contains("disabled globally") == true
        )
        XCTAssertFalse(coordinator.hasConsent(for: "session"))
        XCTAssertNil(coordinator.pendingApproval)

        enabled.set(true)
        XCTAssertTrue(coordinator.guardSessionAuthorization(
            sessionKey: "session",
            reply: ComputerResponseGate { _ in }
        ))
    }

    // MARK: - Built-in master switch is hot-swappable for already-mounted sessions

    func testBuiltInMasterOffRejectsAlreadyMountedSessionWithoutRestart() {
        let defaults = UserDefaults.standard
        let savedDisabled = defaults.array(
            forKey: BuiltInFeatureSettings.disabledKey
        ) as? [String]
        let savedEnabled = defaults.object(forKey: ComputerUseSettings.enabledKey)
        defer {
            if let savedDisabled {
                defaults.set(savedDisabled, forKey: BuiltInFeatureSettings.disabledKey)
            } else {
                defaults.removeObject(forKey: BuiltInFeatureSettings.disabledKey)
            }
            if let savedEnabled {
                defaults.set(savedEnabled, forKey: ComputerUseSettings.enabledKey)
            } else {
                defaults.removeObject(forKey: ComputerUseSettings.enabledKey)
            }
        }

        // Authorization on + master capability on: an already-mounted session is
        // admitted (this is what a session spawned while enabled looks like).
        ComputerUseSettings.setEnabled(true)
        BuiltInFeatureSettings.setEnabled(true, id: .computerUse)
        // Production default provider: reads both switches live.
        let coordinator = ComputerCoordinator(supportsInputMonitoring: false)
        var response: [String: Any] = [:]
        XCTAssertTrue(coordinator.guardSessionAuthorization(
            sessionKey: "existing",
            reply: ComputerResponseGate { response = $0 }
        ))
        XCTAssertTrue(response.isEmpty)

        // Master off: the same session is rejected immediately, no restart.
        BuiltInFeatureSettings.setEnabled(false, id: .computerUse)
        response = [:]
        XCTAssertFalse(coordinator.guardSessionAuthorization(
            sessionKey: "existing",
            reply: ComputerResponseGate { response = $0 }
        ))
        XCTAssertTrue(
            (response["error"] as? String)?.contains("disabled globally") == true
        )
        XCTAssertFalse(coordinator.hasConsent(for: "existing"))

        // Master back on: the still-alive session is admitted again without any
        // new session/restart being involved.
        BuiltInFeatureSettings.setEnabled(true, id: .computerUse)
        XCTAssertTrue(coordinator.guardSessionAuthorization(
            sessionKey: "existing",
            reply: ComputerResponseGate { _ in }
        ))
    }

    // MARK: - Helpers

    private func resolvedApplication() -> ComputerResolvedApplication {
        ComputerResolvedApplication(
            bundleID: "com.example.editor",
            name: "Editor",
            applicationURL: URL(fileURLWithPath: "/Applications/Editor.app"),
            codeIdentity: .init(
                bundleID: "com.example.editor",
                canonicalBundlePath: "/Applications/Editor.app",
                volumeIdentifier: 1,
                fileIdentifier: 42,
                designatedRequirement: "identifier \"com.example.editor\"",
                signingIdentifier: "com.example.editor",
                teamIdentifier: nil,
                codeDirectoryHash: "hash",
                leafCertificateSHA256: nil
            )
        )
    }

    private func makeWriteApproval(
        requestID: String,
        sessionKey: String
    ) -> ComputerCoordinator.PendingWriteApproval {
        .init(
            id: UUID(),
            requestID: requestID,
            sessionKey: sessionKey,
            fingerprint: "write",
            actionKinds: [.leftClick],
            targetApplication: .init(
                bundleID: "com.example.editor",
                name: "Editor",
                processID: 42,
                windowTitle: nil
            ),
            expiresAt: Date().addingTimeInterval(10),
            phase: .approvedAwaitingTargetRefocus
        )
    }
}
