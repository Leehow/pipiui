import Foundation

/// Whether this process may write the shared config files under Application Support.
///
/// Those paths are absolute and unsandboxed, so a test process reaches the same files the
/// installed app uses. That alone would be survivable, except a test binary also gets its own
/// `UserDefaults.standard` domain — the app's preferences are simply not there. Settings code
/// then reads its own defaults, finds nothing, and mirrors the *code defaults* over the user's
/// real choices: the search backend reverts to DuckDuckGo, the subagent model overrides empty
/// out. `defaults === .standard` cannot catch it, because it genuinely is `.standard`.
///
/// The damage is invisible from the UI. Every Settings panel reads UserDefaults, which is
/// untouched, so it keeps displaying Tavily and the configured subagent models while the
/// extensions that read the JSON mirrors have been silently reset to defaults.
enum SharedConfigWriteGuard {
    /// XCTest exports this for the whole test process, including code under test.
    static var isRunningTests: Bool {
        ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
            || ProcessInfo.processInfo.environment["XCTestSessionIdentifier"] != nil
            || NSClassFromString("XCTestCase") != nil
    }

    /// A write to a caller-chosen path is always allowed; only the shared default is withheld.
    static func mayWriteSharedFile(explicitURL: URL?) -> Bool {
        explicitURL != nil || !isRunningTests
    }
}
