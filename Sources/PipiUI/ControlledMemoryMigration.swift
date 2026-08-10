import CryptoKit
import Foundation

/// One-way, resumable transport of the legacy approved Controlled Memory store
/// into the formal TypeScript broker. Swift only preserves bytes, hashes, and
/// migration state; candidate policy and durable ingestion remain in the package.
enum ControlledMemoryMigration {
    static let version = 1
    private static let legacySchemaVersion = 1

    private enum LegacyScope: String, Codable, Sendable {
        case user, project
    }

    /// Read-only decode shape for the retired approved-memory archive. Unknown
    /// historical fields (source dates, processed IDs) are intentionally
    /// ignored; migration needs only the immutable values it transports.
    private struct LegacyEntry: Codable, Sendable {
        let id: String
        let scope: LegacyScope
        let projectPath: String?
        let content: String
    }

    private struct LegacyApprovedEnvelope: Codable, Sendable {
        let version: Int
        let entries: [LegacyEntry]
    }

    enum Phase: String, Codable, Equatable, Sendable {
        case prepared, completed, failed
    }

    struct State: Codable, Equatable, Sendable {
        var version: Int
        var migrationID: String
        var phase: Phase
        var count: Int
        var contentHash: String
        var backupPath: String
        var importPath: String
        var receiptPath: String
        var lastError: String?
    }

    struct LaunchConfiguration: Equatable, Sendable {
        let importPath: String
        let receiptPath: String
    }

    struct Receipt: Codable, Equatable, Sendable {
        var version: Int
        var migrationID: String
        var count: Int
        var contentHash: String
        var success: Bool
        var detail: String?
    }

    static func defaultRoot(fileManager: FileManager = .default) -> URL {
        fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PipiUI/MemoryBroker/migration", isDirectory: true)
    }

    static func legacyRoot(fileManager: FileManager = .default) -> URL {
        fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PipiUI/Memory", isDirectory: true)
    }

    static func stateURL(in root: URL) -> URL { root.appendingPathComponent("state.json") }

    static func loadState(
        root: URL = defaultRoot(),
        fileManager: FileManager = .default
    ) -> State? {
        let url = stateURL(in: root)
        guard fileManager.fileExists(atPath: url.path),
              let data = try? Data(contentsOf: url),
              let state = try? JSONDecoder().decode(State.self, from: data),
              state.version == version else { return nil }
        return state
    }

    /// Builds a versioned import JSONL file and a byte-for-byte legacy backup.
    /// Existing prepared/completed state is reused, making a retry idempotent.
    @discardableResult
    static func prepare(
        legacyRoot: URL = legacyRoot(),
        root: URL = defaultRoot(),
        fileManager: FileManager = .default
    ) throws -> State {
        if var existing = loadState(root: root, fileManager: fileManager) {
            if existing.phase == .prepared || existing.phase == .completed {
                return existing
            }
            if existing.phase == .failed,
               fileManager.fileExists(atPath: existing.backupPath),
               fileManager.fileExists(atPath: existing.importPath) {
                // Retry the exact immutable import, rather than minting a new
                // migration ID that could duplicate a partially completed run.
                existing.phase = .prepared
                existing.lastError = nil
                try writeState(existing, root: root, fileManager: fileManager)
                return existing
            }
        }
        let approvedURL = legacyRoot.appendingPathComponent("approved.json")
        guard fileManager.fileExists(atPath: approvedURL.path) else {
            throw MigrationError.legacyStoreMissing(approvedURL.path)
        }
        let approvedData = try Data(contentsOf: approvedURL)
        let envelope = try decodeApproved(approvedData)
        guard envelope.version == legacySchemaVersion else {
            throw MigrationError.unsupportedLegacyVersion(envelope.version)
        }

        let migrationID = UUID().uuidString.lowercased()
        let entries = envelope.entries.sorted { utf8ByteOrder($0.id, $1.id) }
        let hash = contentHash(entries)
        let backupDirectory = root.appendingPathComponent("legacy-backups", isDirectory: true)
        let importDirectory = root.appendingPathComponent("imports", isDirectory: true)
        try fileManager.createDirectory(at: backupDirectory, withIntermediateDirectories: true)
        try fileManager.createDirectory(at: importDirectory, withIntermediateDirectories: true)
        let backupURL = backupDirectory.appendingPathComponent("approved-\(migrationID).json")
        let importURL = importDirectory.appendingPathComponent("controlled-memory-\(migrationID).jsonl")
        let receiptURL = importDirectory.appendingPathComponent("controlled-memory-\(migrationID).receipt.json")
        try writePrivate(approvedData, to: backupURL, fileManager: fileManager)
        try writePrivate(importData(migrationID: migrationID, entries: entries, contentHash: hash), to: importURL, fileManager: fileManager)
        let state = State(
            version: version,
            migrationID: migrationID,
            phase: .prepared,
            count: entries.count,
            contentHash: hash,
            backupPath: backupURL.path,
            importPath: importURL.path,
            receiptPath: receiptURL.path,
            lastError: nil
        )
        try writeState(state, root: root, fileManager: fileManager)
        return state
    }

