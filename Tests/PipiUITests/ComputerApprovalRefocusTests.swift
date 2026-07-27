import XCTest
@testable import PipiUI

final class ComputerApprovalRefocusTests: XCTestCase {
    private let target = ComputerApplicationIdentity(
        bundleID: "com.example.editor",
        name: "Editor",
        processID: 42,
        windowTitle: "Document"
    )
    private let pipi = ComputerApplicationIdentity(
        bundleID: "com.leehow.pipiui",
        name: "PipiUI",
        processID: 7,
        windowTitle: nil
    )

    func testApprovalWaitsForExactTargetRefocusAndStartsExactlyOnce() {
        let frontmost = LockedFrontmostApplication(target)
        let coordinator = makeCoordinator(frontmost)
        let probe = ApprovalProbe()
        let now = Date(timeIntervalSince1970: 100)
        let approval = installPending(
            on: coordinator,
            probe: probe,
            expiresAt: now.addingTimeInterval(8)
        )

        // The batch was captured from the target, but clicking approval makes
        // PipiUI frontmost. Approval must not synchronously execute.
        frontmost.set(pipi)
        XCTAssertTrue(coordinator.approvePendingWrite(
            id: approval.id,
            requestID: approval.requestID,
            fingerprint: approval.fingerprint,
            now: now
        ))
        XCTAssertEqual(
            coordinator.pendingWriteApproval?.phase,
            .approvedAwaitingTargetRefocus
        )
        XCTAssertEqual(probe.starts, 0)

        // The same approval cannot be replayed while it is waiting.
        XCTAssertFalse(coordinator.approvePendingWrite(
            id: approval.id,
            requestID: approval.requestID,
            fingerprint: approval.fingerprint,
            now: now
        ))
        XCTAssertEqual(probe.starts, 0)

        frontmost.set(target)
        XCTAssertTrue(coordinator.evaluateApprovedWriteRefocus(
            approvalID: approval.id,
            now: now.addingTimeInterval(1)
        ))
        XCTAssertEqual(probe.starts, 1)
        XCTAssertNil(coordinator.pendingWriteApproval)

        XCTAssertFalse(coordinator.evaluateApprovedWriteRefocus(
            approvalID: approval.id,
            now: now.addingTimeInterval(2)
        ))
        XCTAssertEqual(probe.starts, 1)
        XCTAssertEqual(probe.denials, 0)
    }

    func testExpiryAndTransportCancellationFailClosedDuringRefocusWait() {
        let frontmost = LockedFrontmostApplication(pipi)
        let coordinator = makeCoordinator(frontmost)
        let now = Date(timeIntervalSince1970: 200)

        let expiredProbe = ApprovalProbe()
        let expired = installPending(
            on: coordinator,
            probe: expiredProbe,
            expiresAt: now.addingTimeInterval(2)
        )
        XCTAssertTrue(coordinator.approvePendingWrite(
            id: expired.id,
            requestID: expired.requestID,
            fingerprint: expired.fingerprint,
            now: now
        ))
        XCTAssertFalse(coordinator.evaluateApprovedWriteRefocus(
            approvalID: expired.id,
            now: now.addingTimeInterval(3)
        ))
        XCTAssertEqual(expiredProbe.starts, 0)
        XCTAssertEqual(expiredProbe.denials, 1)
        XCTAssertNil(coordinator.pendingWriteApproval)

        let cancelledProbe = ApprovalProbe()
        let cancelled = installPending(
            on: coordinator,
            probe: cancelledProbe,
            expiresAt: now.addingTimeInterval(8)
        )
        XCTAssertTrue(coordinator.approvePendingWrite(
            id: cancelled.id,
            requestID: cancelled.requestID,
            fingerprint: cancelled.fingerprint,
            now: now
        ))
        XCTAssertTrue(coordinator.cancelPendingWrite(
            requestID: cancelled.requestID,
            sessionKey: cancelled.sessionKey,
            reason: "transport cancelled while awaiting target refocus"
        ))
        frontmost.set(target)
        XCTAssertFalse(coordinator.evaluateApprovedWriteRefocus(
            approvalID: cancelled.id,
            now: now.addingTimeInterval(1)
        ))
        XCTAssertEqual(cancelledProbe.starts, 0)
        XCTAssertEqual(cancelledProbe.denials, 1)
    }

