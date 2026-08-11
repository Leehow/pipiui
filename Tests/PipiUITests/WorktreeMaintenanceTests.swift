import XCTest
@testable import PipiUI

final class WorktreeMaintenanceTests: XCTestCase {
    func testCleanRegisteredAncestorIsRemovedThroughMaintenanceEntry() async throws {
        let (repo, persistenceDirectory, cleanup) = try makeRepository()
        defer { cleanup() }
        let agentID = "maintenance-clean"
        let branch = "pipiui/\(agentID)"
        let worktree = repo.appendingPathComponent(".pi/worktrees/\(agentID)", isDirectory: true)
        try GitRepo.worktreeAdd(branch: branch, at: worktree, in: repo)
        try writePersistedAgent(
            agentID: agentID,
            branch: branch,
            worktree: worktree,
            to: persistenceDirectory
        )

        let result = await SubagentStore.cleanupMergedWorktreeForMaintenance(
            agentID: agentID,
            repositoryURL: repo,
            persistenceDirectory: persistenceDirectory
        )

        XCTAssertEqual(result.status, .cleaned, result.detail)
        XCTAssertFalse(FileManager.default.fileExists(atPath: worktree.path))
        assertBranchAbsent(branch, in: repo)
        XCTAssertFalse(GitRepo.worktreeList(in: repo).contains(where: { $0.branch == branch }))
    }

    func testUniqueBranchIsSkippedWithoutModification() async throws {
        let (repo, persistenceDirectory, cleanup) = try makeRepository()
        defer { cleanup() }
        let agentID = "maintenance-unique"
        let branch = "pipiui/\(agentID)"
        let worktree = repo.appendingPathComponent(".pi/worktrees/\(agentID)", isDirectory: true)
        try GitRepo.worktreeAdd(branch: branch, at: worktree, in: repo)
        try "unique\n".write(
            to: worktree.appendingPathComponent("unique.txt"),
            atomically: true,
            encoding: .utf8
        )
        _ = try GitRepo.run(gitArgs: ["add", "unique.txt"], in: worktree)
        _ = try GitRepo.run(gitArgs: ["commit", "-m", "unique"], in: worktree)
        try writePersistedAgent(
            agentID: agentID,
            branch: branch,
            worktree: worktree,
            to: persistenceDirectory
        )

        let result = await SubagentStore.cleanupMergedWorktreeForMaintenance(
            agentID: agentID,
            repositoryURL: repo,
            persistenceDirectory: persistenceDirectory
        )

        XCTAssertEqual(result.status, .skipped, result.detail)
        XCTAssertTrue(result.detail.contains("祖先") || result.detail.contains("独有"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: worktree.path))
        assertBranchPresent(branch, in: repo)
        XCTAssertTrue(GitRepo.worktreeList(in: repo).contains(where: { $0.branch == branch }))
    }

    func testDirtyRegisteredWorktreeIsSkippedWithoutModification() async throws {
        let (repo, persistenceDirectory, cleanup) = try makeRepository()
        defer { cleanup() }
        let agentID = "maintenance-dirty"
        let branch = "pipiui/\(agentID)"
        let worktree = repo.appendingPathComponent(".pi/worktrees/\(agentID)", isDirectory: true)
        try GitRepo.worktreeAdd(branch: branch, at: worktree, in: repo)
        let dirtyFile = worktree.appendingPathComponent("draft.txt")
        try "do not remove\n".write(to: dirtyFile, atomically: true, encoding: .utf8)
        try writePersistedAgent(
            agentID: agentID,
            branch: branch,
            worktree: worktree,
            to: persistenceDirectory
        )

        let result = await SubagentStore.cleanupMergedWorktreeForMaintenance(
            agentID: agentID,
            repositoryURL: repo,
            persistenceDirectory: persistenceDirectory
        )

        XCTAssertEqual(result.status, .skipped, result.detail)
        XCTAssertTrue(result.detail.contains("未提交"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: dirtyFile.path))
        assertBranchPresent(branch, in: repo)
        XCTAssertTrue(GitRepo.worktreeList(in: repo).contains(where: { $0.branch == branch }))
    }

