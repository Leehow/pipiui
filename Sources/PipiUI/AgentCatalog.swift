import Foundation

/// One PipiUI / pi agent definition (legacy `agents/*.md` or standard
/// `agents/<name>/AGENT.md` frontmatter).
struct AgentDefinition: Identifiable, Equatable, Hashable, Sendable {
    let name: String
    let description: String
    let tools: [String]
    let frontmatterModel: String?
    let filePath: String
    var id: String { name }
}

/// Discovers bundled agent definitions for Settings/remote display. Runtime
/// authorization and package diagnostics live in `PiExt/subagent/agents.ts`;
/// this catalog intentionally mirrors the same two on-disk layouts so it never
/// advertises a duplicate or ignores a migrated bundled package.
enum AgentCatalog {
    /// Preferred display order for built-in PipiUI agents.
    static let preferredOrder = [
        "explore", "plan", "general-purpose", "reviewer", "operator", "secretary", "long-test",
    ]

    /// Hardcoded fallbacks so Settings never shows an empty Subagent tab when
    /// Application Support / bundle resources are missing or stale.
    static let builtInAgents: [AgentDefinition] = [
        .init(
            name: "explore",
            description: "Grok-style research agent. Searches the web and the repository, reads, greps, and runs shell, but does not edit files.",
            tools: ["read", "grep", "find", "ls", "bash", "web_search", "fetch_content", "source_check", "get_search_content", "arxiv_fetch"],
            frontmatterModel: "xai/grok-4.5:high",
            filePath: ""
        ),
        .init(
            name: "plan",
            description: "Grok-style planning agent. Explores and produces an implementation plan; does not edit files.",
            tools: ["read", "grep", "find", "ls", "bash", "fetch_content", "source_check", "get_search_content", "arxiv_fetch"],
            frontmatterModel: "xai/grok-4.5:high",
            filePath: ""
        ),
        .init(
            name: "general-purpose",
            description: "Grok-style full-capability worker. Implements tasks in an isolated context.",
            tools: ["read", "bash", "edit", "write", "grep", "find", "ls", "fetch_content", "source_check", "get_search_content", "arxiv_fetch"],
            frontmatterModel: "xai/grok-4.5:high",
            filePath: ""
        ),
        .init(
            name: "reviewer",
            description: "Read-only code review specialist for quality and security.",
            tools: ["read", "grep", "find", "ls", "bash", "fetch_content", "source_check", "get_search_content", "arxiv_fetch"],
            frontmatterModel: "xai/grok-4.5:high",
            filePath: ""
        ),
        .init(
            name: "operator",
            description: "Computer-use desktop worker. Performs macOS desktop operations and returns a compressed text verdict; does not edit code files.",
            tools: ["read", "grep", "find", "ls", "bash"],
            frontmatterModel: "xai/grok-4.5:high",
            filePath: ""
        ),
        .init(
            name: "secretary",
            description: "Boss closeout secretary. Reconciles agent outcomes, worktrees, branches, verification, temporary artifacts, and the existing Boss ledger without creating another worktree.",
            tools: ["read", "grep", "find", "ls", "bash", "edit", "write", "secretary_commit"],
            frontmatterModel: "xai/grok-4.5:high",
            filePath: ""
        ),
        .init(
            name: "long-test",
            description: "Long-running test runner. Executes end-to-end suites, integration/regression sweeps, opt-in long tests, and cross-repo E2E harnesses; reports pass/fail without fixing code.",
            tools: ["read", "grep", "find", "ls", "bash"],
            frontmatterModel: "xai/grok-4.5:high",
            filePath: ""
        ),
    ]

    static func defaultAgentsDirectory(fileManager: FileManager = .default) -> URL {
        fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PipiUI/pi-ext/agents", isDirectory: true)
    }

    /// Candidate directories: Application Support (runtime install) → bundle PiExt/agents.
    static func candidateDirectories(fileManager: FileManager = .default) -> [URL] {
        var dirs: [URL] = [defaultAgentsDirectory(fileManager: fileManager)]
        if let bundled = PipiResourceBundle.shared.url(forResource: "PiExt", withExtension: nil)?
            .appendingPathComponent("agents", isDirectory: true) {
            dirs.append(bundled)
        } else if let resourceRoot = PipiResourceBundle.shared.resourceURL?
            .appendingPathComponent("PiExt/agents", isDirectory: true) {
            dirs.append(resourceRoot)
        }
        return dirs
    }