    /// Reads only a package-written receipt. A valid success receipt first
    /// disables the legacy backend and only then records completion. If a crash
    /// left an older completed marker while the legacy flag is still true,
    /// reconciliation retries that idempotent disable on every later launch.
    /// No branch deletes `approved.json`.
    @discardableResult
    static func reconcileReceipt(
        legacyRoot: URL = legacyRoot(),
        root: URL = defaultRoot(),
        fileManager: FileManager = .default
    ) -> State? {
        guard var state = loadState(root: root, fileManager: fileManager) else { return nil }

        if state.phase == .completed {
            do {
                try disableLegacyBackend(at: legacyRoot, fileManager: fileManager)
                if state.lastError != nil {
                    state.lastError = nil
                    try? writeState(state, root: root, fileManager: fileManager)
                }
            } catch {
                // Keep the completed marker so an older crash-window marker is
                // still recognized, but retain a retryable diagnostic. The next
                // reconcile attempts the controlled disable again.
                state.lastError = error.localizedDescription
                try? writeState(state, root: root, fileManager: fileManager)
            }
            return state
        }

        guard state.phase == .prepared,
              let data = try? Data(contentsOf: URL(fileURLWithPath: state.receiptPath)),
              let receipt = try? JSONDecoder().decode(Receipt.self, from: data),
              receipt.version == version,
              receipt.migrationID == state.migrationID,
              receipt.count == state.count,
              receipt.contentHash == state.contentHash else {
            return state
        }
        if receipt.success {
            do {
                // Disable first. If state persistence crashes afterwards, the
                // prepared marker plus verified receipt cause a harmless retry.
                try disableLegacyBackend(at: legacyRoot, fileManager: fileManager)
                state.phase = .completed
                state.lastError = nil
                try writeState(state, root: root, fileManager: fileManager)
            } catch {
                // Do not write a terminal failed marker for an otherwise valid
                // success receipt: that would suppress automatic recovery of a
                // transient disable/state-write failure.
                state.phase = .prepared
                state.lastError = error.localizedDescription
                try? writeState(state, root: root, fileManager: fileManager)
            }
        } else {
            state.phase = .failed
            state.lastError = receipt.detail ?? "Memory Broker import failed."
            try? writeState(state, root: root, fileManager: fileManager)
        }
        return state
    }

    static func launchConfiguration(
        root: URL = defaultRoot(),
        fileManager: FileManager = .default
    ) -> LaunchConfiguration? {
        guard let state = loadState(root: root, fileManager: fileManager),
              state.phase == .prepared,
              fileManager.fileExists(atPath: state.importPath),
              fileManager.fileExists(atPath: state.backupPath) else { return nil }
        return LaunchConfiguration(importPath: state.importPath, receiptPath: state.receiptPath)
    }

    enum MigrationError: Error, Equatable, LocalizedError {
        case legacyStoreMissing(String)
        case unsupportedLegacyVersion(Int)

        var errorDescription: String? {
            switch self {
            case .legacyStoreMissing(let path): "Legacy approved memory store is missing: \(path)"
            case .unsupportedLegacyVersion(let version): "Legacy approved memory store version \(version) is unsupported."
            }
        }
    }

    private static func decodeApproved(_ data: Data) throws -> LegacyApprovedEnvelope {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let value = try decoder.singleValueContainer().decode(String.self)
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = fractional.date(from: value) { return date }
            let plain = ISO8601DateFormatter()
            plain.formatOptions = [.withInternetDateTime]
            if let date = plain.date(from: value) { return date }
            throw DecodingError.dataCorruptedError(in: try decoder.singleValueContainer(), debugDescription: "Invalid legacy date")
        }
        return try decoder.decode(LegacyApprovedEnvelope.self, from: data)
    }

    private static func importData(
        migrationID: String,
        entries: [LegacyEntry],
        contentHash: String
    ) throws -> Data {
        let manifest: [String: Any] = [
            "version": version,
            "kind": "pipiui-controlled-memory-import-manifest",
            "migrationID": migrationID,
            "count": entries.count,
            "contentHash": contentHash,
        ]
        var lines = [try jsonLine(manifest)]
        for entry in entries {
            lines.append(try jsonLine([
                "version": version,
                "kind": "pipiui-controlled-memory-import-entry",
                "migrationID": migrationID,
                "id": entry.id,
                "scope": entry.scope.rawValue,
                "projectPath": entry.projectPath ?? NSNull(),
                "content": entry.content,
            ]))
        }
        return Data((lines.joined(separator: "\n") + "\n").utf8)
    }

    private static func contentHash(_ entries: [LegacyEntry]) -> String {
        let payload = entries.map { entry in
            [entry.id, entry.scope.rawValue, entry.projectPath ?? "", entry.content].joined(separator: "\u{1F}")
        }.joined(separator: "\u{1E}")
        return SHA256.hash(data: Data(payload.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private static func jsonLine(_ value: [String: Any]) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes])
        guard let text = String(data: data, encoding: .utf8) else {
            throw CocoaError(.fileWriteInapplicableStringEncoding)
        }
        return text
    }

    private static func writeState(_ state: State, root: URL, fileManager: FileManager) throws {
        try fileManager.createDirectory(at: root, withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(state)
        try writePrivate(data, to: stateURL(in: root), fileManager: fileManager)
    }

    private static func writePrivate(_ data: Data, to url: URL, fileManager: FileManager) throws {
        try fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
        try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    private static func utf8ByteOrder(_ left: String, _ right: String) -> Bool {
        left.utf8.lexicographicallyPrecedes(right.utf8)
    }

    private static func disableLegacyBackend(at legacyRoot: URL, fileManager: FileManager) throws {
        let settings = legacyRoot.appendingPathComponent("settings.json")
        let data = try JSONSerialization.data(withJSONObject: [
            "version": legacySchemaVersion,
            "enabled": false,
        ], options: [.sortedKeys])
        try writePrivate(data, to: settings, fileManager: fileManager)
    }
}
