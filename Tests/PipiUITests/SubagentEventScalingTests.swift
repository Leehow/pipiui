import Combine
import Foundation
import XCTest
@testable import PipiUI

final class SubagentEventScalingTests: XCTestCase {
    func testMailboxCoalescesTelemetryAndPreservesLifecycleOrder() throws {
        let store = SubagentStore()
        let start = Date(timeIntervalSince1970: 100)

        store.enqueue(event(
            kind: "start", id: "a", extra: ["name": "explore", "task": "work"]
        ), observedAt: start)
        for value in 1...100 {
            store.enqueue(event(
                kind: "update",
                id: "a",
                extra: ["output": "value-\(value)", "cost": Double(value)]
            ), observedAt: start.addingTimeInterval(Double(value) / 100))
        }
        store.enqueue(event(
            kind: "end", id: "a", extra: ["ok": true, "cost": 101.0]
        ), observedAt: start.addingTimeInterval(2))

        XCTAssertEqual(store.pendingAgentEventCount, 3, "start + latest update + end")
        store.flushPendingAgentEvents()

        let agent = try XCTUnwrap(store.agent(forID: "a"))
        XCTAssertEqual(agent.state, .ok)
        XCTAssertEqual(agent.output, "value-100")
        XCTAssertEqual(agent.cost, 101)
        XCTAssertEqual(agent.ended, start.addingTimeInterval(2))
        XCTAssertEqual(store.runningCount, 0)
        XCTAssertEqual(store.totalCost, 101)
    }

    func testQueuedReuseKeepsNewRunStateWhenLateOldRunReportsArrive() throws {
        let store = SubagentStore()
        let t = Date(timeIntervalSince1970: 100)
        store.handle(event(
            kind: "start", id: "a", extra: ["runId": "run-one", "name": "worker", "task": "first"]
        ), observedAt: t)
        store.handle(event(
            kind: "end", id: "a", extra: ["runId": "run-one", "ok": false]
        ), observedAt: t + 1)

        // The new start and late old telemetry share one mailbox window. The
        // queued run-two start becomes the expected episode before stale packets
        // can affect coalescing or projected lifecycle state.
        store.enqueue(event(
            kind: "start", id: "a", extra: ["runId": "run-two", "name": "worker", "task": "second"]
        ), observedAt: t + 2)
        store.enqueue(event(
            kind: "update", id: "a", extra: ["runId": "run-two", "output": "current"]
        ), observedAt: t + 3)
        store.enqueue(event(
            kind: "update", id: "a", extra: ["runId": "run-one", "output": "late old"]
        ), observedAt: t + 4)
        store.enqueue(event(kind: "log_delta", id: "a", extra: [
            "runId": "run-two", "contentIndex": 0, "itemType": "text", "text": "current log",
        ]), observedAt: t + 5)
        store.enqueue(event(kind: "log_delta", id: "a", extra: [
            "runId": "run-one", "contentIndex": 0, "itemType": "text", "text": "late old log",
        ]), observedAt: t + 6)
        store.enqueue(event(
            kind: "end", id: "a", extra: ["runId": "run-one", "ok": false]
        ), observedAt: t + 7)

        XCTAssertEqual(store.pendingAgentEventCount, 3,
                       "late run-one telemetry must be rejected before it can replace run-two slots")
        store.flushPendingAgentEvents()

        let agent = try XCTUnwrap(store.agent(forID: "a"))
        XCTAssertEqual(agent.runId, "run-two")
        XCTAssertEqual(agent.state, .running)
        XCTAssertEqual(agent.output, "current")
        XCTAssertEqual(agent.log.map(\.text), ["current log"])
        XCTAssertEqual(agent.lastObservedAt, t + 5,
                       "the late old run must not replace or refresh run-two telemetry")
    }

    func testBurstPublishesAgentTreeOnce() {
        let store = SubagentStore()
        store.handle(event(
            kind: "start", id: "a", extra: ["name": "explore", "task": "work"]
        ))
        var publicationCount = 0
        let observation = store.objectWillChange.sink { publicationCount += 1 }

        for value in 1...500 {
            store.enqueue(event(
                kind: "update", id: "a", extra: ["activity": "tick-\(value)"]
            ))
        }
        store.flushPendingAgentEvents()

        XCTAssertEqual(publicationCount, 1)
        XCTAssertEqual(store.agent(forID: "a")?.activity, "tick-500")
        withExtendedLifetime(observation) {}
    }

