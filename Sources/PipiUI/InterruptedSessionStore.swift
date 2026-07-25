import Foundation

/// Persists session jsonl paths that were mid-agent when the app/process died.
/// Survives abnormal quit so the sidebar can show a red "已中断" badge on reopen.
enum InterruptedSessionStore {
    static let defaultsKey = "pipiui.inFlightSessionPaths"

    static func paths(defaults: UserDefaults = .standard) -> Set<String> {
        Set(defaults.stringArray(forKey: defaultsKey) ?? [])
    }

    static func contains(_ path: String, defaults: UserDefaults = .standard) -> Bool {
        guard !path.isEmpty else { return false }
        return paths(defaults: defaults).contains(path)
    }

    static func mark(_ path: String, defaults: UserDefaults = .standard) {
        guard !path.isEmpty else { return }
        var next = paths(defaults: defaults)
        guard next.insert(path).inserted else { return }
        defaults.set(Array(next).sorted(), forKey: defaultsKey)
    }

    static func clear(_ path: String, defaults: UserDefaults = .standard) {
        guard !path.isEmpty else { return }
        var next = paths(defaults: defaults)
        guard next.remove(path) != nil else { return }
        defaults.set(Array(next).sorted(), forKey: defaultsKey)
    }
}
