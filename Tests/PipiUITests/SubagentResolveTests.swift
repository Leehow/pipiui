import Foundation
import XCTest
@testable import PipiUI

@MainActor
final class SubagentResolveTests: XCTestCase {
    private let base = Date(timeIntervalSinceReferenceDate: 20_000)

    func testSubagentInfoRunIdCodableAndLegacyCompatibility() throws {
        let info = SubagentInfo(
            id: "worker",
            runId: "run-123",
            parentId: nil,
            name: "worker",
            task: "task",
            depth: 1,
            model: nil
        )
        let data = try JSONEncoder().encode(info)
        let decoded = try JSONDecoder().decode(SubagentInfo.self, from: data)
        XCTAssertEqual(decoded.runId, "run-123")

        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        object.removeValue(forKey: "runId")
        let legacyData = try JSONSerialization.data(withJSONObject: object)
        let legacy = try JSONDecoder().decode(SubagentInfo.self, from: legacyData)
        XCTAssertNil(legacy.runId, "pre-runId persisted rows must remain readable")
    }

    func testStartEndPersistRunIdAndOldEndCannotOverwriteNewRun() throws {
        let store = SubagentStore()
        let firstRun = "run-first"
        let secondRun = "run-second"

        store.handle(start(id: "same", runId: firstRun), observedAt: base)
        XCTAssertEqual(store.agent(forID: "same")?.runId, firstRun)

        store.handle(end(id: "same", runId: firstRun, ok: false), observedAt: base.addingTimeInterval(1))
        XCTAssertEqual(store.agent(forID: "same")?.runId, firstRun)
        XCTAssertEqual(store.agent(forID: "same")?.state, .failed)

        store.handle(start(id: "same", runId: secondRun), observedAt: base.addingTimeInterval(2))
        XCTAssertEqual(store.agent(forID: "same")?.runId, secondRun)
        XCTAssertEqual(store.agent(forID: "same")?.state, .running)

        store.handle(end(id: "same", runId: firstRun, ok: false), observedAt: base.addingTimeInterval(3))
        XCTAssertEqual(store.agent(forID: "same")?.runId, secondRun)
        XCTAssertEqual(store.agent(forID: "same")?.state, .running)
    }

    func testLateStartForRetiredRunCannotReopenNewerTerminalButUnknownRunCanReuseAgentID() throws {
        let store = SubagentStore()
        let oldRun = "run-A"
        let terminalRun = "run-B"
        let nextRun = "run-C"

        store.handle(start(id: "same", runId: oldRun), observedAt: base)
        store.handle(end(id: "same", runId: oldRun, ok: false), observedAt: base.addingTimeInterval(1))
        store.handle(start(id: "same", runId: terminalRun), observedAt: base.addingTimeInterval(2))
        store.handle(end(id: "same", runId: terminalRun, ok: false), observedAt: base.addingTimeInterval(3))

        var started: [String] = []
        store.onAgentStarted = { started.append($0) }
        store.handle(start(id: "same", runId: oldRun), observedAt: base.addingTimeInterval(4))

        let terminal = try XCTUnwrap(store.agent(forID: "same"))
        XCTAssertEqual(terminal.runId, terminalRun)
        XCTAssertEqual(terminal.state, .failed)
        XCTAssertEqual(terminal.ended, base.addingTimeInterval(3))
        XCTAssertTrue(started.isEmpty, "late retired start must not emit a false lifecycle start")

        store.handle(start(id: "same", runId: nextRun), observedAt: base.addingTimeInterval(5))
        let reused = try XCTUnwrap(store.agent(forID: "same"))
        XCTAssertEqual(reused.runId, nextRun, "an unknown producer-issued runId remains a legal new episode")
        XCTAssertEqual(reused.state, .running)
        XCTAssertEqual(started, ["same"])
    }

    func testLateRunScopedTelemetryCannotMutateReusedRow() throws {
        let store = SubagentStore()
        let firstRun = "run-first"
        let secondRun = "run-second"
        let secondStartedAt = base.addingTimeInterval(2)

        store.handle(start(id: "same", runId: firstRun), observedAt: base)
        store.handle(end(id: "same", runId: firstRun, ok: false), observedAt: base.addingTimeInterval(1))
        store.handle(start(id: "same", runId: secondRun), observedAt: secondStartedAt)

        let staleEvents: [J] = [
            J(["kind": "update", "agentId": "same", "runId": firstRun, "output": "late", "activity": "late", "cost": 9, "turns": 9]),
            J(["kind": "log_delta", "agentId": "same", "runId": firstRun, "contentIndex": 0, "itemType": "text", "text": "late"]),
            J(["kind": "log", "agentId": "same", "runId": firstRun, "items": [["itemType": "text", "text": "late"]]]),
            J(["kind": "usage", "agentId": "same", "runId": firstRun, "turn": 1, "usage": ["input": 99, "output": 1, "cacheRead": 0, "cacheWrite": 0, "cost": 1, "contextTokens": 100]]),
            J(["kind": "stalled", "agentId": "same", "runId": firstRun, "stalled": true, "idle": 120, "activity": "late"]),
        ]
        for (offset, event) in staleEvents.enumerated() {
            store.handle(event, observedAt: secondStartedAt.addingTimeInterval(Double(offset + 1)))
        }

        let current = try XCTUnwrap(store.agent(forID: "same"))
        XCTAssertEqual(current.runId, secondRun)
        XCTAssertEqual(current.state, .running)
        XCTAssertEqual(current.output, "")
        XCTAssertEqual(current.activity, "")
        XCTAssertTrue(current.log.isEmpty)
        XCTAssertEqual(current.totalInput, 0)
        XCTAssertFalse(current.stalled)
        XCTAssertEqual(current.lastObservedAt, secondStartedAt,
                       "stale telemetry must not even refresh the new run's liveness hint")
    }

