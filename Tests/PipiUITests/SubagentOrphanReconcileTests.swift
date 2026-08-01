import XCTest
@testable import PipiUI

/// App 运行中的孤儿对账（第三块修复）：会话进程已死 + 桥接观察静默 ≥ watchdog 窗口
/// 的 `.running` 幽灵扫成 `.interrupted`（retained、清 activity、补 ended、落盘）；
/// 活会话 / 新鲜观察 / 终态行一律不动；重复扫描幂等。
@MainActor
final class SubagentOrphanReconcileTests: XCTestCase {
    private let base = Date(timeIntervalSinceReferenceDate: 3_000)
    /// 已超过 10 分钟 watchdog 窗口的时刻。
    private let stale: Date = Date(timeIntervalSinceReferenceDate: 3_000)
        .addingTimeInterval(SubagentWatchdog.staleThreshold + 1)

    private func supportDir() -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PipiUI/subagents")
    }

    private func makeAgent(
        id: String,
        state: SubagentInfo.State = .running,
        lastObservedAt: Date,
        worktreePath: String? = nil,
        worktreeLifecycle: WorktreeLifecycle = .none
    ) -> SubagentInfo {
        SubagentInfo(
            id: id,
            parentId: nil,
            name: "worker",
            task: "task-\(id)",
            depth: 1,
            model: nil,
            state: state,
            activity: "bash {\"command\":\"sleep 999\"}",
            started: lastObservedAt,
            lastObservedAt: lastObservedAt,
            worktreePath: worktreePath,
            worktreeBranch: worktreePath.map { _ in "pipiui/\(id)" },
            worktreeLifecycle: worktreeLifecycle
        )
    }

    // MARK: - ① 死会话的陈旧 running → interrupted + retained

    func testDeadSessionStaleRunningBecomesInterruptedRetained() throws {
        let ghost = makeAgent(
            id: "ghost",
            lastObservedAt: base,
            worktreePath: "/tmp/pipiui-orphan-wt",
            worktreeLifecycle: .active
        )
        let fresh = makeAgent(id: "fresh", lastObservedAt: stale)
        let terminal = makeAgent(id: "done", state: .ok, lastObservedAt: base)

        let reconciled = SubagentStore.reconcileOrphaned(
            [ghost, fresh, terminal], now: stale, sessionAlive: false
        )

        let g = try XCTUnwrap(reconciled.first { $0.id == "ghost" })
        XCTAssertEqual(g.state, .interrupted)
        XCTAssertEqual(g.closeoutDisposition, .retained)
        XCTAssertEqual(g.activity, "")
        XCTAssertFalse(g.stalled)
        XCTAssertEqual(g.ended, stale)
        // 有 worktree → 与 restart 对账一致，转 pendingReview 供审核。
        XCTAssertEqual(g.worktreeLifecycle, .pendingReview)
        XCTAssertTrue(g.closeoutReason?.contains("10 分钟") == true)

        // 新鲜观察与终态行不动。
        let f = try XCTUnwrap(reconciled.first { $0.id == "fresh" })
        XCTAssertEqual(f.state, .running)
        XCTAssertEqual(f.activity, makeAgent(id: "x", lastObservedAt: stale).activity)
        let d = try XCTUnwrap(reconciled.first { $0.id == "done" })
        XCTAssertEqual(d.state, .ok)
        XCTAssertNil(d.ended)
    }

    /// 边界：恰好 10 分钟触发（staleAgentIDs 用 `>=`，与 watchdog 判断一致）；
    /// 9:59 不算。
    func testThresholdBoundaryMatchesWatchdog() throws {
        let agent = makeAgent(id: "boundary", lastObservedAt: base)

        let notYet = base.addingTimeInterval(SubagentWatchdog.staleThreshold - 1)
        XCTAssertEqual(
            try XCTUnwrap(SubagentStore.reconcileOrphaned(
                [agent], now: notYet, sessionAlive: false).first
            ).state,
            .running
        )

        let exactly = base.addingTimeInterval(SubagentWatchdog.staleThreshold)
        XCTAssertEqual(
            try XCTUnwrap(SubagentStore.reconcileOrphaned(
                [agent], now: exactly, sessionAlive: false).first
            ).state,
            .interrupted
        )
    }

    // MARK: - ② 活会话的陈旧 running → 不动（那是扩展侧 vanished 结算的责任区）

    func testLiveSessionStaleRunningNeverSwept() {
        let ghost = makeAgent(id: "ghost", lastObservedAt: base)

        let unchanged = SubagentStore.reconcileOrphaned([ghost], now: stale, sessionAlive: true)
        XCTAssertEqual(unchanged.first?.state, .running)
        XCTAssertEqual(unchanged.first?.activity, ghost.activity)
    }

    func testLiveSessionInstanceSweepSkips() {
        let store = SubagentStore()
        store.startOrphanReconciliation(isSessionAlive: { true })
        store.handle(J([
            "kind": "start",
            "agentId": "ghost",
            "name": "worker",
            "task": "task",
            "depth": 1,
        ] as [String: Any]), observedAt: base)

        XCTAssertFalse(store.reconcileOrphanedNow(now: stale))
        let agent = try? XCTUnwrap(store.agents.first)
        XCTAssertEqual(agent?.state, .running)
        XCTAssertEqual(agent?.lastObservedAt, base)
    }

    // MARK: - ③ lastObservedAt 新鲜 → 不动

    func testDeadSessionFreshObservationUntouched() {
        let store = SubagentStore()
        store.startOrphanReconciliation(isSessionAlive: { false })
        store.handle(J([
            "kind": "start",
            "agentId": "alive-worker",
            "name": "worker",
            "task": "task",
            "depth": 1,
        ] as [String: Any]), observedAt: base)
        // 窗口内被 bridge update 刷新过。
        let observedAt = base.addingTimeInterval(SubagentWatchdog.staleThreshold - 1)
        store.handle(J([
            "kind": "update",
            "agentId": "alive-worker",
            "activity": "working",
        ] as [String: Any]), observedAt: observedAt)

        XCTAssertFalse(store.reconcileOrphanedNow(now: stale))
        let agent = try? XCTUnwrap(store.agents.first)
        XCTAssertEqual(agent?.state, .running)
        XCTAssertEqual(agent?.lastObservedAt, observedAt)
    }

    // MARK: - ④ 幂等

    func testSweepIsIdempotent() {
        let store = SubagentStore()
        store.startOrphanReconciliation(isSessionAlive: { false })
        store.handle(J([
            "kind": "start",
            "agentId": "ghost",
            "name": "worker",
            "task": "task",
            "depth": 1,
        ] as [String: Any]), observedAt: base)

        XCTAssertTrue(store.reconcileOrphanedNow(now: stale))
        let firstPass = store.agents

        // 第二、三次扫描零改动；ended/closeoutReason 不被重写。
        XCTAssertFalse(store.reconcileOrphanedNow(now: stale.addingTimeInterval(120)))
        XCTAssertFalse(store.reconcileOrphanedNow(now: stale.addingTimeInterval(600)))
        XCTAssertEqual(store.agents, firstPass)
        XCTAssertEqual(store.agents.first?.state, .interrupted)
        XCTAssertEqual(store.agents.first?.ended, stale)
        XCTAssertEqual(store.agents.first?.closeoutDisposition, .retained)
    }

    // MARK: - 落盘：对账后 saveNow，磁盘不再挂 running 幽灵

    func testInstanceSweepPersistsInterruptedToDisk() async throws {
        let leaf = "orphan-sweep-\(UUID().uuidString)"
        let url = supportDir().appendingPathComponent("\(leaf).agents.json")
        try FileManager.default.createDirectory(
            at: supportDir(), withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: url) }

        let store = SubagentStore()
        // 直接挂盘（attachPersistence 的 restart 对账会无条件打断所有 running，干扰本测试）。
        store.persistURL = url
        store.handle(J([
            "kind": "start",
            "agentId": "ghost-1",
            "name": "worker",
            "task": "task",
            "depth": 1,
            "worktreePath": "/tmp/pipiui-orphan-wt",
            "worktreeBranch": "pipiui/ghost-1",
        ] as [String: Any]), observedAt: base)
        store.handle(J([
            "kind": "start",
            "agentId": "ghost-2",
            "name": "worker",
            "task": "task",
            "depth": 1,
        ] as [String: Any]), observedAt: base)

        store.startOrphanReconciliation(isSessionAlive: { false })
        XCTAssertTrue(store.reconcileOrphanedNow(now: stale))

        for agent in store.agents {
            XCTAssertEqual(agent.state, .interrupted)
            XCTAssertEqual(agent.closeoutDisposition, .retained)
            XCTAssertEqual(agent.activity, "")
            XCTAssertNotNil(agent.ended)
        }
        XCTAssertEqual(
            try XCTUnwrap(store.agents.first { $0.id == "ghost-1" }).worktreeLifecycle,
            .pendingReview
        )

        // saveNow 同步落盘：磁盘上不再有 running 幽灵。
        let persisted = try JSONDecoder().decode(
            [SubagentInfo].self, from: Data(contentsOf: url))
        XCTAssertEqual(persisted.count, 2)
        XCTAssertFalse(persisted.contains { $0.state == .running })
        XCTAssertEqual(persisted.first { $0.id == "ghost-1" }?.closeoutDisposition, .retained)

        // handle 的防抖写（0.5s 后）绝不能把 .running 复活回去。
        try await Task.sleep(nanoseconds: 700_000_000)
        let afterDebounce = try JSONDecoder().decode(
            [SubagentInfo].self, from: Data(contentsOf: url))
        XCTAssertFalse(afterDebounce.contains { $0.state == .running })
        XCTAssertEqual(afterDebounce.first { $0.id == "ghost-1" }?.closeoutDisposition, .retained)
    }

    /// 未启动对账（无 liveness 判定）时扫描必须跳过——不能盲扫。
    func testSweepWithoutLivenessProviderSkips() {
        let store = SubagentStore()
        store.handle(J([
            "kind": "start",
            "agentId": "ghost",
            "name": "worker",
            "task": "task",
            "depth": 1,
        ] as [String: Any]), observedAt: base)

        XCTAssertFalse(store.reconcileOrphanedNow(now: stale))
        XCTAssertEqual(store.agents.first?.state, .running)
    }
}
