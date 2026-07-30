import XCTest
@testable import PipiUI

@MainActor
final class SubagentWorktreeReconciliationTests: XCTestCase {
    private let staleMergeError = "合并失败（worktree 未删除）: stale test error"

    func testMissingWorktreeWithIntegratedBranchBecomesMerged() async throws {
        let (repo, cleanup) = try makeRepository()
        defer { cleanup() }
        let branch = "pipiui/agent-reconcile-merged"
        let worktree = repo.appendingPathComponent("merged-wt", isDirectory: true)
        try makeWorktree(branch: branch, at: worktree, in: repo, commitFile: "merged.txt")

        let store = makeStore(
            id: "reconcile-merged",
            path: worktree.path,
            branch: branch,
            running: false
        )
        store.worktreeActionError = staleMergeError

        try GitRepo.mergeBranch(branch, into: repo)
        try GitRepo.worktreeRemove(at: worktree, in: repo, force: false)

        await store.reconcileWorktreeLifecycles(mainProjectURL: repo)

        let agent = try XCTUnwrap(store.agents.first)
        XCTAssertEqual(agent.worktreeLifecycle, .merged)
        XCTAssertNil(agent.worktreeError)
        XCTAssertNil(store.worktreeActionError)
        XCTAssertEqual(agent.closeoutDisposition, .cleaned)
        XCTAssertTrue(agent.closeoutReason?.contains("外部已集成") == true)
        XCTAssertTrue(agent.closeoutReason?.contains("非本面板合并") == true)
        XCTAssertFalse(FileManager.default.fileExists(atPath: worktree.path))
        XCTAssertNoThrow(
            try GitRepo.run(
                gitArgs: ["show-ref", "--verify", "--quiet", "refs/heads/\(branch)"],
                in: repo
            ),
            "reconciliation must never delete the externally integrated branch"
        )
    }

    func testMissingWorktreeAndMissingBranchBecomesDiscarded() async throws {
        let (repo, cleanup) = try makeRepository()
        defer { cleanup() }
        let branch = "pipiui/agent-reconcile-discarded"
        let worktree = repo.appendingPathComponent("discarded-wt", isDirectory: true)
        try makeWorktree(branch: branch, at: worktree, in: repo)

        let store = makeStore(
            id: "reconcile-discarded",
            path: worktree.path,
            branch: branch,
            running: false
        )
        store.worktreeActionError = staleMergeError

        try GitRepo.worktreeRemove(at: worktree, in: repo, force: false)
        _ = try GitRepo.run(gitArgs: ["branch", "-D", branch], in: repo)

        await store.reconcileWorktreeLifecycles(mainProjectURL: repo)

        let agent = try XCTUnwrap(store.agents.first)
        XCTAssertEqual(agent.worktreeLifecycle, .discarded)
        XCTAssertNil(agent.worktreeError)
        XCTAssertNil(store.worktreeActionError)
        XCTAssertEqual(agent.closeoutDisposition, .cleaned)
        XCTAssertTrue(agent.closeoutReason?.contains("外部已清理") == true)
    }

    func testRegisteredWorktreeRemainsPendingReview() async throws {
        let (repo, cleanup) = try makeRepository()
        defer { cleanup() }
        let branch = "pipiui/agent-reconcile-present"
        let worktree = repo.appendingPathComponent("present-wt", isDirectory: true)
        try makeWorktree(branch: branch, at: worktree, in: repo)

        let store = makeStore(
            id: "reconcile-present",
            path: worktree.path,
            branch: branch,
            running: false
        )
        store.worktreeActionError = staleMergeError

        await store.reconcileWorktreeLifecycles(mainProjectURL: repo)

        let agent = try XCTUnwrap(store.agents.first)
        XCTAssertEqual(agent.worktreeLifecycle, .pendingReview)
        XCTAssertEqual(agent.worktreeError, staleMergeError)
        XCTAssertEqual(store.worktreeActionError, staleMergeError)
        XCTAssertTrue(FileManager.default.fileExists(atPath: worktree.path))
        XCTAssertTrue(GitRepo.worktreeList(in: repo).contains(where: { $0.branch == branch }))
    }

    func testRunningAgentIsNeverReconciled() async throws {
        let (repo, cleanup) = try makeRepository()
        defer { cleanup() }
        let branch = "pipiui/agent-reconcile-running"
        let worktree = repo.appendingPathComponent("running-wt", isDirectory: true)
        try makeWorktree(branch: branch, at: worktree, in: repo, commitFile: "running.txt")

        let store = makeStore(
            id: "reconcile-running",
            path: worktree.path,
            branch: branch,
            running: true
        )
        store.worktreeActionError = staleMergeError

        try GitRepo.mergeBranch(branch, into: repo)
        try GitRepo.worktreeRemove(at: worktree, in: repo, force: false)

        await store.reconcileWorktreeLifecycles(mainProjectURL: repo)

        let agent = try XCTUnwrap(store.agents.first)
        XCTAssertEqual(agent.state, .running)
        XCTAssertEqual(agent.worktreeLifecycle, .active)
        XCTAssertEqual(agent.worktreeError, staleMergeError)
        XCTAssertEqual(store.worktreeActionError, staleMergeError)
    }

    private func makeStore(
        id: String,
        path: String,
        branch: String,
        running: Bool
    ) -> SubagentStore {
        let store = SubagentStore()
        store.handle(J([
            "kind": "start",
            "agentId": id,
            "name": "general-purpose",
            "task": "reconcile",
            "depth": 1,
            "worktreePath": path,
            "worktreeBranch": branch,
            "worktreeError": staleMergeError,
        ] as [String: Any]))
        if !running {
            store.handle(J([
                "kind": "end",
                "agentId": id,
                "ok": false,
                "worktreePath": path,
                "worktreeBranch": branch,
            ] as [String: Any]))
        }
        return store
    }

    private func makeRepository() throws -> (URL, () -> Void) {
        guard GitRepo.findGitExecutable() != nil else {
            throw XCTSkip("git not available")
        }
        let repo = FileManager.default.temporaryDirectory.appendingPathComponent(
            "pipiui-reconcile-\(UUID().uuidString)",
            isDirectory: true
        )
        try FileManager.default.createDirectory(at: repo, withIntermediateDirectories: true)
        _ = try GitRepo.run(gitArgs: ["init", "-b", "main"], in: repo)
        _ = try GitRepo.run(
            gitArgs: ["config", "user.email", "pipiui-test@example.com"],
            in: repo
        )
        _ = try GitRepo.run(
            gitArgs: ["config", "user.name", "PipiUI Test"],
            in: repo
        )
        _ = try GitRepo.run(gitArgs: ["commit", "--allow-empty", "-m", "init"], in: repo)
        return (repo, { try? FileManager.default.removeItem(at: repo) })
    }

    private func makeWorktree(
        branch: String,
        at worktree: URL,
        in repo: URL,
        commitFile: String? = nil
    ) throws {
        try GitRepo.worktreeAdd(branch: branch, at: worktree, in: repo)
        guard let commitFile else { return }
        try "agent work\n".write(
            to: worktree.appendingPathComponent(commitFile),
            atomically: true,
            encoding: .utf8
        )
        _ = try GitRepo.run(gitArgs: ["add", commitFile], in: worktree)
        _ = try GitRepo.run(gitArgs: ["commit", "-m", "agent work"], in: worktree)
    }
}
