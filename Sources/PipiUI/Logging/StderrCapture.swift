import Foundation

/// Redirects the process `stderr` (fd 2) into a file next to the normal log.
///
/// Why this exists: the messages that explain most "莫名其妙崩溃" never reach
/// `Log.*`. Swift runtime traps (`fatalError`, force-unwrap nil, index out of
/// range), `NSException` reasons printed by AppKit, Auto Layout complaints and
/// WebKit/libc warnings are all written straight to fd 2. When the app is
/// launched from Finder that fd points at `/dev/null`, so the evidence is lost.
///
/// Pointing fd 2 at a real file is done by the kernel, needs no runtime of ours,
/// and therefore still records the very last line before a trap.
public enum StderrCapture {
    public static let filePrefix = "pipiui-stderr-"
    public static let fileExtension = "log"

    /// Hard cap on the capture file. A single runaway writer — SwiftUI printing
    /// `AttributeGraph: cycle detected` on every frame, for instance — produced
    /// 3.1 GB in nine minutes during development. Past this size the file is
    /// truncated: recent lines are the ones that explain the current state, and
    /// an unbounded log is a bug of its own.
    public static let maxBytes: UInt64 = 24 * 1024 * 1024
    /// How often the size is checked.
    public static let sizeCheckInterval: TimeInterval = 10

    private static let lock = NSLock()
    private static var installedURL: URL?
    private static var watchdog: DispatchSourceTimer?
    private static var lastCheckedSize: UInt64 = 0

    /// Path of the file fd 2 currently points at, or `nil` when not redirected.
    public static var currentFileURL: URL? {
        lock.lock()
        defer { lock.unlock() }
        return installedURL
    }

    /// Idempotent. No-op when stderr is a terminal (i.e. `swift run` from a shell),
    /// so console debugging keeps working unchanged.
    ///
    /// - Parameters:
    ///   - directory: folder to write into. Defaults to the shared logs folder.
    ///   - force: redirect even when stderr is a tty (used by tests).
    @discardableResult
    public static func install(
        directory: URL? = nil,
        force: Bool = false
    ) -> URL? {
        lock.lock()
        defer { lock.unlock() }
        guard installedURL == nil else { return installedURL }
        guard force || isatty(STDERR_FILENO) == 0 else { return nil }

        let dir = directory ?? PipiLogger.shared.logsDirectoryURL
        guard let url = redirect(into: dir) else { return nil }
        installedURL = url
        startSizeWatchdog(url: url)
        return url
    }

    /// Truncation rule, factored out so it can be tested without a real file.
    /// Returns the message to log when the file must be truncated, else `nil`.
    public static func truncationNotice(
        size: UInt64,
        previousSize: UInt64,
        interval: TimeInterval,
        cap: UInt64 = maxBytes
    ) -> String? {
        guard size > cap else { return nil }
        let grown = size > previousSize ? size - previousSize : size
        let perSecond = interval > 0 ? Double(grown) / interval : Double(grown)
        return String(
            format: "stderr capture hit its %.0f MB cap (growing %.1f MB/s) — truncating. "
                + "Something is writing to stderr in a loop.",
            Double(cap) / 1_048_576,
            perSecond / 1_048_576
        )
    }

    /// Name of the file used for a given day, e.g. `pipiui-stderr-2026-07-23.log`.
    public static func fileName(for date: Date, calendarLocale: Locale = Locale(identifier: "en_US_POSIX")) -> String {
        let formatter = DateFormatter()
        formatter.locale = calendarLocale
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        return "\(filePrefix)\(formatter.string(from: date)).\(fileExtension)"
    }

    // MARK: - Internals

    private static func startSizeWatchdog(url: URL) {
        let timer = DispatchSource.makeTimerSource(
            queue: DispatchQueue(label: "com.leehow.pipiui.stderr-watchdog", qos: .utility)
        )
        timer.schedule(deadline: .now() + sizeCheckInterval, repeating: sizeCheckInterval)
        timer.setEventHandler {
            enforceSizeCap(url: url)
        }
        timer.resume()
        watchdog = timer
    }

    private static func enforceSizeCap(url: URL) {
        let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
        let size = (attributes?[.size] as? NSNumber)?.uint64Value ?? 0
        let previous = lastCheckedSize
        lastCheckedSize = size

        guard let notice = truncationNotice(
            size: size, previousSize: previous, interval: sizeCheckInterval
        ) else {
            return
        }
        // fd 2 stays open in O_APPEND mode, so writes resume at the new end.
        guard truncate(url.path, 0) == 0 else { return }
        lastCheckedSize = 0
        Log.warn(notice, category: .app)
    }

    private static func redirect(into directory: URL) -> URL? {
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        } catch {
            return nil
        }

        let url = directory.appendingPathComponent(fileName(for: Date()), isDirectory: false)
        // O_APPEND keeps concurrent writers (us + any child that inherits fd 2) honest.
        let fd = open(url.path, O_WRONLY | O_CREAT | O_APPEND, 0o644)
        guard fd >= 0 else { return nil }
        defer { close(fd) }

        let banner = "\n---- stderr session pid \(ProcessInfo.processInfo.processIdentifier) "
            + "at \(ISO8601DateFormatter().string(from: Date())) ----\n"
        if let data = banner.data(using: .utf8) {
            _ = data.withUnsafeBytes { write(fd, $0.baseAddress, $0.count) }
        }

        guard dup2(fd, STDERR_FILENO) >= 0 else { return nil }
        // Unbuffered: a trap must not lose the line that explains it.
        setvbuf(stderr, nil, _IONBF, 0)
        return url
    }
}
