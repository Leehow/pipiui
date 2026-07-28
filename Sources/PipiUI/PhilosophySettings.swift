import Foundation

/// Reads and writes the philosophy's config and layer catalog.
///
/// Both live in pi-land rather than in this App's container, because the extension that
/// consumes them runs in every pi process — including a terminal session this App never
/// launched. The Settings panel here is a GUI over `~/.pi/agent/philosophy.json`; `/philosophy`
/// in a TUI edits the same file.
enum PhilosophySettings {
    static var configURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".pi/agent/philosophy.json")
    }

    static var userLayersURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".pi/agent/philosophy-user")
    }

    private static let migrationKey = "pipiui.philosophyMigratedFromBossMode"
    private static let legacyBossModeKey = "pipiui.bossMode"

    struct Layer: Identifiable, Equatable {
        let id: String
        let name: String
        let summary: String
        let order: Int
        let requires: [String]
        let isUserProvided: Bool
        /// Same rough estimate as the rest of the app (`chars / 4`); only shown to a human.
        let estimatedTokens: Int
        /// Prompt text, frontmatter stripped. What actually reaches the model.
        let body: String
    }

    // MARK: - Catalog

    static var installedLayersURL: URL {
        PhilosophyPackage.installedURL.appendingPathComponent("layers")
    }

    /// Bundled layers, with any same-id file in the user directory shadowing one.
    static func layers(
        layersURL: URL = installedLayersURL,
        userURL: URL? = userLayersURL,
        fileManager: FileManager = .default
    ) -> [Layer] {
        var byID: [String: Layer] = [:]
        for (dir, isUser) in [(layersURL, false)] + (userURL.map { [($0, true)] } ?? []) {
            guard let names = try? fileManager.contentsOfDirectory(atPath: dir.path) else { continue }
            for name in names.sorted() where name.hasSuffix(".md") {
                guard let text = try? String(contentsOf: dir.appendingPathComponent(name), encoding: .utf8),
                      let layer = parseLayer(text, isUserProvided: isUser)
                else { continue }
                byID[layer.id] = layer
            }
        }
        return byID.values.sorted { ($0.order, $0.id) < ($1.order, $1.id) }
    }

    static func parseLayer(_ text: String, isUserProvided: Bool) -> Layer? {
        let lines = text.components(separatedBy: .newlines)
        guard lines.first?.trimmingCharacters(in: .whitespaces) == "---",
              let closing = lines.dropFirst().firstIndex(where: {
                  $0.trimmingCharacters(in: .whitespaces) == "---"
              })
        else { return nil }

        var fields: [String: String] = [:]
        for line in lines[1..<closing] {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let key = String(line[line.startIndex..<colon]).trimmingCharacters(in: .whitespaces)
            let value = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
            if !key.isEmpty { fields[key] = value }
        }
        guard let id = fields["id"], !id.isEmpty,
              let name = fields["name"], !name.isEmpty,
              let order = fields["order"].flatMap({ Int($0) })
        else { return nil }

        let body = lines[lines.index(after: closing)...]
            .joined(separator: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return Layer(
            id: id,
            name: name,
            summary: fields["summary"] ?? "",
            order: order,
            requires: parseInlineList(fields["requires"] ?? ""),
            isUserProvided: isUserProvided,
            estimatedTokens: max(1, Int((Double(body.count) / 4.0).rounded())),
            body: body
        )
    }

    private static func parseInlineList(_ raw: String) -> [String] {
        var trimmed = raw.trimmingCharacters(in: .whitespaces)
        if trimmed.hasPrefix("["), trimmed.hasSuffix("]") {
            trimmed = String(trimmed.dropFirst().dropLast())
        }
        return trimmed.split(separator: ",")
            .map { $0.trimmingCharacters(in: CharacterSet(charactersIn: " \"'")) }
            .filter { !$0.isEmpty }
    }

    // MARK: - Config

    static func isEnabled(configURL url: URL = configURL) -> Bool {
        readConfig(url)["enabled"] as? Bool ?? true
    }

    static func setEnabled(_ enabled: Bool, configURL url: URL = configURL) {
        var config = readConfig(url)
        config["enabled"] = enabled
        writeConfig(config, to: url)
    }

    /// A layer with no entry is on: a newly shipped layer should not need a config migration.
    static func isLayerEnabled(_ id: String, configURL url: URL = configURL) -> Bool {
        (readConfig(url)["layers"] as? [String: Any])?[id] as? Bool ?? true
    }

    static func setLayerEnabled(_ enabled: Bool, id: String, configURL url: URL = configURL) {
        var config = readConfig(url)
        var layers = config["layers"] as? [String: Any] ?? [:]
        layers[id] = enabled
        config["layers"] = layers
        writeConfig(config, to: url)
    }

    /// Whether a layer would actually reach the model: its own switch plus its dependencies'.
    /// Mirrors the fixpoint the extension's composer applies, so the UI cannot claim a layer
    /// is active when the composer would drop it.
    static func isLayerActive(
        _ layer: Layer,
        in catalog: [Layer],
        configURL url: URL = configURL
    ) -> Bool {
        guard isEnabled(configURL: url) else { return false }
        var active = Set(catalog.filter { isLayerEnabled($0.id, configURL: url) }.map(\.id))
        var changed = true
        while changed {
            changed = false
            for candidate in catalog where active.contains(candidate.id) {
                if candidate.requires.contains(where: { !active.contains($0) }) {
                    active.remove(candidate.id)
                    changed = true
                }
            }
        }
        return active.contains(layer.id)
    }

    static func estimatedActiveTokens(configURL url: URL = configURL) -> Int {
        let catalog = layers()
        return catalog
            .filter { isLayerActive($0, in: catalog, configURL: url) }
            .reduce(0) { $0 + $1.estimatedTokens }
    }

    /// Write the default config once, so the file's presence is a reliable signal that the
    /// philosophy is installed here. The dispatch runtime reads it to decide whether the
    /// fan-out layer is live — and therefore whether background dispatch is a hard invariant
    /// rather than a per-call preference. Never overwrites an existing file.
    static func ensureDefaultConfig(configURL url: URL = configURL) {
        guard !FileManager.default.fileExists(atPath: url.path) else { return }
        writeConfig([
            "enabled": true,
            "layers": ["foundation": true, "method": true, "orchestration": true, "fanout": true],
            "scopes": ["worker": false],
        ], to: url)
    }

    // MARK: - Migration

    /// One-time carry-over from the old single `Boss 模式` switch.
    ///
    /// Deliberately asymmetric: the old switch is mapped onto the two delegation layers only.
    /// `foundation` and `method` start on for everyone, including users who had Boss off —
    /// being unable to keep "don't ask ritual confirmations" without also taking the whole
    /// dispatch protocol was the defect this split exists to fix.
    static func migrateFromBossModeIfNeeded(
        defaults: UserDefaults = .standard,
        configURL url: URL = configURL
    ) {
        guard !defaults.bool(forKey: migrationKey) else { return }
        defer { defaults.set(true, forKey: migrationKey) }
        guard let bossMode = defaults.object(forKey: legacyBossModeKey) as? Bool, !bossMode else {
            return // never set, or set to on: the defaults already match.
        }
        var config = readConfig(url)
        var layers = config["layers"] as? [String: Any] ?? [:]
        layers["orchestration"] = false
        layers["fanout"] = false
        config["layers"] = layers
        writeConfig(config, to: url)
    }

    // MARK: - File I/O

    /// Unknown keys are preserved: `scopes`, `userDir` and anything a future version of the
    /// package adds belong to the package, not to this panel.
    private static func readConfig(_ url: URL) -> [String: Any] {
        guard let data = try? Data(contentsOf: url), !data.isEmpty,
              let object = try? JSONSerialization.jsonObject(with: data),
              let dict = object as? [String: Any]
        else { return [:] }
        return dict
    }

    private static func writeConfig(_ config: [String: Any], to url: URL) {
        var payload = config
        if payload["version"] == nil { payload["version"] = 1 }
        guard let data = try? JSONSerialization.data(
            withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
        else { return }
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: url, options: .atomic)
    }
}
