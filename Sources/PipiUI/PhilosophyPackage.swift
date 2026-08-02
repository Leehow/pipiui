import Foundation

/// Installs the bundled `pipi-philosophy` package and registers it with pi itself.
///
/// Deliberately the one exception to `PiPlugin`'s "never touch `~/.pi`" rule. That rule exists
/// for UI plumbing — bridge, webview, the patched subagent — which is meaningless outside this
/// process. The philosophy is the opposite: it is how the agent *thinks*, so binding it to one
/// frontend would mean losing it the moment the user runs `pi` in a terminal. Registering it as
/// a pi package is what makes a bare TUI session, this App, and every dispatched worker load
/// the same layers from the same config.
enum PhilosophyPackage {
    /// The pi package directory installed from the app bundle.
    static var installedURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PipiUI", isDirectory: true)
            .appendingPathComponent("pi-philosophy", isDirectory: true)
    }

    /// Extension entry point, used only by the `-e` fallback when registration is unavailable.
    static var extensionPath: String? {
        let path = installedURL.appendingPathComponent("philosophy.ts").path
        return FileManager.default.fileExists(atPath: path) ? path : nil
    }

    /// The App's own safety net: when pi is not loading the package itself, mount it directly so
    /// sessions started from here still get the philosophy. Double-loading is harmless — the
    /// extension refuses to inject twice — but skipping the flag avoids parsing it twice.
    static var fallbackExtensionPath: String? {
        registration() == .registered ? nil : extensionPath
    }

    /// Set to false by the "移除" action, so a deliberate uninstall is not undone on next launch.
    private static let autoRegisterKey = "pipiui.philosophyAutoRegister"

    static func autoRegisterEnabled(defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: autoRegisterKey) as? Bool ?? true
    }

    static func setAutoRegisterEnabled(_ enabled: Bool, defaults: UserDefaults = .standard) {
        defaults.set(enabled, forKey: autoRegisterKey)
    }

    static var settingsURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".pi/agent/settings.json")
    }

    /// The snapshot inside the app bundle. Tests read layers from here so they never touch the
    /// user's installed copy.
    static var bundledURL: URL? {
        let candidate = PipiResourceBundle.shared.url(forResource: "PiPhilosophy", withExtension: nil)
            ?? PipiResourceBundle.shared.resourceURL?
                .appendingPathComponent("PiPhilosophy", isDirectory: true)
        guard let candidate, FileManager.default.fileExists(atPath: candidate.path) else { return nil }
        return candidate
    }

    // MARK: - Install

    /// Copy the bundled snapshot over the installed one. Called on every launch so an app
    /// update ships a philosophy update, exactly like the other bundled pi resources.
    @discardableResult
    static func install(fileManager: FileManager = .default) -> URL? {
        guard let bundled = bundledURL else { return nil }
        let dest = installedURL
        do {
            try fileManager.createDirectory(
                at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
            if fileManager.fileExists(atPath: dest.path) {
                try fileManager.removeItem(at: dest)
            }
            try fileManager.copyItem(at: bundled, to: dest)
            return dest
        } catch {
            return nil
        }
    }

    // MARK: - Registration in pi's own settings

    enum Registration: Equatable {
        /// Listed in `packages`; every pi session on this machine loads it.
        case registered
        /// Not listed. This App still loads it via `-e`, but a terminal `pi` will not.
        case notRegistered
        /// `settings.json` exists but could not be parsed as a JSON object — never overwrite it.
        case unreadable(String)
    }

    static func registration(settingsURL url: URL = settingsURL) -> Registration {
        switch readSettings(url) {
        case .unreadable(let message):
            return .unreadable(message)
        case .ok(let settings):
            let packages = settings["packages"] as? [Any] ?? []
            let target = installedURL.path
            let listed = packages.contains { entry in
                packageSource(entry).map { matches($0, target) } ?? false
            }
            return listed ? .registered : .notRegistered
        }
    }

    /// pi accepts both a string and `{ "source": ... }` for package entries.
    /// Registration, idempotence, and removal must use the same parser.
    private static func packageSource(_ entry: Any) -> String? {
        if let source = entry as? String { return source }
        return (entry as? [String: Any])?["source"] as? String
    }

    /// Trailing slashes and `~` are both legal in pi's package list; compare resolved paths.
    private static func matches(_ entry: String, _ target: String) -> Bool {
        let expanded = (entry as NSString).expandingTildeInPath
        return URL(fileURLWithPath: expanded).standardizedFileURL.path
            == URL(fileURLWithPath: target).standardizedFileURL.path
    }

    enum RegistrationError: LocalizedError {
        case unreadableSettings(String)
        case writeFailed(String)

        var errorDescription: String? {
            switch self {
            case .unreadableSettings(let detail):
                return "无法解析 ~/.pi/agent/settings.json（\(detail)）——已跳过，不覆盖你的配置。"
            case .writeFailed(let detail):
                return "写入 ~/.pi/agent/settings.json 失败：\(detail)"
            }
        }
    }

    static func register(settingsURL url: URL = settingsURL) throws {
        try mutatePackages(url) { packages in
            let target = installedURL.path
            guard !packages.contains(where: {
                packageSource($0).map { matches($0, target) } ?? false
            }) else {
                return false
            }
            packages.append(target)
            return true
        }
    }

    static func unregister(settingsURL url: URL = settingsURL) throws {
        try mutatePackages(url) { packages in
            let target = installedURL.path
            let before = packages.count
            packages.removeAll { entry in
                packageSource(entry).map { matches($0, target) } ?? false
            }
            return packages.count != before
        }
    }

    /// Read → mutate only `packages` → write. Every other key is passed through untouched:
    /// this file is the user's, and pi is its primary owner.
    private static func mutatePackages(
        _ url: URL,
        _ body: (inout [Any]) -> Bool
    ) throws {
        var settings: [String: Any]
        switch readSettings(url) {
        case .unreadable(let message):
            throw RegistrationError.unreadableSettings(message)
        case .ok(let existing):
            settings = existing
        }
        // Registration edits the user's own pi settings, which every pi session on this
        // machine reads. A test process must never reach that file.
        guard SharedConfigWriteGuard.mayWrite(url, sharedDefault: settingsURL) else { return }
        var packages = settings["packages"] as? [Any] ?? []
        guard body(&packages) else { return }
        settings["packages"] = packages
        do {
            let data = try JSONSerialization.data(
                withJSONObject: settings, options: [.prettyPrinted, .sortedKeys])
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: url, options: .atomic)
        } catch {
            throw RegistrationError.writeFailed(error.localizedDescription)
        }
    }

    private enum SettingsRead {
        case ok([String: Any])
        case unreadable(String)
    }

    /// A missing file is an empty object — pi creates it on demand too. Anything present but
    /// unparseable is an error, never a reason to start from scratch.
    private static func readSettings(_ url: URL) -> SettingsRead {
        guard FileManager.default.fileExists(atPath: url.path) else { return .ok([:]) }
        guard let data = try? Data(contentsOf: url) else {
            return .unreadable("读取失败")
        }
        if data.isEmpty { return .ok([:]) }
        guard let object = try? JSONSerialization.jsonObject(with: data),
              let dict = object as? [String: Any]
        else {
            return .unreadable("不是合法的 JSON 对象")
        }
        // A present `packages` value belongs to pi/user configuration. If it is
        // not an array, never reinterpret it as [] and overwrite it.
        if let packages = dict["packages"], !(packages is [Any]) {
            return .unreadable("packages 不是数组")
        }
        return .ok(dict)
    }
}
