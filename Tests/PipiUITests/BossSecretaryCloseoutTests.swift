import XCTest
@testable import PipiUI

@MainActor
final class BossSecretaryCloseoutTests: XCTestCase {
    func testSecretaryIsBuiltInAndRuntimePinnedToMainWithoutDelegation() throws {
        let secretary = try XCTUnwrap(
            AgentCatalog.builtInAgents.first(where: { $0.name == "secretary" })
        )
        XCTAssertTrue(secretary.description.contains("closeout"))
        XCTAssertFalse(secretary.tools.contains("subagent"))

        let root = repositoryRoot()
        let runtime = try String(
            contentsOf: root.appendingPathComponent(
                "Sources/PipiUI/PiExt/subagent/index.ts"
            ),
            encoding: .utf8
        )
        XCTAssertTrue(runtime.contains("function runtimeRolePolicyForAgent"))
        XCTAssertTrue(runtime.contains("agentName === \"secretary\""))
        XCTAssertTrue(runtime.contains("worktree: \"main-session\""))
        XCTAssertTrue(runtime.contains("allowRecursiveDelegation: false"))
        XCTAssertTrue(runtime.contains("PIPIUI_MAIN_CWD || opts.defaultCwd"))
        XCTAssertTrue(runtime.contains("t !== \"subagent\""))
        XCTAssertTrue(runtime.contains("PIPIUI_AGENT_NO_DELEGATION: \"1\""))

        let definition = try String(
            contentsOf: root.appendingPathComponent(
                "Sources/PipiUI/PiExt/agents/secretary.md"
            ),
            encoding: .utf8
        )
        XCTAssertTrue(definition.contains("name: secretary"))
        XCTAssertTrue(definition.contains("only `.pi/boss/**`"))
        XCTAssertTrue(definition.contains("Never run `git clean`, `git branch -D`"))
        XCTAssertTrue(definition.contains("closeout=pass | needs-action | blocked"))
    }

    func testBossPromptRequiresSecretaryCloseoutAndNoUnclassifiedItems() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(
            "pipiui-boss-closeout-\(UUID().uuidString)",
            isDirectory: true
        )
        defer { try? FileManager.default.removeItem(at: dir) }
        let path = try XCTUnwrap(BossPrompt.install(into: dir))
        let text = try String(contentsOfFile: path, encoding: .utf8)

