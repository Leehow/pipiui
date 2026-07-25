import Foundation

/// Per-model capability tier. Drives how hard the session leans on the Superpowers
/// skill library: strong models get a pointer, weak models get the mandatory SOP.
///
/// Opt-in denylist by design — ids in `weakModelIds` are weak, everything else is
/// strong. No built-in model list: any hardcoded strong/weak table goes stale the
/// week a new model ships, and misclassifying a model silently changes how the whole
/// session is run. The user marks their own weak models in Settings → 模型.
enum ModelTierSettings {
    static let defaultsKey = "pipiui.weakModelIds"

    /// Application Support JSON hot-read by the Node skill-tier extension.
    static func tiersFileURL(fileManager: FileManager = .default) -> URL {
        let dir = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PipiUI", isDirectory: true)
        return dir.appendingPathComponent("model-tiers.json")
    }

    static func weakModelIds(defaults: UserDefaults = .standard) -> Set<String> {
        Set(defaults.stringArray(forKey: defaultsKey) ?? [])
    }

    /// Absent id ⇒ strong. `modelId` is the `provider/id` form used by `ModelInfo.id`.
    static func isWeak(_ modelId: String?, defaults: UserDefaults = .standard) -> Bool {
        guard let modelId, !modelId.isEmpty else { return false }
        return weakModelIds(defaults: defaults).contains(modelId)
    }

    static func setWeak(
        _ weak: Bool,
        modelId: String,
        defaults: UserDefaults = .standard,
        fileManager: FileManager = .default
    ) {
        var ids = weakModelIds(defaults: defaults)
        if weak {
            ids.insert(modelId)
        } else {
            ids.remove(modelId)
        }
        defaults.set(Array(ids).sorted(), forKey: defaultsKey)
        // Only mirror the live app defaults to disk (test suites must not clobber it).
        if defaults === UserDefaults.standard {
            syncJSONFile(defaults: defaults, fileManager: fileManager)
        }
    }

    /// Mirror to Application Support so the extension can hot-read without a session restart.
    @discardableResult
    static func syncJSONFile(
        defaults: UserDefaults = .standard,
        fileManager: FileManager = .default,
        to url: URL? = nil
    ) -> Bool {
        let target = url ?? tiersFileURL(fileManager: fileManager)
        let payload: [String: Any] = ["weakModels": weakModelIds(defaults: defaults).sorted()]
        guard let data = try? JSONSerialization.data(
            withJSONObject: payload,
            options: [.prettyPrinted, .sortedKeys]
        ) else {
            return false
        }
        try? fileManager.createDirectory(
            at: target.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        return (try? data.write(to: target, options: .atomic)) != nil
    }
}
