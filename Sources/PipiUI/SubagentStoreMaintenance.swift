import Foundation

/// Terminal result for one requested maintenance cleanup. The legacy command treats only
/// `.cleaned` and `.alreadyAbsent` as successful/idempotent completion.
package enum MergedWorktreeMaintenanceStatus: Equatable, Sendable {
    case cleaned
    case alreadyAbsent
    case skipped
    case failed
}

package struct MergedWorktreeMaintenanceResult: Equatable, Sendable {
    package let agentID: String
    package let status: MergedWorktreeMaintenanceStatus
    package let detail: String

    package init(agentID: String, status: MergedWorktreeMaintenanceStatus, detail: String) {
        self.agentID = agentID
        self.status = status
        self.detail = detail
    }
}

/// Terminal result for the narrow, code-reviewed historical-worktree closeout command.
package enum ReviewedWorktreeMaintenanceStatus: Equatable, Sendable {
    case cleaned
    case alreadyAbsent
    case skipped
    case failed
}

package struct ReviewedWorktreeMaintenanceResult: Equatable, Sendable {
    package let agentID: String
    package let branch: String
    package let status: ReviewedWorktreeMaintenanceStatus
    package let detail: String

    package init(
        agentID: String,
        branch: String,
        status: ReviewedWorktreeMaintenanceStatus,
        detail: String
    ) {
        self.agentID = agentID
        self.branch = branch
        self.status = status
        self.detail = detail
    }
}

/// Emitted by the formal maintenance API immediately before a reviewed dirty worktree is
/// removed. The CLI prints this before the destructive Git lifecycle action, so reviewers
/// can see both the actual dirty files and the matching manifest reason in its audit log.
package enum ReviewedWorktreeMaintenanceEvent: Equatable, Sendable {
    case dirtyWorktree(agentID: String, paths: [String], reviewReason: String)
}

/// One exact historical artifact approved for closeout. This is deliberately code data,
/// never parsed from a user-supplied CLI file. `expectedTip` pins the ref that was reviewed.
package struct ReviewedWorktreeMaintenanceEntry: Equatable, Sendable {
    package let agentID: String
    package let branch: String
    package let expectedTip: String
    package let reviewReason: String
    package let basis: ReviewedWorktreeDiscardBasis
    /// Dirty removal is allowed only for an already-integrated branch and only when this
    /// explicit review bit is present in the manifest.
    package let allowsDirtyWorktree: Bool
    /// The sole branch-only closeout: no worktree/path may remain at execution time.
    package let orphanCloseout: Bool

    package init(
        agentID: String,
        branch: String,
        expectedTip: String,
        reviewReason: String,
        basis: ReviewedWorktreeDiscardBasis,
        allowsDirtyWorktree: Bool = false,
        orphanCloseout: Bool = false
    ) {
        self.agentID = agentID
        self.branch = branch
        self.expectedTip = expectedTip
        self.reviewReason = reviewReason
        self.basis = basis
        self.allowsDirtyWorktree = allowsDirtyWorktree
        self.orphanCloseout = orphanCloseout
    }
}

