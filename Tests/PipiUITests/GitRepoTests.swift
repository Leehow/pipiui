import XCTest
import PipiUI

final class GitRepoTests: XCTestCase {

    // MARK: - Pure parsers

    func testParseIsInsideWorkTree() {
        XCTAssertTrue(GitRepo.parseIsInsideWorkTree("true"))
        XCTAssertTrue(GitRepo.parseIsInsideWorkTree("true\n"))
        XCTAssertTrue(GitRepo.parseIsInsideWorkTree("  true  \n"))
        XCTAssertFalse(GitRepo.parseIsInsideWorkTree("false"))
        XCTAssertFalse(GitRepo.parseIsInsideWorkTree(""))
        XCTAssertFalse(GitRepo.parseIsInsideWorkTree("TRUE"))
    }

    func testParseAbbrevRef() {
        let main = GitRepo.parseAbbrevRef("main\n")
        XCTAssertEqual(main.branch, "main")
        XCTAssertFalse(main.isDetached)

        let head = GitRepo.parseAbbrevRef("HEAD")
        XCTAssertNil(head.branch)
        XCTAssertTrue(head.isDetached)

        let headNL = GitRepo.parseAbbrevRef("HEAD\n")
        XCTAssertNil(headNL.branch)
        XCTAssertTrue(headNL.isDetached)

        let feature = GitRepo.parseAbbrevRef("  feature/x  ")
        XCTAssertEqual(feature.branch, "feature/x")
        XCTAssertFalse(feature.isDetached)
    }

    func testParseBranchList() {
        XCTAssertEqual(GitRepo.parseBranchList(""), [])
        XCTAssertEqual(GitRepo.parseBranchList("\n\n"), [])
        XCTAssertEqual(
            GitRepo.parseBranchList("main\nfeature/x\n"),
            ["main", "feature/x"]
        )
        XCTAssertEqual(
            GitRepo.parseBranchList("  main  \n\n  develop\n"),
            ["main", "develop"]
        )
    }

    func testParseShortSHA() {
        XCTAssertEqual(GitRepo.parseShortSHA("abc1234\n"), "abc1234")
        XCTAssertNil(GitRepo.parseShortSHA(""))
        XCTAssertNil(GitRepo.parseShortSHA("   \n"))
    }

    func testParsePorcelainCounts() {
        let empty = GitRepo.parsePorcelain("")
        XCTAssertEqual(empty.staged, 0)
        XCTAssertEqual(empty.unstaged, 0)
        XCTAssertEqual(empty.untracked, 0)

        let sample = """
        M  staged.txt
         M unstaged.txt
        MM both.txt
        ?? untracked.txt
        A  added.txt
         D deleted-wt.txt
        """
        let c = GitRepo.parsePorcelain(sample)
        XCTAssertEqual(c.staged, 3) // M , MM, A
        XCTAssertEqual(c.unstaged, 3) //  M, MM,  D
        XCTAssertEqual(c.untracked, 1)

        let onlyUntracked = GitRepo.parsePorcelain("?? a\n?? b\n")
        XCTAssertEqual(onlyUntracked.untracked, 2)
        XCTAssertEqual(onlyUntracked.staged, 0)
        XCTAssertEqual(onlyUntracked.unstaged, 0)
    }

    func testParseUpstreamCounts() {
        let a = GitRepo.parseUpstreamCounts("3\t1\n")
        XCTAssertEqual(a.behind, 3)
        XCTAssertEqual(a.ahead, 1)

        let b = GitRepo.parseUpstreamCounts("0 0")
        XCTAssertEqual(b.behind, 0)
        XCTAssertEqual(b.ahead, 0)

        let c = GitRepo.parseUpstreamCounts("12\t0")
        XCTAssertEqual(c.behind, 12)
        XCTAssertEqual(c.ahead, 0)

        let bad = GitRepo.parseUpstreamCounts("nope")
        XCTAssertEqual(bad.behind, 0)
        XCTAssertEqual(bad.ahead, 0)

        let empty = GitRepo.parseUpstreamCounts("")
        XCTAssertEqual(empty.behind, 0)
        XCTAssertEqual(empty.ahead, 0)
    }