    func testPIDReplacementAndContextDriftFailClosedBeforeStart() {
        let replacement = ComputerApplicationIdentity(
            bundleID: target.bundleID,
            name: target.name,
            processID: 99,
            windowTitle: nil
        )
        let frontmost = LockedFrontmostApplication(pipi)
        let coordinator = makeCoordinator(frontmost)
        let now = Date(timeIntervalSince1970: 300)

        let pidProbe = ApprovalProbe()
        let pidApproval = installPending(
            on: coordinator,
            probe: pidProbe,
            expiresAt: now.addingTimeInterval(8)
        )
        XCTAssertTrue(coordinator.approvePendingWrite(
            id: pidApproval.id,
            requestID: pidApproval.requestID,
            fingerprint: pidApproval.fingerprint,
            now: now
        ))
        frontmost.set(replacement)
        XCTAssertFalse(coordinator.evaluateApprovedWriteRefocus(
            approvalID: pidApproval.id,
            now: now.addingTimeInterval(1)
        ))
        XCTAssertEqual(pidProbe.starts, 0)
        XCTAssertEqual(pidProbe.denials, 1)

        let contextProbe = ApprovalProbe()
        let contextApproval = installPending(
            on: coordinator,
            probe: contextProbe,
            expiresAt: now.addingTimeInterval(8),
            validateContext: {
                throw ComputerRequestError.invalidRequest(
                    "display or policy changed"
                )
            }
        )
        frontmost.set(pipi)
        XCTAssertTrue(coordinator.approvePendingWrite(
            id: contextApproval.id,
            requestID: contextApproval.requestID,
            fingerprint: contextApproval.fingerprint,
            now: now
        ))
        frontmost.set(target)
        XCTAssertFalse(coordinator.evaluateApprovedWriteRefocus(
            approvalID: contextApproval.id,
            now: now.addingTimeInterval(1)
        ))
        XCTAssertEqual(contextProbe.starts, 0)
        XCTAssertEqual(contextProbe.denials, 1)
    }

    func testValidationCrossingAbsoluteExpiryDeniesWithoutStarting() {
        let expiresAt = Date(timeIntervalSince1970: 402)
        let clock = LockedApprovalClock(
            Date(timeIntervalSince1970: 401.999)
        )
        let frontmost = LockedFrontmostApplication(target)
        let coordinator = makeCoordinator(
            frontmost,
            approvalClock: { clock.current() }
        )
        let probe = ApprovalProbe()
        let approval = installPending(
            on: coordinator,
            probe: probe,
            expiresAt: expiresAt,
            phase: .approvedAwaitingTargetRefocus,
            validateContext: {
                clock.set(Date(timeIntervalSince1970: 402.001))
            }
        )

        XCTAssertFalse(coordinator.evaluateApprovedWriteRefocus(
            approvalID: approval.id,
            now: Date(timeIntervalSince1970: 401.999)
        ))
        XCTAssertEqual(probe.starts, 0)
        XCTAssertEqual(probe.denials, 1)
        XCTAssertNil(coordinator.pendingWriteApproval)
        XCTAssertNil(coordinator.pendingWriteContinuation)
    }

    private func makeCoordinator(
        _ frontmost: LockedFrontmostApplication,
        approvalClock: @escaping @Sendable () -> Date = { .distantPast }
    ) -> ComputerCoordinator {
        ComputerCoordinator(
            supportsInputMonitoring: false,
            supportsRefocusPolling: false,
            frontmostApplicationProvider: { frontmost.current() },
            targetProcessValidator: { _ in true },
            approvalClock: approvalClock
        )
    }

    @discardableResult
    private func installPending(
        on coordinator: ComputerCoordinator,
        probe: ApprovalProbe,
        expiresAt: Date,
        phase: ComputerCoordinator.PendingWriteApproval.Phase = .awaitingUserDecision,
        validateContext: @escaping () throws -> Void = {}
    ) -> ComputerCoordinator.PendingWriteApproval {
        let approval = ComputerCoordinator.PendingWriteApproval(
            id: UUID(),
            requestID: UUID().uuidString,
            sessionKey: "session",
            fingerprint: UUID().uuidString,
            actionKinds: [.type],
            targetApplication: target,
            expiresAt: expiresAt,
            phase: phase
        )
        coordinator.pendingWriteApproval = approval
        coordinator.pendingWriteContinuation = .init(
            approvalID: approval.id,
            requestID: approval.requestID,
            sessionKey: approval.sessionKey,
            fingerprint: approval.fingerprint,
            targetApplication: target,
            validateContext: validateContext,
            approve: { probe.starts += 1 },
            deny: { _ in probe.denials += 1 }
        )
        return approval
    }
}

private final class LockedFrontmostApplication: @unchecked Sendable {
    private let lock = NSLock()
    private var application: ComputerApplicationIdentity?

    init(_ application: ComputerApplicationIdentity?) {
        self.application = application
    }

    func current() -> ComputerApplicationIdentity? {
        lock.withLock { application }
    }

    func set(_ application: ComputerApplicationIdentity?) {
        lock.withLock { self.application = application }
    }
}

private final class ApprovalProbe {
    var starts = 0
    var denials = 0
}

private final class LockedApprovalClock: @unchecked Sendable {
    private let lock = NSLock()
    private var now: Date

    init(_ now: Date) {
        self.now = now
    }

    func current() -> Date {
        lock.withLock { now }
    }

    func set(_ now: Date) {
        lock.withLock { self.now = now }
    }
}
