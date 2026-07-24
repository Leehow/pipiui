import Foundation

/// Snapshot of a work tree’s git state for the chat toolbar and agent prompt.
package struct GitRepoStatus: Equatable, Sendable {
    package var isRepo: Bool
    package var currentBranch: String?
    package var isDetached: Bool
    package var shortSHA: String?
    package var localBranches: [String]
    package var githubBrowserURL: URL?

    /// Working tree has staged, unstaged, or untracked changes.
    package var isDirty: Bool
    package var stagedCount: Int
    package var unstagedCount: Int
    package var untrackedCount: Int
    /// Commits on HEAD not in upstream (`rev-list` right count).
    package var ahead: Int
    /// Commits on upstream not in HEAD (`rev-list` left count).
    package var behind: Int
    /// e.g. `origin/main`; nil when no upstream configured.
    package var upstream: String?
    /// Raw `origin` remote URL (any host); nil if missing.
    package var originURL: String?

    package init(
        isRepo: Bool,
        currentBranch: String? = nil,
        isDetached: Bool = false,
        shortSHA: String? = nil,
        localBranches: [String] = [],
        githubBrowserURL: URL? = nil,
        isDirty: Bool = false,
        stagedCount: Int = 0,
        unstagedCount: Int = 0,
        untrackedCount: Int = 0,
        ahead: Int = 0,
        behind: Int = 0,
        upstream: String? = nil,
        originURL: String? = nil
    ) {
        self.isRepo = isRepo
        self.currentBranch = currentBranch
        self.isDetached = isDetached
        self.shortSHA = shortSHA
        self.localBranches = localBranches
        self.githubBrowserURL = githubBrowserURL
        self.isDirty = isDirty
        self.stagedCount = stagedCount
        self.unstagedCount = unstagedCount
        self.untrackedCount = untrackedCount
        self.ahead = ahead
        self.behind = behind
        self.upstream = upstream
        self.originURL = originURL
    }

    package static let empty = GitRepoStatus(
        isRepo: false,
        currentBranch: nil,
        isDetached: false,
        shortSHA: nil,
        localBranches: [],
        githubBrowserURL: nil,
        isDirty: false,
        stagedCount: 0,
        unstagedCount: 0,
        untrackedCount: 0,
        ahead: 0,
        behind: 0,
        upstream: nil,
        originURL: nil
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

    /// Toolbar label; dirty trees append `*`.
    package var toolbarTitle: String {
        let base = GitRepo.toolbarTitle(for: displayBranchName)
        return isDirty ? base + "*" : base
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

    /// Default hard cap for `diffStat` output (bytes, UTF-8).
    package static let defaultDiffMaxBytes = 80_000
    package static let defaultDiffMaxFiles = 50

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

    /// Parse `git status --porcelain` lines into staged / unstaged / untracked counts.
    ///
    /// - `??` → untracked
    /// - index column (X) not space/`?` → staged
    /// - worktree column (Y) not space/`?` → unstaged
    /// A single path can contribute to both staged and unstaged (e.g. `MM`).
    package static func parsePorcelain(_ output: String) -> (staged: Int, unstaged: Int, untracked: Int) {
        var staged = 0
        var unstaged = 0
        var untracked = 0

        for raw in output.split(whereSeparator: \.isNewline) {
            let line = raw
            guard line.count >= 2 else { continue }
            let x = line[line.startIndex]
            let y = line[line.index(after: line.startIndex)]

            if x == "?" && y == "?" {
                untracked += 1
                continue
            }
            // Skip non-status noise if any
            if x == "?" || y == "?" {
                // Unusual; treat remaining `?` pairs already handled
                continue
            }
            if x != " " {
                staged += 1
            }
            if y != " " {
                unstaged += 1
            }
        }
        return (staged, unstaged, untracked)
    }

    /// Parse `git rev-list --left-right --count @{upstream}...HEAD` → `(behind, ahead)`.
    /// Left = commits only on upstream; right = commits only on HEAD.
    package static func parseUpstreamCounts(_ output: String) -> (behind: Int, ahead: Int) {
        let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return (0, 0) }
        let parts = trimmed
            .split(whereSeparator: { $0 == "\t" || $0 == " " })
            .map(String.init)
            .filter { !$0.isEmpty }
        guard parts.count >= 2, let behind = Int(parts[0]), let ahead = Int(parts[1]) else {
            return (0, 0)
        }
        return (behind, ahead)
    }

    package static func toolbarTitle(for name: String, maxChars: Int = 24) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard maxChars > 0 else { return "" }
        if trimmed.count <= maxChars { return trimmed }
        return String(trimmed.prefix(maxChars))
    }

    /// Compact system-prompt block. Marker `## Git (Pipi UI)` is stable for de-dupe.
    package static func promptSnapshot(status: GitRepoStatus) -> String {
        var lines: [String] = ["## Git (Pipi UI)"]
        guard status.isRepo else {
            lines.append("not a git repository")
            return lines.joined(separator: "\n")
        }

        if status.isDetached {
            let sha = status.shortSHA ?? "?"
            lines.append("branch: (detached) @ \(sha)")
        } else {
            lines.append("branch: \(status.currentBranch ?? "unknown")")
        }
        if let sha = status.shortSHA, !sha.isEmpty {
            lines.append("sha: \(sha)")
        }

        let dirtyWord = status.isDirty ? "yes" : "no"
        lines.append(
            "dirty: \(dirtyWord) (staged=\(status.stagedCount) unstaged=\(status.unstagedCount) untracked=\(status.untrackedCount))"
        )

        if let upstream = status.upstream, !upstream.isEmpty {
            lines.append("upstream: \(upstream) +\(status.ahead) -\(status.behind)")
        } else {
            lines.append("upstream: (none)")
        }

        if let origin = status.originURL?.trimmingCharacters(in: .whitespacesAndNewlines), !origin.isEmpty {
            lines.append("origin: \(origin)")
        }

        return lines.joined(separator: "\n")
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

    /// Truncate multi-line diff/stat text by file-ish lines then by byte budget.
    package static func truncateDiffOutput(
        _ text: String,
        maxFiles: Int = defaultDiffMaxFiles,
        maxBytes: Int = defaultDiffMaxBytes
    ) -> String {
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n")
        guard !normalized.isEmpty else { return normalized }

        var lines = normalized.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        var truncatedFiles = false
        if maxFiles > 0, lines.count > maxFiles {
            lines = Array(lines.prefix(maxFiles))
            truncatedFiles = true
        }
        var body = lines.joined(separator: "\n")
        if truncatedFiles {
            body += "\n\n[truncated: showing first \(maxFiles) lines]"
        }

        guard maxBytes > 0 else { return body }
        let utf8 = body.utf8
        if utf8.count <= maxBytes {
            return body
        }
        // Cut on a UTF-8 boundary
        let endIdx = utf8.index(utf8.startIndex, offsetBy: maxBytes)
        var prefix = String(body[body.startIndex..<endIdx])
        // Avoid splitting mid-line when possible
        if let lastNL = prefix.lastIndex(of: "\n"), lastNL != prefix.startIndex {
            prefix = String(prefix[..<lastNL])
        }
        return prefix + "\n\n[truncated at \(maxBytes) bytes]"
    }

    /// `git diff --stat` (HEAD when possible) with hard truncation.
    package static func diffStat(
        workTree: URL,
        maxFiles: Int = defaultDiffMaxFiles,
        maxBytes: Int = defaultDiffMaxBytes
    ) -> String {
        let raw: String
        if let out = try? run(gitArgs: ["diff", "--stat", "HEAD"], in: workTree) {
            raw = out
        } else if let out = try? run(gitArgs: ["diff", "--stat"], in: workTree) {
            raw = out
        } else {
            return "(diff unavailable)"
        }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return "(no unstaged/HEAD diff)"
        }
        return truncateDiffOutput(raw, maxFiles: maxFiles, maxBytes: maxBytes)
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
            let trimmed = remoteOut.trimmingCharacters(in: .whitespacesAndNewlines)
            status.originURL = trimmed.isEmpty ? nil : trimmed
            status.githubBrowserURL = githubBrowserURL(fromRemoteURL: remoteOut)
        }

        if let porcelain = try? run(gitArgs: ["status", "--porcelain"], in: workTree) {
            let counts = parsePorcelain(porcelain)
            status.stagedCount = counts.staged
            status.unstagedCount = counts.unstaged
            status.untrackedCount = counts.untracked
            status.isDirty = counts.staged + counts.unstaged + counts.untracked > 0
        }

        if let upOut = try? run(
            gitArgs: ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
            in: workTree
        ) {
            let up = upOut.trimmingCharacters(in: .whitespacesAndNewlines)
            if !up.isEmpty {
                status.upstream = up
                if let countOut = try? run(
                    gitArgs: ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"],
                    in: workTree
                ) {
                    let c = parseUpstreamCounts(countOut)
                    status.behind = c.behind
                    status.ahead = c.ahead
                }
            }
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
