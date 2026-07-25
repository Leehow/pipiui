import Foundation

/// Per-subagent-type model overrides. Missing / empty = follow the main chat agent model
/// (composer / bottom-bar selection for the current session).
enum SubagentModelSettings {
    static let defaultsKey = "pipiui.subagentModels"
    /// Sentinel stored value is never used; absence or "" means follow.
    static let followMainSentinel = ""

    /// Application Support JSON consumed by the Node subagent extension at spawn time.
    static func overridesFileURL(
        fileManager: FileManager = .default
    ) -> URL {
        let dir = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PipiUI", isDirectory: true)
        return dir.appendingPathComponent("subagent-models.json")
    }

    /// Hot-read file for the composer/bottom-bar model (`provider/id`).
    /// Written whenever the session model changes so「跟随主 Agent」tracks the UI picker
    /// even when `PIPIUI_MAIN_MODEL` was empty at process spawn.
    static func mainModelFileURL(fileManager: FileManager = .default) -> URL {
        let dir = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PipiUI", isDirectory: true)
        return dir.appendingPathComponent("main-model.txt")
    }

    /// Process-level memory of the last value written per target path.
    /// `ChatSession.applyState` calls `writeMainModel` every turn; skip the atomic
    /// write entirely when the value has not changed.
    private static let writeCacheLock = NSLock()
    private static var lastWrittenMainModel: [String: String] = [:]

    static func writeMainModel(
        _ modelId: String?,
        fileManager: FileManager = .default,
        to url: URL? = nil
    ) {
        let target = url ?? mainModelFileURL(fileManager: fileManager)
        let trimmed = modelId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        writeCacheLock.lock()
        if lastWrittenMainModel[target.path] == trimmed {
            writeCacheLock.unlock()
            return
        }
        lastWrittenMainModel[target.path] = trimmed
        writeCacheLock.unlock()
        let dir = target.deletingLastPathComponent()
        try? fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
        if trimmed.isEmpty {
            try? fileManager.removeItem(at: target)
        } else {
            try? trimmed.write(to: target, atomically: true, encoding: .utf8)
        }
    }

    static func readMainModel(fileManager: FileManager = .default, from url: URL? = nil) -> String? {
        let target = url ?? mainModelFileURL(fileManager: fileManager)
        guard let s = try? String(contentsOf: target, encoding: .utf8) else { return nil }
        let trimmed = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }


    static func allOverrides(defaults: UserDefaults = .standard) -> [String: String] {
        // UserDefaults returns [String: Any] with NSString values — do not cast to [String: String].
        guard let raw = defaults.dictionary(forKey: defaultsKey) else { return [:] }
        var result: [String: String] = [:]
        for (key, value) in raw {
            if let s = value as? String {
                result[key] = s
            } else if let s = value as? NSString {
                result[key] = s as String
            }
        }
        return result
    }

    /// `nil` means follow main agent.
    static func modelOverride(for agentName: String, defaults: UserDefaults = .standard) -> String? {
        let raw = allOverrides(defaults: defaults)[agentName] ?? ""
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    static func setModelOverride(
        _ modelId: String?,
        for agentName: String,
        defaults: UserDefaults = .standard,
        fileManager: FileManager = .default
    ) {
        var map = allOverrides(defaults: defaults)
        let trimmed = modelId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if trimmed.isEmpty {
            map.removeValue(forKey: agentName)
        } else {
            map[agentName] = trimmed
        }
        defaults.set(map, forKey: defaultsKey)
        syncJSONFile(map: map, fileManager: fileManager)
    }

    /// Resolve the model id that should be used for `agentName`.
    /// - Parameters:
    ///   - mainModelId: current session model (`provider/modelId`), used when following.
    ///   - frontmatterFallback: `model` from agent.md when main is also unknown.
    static func resolveModel(
        for agentName: String,
        mainModelId: String?,
        frontmatterFallback: String?,
        defaults: UserDefaults = .standard
    ) -> String? {
        if let explicit = modelOverride(for: agentName, defaults: defaults) {
            return explicit
        }
        let main = mainModelId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !main.isEmpty { return main }
        let fb = frontmatterFallback?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return fb.isEmpty ? nil : fb
    }

    /// Ensure the hot-read JSON matches UserDefaults (call on launch / after edits).
    static func syncJSONFile(
        map: [String: String]? = nil,
        defaults: UserDefaults = .standard,
        fileManager: FileManager = .default
    ) {
        let payload = map ?? allOverrides(defaults: defaults)
        let url = overridesFileURL(fileManager: fileManager)
        let dir = url.deletingLastPathComponent()
        try? fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys]) else {
            return
        }
        try? data.write(to: url, options: .atomic)
    }

    /// Encode overrides for tests / diagnostics.
    static func jsonString(defaults: UserDefaults = .standard) -> String {
        let map = allOverrides(defaults: defaults)
        guard let data = try? JSONSerialization.data(withJSONObject: map, options: [.sortedKeys]),
              let s = String(data: data, encoding: .utf8) else {
            return "{}"
        }
        return s
    }
}
