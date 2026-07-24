import Foundation

/// Central logger: level gate, dual sinks (OSLog + file), idempotent bootstrap.
public final class PipiLogger: @unchecked Sendable {
    public static let shared = PipiLogger()

    /// Environment variable for minimum level, e.g. `PIPIUI_LOG_LEVEL=debug`.
    public static let envLevelKey = "PIPIUI_LOG_LEVEL"
    /// UserDefaults key for minimum level (string, same tokens as env).
    public static let defaultsLevelKey = "pipiui.logLevel"

    private static var didBootstrap = false
    private static let bootstrapLock = NSLock()

    public let osLogSink: OSLogSink
    public let fileLogSink: FileLogSink

    private let queue: DispatchQueue
    private var minimumLevel: LogLevel = .info

    public var logsDirectoryURL: URL {
        fileLogSink.logsDirectoryURL
    }

    public init(
        osLogSink: OSLogSink = OSLogSink(),
        fileLogSink: FileLogSink? = nil,
        queue: DispatchQueue? = nil
    ) {
        self.osLogSink = osLogSink
        // Separate serial queues: logger gate vs file I/O. Sharing one queue would
        // deadlock when logSync/flushSync call into FileLogSink.appendSync/flushSync.
        self.queue = queue ?? DispatchQueue(label: "com.leehow.pipiui.logger", qos: .utility)
        self.fileLogSink = fileLogSink ?? FileLogSink()
    }

    /// Idempotent process-wide bootstrap. Safe to call from main and from AppDelegate.
    public static func bootstrap() {
        bootstrapLock.lock()
        let already = didBootstrap
        if !already { didBootstrap = true }
        bootstrapLock.unlock()

        guard !already else { return }
        shared.performBootstrap()
    }

    /// Instance-level bootstrap used by tests or alternate instances.
    public func bootstrap() {
        performBootstrap()
    }

    private func performBootstrap() {
        let level = Self.resolveMinimumLevel()
        queue.sync {
            self.minimumLevel = level
        }
        writeDiagnosticHeader(minimumLevel: level)
    }

    public static func resolveMinimumLevel(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        defaults: UserDefaults = .standard
    ) -> LogLevel {
        if let raw = environment[envLevelKey], let parsed = LogLevel(env: raw) {
            return parsed
        }
        if let raw = defaults.string(forKey: defaultsLevelKey), let parsed = LogLevel(env: raw) {
            return parsed
        }
        #if DEBUG
        return .debug
        #else
        return .info
        #endif
    }

    public func setMinimumLevel(_ level: LogLevel) {
        queue.async {
            self.minimumLevel = level
        }
    }

    public func log(
        _ level: LogLevel,
        _ message: String,
        category: LogCategory = .app,
        file: String = #fileID,
        function: String = #function,
        line: Int = #line
    ) {
        // Fast path: hop to serial queue so callers (esp. main) are not blocked on I/O.
        queue.async { [weak self] in
            guard let self else { return }
            guard level >= self.minimumLevel else { return }
            let enriched = Self.enrich(message, file: file, function: function, line: line, level: level)
            self.osLogSink.log(level, category: category, message: enriched)
            self.fileLogSink.append(level: level, category: category, message: enriched)
        }
    }

    /// Synchronous path for crash reporting / terminate. Bypasses level? No — still respects fault.
    public func logSync(
        _ level: LogLevel,
        _ message: String,
        category: LogCategory = .app
    ) {
        queue.sync {
            // Always emit fault/error on sync crash path even if level gate is high;
            // for normal sync calls still respect the gate.
            if level < self.minimumLevel && level < .error {
                return
            }
            self.osLogSink.log(level, category: category, message: message)
            self.fileLogSink.appendSync(level: level, category: category, message: message)
        }
    }

    public func flushSync() {
        fileLogSink.flushSync()
    }

    // MARK: - Internals

    private static func enrich(
        _ message: String,
        file: String,
        function: String,
        line: Int,
        level: LogLevel
    ) -> String {
        // Keep info+ free of source noise; attach location for debug (and optionally warn+).
        switch level {
        case .debug:
            let shortFile = file.split(separator: "/").last.map(String.init) ?? file
            return "\(message) (\(shortFile):\(line) \(function))"
        default:
            return message
        }
    }

    private func writeDiagnosticHeader(minimumLevel: LogLevel) {
        let processInfo = ProcessInfo.processInfo
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "unknown"
        let exec = Bundle.main.executableURL?.path
            ?? CommandLine.arguments.first
            ?? "unknown"
        let osVersion = processInfo.operatingSystemVersionString
        let host = processInfo.hostName
        let pid = processInfo.processIdentifier
        let lines = [
            "======== PipiUI log session ========",
            "time: \(ISO8601DateFormatter().string(from: Date()))",
            "appVersion: \(version) (\(build))",
            "os: \(osVersion)",
            "host: \(host)",
            "pid: \(pid)",
            "executable: \(exec)",
            "minimumLevel: \(minimumLevel.tag)",
            "logsDirectory: \(logsDirectoryURL.path)",
            "====================================",
        ]
        let header = lines.joined(separator: " | ")
        // Write header synchronously so it appears before any early async logs.
        fileLogSink.appendSync(level: .info, category: .app, message: header)
        osLogSink.log(.info, category: .app, message: header)
    }
}
