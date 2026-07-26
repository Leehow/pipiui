import Foundation

/// One PipiUI / pi agent definition (from `agents/*.md` frontmatter).
struct AgentDefinition: Identifiable, Equatable, Hashable, Sendable {
    let name: String
    let description: String
    let tools: [String]
    let frontmatterModel: String?
    let filePath: String
    var id: String { name }
}

/// Discovers agent markdown under PipiUI's installed agents directory.
enum AgentCatalog {
    /// Preferred display order for built-in PipiUI agents.
    static let preferredOrder = [
        "explore", "plan", "general-purpose", "reviewer", "lead", "secretary",
    ]

    /// Hardcoded fallbacks so Settings never shows an empty Subagent tab when
    /// Application Support / bundle resources are missing or stale.
    static let builtInAgents: [AgentDefinition] = [
        .init(
            name: "explore",
            description: "Grok-style research agent. Searches, reads, greps, and runs shell, but does not edit files.",
            tools: ["read", "grep", "find", "ls", "bash"],
            frontmatterModel: "xai/grok-4.5:high",
            filePath: ""
        ),
        .init(
            name: "plan",
            description: "Grok-style planning agent. Explores and produces an implementation plan; does not edit files.",
            tools: ["read", "grep", "find", "ls", "bash"],
            frontmatterModel: "xai/grok-4.5:high",
            filePath: ""
        ),
        .init(
            name: "general-purpose",
            description: "Grok-style full-capability worker. Implements tasks in an isolated context.",
            tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
            frontmatterModel: "xai/grok-4.5:high",
            filePath: ""
        ),
        .init(
            name: "reviewer",
            description: "Read-only code review specialist for quality and security.",
            tools: ["read", "grep", "find", "ls", "bash"],
            frontmatterModel: "xai/grok-4.5:high",
            filePath: ""
        ),
        .init(
            name: "lead",
            description: "Team-lead orchestrator. Breaks a goal into subtasks, delegates them to other subagents, tracks results, and integrates a final answer.",
            tools: ["read", "grep", "find", "ls", "subagent"],
            frontmatterModel: "xai/grok-4.5:high",
            filePath: ""
        ),
        .init(
            name: "secretary",
            description: "Boss closeout secretary. Reconciles agent outcomes, worktrees, branches, verification, temporary artifacts, and the existing Boss ledger without creating another worktree.",
            tools: ["read", "grep", "find", "ls", "bash", "edit", "write"],
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
        if let bundled = Bundle.module.url(forResource: "PiExt", withExtension: nil)?
            .appendingPathComponent("agents", isDirectory: true) {
            dirs.append(bundled)
        } else if let resourceRoot = Bundle.module.resourceURL?
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

    /// 进程级内存缓存：agents 目录在应用生命周期内基本不变，避免每次打开设置
    /// 都重新扫目录 + 逐个读 .md。目录/文件 mtime 变化即失效（仿 PiExtensionConflicts.cache）。
    private static var cache: [String: (stamp: Date, agents: [AgentDefinition])] = [:]
    private static let cacheLock = NSLock()

    /// 手动失效（测试或未来 agents 目录热更新时使用）。
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

    /// 目录自身 + 全部 .md 的最新 mtime；目录不存在时返回 distantPast（后续被创建会自然失效）。
    private static func directoryStamp(_ dir: URL, fileManager: FileManager) -> Date {
        var stamp = (try? fileManager.attributesOfItem(atPath: dir.path)[.modificationDate] as? Date) ?? .distantPast
        if let entries = try? fileManager.contentsOfDirectory(
            at: dir,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles]
        ) {
            for url in entries where url.pathExtension.lowercased() == "md" {
                if let mtime = try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate,
                   mtime > stamp {
                    stamp = mtime
                }
            }
        }
        return stamp
    }

    private static func loadDirectory(_ dir: URL, fileManager: FileManager) -> [AgentDefinition] {
        guard let entries = try? fileManager.contentsOfDirectory(
            at: dir,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ) else {
            return []
        }
        var agents: [AgentDefinition] = []
        for url in entries where url.pathExtension.lowercased() == "md" {
            guard let text = try? String(contentsOf: url, encoding: .utf8),
                  let parsed = parseFrontmatter(text, filePath: url.path) else {
                continue
            }
            agents.append(parsed)
        }
        return agents
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

    /// Minimal YAML-ish frontmatter parser for agent md files.
    static func parseFrontmatter(_ text: String, filePath: String = "") -> AgentDefinition? {
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n")
        guard normalized.hasPrefix("---\n") else { return nil }
        let afterOpen = normalized.dropFirst(4)
        guard let endRange = afterOpen.range(of: "\n---\n") else { return nil }
        let fm = String(afterOpen[..<endRange.lowerBound])
        var fields: [String: String] = [:]
        for line in fm.split(separator: "\n", omittingEmptySubsequences: false) {
            let s = String(line)
            guard let colon = s.firstIndex(of: ":") else { continue }
            let key = s[..<colon].trimmingCharacters(in: .whitespaces)
            let value = s[s.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            guard !key.isEmpty else { continue }
            fields[key] = value
        }
        guard let name = fields["name"], !name.isEmpty else { return nil }
        let description = fields["description"] ?? ""
        let tools = (fields["tools"] ?? "")
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        let model = fields["model"]
        return AgentDefinition(
            name: name,
            description: description,
            tools: tools,
            frontmatterModel: model?.isEmpty == true ? nil : model,
            filePath: filePath
        )
    }
}