    /// Load agent definitions. Never returns empty for the built-in set:
    /// disk/bundle first, then merge missing names from `builtInAgents`.
    static func load(from directory: URL? = nil, fileManager: FileManager = .default) -> [AgentDefinition] {
        if let directory {
            let loaded = loadDirectoryCached(directory, fileManager: fileManager)
            return sort(mergeBuiltIns(loaded))
        }
        for dir in candidateDirectories(fileManager: fileManager) {
            let loaded = loadDirectoryCached(dir, fileManager: fileManager)
            if !loaded.isEmpty {
                return sort(mergeBuiltIns(loaded))
            }
        }
        return sort(builtInAgents)
    }

    // MARK: - Process-level cache (SettingsSheet T9 减负)

    private static var cache: [String: (stamp: Date, agents: [AgentDefinition])] = [:]
    private static let cacheLock = NSLock()

    static func invalidateCache() {
        cacheLock.lock()
        cache.removeAll()
        cacheLock.unlock()
    }

    private static func loadDirectoryCached(_ dir: URL, fileManager: FileManager) -> [AgentDefinition] {
        let key = dir.path
        let stamp = directoryStamp(dir, fileManager: fileManager)
        cacheLock.lock()
        if let hit = cache[key], hit.stamp == stamp {
            let cached = hit.agents
            cacheLock.unlock()
            return cached
        }
        cacheLock.unlock()
        let loaded = loadDirectory(dir, fileManager: fileManager)
        cacheLock.lock()
        cache[key] = (stamp: stamp, agents: loaded)
        cacheLock.unlock()
        return loaded
    }

