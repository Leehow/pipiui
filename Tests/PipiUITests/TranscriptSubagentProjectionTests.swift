import Combine
import Foundation
import XCTest
@testable import PipiUI

/// Pure selector + host seam for the transcript-row subagent slice.
///
/// `StreamingTranscriptRows` previously observed the full `SubagentStore`, so
/// every ~16ms `log_delta`/`update` batch invalidated the entire settled-row
/// group. It now observes `TranscriptSubagentProjectionHost`, which re-publishes
/// a narrow per-agent slice only on lifecycle / display-relevant changes. These
/// tests pin the selector equality semantics (state-aware: telemetry ignored
/// while running) and the host's "publish only on change" behavior
/// deterministically — no `sleep`/expectation timing.
final class TranscriptSubagentProjectionTests: XCTestCase {

    // MARK: - Selector (pure)

    private func agent(
        _ id: String,
        state: SubagentInfo.State = .running,
        toolCallId: String? = nil,
        title: String? = nil,
        depth: Int = 1,
        parentId: String? = nil,
        worktreePath: String? = nil
    ) -> SubagentInfo {
        var info = SubagentInfo(
            id: id,
            parentId: parentId,
            toolCallId: toolCallId,
            name: "n",
            task: "t",
            title: title,
            depth: depth,
            model: nil,
            started: Date(),
            lastObservedAt: Date()
        )
        info.state = state
        info.worktreePath = worktreePath
        return info
    }

    func testSelectorEmptyForNoAgents() {
        XCTAssertEqual(TranscriptSubagentProjection.presentation(for: []), .empty)
    }

    func testSelectorCapturesDisplayedFieldsOrdered() {
        let agents = [
            agent("a", state: .running, toolCallId: "tc-a", title: "explore"),
            agent("b", state: .ok, toolCallId: "tc-b", depth: 2, parentId: "a",
                  worktreePath: "/tmp/wt")
        ]
        let presentation = TranscriptSubagentProjection.presentation(for: agents)
        XCTAssertEqual(presentation.slices.count, 2)
        XCTAssertEqual(presentation.slices[0].id, "a")
        XCTAssertEqual(presentation.slices[0].state, .running)
        XCTAssertEqual(presentation.slices[0].toolCallId, "tc-a")
        XCTAssertEqual(presentation.slices[0].title, "explore")
        XCTAssertEqual(presentation.slices[1].id, "b")
        XCTAssertEqual(presentation.slices[1].parentId, "a")
        XCTAssertEqual(presentation.slices[1].depth, 2)
        XCTAssertEqual(presentation.slices[1].worktreePath, "/tmp/wt")
    }

    func testSelectorRunningToolCallIDsDerivedFromSlices() {
        let agents = [
            agent("a", state: .running, toolCallId: "tc-a"),
            agent("b", state: .running, toolCallId: nil),
            agent("c", state: .ok, toolCallId: "tc-c"),
            agent("d", state: .failed, toolCallId: "tc-d"),
            agent("e", state: .running, toolCallId: "tc-e"),
        ]
        let presentation = TranscriptSubagentProjection.presentation(for: agents)
        XCTAssertEqual(
            presentation.runningToolCallIDs,
            ["tc-a", "tc-e"]
        )
        // Empty presentation has no running ids.
        XCTAssertEqual(TranscriptSubagentPresentation.empty.runningToolCallIDs, [])
    }

    /// Core acceptance: ordinary log/telemetry growth on a RUNNING agent must
    /// NOT change the transcript presentation, so the settled-row group skips
    /// re-render per batch. cost/turns/output/activity/log all change but the
    /// slice stays equal because none of those are displayed while running.
    func testSelectorUnchangedWhenOnlyRunningAgentTelemetryChanges() {
        let running = agent("a", state: .running, toolCallId: "tc-a")
        let before = TranscriptSubagentProjection.presentation(for: [running])

        var grown = running
        grown.output = "much more streaming output"
        grown.activity = "bash"
        grown.cost = 99.0
        grown.turns = 42
        grown.log = [
            AgentLogItem(id: 1, kind: "text", name: "", text: "line", isError: false),
            AgentLogItem(id: 2, kind: "tool", name: "bash", text: "{}", isError: false),
        ]
        grown.totalInput = 1234
        grown.totalOutput = 5678
        grown.stalled = true
        grown.stalledIdleSec = 130

        let after = TranscriptSubagentProjection.presentation(for: [grown])
        XCTAssertEqual(
            before,
            after,
            "running-agent telemetry/log growth must not alter the transcript slice"
        )
    }

