import Combine
import Foundation
import XCTest
@testable import PipiUI

/// Pure + host seam for the lightweight subagent presentation snapshot.
///
/// The full `SubagentStore` publishes `objectWillChange` on every ~16ms `log_delta`
/// batch. The chat chrome / sidebar row / nav rail must not re-render per batch — only
/// on lifecycle (start/end). These tests pin the selector equality semantics and the
/// "publish only on change" behavior deterministically (no `sleep`/expectation timing).
final class SubagentChatProjectionTests: XCTestCase {

    // MARK: - Selector (pure)

    private func agent(
        _ id: String,
        state: SubagentInfo.State = .running,
        toolCallId: String? = nil
    ) -> SubagentInfo {
        var info = SubagentInfo(
            id: id,
            parentId: nil,
            toolCallId: toolCallId,
            name: "n",
            task: "t",
            title: nil,
            depth: 1,
            model: nil,
            started: Date(),
            lastObservedAt: Date()
        )
        info.state = state
        return info
    }

    func testSelectorEmptyForNoAgents() {
        XCTAssertEqual(SubagentChatProjection.presentation(for: []), .empty)
    }

    func testSelectorRunningCountAndToolCallIDs() {
        let agents = [
            agent("a", state: .running, toolCallId: "tc-a"),
            agent("b", state: .running, toolCallId: nil),
            agent("c", state: .ok, toolCallId: "tc-c"),
            agent("d", state: .failed, toolCallId: "tc-d"),
            agent("e", state: .running, toolCallId: "tc-e"),
        ]
        let presentation = SubagentChatProjection.presentation(for: agents)
        XCTAssertEqual(presentation.runningCount, 3)
        XCTAssertEqual(presentation.runningToolCallIDs, ["tc-a", "tc-e"])
    }

    /// Core acceptance #2 (subagent fan-out): ordinary log/telemetry growth must NOT
    /// change the lifecycle presentation, so observers skip re-render per batch.
    func testSelectorUnchangedWhenOnlyLogOutputOrTelemetryChanges() {
        let running = agent("a", state: .running, toolCallId: "tc-a")
        let before = SubagentChatProjection.presentation(for: [running])

        // Same running agent, but everything a log_delta/update/usage event mutates
        // (output, activity, cost, log rows) has changed.
        var grown = running
        grown.output = "more output"
        grown.activity = "bash"
        grown.cost = 12.5
        grown.turns = 9
        grown.log = [
            AgentLogItem(id: 1, kind: "text", name: "", text: "line one", isError: false),
            AgentLogItem(id: 2, kind: "tool", name: "bash", text: "{}", isError: false),
        ]

        let after = SubagentChatProjection.presentation(for: [grown])
        XCTAssertEqual(
            before,
            after,
            "log/telemetry growth must not alter the lifecycle presentation snapshot"
        )
    }

    func testSelectorChangesOnLifecycle() {
        var a = agent("a", state: .running, toolCallId: "tc-a")
        let running = SubagentChatProjection.presentation(for: [a])
        XCTAssertEqual(running.runningCount, 1)

        a.state = .ok
        let done = SubagentChatProjection.presentation(for: [a])
        XCTAssertNotEqual(running, done)
        XCTAssertEqual(done.runningCount, 0)
        XCTAssertEqual(done.runningToolCallIDs, [])
    }

    func testSelectorToolCallIDRebindChangesPresentation() {
        var a = agent("a", state: .running, toolCallId: "tc-1")
        let before = SubagentChatProjection.presentation(for: [a])
        a.toolCallId = "tc-2"
        let after = SubagentChatProjection.presentation(for: [a])
        XCTAssertNotEqual(before, after)
        XCTAssertEqual(after.runningToolCallIDs, ["tc-2"])
    }

    // MARK: - Host (publish only on change)

    private func event(kind: String, id: String, extra: [String: Any] = [:]) -> J {
        var payload = extra
        payload["kind"] = kind
        payload["agentId"] = id
        return J(payload)
    }

