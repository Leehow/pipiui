import XCTest
@testable import PipiUI

/// attachPersistence must reconcile ghost `.running` rows even when the store is
/// already non-empty (hot session: message replay fills agents before attach).
@MainActor
final class SubagentRestartReconcileTests: XCTestCase {
    private let base = Date(timeIntervalSinceReferenceDate: 2_000)

    private func supportDir() -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PipiUI/subagents")
    }

    private func persistURL(sessionLeaf: String) -> URL {
        supportDir().appendingPathComponent("\(sessionLeaf).agents.json")
    }

    private func writePersisted(_ agents: [SubagentInfo], sessionLeaf: String) throws -> URL {
        let dir = supportDir()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = persistURL(sessionLeaf: sessionLeaf)
        let data = try JSONEncoder().encode(agents)
        try data.write(to: url, options: .atomic)
        return url
    }

    private func makeAgent(
        id: String,
        state: SubagentInfo.State,
        task: String = "task",
        activity: String = "",
        worktreePath: String? = nil,
        worktreeLifecycle: WorktreeLifecycle = .none,
        closeoutDisposition: AgentCloseoutDisposition = .unclassified,
        ended: Date? = nil
    ) -> SubagentInfo {
        SubagentInfo(
            id: id,
            parentId: nil,
            name: "worker",
            task: task,
            depth: 1,
            model: nil,
            state: state,
            activity: activity,
            started: base,
            lastObservedAt: base,
            ended: ended,
            worktreePath: worktreePath,
            worktreeBranch: worktreePath.map { _ in "pipiui/\(id)" },
            worktreeLifecycle: worktreeLifecycle,
            closeoutDisposition: closeoutDisposition
        )
    }

    /// Wait until `attachPersistence`'s background load/merge task finishes.
    private func waitForAttach(
        _ store: SubagentStore,
        timeout: TimeInterval = 2.0,
        ready: @escaping () -> Bool
    ) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if ready() { return }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        XCTFail("attachPersistence did not finish within \(timeout)s")
    }

    func testAttachPersistenceReconcilesLiveAndPersistedRunningWhenAgentsNonEmpty() async throws {
        let leaf = "ghost-hot-\(UUID().uuidString)"
        let sessionFile = "/tmp/\(leaf).json"
        let url = try writePersisted([
            makeAgent(
                id: "disk-running",
                state: .running,
                task: "from disk",
                activity: "bash",
                worktreePath: "/tmp/pipiui-disk-wt",
                worktreeLifecycle: .active
            ),
            makeAgent(
                id: "disk-ok",
                state: .ok,
                task: "already done",
                worktreePath: "/tmp/pipiui-disk-ok",
                worktreeLifecycle: .pendingReview,
                closeoutDisposition: .retained,
                ended: base.addingTimeInterval(10)
            ),
        ], sessionLeaf: leaf)
        defer { try? FileManager.default.removeItem(at: url) }

        let store = SubagentStore()
        // Simulate message-replay filling the store before attachPersistence.
        store.handle(J([
            "kind": "start",
            "agentId": "live-running",
            "name": "worker",
            "task": "live ghost",
            "depth": 1,
            "worktreePath": "/tmp/pipiui-live-wt",
            "worktreeBranch": "pipiui/live-running",
        ] as [String: Any]), observedAt: base)
        store.handle(J([
            "kind": "start",
            "agentId": "live-ok-later",
            "name": "worker",
            "task": "will finish",
            "depth": 1,
        ] as [String: Any]), observedAt: base)
        store.handle(J([
            "kind": "end",
            "agentId": "live-ok-later",
            "ok": true,
            "output": "done",
        ] as [String: Any]), observedAt: base.addingTimeInterval(5))

        XCTAssertEqual(store.agents.first(where: { $0.id == "live-running" })?.state, .running)
        XCTAssertEqual(store.agents.first(where: { $0.id == "live-ok-later" })?.state, .ok)
        XCTAssertEqual(store.agents.count, 2)

        store.attachPersistence(sessionFile: sessionFile)

        // Live running ghost is reconciled synchronously (no need to wait for disk).
        let live = try XCTUnwrap(store.agents.first(where: { $0.id == "live-running" }))
        XCTAssertEqual(live.state, .interrupted)
        XCTAssertEqual(live.closeoutDisposition, .retained)
        XCTAssertEqual(live.worktreeLifecycle, .pendingReview)
        XCTAssertEqual(live.activity, "")
        XCTAssertNotNil(live.ended)
        // Terminal live row must not be re-scanned.
        XCTAssertEqual(store.agents.first(where: { $0.id == "live-ok-later" })?.state, .ok)

        try await waitForAttach(store) {
            store.agents.contains(where: { $0.id == "disk-running" })
                && store.agents.contains(where: { $0.id == "disk-ok" })
        }

        let diskRunning = try XCTUnwrap(store.agents.first(where: { $0.id == "disk-running" }))
        XCTAssertEqual(diskRunning.state, .interrupted)
        XCTAssertEqual(diskRunning.closeoutDisposition, .retained)
        XCTAssertEqual(diskRunning.worktreeLifecycle, .pendingReview)
        XCTAssertEqual(diskRunning.task, "from disk")

        let diskOk = try XCTUnwrap(store.agents.first(where: { $0.id == "disk-ok" }))
        XCTAssertEqual(diskOk.state, .ok)
        XCTAssertEqual(diskOk.closeoutDisposition, .retained)

        // Live fields preserved; disk-only rows appended (not a full overwrite).
        XCTAssertEqual(store.agents.first(where: { $0.id == "live-ok-later" })?.output, "done")
        XCTAssertEqual(Set(store.agents.map(\.id)), [
            "live-running", "live-ok-later", "disk-running", "disk-ok",
        ])

        // Reconcile must flush to disk even without further bridge events.
        let data = try Data(contentsOf: url)
        let persisted = try JSONDecoder().decode([SubagentInfo].self, from: data)
        XCTAssertFalse(persisted.contains(where: { $0.state == .running }))
        XCTAssertEqual(
            persisted.first(where: { $0.id == "live-running" })?.state,
            .interrupted
        )
        XCTAssertEqual(
            persisted.first(where: { $0.id == "disk-running" })?.closeoutDisposition,
            .retained
        )
    }

    func testAttachPersistenceColdPathStillReconcilesAndPersists() async throws {
        let leaf = "ghost-cold-\(UUID().uuidString)"
        let sessionFile = "/tmp/\(leaf).json"
        let url = try writePersisted([
            makeAgent(
                id: "only-disk",
                state: .running,
                activity: "stale",
                worktreePath: "/tmp/pipiui-cold-wt",
                worktreeLifecycle: .active
            ),
        ], sessionLeaf: leaf)
        defer { try? FileManager.default.removeItem(at: url) }

        let store = SubagentStore()
        XCTAssertTrue(store.agents.isEmpty)
        store.attachPersistence(sessionFile: sessionFile)

        try await waitForAttach(store) { !store.agents.isEmpty }

        let agent = try XCTUnwrap(store.agents.first)
        XCTAssertEqual(agent.id, "only-disk")
        XCTAssertEqual(agent.state, .interrupted)
        XCTAssertEqual(agent.closeoutDisposition, .retained)
        XCTAssertEqual(agent.worktreeLifecycle, .pendingReview)
        XCTAssertEqual(agent.activity, "")

        let data = try Data(contentsOf: url)
        let persisted = try JSONDecoder().decode([SubagentInfo].self, from: data)
        XCTAssertEqual(persisted.count, 1)
        XCTAssertEqual(persisted.first?.state, .interrupted)
        XCTAssertEqual(persisted.first?.closeoutDisposition, .retained)
    }

    func testAttachPersistenceDoesNotRescanTerminalAgents() async throws {
        let leaf = "ghost-terminal-\(UUID().uuidString)"
        let sessionFile = "/tmp/\(leaf).json"
        let ended = base.addingTimeInterval(30)
        let url = try writePersisted([
            makeAgent(
                id: "failed-disk",
                state: .failed,
                worktreePath: "/tmp/wt-failed",
                worktreeLifecycle: .pendingReview,
                closeoutDisposition: .retained,
                ended: ended
            ),
        ], sessionLeaf: leaf)
        defer { try? FileManager.default.removeItem(at: url) }

        let store = SubagentStore()
        store.handle(J([
            "kind": "start",
            "agentId": "aborted-live",
            "name": "worker",
            "task": "stop me",
            "depth": 1,
        ] as [String: Any]), observedAt: base)
        store.handle(J([
            "kind": "end",
            "agentId": "aborted-live",
            "ok": false,
            "aborted": true,
            "output": "user stop",
        ] as [String: Any]), observedAt: base.addingTimeInterval(2))

        store.attachPersistence(sessionFile: sessionFile)

        try await waitForAttach(store) {
            store.agents.contains(where: { $0.id == "failed-disk" })
        }

        let live = try XCTUnwrap(store.agents.first(where: { $0.id == "aborted-live" }))
        XCTAssertEqual(live.state, .aborted)
        XCTAssertEqual(live.closeoutDisposition, .retained)
        XCTAssertEqual(live.output, "user stop")

        let disk = try XCTUnwrap(store.agents.first(where: { $0.id == "failed-disk" }))
        XCTAssertEqual(disk.state, .failed)
        XCTAssertEqual(disk.ended, ended)
        XCTAssertFalse(store.agents.contains(where: { $0.state == .interrupted }))
    }
}