/// The entire scope of `pipiui-maintenance discard-reviewed-worktrees`.
///
/// There is intentionally no CLI flag that accepts a branch, SHA, reason, or force mode.
/// Adding a new superseded closeout requires a source change and review of this constant.
package enum ReviewedWorktreeMaintenanceManifest {
    package static let entries: [ReviewedWorktreeMaintenanceEntry] = [
        entry(
            "agent-7de2949bc92c9b1e", "a42d5f3177e0b8f7835a4b0f6446ccc494100dd0",
            "Read-only review: clean branch patch is already represented by current integration history.",
            .cherryEquivalent
        ),
        entry(
            "appkit-single-anchor", "b6a4ba78b6b52be2f9bc28bf7c57b0a357a40e0c",
            "Read-only review: both clean AppKit anchor commits are patch-equivalent to integration.",
            .cherryEquivalent
        ),
        entry(
            "opencode-go-quota", "0e8c6fd39e0c502f60084e39264e5cdd7a9a9e40",
            "Read-only review: clean quota change is patch-equivalent to integration.",
            .cherryEquivalent
        ),
        entry(
            "opencode-go-integrate", "dfd12eaf7097a543f1515d5f9aa80e1b938358d7",
            "Read-only review: clean OpenCode integration change is patch-equivalent to integration.",
            .cherryEquivalent
        ),
        entry(
            "subagents-sort", "f02f5312eab682655c17c75f33731b6c06bd411a",
            "Read-only review: clean historical ordering experiment is superseded by later orchestration work.",
            .explicitlySuperseded
        ),
        entry(
            "subagent-loop-close", "6a2ab2a10511033a3e8b03ccbb7708bec6eb0b50",
            "Read-only review: clean loop-close attempt is superseded by later closeout/recovery integration.",
            .explicitlySuperseded
        ),
        entry(
            "merge-recovery-v2", "250642d6fa07662022bc2af39acc244e93cf6a2c",
            "Read-only review: clean v2 merge-recovery attempt is superseded by later recovery lifecycle work.",
            .explicitlySuperseded
        ),
        entry(
            "agent-b39698e8c52ff202", "2e7fc7007c53047c2c525bf82fceca4baf500446",
            "Read-only review: clean historical agent artifact is superseded by current integration behavior.",
            .explicitlySuperseded
        ),
        entry(
            "stream-diag-log", "f5f4d058b1aff1ec01584465c2bd9988273d6898",
            "Read-only review: orphan diagnostic ref is superseded and has no registered worktree.",
            .explicitlySuperseded,
            orphanCloseout: true
        ),
        entry(
            "tighten-gap", "79468a8539ed7effa95a0c6b8f2eba5b4fce1805",
            "Read-only review: clean gap-tightening experiment is superseded by later integrated work.",
            .explicitlySuperseded
        ),
        entry(
            "rail-scrollbar-fix", "f8c91ff2760488330def077cea326a5764984939",
            "Read-only review: clean scrollbar fix is superseded by the later navigation-rail implementation.",
            .explicitlySuperseded
        ),
        entry(
            "rail-visual-check", "1965ac90b9b6abab189d2034ae4659603a74e236",
            "Reviewed integrated visual-check branch; dirty files are only rail screenshot artifacts (rail-*.png).",
            .integratedAncestor,
            allowsDirtyWorktree: true
        ),
        entry(
            "electron-ui-verify", "408cf26e6028b99f465ce9acbf6224af70e9ae87",
            "Reviewed integrated Electron UI verification branch; dirty index.js is a verification scratch artifact.",
            .integratedAncestor,
            allowsDirtyWorktree: true
        ),
        entry(
            "electron-scaffold", "408cf26e6028b99f465ce9acbf6224af70e9ae87",
            "Reviewed integrated Electron scaffold branch; dirty Electron/, build script, and setup files are duplicate scaffold WIP.",
            .integratedAncestor,
            allowsDirtyWorktree: true
        ),
        entry(
            "host-contracts", "408cf26e6028b99f465ce9acbf6224af70e9ae87",
            "Reviewed integrated host-contract branch; dirty Electron/ content is duplicate generated scaffold work.",
            .integratedAncestor,
            allowsDirtyWorktree: true
        ),
        entry(
            "reuse-audit", "408cf26e6028b99f465ce9acbf6224af70e9ae87",
            "Reviewed integrated reuse-audit branch; dirty notices and docs are duplicate audit artifacts.",
            .integratedAncestor,
            allowsDirtyWorktree: true
        ),
        entry(
            "md-stream-table", "608b221df4bfc766f02db0c04b44af17989b1f54",
            "Reviewed integrated markdown-stream branch; dirty MarkdownView/test work is superseded by the integration tip.",
            .integratedAncestor,
            allowsDirtyWorktree: true
        ),
        entry(
            "hermes-compat", "608b221df4bfc766f02db0c04b44af17989b1f54",
            "Reviewed integrated Hermes compatibility branch; dirty package/test/script artifacts are duplicate follow-up work.",
            .integratedAncestor,
            allowsDirtyWorktree: true
        ),
        entry(
            "auto-merge-recovery", "096187178d2d61744312c857e6d38bcce18fd24f",
            "Reviewed integrated recovery branch; dirty GitRepo/SubagentStore edits are represented by later integration work.",
            .integratedAncestor,
            allowsDirtyWorktree: true
        ),
        entry(
            "boss-resolve-control", "608b221df4bfc766f02db0c04b44af17989b1f54",
            "Reviewed integrated boss-resolution branch; dirty closeout UI/extension/test changes are duplicate follow-up work.",
            .integratedAncestor,
            allowsDirtyWorktree: true
        ),
        entry(
            "memory-broker-core", "608b221df4bfc766f02db0c04b44af17989b1f54",
            "Reviewed integrated memory-broker branch; dirty broker source/tests are duplicate follow-up work.",
            .integratedAncestor,
            allowsDirtyWorktree: true
        ),
        entry(
            "opencode-web-usage-impl", "608b221df4bfc766f02db0c04b44af17989b1f54",
            "Reviewed integrated OpenCode web-usage branch; dirty quota/UI tests are duplicate follow-up work.",
            .integratedAncestor,
            allowsDirtyWorktree: true
        ),
        entry(
            "reminder-terminal-fix", "9c97d6ebefd7425ecf7712135ecbc0679c2e2718",
            "Reviewed integrated terminal-reminder branch; dirty extension/tests are duplicate follow-up work.",
            .integratedAncestor,
            allowsDirtyWorktree: true
        ),
        entry(
            "user-prompt-index-perf", "096187178d2d61744312c857e6d38bcce18fd24f",
            "Reviewed integrated prompt-index branch; dirty prompt-index/navigation source and tests are duplicate follow-up work.",
            .integratedAncestor,
            allowsDirtyWorktree: true
        ),
        entry(
            "toolbar-counts-impl", "cb55a5b9ca012ccfd4ef1c5c9028eb9fba8afc47",
            "Read-only review: clean source was ported into the main working tree; UpdateCenterSheet scroll/adaptive-height/outside-dismiss behavior and layout test pass.",
            .explicitlySuperseded
        ),
        entry(
            "uc-sheet-fix", "3f7cc3af3eca9c07e369be7c9ce77a8e18ce2359",
            "Read-only review: clean source was ported into the main working tree; DocumentTabsStore/WebTabsStore activityCount and ChatDetail rail badges pass target tests.",
            .explicitlySuperseded
        ),
    ]

    private static func entry(
        _ agentID: String,
        _ expectedTip: String,
        _ reviewReason: String,
        _ basis: ReviewedWorktreeDiscardBasis,
        allowsDirtyWorktree: Bool = false,
        orphanCloseout: Bool = false
    ) -> ReviewedWorktreeMaintenanceEntry {
        ReviewedWorktreeMaintenanceEntry(
            agentID: agentID,
            branch: "pipiui/\(agentID)",
            expectedTip: expectedTip,
            reviewReason: reviewReason,
            basis: basis,
            allowsDirtyWorktree: allowsDirtyWorktree,
            orphanCloseout: orphanCloseout
        )
    }
}

