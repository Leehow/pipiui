import Foundation
import os

// Boundary / limits (read me before relying on this for forensics):
// - Captures: uncaught NSException and POSIX signals listed below (SIGABRT, SIGSEGV,
//   SIGBUS, SIGILL, SIGTRAP, SIGFPE).
// - Does NOT reliably capture: Swift `fatalError` / force-unwrap / array out-of-bounds
//   traps (often pure Swift runtime traps that never reach these handlers), `kill -9`
//   (SIGKILL cannot be caught), watchdog kills, or jetsam.
// - Handlers must stay async-signal-safe as much as practical. We only perform
//   best-effort synchronous file + os_log writes, then re-raise.

/// Installs process-wide crash hooks that flush a last-gasp fault line into the file log.
public enum CrashReporting {
    private static let lock = NSLock()
    private static var didInstall = false
    private static var previousExceptionHandler: NSUncaughtExceptionHandler?
    private static var installedSignals: [Int32] = []

    private static let watchedSignals: [Int32] = [
        SIGABRT, SIGSEGV, SIGBUS, SIGILL, SIGTRAP, SIGFPE,
    ]

    /// Idempotent. Safe to call early from `main` and again later.
    public static func install() {
        lock.lock()
        defer { lock.unlock() }
        guard !didInstall else { return }
        didInstall = true

        previousExceptionHandler = NSGetUncaughtExceptionHandler()
        NSSetUncaughtExceptionHandler(pipiUncaughtExceptionHandler)

        // Exceptions raised inside AppKit's event/display cycle never reach the
        // handler above; hook the one entry point that still sees the reason.
        AppKitExceptionHook.install()

        // Signal handlers: save nothing portable for “previous” beyond default;
        // after logging we restore SIG_DFL and re-raise.
        for sig in watchedSignals {
            signal(sig, pipiCrashSignalHandler)
            installedSignals.append(sig)
        }
    }

    // MARK: - NSException / Signals helpers used by file-scope C handlers below

    fileprivate static func handleUncaughtException(_ exception: NSException) {
        let name = exception.name.rawValue
        let reason = exception.reason ?? "(no reason)"
        let frames = exception.callStackSymbols
        var parts: [String] = [
            "Uncaught NSException: \(name): \(reason)",
        ]
        if !frames.isEmpty {
            parts.append("Call stack:")
            parts.append(contentsOf: frames.map { "\t\($0)" })
        }
        logCrashSync(parts.joined(separator: "\n"))

        if let previous = previousExceptionHandler {
            previous(exception)
        }
    }

    fileprivate static func handleCrashSignal(_ sig: Int32) {
        let name = signalName(sig)
        let frames = Thread.callStackSymbols
        var parts: [String] = [
            "Fatal signal \(name) (\(sig))",
        ]
        if !frames.isEmpty {
            parts.append("Call stack:")
            parts.append(contentsOf: frames.map { "\t\($0)" })
        }
        logCrashSync(parts.joined(separator: "\n"))

        // Restore default and re-raise so the system can produce a crash report.
        signal(sig, SIG_DFL)
        raise(sig)
    }

    /// Synchronous last-gasp write. Prefer `FileLogSink.appendSync` + `fflush` semantics.
    public static func logCrashSync(_ message: String) {
        let sink = PipiLogger.shared.fileLogSink
        // Format contract: `[FAULT] [crash] …` inside the standard file line.
        sink.appendSync(level: .fault, category: .crash, message: message)

        // Best-effort unified log (may be unsafe in strict async-signal context;
        // accepted trade-off for debuggability on macOS desktop).
        let logger = Logger(subsystem: OSLogSink.subsystem, category: LogCategory.crash.osLogCategory)
        logger.fault("\(message, privacy: .public)")

        // Extra belt-and-suspenders flush of stdio in case any path wrote there.
        fflush(nil)
    }

    private static func signalName(_ sig: Int32) -> String {
        switch sig {
        case SIGABRT: return "SIGABRT"
        case SIGSEGV: return "SIGSEGV"
        case SIGBUS: return "SIGBUS"
        case SIGILL: return "SIGILL"
        case SIGTRAP: return "SIGTRAP"
        case SIGFPE: return "SIGFPE"
        default: return "SIGNAL"
        }
    }
}

// File-scope @convention(c) entry points — nested/static closures cannot form C function pointers.
private func pipiUncaughtExceptionHandler(_ exception: NSException) {
    CrashReporting.handleUncaughtException(exception)
}

private func pipiCrashSignalHandler(_ sig: Int32) {
    CrashReporting.handleCrashSignal(sig)
}
