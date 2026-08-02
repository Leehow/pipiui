import Foundation

enum ControlledMemoryScope: String, Codable, CaseIterable, Sendable {
    case user
    case project
}

enum ControlledMemoryOperation: String, Codable, CaseIterable, Sendable {
    case add
    case replace
    case remove
}

struct ControlledMemorySource: Codable, Equatable, Sendable {
    var sessionID: String
    var projectPath: String
    var proposedAt: Date
    var toolCallID: String?
}

struct ControlledMemoryEntry: Codable, Equatable, Identifiable, Sendable {
    var id: String
    var scope: ControlledMemoryScope
    var projectPath: String?
    var content: String
    var source: ControlledMemorySource
    var createdAt: Date
    var updatedAt: Date
}

struct ControlledMemoryProposal: Codable, Equatable, Identifiable, Sendable {
    static let schemaVersion = 1

    var version: Int
    var id: String
    var operation: ControlledMemoryOperation
    var scope: ControlledMemoryScope
    var projectPath: String?
    var content: String?
    var targetID: String?
    var reason: String?
    var source: ControlledMemorySource
}

struct ControlledMemoryDiff: Equatable, Sendable {
    var before: String?
    var after: String?
}

enum ControlledMemoryError: LocalizedError, Equatable {
    case unsupportedVersion(Int)
    case malformed(String)
    case targetMissing
    case capExceeded(used: Int, limit: Int)

    var errorDescription: String? {
        switch self {
        case .unsupportedVersion(let version): return "不支持的记忆格式版本：\(version)"
        case .malformed(let message): return message
        case .targetMissing: return "要修改的记忆已不存在，请刷新后重试。"
        case .capExceeded(let used, let limit): return "批准后将使用 \(used) 字节，超过 \(limit) 字节上限。"
        }
    }
}

/// Local, user-approved memory. Pending proposal files are written by the Pi
/// extension; this store is the sole approved-store mutation boundary.
@MainActor
final class ControlledMemoryStore: ObservableObject {
    static let shared = ControlledMemoryStore()
    nonisolated static let schemaVersion = 1
    nonisolated static let userByteLimit = 2 * 1024
    nonisolated static let projectByteLimit = 4 * 1024
    nonisolated static let processedProposalLimit = 512
    nonisolated static let pendingProposalLimit = 100
    nonisolated static let reasonByteLimit = 1_024

    /// Spawn-time gate usable from AppStore's nonisolated construction path.
    /// Missing, unreadable, or future-version settings always fail closed.
    nonisolated static func isEnabledOnDisk(fileManager: FileManager = .default) -> Bool {
        let url = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PipiUI/Memory/settings.json")
        guard let data = try? Data(contentsOf: url),
              let value = try? JSONDecoder().decode(SettingsEnvelope.self, from: data) else {
            return false
        }
        return value.version == schemaVersion && value.enabled
    }

    struct SettingsEnvelope: Codable, Equatable, Sendable {
        var version: Int
        var enabled: Bool
    }

    struct ApprovedEnvelope: Codable, Equatable, Sendable {
        var version: Int
        var entries: [ControlledMemoryEntry]
        var processedProposalIDs: [String]

        init(version: Int, entries: [ControlledMemoryEntry], processedProposalIDs: [String] = []) {
            self.version = version
            self.entries = entries
            self.processedProposalIDs = processedProposalIDs
        }

        private enum CodingKeys: String, CodingKey {
            case version, entries, processedProposalIDs
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            version = try container.decode(Int.self, forKey: .version)
            entries = try container.decode([ControlledMemoryEntry].self, forKey: .entries)
            processedProposalIDs = try container.decodeIfPresent(
                [String].self,
                forKey: .processedProposalIDs
            ) ?? []
        }
    }

    @Published private(set) var isEnabled = false
    @Published private(set) var entries: [ControlledMemoryEntry] = []
    @Published private(set) var proposals: [ControlledMemoryProposal] = []
    @Published private(set) var lastError: String?

