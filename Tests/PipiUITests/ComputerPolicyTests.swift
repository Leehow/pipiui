import XCTest
@testable import PipiUI

final class ComputerPolicyTests: XCTestCase {
    private func app(_ bundle: String, name: String = "Example") -> ComputerApplicationIdentity {
        ComputerApplicationIdentity(
            bundleID: bundle,
            name: name,
            processID: 42,
            windowTitle: "Document"
        )
    }

    func testMaintainedSensitiveTargetsNeedConfirmationInsteadOfHardDeny() {
        let sensitive = [
            app("com.leehow.pipiui", name: "PipiUI"),
            app("com.apple.systemsettings", name: "System Settings"),
            app("com.1password.1password", name: "1Password"),
            app("com.apple.Terminal", name: "Terminal"),
        ]
        for identity in sensitive {
            XCTAssertEqual(
                ComputerAppPolicy.decision(
                    for: identity,
                    sessionAllowed: [],
                    persistedAllowed: [],
                    persistedDenied: [],
                    ownBundleID: "com.leehow.pipiui"
                ),
                .needsConfirmation,
                "\(identity.name) should request an informed decision"
            )
        }
    }

    func testNeutralUnknownApplicationIsAllowedByGlobalToggle() {
        let identity = app("com.example.editor", name: "Unlisted Editor")
        XCTAssertEqual(
            ComputerAppPolicy.decision(
                for: identity,
                sessionAllowed: [],
                persistedAllowed: [],
                persistedDenied: [],
                ownBundleID: "com.leehow.pipiui"
            ),
            .allow
        )
    }

    func testPersistedDenyIsTheOnlyHardDenyAndOverridesEveryAllow() {
        let decision = ComputerAppPolicy.decision(
            for: app("com.apple.Terminal", name: "Terminal"),
            sessionAllowed: ["com.apple.terminal"],
            persistedAllowed: ["com.apple.terminal"],
            persistedDenied: ["com.apple.terminal"],
            ownBundleID: "com.leehow.pipiui"
        )
        guard case .deny = decision else {
            return XCTFail("persisted deny must win")
        }
    }

    func testLeaseBusyExpiryAndActionBudget() throws {
        let start = Date(timeIntervalSince1970: 1_000)
        var controller = ComputerLeaseController(leaseDuration: 10, actionBudget: 3)
        let first = try controller.acquire(
            sessionKey: "a",
            targetBundleID: "com.example.editor",
            actionCount: 2,
            now: start
        )
        XCTAssertEqual(first.remainingActions, 1)
        XCTAssertThrowsError(try controller.acquire(
            sessionKey: "b",
            targetBundleID: "com.example.other",
            actionCount: 1,
            now: start.addingTimeInterval(1)
        )) { error in
            guard case ComputerLeaseError.busy = error else {
                return XCTFail("expected busy, got \(error)")
            }
        }
        XCTAssertThrowsError(try controller.acquire(
            sessionKey: "a",
            targetBundleID: "com.example.editor",
            actionCount: 2,
            now: start.addingTimeInterval(2)
        )) { error in
            guard case ComputerLeaseError.actionBudgetExceeded = error else {
                return XCTFail("expected budget error, got \(error)")
            }
        }
        XCTAssertTrue(controller.purgeExpired(now: start.addingTimeInterval(10)))
        XCTAssertNoThrow(try controller.acquire(
            sessionKey: "b",
            targetBundleID: "com.example.other",
            actionCount: 1,
            now: start.addingTimeInterval(11)
        ))
    }

    func testLeaseRejectsTargetChangeWithinSession() throws {
        let now = Date()
        var controller = ComputerLeaseController()
        _ = try controller.acquire(
            sessionKey: "a",
            targetBundleID: "com.example.one",
            actionCount: 1,
            now: now
        )
        XCTAssertThrowsError(try controller.acquire(
            sessionKey: "a",
            targetBundleID: "com.example.two",
            actionCount: 1,
            now: now
        )) { error in
            guard case ComputerLeaseError.targetChanged = error else {
                return XCTFail("expected targetChanged, got \(error)")
            }
        }
    }

    func testRetargetPreservesEpochAndChargesOneAction() throws {
        let start = Date(timeIntervalSince1970: 2_000)
        var controller = ComputerLeaseController(
            leaseDuration: 30,
            actionBudget: 8
        )
        let original = try controller.acquire(
            sessionKey: "session",
            targetBundleID: "com.example.one",
            actionCount: 2,
            now: start
        )

        let changed = try controller.retarget(
            sessionKey: "session",
            targetBundleID: "COM.EXAMPLE.TWO",
            now: start.addingTimeInterval(10)
        )

        XCTAssertEqual(changed.targetBundleID, "com.example.two")
        XCTAssertEqual(changed.acquiredAt, original.acquiredAt)
        XCTAssertEqual(changed.expiresAt, original.expiresAt)
        XCTAssertEqual(
            changed.remainingActions,
            original.remainingActions - 1
        )

        let sameTarget = try controller.retarget(
            sessionKey: "session",
            targetBundleID: "com.example.two",
            now: start.addingTimeInterval(11)
        )
        XCTAssertEqual(sameTarget.acquiredAt, original.acquiredAt)
        XCTAssertEqual(sameTarget.expiresAt, original.expiresAt)
        XCTAssertEqual(
            sameTarget.remainingActions,
            original.remainingActions - 2
        )
    }

    func testRetargetExpiredLeaseRequiresNewExplicitEpoch() throws {
        let start = Date(timeIntervalSince1970: 3_000)
        var controller = ComputerLeaseController(
            leaseDuration: 5,
            actionBudget: 3
        )
        _ = try controller.acquire(
            sessionKey: "session",
            targetBundleID: "com.example.one",
            actionCount: 1,
            now: start
        )

        XCTAssertThrowsError(
            try controller.retarget(
                sessionKey: "session",
                targetBundleID: "com.example.two",
                now: start.addingTimeInterval(5)
            )
        ) { error in
            XCTAssertEqual(error as? ComputerLeaseError, .expired)
        }
        XCTAssertNil(controller.lease)
    }

    func testExecutionGateInterruptsCancellablePause() {
        let gate = ComputerExecutionGate()
        gate.cancel()
        XCTAssertThrowsError(try ComputerInputSynth.shared.cancellablePause(
            1,
            shouldStop: { gate.isCancelled }
        )) { error in
            guard case ComputerInputError.executionStopped = error else {
                return XCTFail("expected executionStopped, got \(error)")
            }
        }
    }

    func testSensitiveTextPolicyBlocksCommonCredentialShapes() {
        XCTAssertTrue(ComputerSensitiveTextPolicy.appearsSensitive(
            "api_key=sk-proj-0123456789abcdefghijklmnop"
        ))
        XCTAssertTrue(ComputerSensitiveTextPolicy.appearsSensitive(
            "-----BEGIN PRIVATE KEY-----"
        ))
        XCTAssertFalse(ComputerSensitiveTextPolicy.appearsSensitive(
            "普通中英文和 emoji 🧪 都可以输入"
        ))
    }
}
