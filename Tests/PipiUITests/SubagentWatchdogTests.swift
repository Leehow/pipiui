import XCTest
@testable import PipiUI

final class SubagentWatchdogTests: XCTestCase {
    private let base = Date(timeIntervalSinceReferenceDate: 1_000)

    private func agent(
        id: String,
        state: SubagentInfo.State = .running,
        lastObservedAt: Date
    ) -> SubagentInfo {
        SubagentInfo(
            id: id,
            parentId: nil,
            name: "worker",
            task: "private task payload",
            depth: 1,
            model: nil,
            state: state,
            started: base,
            lastObservedAt: lastObservedAt
        )
    }

    func testOnlyRunningAgentsBecomeStaleAtTenMinutes() {
        let exactThreshold = base.addingTimeInterval(SubagentWatchdog.staleThreshold)
        let stale = agent(id: "silent", lastObservedAt: base)
        let active = agent(id: "active", lastObservedAt: exactThreshold)
        let terminal = agent(id: "finished", state: .ok, lastObservedAt: base)

        XCTAssertEqual(
            SubagentWatchdog.staleAgentIDs(in: [stale, active, terminal], now: exactThreshold),
            ["silent"]
        )
    }

    func testBridgeUpdateResetsStaleObservation() throws {
        let store = SubagentStore()
        store.handle(J([
            "kind": "start",
            "agentId": "worker-1",
            "name": "worker",
            "task": "private task payload",
            "depth": 1,
        ] as [String: Any]), observedAt: base)

        let staleAt = base.addingTimeInterval(SubagentWatchdog.staleThreshold)
        XCTAssertEqual(store.staleRunningAgentIDs(now: staleAt), ["worker-1"])

        let observedAgainAt = staleAt.addingTimeInterval(1)
        store.handle(J([
            "kind": "update",
            "agentId": "worker-1",
            "activity": "working",
        ] as [String: Any]), observedAt: observedAgainAt)

        let agent = try XCTUnwrap(store.agents.first)
        XCTAssertEqual(agent.lastObservedAt, observedAgainAt)
        XCTAssertTrue(
            store.staleRunningAgentIDs(
                now: observedAgainAt.addingTimeInterval(SubagentWatchdog.staleThreshold - 1)
            ).isEmpty
        )
    }

    func testOtherKnownBridgeEventsAlsoRefreshObservation() throws {
        let events: [J] = [
            J(["kind": "start", "agentId": "worker-1", "title": "resumed"] as [String: Any]),
            J(["kind": "log", "agentId": "worker-1", "items": []] as [String: Any]),
            J(["kind": "usage", "agentId": "worker-1", "usage": [:]] as [String: Any]),
            J(["kind": "stalled", "agentId": "worker-1", "idle": 120] as [String: Any]),
            J(["kind": "end", "agentId": "worker-1", "ok": true] as [String: Any]),
        ]

        for (offset, event) in events.enumerated() {
            let store = SubagentStore()
            store.handle(J([
                "kind": "start",
                "agentId": "worker-1",
                "name": "worker",
                "task": "private task payload",
                "depth": 1,
            ] as [String: Any]), observedAt: base)

            let observedAt = base.addingTimeInterval(TimeInterval(offset + 1))
            store.handle(event, observedAt: observedAt)

            XCTAssertEqual(try XCTUnwrap(store.agents.first).lastObservedAt, observedAt)
        }
    }

    func testLegacySnapshotFallsBackToStartedObservationTime() throws {
        let started = base.addingTimeInterval(42)
        let current = SubagentInfo(
            id: "legacy",
            parentId: nil,
            name: "worker",
            task: "private task payload",
            depth: 1,
            model: nil,
            started: started,
            lastObservedAt: started.addingTimeInterval(10)
        )
        let encoded = try JSONEncoder().encode(current)
        var legacyObject = try XCTUnwrap(
            JSONSerialization.jsonObject(with: encoded) as? [String: Any]
        )
        legacyObject.removeValue(forKey: "lastObservedAt")
        let legacyData = try JSONSerialization.data(withJSONObject: legacyObject)

        let decoded = try JSONDecoder().decode(SubagentInfo.self, from: legacyData)

        XCTAssertEqual(decoded.started, started)
        XCTAssertEqual(decoded.lastObservedAt, started)
    }

    func testManualStatusCheckPromptNamesExactIDsAndRestrictsAuthority() {
        let prompt = SubagentStatusCheckPrompt.make(agentIDs: ["agent-a", "agent-b"])

        XCTAssertTrue(prompt.contains("`agent-a`、`agent-b`"))
        XCTAssertTrue(prompt.contains("subagent_status"))
        XCTAssertTrue(prompt.contains("用户在界面主动发起"))
        XCTAssertTrue(prompt.contains("不要自动重新派发"))
        XCTAssertTrue(prompt.contains("不要修改文件、搜索项目"))
        XCTAssertTrue(prompt.contains("状态不可确认"))
    }

    /// Vanished settle sends end with interrupted=true; must map to .interrupted + retained,
    /// not ordinary failed/aborted (matches reconcileInterruptedAfterRestart).
    func testEndWithInterruptedFlagMapsToInterruptedRetained() throws {
        let store = SubagentStore()
        store.handle(J([
            "kind": "start",
            "agentId": "worker-1",
            "name": "worker",
            "task": "private task payload",
            "depth": 1,
            "worktreePath": "/tmp/pipiui-vanish-wt",
            "worktreeBranch": "pipiui/worker-1",
        ] as [String: Any]), observedAt: base)

        store.handle(J([
            "kind": "end",
            "agentId": "worker-1",
            "ok": false,
            "aborted": true,
            "interrupted": true,
            "output": "process gone after 2m, no result reported",
        ] as [String: Any]), observedAt: base.addingTimeInterval(120))

        let agent = try XCTUnwrap(store.agents.first)
        XCTAssertEqual(agent.state, .interrupted)
        XCTAssertEqual(agent.closeoutDisposition, .retained)
        XCTAssertEqual(agent.worktreeLifecycle, .pendingReview)
        XCTAssertEqual(agent.output, "process gone after 2m, no result reported")

        // Same agentId resume must show running again (Swift start reopen).
        store.handle(J([
            "kind": "start",
            "agentId": "worker-1",
            "name": "worker",
            "task": "continue",
            "depth": 1,
        ] as [String: Any]), observedAt: base.addingTimeInterval(200))
        XCTAssertEqual(try XCTUnwrap(store.agents.first).state, .running)
        XCTAssertNil(try XCTUnwrap(store.agents.first).ended)
    }

    func testEndWithVanishedFlagAlsoMapsToInterrupted() throws {
        let store = SubagentStore()
        store.handle(J([
            "kind": "start",
            "agentId": "worker-2",
            "name": "worker",
            "task": "task",
            "depth": 1,
        ] as [String: Any]), observedAt: base)
        store.handle(J([
            "kind": "end",
            "agentId": "worker-2",
            "ok": false,
            "vanished": true,
            "output": "gone",
        ] as [String: Any]), observedAt: base.addingTimeInterval(1))
        XCTAssertEqual(try XCTUnwrap(store.agents.first).state, .interrupted)
    }
}