    /// A finished agent's cost/turns ARE displayed (`完成 · N turns · $cost`), so
    /// changes to those fields on a finished agent DO invalidate. This is the
    /// state-aware flip side of the running-agent telemetry rule.
    func testSelectorChangesWhenFinishedAgentCostOrTurnsChange() {
        var done = agent("a", state: .ok, toolCallId: "tc-a")
        let before = TranscriptSubagentProjection.presentation(for: [done])

        done.cost = 5.5
        XCTAssertNotEqual(
            before,
            TranscriptSubagentProjection.presentation(for: [done]),
            "finished-agent cost is displayed and must invalidate"
        )

        done.turns = 11
        XCTAssertNotEqual(
            before,
            TranscriptSubagentProjection.presentation(for: [done]),
            "finished-agent turns is displayed and must invalidate"
        )
    }

    /// Lifecycle (start/end/state transition) and display-field changes always
    /// invalidate, regardless of running vs finished.
    func testSelectorChangesOnLifecycleAndDisplayFields() {
        var a = agent("a", state: .running, toolCallId: "tc-a", title: nil)
        let baseline = TranscriptSubagentProjection.presentation(for: [a])

        // State transition running → ok (captures final cost/turns).
        a.state = .ok
        XCTAssertNotEqual(
            baseline,
            TranscriptSubagentProjection.presentation(for: [a])
        )

        // Title set while running (SubagentToolCardStatus line shows it).
        var b = agent("b", state: .running, toolCallId: "tc-b", title: nil)
        let bBefore = TranscriptSubagentProjection.presentation(for: [b])
        b.title = "Plan A"
        XCTAssertNotEqual(
            bBefore,
            TranscriptSubagentProjection.presentation(for: [b])
        )

        // toolCallId rebind.
        var c = agent("c", state: .running, toolCallId: "tc-1")
        let cBefore = TranscriptSubagentProjection.presentation(for: [c])
        c.toolCallId = "tc-2"
        XCTAssertNotEqual(
            cBefore,
            TranscriptSubagentProjection.presentation(for: [c])
        )

        // worktreePath attaches (used by [subagent-done] document base).
        var d = agent("d", state: .ok, toolCallId: "tc-d")
        let dBefore = TranscriptSubagentProjection.presentation(for: [d])
        d.worktreePath = "/repo/wt"
        XCTAssertNotEqual(
            dBefore,
            TranscriptSubagentProjection.presentation(for: [d])
        )

        // Structural: agent added/removed.
        let two = TranscriptSubagentProjection.presentation(for: [
            agent("x"), agent("y")
        ])
        XCTAssertNotEqual(two, TranscriptSubagentProjection.presentation(for: [agent("x")]))
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
        let host = TranscriptSubagentProjectionHost()
        host.bind(store)
        XCTAssertEqual(host.presentation, .empty)

        var received = [TranscriptSubagentPresentation]()
        let cancellable = host.$presentation.sink { received.append($0) }
        // `.sink` emits the current value on subscribe.
        XCTAssertEqual(received.count, 1)

        // Lifecycle: agent starts → slice for one running agent.
        store.handle(event(
            kind: "start", id: "a",
            extra: ["toolCallId": "tc-a", "name": "explore", "task": "work"]
        ))
        host.refresh()
        XCTAssertEqual(received.count, 2)
        XCTAssertEqual(host.presentation.slices.count, 1)
        XCTAssertEqual(host.presentation.runningToolCallIDs, ["tc-a"])

        // Ordinary telemetry (update): running set unchanged, no displayed
        // field changed → must NOT republish.
        store.handle(event(
            kind: "update", id: "a",
            extra: ["activity": "tick", "cost": 1.0, "output": "partial", "turns": 3]
        ))
        host.refresh()
        XCTAssertEqual(received.count, 2, "telemetry/log growth must not republish the projection")

        // Ordinary log_delta (cumulative snapshot): still no display-relevant change.
        store.handle(event(
            kind: "log_delta", id: "a",
            extra: ["contentIndex": 0, "text": "streaming chunk"]
        ))
        host.refresh()
        XCTAssertEqual(received.count, 2, "log_delta must not republish the projection")

        // Lifecycle: agent ends → slice state flips to .ok, republish.
        store.handle(event(kind: "end", id: "a", extra: ["ok": true]))
        host.refresh()
        XCTAssertEqual(received.count, 3)
        XCTAssertEqual(host.presentation.slices.first?.state, .ok)
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
        let host = TranscriptSubagentProjectionHost()
        host.bind(store)
        var received = [TranscriptSubagentPresentation]()
        let cancellable = host.$presentation.sink { received.append($0) }
        XCTAssertEqual(received.count, 1)

        // Repeated refresh with no display-relevant change must not publish.
        host.refresh()
        host.refresh()
        host.refresh()
        XCTAssertEqual(received.count, 1)

        withExtendedLifetime(cancellable) {}
    }

