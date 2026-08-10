import XCTest
@testable import PipiUI

final class WorktreeMergeReadinessTests: XCTestCase {
    func testChangedPathOverlapIsExactAndStable() {
        let worker = GitRepo.parseChangedPaths("Sources/A.swift\nREADME.md\n")
        let main = GitRepo.parseChangedPaths("README.md\nnotes.txt\n")
        XCTAssertEqual(GitRepo.overlappingPaths(worker: worker, main: main), ["README.md"])
    }

    func testDisjointChangedPathsHaveNoOverlap() {
        XCTAssertTrue(GitRepo.overlappingPaths(
            worker: ["Sources/A.swift"], main: ["Sources/B.swift", "scratch.txt"]
        ).isEmpty)
    }

    func testReadinessWaitsForOverlappingStagedUnstagedAndUntrackedWIP() throws {
        let (repo, cleanup) = try makeRepository()
        defer { cleanup() }
        let worktree = repo.deletingLastPathComponent().appendingPathComponent("worker-\(UUID())", isDirectory: true)
        try GitRepo.worktreeAdd(branch: "pipiui/recovery", at: worktree, in: repo)
        try "worker\n".write(to: worktree.appendingPathComponent("shared.txt"), atomically: true, encoding: .utf8)
        _ = try GitRepo.run(gitArgs: ["add", "shared.txt"], in: worktree)
        _ = try GitRepo.run(gitArgs: ["commit", "-m", "worker"], in: worktree)
        try "main wip\n".write(to: repo.appendingPathComponent("shared.txt"), atomically: true, encoding: .utf8)

        XCTAssertEqual(GitRepo.mergeReadiness(branch: "pipiui/recovery", in: repo), .waitingForMain(paths: ["shared.txt"]))
    }

    func testReadinessAllowsDisjointMainWIP() throws {
        let (repo, cleanup) = try makeRepository()
        defer { cleanup() }
        let worktree = repo.deletingLastPathComponent().appendingPathComponent("worker-\(UUID())", isDirectory: true)
        try GitRepo.worktreeAdd(branch: "pipiui/recovery", at: worktree, in: repo)
        try "worker\n".write(to: worktree.appendingPathComponent("worker.txt"), atomically: true, encoding: .utf8)
        _ = try GitRepo.run(gitArgs: ["add", "worker.txt"], in: worktree)
        _ = try GitRepo.run(gitArgs: ["commit", "-m", "worker"], in: worktree)
        try "main wip\n".write(to: repo.appendingPathComponent("untracked.txt"), atomically: true, encoding: .utf8)

        XCTAssertEqual(GitRepo.mergeReadiness(branch: "pipiui/recovery", in: repo), .ready)
    }

    func testCommittedRenameExposesOldPathAgainstMainWIP() throws {
        let (repo, cleanup) = try makeRepository()
        defer { cleanup() }
        try "original\n".write(to: repo.appendingPathComponent("old.txt"), atomically: true, encoding: .utf8)
        _ = try GitRepo.run(gitArgs: ["add", "old.txt"], in: repo)
        _ = try GitRepo.run(gitArgs: ["commit", "-m", "old"], in: repo)
        let worktree = repo.deletingLastPathComponent().appendingPathComponent("worker-\(UUID())", isDirectory: true)
        try GitRepo.worktreeAdd(branch: "pipiui/recovery", at: worktree, in: repo)
        _ = try GitRepo.run(gitArgs: ["mv", "old.txt", "new.txt"], in: worktree)
        _ = try GitRepo.run(gitArgs: ["commit", "-am", "rename"], in: worktree)
        try "main edit\n".write(to: repo.appendingPathComponent("old.txt"), atomically: true, encoding: .utf8)

        XCTAssertEqual(
            GitRepo.mergeReadiness(branch: "pipiui/recovery", workerWorkTree: worktree, in: repo),
            .waitingForMain(paths: ["old.txt"])
        )
    }

    func testReadinessIncludesUncommittedWorkerPathsBeforeAutomaticCommit() throws {
        let (repo, cleanup) = try makeRepository()
        defer { cleanup() }
        let worktree = repo.deletingLastPathComponent().appendingPathComponent("worker-\(UUID())", isDirectory: true)
        try GitRepo.worktreeAdd(branch: "pipiui/recovery", at: worktree, in: repo)
        try "worker draft\n".write(to: worktree.appendingPathComponent("draft.txt"), atomically: true, encoding: .utf8)
        try "user draft\n".write(to: repo.appendingPathComponent("draft.txt"), atomically: true, encoding: .utf8)

        XCTAssertEqual(
            GitRepo.mergeReadiness(branch: "pipiui/recovery", workerWorkTree: worktree, in: repo),
            .waitingForMain(paths: ["draft.txt"])
        )
    }

    func testRecoveryIncidentRoundTripsThroughPersistence() throws {
        let original = SubagentInfo(
            id: "worker", parentId: nil, name: "general-purpose", task: "recover", depth: 1, model: nil,
            recoveryState: .fixerRunning, recoveryOwner: "worker", recoveryAttempt: 2,
            recoveryReason: "conflict", recoveryUpdatedAt: Date(timeIntervalSince1970: 1),
            recoveryFreshContext: true, recoveryBossSignaled: true
        )
        let decoded = try JSONDecoder().decode(SubagentInfo.self, from: JSONEncoder().encode(original))
        XCTAssertEqual(decoded.recoveryState, .fixerRunning)
        XCTAssertEqual(decoded.recoveryOwner, "worker")
        XCTAssertEqual(decoded.recoveryAttempt, 2)
        XCTAssertTrue(decoded.recoveryFreshContext)
        XCTAssertTrue(decoded.recoveryBossSignaled)
    }

    private func makeRepository() throws -> (URL, () -> Void) {
        guard GitRepo.findGitExecutable() != nil else { throw XCTSkip("git not available") }
        let repo = FileManager.default.temporaryDirectory.appendingPathComponent("pipiui-readiness-\(UUID())", isDirectory: true)
        try FileManager.default.createDirectory(at: repo, withIntermediateDirectories: true)
        _ = try GitRepo.run(gitArgs: ["init", "-b", "main"], in: repo)
        _ = try GitRepo.run(gitArgs: ["config", "user.email", "test@example.com"], in: repo)
        _ = try GitRepo.run(gitArgs: ["config", "user.name", "Test"], in: repo)
        _ = try GitRepo.run(gitArgs: ["commit", "--allow-empty", "-m", "init"], in: repo)
        return (repo, { try? FileManager.default.removeItem(at: repo) })
    }
}
