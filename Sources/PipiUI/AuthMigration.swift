import Foundation

/// AuthMigration — T20: one-time migration of model-provider API keys into
/// `~/.pi/agent/.env`.
///
/// Source:
/// `~/.pi/agent/auth.json` — every `type: "api_key"` entry, with its key name
/// resolved by `ProviderEnvMap.envVar(forProvider:)`. Providers outside the map
/// are skipped (left untouched) and logged. `type: "oauth"` entries are NEVER
/// touched.
///
/// Actions (in order):
/// - Back up `auth.json` → `auth.json.pipiui-bak` (never overwrites an
///   existing backup).
/// - Merge into `.env` via `EnvFileStore` (serial write API). Existing
///   non-empty `.env` keys win — user hand-edits are never overwritten.
/// - Remove migrated `api_key` entries from `auth.json`.
/// - Log a one-line summary (PipiLogger) and record a one-shot notice flag
///   in UserDefaults for the UI to consume (UI clears it after display).
///
/// Idempotency: after a successful run `doneKey` is set in UserDefaults and
/// later launches return immediately. Even without the flag a second run is
/// a no-op because migrated sources are cleaned and `.env` keys win.
///
/// Threading: `migrateIfNeeded` is synchronous and does file I/O — callers
/// MUST invoke it on a background queue (AppStore does). Main thread performs
/// zero I/O.
enum AuthMigration {

    /// UserDefaults bool: migration has completed (idempotency marker).
    static let doneKey = "pipiui.authMigration.v1.done"
    /// UserDefaults string: one-shot human-readable summary for the UI prompt.
    /// The UI reads and then removes this key.
    static let noticeKey = "pipiui.authMigration.v1.notice"

    /// Injectable dependencies (tests point everything at temp locations).
    struct Options {
        var authURL: URL = PiAuthStore.defaultAuthURL()
        var defaults: UserDefaults = .standard
        var envStore: EnvFileStore = EnvFileStore()
        var fileManager: FileManager = .default
    }

    struct Result: Equatable {
        var skippedAlreadyDone = false
        var backupCreated = false
        /// env var names actually written to `.env`.
        var envWritten: [String] = []
        /// env var names NOT written because `.env` already had a value.
        var envPreserved: [String] = []
        /// provider IDs removed from `auth.json`.
        var providersRemoved: [String] = []
        /// `api_key` providers left in `auth.json` (no env-var mapping).
        var providersSkippedUnknown: [String] = []
    }

    /// Run the migration once. Synchronous — call from a background queue.
    @discardableResult
    static func migrateIfNeeded(options: Options = Options()) -> Result {
        var result = Result()
        let defaults = options.defaults
        let fm = options.fileManager

        guard !defaults.bool(forKey: doneKey) else {
            result.skippedAlreadyDone = true
            return result
        }

        let authURL = options.authURL

        // MARK: 1. Backup auth.json (never overwrite an existing backup)
        if fm.fileExists(atPath: authURL.path) {
            let bakURL = authURL.appendingPathExtension("pipiui-bak")
            if !fm.fileExists(atPath: bakURL.path) {
                do {
                    try fm.copyItem(at: authURL, to: bakURL)
                    try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: bakURL.path)
                    result.backupCreated = true
                } catch {
                    log("T20 migration: auth.json backup failed: \(error.localizedDescription)", level: .error)
                }
            }
        }

        // MARK: 2. Collect model-provider key candidates (auth.json)
        var envValues: [String: String] = [:] // envVar -> api key
        var authRoot = readJSONRoot(authURL)
        if let root = authRoot {
            for provider in root.keys.sorted() {
                guard let entry = root[provider] as? [String: Any],
                      (entry["type"] as? String) == "api_key" else { continue }
                guard let envVar = ProviderEnvMap.envVar(forProvider: provider) else {
                    result.providersSkippedUnknown.append(provider)
                    continue
                }
                let key = (entry["key"] as? String)?
                    .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                if !key.isEmpty { envValues[envVar] = key }
                result.providersRemoved.append(provider)
            }
        }

        // MARK: 3. Merge into .env — existing non-empty values win
        let existing = options.envStore.all()
        for envVar in envValues.keys.sorted() {
            if let current = existing[envVar], !current.isEmpty {
                result.envPreserved.append(envVar)
                continue
            }
            do {
                try options.envStore.setSync(envValues[envVar] ?? "", forKey: envVar)
                result.envWritten.append(envVar)
            } catch {
                log("T20 migration: .env write failed for \(envVar): \(error.localizedDescription)", level: .error)
            }
        }

        // MARK: 4. Remove migrated api_key entries from auth.json (oauth untouched)
        if !result.providersRemoved.isEmpty, authRoot != nil {
            for provider in result.providersRemoved { authRoot?.removeValue(forKey: provider) }
            do {
                try writeJSONRoot(authRoot ?? [:], to: authURL, fm: fm)
            } catch {
                log("T20 migration: auth.json rewrite failed: \(error.localizedDescription)", level: .error)
            }
        }

        // MARK: 5. Done marker + one-shot UI notice + log
        defaults.set(true, forKey: doneKey)

        var summary = "T20 API key 迁移：写入 .env \(result.envWritten.count) 项"
        if !result.envWritten.isEmpty { summary += "（\(result.envWritten.joined(separator: ", "))）" }
        if !result.envPreserved.isEmpty {
            summary += "；.env 已有值保留 \(result.envPreserved.count) 项（\(result.envPreserved.joined(separator: ", "))）"
        }
        if !result.providersRemoved.isEmpty {
            summary += "；auth.json 移除 api_key 条目 \(result.providersRemoved.joined(separator: ", "))"
        }
        if result.backupCreated { summary += "；已备份 auth.json.pipiui-bak" }
        if !result.providersSkippedUnknown.isEmpty {
            summary += "；跳过未知 provider（保留在 auth.json）：\(result.providersSkippedUnknown.joined(separator: ", "))"
        }
        defaults.set(summary, forKey: noticeKey)
        log(summary, level: .info)

        return result
    }

    // MARK: - Helpers

    private static func log(_ message: String, level: LogLevel) {
        PipiLogger.shared.log(level, message, category: .storage)
    }

    private static func readJSONRoot(_ url: URL) -> [String: Any]? {
        guard let data = try? Data(contentsOf: url),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return obj
    }

    private static func writeJSONRoot(_ root: [String: Any], to url: URL, fm: FileManager) throws {
        let dir = url.deletingLastPathComponent()
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        let data = try JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: url, options: .atomic)
        try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
}
