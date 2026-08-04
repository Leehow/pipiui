import Foundation

/// UserDefaults-backed global toggle + jcode credential probe for the
/// Experimental settings tab. No credential writes — jcode owns its login.
enum JcodeSettings {
    private static let key = "pipiui.jcode.enabled"

    static var isEnabled: Bool {
        get { UserDefaults.standard.bool(forKey: key) }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }

    /// Parse `jcode auth status --json` output → ids of providers whose status
    /// is not "not_configured". Pure (testable with fixtures); the live shell-out
    /// wrapper is `detectConfiguredProviders(completion:)`.
    static func parseProviders(from data: Data) -> [String] {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let providers = obj["providers"] as? [[String: Any]] else { return [] }
        return providers.compactMap { p in
            ((p["status"] as? String) ?? "not_configured") != "not_configured"
                ? (p["id"] as? String)
                : nil
        }
    }

    /// Async: shell out to `jcode auth status --json`, return configured provider
    /// ids on the main thread. Empty if jcode is missing or parsing fails.
    static func detectConfiguredProviders(completion: @escaping ([String]) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            let p = Process()
            // Reuse the same resolver as JcodeBridge to locate the binary.
            if let bin = JcodeBridge.findJcodeExecutable() {
                p.executableURL = URL(fileURLWithPath: bin)
            } else {
                DispatchQueue.main.async { completion([]) }
                return
            }
            p.arguments = ["auth", "status", "--json"]
            let out = Pipe()
            p.standardOutput = out
            p.standardError = Pipe()
            do { try p.run(); p.waitUntilExit() } catch {
                DispatchQueue.main.async { completion([]) }; return
            }
            let data = out.fileHandleForReading.readDataToEndOfFile()
            let ids = parseProviders(from: data)
            DispatchQueue.main.async { completion(ids) }
        }
    }
}
