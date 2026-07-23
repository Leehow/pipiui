import Foundation

/// Snapshot of a work tree’s git state for the chat toolbar.
package struct GitRepoStatus: Equatable, Sendable {
    package var isRepo: Bool
    package var currentBranch: String?
    package var isDetached: Bool
    package var shortSHA: String?
    package var localBranches: [String]
    package var githubBrowserURL: URL?

    package init(
        isRepo: Bool,
        currentBranch: String? = nil,
        isDetached: Bool = false,
        shortSHA: String? = nil,
        localBranches: [String] = [],
        githubBrowserURL: URL? = nil
    ) {
        self.isRepo = isRepo
        self.currentBranch = currentBranch
        self.isDetached = isDetached
        self.shortSHA = shortSHA
        self.localBranches = localBranches
        self.githubBrowserURL = githubBrowserURL
    }

    package static let empty = GitRepoStatus(
        isRepo: false,
        currentBranch: nil,
        isDetached: false,
        shortSHA: nil,
        localBranches: [],
        githubBrowserURL: nil
    )

    package var displayBranchName: String {
        if isDetached {
            if let shortSHA, !shortSHA.isEmpty {
                return "detached @ \(shortSHA)"
            }
            return "detached"
        }
        if let currentBranch, !currentBranch.isEmpty {
            return currentBranch
        }
        return "unknown"
    }

    package var toolbarTitle: String {
        GitRepo.toolbarTitle(for: displayBranchName)
    }
}

package enum GitRepoError: Error, LocalizedError, Equatable, Sendable {
    case gitNotFound
    case notARepo
    case commandFailed(String)

    package var errorDescription: String? {
        switch self {
        case .gitNotFound:
            return "找不到 git 可执行文件"
        case .notARepo:
            return "不是 git 仓库"
        case .commandFailed(let message):
            return message.isEmpty ? "git 命令失败" : message
        }
    }
}

/// Git CLI helpers. Pure Foundation — no libgit2.
package enum GitRepo {

    // MARK: - Executable / process

    package static func findGitExecutable() -> String? {
        let fm = FileManager.default
        var candidates = [
            "/usr/bin/git",
            "/opt/homebrew/bin/git",
            "/usr/local/bin/git",
        ]
        if let path = ProcessInfo.processInfo.environment["PATH"] {
            candidates += path.split(separator: ":").map { String($0) + "/git" }
        }
        return candidates.first { fm.isExecutableFile(atPath: $0) }
    }

    /// Run `git -C <workTree> <gitArgs…>` without a shell. Returns stdout on success.
    @discardableResult
    package static func run(gitArgs: [String], in workTree: URL) throws -> String {
        guard let git = findGitExecutable() else {
            throw GitRepoError.gitNotFound
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: git)
        process.arguments = ["-C", workTree.path] + gitArgs
        process.standardInput = FileHandle.nullDevice

        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr

        do {
            try process.run()
        } catch {
            throw GitRepoError.commandFailed(error.localizedDescription)
        }
        process.waitUntilExit()

        let outData = stdout.fileHandleForReading.readDataToEndOfFile()
        let errData = stderr.fileHandleForReading.readDataToEndOfFile()
        let outText = String(data: outData, encoding: .utf8) ?? ""
        let errText = String(data: errData, encoding: .utf8) ?? ""

        if process.terminationStatus != 0 {
            let msg = errText.trimmingCharacters(in: .whitespacesAndNewlines)
            if msg.isEmpty {
                throw GitRepoError.commandFailed("git 退出码 \(process.terminationStatus)")
            }
            throw GitRepoError.commandFailed(msg)
        }
        return outText
    }

    // MARK: - Pure parsers (unit-tested)

    package static func parseIsInsideWorkTree(_ output: String) -> Bool {
        output.trimmingCharacters(in: .whitespacesAndNewlines) == "true"
    }

    package static func parseAbbrevRef(_ output: String) -> (branch: String?, isDetached: Bool) {
        let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return (nil, false)
        }
        if trimmed == "HEAD" {
            return (nil, true)
        }
        return (trimmed, false)
    }

    package static func parseBranchList(_ output: String) -> [String] {
        output
            .split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    package static func parseShortSHA(_ output: String) -> String? {
        let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    package static func toolbarTitle(for name: String, maxChars: Int = 24) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard maxChars > 0 else { return "" }
        if trimmed.count <= maxChars { return trimmed }
        return String(trimmed.prefix(maxChars))
    }

    /// HTTPS/SSH github.com remotes → `https://github.com/owner/repo` (strip `.git`).
    /// Non-github hosts (gitlab, etc.) → nil.
    package static func githubBrowserURL(fromRemoteURL remote: String) -> URL? {
        let raw = remote.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else { return nil }

        let pathPart: String
        if let range = raw.range(of: "github.com:", options: .caseInsensitive) {
            // scp-like: git@github.com:owner/repo.git
            pathPart = String(raw[range.upperBound...])
        } else if let range = raw.range(of: "github.com/", options: .caseInsensitive) {
            // https://github.com/owner/repo.git or ssh://git@github.com/owner/repo.git
            pathPart = String(raw[range.upperBound...])
        } else {
            return nil
        }

        var path = pathPart
        if let q = path.firstIndex(of: "?") {
            path = String(path[..<q])
        }
        if let h = path.firstIndex(of: "#") {
            path = String(path[..<h])
        }
        path = path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if path.lowercased().hasSuffix(".git") {
            path = String(path.dropLast(4))
        }

        let parts = path.split(separator: "/").map(String.init).filter { !$0.isEmpty }
        guard parts.count >= 2 else { return nil }
        let owner = parts[0]
        let repo = parts[1]
        guard !owner.isEmpty, !repo.isEmpty else { return nil }
        return URL(string: "https://github.com/\(owner)/\(repo)")
    }

    // MARK: - High-level operations

    package static func probe(workTree: URL) -> GitRepoStatus {
        let insideOut: String
        do {
            insideOut = try run(gitArgs: ["rev-parse", "--is-inside-work-tree"], in: workTree)
        } catch {
            return .empty
        }
        guard parseIsInsideWorkTree(insideOut) else {
            return .empty
        }

        var status = GitRepoStatus.empty
        status.isRepo = true

        if let abbrev = try? run(gitArgs: ["rev-parse", "--abbrev-ref", "HEAD"], in: workTree) {
            let parsed = parseAbbrevRef(abbrev)
            status.currentBranch = parsed.branch
            status.isDetached = parsed.isDetached
        }

        if let shaOut = try? run(gitArgs: ["rev-parse", "--short", "HEAD"], in: workTree) {
            status.shortSHA = parseShortSHA(shaOut)
        }

        if let branchOut = try? run(gitArgs: ["branch", "--format=%(refname:short)"], in: workTree) {
            status.localBranches = parseBranchList(branchOut)
        }

        if let remoteOut = try? run(gitArgs: ["remote", "get-url", "origin"], in: workTree) {
            status.githubBrowserURL = githubBrowserURL(fromRemoteURL: remoteOut)
        }

        return status
    }

    /// Checkout a local branch. Rejects empty names and names starting with `-`.
    package static func checkout(branch: String, in workTree: URL) throws {
        let name = branch.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else {
            throw GitRepoError.commandFailed("分支名不能为空")
        }
        guard !name.hasPrefix("-") else {
            throw GitRepoError.commandFailed("非法分支名")
        }
        _ = try run(gitArgs: ["checkout", name], in: workTree)
    }
}
