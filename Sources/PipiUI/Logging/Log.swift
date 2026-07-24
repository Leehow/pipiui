import Foundation

/// Public façade for application logging.
///
/// Prefer `Log.info("…", category: .session)` over touching `PipiLogger` directly.
public enum Log {
    /// Idempotent bootstrap: configure minimum level, open file sink, write diagnostic header.
    public static func bootstrap() {
        PipiLogger.bootstrap()
    }

    /// Folder that holds `pipiui-*.log`; surfaced in the Help menu.
    public static var logsDirectoryURL: URL {
        PipiLogger.shared.logsDirectoryURL
    }

    /// Records where `stderr` ended up, so the log file points at its own companion.
    public static func noteStderrCapture(_ url: URL?) {
        if let url {
            info("stderr captured to \(url.path)", category: .app)
        } else {
            info("stderr left on the terminal (tty detected); no capture file", category: .app)
        }
    }

    public static func debug(
        _ message: String,
        category: LogCategory = .app,
        file: String = #fileID,
        function: String = #function,
        line: Int = #line
    ) {
        PipiLogger.shared.log(.debug, message, category: category, file: file, function: function, line: line)
    }

    public static func info(
        _ message: String,
        category: LogCategory = .app,
        file: String = #fileID,
        function: String = #function,
        line: Int = #line
    ) {
        PipiLogger.shared.log(.info, message, category: category, file: file, function: function, line: line)
    }

    public static func warn(
        _ message: String,
        category: LogCategory = .app,
        file: String = #fileID,
        function: String = #function,
        line: Int = #line
    ) {
        PipiLogger.shared.log(.warn, message, category: category, file: file, function: function, line: line)
    }

    public static func error(
        _ message: String,
        category: LogCategory = .app,
        file: String = #fileID,
        function: String = #function,
        line: Int = #line
    ) {
        PipiLogger.shared.log(.error, message, category: category, file: file, function: function, line: line)
    }

    public static func fault(
        _ message: String,
        category: LogCategory = .app,
        file: String = #fileID,
        function: String = #function,
        line: Int = #line
    ) {
        PipiLogger.shared.log(.fault, message, category: category, file: file, function: function, line: line)
    }
}
