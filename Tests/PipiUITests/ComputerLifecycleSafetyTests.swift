import XCTest
@testable import PipiUI

final class ComputerLifecycleSafetyTests: XCTestCase {
    func testGlobalToggleAuthorizesCurrentAndFutureTopLevelSessionsWithoutPrompt() {
        let coordinator = ComputerCoordinator(
            supportsInputMonitoring: false,
            computerUseEnabledProvider: { true }
        )
        var responses: [[String: Any]] = []

        XCTAssertTrue(coordinator.guardSessionAuthorization(
            sessionKey: "current",
            reply: ComputerResponseGate { responses.append($0) }
        ))
        XCTAssertTrue(coordinator.guardSessionAuthorization(
            sessionKey: "future",
            reply: ComputerResponseGate { responses.append($0) }
        ))

        XCTAssertEqual(coordinator.sessionConsents, ["current", "future"])
        XCTAssertNil(coordinator.pendingApproval)
        XCTAssertTrue(responses.isEmpty)
    }

    func testGlobalOffAndEmergencyStopBlockWithoutCreatingSessionApproval() {
        let disabled = ComputerCoordinator(
            supportsInputMonitoring: false,
            computerUseEnabledProvider: { false }
        )
        var disabledResponse: [String: Any] = [:]
        XCTAssertFalse(disabled.guardSessionAuthorization(
            sessionKey: "session",
            reply: ComputerResponseGate { disabledResponse = $0 }
        ))
        XCTAssertTrue(
            (disabledResponse["error"] as? String)?.contains(
                "disabled globally"
            ) == true
        )
        XCTAssertNil(disabled.pendingApproval)

        let stopped = ComputerCoordinator(
            supportsInputMonitoring: false,
            computerUseEnabledProvider: { true }
        )
        stopped.emergencyStop()
        var stoppedResponse: [String: Any] = [:]
        XCTAssertFalse(stopped.guardSessionAuthorization(
            sessionKey: "session",
            reply: ComputerResponseGate { stoppedResponse = $0 }
        ))
        XCTAssertTrue(
            (stoppedResponse["error"] as? String)?.contains(
                "emergency-stopped"
            ) == true
        )
        XCTAssertNil(stopped.pendingApproval)

        stopped.enableGlobalAuthorization()
        XCTAssertTrue(stopped.guardSessionAuthorization(
            sessionKey: "session",
            reply: ComputerResponseGate { _ in }
        ))
    }

    func testLegacySessionApprovalStateIsInert() {
        let coordinator = ComputerCoordinator(
            supportsInputMonitoring: false,
            computerUseEnabledProvider: { true }
        )
        let approval = ComputerCoordinator.PendingApproval(
            sessionKey: "session",
            kind: .session
        )
        coordinator.pendingApproval = approval
        coordinator.approvePendingSession(id: UUID(), sessionKey: "session")
        XCTAssertTrue(coordinator.hasConsent(for: "session"))
        coordinator.approvePendingSession(id: approval.id, sessionKey: "session")
        XCTAssertTrue(coordinator.hasConsent(for: "session"))
    }

    func testExactTransportCancellationReleasesGateLeaseAndInputState() throws {
        let coordinator = ComputerCoordinator(supportsInputMonitoring: false)
        coordinator.leaseController = ComputerLeaseController(
            leaseDuration: 100,
            actionBudget: 2
        )
        _ = try coordinator.leaseController.acquire(
            sessionKey: "active",
            targetBundleID: "com.example.editor",
            actionCount: 1,
            now: Date()
        )
        coordinator.activeSessionKey = "active"
        let gate = ComputerExecutionGate()
        let requestID = UUID().uuidString
        let execution = ComputerInFlightExecution(
            requestID: requestID,
            sessionKey: "active",
            generation: 1,
            gate: gate,
            reply: ComputerResponseGate { _ in }
        )
        coordinator.executionGeneration = 1
        coordinator.inFlightExecution = execution

        coordinator.cancelRequest(
            requestID: UUID().uuidString,
            sessionKey: "active"
        )
        XCTAssertTrue(coordinator.inFlightExecution === execution)
        XCTAssertFalse(gate.isCancelled)

        coordinator.cancelRequest(requestID: requestID, sessionKey: "active")
        XCTAssertNil(coordinator.inFlightExecution)
        XCTAssertNil(coordinator.leaseController.lease)
        XCTAssertNil(coordinator.activeSessionKey)
        XCTAssertTrue(gate.isCancelled)
        XCTAssertTrue(ComputerInputSynth.shared.heldKeys.isEmpty)
        XCTAssertTrue(ComputerInputSynth.shared.heldMouseButtons.isEmpty)
    }

