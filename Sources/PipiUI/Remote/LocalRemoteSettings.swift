import Foundation

enum LocalRemoteSettings {
    private static let enabledKey = "pipiui.localRemoteTest.enabled"

    static func isEnabled(defaults: UserDefaults = .standard) -> Bool {
        defaults.bool(forKey: enabledKey)
    }

    static func setEnabled(_ enabled: Bool, defaults: UserDefaults = .standard) {
        defaults.set(enabled, forKey: enabledKey)
    }

    /// LAN exposure is deliberately process/session scoped. It is never read
    /// from or written to UserDefaults, so every app launch starts safe.
    static var isLANEnabledForNewLaunch: Bool { false }
}