    let rootURL: URL
    private let fileManager: FileManager
    private var settingsURL: URL { rootURL.appendingPathComponent("settings.json") }
    private var approvedURL: URL { rootURL.appendingPathComponent("approved.json") }
    private var pendingURL: URL { rootURL.appendingPathComponent("pending", isDirectory: true) }
    var snapshotsURL: URL { rootURL.appendingPathComponent("snapshots", isDirectory: true) }

    init(rootURL: URL? = nil, fileManager: FileManager = .default) {
        self.fileManager = fileManager
        self.rootURL = rootURL ?? fileManager.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0].appendingPathComponent("PipiUI/Memory", isDirectory: true)
        refresh()
    }

    func refresh() {
        do {
            try repairStoragePermissions()
            isEnabled = try loadSettings().enabled
            entries = try loadApproved().entries
            proposals = try loadProposals()
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    func setEnabled(_ enabled: Bool) throws {
        try write(SettingsEnvelope(version: Self.schemaVersion, enabled: enabled), to: settingsURL)
        isEnabled = enabled
    }

    func usage(scope: ControlledMemoryScope, projectPath: String? = nil) -> (used: Int, limit: Int) {
        let normalized = projectPath.map(Self.normalizedProjectPath)
        let selected = entries.filter { entry in
            guard entry.scope == scope else { return false }
            return scope == .user || entry.projectPath.map(Self.normalizedProjectPath) == normalized
        }
        return (
            selected.reduce(0) { $0 + $1.content.utf8.count },
            scope == .user ? Self.userByteLimit : Self.projectByteLimit
        )
    }

    func diff(for proposal: ControlledMemoryProposal) throws -> ControlledMemoryDiff {
        switch proposal.operation {
        case .add:
            return ControlledMemoryDiff(before: nil, after: proposal.content)
        case .replace:
            guard let target = entries.first(where: { $0.id == proposal.targetID }) else {
                throw ControlledMemoryError.targetMissing
            }
            return ControlledMemoryDiff(before: target.content, after: proposal.content)
        case .remove:
            guard let target = entries.first(where: { $0.id == proposal.targetID }) else {
                throw ControlledMemoryError.targetMissing
            }
            return ControlledMemoryDiff(before: target.content, after: nil)
        }
    }

    /// The only approved-store mutation path. It re-reads disk immediately
    /// before projection so stale UI cannot overwrite a concurrent approval.
    func approve(_ proposal: ControlledMemoryProposal) throws {
        var approved = try loadApproved()
        if approved.processedProposalIDs.contains(proposal.id) {
            // Crash-safe retry: mutation + processed ID were committed together.
            // A leftover pending file is cleanup only and must never re-project.
            try removeProposalFile(id: proposal.id)
            entries = approved.entries
            proposals.removeAll { $0.id == proposal.id }
            return
        }
        guard try loadProposal(id: proposal.id) == proposal else {
            throw ControlledMemoryError.malformed("提案已变化或已不存在，请刷新后重试。")
        }
        let now = Date()
        let normalizedProject = proposal.scope == .project
            ? Self.normalizedProjectPath(proposal.source.projectPath) : nil

        switch proposal.operation {
        case .add:
            guard let content = Self.validContent(proposal.content) else {
                throw ControlledMemoryError.malformed("新增记忆不能为空。")
            }
            approved.entries.append(ControlledMemoryEntry(
                id: UUID().uuidString.lowercased(),
                scope: proposal.scope,
                projectPath: normalizedProject,
                content: content,
                source: proposal.source,
                createdAt: now,
                updatedAt: now
            ))
        case .replace:
            guard let index = approved.entries.firstIndex(where: { $0.id == proposal.targetID }) else {
                throw ControlledMemoryError.targetMissing
            }
            try Self.verifyTarget(approved.entries[index], matches: proposal, projectPath: normalizedProject)
            guard let content = Self.validContent(proposal.content) else {
                throw ControlledMemoryError.malformed("替换后的记忆不能为空。")
            }
            approved.entries[index].content = content
            approved.entries[index].source = proposal.source
            approved.entries[index].updatedAt = now
        case .remove:
            guard let index = approved.entries.firstIndex(where: { $0.id == proposal.targetID }) else {
                throw ControlledMemoryError.targetMissing
            }
            try Self.verifyTarget(approved.entries[index], matches: proposal, projectPath: normalizedProject)
            approved.entries.remove(at: index)
        }

        try Self.validateCaps(approved.entries)
        approved.processedProposalIDs.append(proposal.id)
        if approved.processedProposalIDs.count > Self.processedProposalLimit {
            approved.processedProposalIDs.removeFirst(
                approved.processedProposalIDs.count - Self.processedProposalLimit
            )
        }
        try write(approved, to: approvedURL)
        try removeProposalFile(id: proposal.id)
        entries = approved.entries
        proposals.removeAll { $0.id == proposal.id }
    }

    func reject(_ proposal: ControlledMemoryProposal) throws {
        try removeProposalFile(id: proposal.id)
        proposals.removeAll { $0.id == proposal.id }
    }

    func repairStoragePermissions() throws {
        try ensureDirectory(rootURL)
        try ensureDirectory(pendingURL)
        try ensureDirectory(snapshotsURL)
        for file in [settingsURL, approvedURL] where fileManager.fileExists(atPath: file.path) {
            try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        }
        for directory in [pendingURL, snapshotsURL] {
            if let files = try? fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
                for file in files where file.pathExtension == "json" {
                    try? fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
                }
            }
        }
    }

    private func loadSettings() throws -> SettingsEnvelope {
        guard fileManager.fileExists(atPath: settingsURL.path) else {
            let initial = SettingsEnvelope(version: Self.schemaVersion, enabled: false)
            try write(initial, to: settingsURL)
            return initial
        }
        let value: SettingsEnvelope = try decode(settingsURL)
        guard value.version == Self.schemaVersion else {
            throw ControlledMemoryError.unsupportedVersion(value.version)
        }
        return value
    }

    private func loadApproved() throws -> ApprovedEnvelope {
        guard fileManager.fileExists(atPath: approvedURL.path) else {
            let initial = ApprovedEnvelope(version: Self.schemaVersion, entries: [], processedProposalIDs: [])
            try write(initial, to: approvedURL)
            return initial
        }
        let value: ApprovedEnvelope = try decode(approvedURL)
        guard value.version == Self.schemaVersion else {
            throw ControlledMemoryError.unsupportedVersion(value.version)
        }
        return value
    }

    private func loadProposals() throws -> [ControlledMemoryProposal] {
        let urls = try fileManager.contentsOfDirectory(
            at: pendingURL,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ).filter { $0.pathExtension == "json" }
        return urls.prefix(Self.pendingProposalLimit).compactMap { url in
            guard let proposal: ControlledMemoryProposal = try? decode(url),
                  proposal.version == ControlledMemoryProposal.schemaVersion,
                  proposal.id == url.deletingPathExtension().lastPathComponent,
                  Self.safeID(proposal.id),
                  !proposal.source.sessionID.isEmpty,
                  !proposal.source.projectPath.isEmpty,
                  Self.proposalIsBounded(proposal) else { return nil }
            return proposal
        }.sorted { $0.source.proposedAt > $1.source.proposedAt }
    }

    private func removeProposalFile(id: String) throws {
        guard Self.safeID(id) else { throw ControlledMemoryError.malformed("提案 ID 非法。") }
        let url = pendingURL.appendingPathComponent(id).appendingPathExtension("json")
        if fileManager.fileExists(atPath: url.path) { try fileManager.removeItem(at: url) }
    }

    private func loadProposal(id: String) throws -> ControlledMemoryProposal? {
        guard Self.safeID(id) else { throw ControlledMemoryError.malformed("提案 ID 非法。") }
        let url = pendingURL.appendingPathComponent(id).appendingPathExtension("json")
        guard fileManager.fileExists(atPath: url.path) else { return nil }
        let proposal: ControlledMemoryProposal = try decode(url)
        guard proposal.version == ControlledMemoryProposal.schemaVersion,
              proposal.id == id,
              Self.proposalIsBounded(proposal) else {
            throw ControlledMemoryError.malformed("提案格式无效。")
        }
        return proposal
    }

    private func ensureDirectory(_ url: URL) throws {
        try fileManager.createDirectory(
            at: url,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try fileManager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: url.path)
    }

    private func write<T: Encodable>(_ value: T, to url: URL) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            try container.encode(formatter.string(from: date))
        }
        let data = try encoder.encode(value)
        try data.write(to: url, options: .atomic)
        try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    private func decode<T: Decodable>(_ url: URL) throws -> T {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let value = try decoder.singleValueContainer().decode(String.self)
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = fractional.date(from: value) { return date }
            let plain = ISO8601DateFormatter()
            plain.formatOptions = [.withInternetDateTime]
            if let date = plain.date(from: value) { return date }
            throw DecodingError.dataCorruptedError(
                in: try decoder.singleValueContainer(),
                debugDescription: "Invalid ISO-8601 timestamp"
            )
        }
        return try decoder.decode(T.self, from: Data(contentsOf: url))
    }

    private static func validContent(_ content: String?) -> String? {
        guard let value = content?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
            return nil
        }
        return value
    }

    private static func verifyTarget(
        _ entry: ControlledMemoryEntry,
        matches proposal: ControlledMemoryProposal,
        projectPath: String?
    ) throws {
        guard entry.scope == proposal.scope,
              entry.scope == .user || entry.projectPath.map(normalizedProjectPath) == projectPath else {
            throw ControlledMemoryError.malformed("提案作用域与目标记忆不一致。")
        }
    }

    nonisolated static func validateCaps(_ entries: [ControlledMemoryEntry]) throws {
        let userBytes = entries.filter { $0.scope == .user }
            .reduce(0) { $0 + $1.content.utf8.count }
        if userBytes > userByteLimit {
            throw ControlledMemoryError.capExceeded(used: userBytes, limit: userByteLimit)
        }
        let groups = Dictionary(grouping: entries.filter { $0.scope == .project }) {
            normalizedProjectPath($0.projectPath ?? "")
        }
        for group in groups.values {
            let bytes = group.reduce(0) { $0 + $1.content.utf8.count }
            if bytes > projectByteLimit {
                throw ControlledMemoryError.capExceeded(used: bytes, limit: projectByteLimit)
            }
        }
    }

    nonisolated static func normalizedProjectPath(_ path: String) -> String {
        URL(fileURLWithPath: path).standardizedFileURL.path
    }

    private static func safeID(_ id: String) -> Bool {
        !id.isEmpty && id.count <= 100
            && id.unicodeScalars.allSatisfy {
                CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_"
            }
    }

    nonisolated private static func proposalIsBounded(_ proposal: ControlledMemoryProposal) -> Bool {
        let contentLimit = proposal.scope == .user ? userByteLimit : projectByteLimit
        return (proposal.content?.utf8.count ?? 0) <= contentLimit
            && (proposal.reason?.utf8.count ?? 0) <= reasonByteLimit
    }
}

/// Pure policy used by tests and mirrored by the generated extension: once a
/// session has a snapshot, later approved-store edits cannot replace it.
enum ControlledMemorySnapshotPolicy {
    static func frozen<T>(existing: T?, approvedNow: @autoclosure () -> T) -> T {
        existing ?? approvedNow()
    }
}
