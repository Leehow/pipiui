import XCTest
@testable import PipiUI

/// Runtime-owned merge recovery state machine (SubagentStore).
/// The transitions here are the durable-incident core of the feature:
/// claim-once + single owner, silent WIP waiting, resume-consume, and auto-close
/// after a successful merge (with and without an attested verify).
@MainActor
final class WorktreeRecoveryStateTests: XCTestCase {
    private func startEvent(id: String) -> J {
        J([
            "agentId": id,
            "kind": "start",
            "name": "general-purpose",
            "task": "impl",
            "depth": 1,
            "worktreePath": "/tmp/pipiui-recovery-wt-\(id)",
            "worktreeBranch": "pipiui/\(id)",
        ])
    }

    private func endEvent(id: String, verifyCommand: String? = nil) -> J {
        var raw: [String: Any] = [
            "agentId": id,
            "kind": "end",
            "ok": true,
            "worktreePath": "/tmp/pipiui-recovery-wt-\(id)",
            "worktreeBranch": "pipiui/\(id)",
        ]
        if let command = verifyCommand { raw["verifyCommand"] = command }
        return J(raw)
    }

    private func makeStore() -> SubagentStore {
        let store = SubagentStore()
        store.bindMainProject(URL(fileURLWithPath: "/tmp"))
        return store
    }

    private func drain(times: Int = 8) async {
        for _ in 0..<times { await Task.yield() }
    }

    /// Committed-tree conflict: one durable claim, single owner, exactly one dispatch.
    func testMergeFailureClaimsIncidentAndDispatchesRecoveryOnce() async throws {
        let store = makeStore()
        var recoveries: [String] = []
        store.onWorktreeRecoveryNeeded = { recoveries.append($0.id) }
        store.mergeOutcomeOverride = { _, _ in .mergeFailed("conflict in Foo.swift") }

        store.handle(startEvent(id: "r1"))
        store.handle(endEvent(id: "r1"))
        await drain()

        let agent = try XCTUnwrap(store.agents.first)
        XCTAssertEqual(agent.recoveryState, .fixerRunning)
        XCTAssertEqual(agent.recoveryOwner, "r1")
        XCTAssertEqual(agent.recoveryAttempt, 1)
        XCTAssertEqual(recoveries, ["r1"], "runtime recovery must dispatch exactly once")
        XCTAssertNotNil(store.worktreeActionError, "the failure must stay visible for manual fallback")
        XCTAssertEqual(agent.worktreeLifecycle, .pendingReview, "worktree must be retained for the fixer")
    }

    /// Repeated failure of the same incident while already claimed must not double-dispatch.
    func testRepeatedMergeFailureDoesNotDispatchRecoveryTwice() async throws {
        let store = makeStore()
        var recoveries: [String] = []
        store.onWorktreeRecoveryNeeded = { recoveries.append($0.id) }
        store.mergeOutcomeOverride = { _, _ in .mergeFailed("conflict in Foo.swift") }

        store.handle(startEvent(id: "r2"))
        store.handle(endEvent(id: "r2"))
        await drain()
        XCTAssertEqual(recoveries, ["r2"])

        // A replay (duplicate callback / concurrent retry) of the same incident stays silent.
        let main = try XCTUnwrap(store.mainProjectURL)
        _ = await store.mergeWorktree(agentId: "r2", mainProjectURL: main)
        await drain()
        XCTAssertEqual(recoveries, ["r2"], "same incident must not re-dispatch a second fixer")
        XCTAssertEqual(store.agents.first?.recoveryAttempt, 1, "duplicate running callback must not consume a route")
    }

    /// Routes 1–2 reuse context; route 3 goes fresh on the same branch/worktree;
    /// a fresh-route failure emits one durable technical escalation and stops dispatching.
    func testRecoveryRoutesAreBoundedAndEscalateOnce() async throws {
        let store = makeStore()
        var freshRoutes: [Bool] = []
        var escalations = 0
        store.onWorktreeRecoveryNeeded = { freshRoutes.append($0.recoveryFreshContext) }
        store.onWorktreeRecoveryEscalated = { _ in escalations += 1 }
        store.mergeOutcomeOverride = { _, _ in .mergeFailed("conflict") }

        store.handle(startEvent(id: "route"))
        store.handle(endEvent(id: "route"))
        await drain()
        XCTAssertEqual(freshRoutes, [false])

        store.handle(startEvent(id: "route"))
        store.handle(endEvent(id: "route"))
        await drain()
        XCTAssertEqual(freshRoutes, [false, false])

        store.handle(startEvent(id: "route"))
        store.handle(endEvent(id: "route"))
        await drain()
        XCTAssertEqual(freshRoutes, [false, false, true], "third route must start fresh")
        XCTAssertEqual(store.agents.first?.recoveryAttempt, 3)

        // Fresh recovery ends and its merge fails: do not dispatch a fourth worker.
        store.handle(startEvent(id: "route"))
        store.handle(endEvent(id: "route"))
        await drain()
        XCTAssertEqual(freshRoutes, [false, false, true])
        XCTAssertEqual(escalations, 1)
        XCTAssertEqual(store.agents.first?.recoveryState, .needsBoss)
        XCTAssertTrue(store.agents.first?.recoveryBossSignaled == true)

        // A replay/restart merge callback preserves the once latch.
        let main = try XCTUnwrap(store.mainProjectURL)
        _ = await store.mergeWorktree(agentId: "route", mainProjectURL: main)
        XCTAssertEqual(escalations, 1)
        XCTAssertEqual(freshRoutes, [false, false, true])
    }