    func testUpdateStalledUpdateKeepsNewestActivityAndObservation() throws {
        let store = startedStore()
        let t1 = Date(timeIntervalSince1970: 101)
        let t2 = Date(timeIntervalSince1970: 102)
        let t3 = Date(timeIntervalSince1970: 103)
        store.enqueue(event(kind: "update", id: "a", extra: ["activity": "first"]), observedAt: t1)
        store.enqueue(event(kind: "stalled", id: "a", extra: ["idle": 120]), observedAt: t2)
        store.enqueue(event(kind: "update", id: "a", extra: ["activity": "latest"]), observedAt: t3)

        store.flushPendingAgentEvents()

        let agent = try XCTUnwrap(store.agent(forID: "a"))
        XCTAssertFalse(agent.stalled)
        XCTAssertEqual(agent.activity, "latest")
        XCTAssertEqual(agent.lastObservedAt, t3)
    }

    func testStalledUpdateStalledKeepsNewestStallAndObservation() throws {
        let store = startedStore()
        let t1 = Date(timeIntervalSince1970: 101)
        let t2 = Date(timeIntervalSince1970: 102)
        let t3 = Date(timeIntervalSince1970: 103)
        store.enqueue(event(kind: "stalled", id: "a", extra: ["idle": 120]), observedAt: t1)
        store.enqueue(event(kind: "update", id: "a", extra: ["activity": "brief"]), observedAt: t2)
        store.enqueue(event(kind: "stalled", id: "a", extra: ["idle": 180]), observedAt: t3)

        store.flushPendingAgentEvents()

        let agent = try XCTUnwrap(store.agent(forID: "a"))
        XCTAssertTrue(agent.stalled)
        XCTAssertEqual(agent.stalledIdleSec, 180)
        XCTAssertEqual(agent.lastObservedAt, t3)
    }

    func testUpdateLogUpdatePreservesLosslessBarrierAndMonotonicObservation() throws {
        let store = startedStore()
        let t1 = Date(timeIntervalSince1970: 101)
        let t2 = Date(timeIntervalSince1970: 102)
        let t3 = Date(timeIntervalSince1970: 103)
        store.enqueue(event(kind: "update", id: "a", extra: ["output": "first"]), observedAt: t1)
        store.enqueue(event(kind: "log", id: "a", extra: [
            "items": [["itemType": "text", "text": "kept"]],
        ]), observedAt: t2)
        store.enqueue(event(kind: "update", id: "a", extra: ["output": "latest"]), observedAt: t3)

        store.flushPendingAgentEvents()

        let agent = try XCTUnwrap(store.agent(forID: "a"))
        XCTAssertEqual(agent.output, "latest")
        XCTAssertEqual(agent.log.map(\.text), ["kept"])
        XCTAssertEqual(agent.lastObservedAt, t3)
    }

    func testIDIndexAndCachedAggregatesSurviveRemovalAndResume() {
        let store = SubagentStore()
        store.handle(event(
            kind: "start", id: "a", extra: ["name": "one", "task": "first"]
        ))
        store.handle(event(
            kind: "start", id: "b", extra: ["name": "two", "task": "second"]
        ))
        store.handle(event(kind: "update", id: "a", extra: ["cost": 2.5]))
        store.handle(event(kind: "update", id: "b", extra: ["cost": 4.0]))
        store.handle(event(kind: "end", id: "a", extra: ["ok": true]))

        XCTAssertEqual(store.runningCount, 1)
        XCTAssertEqual(store.totalCost, 6.5)
        store.clearFinished()
        XCTAssertNil(store.agent(forID: "a"))
        XCTAssertEqual(store.agent(forID: "b")?.name, "two")
        XCTAssertEqual(store.runningCount, 1)
        XCTAssertEqual(store.totalCost, 4)

        store.handle(event(kind: "end", id: "b", extra: ["ok": true]))
        store.handle(event(kind: "start", id: "b", extra: ["toolCallId": "resumed"]))
        XCTAssertEqual(store.runningCount, 1)
        XCTAssertEqual(store.agent(forID: "b")?.toolCallId, "resumed")
    }

    func testTenThousandStartsMaintainIndexIncrementally() {
        let store = SubagentStore()
        for value in 0..<10_000 {
            store.enqueue(event(
                kind: "start",
                id: "agent-\(value)",
                extra: ["name": "worker", "task": "task-\(value)"]
            ))
        }
        store.flushPendingAgentEvents()

        XCTAssertEqual(store.agents.count, 10_000)
        XCTAssertEqual(store.runningCount, 10_000)
        XCTAssertEqual(store.agent(forID: "agent-9999")?.task, "task-9999")
        XCTAssertLessThanOrEqual(store.agentIndexRebuildCount, 2)
    }