        XCTAssertTrue(text.contains("## Closeout hard gate"))
        XCTAssertTrue(text.contains("subagent_status"))
        XCTAssertTrue(text.contains("MUST dispatch `secretary`"))
        XCTAssertTrue(text.contains("No final success while any relevant agent"))
        XCTAssertTrue(text.contains("unclassified"))
        XCTAssertTrue(text.contains("`closeout=pass` plus required integration verification"))
        XCTAssertTrue(text.contains("clean T1"))
        XCTAssertTrue(text.contains("`needs-fixer`"))
    }

    func testSafeEligibilityClassifiesMergedUniqueDirtyAndNonInternal() throws {
        let (repo, cleanup) = try makeRepository()
        defer { cleanup() }

        let merged = "pipiui/agent-merged"
        _ = try GitRepo.run(gitArgs: ["branch", merged], in: repo)
        let mergedState = GitRepo.reconcileAgentBranch(
            merged,
            persistedWorktreePath: repo.appendingPathComponent(".pi/worktrees/old").path,
            in: repo
        )
        XCTAssertEqual(mergedState.disposition, .eligible)
        XCTAssertTrue(mergedState.persistedWorktreeIsStale)

        let deleteResult = GitRepo.safelyDeleteMergedAgentBranch(merged, in: repo)
        guard case .deleted = deleteResult else {
            return XCTFail("expected safe non-force deletion, got \(deleteResult)")
        }
        XCTAssertThrowsError(
            try GitRepo.run(
                gitArgs: ["show-ref", "--verify", "--quiet", "refs/heads/\(merged)"],
                in: repo
            )
        )

        let uniquePath = repo.appendingPathComponent("unique-wt", isDirectory: true)
        let unique = "pipiui/agent-unique"
        try GitRepo.worktreeAdd(branch: unique, at: uniquePath, in: repo)
        try "unique\n".write(
            to: uniquePath.appendingPathComponent("unique.txt"),
            atomically: true,
            encoding: .utf8
        )
        _ = try GitRepo.run(gitArgs: ["add", "unique.txt"], in: uniquePath)
        _ = try GitRepo.run(gitArgs: ["commit", "-m", "unique"], in: uniquePath)
        try GitRepo.worktreeRemove(at: uniquePath, in: repo, force: false)
        XCTAssertEqual(
            GitRepo.reconcileAgentBranch(unique, in: repo).disposition,
            .retainedUniqueCommits
        )

        let dirtyPath = repo.appendingPathComponent("dirty-wt", isDirectory: true)
        let dirty = "pipiui/agent-dirty"
        try GitRepo.worktreeAdd(branch: dirty, at: dirtyPath, in: repo)
        try "dirty\n".write(
            to: dirtyPath.appendingPathComponent("dirty.txt"),
            atomically: true,
            encoding: .utf8
        )
        let dirtyState = GitRepo.reconcileAgentBranch(dirty, in: repo)
        let canonicalDirtyPath = dirtyPath.standardizedFileURL
            .resolvingSymlinksInPath().path
        XCTAssertEqual(
            dirtyState.disposition,
            .retainedRegisteredWorktree(path: canonicalDirtyPath, dirty: true)
        )
        guard case .retained = GitRepo.safelyDeleteMergedAgentBranch(dirty, in: repo) else {
            return XCTFail("dirty registered worktree must remain retained")
        }

        let external = "feature/not-runtime-owned"
        _ = try GitRepo.run(gitArgs: ["branch", external], in: repo)
        XCTAssertEqual(
            GitRepo.reconcileAgentBranch(external, in: repo).disposition,
            .retainedNonInternal
        )
    }

    func testSuccessfulMergeRemovesWorktreeAndInternalBranch() async throws {
        let (repo, cleanup) = try makeRepository()
        defer { cleanup() }
        let branch = "pipiui/agent-success"
        let worktree = repo.appendingPathComponent("success-wt", isDirectory: true)
        try GitRepo.worktreeAdd(branch: branch, at: worktree, in: repo)
        try "integrated\n".write(
            to: worktree.appendingPathComponent("success.txt"),
            atomically: true,
            encoding: .utf8
        )
        _ = try GitRepo.run(gitArgs: ["add", "success.txt"], in: worktree)
        _ = try GitRepo.run(gitArgs: ["commit", "-m", "agent success"], in: worktree)

        let store = SubagentStore()
        store.bindMainProject(repo)
        store.handle(startEvent(id: "success", path: worktree.path, branch: branch))
        store.handle(J(endEvent(
            id: "success", path: worktree.path, branch: branch, ok: true
        )))
        try await waitUntil {
            store.agents.first?.worktreeLifecycle == .merged
        }

        XCTAssertTrue(
            FileManager.default.fileExists(
                atPath: repo.appendingPathComponent("success.txt").path
            )
        )
        XCTAssertFalse(FileManager.default.fileExists(atPath: worktree.path))
        XCTAssertThrowsError(
            try GitRepo.run(
                gitArgs: ["show-ref", "--verify", "--quiet", "refs/heads/\(branch)"],
                in: repo
            )
        )
        XCTAssertEqual(store.agents.first?.closeoutDisposition, .cleaned)
        XCTAssertNil(store.worktreeActionError)
    }

    func testCleanupFailureIsSurfacedWithoutUndoingSuccessfulMerge() async throws {
        let (repo, cleanup) = try makeRepository()
        defer { cleanup() }
        let branch = "feature/agent-but-not-runtime-owned"
        let worktree = repo.appendingPathComponent("retained-wt", isDirectory: true)
        try GitRepo.worktreeAdd(branch: branch, at: worktree, in: repo)
        try "integrated\n".write(
            to: worktree.appendingPathComponent("retained.txt"),
            atomically: true,
            encoding: .utf8
        )
        _ = try GitRepo.run(gitArgs: ["add", "retained.txt"], in: worktree)
        _ = try GitRepo.run(gitArgs: ["commit", "-m", "non-internal branch"], in: worktree)

        let store = SubagentStore()
        store.bindMainProject(repo)
        store.handle(startEvent(id: "retained", path: worktree.path, branch: branch))
        store.handle(J(endEvent(
            id: "retained", path: worktree.path, branch: branch, ok: true
        )))
        try await waitUntil {
            store.agents.first?.worktreeLifecycle == .mergedCleanupPending
        }

        XCTAssertTrue(
            FileManager.default.fileExists(
                atPath: repo.appendingPathComponent("retained.txt").path
            ),
            "integration must remain successful"
        )
        XCTAssertFalse(FileManager.default.fileExists(atPath: worktree.path))
        XCTAssertNoThrow(
            try GitRepo.run(
                gitArgs: ["show-ref", "--verify", "--quiet", "refs/heads/\(branch)"],
                in: repo
            ),
            "unsafe/non-internal branch must remain"
        )
        XCTAssertEqual(store.agents.first?.closeoutDisposition, .needsFixer)
        XCTAssertTrue(store.agents.first?.worktreeError?.contains("已保留") == true)
        XCTAssertTrue(store.worktreeActionError?.contains("已合并并删除 worktree") == true)
    }

    func testUncommittedLeftoverIsRetainedWhenAutomaticCommitFails() async throws {
        let (repo, cleanup) = try makeRepository()
        defer { cleanup() }
        let branch = "pipiui/agent-leftover"
        let worktree = repo.appendingPathComponent("leftover-wt", isDirectory: true)
        try GitRepo.worktreeAdd(branch: branch, at: worktree, in: repo)

        let hook = repo.appendingPathComponent(".git/hooks/pre-commit")
        try "#!/bin/sh\nexit 1\n".write(
            to: hook,
            atomically: true,
            encoding: .utf8
        )
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o755],
            ofItemAtPath: hook.path
        )
        try "unexplained\n".write(
            to: worktree.appendingPathComponent("unexplained.tmp"),
            atomically: true,
            encoding: .utf8
        )

        let store = SubagentStore()
        store.bindMainProject(repo)
        store.handle(startEvent(id: "leftover", path: worktree.path, branch: branch))
        store.handle(J(endEvent(
            id: "leftover", path: worktree.path, branch: branch, ok: true
        )))
        try await waitUntil {
            store.worktreeActionError?.contains("未提交/未分类文件") == true
        }

        XCTAssertTrue(FileManager.default.fileExists(atPath: worktree.path))
        XCTAssertFalse(
            FileManager.default.fileExists(
                atPath: repo.appendingPathComponent("unexplained.tmp").path
            )
        )
        XCTAssertEqual(store.agents.first?.worktreeLifecycle, .pendingReview)
        XCTAssertEqual(store.agents.first?.closeoutDisposition, .needsFixer)
        XCTAssertNoThrow(
            try GitRepo.run(
                gitArgs: ["show-ref", "--verify", "--quiet", "refs/heads/\(branch)"],
                in: repo
            )
        )
    }

    func testFailedVerifyFailedAndInterruptedAgentsRemainRetained() throws {
        let failedStore = SubagentStore()
        failedStore.handle(startEvent(
            id: "failed", path: "/tmp/pipiui-failed", branch: "pipiui/agent-failed"
        ))
        failedStore.handle(J(endEvent(
            id: "failed",
            path: "/tmp/pipiui-failed",
            branch: "pipiui/agent-failed",
            ok: false
        )))
        XCTAssertEqual(failedStore.agents.first?.worktreeLifecycle, .pendingReview)
        XCTAssertEqual(failedStore.agents.first?.closeoutDisposition, .retained)

        let verifyStore = SubagentStore()
        verifyStore.handle(startEvent(
            id: "verify", path: "/tmp/pipiui-verify", branch: "pipiui/agent-verify"
        ))
        var verifyEnd = endEvent(
            id: "verify",
            path: "/tmp/pipiui-verify",
            branch: "pipiui/agent-verify",
            ok: true
        )
        verifyEnd["verifyCommand"] = "swift test"
        verifyEnd["verifyExit"] = 1
        verifyStore.handle(J(verifyEnd))
        XCTAssertEqual(verifyStore.agents.first?.worktreeLifecycle, .pendingReview)
        XCTAssertEqual(verifyStore.agents.first?.closeoutDisposition, .retained)

        let running = SubagentInfo(
            id: "interrupted",
            parentId: nil,
            name: "general-purpose",
            task: "work",
            depth: 1,
            model: nil,
            worktreePath: "/tmp/pipiui-interrupted",
            worktreeBranch: "pipiui/agent-interrupted",
            worktreeLifecycle: .active
        )
        let reconciled = SubagentStore.reconcileInterruptedAfterRestart([running])
        XCTAssertEqual(reconciled.first?.state, .interrupted)
        XCTAssertEqual(reconciled.first?.worktreeLifecycle, .pendingReview)
        XCTAssertEqual(reconciled.first?.closeoutDisposition, .retained)
    }

    private func repositoryRoot() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    private func makeRepository() throws -> (URL, () -> Void) {
        guard GitRepo.findGitExecutable() != nil else {
            throw XCTSkip("git not available")
        }
        let repo = FileManager.default.temporaryDirectory.appendingPathComponent(
            "pipiui-closeout-\(UUID().uuidString)",
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

    private func startEvent(
        id: String,
        path: String,
        branch: String
    ) -> J {
        J([
            "kind": "start",
            "agentId": id,
            "name": "general-purpose",
            "task": "impl",
            "depth": 1,
            "worktreePath": path,
            "worktreeBranch": branch,
        ] as [String: Any])
    }

    private func endEvent(
        id: String,
        path: String,
        branch: String,
        ok: Bool
    ) -> [String: Any] {
        [
            "kind": "end",
            "agentId": id,
            "ok": ok,
            "worktreePath": path,
            "worktreeBranch": branch,
        ]
    }

    private func waitUntil(
        timeout: TimeInterval = 10,
        _ predicate: @escaping @MainActor () -> Bool
    ) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !predicate() && Date() < deadline {
            try await Task.sleep(nanoseconds: 25_000_000)
        }
        XCTAssertTrue(predicate(), "timed out waiting for async closeout state")
    }
}
