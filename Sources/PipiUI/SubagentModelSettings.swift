import Foundation

/// Per-subagent-type model overrides. Missing / empty = follow the main chat agent model
/// (composer / bottom-bar selection for the current session).
enum SubagentModelSettings {
    static let defaultsKey = "pipiui.subagentModels"
    /// Sentinel stored value is never used; absence or "" means follow.
    static let followMainSentinel = ""
    /// Picker sentinel: omit `--thinking` and let Pi/the selected model choose its default.
    static let defaultThinkingSentinel = ""

    /// An explicit per-agent override. Legacy persisted values are strings containing just
    /// `model`; newer values can add `thinking`. Keeping the two fields separate avoids
    /// treating Pi's optional `model:thinking` shorthand as part of a model id.
    struct Override: Equatable {
        let model: String
        let thinking: String?
    }

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


    static func allSettings(defaults: UserDefaults = .standard) -> [String: Override] {
        // UserDefaults returns [String: Any] with NSString/nested NSDictionary values — do not
        // cast the complete dictionary. String entries are the pre-thinking-level format.
        guard let raw = defaults.dictionary(forKey: defaultsKey) else { return [:] }
        var result: [String: Override] = [:]
        for (key, value) in raw {
            if let s = value as? String {
                let model = s.trimmingCharacters(in: .whitespacesAndNewlines)
                if !model.isEmpty { result[key] = Override(model: model, thinking: nil) }
            } else if let s = value as? NSString {
                let model = (s as String).trimmingCharacters(in: .whitespacesAndNewlines)
                if !model.isEmpty { result[key] = Override(model: model, thinking: nil) }
            } else if let dict = value as? [String: Any],
                      let rawModel = dict["model"] as? String {
                let model = rawModel.trimmingCharacters(in: .whitespacesAndNewlines)
                let thinking = (dict["thinking"] as? String)?
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                if !model.isEmpty {
                    result[key] = Override(model: model, thinking: thinking?.isEmpty == false ? thinking : nil)
                }
            }
        }
        return result
    }

    /// Model-only compatibility surface for existing callers.
    static func allOverrides(defaults: UserDefaults = .standard) -> [String: String] {
        var result = allSettings(defaults: defaults).mapValues(\.model)
        // Preserve an old explicit empty-string sentinel for diagnostics/serialization even
        // though `allSettings` correctly treats it as follow-main rather than an override.
        if let raw = defaults.dictionary(forKey: defaultsKey) {
            for (key, value) in raw {
                if let string = value as? String, string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    result[key] = string
                } else if let string = value as? NSString,
                          (string as String).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    result[key] = string as String
                }
            }
        }
        return result
    }

    /// `nil` means follow main agent.
    static func modelOverride(for agentName: String, defaults: UserDefaults = .standard) -> String? {
        allSettings(defaults: defaults)[agentName]?.model
    }

    /// `nil` means use Pi/model default; it is never inherited from the main agent.
    static func thinkingOverride(for agentName: String, defaults: UserDefaults = .standard) -> String? {
        allSettings(defaults: defaults)[agentName]?.thinking
    }

    static func setModelOverride(
        _ modelId: String?,
        for agentName: String,
        defaults: UserDefaults = .standard,
        fileManager: FileManager = .default
    ) {
        setOverride(
            modelId,
            thinking: thinkingOverride(for: agentName, defaults: defaults),
            for: agentName,
            defaults: defaults,
            fileManager: fileManager
        )
    }

    static func setOverride(
        _ modelId: String?,
        thinking: String?,
        for agentName: String,
        defaults: UserDefaults = .standard,
        fileManager: FileManager = .default,
        to url: URL? = nil
    ) {
        var map = allSettings(defaults: defaults)
        let trimmed = modelId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if trimmed.isEmpty {
            map.removeValue(forKey: agentName)
        } else {
            let normalizedThinking = thinking?.trimmingCharacters(in: .whitespacesAndNewlines)
            map[agentName] = Override(
                model: trimmed,
                thinking: normalizedThinking?.isEmpty == false ? normalizedThinking : nil
            )
        }
        defaults.set(encodeForDefaults(map), forKey: defaultsKey)
        syncJSONFile(map: map, fileManager: fileManager, to: url)
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
        map: [String: Override]? = nil,
        defaults: UserDefaults = .standard,
        fileManager: FileManager = .default,
        to url: URL? = nil
    ) {
        let payload = map.map(encodeForDefaults) ?? serializedPayload(defaults: defaults)
        let target = url ?? overridesFileURL(fileManager: fileManager)
        let dir = target.deletingLastPathComponent()
        try? fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys]) else {
            return
        }
        try? data.write(to: target, options: .atomic)
    }

    /// Encode overrides for tests / diagnostics.
    static func jsonString(defaults: UserDefaults = .standard) -> String {
        let map = serializedPayload(defaults: defaults)
        guard let data = try? JSONSerialization.data(withJSONObject: map, options: [.sortedKeys]),
              let s = String(data: data, encoding: .utf8) else {
            return "{}"
        }
        return s
    }

    /// Write no-thinking entries as legacy strings so older extensions remain able to read
    /// them. Only an explicitly selected strength upgrades that agent's JSON value to an object.
    private static func encodeForDefaults(_ settings: [String: Override]) -> [String: Any] {
        var encoded: [String: Any] = [:]
        for (agentName, setting) in settings {
            if let thinking = setting.thinking, !thinking.isEmpty {
                encoded[agentName] = ["model": setting.model, "thinking": thinking]
            } else {
                encoded[agentName] = setting.model
            }
        }
        return encoded
    }

    private static func serializedPayload(defaults: UserDefaults) -> [String: Any] {
        var payload = encodeForDefaults(allSettings(defaults: defaults))
        // A prior release could persist `"agent": ""`; retain it on app-launch sync so a
        // legacy preference file is not needlessly rewritten, while runtime still follows main.
        if let raw = defaults.dictionary(forKey: defaultsKey) {
            for (agentName, value) in raw {
                if let string = value as? String, string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    payload[agentName] = string
                } else if let string = value as? NSString,
                          (string as String).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    payload[agentName] = string as String
                }
            }
        }
        return payload
    }
}