/// Non-UI maintenance surfaces for the same worktree lifecycle used by `SubagentStore`.
/// They read official persisted records but never hand-edit agents JSON. Git mutation is
/// delegated to `GitRepo` so the CLI cannot bypass the App's deletion guards.
extension SubagentStore {
    /// Resolve one agent's registered runtime worktree from official persisted records and
    /// clean it only when `WorktreeMerger` proves the strict already-merged predicates.
    ///
    /// The optional directory is a test seam. Production callers use
    /// `~/Library/Application Support/PipiUI/subagents`.
    package static func cleanupMergedWorktreeForMaintenance(
        agentID rawAgentID: String,
        repositoryURL: URL,
        persistenceDirectory: URL? = nil
    ) async -> MergedWorktreeMaintenanceResult {
        let agentID = rawAgentID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !agentID.isEmpty else {
            return MergedWorktreeMaintenanceResult(
                agentID: rawAgentID,
                status: .skipped,
                detail: "agent ID 不能为空"
            )
        }
        let repositoryPath = canonicalAbsolutePath(repositoryURL.path)
        guard let repositoryPath else {
            return MergedWorktreeMaintenanceResult(
                agentID: agentID,
                status: .skipped,
                detail: "非法仓库路径"
            )
        }
        let canonicalRepositoryURL = URL(fileURLWithPath: repositoryPath, isDirectory: true)
        guard GitRepo.probe(workTree: canonicalRepositoryURL).isRepo else {
            return MergedWorktreeMaintenanceResult(
                agentID: agentID,
                status: .skipped,
                detail: "无法确认 --repo 是 Git 仓库"
            )
        }

        let recordsDirectory = persistenceDirectory ?? defaultMaintenancePersistenceDirectory()
        let candidates: [MaintenanceCandidate]
        do {
            candidates = try maintenanceCandidates(
                agentID: agentID,
                repositoryPath: repositoryPath,
                persistenceDirectory: recordsDirectory
            )
        } catch {
            let detail = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            return MergedWorktreeMaintenanceResult(
                agentID: agentID,
                status: .skipped,
                detail: "无法读取官方 SubagentStore 记录: \(detail)"
            )
        }

        guard !candidates.isEmpty else {
            return MergedWorktreeMaintenanceResult(
                agentID: agentID,
                status: .skipped,
                detail: "没有找到属于该仓库的官方 agent 记录"
            )
        }
        guard !candidates.contains(where: { $0.isRunning }) else {
            return MergedWorktreeMaintenanceResult(
                agentID: agentID,
                status: .skipped,
                detail: "agent 仍在运行"
            )
        }

        let identities = Set(candidates.map { "\($0.branch)\u{1F}\($0.worktreePath)" })
        guard identities.count == 1, let candidate = candidates.first else {
            return MergedWorktreeMaintenanceResult(
                agentID: agentID,
                status: .skipped,
                detail: "同一 agent 在官方记录中对应多个 branch/path，拒绝猜测"
            )
        }

        let outcome = await MainRepoSerialQueue.run {
            WorktreeMerger.cleanupAlreadyMergedWorktree(
                branch: candidate.branch,
                worktreePath: candidate.worktreePath,
                in: canonicalRepositoryURL
            )
        }
        switch outcome {
        case .cleaned:
            return MergedWorktreeMaintenanceResult(
                agentID: agentID,
                status: .cleaned,
                detail: "已清理已合并的 worktree 与内部 branch ref"
            )
        case .alreadyAbsent:
            return MergedWorktreeMaintenanceResult(
                agentID: agentID,
                status: .alreadyAbsent,
                detail: "worktree 与 branch ref 已不存在"
            )
        case .skipped(let detail):
            return MergedWorktreeMaintenanceResult(
                agentID: agentID,
                status: .skipped,
                detail: detail
            )
        case .removeFailed(let detail), .cleanupFailed(let detail):
            return MergedWorktreeMaintenanceResult(
                agentID: agentID,
                status: .failed,
                detail: detail
            )
        }
    }