    func testCloseoutEventOnlyAppliesOnCurrentRunAndRetainsFailureAndVerification() throws {
        let store = SubagentStore()
        let runId = "run-closeout"
        store.handle(start(id: "failed", runId: runId), observedAt: base)
        store.handle(
            end(
                id: "failed",
                runId: runId,
                ok: false,
                verifyCommand: "swift test",
                verifyExit: 7,
                output: "real failure"
            ),
            observedAt: base.addingTimeInterval(1)
        )
        let before = try XCTUnwrap(store.agent(forID: "failed"))
        XCTAssertEqual(before.state, .failed)
        XCTAssertEqual(before.closeoutDisposition, .retained)
        XCTAssertEqual(before.verifyExit, 7)

        var closeoutChanged = 0
        store.onAgentCloseoutMayHaveChanged = { closeoutChanged += 1 }
        let staleAt = base.addingTimeInterval(2)
        store.handle(closeout(id: "failed", runId: "stale-run", reason: "must not apply"), observedAt: staleAt)
        let stale = try XCTUnwrap(store.agent(forID: "failed"))
        XCTAssertEqual(stale.state, .failed)
        XCTAssertEqual(stale.closeoutDisposition, .retained)
        XCTAssertNotEqual(stale.closeoutReason, "must not apply")
        XCTAssertEqual(stale.lastObservedAt, before.lastObservedAt, "stale closeout must not even refresh row observation")
        XCTAssertEqual(closeoutChanged, 0)

        let firstCloseoutMillis = 1_700_000_000_123.0
        store.handle(
            closeout(
                id: "failed",
                runId: runId,
                reason: "superseded by verified=pass replacement",
                closeoutAt: firstCloseoutMillis
            ),
            observedAt: base.addingTimeInterval(3)
        )
        let handled = try XCTUnwrap(store.agent(forID: "failed"))
        XCTAssertEqual(handled.state, .failed, "handled must not pretend failure became ok")
        XCTAssertEqual(handled.output, "real failure")
        XCTAssertEqual(handled.verifyCommand, "swift test")
        XCTAssertEqual(handled.verifyExit, 7, "handled must not fabricate verified=pass")
        XCTAssertEqual(handled.closeoutDisposition, .cleaned)
        XCTAssertEqual(handled.closeoutReason, "superseded by verified=pass replacement")
        XCTAssertEqual(handled.closeoutAt, Date(timeIntervalSince1970: firstCloseoutMillis / 1_000))
        XCTAssertEqual(closeoutChanged, 1, "matched closeout must release round-closeout observers")

        store.handle(
            closeout(
                id: "failed",
                runId: runId,
                reason: "late conflicting evidence",
                closeoutAt: firstCloseoutMillis + 1_000
            ),
            observedAt: base.addingTimeInterval(3.5)
        )
        let duplicate = try XCTUnwrap(store.agent(forID: "failed"))
        XCTAssertEqual(duplicate.closeoutReason, "superseded by verified=pass replacement")
        XCTAssertEqual(duplicate.closeoutAt, Date(timeIntervalSince1970: firstCloseoutMillis / 1_000))
        XCTAssertEqual(closeoutChanged, 1, "duplicate closeout must not emit a false lifecycle callback")

        // A delayed duplicate end may update real metadata, but never erase the boss's handled
        // decision or replace the failed verification attestation.
        store.handle(
            end(
                id: "failed",
                runId: runId,
                ok: false,
                verifyCommand: "swift test",
                verifyExit: 7,
                output: "late terminal report"
            ),
            observedAt: base.addingTimeInterval(4)
        )
        let afterDuplicateEnd = try XCTUnwrap(store.agent(forID: "failed"))
        XCTAssertEqual(afterDuplicateEnd.state, .failed)
        XCTAssertEqual(afterDuplicateEnd.verifyExit, 7)
        XCTAssertEqual(afterDuplicateEnd.closeoutDisposition, .cleaned)
        XCTAssertEqual(afterDuplicateEnd.closeoutReason, "superseded by verified=pass replacement")
        XCTAssertEqual(afterDuplicateEnd.closeoutAt, Date(timeIntervalSince1970: firstCloseoutMillis / 1_000))
    }

