import Foundation

/// Opt-out toggles for tools and skills. Missing = enabled.
enum ToolSkillSettings {
    static let disabledToolsKey = "pipiui.disabledTools"
    static let disabledSkillsKey = "pipiui.disabledSkills"

    /// Catalog id for the browser tool group (expands to concrete names for `--exclude-tools`).
    /// The id is kept as `browser_*` so settings saved before the five browser_* tools were
    /// folded into one `browser` tool still resolve.
    static let browserGroupId = "browser_*"

    static let browserToolNames = ["browser"]

    static func settingsFileURL(fileManager: FileManager = .default) -> URL {
        let dir = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PipiUI", isDirectory: true)
        return dir.appendingPathComponent("tool-skill-settings.json")
    }

    static func disabledTools(defaults: UserDefaults = .standard) -> Set<String> {
        Set(defaults.stringArray(forKey: disabledToolsKey) ?? [])
    }

    static func disabledSkills(defaults: UserDefaults = .standard) -> Set<String> {
        Set(defaults.stringArray(forKey: disabledSkillsKey) ?? [])
    }

    static func isToolEnabled(_ name: String, defaults: UserDefaults = .standard) -> Bool {
        !disabledTools(defaults: defaults).contains(name)
    }

    static func isSkillEnabled(_ name: String, defaults: UserDefaults = .standard) -> Bool {
        !disabledSkills(defaults: defaults).contains(name)
    }

    static func setToolEnabled(
        _ enabled: Bool,
        name: String,
        defaults: UserDefaults = .standard,
        fileManager: FileManager = .default
    ) {
        var ids = disabledTools(defaults: defaults)
        if enabled {
            ids.remove(name)
        } else {
            ids.insert(name)
        }
        defaults.set(Array(ids).sorted(), forKey: disabledToolsKey)
        // Only mirror the live app defaults into Application Support (avoid test suites clobbering).
        if defaults === UserDefaults.standard {
            syncJSONFile(defaults: defaults, fileManager: fileManager)
        }
    }

    static func setSkillEnabled(
        _ enabled: Bool,
        name: String,
        defaults: UserDefaults = .standard,
        fileManager: FileManager = .default
    ) {
        var ids = disabledSkills(defaults: defaults)
        if enabled {
            ids.remove(name)
        } else {
            ids.insert(name)
        }
        defaults.set(Array(ids).sorted(), forKey: disabledSkillsKey)
        if defaults === UserDefaults.standard {
            syncJSONFile(defaults: defaults, fileManager: fileManager)
        }
    }

    /// Concrete tool names for pi `--exclude-tools` (expands `browser_*`).
    static func excludeToolNames(defaults: UserDefaults = .standard) -> [String] {
        var names = disabledTools(defaults: defaults)
        if names.contains(browserGroupId) {
            names.remove(browserGroupId)
            names.formUnion(browserToolNames)
        }
        return names.sorted()
    }

    /// CLI args to append when spawning pi (`--exclude-tools a,b`). Empty if none disabled.
    static func excludeToolsCLIArgs(defaults: UserDefaults = .standard) -> [String] {
        let names = excludeToolNames(defaults: defaults)
        guard !names.isEmpty else { return [] }
        return ["--exclude-tools", names.joined(separator: ",")]
    }

    static func syncJSONFile(
        defaults: UserDefaults = .standard,
        fileManager: FileManager = .default
    ) {
        let payload: [String: Any] = [
            "disabledTools": Array(disabledTools(defaults: defaults)).sorted(),
            "disabledSkills": Array(disabledSkills(defaults: defaults)).sorted(),
        ]
        let url = settingsFileURL(fileManager: fileManager)
        let dir = url.deletingLastPathComponent()
        try? fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
        guard let data = try? JSONSerialization.data(
            withJSONObject: payload,
            options: [.prettyPrinted, .sortedKeys]
        ) else {
            return
        }
        try? data.write(to: url, options: .atomic)
    }
}