    /// Close one entry from a code-reviewed manifest. The CLI only calls this with
    /// `ReviewedWorktreeMaintenanceManifest.entries`; `reviewManifest` exists solely as
    /// a package test seam, never as a user-supplied command option.
    package static func discardReviewedWorktreeForMaintenance(
        entry: ReviewedWorktreeMaintenanceEntry,
        repositoryURL: URL,
        reviewManifest: [ReviewedWorktreeMaintenanceEntry] = ReviewedWorktreeMaintenanceManifest.entries,
        persistenceDirectory: URL? = nil,
        agentLeaseDirectory: URL? = nil,
        onEvent: (@Sendable (ReviewedWorktreeMaintenanceEvent) -> Void)? = nil
    ) async -> ReviewedWorktreeMaintenanceResult {
        let recordsDirectory = persistenceDirectory ?? defaultMaintenancePersistenceDirectory()
        return await MainRepoSerialQueue.run {
            performReviewedDiscard(
                entry: entry,
                repositoryURL: repositoryURL,
                reviewManifest: reviewManifest,
                persistenceDirectory: recordsDirectory,
                agentLeaseDirectory: agentLeaseDirectory,
                onEvent: onEvent
            )
        }
    }

    private static func performReviewedDiscard(
        entry: ReviewedWorktreeMaintenanceEntry,
        repositoryURL: URL,
        reviewManifest: [ReviewedWorktreeMaintenanceEntry],
        persistenceDirectory: URL,
        agentLeaseDirectory: URL?,
        onEvent: (@Sendable (ReviewedWorktreeMaintenanceEvent) -> Void)? 
    ) -> ReviewedWorktreeMaintenanceResult {
        func result(_ status: ReviewedWorktreeMaintenanceStatus, _ detail: String) -> ReviewedWorktreeMaintenanceResult {
            ReviewedWorktreeMaintenanceResult(
                agentID: entry.agentID,
                branch: entry.branch,
                status: status,
                detail: detail
            )
        }

        guard let manifestError = reviewedManifestEntryError(entry, in: reviewManifest) else {
            return result(.skipped, "review manifest 未精确列出该目标")
        }
        guard manifestError.isEmpty else {
            return result(.skipped, manifestError)
        }
        guard let repositoryPath = canonicalAbsolutePath(repositoryURL.path) else {
            return result(.skipped, "非法 --repo 路径")
        }
        let repository = URL(fileURLWithPath: repositoryPath, isDirectory: true)
        let mainStatus = GitRepo.probe(workTree: repository)
        guard mainStatus.isRepo else {
            return result(.skipped, "无法确认 --repo 是 Git 仓库")
        }
        guard let rootOutput = try? GitRepo.run(gitArgs: ["rev-parse", "--show-toplevel"], in: repository),
              let canonicalRoot = canonicalAbsolutePath(rootOutput.trimmingCharacters(in: .whitespacesAndNewlines)),
              canonicalRoot == repositoryPath else {
            return result(.skipped, "--repo 必须是主仓 worktree 根目录")
        }
        guard mainStatus.currentBranch != entry.branch else {
            return result(.skipped, "拒绝当前 integration branch")
        }
        guard entry.branch.hasPrefix("pipiui/") else {
            return result(.skipped, "分支不属于 pipiui/ runtime namespace")
        }
        guard entry.branch == "pipiui/\(entry.agentID)" else {
            return result(.skipped, "manifest branch 与 runtime agent ID 不匹配")
        }

        let worktreePath = repositoryPath + "/.pi/worktrees/\(entry.agentID)"
        let worktreeURL = URL(fileURLWithPath: worktreePath, isDirectory: true)
        let leaseDirectory = agentLeaseDirectory
            ?? repository.appendingPathComponent(".pi/agent-leases", isDirectory: true)

        guard let tip = GitRepo.branchTip(entry.branch, in: repository) else {
            let stillRegistered = GitRepo.worktreeList(in: repository).contains { $0.branch == entry.branch }
            guard !stillRegistered, !FileManager.default.fileExists(atPath: worktreePath) else {
                return result(.skipped, "ref 已缺失，但注册 worktree 或目标路径仍存在")
            }
            return result(.alreadyAbsent, "ref/worktree/path 均已不存在")
        }
        guard tip == entry.expectedTip else {
            return result(.skipped, "branch tip 不匹配（expected \(entry.expectedTip)，actual \(tip)）")
        }

        if let ownerError = officialOwnerRecordError(
            for: entry,
            expectedWorktreePath: worktreePath,
            persistenceDirectory: persistenceDirectory
        ) {
            return result(.skipped, ownerError)
        }
        switch agentLeaseStatus(agentID: entry.agentID, in: leaseDirectory) {
        case .noLiveLease:
            break
        case .live:
            return result(.skipped, "agent 有活 lease，拒绝清理")
        case .blocked(let detail):
            return result(.skipped, "无法安全确认 agent lease: \(detail)")
        }

        let reconciliation = GitRepo.reconcileAgentBranch(
            entry.branch,
            persistedWorktreePath: worktreePath,
            integrationRef: "HEAD",
            in: repository
        )
        guard reconciliation.isInternal, reconciliation.branchExists else {
            return result(.skipped, "无法确认内部 branch ref")
        }

        if entry.orphanCloseout {
            guard entry.basis == .explicitlySuperseded,
                  !entry.allowsDirtyWorktree else {
                return result(.skipped, "orphan closeout 仅允许显式 superseded manifest 项")
            }
            guard reconciliation.registeredWorktreePath == nil,
                  !FileManager.default.fileExists(atPath: worktreePath) else {
                return result(.skipped, "orphan manifest 项仍有注册 worktree 或目标路径")
            }
            return finishReviewedBranchCloseout(
                entry: entry,
                worktreePath: nil,
                repository: repository,
                expectedWorktreePath: worktreePath
            )
        }

        guard reconciliation.registeredWorktreePath == worktreePath,
              worktreePath != repositoryPath else {
            return result(.skipped, "无法确认目标由预期 runtime worktree owner 持有")
        }
        guard FileManager.default.fileExists(atPath: worktreePath),
              GitRepo.probe(workTree: worktreeURL).isRepo else {
            return result(.skipped, "注册的 runtime worktree 不可用")
        }
        guard let initialDirtySummary = GitRepo.worktreeStatusSummary(in: worktreeURL) else {
            return result(.skipped, "无法读取 worktree 脏状态")
        }
        if let eligibilityError = reviewedEligibilityError(
            entry: entry,
            dirtySummary: initialDirtySummary,
            repository: repository
        ) {
            return result(.skipped, eligibilityError)
        }

        // Re-check all race-sensitive guards immediately before removal. The current process
        // serializes main-repo Git operations; these checks also defend against an external
        // App process changing a ref, lease, or dirty worktree between review and closeout.
        guard GitRepo.probe(workTree: repository).currentBranch != entry.branch else {
            return result(.skipped, "删除前发现目标已成为当前 integration branch")
        }
        guard GitRepo.branchTip(entry.branch, in: repository) == entry.expectedTip else {
            return result(.skipped, "删除前 branch tip 已变化")
        }
        if let ownerError = officialOwnerRecordError(
            for: entry,
            expectedWorktreePath: worktreePath,
            persistenceDirectory: persistenceDirectory
        ) {
            return result(.skipped, ownerError)
        }
        switch agentLeaseStatus(agentID: entry.agentID, in: leaseDirectory) {
        case .noLiveLease:
            break
        case .live:
            return result(.skipped, "删除前检测到活 lease")
        case .blocked(let detail):
            return result(.skipped, "删除前无法安全确认 agent lease: \(detail)")
        }
        let latestReconciliation = GitRepo.reconcileAgentBranch(
            entry.branch,
            persistedWorktreePath: worktreePath,
            integrationRef: "HEAD",
            in: repository
        )
        guard latestReconciliation.registeredWorktreePath == worktreePath else {
            return result(.skipped, "删除前 worktree owner 注册发生变化")
        }
        guard let latestDirtySummary = GitRepo.worktreeStatusSummary(in: worktreeURL),
              latestDirtySummary == initialDirtySummary else {
            return result(.skipped, "删除前 worktree 脏状态发生变化")
        }
        if let eligibilityError = reviewedEligibilityError(
            entry: entry,
            dirtySummary: latestDirtySummary,
            repository: repository
        ) {
            return result(.skipped, eligibilityError)
        }

        if !latestDirtySummary.isEmpty {
            onEvent?(.dirtyWorktree(
                agentID: entry.agentID,
                paths: latestDirtySummary,
                reviewReason: entry.reviewReason
            ))
        }
        do {
            // This is the only worktree deletion route used by this command. Force is never
            // CLI-controlled: it is true solely for a pinned, reviewed dirty ancestor.
            try GitRepo.worktreeRemove(
                at: worktreeURL,
                in: repository,
                force: !latestDirtySummary.isEmpty
            )
        } catch {
            let detail = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            return result(.failed, "GitRepo worktree remove 失败: \(detail)")
        }
        return finishReviewedBranchCloseout(
            entry: entry,
            worktreePath: worktreePath,
            repository: repository,
            expectedWorktreePath: worktreePath
        )
    }

