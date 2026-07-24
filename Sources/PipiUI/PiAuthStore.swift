import Foundation

/// Read/write Pi credentials at `~/.pi/agent/auth.json` (same file as TUI `/login`/`/logout`).
enum PiAuthStore {
    struct CredentialInfo: Equatable, Identifiable {
        let providerId: String
        let type: String // "api_key" | "oauth" | …
        var id: String { providerId }
    }

    static func defaultAuthURL() -> URL {
        URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
            .appendingPathComponent(".pi/agent/auth.json", isDirectory: false)
    }

    static func list(authURL: URL = defaultAuthURL()) -> [CredentialInfo] {
        guard let root = readRoot(authURL: authURL) else { return [] }
        return root.keys.sorted().compactMap { providerId in
            guard let entry = root[providerId] as? [String: Any] else { return nil }
            let type = (entry["type"] as? String) ?? "unknown"
            return CredentialInfo(providerId: providerId, type: type)
        }
    }

    /// Deletes one provider entry. Aligns with pi `/logout` (env / models.json untouched).
    @discardableResult
    static func delete(providerId: String, authURL: URL = defaultAuthURL()) throws -> Bool {
        var root = readRoot(authURL: authURL) ?? [:]
        guard root[providerId] != nil else { return false }
        root.removeValue(forKey: providerId)
        try writeRoot(root, authURL: authURL)
        return true
    }

    /// Stores an API key credential in the shape pi expects.
    static func setAPIKey(providerId: String, key: String, authURL: URL = defaultAuthURL()) throws {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !providerId.isEmpty, !trimmed.isEmpty else {
            throw StoreError.invalidInput
        }
        var root = readRoot(authURL: authURL) ?? [:]
        root[providerId] = ["type": "api_key", "key": trimmed]
        try writeRoot(root, authURL: authURL)
    }

    enum StoreError: Error, Equatable {
        case invalidInput
        case writeFailed(String)
    }

    // MARK: - JSON helpers

    private static func readRoot(authURL: URL) -> [String: Any]? {
        guard let data = try? Data(contentsOf: authURL),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return obj
    }

    private static func writeRoot(_ root: [String: Any], authURL: URL) throws {
        let dir = authURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let data = try JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys])
        do {
            try data.write(to: authURL, options: .atomic)
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o600],
                ofItemAtPath: authURL.path
            )
        } catch {
            throw StoreError.writeFailed(error.localizedDescription)
        }
    }
}