    func testPromptSnapshot() {
        let clean = GitRepoStatus(
            isRepo: true,
            currentBranch: "main",
            isDetached: false,
            shortSHA: "abc1234",
            localBranches: ["main"],
            isDirty: false,
            stagedCount: 0,
            unstagedCount: 0,
            untrackedCount: 0,
            ahead: 1,
            behind: 2,
            upstream: "origin/main",
            originURL: "https://github.com/acme/app.git"
        )
        let text = GitRepo.promptSnapshot(status: clean)
        XCTAssertTrue(text.hasPrefix("## Git (Pipi UI)"))
        XCTAssertTrue(text.contains("branch: main"))
        XCTAssertTrue(text.contains("sha: abc1234"))
        XCTAssertTrue(text.contains("dirty: no (staged=0 unstaged=0 untracked=0)"))
        XCTAssertTrue(text.contains("upstream: origin/main +1 -2"))
        XCTAssertTrue(text.contains("origin: https://github.com/acme/app.git"))

        let notRepo = GitRepo.promptSnapshot(status: .empty)
        XCTAssertTrue(notRepo.contains("## Git (Pipi UI)"))
        XCTAssertTrue(notRepo.contains("not a git repository"))

        let detached = GitRepo.promptSnapshot(
            status: GitRepoStatus(
                isRepo: true,
                isDetached: true,
                shortSHA: "deadbee",
                isDirty: true,
                stagedCount: 1,
                unstagedCount: 0,
                untrackedCount: 2
            )
        )
        XCTAssertTrue(detached.contains("branch: (detached) @ deadbee"))
        XCTAssertTrue(detached.contains("dirty: yes (staged=1 unstaged=0 untracked=2)"))
        XCTAssertTrue(detached.contains("upstream: (none)"))
    }

    func testTruncateDiffOutput() {
        let lines = (0..<10).map { "line\($0)" }.joined(separator: "\n")
        let byFiles = GitRepo.truncateDiffOutput(lines, maxFiles: 3, maxBytes: 10_000)
        XCTAssertTrue(byFiles.contains("line0"))
        XCTAssertTrue(byFiles.contains("line2"))
        XCTAssertFalse(byFiles.contains("line9"))
        XCTAssertTrue(byFiles.contains("[truncated: showing first 3 lines]"))

        let long = String(repeating: "x", count: 500)
        let byBytes = GitRepo.truncateDiffOutput(long, maxFiles: 100, maxBytes: 50)
        XCTAssertTrue(byBytes.contains("[truncated at 50 bytes]"))
        XCTAssertLessThan(byBytes.utf8.count, 120)
    }

    func testToolbarTitleTruncation() {
        XCTAssertEqual(GitRepo.toolbarTitle(for: "main"), "main")
        XCTAssertEqual(GitRepo.toolbarTitle(for: "  main  "), "main")

        let long = String(repeating: "b", count: 40)
        let title = GitRepo.toolbarTitle(for: long, maxChars: 24)
        XCTAssertEqual(title.count, 24)
        XCTAssertEqual(title, String(repeating: "b", count: 24))

        let defaultCap = GitRepo.toolbarTitle(for: String(repeating: "x", count: 30))
        XCTAssertEqual(defaultCap.count, 24)
    }

    func testGithubBrowserURLHTTPS() {
        let u1 = GitRepo.githubBrowserURL(fromRemoteURL: "https://github.com/owner/repo.git")
        XCTAssertEqual(u1?.absoluteString, "https://github.com/owner/repo")

        let u2 = GitRepo.githubBrowserURL(fromRemoteURL: "https://github.com/owner/repo")
        XCTAssertEqual(u2?.absoluteString, "https://github.com/owner/repo")

        let u3 = GitRepo.githubBrowserURL(fromRemoteURL: "https://github.com/acme/app.git\n")
        XCTAssertEqual(u3?.absoluteString, "https://github.com/acme/app")
    }