    private static func finishReviewedBranchCloseout(
        entry: ReviewedWorktreeMaintenanceEntry,
        worktreePath: String?,
        repository: URL,
        expectedWorktreePath: String
    ) -> ReviewedWorktreeMaintenanceResult {
        func result(_ status: ReviewedWorktreeMaintenanceStatus, _ detail: String) -> ReviewedWorktreeMaintenanceResult {
            ReviewedWorktreeMaintenanceResult(
                agentID: entry.agentID,
                branch: entry.branch,
                status: status,
                detail: detail
            )
        }
        let deletion = GitRepo.deleteReviewedInternalAgentBranch(
            entry.branch,
            expectedTip: entry.expectedTip,
            basis: entry.basis,
            persistedWorktreePath: worktreePath,
            integrationRef: "HEAD",
            in: repository
        )
        switch deletion {
        case .retained(let detail):
            return result(.failed, "worktree 已移除但 branch ref 被 GitRepo 保留: \(detail)")
        case .failed(let detail):
            return result(.failed, "worktree 已移除但 branch ref 删除失败: \(detail)")
        case .deleted, .alreadyAbsent:
            break
        }

        let verified = GitRepo.reconcileAgentBranch(
            entry.branch,
            persistedWorktreePath: worktreePath,
            integrationRef: "HEAD",
            in: repository
        )
        guard verified.disposition == .alreadyAbsent,
              verified.registeredWorktreePath == nil,
              !FileManager.default.fileExists(atPath: expectedWorktreePath) else {
            return result(.failed, "清理后验证失败：ref、worktree 或目标路径仍存在")
        }
        return result(.cleaned, "已按 pinned reviewed manifest 清理 worktree 与内部 branch ref")
    }

