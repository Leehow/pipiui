import Foundation

/// Per-turn LLM token/usage record, serialized one-per-line to `pipiui-token-ledger.jsonl`.
///
/// Independent of `FileLogSink`: the ledger is machine-readable factual telemetry,
/// not subject to the level gate or daily rotation. Two producers feed it:
/// - main chat session: `ChatSession.handleEvent` `message_end` branch
/// - subagents: bridge `agent_event` with `kind == "usage"` (TS `index.ts` emits it)
///
/// All append entrypoints are safe to call from the main thread; disk I/O hops to a
/// private serial queue. Failures are best-effort (drop rather than crash), matching
/// `FileLogSink`.
final class TokenLedger: @unchecked Sendable {
    static let shared = TokenLedger()

    /// Soft cap on the active ledger file. On crossing it the current file is rolled
    /// to `.1` (single backup) and a fresh file starts. Keeps growth bounded while
    /// preserving the most recent window for analysis.
    public static let maxFileBytes = 50 * 1024 * 1024

    static let fileName = "pipiui-token-ledger.jsonl"
    static let rolledSuffix = ".1"

    private let baseDirectory: URL?
    private let queue: DispatchQueue
    private let fileManager: FileManager
    private let timestampFormatter: ISO8601DateFormatter
    /// Effective roll threshold; defaults to `maxFileBytes`. Injectable for tests.
    private let rollThreshold: UInt64

    private var currentHandle: FileHandle?
    private var currentURL: URL?
    private var currentByteCount: UInt64 = 0

    /// - Parameters:
    ///   - baseDirectory: Parent of the `PipiUI` logs folder. `nil` ⇒ follow
    ///     `PipiLogger.shared.logsDirectoryURL` lazily at first write (so the shared
    ///     instance resolves to the real logs dir even if constructed before bootstrap).
    ///   - queue: Serial queue used for async appends. Defaults to a private utility queue.
    ///   - fileManager: Injectable for tests.
    ///   - rollThresholdBytes: Override the active-file size cap (defaults to `maxFileBytes`).
    ///     Injectable so tests can trigger a roll without writing 50MB.
    init(
        baseDirectory: URL? = nil,
        queue: DispatchQueue? = nil,
        fileManager: FileManager = .default,
        rollThresholdBytes: UInt64? = nil
    ) {
        self.baseDirectory = baseDirectory
        self.fileManager = fileManager
        self.queue = queue ?? DispatchQueue(label: "com.leehow.pipiui.token-ledger", qos: .utility)
        self.rollThreshold = rollThresholdBytes ?? UInt64(Self.maxFileBytes)
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        self.timestampFormatter = f
    }

    /// Directory that holds the ledger file. Defaults to `PipiLogger`'s logs dir.
    var logsDirectoryURL: URL {
        if let baseDirectory {
            return baseDirectory.appendingPathComponent(FileLogSink.directoryName, isDirectory: true)
        }
        return PipiLogger.shared.logsDirectoryURL
    }

    /// Ledger file URL.
    var fileURL: URL {
        logsDirectoryURL.appendingPathComponent(Self.fileName, isDirectory: false)
    }

    /// Rolled backup file URL (active file path + `.1`).
    var rolledFileURL: URL {
        URL(fileURLWithPath: fileURL.path + Self.rolledSuffix)
    }

    // MARK: - Append

    /// Append a per-turn usage record. Never blocks the caller.
    func append(
        session: String,
        channel: String,
        agentId: String?,
        agentName: String?,
        depth: Int,
        model: String,
        turn: Int,
        usage: UsageSnapshot,
        tools: [String] = [],
        date: Date = Date()
    ) {
        let record = Record(
            ts: timestampFormatter.string(from: date),
            session: session,
            channel: channel,
            agentId: agentId,
            agentName: agentName,
            depth: depth,
            model: model,
            turn: turn,
            input: usage.input,
            output: usage.output,
            cacheRead: usage.cacheRead,
            cacheWrite: usage.cacheWrite,
            cost: usage.cost,
            contextTokens: usage.contextTokens,
            tools: tools
        )
        guard let data = record.toJSONLine() else { return }
        queue.async { [weak self] in
            self?.writeLine(data)
        }
    }

    /// Flush pending writes and close the handle. Mainly for tests / clean shutdown.
    func flushSync() {
        queue.sync { [weak self] in
            self?.synchronizeCurrentHandle()
        }
    }

