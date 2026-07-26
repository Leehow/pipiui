import XCTest
import CoreGraphics
@testable import PipiUI

final class ComputerSafetyTests: XCTestCase {
    private func action(
        _ kind: ComputerActionKind,
        coordinate: ComputerImagePoint? = nil,
        text: String? = nil,
        duration: TimeInterval? = nil
    ) -> ComputerAction {
        ComputerAction(
            kind: kind,
            coordinate: coordinate,
            startCoordinate: nil,
            text: text,
            keys: [],
            scrollDirection: kind == .scroll ? "down" : nil,
            scrollAmount: kind == .scroll ? 10 : nil,
            duration: duration
        )
    }

    func testUnicodeChunkingKeepsGraphemeAndSurrogateBoundaries() throws {
        let samples = [
            String(repeating: "a", count: 19) + "🧪",
            String(repeating: "🧪", count: 21),
            String(repeating: "e\u{301}", count: 17),
            "中文输入🧪混合文字🙂继续",
        ]
        for sample in samples {
            let chunks = try ComputerUnicodeChunker.chunks(sample)
            XCTAssertEqual(chunks.joined(), sample)
            XCTAssertTrue(chunks.allSatisfy {
                !$0.isEmpty
                    && $0.utf16.count <= ComputerUnicodeChunker.maximumUTF16Units
            })
            XCTAssertEqual(
                chunks.flatMap(Array.init).map(String.init).joined(),
                sample
            )
        }
        XCTAssertEqual(
            try ComputerUnicodeChunker.chunks(
                String(repeating: "a", count: 19) + "🧪"
            ),
            [String(repeating: "a", count: 19), "🧪"]
        )
        XCTAssertEqual(
            try ComputerUnicodeChunker.chunks(String(repeating: "🧪", count: 21))
                .map(\.utf16.count),
            [20, 20, 2]
        )
    }

    func testRuntimeBudgetAndCursorStopLaterActionsAfterCancellation() throws {
        XCTAssertLessThan(
            ComputerRuntimeBudget.maximumApprovalSeconds
                + ComputerRuntimeBudget.maximumExecutionSeconds,
            35
        )
        XCTAssertLessThan(35, BridgeRequestLimits.requestTimeout)
        let bounded = [
            action(.wait, duration: 3),
            action(.type, text: String(repeating: "a", count: 400)),
        ]
        XCTAssertLessThan(
            try ComputerRuntimeBudget.estimatedSeconds(for: bounded),
            ComputerRuntimeBudget.maximumEstimatedSeconds
        )
        XCTAssertThrowsError(try ComputerRuntimeBudget.validate(
            Array(repeating: action(.wait, duration: 3), count: 6)
        ))

        let gate = ComputerExecutionGate()
        var cursor = ComputerActionCursor(actions: [
            action(.screenshot), action(.screenshot), action(.screenshot),
        ])
        XCTAssertEqual(cursor.next(gate: gate, isCurrent: { true })?.0, 0)
        gate.cancel()
        XCTAssertNil(cursor.next(gate: gate, isCurrent: { true }))
    }

    func testWindowHitConfinementRejectsOverlaySystemUIAndEmptySpace() throws {
        let point = CGPoint(x: 50, y: 50)
        let target = ComputerWindowHitRecord(
            ownerPID: 42,
            bounds: CGRect(x: 0, y: 0, width: 100, height: 100),
            alpha: 1,
            isOnScreen: true
        )
        XCTAssertNoThrow(try ComputerWindowConfinement.authorize(
            point: point,
            targetPID: 42,
            rows: [target]
        ))

        let dockOrOverlay = ComputerWindowHitRecord(
            ownerPID: 7,
            bounds: target.bounds,
            alpha: 1,
            isOnScreen: true
        )
        XCTAssertThrowsError(try ComputerWindowConfinement.authorize(
            point: point,
            targetPID: 42,
            rows: [dockOrOverlay, target]
        )) { error in
            XCTAssertEqual(
                error as? ComputerWindowConfinementError,
                .differentApplication(expectedPID: 42, actualPID: 7)
            )
        }
        XCTAssertThrowsError(try ComputerWindowConfinement.authorize(
            point: CGPoint(x: 500, y: 500),
            targetPID: 42,
            rows: [target]
        ))
        XCTAssertThrowsError(try ComputerWindowConfinement.authorize(
            point: point,
            targetPID: 42,
            rows: []
        ))
        let app = ComputerApplicationIdentity(
            bundleID: "com.example.editor",
            name: "Editor",
            processID: 42,
            windowTitle: nil
        )
        XCTAssertTrue(ComputerCoordinator.sameProcess(app, app))
        XCTAssertFalse(ComputerCoordinator.sameProcess(
            app,
            .init(
                bundleID: app.bundleID,
                name: app.name,
                processID: 43,
                windowTitle: nil
            )
        ))
    }

