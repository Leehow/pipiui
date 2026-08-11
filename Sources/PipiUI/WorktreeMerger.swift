import Foundation

/// Background Git outcome consumed by `SubagentStore`'s existing closeout state machine.
package enum MergeGitOutcome: Sendable {
    case waitingForMain(String)
    case blocked(String)
    case ok
    case zeroChangeCleaned
    case mergeFailed(String)
    case removeFailed(String)
    case cleanupFailed(String)
}

/// Result of the strict, non-merging maintenance cleanup path.
///
/// This path never stages, commits, merges, resets, stashes, or force-removes. It only
/// removes a registered, clean runtime worktree whose branch is already reachable from
/// the integration HEAD, then uses `GitRepo.safelyDeleteMergedAgentBranch` for the ref.
package enum AlreadyMergedWorktreeCleanupOutcome: Equatable, Sendable {
    case cleaned
    case alreadyAbsent
    case skipped(String)
    case removeFailed(String)
    case cleanupFailed(String)
}

/// Shared worktree merge/cleanup engine used by both `SubagentStore.mergeWorktree` and
/// the non-UI maintenance entry point. Keeping the Git mutation here prevents the CLI
/// from bypassing the App's safety guards.
package enum WorktreeMerger {
    package static func mergeWorktree(
        agentID: String,
        branch: String,
        worktreePath: String,
        mainProjectURL: URL
    ) -> MergeGitOutcome {
        let worktreeURL = URL(fileURLWithPath: worktreePath, isDirectory: true)
        guard GitRepo.probe(workTree: worktreeURL).isRepo else {
            return .mergeFailed("worktree 不存在或不是 git 仓库；无法合并")
        }

        // This branch needs no merge only when its worktree is already clean. Check that
        // path before the main-WIP overlap gate: cleanup never changes the main checkout,
        // so user WIP cannot be clobbered. A dirty worker retains the established App flow
        // below, which first attempts its documented best-effort commit rather than losing
        // the precise pending-review/recovery classification.
        if !GitRepo.probe(workTree: worktreeURL).isDirty,
           GitRepo.isAncestor(branch, of: "HEAD", in: mainProjectURL) {
            switch cleanupAlreadyMergedWorktree(
                branch: branch,
                worktreePath: worktreePath,
                in: mainProjectURL
            ) {
            case .cleaned, .alreadyAbsent:
                return .zeroChangeCleaned
            case .skipped(let reason):
                return .mergeFailed("已合并分支不满足安全清理条件；已保留: \(reason)")
            case .removeFailed(let message):
                return .removeFailed(message)
            case .cleanupFailed(let message):
                return .cleanupFailed(message)
            }
        }

        // Read-only WIP gate. Never merge into an overlapping or unobservable main tree.
        switch GitRepo.mergeReadiness(
            branch: branch,
            workerWorkTree: worktreeURL,
            in: mainProjectURL
        ) {
        case .ready:
            break
        case .waitingForMain(let paths):
            return .waitingForMain(paths.joined(separator: ", "))
        case .blocked(let reason):
            return .blocked(reason)
        }

        // Best-effort: preserve normal App merge behavior for unintegrated worker work.
        _ = GitRepo.commitAllIfDirty(
            in: worktreeURL,
            message: "pipiui: agent \(agentID) work"
        )
        // Never force-remove unexplained leftovers after a failed commit attempt.
        if GitRepo.probe(workTree: worktreeURL).isDirty {
            return .mergeFailed(
                "agent worktree 提交后仍有未提交/未分类文件；已保留，禁止自动清理"
            )
        }
        do {
            try GitRepo.mergeBranch(branch, into: mainProjectURL)
        } catch {
            return .mergeFailed(errorMessage(error))
        }
        do {
            try GitRepo.worktreeRemove(at: worktreeURL, in: mainProjectURL, force: false)
        } catch {
            return .removeFailed(errorMessage(error))
        }
        let cleanup = GitRepo.safelyDeleteMergedAgentBranch(
            branch,
            persistedWorktreePath: worktreePath,
            integrationRef: "HEAD",
            in: mainProjectURL
        )
        if let warning = cleanup.warning, !warning.isEmpty {
            return .cleanupFailed(warning)
        }
        return .ok
    }

    /// Cleanup-only route for a branch whose tip has already been integrated. Every
    /// rejection returns `.skipped` before a Git mutation, preserving dirty, unique,
    /// unregistered, or non-runtime-owned worktrees exactly as found.
    package static func cleanupAlreadyMergedWorktree(
        branch: String,
        worktreePath: String,
        in mainProjectURL: URL
    ) -> AlreadyMergedWorktreeCleanupOutcome {
        guard let canonicalWorktreePath = canonicalAbsolutePath(worktreePath) else {
            return .skipped("非法 worktree 路径")
        }
        let normalizedBranch = branch.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedBranch.isEmpty, !normalizedBranch.hasPrefix("-") else {
            return .skipped("非法 agent 分支名")
        }
        guard GitRepo.probe(workTree: mainProjectURL).isRepo else {
            return .skipped("无法确认主仓 Git 状态")
        }

        let state = GitRepo.reconcileAgentBranch(
            normalizedBranch,
            persistedWorktreePath: canonicalWorktreePath,
            integrationRef: "HEAD",
            in: mainProjectURL
        )

        switch state.disposition {
        case .alreadyAbsent:
            guard !FileManager.default.fileExists(atPath: canonicalWorktreePath) else {
                return .skipped("分支已不存在，但记录的 worktree 路径仍存在")
            }
            return .alreadyAbsent

        case .retainedRegisteredWorktree(let registeredPath, _):
            guard registeredPath == canonicalWorktreePath else {
                return .skipped("注册的 worktree 路径与 agent 记录不一致")
            }
            guard state.branchExists else {
                return .skipped("无法确认 agent 分支 ref")
            }
            let worktreeURL = URL(fileURLWithPath: canonicalWorktreePath, isDirectory: true)
            let worktreeStatus = GitRepo.probe(workTree: worktreeURL)
            guard worktreeStatus.isRepo else {
                return .skipped("注册的 worktree 不可用")
            }
            guard !worktreeStatus.isDirty else {
                return .skipped("worktree 含未提交改动")
            }
            guard GitRepo.isAncestor(normalizedBranch, of: "HEAD", in: mainProjectURL) else {
                return .skipped("分支 tip 不是 integration HEAD 的祖先（含独有提交或无法证明）")
            }

            do {
                try GitRepo.worktreeRemove(at: worktreeURL, in: mainProjectURL, force: false)
            } catch {
                return .removeFailed(errorMessage(error))
            }

            let cleanup = GitRepo.safelyDeleteMergedAgentBranch(
                normalizedBranch,
                persistedWorktreePath: canonicalWorktreePath,
                integrationRef: "HEAD",
                in: mainProjectURL
            )
            if let warning = cleanup.warning, !warning.isEmpty {
                return .cleanupFailed(warning)
            }

            let verified = GitRepo.reconcileAgentBranch(
                normalizedBranch,
                persistedWorktreePath: canonicalWorktreePath,
                integrationRef: "HEAD",
                in: mainProjectURL
            )
            guard verified.registeredWorktreePath == nil, !verified.branchExists else {
                return .cleanupFailed("清理后验证失败：worktree 或 branch ref 仍存在")
            }
            return .cleaned

        case .eligible:
            return .skipped("agent 分支未注册到请求的 worktree")
        case .retainedNonInternal:
            return .skipped("分支不属于 pipiui/ runtime namespace")
        case .retainedUniqueCommits:
            return .skipped("分支仍含未进入 integration HEAD 的独有提交")
        case .blocked(let reason):
            return .skipped("无法安全确认 Git 状态: \(reason)")
        }
    }

    private static func canonicalAbsolutePath(_ rawPath: String) -> String? {
        let trimmed = rawPath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.hasPrefix("-"), trimmed.hasPrefix("/") else {
            return nil
        }
        return URL(fileURLWithPath: trimmed, isDirectory: true)
            .standardizedFileURL
            .resolvingSymlinksInPath()
            .path
    }

    private static func errorMessage(_ error: Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }
}