    func testGithubBrowserURLSSH() {
        let u1 = GitRepo.githubBrowserURL(fromRemoteURL: "git@github.com:owner/repo.git")
        XCTAssertEqual(u1?.absoluteString, "https://github.com/owner/repo")

        let u2 = GitRepo.githubBrowserURL(fromRemoteURL: "ssh://git@github.com/owner/repo.git")
        XCTAssertEqual(u2?.absoluteString, "https://github.com/owner/repo")
    }

    func testGithubBrowserURLRejectsNonGitHub() {
        XCTAssertNil(GitRepo.githubBrowserURL(fromRemoteURL: "https://gitlab.com/owner/repo.git"))
        XCTAssertNil(GitRepo.githubBrowserURL(fromRemoteURL: "git@gitlab.com:owner/repo.git"))
        XCTAssertNil(GitRepo.githubBrowserURL(fromRemoteURL: ""))
        XCTAssertNil(GitRepo.githubBrowserURL(fromRemoteURL: "https://bitbucket.org/owner/repo.git"))
    }

    func testDisplayBranchNameAndToolbarTitleOnStatus() {
        let attached = GitRepoStatus(
            isRepo: true,
            currentBranch: "main",
            isDetached: false,
            shortSHA: "abc1234",
            localBranches: ["main"],
            githubBrowserURL: nil
        )
        XCTAssertEqual(attached.displayBranchName, "main")
        XCTAssertEqual(attached.toolbarTitle, "main")
        XCTAssertFalse(attached.isDirty)

        let dirty = GitRepoStatus(
            isRepo: true,
            currentBranch: "main",
            isDirty: true,
            stagedCount: 1,
            unstagedCount: 2,
            untrackedCount: 0
        )
        XCTAssertEqual(dirty.toolbarTitle, "main*")

        let detached = GitRepoStatus(
            isRepo: true,
            currentBranch: nil,
            isDetached: true,
            shortSHA: "deadbee",
            localBranches: [],
            githubBrowserURL: nil
        )
        XCTAssertEqual(detached.displayBranchName, "detached @ deadbee")
        XCTAssertTrue(detached.toolbarTitle.hasPrefix("detached"))
        XCTAssertFalse(detached.toolbarTitle.hasSuffix("*"))
    }

    func testEmptyDefaultsIncludeNewFields() {
        let e = GitRepoStatus.empty
        XCTAssertFalse(e.isRepo)
        XCTAssertFalse(e.isDirty)
        XCTAssertEqual(e.stagedCount, 0)
        XCTAssertEqual(e.unstagedCount, 0)
        XCTAssertEqual(e.untrackedCount, 0)
        XCTAssertEqual(e.ahead, 0)
        XCTAssertEqual(e.behind, 0)
        XCTAssertNil(e.upstream)
        XCTAssertNil(e.originURL)
    }

    // MARK: - probe integration