    /// Directory itself + flat `.md` files + standard child `AGENT.md` files.
    private static func directoryStamp(_ dir: URL, fileManager: FileManager) -> Date {
        var stamp = (try? fileManager.attributesOfItem(atPath: dir.path)[.modificationDate] as? Date) ?? .distantPast
        guard let entries = try? fileManager.contentsOfDirectory(
            at: dir,
            includingPropertiesForKeys: [.contentModificationDateKey, .isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else { return stamp }
        for url in entries {
            let isDirectory = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
            let candidate = isDirectory ? url.appendingPathComponent("AGENT.md") : url
            guard !isDirectory ? url.pathExtension.lowercased() == "md" : fileManager.fileExists(atPath: candidate.path)
            else { continue }
            if let mtime = try? candidate.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate,
               mtime > stamp {
                stamp = mtime
            }
        }
        return stamp
    }

    private struct Candidate {
        let url: URL
        let packageDirectoryName: String?
    }

    /// Reads only direct legacy files and direct standard packages; this avoids
    /// recursively discovering `AGENT.md` files in arbitrary prompt folders.
    private static func candidates(in dir: URL, fileManager: FileManager) -> [Candidate] {
        guard let entries = try? fileManager.contentsOfDirectory(
            at: dir,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else { return [] }
        return entries.sorted { $0.lastPathComponent.localizedCaseInsensitiveCompare($1.lastPathComponent) == .orderedAscending }
            .compactMap { url in
                let isDirectory = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
                if isDirectory {
                    let agentFile = url.appendingPathComponent("AGENT.md")
                    return fileManager.fileExists(atPath: agentFile.path)
                        ? Candidate(url: agentFile, packageDirectoryName: url.lastPathComponent)
                        : nil
                }
                return url.pathExtension.lowercased() == "md"
                    ? Candidate(url: url, packageDirectoryName: nil)
                    : nil
            }
    }

    private static func loadDirectory(_ dir: URL, fileManager: FileManager) -> [AgentDefinition] {
        var byName: [String: [AgentDefinition]] = [:]
        for candidate in candidates(in: dir, fileManager: fileManager) {
            guard let text = try? String(contentsOf: candidate.url, encoding: .utf8),
                  let parsed = parseFrontmatter(
                    text,
                    filePath: candidate.url.path,
                    packageDirectoryName: candidate.packageDirectoryName
                  ) else { continue }
            byName[parsed.name, default: []].append(parsed)
        }
        // Runtime rejects a duplicate rather than selecting whichever directory
        // enumeration happened to win. Mirror that safe behavior in Settings.
        return byName.values.compactMap { $0.count == 1 ? $0[0] : nil }
    }

    /// Ensure every preferred built-in name appears (disk wins on conflict).
    static func mergeBuiltIns(_ loaded: [AgentDefinition]) -> [AgentDefinition] {
        var byName: [String: AgentDefinition] = Dictionary(
            uniqueKeysWithValues: builtInAgents.map { ($0.name, $0) }
        )
        for agent in loaded {
            byName[agent.name] = agent
        }
        return Array(byName.values)
    }

    static func sort(_ agents: [AgentDefinition]) -> [AgentDefinition] {
        let rank: [String: Int] = Dictionary(
            uniqueKeysWithValues: preferredOrder.enumerated().map { ($0.element, $0.offset) }
        )
        return agents.sorted { a, b in
            let ra = rank[a.name] ?? 1_000
            let rb = rank[b.name] ?? 1_000
            if ra != rb { return ra < rb }
            return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
        }
    }

    /// Small display parser. Runtime uses Pi's YAML parser plus strict v1
    /// validation; this intentionally extracts only fields Settings needs.
    static func parseFrontmatter(
        _ text: String,
        filePath: String = "",
        packageDirectoryName: String? = nil
    ) -> AgentDefinition? {
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n")
        guard normalized.hasPrefix("---\n") else { return nil }
        let afterOpen = normalized.dropFirst(4)
        guard let endRange = afterOpen.range(of: "\n---\n") else { return nil }
        let fm = String(afterOpen[..<endRange.lowerBound])
        let body = String(afterOpen[endRange.upperBound...])
        var fields: [String: String] = [:]
        var lists: [String: [String]] = [:]
        var activeListKey: String?

        func unquote(_ value: String) -> String {
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard trimmed.count >= 2,
                  (trimmed.hasPrefix("\"") && trimmed.hasSuffix("\"")
                    || trimmed.hasPrefix("'") && trimmed.hasSuffix("'")) else { return trimmed }
            return String(trimmed.dropFirst().dropLast())
        }

        for rawLine in fm.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(rawLine)
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if line.first?.isWhitespace == true,
               trimmed.hasPrefix("- "),
               let activeListKey {
                let value = unquote(String(trimmed.dropFirst(2)))
                if !value.isEmpty { lists[activeListKey, default: []].append(value) }
                continue
            }
            activeListKey = nil
            guard let colon = line.firstIndex(of: ":"), line.first?.isWhitespace != true else { continue }
            let key = String(line[..<colon]).trimmingCharacters(in: .whitespaces)
            let value = unquote(String(line[line.index(after: colon)...]))
            guard !key.isEmpty else { continue }
            fields[key] = value
            if value.isEmpty { activeListKey = key }
        }

        if let packageDirectoryName {
            guard fields["schema"] == "1",
                  fields["name"] == packageDirectoryName,
                  !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        }
        guard let name = fields["name"], !name.isEmpty else { return nil }
        let description = fields["description"] ?? ""
        let rawTools: [String]
        if let list = lists["tools"] {
            rawTools = list
        } else if let value = fields["tools"] {
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.hasPrefix("["), trimmed.hasSuffix("]") {
                rawTools = trimmed.dropFirst().dropLast().split(separator: ",").map {
                    unquote(String($0))
                }
            } else {
                rawTools = trimmed.split(separator: ",").map(String.init)
            }
        } else {
            rawTools = []
        }
        let tools = rawTools.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        let model = fields["model"]?.trimmingCharacters(in: .whitespacesAndNewlines)
        return AgentDefinition(
            name: name,
            description: description,
            tools: tools,
            frontmatterModel: model?.isEmpty == true ? nil : model,
            filePath: filePath
        )
    }
}