    /// The Combine wiring (subscribe to store.objectWillChange → schedule a
    /// deferred refresh) is asserted synchronously via the host's
    /// scheduled-refresh flag, so the test never depends on async timing.
    @MainActor
    func testHostBindSubscribesToStoreObjectWillChange() {
        let store = SubagentStore()
        let host = TranscriptSubagentProjectionHost()
        host.bind(store)
        XCTAssertFalse(host.hasScheduledRefresh)

        // A store mutation fires objectWillChange synchronously; the host's
        // sink must schedule a deferred refresh (flag set) without awaiting.
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

        let host = TranscriptSubagentProjectionHost()
        host.bind(storeA)
        XCTAssertEqual(host.presentation.slices.count, 1)
        XCTAssertEqual(host.presentation.runningToolCallIDs, ["tc-a"])

        // Warm session switch: rebind to a different store; reflects it.
        host.bind(storeB)
        XCTAssertEqual(host.presentation.slices.count, 2)
        XCTAssertEqual(host.presentation.runningToolCallIDs, ["tc-b"])

        // Binding the same store again is idempotent and still reflects state.
        host.bind(storeB)
        XCTAssertEqual(host.presentation.slices.count, 2)
    }

    @MainActor
    func testHostEmptyStoreBindLeavesPresentationEmpty() {
        let store = SubagentStore()
        let host = TranscriptSubagentProjectionHost()
        host.bind(store)
        XCTAssertEqual(host.presentation, .empty)
    }

    /// Title change while running IS display-relevant (the running card line
    /// shows title/task), so it must republish — distinguishing it from
    /// pure telemetry. The `update` event does not carry `title`; a resume
    /// `start` (same agentId) is the realistic channel that rebinds it.
    @MainActor
    func testHostRepublishesWhenRunningAgentTitleChanges() {
        let store = SubagentStore()
        store.handle(event(
            kind: "start", id: "a",
            extra: ["toolCallId": "tc-a", "name": "explore", "task": "work"]
        ))
        let host = TranscriptSubagentProjectionHost()
        host.bind(store)
        var received = [TranscriptSubagentPresentation]()
        let cancellable = host.$presentation.sink { received.append($0) }
        XCTAssertEqual(received.count, 1)
        XCTAssertNil(host.presentation.slices.first?.title)

        // Resume `start` reports the agent's plan title after the initial spawn.
        store.handle(event(
            kind: "start", id: "a",
            extra: ["toolCallId": "tc-a", "name": "explore", "task": "work",
                    "title": "Investigate scroll perf"]
        ))
        host.refresh()
        XCTAssertEqual(received.count, 2)
        XCTAssertEqual(host.presentation.slices.first?.title, "Investigate scroll perf")

        withExtendedLifetime(cancellable) {}
    }
}