    /// The command route uses the persisted fresh/verify payload. `fresh` only clears
    /// the stored conversation; resolveSubagentWorktree still reuses this id's worktree.
    func testRecoveryCommandKeepsWorktreeAndCarriesPersistedVerify() throws {
        let root = try XCTUnwrap(PipiResourceBundle.shared.url(forResource: "PiExt", withExtension: nil))
        let index = try String(contentsOf: root.appendingPathComponent("subagent/index.ts"), encoding: .utf8)
        let worktree = try String(contentsOf: root.appendingPathComponent("subagent/worktree.ts"), encoding: .utf8)
        XCTAssertTrue(index.contains("const fresh = freshFlag === \"1\";"))
        XCTAssertTrue(index.contains("persistedVerify ?? previous?.verify?.command"))
        XCTAssertTrue(index.contains("{ agentId, background: true, fresh,"))
        XCTAssertTrue(index.contains("if (sessionDir && options?.fresh)"))
        XCTAssertTrue(worktree.contains("resolveSubagentWorktree"))
        XCTAssertTrue(worktree.contains("Reuse existing directory if it is already a valid worktree"))
    }

    /// WIP overlap: durable waitingForMain, silent (no error), no fixer dispatch.
    func testWaitingForMainIsSilentAndKeepsWorktree() async throws {
        let store = makeStore()
        var recoveries: [String] = []
        store.onWorktreeRecoveryNeeded = { recoveries.append($0.id) }
        store.mergeOutcomeOverride = { _, _ in .waitingForMain("shared.txt") }

        store.handle(startEvent(id: "r3"))
        store.handle(endEvent(id: "r3"))
        await drain()

        let agent = try XCTUnwrap(store.agents.first)
        XCTAssertEqual(agent.recoveryState, .waitingForMain)
        XCTAssertEqual(agent.recoveryOwner, "r3")
        XCTAssertNil(store.worktreeActionError, "waiting is silent: no boss-facing error")
        XCTAssertTrue(recoveries.isEmpty, "waiting must not dispatch a fixer")
        XCTAssertEqual(agent.worktreeLifecycle, .pendingReview)
    }

    /// Read-only probe anomaly: same durable waitingForMain fallback.
    func testProbeBlockedAlsoWaitsSilently() async throws {
        let store = makeStore()
        store.mergeOutcomeOverride = { _, _ in .blocked("git index.lock") }
        store.handle(startEvent(id: "r3b"))
        store.handle(endEvent(id: "r3b"))
        await drain()
        XCTAssertEqual(store.agents.first?.recoveryState, .waitingForMain)
        XCTAssertNil(store.worktreeActionError)
    }

    /// The runtime resumes the same worker id/conversation: start consumes the claim.
    func testRecoveryResumeMovesClaimToRetryingMerge() async throws {
        let store = makeStore()
        store.mergeOutcomeOverride = { _, _ in .mergeFailed("conflict") }
        store.handle(startEvent(id: "r4"))
        store.handle(endEvent(id: "r4"))
        await drain()
        XCTAssertEqual(store.agents.first?.recoveryState, .fixerRunning)

        store.handle(startEvent(id: "r4"))
        let agent = try XCTUnwrap(store.agents.first)
        XCTAssertEqual(agent.recoveryState, .retryingMerge)
        XCTAssertEqual(agent.state, .running)
    }

    /// No attested verify → successful merge auto-closes recovery immediately.
    func testSuccessfulMergeWithoutVerifyClosesRecovery() async throws {
        let store = makeStore()
        store.mergeOutcomeOverride = { _, _ in .ok }
        store.handle(startEvent(id: "r5"))
        store.handle(endEvent(id: "r5"))
        await drain()
        let agent = try XCTUnwrap(store.agents.first)
        XCTAssertEqual(agent.recoveryState, .closed)
        XCTAssertEqual(agent.worktreeLifecycle, .merged)
    }

    /// Attested verify → merge first enters verifying, then a passing post-merge verify
    /// closes the incident (auto-close after merge/verify/close).
    func testSuccessfulMergeThenVerifyPassClosesRecovery() async throws {
        SubagentStore.verifyCoalesceWindow = 0.02
        defer { SubagentStore.verifyCoalesceWindow = 2.0 }
        let store = makeStore()
        store.mergeOutcomeOverride = { _, _ in .ok }
        store.postMergeVerifyOutcomeOverride = { _, _ in PostMergeVerifyOutcome(failure: nil, mainDirty: false) }
        store.handle(startEvent(id: "r6"))
        store.handle(endEvent(id: "r6", verifyCommand: "swift build"))
        await drain()
        XCTAssertEqual(store.agents.first?.recoveryState, .verifying)

        let deadline = Date().addingTimeInterval(3)
        while store.agents.first?.recoveryState != .closed && Date() < deadline {
            try? await Task.sleep(nanoseconds: 25_000_000)
        }
        let agent = try XCTUnwrap(store.agents.first)
        XCTAssertEqual(agent.recoveryState, .closed)
        XCTAssertEqual(agent.worktreeLifecycle, .merged)
        XCTAssertEqual(agent.closeoutDisposition, .cleaned)
    }
}