    // MARK: - File I/O (queue-isolated)

    private func writeLine(_ data: Data) {
        ensureHandle(additionalBytes: UInt64(data.count))
        guard let handle = currentHandle else { return }
        do {
            try handle.write(contentsOf: data)
            currentByteCount += UInt64(data.count)
        } catch {
            closeCurrentHandle()
        }
    }

    private func ensureHandle(additionalBytes: UInt64) {
        if currentHandle == nil {
            openFile()
        }
        if currentByteCount + additionalBytes > rollThreshold {
            rollCurrentFile()
        }
    }

    private func openFile() {
        closeCurrentHandle()
        let dir = logsDirectoryURL
        do {
            try fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
        } catch {
            return
        }
        let url = fileURL
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
            currentByteCount = size
        } catch {
            currentHandle = nil
            currentURL = nil
            currentByteCount = 0
        }
    }

    private func rollCurrentFile() {
        guard let url = currentURL else {
            openFile()
            return
        }
        closeCurrentHandle()
        let rolled = URL(fileURLWithPath: url.path + Self.rolledSuffix)
        // Replace any previous backup so at most one `.1` is kept.
        try? fileManager.removeItem(at: rolled)
        try? fileManager.moveItem(at: url, to: rolled)
        openFile()
    }

    private func closeCurrentHandle() {
        synchronizeCurrentHandle()
        try? currentHandle?.close()
        currentHandle = nil
        currentURL = nil
        currentByteCount = 0
    }

    private func synchronizeCurrentHandle() {
        guard let handle = currentHandle else { return }
        try? handle.synchronize()
    }

    // MARK: - Record

    /// One ledger line. Field order is stable for human-readable diffs.
    struct Record {
        let ts: String
        let session: String
        let channel: String
        let agentId: String?
        let agentName: String?
        let depth: Int
        let model: String
        let turn: Int
        let input: Int
        let output: Int
        let cacheRead: Int
        let cacheWrite: Int
        let cost: Double
        let contextTokens: Int
        let tools: [String]

        /// Compact single-line JSON terminated by `\n`. Returns nil if encoding fails.
        func toJSONLine() -> Data? {
            var obj: [String: Any?] = [
                "ts": ts,
                "session": session,
                "channel": channel,
                "agentId": agentId,
                "agentName": agentName,
                "depth": depth,
                "model": model,
                "turn": turn,
                "input": input,
                "output": output,
                "cacheRead": cacheRead,
                "cacheWrite": cacheWrite,
                "cost": cost,
                "contextTokens": contextTokens,
            ]
            if !tools.isEmpty {
                obj["tools"] = tools
            }
            // Strip null values to keep lines short and consistent with `J`'s nil-vs-absent convention.
            let compacted = obj.compactMapValues { $0 }
            guard JSONSerialization.isValidJSONObject(compacted),
                  let data = try? JSONSerialization.data(withJSONObject: compacted, options: [.sortedKeys])
            else {
                return nil
            }
            return data + Data([0x0A]) // '\n'
        }
    }

    /// Unique tool names from assistant `content` blocks with `type == "toolCall"`, sorted.
    static func toolNames(from message: J) -> [String] {
        var names = Set<String>()
        for block in message["content"].array {
            guard block["type"].string == "toolCall",
                  let name = block["name"].string?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !name.isEmpty else { continue }
            names.insert(name)
        }
        return names.sorted()
    }
}

// MARK: - UsageSnapshot

extension TokenLedger {
    /// Lightweight per-turn usage breakdown. Built from `message.usage` payloads
    /// emitted by `pi` (same shape subagents already parse at `index.ts:1036`).
    struct UsageSnapshot {
        var input: Int = 0
        var output: Int = 0
        var cacheRead: Int = 0
        var cacheWrite: Int = 0
        var cost: Double = 0
        var contextTokens: Int = 0

        /// Build from a `J` accessor rooted at a `usage` object. Missing fields default to 0.
        static func from(_ j: J) -> UsageSnapshot {
            UsageSnapshot(
                input: j["input"].int ?? 0,
                output: j["output"].int ?? 0,
                cacheRead: j["cacheRead"].int ?? 0,
                cacheWrite: j["cacheWrite"].int ?? 0,
                cost: j["cost"].double
                    ?? j["cost"]["total"].double
                    ?? 0,
                contextTokens: j["totalTokens"].int ?? j["contextTokens"].int ?? 0
            )
        }
    }
}