    private static func reviewedEligibilityError(
        entry: ReviewedWorktreeMaintenanceEntry,
        dirtySummary: [String],
        repository: URL
    ) -> String? {
        let isAncestor = GitRepo.isAncestor(entry.branch, of: "HEAD", in: repository)
        switch entry.basis {
        case .integratedAncestor:
            guard isAncestor else {
                return "branch tip 不是 integration HEAD 的祖先"
            }
            guard dirtySummary.isEmpty || entry.allowsDirtyWorktree else {
                return "worktree 含未提交改动，但 manifest 未显式审核允许 dirty ancestor"
            }
            return nil

        case .cherryEquivalent:
            guard dirtySummary.isEmpty else {
                return "cherry-equivalent closeout 要求 worktree clean"
            }
            guard !isAncestor else {
                return "cherry-equivalent closeout 要求非 ancestor branch"
            }
            guard GitRepo.allUniqueCommitsAreCherryEquivalent(entry.branch, against: "HEAD", in: repository) else {
                return "git cherry 未证明所有独有提交均为 -（patch-equivalent）"
            }
            return nil

        case .explicitlySuperseded:
            guard dirtySummary.isEmpty else {
                return "superseded closeout 要求 worktree clean"
            }
            guard !isAncestor else {
                return "superseded closeout 仅允许非 ancestor historical ref"
            }
            return nil
        }
    }