    func testGlobalEmergencyStopsPendingActiveAndPausedSessions() throws {
        let coordinator = ComputerCoordinator(supportsInputMonitoring: false)
        coordinator.sessionConsents = ["consented"]
        coordinator.pausedSessionKeys = ["paused"]
        coordinator.pendingApproval = .init(
            sessionKey: "pending-session",
            kind: .session
        )
        let write = makeWriteApproval(
            id: UUID(),
            requestID: UUID().uuidString,
            sessionKey: "pending-write",
            fingerprint: "write",
            phase: .approvedAwaitingTargetRefocus
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

        XCTAssertEqual(
            aborted,
            ["consented", "paused", "pending-session", "pending-write", "active"]
        )
        XCTAssertTrue(writeDenied)
        XCTAssertTrue(gate.isCancelled)
        XCTAssertNil(coordinator.pendingApproval)
        XCTAssertNil(coordinator.pendingWriteApproval)
        XCTAssertNil(coordinator.inFlightExecution)
        XCTAssertNil(coordinator.leaseController.lease)
        XCTAssertTrue(coordinator.sessionConsents.isEmpty)
        XCTAssertTrue(coordinator.pausedSessionKeys.isEmpty)
    }

    func testEmergencyMonitorDoesNotDependOnActiveStateAndLegacyBudgetIsInert()
        throws {
        XCTAssertFalse(ComputerInputMonitorPolicy.shouldInstall(
            enabled: false,
            hasRelevantState: true
        ))
        XCTAssertTrue(ComputerInputMonitorPolicy.shouldInstall(
            enabled: true,
            hasRelevantState: false
        ))
        XCTAssertTrue(ComputerInputMonitorPolicy.shouldInstall(
            enabled: true,
            hasRelevantState: true
        ))

        let coordinator = ComputerCoordinator(supportsInputMonitoring: false)
        coordinator.leaseController = ComputerLeaseController(actionBudget: 1)
        _ = try coordinator.leaseController.acquire(
            sessionKey: "owner",
            targetBundleID: "com.example.editor",
            actionCount: 1,
            now: Date()
        )
        coordinator.activeSessionKey = "owner"
        XCTAssertFalse(coordinator.releaseIfActionBudgetExhausted(
            sessionKey: "owner"
        ))
        XCTAssertNotNil(coordinator.leaseController.lease)
        XCTAssertEqual(coordinator.activeSessionKey, "owner")
    }

    func testBridgeLifecycleCancelsOnlyUnfinishedRequests() {
        let cancelled = expectation(description: "cancelled")
        let lifecycle = BridgeRequestLifecycle()
        XCTAssertTrue(lifecycle.registerCancellation { cancelled.fulfill() })
        lifecycle.cancel()
        wait(for: [cancelled], timeout: 0.1)
        XCTAssertFalse(lifecycle.complete())

        var completedWasCancelled = false
        let completed = BridgeRequestLifecycle()
        XCTAssertTrue(completed.complete())
        XCTAssertFalse(completed.registerCancellation {
            completedWasCancelled = true
        })
        completed.cancel()
        XCTAssertFalse(completedWasCancelled)

        var lateCancellationRan = false
        let alreadyCancelled = BridgeRequestLifecycle()
        alreadyCancelled.cancel()
        XCTAssertFalse(alreadyCancelled.registerCancellation {
            lateCancellationRan = true
        })
        XCTAssertTrue(lateCancellationRan)
    }

    private func makeWriteApproval(
        id: UUID,
        requestID: String,
        sessionKey: String,
        fingerprint: String,
        phase: ComputerCoordinator.PendingWriteApproval.Phase =
            .awaitingUserDecision
    ) -> ComputerCoordinator.PendingWriteApproval {
        .init(
            id: id,
            requestID: requestID,
            sessionKey: sessionKey,
            fingerprint: fingerprint,
            actionKinds: [.leftClick],
            targetApplication: .init(
                bundleID: "com.example.editor",
                name: "Editor",
                processID: 42,
                windowTitle: nil
            ),
            expiresAt: Date().addingTimeInterval(10),
            phase: phase
        )
    }
}