    func testTenThousandResumesUpdateToolCallIndexWithoutFullRebuildPerRow() {
        let store = SubagentStore()
        for value in 0..<10_000 {
            store.enqueue(event(
                kind: "start",
                id: "agent-\(value)",
                extra: [
                    "name": "worker",
                    "task": "task-\(value)",
                    "toolCallId": "initial-\(value)",
                ]
            ))
        }
        store.flushPendingAgentEvents()
        let rebuildsBeforeResume = store.agentIndexRebuildCount

        for value in 0..<10_000 {
            store.enqueue(event(
                kind: "start",
                id: "agent-\(value)",
                extra: ["toolCallId": "resumed-\(value)"]
            ))
        }
        store.flushPendingAgentEvents()

        XCTAssertLessThanOrEqual(store.agentIndexRebuildCount - rebuildsBeforeResume, 1)
        XCTAssertTrue(store.agents(forToolCallIds: ["initial-9999"]).isEmpty)
        XCTAssertEqual(
            store.agents(forToolCallIds: ["resumed-9999"]).map(\.id),
            ["agent-9999"]
        )
        XCTAssertEqual(store.runningCount, 10_000)
    }

    func testBridgeFIFOChunksAreBoundedAndPreserveOrderAcrossAppends() {
        var buffer = BridgeFIFOBuffer<Int>()
        for value in 0..<700 { buffer.append(value) }

        let first = buffer.popFirst(maxCount: BridgeServer.maximumMainRequestsPerDrain)
        for value in 700..<1_025 { buffer.append(value) }
        var chunks = [first]
        while !buffer.isEmpty {
            chunks.append(buffer.popFirst(maxCount: BridgeServer.maximumMainRequestsPerDrain))
        }

        XCTAssertTrue(chunks.allSatisfy {
            $0.count <= BridgeServer.maximumMainRequestsPerDrain
        })
        XCTAssertEqual(chunks.flatMap { $0 }, Array(0..<1_025))
        XCTAssertEqual(chunks.map(\.count), [256, 256, 256, 256, 1])
    }

    func testPersistenceBurstHasOneBoundedPendingCheckpointAndSaveNowIsLatest() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("SubagentEventScaling-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let url = directory.appendingPathComponent("agents.json")
        let store = SubagentStore()
        store.persistURL = url
        store.handle(event(
            kind: "start", id: "a", extra: ["name": "explore", "task": "work"]
        ))
        for value in 1...500 {
            store.enqueue(event(
                kind: "update",
                id: "a",
                extra: ["output": "checkpoint-\(value)"]
            ))
        }
        store.flushPendingAgentEvents()

        XCTAssertTrue(store.hasPendingPersistenceWrite)
        XCTAssertEqual(store.persistenceWriteCount, 0)
        store.saveNow()
        XCTAssertFalse(store.hasPendingPersistenceWrite)
        XCTAssertEqual(store.persistenceWriteCount, 1)

        let data = try Data(contentsOf: url)
        let decoded = try JSONDecoder().decode([SubagentInfo].self, from: data)
        XCTAssertEqual(decoded.first?.output, "checkpoint-500")
    }

    func testAutoOpenOccursOncePerRootWaveAndRespectsManualClosure() {
        let store = SubagentStore()
        let rootA = event(kind: "start", id: "a")
        let rootB = event(kind: "start", id: "b")
        let child = event(kind: "start", id: "child", extra: ["parentId": "a"])
        let rootC = event(kind: "start", id: "c")

        XCTAssertTrue(store.enqueue(rootA))
        store.flushPendingAgentEvents()
        // A manual panel close has no store mutation. Every later start in the same
        // projected wave must therefore continue returning false.
        XCTAssertFalse(store.enqueue(child))
        XCTAssertFalse(store.enqueue(rootB))
        store.flushPendingAgentEvents()
        XCTAssertFalse(store.enqueue(event(kind: "end", id: "a", extra: ["ok": true])))
        XCTAssertFalse(store.enqueue(event(kind: "end", id: "child", extra: ["ok": true])))
        XCTAssertFalse(store.enqueue(event(kind: "end", id: "b", extra: ["ok": true])))
        store.flushPendingAgentEvents()

        XCTAssertTrue(store.enqueue(rootC))
    }