    @MainActor
    func testHostRefreshPublishesOnlyOnLifecycleChange() {
        let store = SubagentStore()
        let host = SubagentChatProjectionHost()
        host.bind(store)
        XCTAssertEqual(host.presentation, .empty)

        var received = [SubagentChatPresentation]()
        let cancellable = host.$presentation.sink { received.append($0) }
        // `.sink` emits the current value on subscribe.
        XCTAssertEqual(received.count, 1)

        // Lifecycle: agent starts → running count 1.
        store.handle(event(
            kind: "start", id: "a",
            extra: ["toolCallId": "tc-a", "name": "explore", "task": "work"]
        ))
        host.refresh()
        XCTAssertEqual(received.count, 2)
        XCTAssertEqual(host.presentation.runningCount, 1)
        XCTAssertEqual(host.presentation.runningToolCallIDs, ["tc-a"])

        // Ordinary telemetry (update): running set unchanged → must NOT republish.
        store.handle(event(
            kind: "update", id: "a",
            extra: ["activity": "tick", "cost": 1.0, "output": "partial"]
        ))
        host.refresh()
        XCTAssertEqual(received.count, 2, "telemetry/log growth must not republish the projection")

        // Ordinary log_delta (cumulative snapshot): still no lifecycle change.
        store.handle(event(
            kind: "log_delta", id: "a",
            extra: ["contentIndex": 0, "text": "streaming chunk"]
        ))
        host.refresh()
        XCTAssertEqual(received.count, 2, "log_delta must not republish the projection")

        // Lifecycle: agent ends → running count 0.
        store.handle(event(kind: "end", id: "a", extra: ["ok": true]))
        host.refresh()
        XCTAssertEqual(received.count, 3)
        XCTAssertEqual(host.presentation.runningCount, 0)
        XCTAssertTrue(host.presentation.runningToolCallIDs.isEmpty)

        withExtendedLifetime(cancellable) {}
    }

    @MainActor
    func testHostRefreshIsIdempotentWhenUnchanged() {
        let store = SubagentStore()
        store.handle(event(
            kind: "start", id: "a",
            extra: ["toolCallId": "tc-a", "name": "x", "task": "y"]
        ))
        let host = SubagentChatProjectionHost()
        host.bind(store)
        var received = [SubagentChatPresentation]()
        let cancellable = host.$presentation.sink { received.append($0) }
        XCTAssertEqual(received.count, 1)

        // Repeated refresh with no state change must not publish.
        host.refresh()
        host.refresh()
        host.refresh()
        XCTAssertEqual(received.count, 1)

        withExtendedLifetime(cancellable) {}
    }

    /// The Combine wiring (subscribe to store.objectWillChange → schedule a deferred
    /// refresh) is asserted synchronously via the host's scheduled-refresh flag, so the
    /// test never depends on async timing.
    @MainActor
    func testHostBindSubscribesToStoreObjectWillChange() {
        let store = SubagentStore()
        let host = SubagentChatProjectionHost()
        host.bind(store)
        XCTAssertFalse(host.hasScheduledRefresh)

        // A store mutation fires objectWillChange synchronously; the host's sink must
        // schedule a deferred refresh (flag set) without us awaiting the async hop.
        store.handle(event(kind: "start", id: "a", extra: ["name": "x", "task": "y"]))
        XCTAssertTrue(
            host.hasScheduledRefresh,
            "store objectWillChange must schedule a deferred projection refresh"
        )
    }

    @MainActor
    func testHostRebindsToANewStoreAndReflectsItsState() {
        let storeA = SubagentStore()
        storeA.handle(event(
            kind: "start", id: "a",
            extra: ["toolCallId": "tc-a", "name": "x", "task": "y"]
        ))
        let storeB = SubagentStore()
        storeB.handle(event(
            kind: "start", id: "b",
            extra: ["toolCallId": "tc-b", "name": "x", "task": "y"]
        ))
        storeB.handle(event(kind: "start", id: "c", extra: ["name": "x", "task": "y"]))

        let host = SubagentChatProjectionHost()
        host.bind(storeA)
        XCTAssertEqual(
            host.presentation,
            SubagentChatPresentation(runningCount: 1, runningToolCallIDs: ["tc-a"])
        )

        // Warm session switch: rebind to a different store; presentation reflects it.
        host.bind(storeB)
        XCTAssertEqual(host.presentation.runningCount, 2)
        XCTAssertEqual(host.presentation.runningToolCallIDs, ["tc-b"])

        // Binding the same store again is idempotent and still reflects current state.
        host.bind(storeB)
        XCTAssertEqual(host.presentation.runningCount, 2)
    }

    @MainActor
    func testHostEmptyStoreBindLeavesPresentationEmpty() {
        let store = SubagentStore()
        let host = SubagentChatProjectionHost()
        host.bind(store)
        XCTAssertEqual(host.presentation, .empty)
    }
}
