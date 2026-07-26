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

    func testPermanentDenyWinsOverPersistedAllow() {
        let decision = ComputerAppPolicy.decision(
            for: app("com.apple.Terminal", name: "Terminal"),
            sessionAllowed: ["com.apple.terminal"],
            persistedAllowed: ["com.apple.terminal"],
            persistedDenied: [],
            ownBundleID: "com.leehow.pipiui"
        )
        guard case .deny = decision else {
            return XCTFail("Terminal must remain permanently denied")
        }
    }

    func testUnknownNeedsConfirmationAndExplicitAllowPasses() {
        let identity = app("com.example.editor")
        XCTAssertEqual(
            ComputerAppPolicy.decision(
                for: identity,
                sessionAllowed: [],
                persistedAllowed: [],
                persistedDenied: [],
                ownBundleID: "com.leehow.pipiui"
            ),
            .needsConfirmation
        )
        XCTAssertEqual(
            ComputerAppPolicy.decision(
                for: identity,
                sessionAllowed: ["com.example.editor"],
                persistedAllowed: [],
                persistedDenied: [],
                ownBundleID: "com.leehow.pipiui"
            ),
            .allow
        )
    }

    func testPersistedDenyOverridesSessionAllow() {
        let decision = ComputerAppPolicy.decision(
            for: app("com.example.editor"),
            sessionAllowed: ["com.example.editor"],
            persistedAllowed: [],
            persistedDenied: ["com.example.editor"],
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