    func testAutoOpenStartsNewRootWaveAfterLastEndInSameMailboxBatch() {
        let store = SubagentStore()
        XCTAssertTrue(store.enqueue(event(kind: "start", id: "a")))
        store.flushPendingAgentEvents()

        XCTAssertFalse(store.enqueue(event(kind: "end", id: "a", extra: ["ok": true])))
        XCTAssertTrue(store.enqueue(event(kind: "start", id: "b")))
        XCTAssertFalse(store.enqueue(event(kind: "start", id: "c")))
        store.flushPendingAgentEvents()

        XCTAssertEqual(store.agent(forID: "a")?.state, .ok)
        XCTAssertEqual(store.agent(forID: "b")?.state, .running)
        XCTAssertEqual(store.agent(forID: "c")?.state, .running)
        XCTAssertEqual(store.runningCount, 2)
    }

    func testAutoOpenDoesNotStartNewWaveWhenAnotherAgentRemainsProjectedRunning() {
        let store = SubagentStore()
        XCTAssertTrue(store.enqueue(event(kind: "start", id: "a")))
        XCTAssertFalse(store.enqueue(event(kind: "start", id: "b")))
        store.flushPendingAgentEvents()

        XCTAssertFalse(store.enqueue(event(kind: "end", id: "a", extra: ["ok": true])))
        XCTAssertFalse(store.enqueue(event(kind: "start", id: "c")))
        store.flushPendingAgentEvents()

        XCTAssertEqual(store.runningCount, 2)
        XCTAssertEqual(store.agent(forID: "b")?.state, .running)
        XCTAssertEqual(store.agent(forID: "c")?.state, .running)
    }

    func testDisplayOrderPutsFinishedFirstThenRunningByStartTime() throws {
        let store = SubagentStore()
        let t = Date(timeIntervalSince1970: 100)
        store.handle(event(kind: "start", id: "a", extra: ["name": "alpha", "task": "t"]), observedAt: t)
        store.handle(event(kind: "start", id: "b", extra: ["name": "beta", "task": "t"]), observedAt: t + 1)
        store.handle(event(kind: "start", id: "c", extra: ["name": "gamma", "task": "t"]), observedAt: t + 2)
        store.handle(event(kind: "update", id: "b", extra: ["output": "x"]), observedAt: t + 3)
        store.handle(event(kind: "update", id: "c", extra: ["output": "y"]), observedAt: t + 4)
        // a 完成后排在运行组上方；b/c 仍按开始时间升序。
        store.handle(event(kind: "end", id: "a", extra: ["ok": true]), observedAt: t + 5)

        XCTAssertEqual(store.displayOrder.map(\.id), ["a", "b", "c"])
        XCTAssertTrue(store.displayOrder.dropFirst().allSatisfy { $0.state == .running })
    }

    func testDisplayOrderRunningGroupStaysByStartTimeAndFinishingAgentLeavesRunningTail() throws {
        let store = SubagentStore()
        let t = Date(timeIntervalSince1970: 200)
        store.handle(event(kind: "start", id: "a", extra: ["name": "alpha"]), observedAt: t)
        store.handle(event(kind: "start", id: "b", extra: ["name": "beta"]), observedAt: t + 1)
        store.handle(event(kind: "start", id: "c", extra: ["name": "gamma"]), observedAt: t + 2)
        XCTAssertEqual(store.displayOrder.map(\.id), ["a", "b", "c"])

        // update 只改变 lastObservedAt，运行中组不得因此重排。
        store.handle(event(kind: "update", id: "a", extra: ["output": "z"]), observedAt: t + 3)
        XCTAssertEqual(store.displayOrder.map(\.id), ["a", "b", "c"])

        // c 结束：离开运行组，进入已完成组；运行中的 a/b 仍按开始时间升序。
        store.handle(event(kind: "end", id: "c", extra: ["ok": true]), observedAt: t + 4)
        XCTAssertEqual(store.displayOrder.map(\.id), ["c", "a", "b"])
        XCTAssertEqual(store.displayOrder.filter { $0.state == .running }.map(\.id), ["a", "b"])

        // b 后完成，按完成时间升序排在 c 的下方；最新完成项在更靠下的位置。
        store.handle(event(kind: "end", id: "b", extra: ["ok": true]), observedAt: t + 5)
        XCTAssertEqual(store.displayOrder.map(\.id), ["c", "b", "a"])
    }

