import Foundation

/// Severity levels for PipiUI logging.
public enum LogLevel: Int, Comparable, CaseIterable, Sendable {
    case debug = 0
    case info = 1
    case warn = 2
    case error = 3
    case fault = 4

    public static func < (lhs: LogLevel, rhs: LogLevel) -> Bool {
        lhs.rawValue < rhs.rawValue
    }

    /// Short tag used in file-log lines, e.g. `[INFO]`.
    public var tag: String {
        switch self {
        case .debug: return "DEBUG"
        case .info: return "INFO"
        case .warn: return "WARN"
        case .error: return "ERROR"
        case .fault: return "FAULT"
        }
    }

    /// Parse a level from an environment-variable style string (case-insensitive).
    /// Accepts: debug, info, warn/warning, error, fault/critical.
    public init?(env: String) {
        switch env.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "debug", "dbg", "trace", "verbose":
            self = .debug
        case "info", "information":
            self = .info
        case "warn", "warning":
            self = .warn
        case "error", "err":
            self = .error
        case "fault", "critical", "fatal":
            self = .fault
        default:
            return nil
        }
    }
}
