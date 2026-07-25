import Foundation

/// AuthMigration — T20: one-time migration of API keys into `~/.pi/agent/.env`.
///
/// Sources (legacy, pre-T18/T19 storage):
/// 1. `~/.pi/agent/auth.json` — every `type: "api_key"` entry, key name via
///    `ProviderEnvMap.envVar(forProvider:)`; providers outside the map are
///    skipped (left untouched) and logged. `type: "oauth"` entries are NEVER
///    touched.
/// 2. UserDefaults `pipiui.webSearch.keys` — legacy per-backend search keys,
///    mapped via `ProviderEnvMap.searchEnvVars`.
/// 3. `~/Library/Application Support/PipiUI/websearch-config.json` `keys`
///    field (same mapping; non-sensitive fields like `backend` are kept).
///
/// Actions (in order):
/// - Back up `auth.json` → `auth.json.pipiui-bak` (never overwrites an
///   existing backup).
/// - Merge into `.env` via `EnvFileStore` (serial write API). Existing
///   non-empty `.env` keys win — user hand-edits are never overwritten.
/// - Remove migrated `api_key` entries from `auth.json`.
/// - Clear UserDefaults `pipiui.webSearch.keys` and the JSON `keys` field.
/// - Log a one-line summary (PipiLogger) and record a one-shot notice flag
///   in UserDefaults for the UI to consume (UI clears it after display).
///
/// Idempotency: after a successful run `doneKey` is set in UserDefaults and
/// later launches return immediately. Even without the flag a second run is
/// a no-op because all sources have been cleaned and `.env` keys win.
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
    /// Legacy UserDefaults key for per-backend search keys (pre-T19).
    static let legacyWebSearchKeysKey = "pipiui.webSearch.keys"

    /// Injectable dependencies (tests point everything at temp locations).
    struct Options {
        var authURL: URL = PiAuthStore.defaultAuthURL()
        var webSearchConfigURL: URL = WebSearchSettings.configFileURL()
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
        var clearedUserDefaultsKeys = false
        var clearedJSONKeys = false
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
        let configURL = options.webSearchConfigURL

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

        // MARK: 2. Collect key candidates (auth.json → UserDefaults → JSON; first non-empty wins)
        var envValues: [String: String] = [:] // envVar -> api key
        var unmappedBackends: [String] = []

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

        let legacyDict = defaults.dictionary(forKey: legacyWebSearchKeysKey)
        if let legacyDict {
            for (backend, raw) in legacyDict {
                guard let key = (raw as? String)?
                    .trimmingCharacters(in: .whitespacesAndNewlines), !key.isEmpty else { continue }
                guard let envVar = ProviderEnvMap.searchEnvVars[backend] else {
                    unmappedBackends.append(backend)
                    continue
                }
                if envValues[envVar] == nil { envValues[envVar] = key }
            }
        }

        var configRoot = readJSONRoot(configURL)
        if let keys = configRoot?["keys"] as? [String: Any] {
            for (backend, raw) in keys {
                guard let key = (raw as? String)?
                    .trimmingCharacters(in: .whitespacesAndNewlines), !key.isEmpty else { continue }
                guard let envVar = ProviderEnvMap.searchEnvVars[backend] else {
                    if !unmappedBackends.contains(backend) { unmappedBackends.append(backend) }
                    continue
                }
                if envValues[envVar] == nil { envValues[envVar] = key }
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

        // MARK: 5. Clear legacy search-key stores (keep backend & friends)
        if defaults.object(forKey: legacyWebSearchKeysKey) != nil {
            defaults.removeObject(forKey: legacyWebSearchKeysKey)
            result.clearedUserDefaultsKeys = true
        }
        if configRoot?["keys"] != nil {
            configRoot?.removeValue(forKey: "keys")
            do {
                try writeJSONRoot(configRoot ?? [:], to: configURL, fm: fm)
                result.clearedJSONKeys = true
            } catch {
                log("T20 migration: websearch-config.json rewrite failed: \(error.localizedDescription)", level: .error)
            }
        }

        // MARK: 6. Done marker + one-shot UI notice + log
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
        if result.clearedUserDefaultsKeys { summary += "；已清 UserDefaults 搜索 key" }
        if result.clearedJSONKeys { summary += "；已清 websearch-config.json keys" }
        if !result.providersSkippedUnknown.isEmpty {
            summary += "；跳过未知 provider（保留在 auth.json）：\(result.providersSkippedUnknown.joined(separator: ", "))"
        }
        if !unmappedBackends.isEmpty {
            summary += "；跳过无 .env 映射的搜索后端：\(unmappedBackends.joined(separator: ", "))"
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