    // MARK: - log_delta live streaming

    func testLogDeltaUpsertsSameContentIndexAndPreservesSingleRow() throws {
        let store = startedStore()
        store.handle(event(kind: "log_delta", id: "a", extra: [
            "contentIndex": 0,
            "itemType": "text",
            "text": "Hel",
        ]))
        store.handle(event(kind: "log_delta", id: "a", extra: [
            "contentIndex": 0,
            "itemType": "text",
            "text": "Hello",
        ]))

        let agent = try XCTUnwrap(store.agent(forID: "a"))
        XCTAssertEqual(agent.log.count, 1)
        XCTAssertEqual(agent.log[0].kind, "text")
        XCTAssertEqual(agent.log[0].text, "Hello")
    }

    func testLogDeltaSeparateContentIndicesCreateDistinctRows() throws {
        let store = startedStore()
        store.handle(event(kind: "log_delta", id: "a", extra: [
            "contentIndex": 0,
            "itemType": "text",
            "text": "answer",
        ]))
        store.handle(event(kind: "log_delta", id: "a", extra: [
            "contentIndex": 1,
            "itemType": "thinking",
            "text": "plan",
        ]))

        let agent = try XCTUnwrap(store.agent(forID: "a"))
        XCTAssertEqual(agent.log.map(\.kind), ["text", "thinking"])
        XCTAssertEqual(agent.log.map(\.text), ["answer", "plan"])
    }

    func testLogAfterStreamDoesNotDuplicateWhenOnlyToolsArrive() throws {
        // Bridge contract: after log_delta text, message_end only ships tools.
        let store = startedStore()
        store.handle(event(kind: "log_delta", id: "a", extra: [
            "contentIndex": 0,
            "itemType": "text",
            "text": "I will run bash",
        ]))
        store.handle(event(kind: "log", id: "a", extra: [
            "items": [["itemType": "tool", "name": "bash", "text": "echo hi"]],
        ]))

        let agent = try XCTUnwrap(store.agent(forID: "a"))
        XCTAssertEqual(agent.log.map(\.kind), ["text", "tool"])
        XCTAssertEqual(agent.log.map(\.text), ["I will run bash", "echo hi"])
    }

    func testLogResetsStreamSlotsSoNextTurnOpensNewRow() throws {
        let store = startedStore()
        store.handle(event(kind: "log_delta", id: "a", extra: [
            "contentIndex": 0,
            "itemType": "text",
            "text": "turn-1",
        ]))
        // Empty log still acts as a turn boundary (stream slot reset).
        store.handle(event(kind: "log", id: "a", extra: [
            "items": [] as [[String: Any]],
        ]))
        store.handle(event(kind: "log_delta", id: "a", extra: [
            "contentIndex": 0,
            "itemType": "text",
            "text": "turn-2",
        ]))

        let agent = try XCTUnwrap(store.agent(forID: "a"))
        XCTAssertEqual(agent.log.map(\.text), ["turn-1", "turn-2"])
    }

    func testLogDeltaMailboxCoalescesSameContentIndex() throws {
        let store = startedStore()
        for value in 1...50 {
            store.enqueue(event(kind: "log_delta", id: "a", extra: [
                "contentIndex": 0,
                "itemType": "text",
                "text": "v\(value)",
            ]))
        }
        // One coalesce slot for contentIndex 0 (latest wins).
        XCTAssertEqual(store.pendingAgentEventCount, 1)
        store.flushPendingAgentEvents()

        let agent = try XCTUnwrap(store.agent(forID: "a"))
        XCTAssertEqual(agent.log.count, 1)
        XCTAssertEqual(agent.log[0].text, "v50")
    }

    func testEmptyLogDeltaDoesNotCreateRow() throws {
        let store = startedStore()
        store.handle(event(kind: "log_delta", id: "a", extra: [
            "contentIndex": 0,
            "itemType": "text",
            "text": "",
        ]))
        XCTAssertEqual(store.agent(forID: "a")?.log.count, 0)
    }

    private func event(
        kind: String,
        id: String,
        extra: [String: Any] = [:]
    ) -> J {
        var payload = extra
        payload["kind"] = kind
        payload["agentId"] = id
        return J(payload)
    }

    private func startedStore() -> SubagentStore {
        let store = SubagentStore()
        store.handle(event(
            kind: "start",
            id: "a",
            extra: ["name": "worker", "task": "work"]
        ), observedAt: Date(timeIntervalSince1970: 100))
        return store
    }
}