    func testPanelResolveRoutesCurrentRunThroughNodeAndUsesExplicitLegacyFallback() throws {
        let session = ChatSession(
            id: "resolve-ui-test",
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: nil,
            blockedReason: "test-only"
        )
        let backend = FakeBackend()
        session.attachTestingBackend(backend)
        defer { session.shutdown() }

        session.subagents.handle(start(id: "current", runId: "run-current"), observedAt: base)
        session.subagents.handle(end(id: "current", runId: "run-current", ok: false), observedAt: base.addingTimeInterval(1))
        let current = try XCTUnwrap(session.subagents.agent(forID: "current"))
        session.resolveSubagent(current)

        XCTAssertEqual(backend.requested.count, 1)
        XCTAssertEqual(backend.requested[0]["type"] as? String, "prompt")
        XCTAssertEqual(
            backend.requested[0]["message"] as? String,
            "/subagent_resolve current run-current 用户在界面标记为已处理"
        )
        XCTAssertEqual(
            session.subagents.agent(forID: "current")?.closeoutDisposition,
            .retained,
            "UI must wait for Node closeout bridge instead of mutating current row locally"
        )

        session.subagents.handle(
            closeout(id: "current", runId: "run-current", reason: "用户在界面标记为已处理"),
            observedAt: base.addingTimeInterval(2)
        )
        XCTAssertEqual(session.subagents.agent(forID: "current")?.closeoutDisposition, .cleaned)
        XCTAssertEqual(session.subagents.agent(forID: "current")?.state, .failed)

        session.subagents.handle(start(id: "legacy", runId: nil), observedAt: base)
        session.subagents.handle(end(id: "legacy", runId: nil, ok: false), observedAt: base.addingTimeInterval(1))
        let legacy = try XCTUnwrap(session.subagents.agent(forID: "legacy"))
        session.resolveSubagent(legacy)
        XCTAssertEqual(backend.requested.count, 1, "legacy row must not guess a Node runId")
        XCTAssertEqual(session.subagents.agent(forID: "legacy")?.closeoutDisposition, .cleaned)
        XCTAssertTrue(session.subagents.agent(forID: "legacy")?.closeoutReason?.contains("无法取消运行时提醒") == true)
        XCTAssertTrue(session.lastError?.contains("无法取消运行时提醒") == true)
    }

    func testDoneAndStatusSourcesExposeRunIdAndPanelWiringUsesResolve() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let node = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/PiExt/subagent/index.ts"),
            encoding: .utf8
        )
        let done = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/PiExt/subagent/done-message.ts"),
            encoding: .utf8
        )
        let presentation = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/Views/MessageViews.swift"),
            encoding: .utf8
        )
        let panel = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/Views/SubagentPanel.swift"),
            encoding: .utf8
        )
        let detail = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/Views/ChatDetailView.swift"),
            encoding: .utf8
        )

        XCTAssertTrue(done.contains(#"runId=${extra?.runId ?? "?"}"#))
        XCTAssertTrue(node.contains(#"`runId: ${job.runId}`"#))
        XCTAssertTrue(node.contains("| agentId | runId | name | state |"))
        XCTAssertTrue(node.contains("kind: \"closeout\""))
        XCTAssertTrue(panel.contains("onMarkHandled: { onResolve(agent) }"))
        XCTAssertFalse(panel.contains("onMarkCleaned: { store.markCleaned"))
        XCTAssertTrue(panel.contains("lifecyclePresentation.terminalBadgeText"))
        XCTAssertTrue(panel.contains("lifecyclePresentation.handledBadgeText"))
        XCTAssertTrue(panel.contains("handledLifecycleBadge"))
        XCTAssertFalse(panel.contains(".strikethrough"))
        XCTAssertFalse(presentation.contains("已处理·本次"))
        XCTAssertTrue(detail.contains("onResolve: { agent in session.resolveSubagent(agent) }"))
    }

    private func start(id: String, runId: String?) -> J {
        var event: [String: Any] = [
            "kind": "start",
            "agentId": id,
            "name": "worker",
            "task": "task",
            "depth": 1,
        ]
        if let runId { event["runId"] = runId }
        return J(event)
    }

    private func end(
        id: String,
        runId: String?,
        ok: Bool,
        verifyCommand: String? = nil,
        verifyExit: Int? = nil,
        output: String? = nil
    ) -> J {
        var event: [String: Any] = ["kind": "end", "agentId": id, "ok": ok]
        if let runId { event["runId"] = runId }
        if let verifyCommand { event["verifyCommand"] = verifyCommand }
        if let verifyExit { event["verifyExit"] = verifyExit }
        if let output { event["output"] = output }
        return J(event)
    }

    private func closeout(id: String, runId: String, reason: String, closeoutAt: Double? = nil) -> J {
        var event: [String: Any] = [
            "kind": "closeout",
            "agentId": id,
            "runId": runId,
            "disposition": "cleaned",
            "reason": reason,
        ]
        if let closeoutAt { event["closeoutAt"] = closeoutAt }
        return J(event)
    }
}