    func testProbeNonGitTempDirectory() throws {
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent(
            "pipiui-nongit-\(UUID().uuidString)",
            isDirectory: true
        )
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: dir) }

        let status = GitRepo.probe(workTree: dir)
        XCTAssertFalse(status.isRepo)
        XCTAssertNil(status.currentBranch)
        XCTAssertEqual(status.localBranches, [])
        XCTAssertFalse(status.isDirty)
    }

    func testProbeTempGitInitWithBranches() throws {
        guard GitRepo.findGitExecutable() != nil else {
            throw XCTSkip("git not available")
        }

        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent(
            "pipiui-git-\(UUID().uuidString)",
            isDirectory: true
        )
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: dir) }

        _ = try GitRepo.run(gitArgs: ["init", "-b", "main"], in: dir)
        _ = try GitRepo.run(gitArgs: ["config", "user.email", "pipiui-test@example.com"], in: dir)
        _ = try GitRepo.run(gitArgs: ["config", "user.name", "PipiUI Test"], in: dir)
        _ = try GitRepo.run(gitArgs: ["commit", "--allow-empty", "-m", "init"], in: dir)
        _ = try GitRepo.run(gitArgs: ["branch", "feature/x"], in: dir)

        let status = GitRepo.probe(workTree: dir)
        XCTAssertTrue(status.isRepo)
        XCTAssertEqual(status.currentBranch, "main")
        XCTAssertFalse(status.isDetached)
        XCTAssertNotNil(status.shortSHA)
        XCTAssertFalse(status.shortSHA?.isEmpty ?? true)
        XCTAssertTrue(status.localBranches.contains("main"))
        XCTAssertTrue(status.localBranches.contains("feature/x"))
        XCTAssertNil(status.githubBrowserURL)
        XCTAssertFalse(status.isDirty)
        XCTAssertEqual(status.stagedCount, 0)
        XCTAssertEqual(status.unstagedCount, 0)
        XCTAssertEqual(status.untrackedCount, 0)

        // checkout feature/x then re-probe
        try GitRepo.checkout(branch: "feature/x", in: dir)
        let after = GitRepo.probe(workTree: dir)
        XCTAssertEqual(after.currentBranch, "feature/x")
    }

    func testProbeDirtyAndOriginAndDiffStat() throws {
        guard GitRepo.findGitExecutable() != nil else {
            throw XCTSkip("git not available")
        }

        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent(
            "pipiui-git-dirty-\(UUID().uuidString)",
            isDirectory: true
        )
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: dir) }

        _ = try GitRepo.run(gitArgs: ["init", "-b", "main"], in: dir)
        _ = try GitRepo.run(gitArgs: ["config", "user.email", "pipiui-test@example.com"], in: dir)
        _ = try GitRepo.run(gitArgs: ["config", "user.name", "PipiUI Test"], in: dir)
        let tracked = dir.appendingPathComponent("tracked.txt")
        try "v1\n".write(to: tracked, atomically: true, encoding: .utf8)
        _ = try GitRepo.run(gitArgs: ["add", "tracked.txt"], in: dir)
        _ = try GitRepo.run(gitArgs: ["commit", "-m", "init"], in: dir)

        // origin (non-github still fills originURL)
        _ = try GitRepo.run(
            gitArgs: ["remote", "add", "origin", "https://example.com/acme/app.git"],
            in: dir
        )

        // unstaged + untracked
        try "v2\n".write(to: tracked, atomically: true, encoding: .utf8)
        try "new\n".write(
            to: dir.appendingPathComponent("fresh.txt"),
            atomically: true,
            encoding: .utf8
        )
        // staged
        let staged = dir.appendingPathComponent("staged.txt")
        try "s\n".write(to: staged, atomically: true, encoding: .utf8)
        _ = try GitRepo.run(gitArgs: ["add", "staged.txt"], in: dir)

        let status = GitRepo.probe(workTree: dir)
        XCTAssertTrue(status.isRepo)
        XCTAssertTrue(status.isDirty)
        XCTAssertEqual(status.stagedCount, 1)
        XCTAssertEqual(status.unstagedCount, 1)
        XCTAssertEqual(status.untrackedCount, 1)
        XCTAssertEqual(status.originURL, "https://example.com/acme/app.git")
        XCTAssertNil(status.githubBrowserURL)
        XCTAssertTrue(status.toolbarTitle.hasSuffix("*"))

        let snap = GitRepo.promptSnapshot(status: status)
        XCTAssertTrue(snap.contains("dirty: yes"))
        XCTAssertTrue(snap.contains("origin: https://example.com/acme/app.git"))

        let stat = GitRepo.diffStat(workTree: dir, maxFiles: 50, maxBytes: 80_000)
        XCTAssertFalse(stat.isEmpty)
        XCTAssertFalse(stat.contains("(diff unavailable)"))
    }

    func testCheckoutRejectsDangerousNames() throws {
        guard GitRepo.findGitExecutable() != nil else {
            throw XCTSkip("git not available")
        }
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent(
            "pipiui-git-co-\(UUID().uuidString)",
            isDirectory: true
        )
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: dir) }

        _ = try GitRepo.run(gitArgs: ["init", "-b", "main"], in: dir)

        XCTAssertThrowsError(try GitRepo.checkout(branch: "", in: dir))
        XCTAssertThrowsError(try GitRepo.checkout(branch: "   ", in: dir))
        XCTAssertThrowsError(try GitRepo.checkout(branch: "-b", in: dir))
        XCTAssertThrowsError(try GitRepo.checkout(branch: "--force", in: dir))
    }

    func testWorktreeAddCreatesIsolatedRepoPath() throws {
        guard GitRepo.findGitExecutable() != nil else {
            throw XCTSkip("git not available")
        }

        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent(
            "pipiui-git-wt-\(UUID().uuidString)",
            isDirectory: true
        )
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: dir) }

        _ = try GitRepo.run(gitArgs: ["init", "-b", "main"], in: dir)
        _ = try GitRepo.run(gitArgs: ["config", "user.email", "pipiui-test@example.com"], in: dir)
        _ = try GitRepo.run(gitArgs: ["config", "user.name", "PipiUI Test"], in: dir)
        _ = try GitRepo.run(gitArgs: ["commit", "--allow-empty", "-m", "init"], in: dir)

        let wtRoot = dir.appendingPathComponent(".pi/worktrees", isDirectory: true)
        try fm.createDirectory(at: wtRoot, withIntermediateDirectories: true)
        let wtPath = wtRoot.appendingPathComponent("agent-test1", isDirectory: true)
        let branch = "pipiui/agent-test1"

        try GitRepo.worktreeAdd(branch: branch, at: wtPath, in: dir)

        let status = GitRepo.probe(workTree: wtPath)
        XCTAssertTrue(status.isRepo)
        XCTAssertEqual(status.currentBranch, branch)
        XCTAssertFalse(status.isDetached)

        // main worktree unchanged
        let main = GitRepo.probe(workTree: dir)
        XCTAssertEqual(main.currentBranch, "main")
    }

    func testWorktreeAddRejectsDangerousNames() throws {
        guard GitRepo.findGitExecutable() != nil else {
            throw XCTSkip("git not available")
        }
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent(
            "pipiui-git-wt-bad-\(UUID().uuidString)",
            isDirectory: true
        )
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: dir) }

        _ = try GitRepo.run(gitArgs: ["init", "-b", "main"], in: dir)
        _ = try GitRepo.run(gitArgs: ["config", "user.email", "pipiui-test@example.com"], in: dir)
        _ = try GitRepo.run(gitArgs: ["config", "user.name", "PipiUI Test"], in: dir)
        _ = try GitRepo.run(gitArgs: ["commit", "--allow-empty", "-m", "init"], in: dir)

        let dest = dir.appendingPathComponent("wt-safe", isDirectory: true)
        XCTAssertThrowsError(try GitRepo.worktreeAdd(branch: "", at: dest, in: dir))
        XCTAssertThrowsError(try GitRepo.worktreeAdd(branch: "-b", at: dest, in: dir))
        XCTAssertThrowsError(try GitRepo.worktreeAdd(branch: "--force", at: dest, in: dir))
        XCTAssertThrowsError(
            try GitRepo.worktreeAdd(
                branch: "pipiui/ok",
                at: URL(fileURLWithPath: "-evil"),
                in: dir
            )
        )
    }
}