    /// Returns nil when official state is either absent or unambiguously compatible with
    /// this exact manifest owner. Git's registered `pipiui/<id>` worktree at the canonical
    /// runtime path supplies ownership proof when old App persistence has already been pruned.
    private static func officialOwnerRecordError(
        for entry: ReviewedWorktreeMaintenanceEntry,
        expectedWorktreePath: String,
        persistenceDirectory: URL
    ) -> String? {
        let agents: [SubagentInfo]
        do {
            agents = try officialMaintenanceAgents(in: persistenceDirectory)
        } catch {
            let detail = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            return "无法读取官方 SubagentStore 记录: \(detail)"
        }
        let matching = agents.filter { $0.id == entry.agentID }
        guard !matching.isEmpty else { return nil }

        // A bare agent ID can recur in historical session snapshots. Git's currently
        // registered branch+path is the authority for this closeout, but a running row is
        // always live authority and a row that claims the exact target path must agree with
        // the manifest. Terminal rows for another historical path/branch are not owners of
        // this registered worktree and must not turn an otherwise proven owner into a guess.
        for agent in matching {
            guard agent.state != .running else {
                return "官方 SubagentStore state=running，拒绝清理"
            }
            let rawPath = agent.worktreePath?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard let rawPath, !rawPath.isEmpty,
                  let path = canonicalAbsolutePath(rawPath),
                  path == expectedWorktreePath else {
                continue
            }
            let branch = agent.worktreeBranch?.trimmingCharacters(in: .whitespacesAndNewlines)
            guard branch == entry.branch else {
                return "官方 agent 记录声称目标 worktree 路径，但 branch 不匹配"
            }
        }
        return nil
    }

    private enum AgentLeaseStatus {
        case noLiveLease
        case live
        case blocked(String)
    }

    private struct MaintenanceAgentLeaseRecord: Decodable {
        let agentId: String
        let pid: Int
        let processIdentity: String?
    }

    private enum ProcessIdentityProbe {
        case running(String)
        case notRunning
        case unavailable(String)
    }