    func testMissingWorktreeAndBranchAreIdempotentlySuccessful() async throws {
        let (repo, persistenceDirectory, cleanup) = try makeRepository()
        defer { cleanup() }
        let agentID = "maintenance-missing"
        let branch = "pipiui/\(agentID)"
        let missingWorktree = repo.appendingPathComponent(
            ".pi/worktrees/\(agentID)",
            isDirectory: true
        )
        try writePersistedAgent(
            agentID: agentID,
            branch: branch,
            worktree: missingWorktree,
            to: persistenceDirectory
        )

        let result = await SubagentStore.cleanupMergedWorktreeForMaintenance(
            agentID: agentID,
            repositoryURL: repo,
            persistenceDirectory: persistenceDirectory
        )

        XCTAssertEqual(result.status, .alreadyAbsent, result.detail)
        XCTAssertFalse(FileManager.default.fileExists(atPath: missingWorktree.path))
        assertBranchAbsent(branch, in: repo)
    }

    func testMainDirtyStillAllowsAlreadyMergedSafeCleanup() async throws {
        let (repo, persistenceDirectory, cleanup) = try makeRepository()
        defer { cleanup() }
        let agentID = "maintenance-main-dirty"
        let branch = "pipiui/\(agentID)"
        let worktree = repo.appendingPathComponent(".pi/worktrees/\(agentID)", isDirectory: true)
        try GitRepo.worktreeAdd(branch: branch, at: worktree, in: repo)
        let userWIP = repo.appendingPathComponent("user-wip.txt")
        try "preserve main WIP\n".write(to: userWIP, atomically: true, encoding: .utf8)
        try writePersistedAgent(
            agentID: agentID,
            branch: branch,
            worktree: worktree,
            to: persistenceDirectory
        )

        let result = await SubagentStore.cleanupMergedWorktreeForMaintenance(
            agentID: agentID,
            repositoryURL: repo,
            persistenceDirectory: persistenceDirectory
        )

        XCTAssertEqual(result.status, .cleaned, result.detail)
        XCTAssertEqual(try String(contentsOf: userWIP, encoding: .utf8), "preserve main WIP\n")
        XCTAssertTrue(GitRepo.probe(workTree: repo).isDirty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: worktree.path))
        assertBranchAbsent(branch, in: repo)
    }

    func testReviewedManifestPinsExactlyTheRequestedTwentySixTargets() {
        let ids = ReviewedWorktreeMaintenanceManifest.entries.map(\.agentID)
        XCTAssertEqual(ids, [
            "agent-7de2949bc92c9b1e", "appkit-single-anchor", "opencode-go-quota",
            "opencode-go-integrate", "subagents-sort", "subagent-loop-close",
            "merge-recovery-v2", "agent-b39698e8c52ff202", "stream-diag-log",
            "tighten-gap", "rail-scrollbar-fix", "rail-visual-check", "electron-ui-verify",
            "electron-scaffold", "host-contracts", "reuse-audit", "md-stream-table",
            "hermes-compat", "auto-merge-recovery", "boss-resolve-control",
            "memory-broker-core", "opencode-web-usage-impl", "reminder-terminal-fix",
            "user-prompt-index-perf", "toolbar-counts-impl", "uc-sheet-fix",
        ])
        XCTAssertFalse(ids.contains("tunnel-reconnect"))
    }

    func testReviewedTipMismatchSkipsWithoutDeleting() async throws {
        let (repo, persistenceDirectory, cleanup) = try makeRepository()
        defer { cleanup() }
        let agentID = "reviewed-tip-mismatch"
        let branch = "pipiui/\(agentID)"
        let worktree = runtimeWorktree(agentID, in: repo)
        try GitRepo.worktreeAdd(branch: branch, at: worktree, in: repo)
        try writePersistedAgent(agentID: agentID, branch: branch, worktree: worktree, to: persistenceDirectory)

        let entry = reviewedEntry(
            agentID: agentID,
            expectedTip: String(repeating: "0", count: 39) + "1",
            basis: .integratedAncestor
        )
        let result = await runReviewed(entry, repo: repo, persistenceDirectory: persistenceDirectory)

        XCTAssertEqual(result.status, .skipped, result.detail)
        XCTAssertTrue(result.detail.contains("tip"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: worktree.path))
        assertBranchPresent(branch, in: repo)
    }

    func testReviewedNonInternalBranchIsSkipped() async throws {
        let (repo, persistenceDirectory, cleanup) = try makeRepository()
        defer { cleanup() }
        let agentID = "reviewed-noninternal"
        let branch = "feature/reviewed-noninternal"
        let worktree = runtimeWorktree(agentID, in: repo)
        try GitRepo.worktreeAdd(branch: branch, at: worktree, in: repo)
        let tip = try XCTUnwrap(GitRepo.branchTip(branch, in: repo))
        try writePersistedAgent(agentID: agentID, branch: branch, worktree: worktree, to: persistenceDirectory)

        let entry = reviewedEntry(agentID: agentID, branch: branch, expectedTip: tip, basis: .integratedAncestor)
        let result = await runReviewed(entry, repo: repo, persistenceDirectory: persistenceDirectory)

        XCTAssertEqual(result.status, .skipped, result.detail)
        XCTAssertTrue(result.detail.contains("runtime namespace"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: worktree.path))
        assertBranchPresent(branch, in: repo)
    }

    func testReviewedCurrentIntegrationBranchIsSkipped() async throws {
        let (repo, persistenceDirectory, cleanup) = try makeRepository()
        defer { cleanup() }
        let agentID = "reviewed-current"
        let branch = "pipiui/\(agentID)"
        _ = try GitRepo.run(gitArgs: ["branch", "-m", branch], in: repo)
        let tip = try XCTUnwrap(GitRepo.branchTip(branch, in: repo))
        let entry = reviewedEntry(agentID: agentID, expectedTip: tip, basis: .integratedAncestor)

        let result = await runReviewed(entry, repo: repo, persistenceDirectory: persistenceDirectory)

        XCTAssertEqual(result.status, .skipped, result.detail)
        XCTAssertTrue(result.detail.contains("integration branch"))
        assertBranchPresent(branch, in: repo)
    }

    func testReviewedRunningAgentIsSkipped() async throws {
        let (repo, persistenceDirectory, cleanup) = try makeRepository()
        defer { cleanup() }
        let agentID = "reviewed-running"
        let branch = "pipiui/\(agentID)"
        let worktree = runtimeWorktree(agentID, in: repo)
        try GitRepo.worktreeAdd(branch: branch, at: worktree, in: repo)
        try writePersistedAgent(
            agentID: agentID,
            branch: branch,
            worktree: worktree,
            state: .running,
            to: persistenceDirectory
        )
        let entry = reviewedEntry(
            agentID: agentID,
            expectedTip: try XCTUnwrap(GitRepo.branchTip(branch, in: repo)),
            basis: .integratedAncestor
        )

        let result = await runReviewed(entry, repo: repo, persistenceDirectory: persistenceDirectory)

        XCTAssertEqual(result.status, .skipped, result.detail)
        XCTAssertTrue(result.detail.contains("state=running"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: worktree.path))
        assertBranchPresent(branch, in: repo)
    }

    func testReviewedStaleTerminalRecordForOtherPathDoesNotBlockGitConfirmedOwner() async throws {
        let (repo, persistenceDirectory, cleanup) = try makeRepository()
        defer { cleanup() }
        let agentID = "reviewed-stale-record"
        let branch = "pipiui/\(agentID)"
        let worktree = runtimeWorktree(agentID, in: repo)
        try GitRepo.worktreeAdd(branch: branch, at: worktree, in: repo)
        try writePersistedAgent(agentID: agentID, branch: branch, worktree: worktree, to: persistenceDirectory)
        try writePersistedAgent(
            agentID: agentID,
            branch: "pipiui/obsolete-\(agentID)",
            worktree: repo.appendingPathComponent(".pi/worktrees/obsolete-\(agentID)"),
            to: persistenceDirectory,
            fileName: "stale"
        )
        let entry = reviewedEntry(
            agentID: agentID,
            expectedTip: try XCTUnwrap(GitRepo.branchTip(branch, in: repo)),
            basis: .integratedAncestor
        )

        let result = await runReviewed(entry, repo: repo, persistenceDirectory: persistenceDirectory)

        XCTAssertEqual(result.status, .cleaned, result.detail)
        XCTAssertFalse(FileManager.default.fileExists(atPath: worktree.path))
        assertBranchAbsent(branch, in: repo)
    }

    func testReviewedDirtyAncestorWithoutReviewIsSkipped() async throws {
        let (repo, persistenceDirectory, cleanup) = try makeRepository()
        defer { cleanup() }
        let agentID = "reviewed-dirty-unapproved"
        let branch = "pipiui/\(agentID)"
        let worktree = runtimeWorktree(agentID, in: repo)
        try GitRepo.worktreeAdd(branch: branch, at: worktree, in: repo)
        try "preserve\n".write(
            to: worktree.appendingPathComponent("draft.txt"), atomically: true, encoding: .utf8
        )
        try writePersistedAgent(agentID: agentID, branch: branch, worktree: worktree, to: persistenceDirectory)
        let entry = reviewedEntry(
            agentID: agentID,
            expectedTip: try XCTUnwrap(GitRepo.branchTip(branch, in: repo)),
            basis: .integratedAncestor
        )

        let result = await runReviewed(entry, repo: repo, persistenceDirectory: persistenceDirectory)

        XCTAssertEqual(result.status, .skipped, result.detail)
        XCTAssertTrue(result.detail.contains("dirty ancestor"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: worktree.appendingPathComponent("draft.txt").path))
        assertBranchPresent(branch, in: repo)
    }

    func testReviewedDirtyAncestorWithManifestReviewIsRemoved() async throws {
        let (repo, persistenceDirectory, cleanup) = try makeRepository()
        defer { cleanup() }
        let agentID = "reviewed-dirty-approved"
        let branch = "pipiui/\(agentID)"
        let worktree = runtimeWorktree(agentID, in: repo)
        try GitRepo.worktreeAdd(branch: branch, at: worktree, in: repo)
        try "reviewed scratch\n".write(
            to: worktree.appendingPathComponent("reviewed-draft.txt"), atomically: true, encoding: .utf8
        )
        try writePersistedAgent(agentID: agentID, branch: branch, worktree: worktree, to: persistenceDirectory)
        let entry = reviewedEntry(
            agentID: agentID,
            expectedTip: try XCTUnwrap(GitRepo.branchTip(branch, in: repo)),
            basis: .integratedAncestor,
            allowsDirtyWorktree: true
        )

        let result = await runReviewed(entry, repo: repo, persistenceDirectory: persistenceDirectory)

        XCTAssertEqual(result.status, .cleaned, result.detail)
        XCTAssertFalse(FileManager.default.fileExists(atPath: worktree.path))
        assertBranchAbsent(branch, in: repo)
    }

    func testReviewedCleanCherryEquivalentWorktreeIsRemoved() async throws {
        let (repo, persistenceDirectory, cleanup) = try makeRepository()
        defer { cleanup() }
        let agentID = "reviewed-cherry-equivalent"
        let branch = "pipiui/\(agentID)"
        let worktree = runtimeWorktree(agentID, in: repo)
        try GitRepo.worktreeAdd(branch: branch, at: worktree, in: repo)
        try "same patch\n".write(
            to: worktree.appendingPathComponent("equivalent.txt"), atomically: true, encoding: .utf8
        )
        _ = try GitRepo.run(gitArgs: ["add", "equivalent.txt"], in: worktree)
        _ = try GitRepo.run(gitArgs: ["commit", "-m", "branch equivalent patch"], in: worktree)
        let tip = try XCTUnwrap(GitRepo.branchTip(branch, in: repo))
        try "same patch\n".write(
            to: repo.appendingPathComponent("equivalent.txt"), atomically: true, encoding: .utf8
        )
        _ = try GitRepo.run(gitArgs: ["add", "equivalent.txt"], in: repo)
        _ = try GitRepo.run(gitArgs: ["commit", "-m", "main equivalent patch"], in: repo)
        XCTAssertTrue(GitRepo.allUniqueCommitsAreCherryEquivalent(branch, in: repo))
        try writePersistedAgent(agentID: agentID, branch: branch, worktree: worktree, to: persistenceDirectory)
        let entry = reviewedEntry(agentID: agentID, expectedTip: tip, basis: .cherryEquivalent)

        let result = await runReviewed(entry, repo: repo, persistenceDirectory: persistenceDirectory)

        XCTAssertEqual(result.status, .cleaned, result.detail)
        XCTAssertFalse(FileManager.default.fileExists(atPath: worktree.path))
        assertBranchAbsent(branch, in: repo)
    }

    func testReviewedNonEquivalentWorktreeWithoutSupersededManifestIsSkipped() async throws {
        let (repo, persistenceDirectory, cleanup) = try makeRepository()
        defer { cleanup() }
        let agentID = "reviewed-non-equivalent"
        let branch = "pipiui/\(agentID)"
        let worktree = runtimeWorktree(agentID, in: repo)
        try GitRepo.worktreeAdd(branch: branch, at: worktree, in: repo)
        try "unique patch\n".write(
            to: worktree.appendingPathComponent("unique.txt"), atomically: true, encoding: .utf8
        )
        _ = try GitRepo.run(gitArgs: ["add", "unique.txt"], in: worktree)
        _ = try GitRepo.run(gitArgs: ["commit", "-m", "unique branch patch"], in: worktree)
        let tip = try XCTUnwrap(GitRepo.branchTip(branch, in: repo))
        try writePersistedAgent(agentID: agentID, branch: branch, worktree: worktree, to: persistenceDirectory)
        let entry = reviewedEntry(agentID: agentID, expectedTip: tip, basis: .cherryEquivalent)

        let result = await runReviewed(entry, repo: repo, persistenceDirectory: persistenceDirectory)

        XCTAssertEqual(result.status, .skipped, result.detail)
        XCTAssertTrue(result.detail.contains("git cherry"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: worktree.path))
        assertBranchPresent(branch, in: repo)
    }

    func testReviewedExplicitOrphanManifestClosesOutPinnedRef() async throws {
        let (repo, persistenceDirectory, cleanup) = try makeRepository()
        defer { cleanup() }
        let agentID = "reviewed-orphan"
        let branch = "pipiui/\(agentID)"
        let worktree = runtimeWorktree(agentID, in: repo)
        try GitRepo.worktreeAdd(branch: branch, at: worktree, in: repo)
        try "obsolete\n".write(
            to: worktree.appendingPathComponent("obsolete.txt"), atomically: true, encoding: .utf8
        )
        _ = try GitRepo.run(gitArgs: ["add", "obsolete.txt"], in: worktree)
        _ = try GitRepo.run(gitArgs: ["commit", "-m", "obsolete"], in: worktree)
        let tip = try XCTUnwrap(GitRepo.branchTip(branch, in: repo))
        try GitRepo.worktreeRemove(at: worktree, in: repo, force: false)
        try writePersistedAgent(agentID: agentID, branch: branch, worktree: worktree, to: persistenceDirectory)
        let entry = reviewedEntry(
            agentID: agentID,
            expectedTip: tip,
            basis: .explicitlySuperseded,
            orphanCloseout: true
        )

        let result = await runReviewed(entry, repo: repo, persistenceDirectory: persistenceDirectory)

        XCTAssertEqual(result.status, .cleaned, result.detail)
        XCTAssertFalse(FileManager.default.fileExists(atPath: worktree.path))
        assertBranchAbsent(branch, in: repo)
    }

    func testReviewedMissingRefAndWorktreeIsIdempotent() async throws {
        let (repo, persistenceDirectory, cleanup) = try makeRepository()
        defer { cleanup() }
        let agentID = "reviewed-missing"
        let branch = "pipiui/\(agentID)"
        let worktree = runtimeWorktree(agentID, in: repo)
        try writePersistedAgent(agentID: agentID, branch: branch, worktree: worktree, to: persistenceDirectory)
        let entry = reviewedEntry(
            agentID: agentID,
            expectedTip: String(repeating: "a", count: 40),
            basis: .integratedAncestor
        )

        let result = await runReviewed(entry, repo: repo, persistenceDirectory: persistenceDirectory)

        XCTAssertEqual(result.status, .alreadyAbsent, result.detail)
        XCTAssertFalse(FileManager.default.fileExists(atPath: worktree.path))
        assertBranchAbsent(branch, in: repo)
    }

    func testReviewedLiveLeaseIsSkipped() async throws {
        let (repo, persistenceDirectory, cleanup) = try makeRepository()
        defer { cleanup() }
        let agentID = "reviewed-live-lease"
        let branch = "pipiui/\(agentID)"
        let worktree = runtimeWorktree(agentID, in: repo)
        try GitRepo.worktreeAdd(branch: branch, at: worktree, in: repo)
        try writePersistedAgent(agentID: agentID, branch: branch, worktree: worktree, to: persistenceDirectory)
        let leaseDirectory = repo.appendingPathComponent(".pi/agent-leases", isDirectory: true)
        try FileManager.default.createDirectory(at: leaseDirectory, withIntermediateDirectories: true)
        let lease = "{\"agentId\":\"\(agentID)\",\"pid\":\(ProcessInfo.processInfo.processIdentifier),\"token\":\"test\",\"createdAt\":0}"
        try lease.data(using: .utf8)!.write(
            to: leaseDirectory.appendingPathComponent("\(agentID).lease"),
            options: .atomic
        )
        let entry = reviewedEntry(
            agentID: agentID,
            expectedTip: try XCTUnwrap(GitRepo.branchTip(branch, in: repo)),
            basis: .integratedAncestor
        )

        let result = await SubagentStore.discardReviewedWorktreeForMaintenance(
            entry: entry,
            repositoryURL: repo,
            reviewManifest: [entry],
            persistenceDirectory: persistenceDirectory,
            agentLeaseDirectory: leaseDirectory
        )

        XCTAssertEqual(result.status, .skipped, result.detail)
        XCTAssertTrue(result.detail.contains("活 lease"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: worktree.path))
        assertBranchPresent(branch, in: repo)
    }

    private func runtimeWorktree(_ agentID: String, in repository: URL) -> URL {
        repository.appendingPathComponent(".pi/worktrees/\(agentID)", isDirectory: true)
    }

    private func reviewedEntry(
        agentID: String,
        branch: String? = nil,
        expectedTip: String,
        basis: ReviewedWorktreeDiscardBasis,
        allowsDirtyWorktree: Bool = false,
        orphanCloseout: Bool = false
    ) -> ReviewedWorktreeMaintenanceEntry {
        ReviewedWorktreeMaintenanceEntry(
            agentID: agentID,
            branch: branch ?? "pipiui/\(agentID)",
            expectedTip: expectedTip,
            reviewReason: "test code-reviewed manifest entry",
            basis: basis,
            allowsDirtyWorktree: allowsDirtyWorktree,
            orphanCloseout: orphanCloseout
        )
    }

    private func runReviewed(
        _ entry: ReviewedWorktreeMaintenanceEntry,
        repo: URL,
        persistenceDirectory: URL
    ) async -> ReviewedWorktreeMaintenanceResult {
        await SubagentStore.discardReviewedWorktreeForMaintenance(
            entry: entry,
            repositoryURL: repo,
            reviewManifest: [entry],
            persistenceDirectory: persistenceDirectory,
            agentLeaseDirectory: repo.appendingPathComponent(".pi/agent-leases", isDirectory: true)
        )
    }

    private func makeRepository() throws -> (URL, URL, () -> Void) {
        guard GitRepo.findGitExecutable() != nil else {
            throw XCTSkip("git not available")
        }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(
            "pipiui-maintenance-\(UUID().uuidString)",
            isDirectory: true
        )
        let repo = root.appendingPathComponent("repo", isDirectory: true)
        let persistenceDirectory = root.appendingPathComponent("subagents", isDirectory: true)
        try FileManager.default.createDirectory(at: repo, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: persistenceDirectory, withIntermediateDirectories: true)
        _ = try GitRepo.run(gitArgs: ["init", "-b", "main"], in: repo)
        _ = try GitRepo.run(gitArgs: ["config", "user.email", "pipiui-test@example.com"], in: repo)
        _ = try GitRepo.run(gitArgs: ["config", "user.name", "PipiUI Test"], in: repo)
        _ = try GitRepo.run(gitArgs: ["commit", "--allow-empty", "-m", "init"], in: repo)
        return (repo, persistenceDirectory, { try? FileManager.default.removeItem(at: root) })
    }

    private func writePersistedAgent(
        agentID: String,
        branch: String,
        worktree: URL,
        state: SubagentInfo.State = .ok,
        to directory: URL,
        fileName: String = "fixture"
    ) throws {
        let agent = SubagentInfo(
            id: agentID,
            parentId: nil,
            name: "general-purpose",
            task: "maintenance fixture",
            depth: 1,
            model: nil,
            state: state,
            worktreePath: worktree.path,
            worktreeBranch: branch,
            worktreeLifecycle: .pendingReview
        )
        let file = directory.appendingPathComponent("\(fileName).agents.json")
        try JSONEncoder().encode([agent]).write(to: file, options: .atomic)
    }

    private func assertBranchPresent(_ branch: String, in repository: URL, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertNoThrow(
            try GitRepo.run(
                gitArgs: ["show-ref", "--verify", "--quiet", "refs/heads/\(branch)"],
                in: repository
            ),
            file: file,
            line: line
        )
    }

    private func assertBranchAbsent(_ branch: String, in repository: URL, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertThrowsError(
            try GitRepo.run(
                gitArgs: ["show-ref", "--verify", "--quiet", "refs/heads/\(branch)"],
                in: repository
            ),
            file: file,
            line: line
        )
    }
}