    func testRetinaCaptureDescriptorUsesPixelsAndGlobalPointBounds() throws {
        let descriptor = try ComputerCaptureDescriptor.resolve(
            selectedDisplayID: 9,
            geometries: [.init(
                displayID: 9,
                globalBounds: CGRect(x: -1280, y: 0, width: 1280, height: 800),
                pixelWidth: 2560,
                pixelHeight: 1600
            )],
            maxLongEdge: 1440
        )
        XCTAssertEqual(descriptor.outputSize, .init(width: 1440, height: 900))
        let mapped = try ComputerCoordinateMap.globalPoint(
            imagePoint: .init(x: 720, y: 450),
            imageSize: descriptor.outputSize,
            displayBounds: descriptor.globalBounds
        )
        XCTAssertEqual(mapped.x, -640, accuracy: 0.001)
        XCTAssertEqual(mapped.y, 400, accuracy: 0.001)
        XCTAssertNoThrow(try descriptor.validateAdvertisement(
            displayID: 9,
            width: 1440,
            height: 900
        ))
        XCTAssertThrowsError(try descriptor.validateAdvertisement(
            displayID: 9,
            width: 1280,
            height: 800
        ))
        XCTAssertThrowsError(try ComputerCaptureDescriptor.resolve(
            selectedDisplayID: 10,
            geometries: [.init(
                displayID: 9,
                globalBounds: CGRect(x: 0, y: 0, width: 100, height: 100),
                pixelWidth: 200,
                pixelHeight: 200
            )],
            maxLongEdge: 1440
        ))
    }

    func testWriteApprovalIsExactExpiringAndOneUse() {
        XCTAssertFalse(ComputerRequest(
            actions: [action(.screenshot)]
        ).requiresWriteApproval)
        XCTAssertTrue(ComputerRequest(
            actions: [action(.wait, duration: 0)]
        ).requiresWriteApproval)

        let coordinator = ComputerCoordinator(supportsInputMonitoring: false)
        let old = makeWriteApproval(id: UUID(), requestID: UUID().uuidString, fingerprint: "old")
        let replacement = makeWriteApproval(
            id: UUID(),
            requestID: UUID().uuidString,
            fingerprint: "replacement"
        )
        var approvals = 0
        var denials = 0
        coordinator.pendingWriteApproval = replacement
        coordinator.pendingWriteContinuation = .init(
            approvalID: replacement.id,
            requestID: replacement.requestID,
            sessionKey: replacement.sessionKey,
            fingerprint: replacement.fingerprint,
            approve: { approvals += 1 },
            deny: { _ in denials += 1 }
        )

        XCTAssertFalse(coordinator.approvePendingWrite(
            id: old.id,
            requestID: old.requestID,
            fingerprint: old.fingerprint
        ))
        XCTAssertEqual(coordinator.pendingWriteApproval, replacement)
        XCTAssertEqual(approvals, 0)
        XCTAssertTrue(coordinator.approvePendingWrite(
            id: replacement.id,
            requestID: replacement.requestID,
            fingerprint: replacement.fingerprint
        ))
        XCTAssertEqual(approvals, 1)
        XCTAssertNil(coordinator.pendingWriteApproval)
        XCTAssertFalse(coordinator.approvePendingWrite(
            id: replacement.id,
            requestID: replacement.requestID,
            fingerprint: replacement.fingerprint
        ))
        XCTAssertEqual(approvals, 1)
        XCTAssertEqual(denials, 0)

        let expired = makeWriteApproval(
            id: UUID(),
            requestID: UUID().uuidString,
            fingerprint: "expired",
            expiresAt: Date(timeIntervalSince1970: 10)
        )
        coordinator.pendingWriteApproval = expired
        coordinator.pendingWriteContinuation = .init(
            approvalID: expired.id,
            requestID: expired.requestID,
            sessionKey: expired.sessionKey,
            fingerprint: expired.fingerprint,
            approve: { approvals += 1 },
            deny: { _ in denials += 1 }
        )
        XCTAssertFalse(coordinator.approvePendingWrite(
            id: expired.id,
            requestID: expired.requestID,
            fingerprint: expired.fingerprint,
            now: Date(timeIntervalSince1970: 11)
        ))
        XCTAssertEqual(denials, 1)
    }

