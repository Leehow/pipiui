import Foundation

/// Controls which credentialed models appear in the bottom model picker.
/// Opt-out: ids in `hiddenModelIds` are hidden; everything else stays visible.
enum ModelVisibility {
    static let defaultsKey = "pipiui.hiddenModelIds"

    static func hiddenModelIds(defaults: UserDefaults = .standard) -> Set<String> {
        Set(defaults.stringArray(forKey: defaultsKey) ?? [])
    }

    static func setHidden(_ hidden: Bool, modelId: String, defaults: UserDefaults = .standard) {
        var ids = hiddenModelIds(defaults: defaults)
        if hidden {
            ids.insert(modelId)
        } else {
            ids.remove(modelId)
        }
        defaults.set(Array(ids).sorted(), forKey: defaultsKey)
    }

    static func isVisible(_ modelId: String, defaults: UserDefaults = .standard) -> Bool {
        !hiddenModelIds(defaults: defaults).contains(modelId)
    }

    /// Models shown in the bottom picker. Currently selected model stays listed
    /// even if hidden, so the menu label never points at a missing entry.
    static func pickerModels(
        from all: [ModelInfo],
        selectedId: String?,
        defaults: UserDefaults = .standard
    ) -> [ModelInfo] {
        let hidden = hiddenModelIds(defaults: defaults)
        return all.filter { model in
            if let selectedId, model.id == selectedId { return true }
            return !hidden.contains(model.id)
        }
    }

    static func pickerProviders(
        from all: [ModelInfo],
        selectedId: String?,
        defaults: UserDefaults = .standard
    ) -> [String] {
        var seen: Set<String> = []
        var result: [String] = []
        for m in pickerModels(from: all, selectedId: selectedId, defaults: defaults)
        where !seen.contains(m.provider) {
            seen.insert(m.provider)
            result.append(m.provider)
        }
        return result
    }
}
