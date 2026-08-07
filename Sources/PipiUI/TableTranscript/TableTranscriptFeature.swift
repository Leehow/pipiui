import Foundation

extension Notification.Name {
    /// Posted after the experimental table-transcript debug gate flips at runtime.
    static let pipiuiTableTranscriptFeatureDidChange = Notification.Name(
        "pipiui.tableTranscriptFeatureDidChange"
    )
}

/// Debug gate for the experimental NSTableView transcript renderer (phase-1 POC).
///
/// Default is **off** so the production inverted-ScrollView path is unchanged.
/// Enable with either:
/// - environment: `PIPIUI_TABLE_TRANSCRIPT=1`
/// - UserDefaults: `pipiui.tableTranscript` = true
/// - View menu: "实验性表格 Transcript" (toggles UserDefaults + posts a notification so
///   open chat roots rebuild onto the other path).
enum TableTranscriptFeature {
    static let userDefaultsKey = "pipiui.tableTranscript"
    static let environmentKey = "PIPIUI_TABLE_TRANSCRIPT"

    /// Snapshot taken once per process for cheap checks. Menu toggle updates
    /// UserDefaults and this cache so subsequent view bodies can branch.
    private static let lock = NSLock()
    private static var cached: Bool?

    /// Whether the experimental table transcript should be used.
    static var isEnabled: Bool {
        lock.lock()
        defer { lock.unlock() }
        if let cached { return cached }
        let value = resolveEnabled()
        cached = value
        return value
    }

    /// Force re-read (after menu toggle). Posts a notification so open roots rebuild.
    @discardableResult
    static func setEnabled(_ enabled: Bool) -> Bool {
        UserDefaults.standard.set(enabled, forKey: userDefaultsKey)
        lock.lock()
        cached = enabled
        lock.unlock()
        NotificationCenter.default.post(name: .pipiuiTableTranscriptFeatureDidChange, object: nil)
        return enabled
    }

    /// Drop the process cache so the next read re-resolves env + defaults.
    static func refreshFromStorage() {
        lock.lock()
        cached = resolveEnabled()
        lock.unlock()
    }

    private static func resolveEnabled() -> Bool {
        if let env = ProcessInfo.processInfo.environment[environmentKey]?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased(),
           !env.isEmpty {
            switch env {
            case "1", "true", "yes", "on": return true
            case "0", "false", "no", "off": return false
            default: break
            }
        }
        return UserDefaults.standard.bool(forKey: userDefaultsKey)
    }
}