    func testWriteApprovalHoldsOriginalRequestUntilExactDecision() throws {
        let coordinator = ComputerCoordinator(supportsInputMonitoring: false)
        let requestID = UUID().uuidString
        let request = ComputerRequest(actions: [
            action(.type, text: "approved text"),
        ])
        var responses: [[String: Any]] = []
        try coordinator.requestWriteApproval(
            requestID: requestID,
            sessionKey: "session",
            request: request,
            application: .init(
                bundleID: "com.example.editor",
                name: "Editor",
                processID: 42,
                windowTitle: nil
            ),
            descriptor: .init(
                displayID: 1,
                outputSize: .init(width: 100, height: 100),
                globalBounds: CGRect(x: 0, y: 0, width: 100, height: 100)
            ),
            reply: ComputerResponseGate { responses.append($0) }
        )
        XCTAssertTrue(responses.isEmpty)
        let pending = try XCTUnwrap(coordinator.pendingWriteApproval)
        XCTAssertEqual(pending.requestID, requestID)
        XCTAssertFalse(coordinator.denyPendingWrite(
            id: UUID(),
            requestID: requestID,
            fingerprint: pending.fingerprint
        ))
        XCTAssertTrue(responses.isEmpty)
        XCTAssertTrue(coordinator.denyPendingWrite(
            id: pending.id,
            requestID: requestID,
            fingerprint: pending.fingerprint
        ))
        XCTAssertEqual(responses.count, 1)
        XCTAssertNil(coordinator.pendingWriteApproval)
    }

    func testWriteApprovalFingerprintIncludesCompleteRequest() throws {
        let first = ComputerRequest(actions: [action(.type, text: "first 🧪")])
        let same = ComputerRequest(actions: [action(.type, text: "first 🧪")])
        let replacement = ComputerRequest(actions: [action(.type, text: "second 🧪")])
        XCTAssertEqual(
            try first.approvalFingerprint(),
            try same.approvalFingerprint()
        )
        XCTAssertNotEqual(
            try first.approvalFingerprint(),
            try replacement.approvalFingerprint()
        )
    }

    func testExpandedTerminalPolicyAlwaysDenies() {
        let terminals = [
            ("dev.warp.Warp-Stable", "Warp"),
            ("net.kovidgoyal.kitty", "kitty"),
            ("com.github.wez.wezterm", "WezTerm"),
            ("org.alacritty", "Alacritty"),
        ]
        for (bundleID, name) in terminals {
            let decision = ComputerAppPolicy.decision(
                for: .init(
                    bundleID: bundleID,
                    name: name,
                    processID: 1,
                    windowTitle: nil
                ),
                sessionAllowed: [bundleID.lowercased()],
                persistedAllowed: [bundleID.lowercased()],
                persistedDenied: [],
                ownBundleID: "com.leehow.pipiui"
            )
            guard case .deny = decision else {
                return XCTFail("\(name) must remain permanently denied")
            }
        }
    }

    private func makeWriteApproval(
        id: UUID,
        requestID: String,
        sessionKey: String = "session",
        fingerprint: String,
        expiresAt: Date = Date().addingTimeInterval(10)
    ) -> ComputerCoordinator.PendingWriteApproval {
        .init(
            id: id,
            requestID: requestID,
            sessionKey: sessionKey,
            fingerprint: fingerprint,
            actionKinds: [.leftClick],
            expiresAt: expiresAt
        )
    }
}
