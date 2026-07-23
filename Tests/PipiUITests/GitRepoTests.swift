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

        // checkout feature/x then re-probe
        try GitRepo.checkout(branch: "feature/x", in: dir)
        let after = GitRepo.probe(workTree: dir)
        XCTAssertEqual(after.currentBranch, "feature/x")
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
}