    /// Mirrors the runtime's agent-lease semantics without sending a signal to any process.
    /// `/bin/ps` plus its recorded start identity avoids PID-reuse false positives.
    private static func agentLeaseStatus(agentID: String, in directory: URL) -> AgentLeaseStatus {
        let lease = directory.appendingPathComponent("\(agentID).lease")
        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: lease.path) else { return .noLiveLease }
        guard let data = try? Data(contentsOf: lease),
              let record = try? JSONDecoder().decode(MaintenanceAgentLeaseRecord.self, from: data) else {
            return .blocked("lease 文件不可读或格式无效")
        }
        guard record.agentId == agentID else {
            return .blocked("lease agentId 与目标不匹配")
        }
        guard record.pid > 0 else {
            return .blocked("lease pid 非法")
        }
        switch processIdentity(pid: record.pid) {
        case .notRunning:
            return .noLiveLease
        case .unavailable(let detail):
            return .blocked(detail)
        case .running(let identity):
            guard let expected = record.processIdentity,
                  !expected.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                return .live
            }
            return identity == expected ? .live : .noLiveLease
        }
    }

    private static func processIdentity(pid: Int) -> ProcessIdentityProbe {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/ps")
        process.arguments = ["-o", "lstart=", "-p", String(pid)]
        process.standardInput = FileHandle.nullDevice
        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr
        do {
            try process.run()
        } catch {
            return .unavailable(error.localizedDescription)
        }
        process.waitUntilExit()
        let text = String(
            data: stdout.fileHandleForReading.readDataToEndOfFile(),
            encoding: .utf8
        )?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if process.terminationStatus == 0 {
            return text.isEmpty ? .notRunning : .running(text)
        }
        if process.terminationStatus == 1, text.isEmpty {
            return .notRunning
        }
        let error = String(
            data: stderr.fileHandleForReading.readDataToEndOfFile(),
            encoding: .utf8
        )?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return .unavailable(error.isEmpty ? "ps 无法确认 pid \(pid)" : error)
    }

    private static func reviewedManifestEntryError(
        _ entry: ReviewedWorktreeMaintenanceEntry,
        in manifest: [ReviewedWorktreeMaintenanceEntry]
    ) -> String? {
        guard isSafeRuntimeAgentID(entry.agentID) else {
            return "manifest agent ID 非法"
        }
        guard looksLikeFullCommitSHA(entry.expectedTip) else {
            return "manifest expected tip SHA 非法"
        }
        guard !entry.reviewReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return "manifest review reason 不能为空"
        }
        let normalizedBranch = entry.branch.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedBranch.isEmpty, !normalizedBranch.hasPrefix("-") else {
            return "manifest branch 非法"
        }
        switch entry.basis {
        case .integratedAncestor:
            guard !entry.orphanCloseout else {
                return "ancestor manifest 项不能是 orphan closeout"
            }
        case .cherryEquivalent:
            guard !entry.allowsDirtyWorktree, !entry.orphanCloseout else {
                return "cherry-equivalent manifest 项必须是 clean registered worktree"
            }
        case .explicitlySuperseded:
            guard !entry.allowsDirtyWorktree else {
                return "superseded manifest 项不能允许 dirty worktree"
            }
        }
        let exactCount = manifest.filter { $0 == entry }.count
        guard exactCount == 1 else { return nil }
        let conflicts = manifest.filter { $0.agentID == entry.agentID || $0.branch == entry.branch }
        guard conflicts.count == 1 else {
            return "manifest 对同一 agent/branch 存在歧义"
        }
        return ""
    }

    private static func isSafeRuntimeAgentID(_ value: String) -> Bool {
        guard !value.isEmpty, value.count <= 64 else { return false }
        return value.unicodeScalars.allSatisfy { scalar in
            (scalar.value >= 48 && scalar.value <= 57) ||
            (scalar.value >= 65 && scalar.value <= 90) ||
            (scalar.value >= 97 && scalar.value <= 122) ||
            scalar == "_" || scalar == "-"
        }
    }

    private static func looksLikeFullCommitSHA(_ value: String) -> Bool {
        value.count == 40 && value.unicodeScalars.allSatisfy { scalar in
            (scalar.value >= 48 && scalar.value <= 57) ||
            (scalar.value >= 97 && scalar.value <= 102) ||
            (scalar.value >= 65 && scalar.value <= 70)
        }
    }

    private struct MaintenanceCandidate: Sendable {
        let branch: String
        let worktreePath: String
        let isRunning: Bool
    }

    private static func maintenanceCandidates(
        agentID: String,
        repositoryPath: String,
        persistenceDirectory: URL
    ) throws -> [MaintenanceCandidate] {
        let runtimeWorktreeRoot = repositoryPath + "/.pi/worktrees/"
        return try officialMaintenanceAgents(in: persistenceDirectory).compactMap { agent in
            guard agent.id == agentID,
                  let rawPath = agent.worktreePath,
                  let worktreePath = canonicalAbsolutePath(rawPath),
                  worktreePath.hasPrefix(runtimeWorktreeRoot),
                  let branch = agent.worktreeBranch?
                    .trimmingCharacters(in: .whitespacesAndNewlines),
                  !branch.isEmpty else {
                return nil
            }
            return MaintenanceCandidate(
                branch: branch,
                worktreePath: worktreePath,
                isRunning: agent.state == .running
            )
        }
    }

    private static func officialMaintenanceAgents(in persistenceDirectory: URL) throws -> [SubagentInfo] {
        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: persistenceDirectory.path) else { return [] }
        let files = try fileManager.contentsOfDirectory(
            at: persistenceDirectory,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        )
        var agents: [SubagentInfo] = []
        for file in files where file.lastPathComponent.hasSuffix(".agents.json") {
            let data = try Data(contentsOf: file)
            agents.append(contentsOf: try JSONDecoder().decode([SubagentInfo].self, from: data))
        }
        return agents
    }

    private static func defaultMaintenancePersistenceDirectory() -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PipiUI/subagents", isDirectory: true)
    }

    private static func canonicalAbsolutePath(_ rawPath: String) -> String? {
        let trimmed = rawPath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.hasPrefix("/"), !trimmed.hasPrefix("-") else {
            return nil
        }
        return URL(fileURLWithPath: trimmed, isDirectory: true)
            .standardizedFileURL
            .resolvingSymlinksInPath()
            .path
    }
}
