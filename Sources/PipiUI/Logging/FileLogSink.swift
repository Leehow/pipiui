import Foundation

/// Append-only daily file sink under `~/Library/Logs/PipiUI/`.
///
/// - Files: `pipiui-YYYY-MM-DD.log`
/// - Rotation: single file over 5 MB is rolled; at most 10 files retained
/// - Messages longer than 2 KB are truncated
/// - Writes are asynchronous on an internal serial queue (except `appendSync` / `flushSync`)
public final class FileLogSink: @unchecked Sendable {
    public static let maxMessageBytes = 2048
    public static let maxFileBytes = 5 * 1024 * 1024
    public static let maxRetainedFiles = 10
    public static let directoryName = "PipiUI"
    public static let filePrefix = "pipiui-"
    public static let fileExtension = "log"

    private let baseDirectory: URL
    private let queue: DispatchQueue
    private let fileManager: FileManager
    private let dateFormatter: DateFormatter
    private let timestampFormatter: DateFormatter

    private var currentDayKey: String?
    private var currentHandle: FileHandle?
    private var currentURL: URL?
    private var currentByteCount: UInt64 = 0

    /// - Parameters:
    ///   - baseDirectory: Parent of the `PipiUI` logs folder. Defaults to `~/Library/Logs`.
    ///   - queue: Serial queue used for async appends. Defaults to a private utility queue.
    ///   - fileManager: Injectable for tests.
    public init(
        baseDirectory: URL? = nil,
        queue: DispatchQueue? = nil,
        fileManager: FileManager = .default
    ) {
        self.fileManager = fileManager
        if let baseDirectory {
            self.baseDirectory = baseDirectory
        } else {
            let home = fileManager.homeDirectoryForCurrentUser
            self.baseDirectory = home
                .appendingPathComponent("Library", isDirectory: true)
                .appendingPathComponent("Logs", isDirectory: true)
        }
        self.queue = queue ?? DispatchQueue(label: "com.leehow.pipiui.file-log", qos: .utility)

        let day = DateFormatter()
        day.locale = Locale(identifier: "en_US_POSIX")
        day.timeZone = TimeZone.current
        day.dateFormat = "yyyy-MM-dd"
        self.dateFormatter = day

        let ts = DateFormatter()
        ts.locale = Locale(identifier: "en_US_POSIX")
        ts.timeZone = TimeZone.current
        ts.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSZZZZZ"
        self.timestampFormatter = ts
    }

    /// Directory that holds `pipiui-*.log` files (`…/Logs/PipiUI`).
    public var logsDirectoryURL: URL {
        baseDirectory.appendingPathComponent(Self.directoryName, isDirectory: true)
    }

    /// Async append. Never blocks the caller for disk I/O.
    public func append(level: LogLevel, category: LogCategory, message: String, date: Date = Date()) {
        let line = formatLine(level: level, category: category, message: message, date: date)
        queue.async { [weak self] in
            self?.writeLine(line)
        }
    }

    /// Synchronous append for crash / terminate paths. Blocks until the bytes are written.
    public func appendSync(level: LogLevel, category: LogCategory, message: String, date: Date = Date()) {
        let line = formatLine(level: level, category: category, message: message, date: date)
        queue.sync { [weak self] in
            self?.writeLine(line)
            self?.synchronizeCurrentHandle()
        }
    }

    /// Drain pending async work and flush the open file handle.
    public func flushSync() {
        queue.sync { [weak self] in
            self?.synchronizeCurrentHandle()
        }
    }

    // MARK: - Formatting

    public func formatLine(level: LogLevel, category: LogCategory, message: String, date: Date = Date()) -> String {
        let ts = timestampFormatter.string(from: date)
        let body = Self.truncateMessage(message)
        return "\(ts) [\(level.tag)] [\(category.rawValue)] \(body)\n"
    }

