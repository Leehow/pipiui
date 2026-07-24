import Foundation
import os

/// Forwards structured log records to the unified logging system (`os.Logger`).
public final class OSLogSink: @unchecked Sendable {
    public static let subsystem = "com.leehow.pipiui"

    private var loggers: [LogCategory: Logger] = [:]
    private let lock = NSLock()

    public init() {}

    public func log(_ level: LogLevel, category: LogCategory, message: String) {
        let logger = logger(for: category)
        switch level {
        case .debug:
            logger.debug("\(message, privacy: .public)")
        case .info:
            logger.info("\(message, privacy: .public)")
        case .warn:
            // os.Logger has no "warn"; `default` is the conventional mapping.
            logger.log(level: .default, "\(message, privacy: .public)")
        case .error:
            logger.error("\(message, privacy: .public)")
        case .fault:
            logger.fault("\(message, privacy: .public)")
        }
    }

    private func logger(for category: LogCategory) -> Logger {
        lock.lock()
        defer { lock.unlock() }
        if let existing = loggers[category] {
            return existing
        }
        let created = Logger(subsystem: Self.subsystem, category: category.osLogCategory)
        loggers[category] = created
        return created
    }
}
