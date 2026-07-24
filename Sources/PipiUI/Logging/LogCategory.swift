import Foundation

/// Logical subsystems for log routing and filtering.
public enum LogCategory: String, CaseIterable, Sendable {
    case app
    case bridge
    case process
    case session
    case webview
    case network
    case storage
    case ui
    case crash
    case selftest
    /// LLM token/usage accounting (per-turn input/output/cache/cost writes to TokenLedger).
    case token

    /// Value passed to `os.Logger` as the category string.
    public var osLogCategory: String { rawValue }
}