    public static func truncateMessage(_ message: String) -> String {
        let utf8Count = message.utf8.count
        guard utf8Count > maxMessageBytes else { return message }

        // Truncate on a UTF-8 boundary.
        var end = message.startIndex
        var bytes = 0
        let budget = maxMessageBytes - 64 // room for suffix
        for i in message.indices {
            let charBytes = message[i].utf8.count
            if bytes + charBytes > budget { break }
            bytes += charBytes
            end = message.index(after: i)
        }
        let prefix = String(message[..<end])
        let omitted = utf8Count - prefix.utf8.count
        return "\(prefix)…(truncated \(omitted) chars)"
    }

    // MARK: - File I/O (queue-isolated)

    private func writeLine(_ line: String) {
        guard let data = line.data(using: .utf8) else { return }
        ensureHandle(additionalBytes: UInt64(data.count))
        guard let handle = currentHandle else { return }
        do {
            try handle.write(contentsOf: data)
            currentByteCount += UInt64(data.count)
        } catch {
            // Best-effort sink: drop on write failure rather than crashing the app.
            closeCurrentHandle()
        }
    }

    private func ensureHandle(additionalBytes: UInt64) {
        let now = Date()
        let dayKey = dateFormatter.string(from: now)

        if currentHandle == nil || currentDayKey != dayKey {
            openFile(for: dayKey)
        }

        if currentByteCount + additionalBytes > UInt64(Self.maxFileBytes) {
            rollCurrentFile(dayKey: dayKey)
        }
    }

    private func openFile(for dayKey: String) {
        closeCurrentHandle()
        let dir = logsDirectoryURL
        do {
            try fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
        } catch {
            return
        }

        let url = dir
            .appendingPathComponent("\(Self.filePrefix)\(dayKey).\(Self.fileExtension)", isDirectory: false)

        if !fileManager.fileExists(atPath: url.path) {
            fileManager.createFile(atPath: url.path, contents: nil, attributes: nil)
        }

        do {
            let handle = try FileHandle(forWritingTo: url)
            try handle.seekToEnd()
            let attrs = try fileManager.attributesOfItem(atPath: url.path)
            let size = (attrs[.size] as? NSNumber)?.uint64Value ?? 0
            currentHandle = handle
            currentURL = url
            currentDayKey = dayKey
            currentByteCount = size
            pruneOldFiles()
        } catch {
            currentHandle = nil
            currentURL = nil
            currentDayKey = nil
            currentByteCount = 0
        }
    }

    private func rollCurrentFile(dayKey: String) {
        guard let url = currentURL else {
            openFile(for: dayKey)
            return
        }
        closeCurrentHandle()

        let dir = url.deletingLastPathComponent()
        let stamp = Int(Date().timeIntervalSince1970)
        let rolled = dir.appendingPathComponent(
            "\(Self.filePrefix)\(dayKey).\(stamp).\(Self.fileExtension)",
            isDirectory: false
        )
        try? fileManager.moveItem(at: url, to: rolled)
        openFile(for: dayKey)
    }

    private func closeCurrentHandle() {
        synchronizeCurrentHandle()
        try? currentHandle?.close()
        currentHandle = nil
        currentURL = nil
        currentDayKey = nil
        currentByteCount = 0
    }

    private func synchronizeCurrentHandle() {
        guard let handle = currentHandle else { return }
        do {
            try handle.synchronize()
        } catch {
            // ignore
        }
    }

    private func pruneOldFiles() {
        let dir = logsDirectoryURL
        guard let entries = try? fileManager.contentsOfDirectory(
            at: dir,
            includingPropertiesForKeys: [.contentModificationDateKey, .isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else {
            return
        }

        let logs = entries.filter { url in
            let name = url.lastPathComponent
            return name.hasPrefix(Self.filePrefix) && name.hasSuffix(".\(Self.fileExtension)")
        }
        .sorted { a, b in
            let da = (try? a.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            let db = (try? b.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            return da > db
        }

        guard logs.count > Self.maxRetainedFiles else { return }
        for stale in logs.suffix(from: Self.maxRetainedFiles) {
            try? fileManager.removeItem(at: stale)
        }
    }
}
