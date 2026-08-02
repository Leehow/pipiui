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
        XCTAssertTrue(secretary.tools.contains("secretary_commit"))
        XCTAssertTrue(ToolSkillCatalog.builtinTools.contains(where: {
            $0.name == "secretary_commit"
        }))

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
        XCTAssertTrue(runtime.contains("secretaryToolCallBlock"))
        XCTAssertTrue(runtime.contains("pi.on(\"tool_call\""))
        XCTAssertTrue(runtime.contains("name: \"secretary_commit\""))
        XCTAssertTrue(runtime.contains("runSecretaryCommit"))

        let definition = try String(
            contentsOf: root.appendingPathComponent(
                "Sources/PipiUI/PiExt/agents/secretary.md"
            ),
            encoding: .utf8
        )
        XCTAssertTrue(definition.contains("name: secretary"))
        XCTAssertTrue(definition.contains("only `.pi/boss/**`"))
        XCTAssertTrue(definition.contains("Never run raw `git add`, `git commit`"))
        XCTAssertTrue(definition.contains("closeout=pass | needs-action | blocked"))
        XCTAssertTrue(definition.contains("commit=created:<sha>"))
        XCTAssertTrue(definition.contains("secretary_commit"))
    }

    func testBossPromptOwnsCompletionAndUsesSecretaryOnlyForAmbiguity() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(
            "pipiui-boss-closeout-\(UUID().uuidString)",
            isDirectory: true
        )
        defer { try? FileManager.default.removeItem(at: dir) }
        let path = try XCTUnwrap(BossPrompt.install(into: dir))
        let text = try String(contentsOfFile: path, encoding: .utf8)

        XCTAssertTrue(text.contains("Research / analysis-only requests are terminal"))
        XCTAssertTrue(text.contains("never completion of a change request"))
        XCTAssertTrue(text.contains("immediately dispatch the general-purpose worker(s)"))
        XCTAssertTrue(text.contains("[subagent-done]"))
        XCTAssertTrue(text.contains("## Automatic execution routing (highest priority)"))
        XCTAssertTrue(text.contains("Execution routing is not a user product"))
        XCTAssertTrue(text.contains("automatically select the"))
        XCTAssertTrue(text.contains("multi-agent/subagent execution route"))
        XCTAssertTrue(text.contains("immediately dispatch the appropriate"))
        XCTAssertTrue(text.contains("general-purpose worker(s)"))
        XCTAssertTrue(text.contains("MUST NOT present, relay, or ask the user"))
        XCTAssertTrue(text.contains("execution-mode menu"))
        XCTAssertTrue(text.contains("ignore it and continue with worker dispatch"))
        XCTAssertTrue(text.contains("MUST NOT pause for confirmation"))
        XCTAssertTrue(text.contains("do it yourself, no subagents"))
        XCTAssertTrue(text.contains("## Completion ownership and optional audit"))
        XCTAssertTrue(text.contains("The Boss owns the completion decision"))
        XCTAssertTrue(text.contains("Routine research and clean, uncontested work do not require"))
        XCTAssertTrue(text.contains("only as an optional audit/reconciliation helper"))
        XCTAssertTrue(text.contains("Its verdict"))
        XCTAssertTrue(text.contains("is advisory"))
        XCTAssertTrue(text.contains("A secretary-controlled commit is never a"))
        XCTAssertTrue(text.contains("subagent_status"))
        XCTAssertFalse(text.contains("## Closeout hard gate"))
        XCTAssertFalse(text.contains("MUST dispatch `secretary`"))
        XCTAssertFalse(text.contains("secretary-controlled commit gate"))
        XCTAssertFalse(text.contains("`closeout=pass` plus required integration verification"))
        XCTAssertFalse(text.contains("Open every task with one line"))
    }

    func testBossPromptContinuesAutonomouslyUnlessAuthorityIsActuallyNeeded() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(
            "pipiui-boss-confirmation-\(UUID().uuidString)",
            isDirectory: true
        )
        defer { try? FileManager.default.removeItem(at: dir) }
        let path = try XCTUnwrap(BossPrompt.install(into: dir))
        let text = try String(contentsOfFile: path, encoding: .utf8)

        XCTAssertTrue(text.contains(
            "## Autonomous continuation and minimal confirmation gate (highest priority)"
        ))
        XCTAssertTrue(text.contains(
            "requested a fix or implementation"
        ))
        XCTAssertTrue(text.contains(
            "within that scope is established"
        ))
        XCTAssertTrue(text.contains(
            "MUST NOT ask them to reply \"fix\", \"continue\", \"start\""
        ))
        XCTAssertTrue(text.contains(
            "safe, reversible, within the"
        ))
        XCTAssertTrue(text.contains(
            "derivable from repository or conversation evidence"
        ))
        XCTAssertTrue(text.contains("review feedback"))
        XCTAssertTrue(text.contains("internal spec rebaselining"))
        XCTAssertTrue(text.contains("worker failure recovery"))
        XCTAssertTrue(text.contains(
            "adopt the most conservative interpretation"
        ))
        XCTAssertTrue(text.contains("update the internal ledger"))
        XCTAssertTrue(text.contains(
            "immediately dispatch implementation"
        ))
        XCTAssertTrue(text.contains(
            "do not relay that request"
        ))
        XCTAssertTrue(text.contains(
            "Ask exactly one minimal question only when"
        ))
        XCTAssertTrue(text.contains(
            "materially change user-visible product behavior"
        ))
        XCTAssertTrue(text.contains(
            "a new authorization is needed for an external or irreversible"
        ))
        XCTAssertTrue(text.contains(
            "explicit user requirements conflict with no safe"
        ))
        XCTAssertTrue(text.contains(
            "are never by themselves reasons to ask"
        ))
        XCTAssertTrue(text.contains(
            "exhaust repository and conversation evidence"
        ))
        XCTAssertTrue(text.contains(
            "never ask a generic \"should I continue?\""
        ))
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

    func testConfirmedDiscardDeletesInternalUniqueBranchButRetainsNonInternal() async throws {
        let (repo, cleanup) = try makeRepository()
        defer { cleanup() }

        let internalBranch = "pipiui/agent-confirmed-discard"
        let internalWorktree = repo.appendingPathComponent(
            "confirmed-discard-wt",
            isDirectory: true
        )
        try GitRepo.worktreeAdd(branch: internalBranch, at: internalWorktree, in: repo)
        try "unique\n".write(
            to: internalWorktree.appendingPathComponent("unique-discard.txt"),
            atomically: true,
            encoding: .utf8
        )
        _ = try GitRepo.run(gitArgs: ["add", "unique-discard.txt"], in: internalWorktree)
        _ = try GitRepo.run(gitArgs: ["commit", "-m", "unique discard"], in: internalWorktree)

        let internalStore = SubagentStore()
        internalStore.bindMainProject(repo)
        internalStore.handle(startEvent(
            id: "confirmed-discard",
            path: internalWorktree.path,
            branch: internalBranch
        ))
        internalStore.handle(J(endEvent(
            id: "confirmed-discard",
            path: internalWorktree.path,
            branch: internalBranch,
            ok: false
        )))
        let internalDiscardError = await internalStore.discardWorktree(
            agentId: "confirmed-discard",
            mainProjectURL: repo
        )
        XCTAssertNil(internalDiscardError)
        XCTAssertFalse(FileManager.default.fileExists(atPath: internalWorktree.path))
        XCTAssertThrowsError(
            try GitRepo.run(
                gitArgs: ["show-ref", "--verify", "--quiet", "refs/heads/\(internalBranch)"],
                in: repo
            )
        )
        XCTAssertEqual(internalStore.agents.first?.closeoutDisposition, .cleaned)

        let externalBranch = "feature/confirmed-discard-retained"
        let externalWorktree = repo.appendingPathComponent(
            "external-discard-wt",
            isDirectory: true
        )
        try GitRepo.worktreeAdd(branch: externalBranch, at: externalWorktree, in: repo)
        try "external\n".write(
            to: externalWorktree.appendingPathComponent("external-discard.txt"),
            atomically: true,
            encoding: .utf8
        )
        _ = try GitRepo.run(gitArgs: ["add", "external-discard.txt"], in: externalWorktree)
        _ = try GitRepo.run(gitArgs: ["commit", "-m", "external discard"], in: externalWorktree)

        let externalStore = SubagentStore()
        externalStore.bindMainProject(repo)
        externalStore.handle(startEvent(
            id: "external-discard",
            path: externalWorktree.path,
            branch: externalBranch
        ))
        externalStore.handle(J(endEvent(
            id: "external-discard",
            path: externalWorktree.path,
            branch: externalBranch,
            ok: false
        )))
        let externalDiscardError = await externalStore.discardWorktree(
            agentId: "external-discard",
            mainProjectURL: repo
        )
        XCTAssertNil(externalDiscardError)
        XCTAssertFalse(FileManager.default.fileExists(atPath: externalWorktree.path))
        XCTAssertNoThrow(
            try GitRepo.run(
                gitArgs: ["show-ref", "--verify", "--quiet", "refs/heads/\(externalBranch)"],
                in: repo
            )
        )
        XCTAssertEqual(externalStore.agents.first?.closeoutDisposition, .retained)
        XCTAssertTrue(externalStore.agents.first?.worktreeError?.contains("不属于") == true)
    }

    func testSecretaryRuntimePolicyBlocksOutOfScopeWritesAndDestructiveShell() throws {
        let node = Process()
        node.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        let root = repositoryRoot()
        let policy = root.appendingPathComponent(
            "Sources/PipiUI/PiExt/subagent/secretary-policy.ts"
        )
        let main = FileManager.default.temporaryDirectory.appendingPathComponent(
            "pipiui-secretary-policy-\(UUID().uuidString)",
            isDirectory: true
        )
        let boss = main.appendingPathComponent(".pi/boss", isDirectory: true)
        let outside = main.appendingPathComponent("outside", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: main) }
        try FileManager.default.createDirectory(at: boss, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(
            at: boss.appendingPathComponent("escape"),
            withDestinationURL: outside
        )

        node.arguments = [
            "node",
            "--experimental-strip-types",
            "--input-type=module",
            "--eval",
            #"""
            import assert from "node:assert/strict";
            import path from "node:path";
            const { secretaryToolCallBlock } = await import(process.env.POLICY_MODULE);
            const main = process.env.SECRETARY_MAIN;
            const call = (toolName, input, role = "closeout-secretary") =>
                secretaryToolCallBlock(role, { toolName, input }, main);

            assert.equal(call("write", { file_path: path.join(main, ".pi/boss/state.json") }), undefined);
            assert.equal(call("edit", { path: path.join(main, ".pi/boss/nested/report.md") }), undefined);
            assert.ok(call("write", {}));
            assert.ok(call("edit", { file_path: "relative.md" }));
            assert.ok(call("write", { file_path: path.join(main, "outside/report.md") }));
            assert.ok(call("write", { file_path: `${main}/.pi/boss/../escape.md` }));
            assert.ok(call("write", { file_path: path.join(main, ".pi/boss/escape/report.md") }));

            for (const command of [
                "git clean -fd",
                `git -C "${main}" reset --hard`,
                "git restore .",
                "git checkout -- file",
                "git stash",
                "git merge topic",
                "git cherry-pick HEAD",
                "git rebase main",
                "git push origin main",
                "git add accepted.txt",
                "git commit -m accepted",
                "git commit -am accepted",
                "git update-ref refs/heads/topic HEAD",
                "git update-index --add accepted.txt",
                "git rm accepted.txt",
                "git mv old.txt new.txt",
                "git worktree add ../other topic",
                "git branch topic",
                "git branch -D pipiui/agent-old",
                "rm -rf .pi/boss/old",
                "  rm -rf .pi/boss/old",
                "find . -delete",
            ]) assert.ok(call("bash", { command }), command);

            for (const command of [
                "git status --short",
                "git log -1 --oneline",
                "git worktree list --porcelain",
                "git branch -d pipiui/agent-old",
            ]) assert.equal(call("bash", { command }), undefined, command);

            assert.equal(call("secretary_commit", {}), undefined);
            assert.equal(
                call("write", { file_path: path.join(main, "outside/worker.md") }, "worker"),
                undefined,
            );
            """#,
        ]
        var environment = ProcessInfo.processInfo.environment
        environment["POLICY_MODULE"] = policy.absoluteString
        environment["SECRETARY_MAIN"] = main.path
        node.environment = environment
        let stderr = Pipe()
        node.standardError = stderr
        try node.run()
        node.waitUntilExit()
        let errorText = String(
            data: stderr.fileHandleForReading.readDataToEndOfFile(),
            encoding: .utf8
        ) ?? ""
        XCTAssertEqual(node.terminationStatus, 0, errorText)
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
