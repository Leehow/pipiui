import Foundation

/// Cheap identity used to reject a preloaded snapshot after its JSONL changes.
struct SessionFileIdentity: Equatable {
    let path: String
    let modified: Date
    let size: Int

    static func current(path: String) -> SessionFileIdentity? {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: path),
              let modified = attributes[.modificationDate] as? Date,
              let number = attributes[.size] as? NSNumber else {
            return nil
        }
        return SessionFileIdentity(path: path, modified: modified, size: number.intValue)
    }
}

struct SessionHistorySnapshot: Equatable {
    let identity: SessionFileIdentity
    let transcript: InitialTranscriptBuild

    /// The source size is a conservative, cheap proxy for retained transcript memory.
    var approximateBytes: Int { max(1, identity.size) }
}

/// Pure candidate selection shared by launch preloading and focused tests.
enum SessionHistoryPreloadPlan {
    /// Product preload depth is intentionally independent from the sidebar's display cap.
    static let sessionsPerProject = 20

    static func readyProjects(
        _ projects: [URL],
        completedProjectPaths: Set<String>
    ) -> [URL] {
        projects.filter { completedProjectPaths.contains($0.path) }
    }

    static func candidates(
        projects: [URL],
        sessionsByProject: [String: [SessionMeta]],
        selectedProjectPath: String?,
        preferredSessionPath: String?,
        archivedPaths: Set<String>,
        limit: Int = SessionHistoryPreloadPlan.sessionsPerProject
    ) -> [String] {
        guard limit > 0 else { return [] }

        var byProject: [(path: String, sessions: [SessionMeta])] = projects.map { project in
            let visible = (sessionsByProject[project.path] ?? [])
                .filter { !archivedPaths.contains($0.path) }
            return (project.path, Array(visible.prefix(limit)))
        }
        // The selected project warms first; all projects still keep the same per-project cap.
        if let selectedProjectPath,
           let selectedIndex = byProject.firstIndex(where: { $0.path == selectedProjectPath }) {
            let selected = byProject.remove(at: selectedIndex)
            byProject.insert(selected, at: 0)
        }

        var ordered = byProject.flatMap { $0.sessions.map(\.path) }
        if let preferredSessionPath,
           let index = ordered.firstIndex(of: preferredSessionPath) {
            ordered.remove(at: index)
            ordered.insert(preferredSessionPath, at: 0)
        }

        var seen: Set<String> = []
        return ordered.filter { seen.insert($0).inserted }
    }
}

/// Thread-safe, bounded offline history cache. Preloading never constructs ChatSession/PiProcess.
final class SessionHistoryPreloader {
    static let defaultByteBudget = 256 * 1024 * 1024
    static let defaultMaxConcurrentLoads = 2

    private struct CacheEntry {
        let snapshot: SessionHistorySnapshot
        var lastAccess: UInt64
    }

    private struct InFlightLoad {
        let operation: BlockOperation
        var completions: [(SessionHistorySnapshot?) -> Void]
    }

    private let byteBudget: Int
    private let queue: OperationQueue
    private let snapshotLoader: (String) -> SessionHistorySnapshot?
    private let lock = NSLock()
    private var entries: [String: CacheEntry] = [:]
    private var inFlight: [String: InFlightLoad] = [:]
    private var totalBytes = 0
    private var accessCounter: UInt64 = 0

    init(
        byteBudget: Int = SessionHistoryPreloader.defaultByteBudget,
        maxConcurrentLoads: Int = SessionHistoryPreloader.defaultMaxConcurrentLoads,
        snapshotLoader: @escaping (String) -> SessionHistorySnapshot? = SessionHistoryParser.load(path:)
    ) {
        self.byteBudget = max(1, byteBudget)
        self.snapshotLoader = snapshotLoader
        queue = OperationQueue()
        queue.name = "PipiUI.SessionHistoryPreloader"
        queue.qualityOfService = .utility
        queue.maxConcurrentOperationCount = max(1, maxConcurrentLoads)
    }

    var maxConcurrentLoadCount: Int { queue.maxConcurrentOperationCount }

    func preload(
        paths: [String],
        queuePriority: Operation.QueuePriority = .normal
    ) {
        for path in paths {
            enqueue(
                path: path,
                queuePriority: queuePriority,
                qualityOfService: .utility,
                completion: nil
            )
        }
    }

    /// User-click path: reuse/promote an existing queued load, or enqueue one high-priority
    /// background parse. Every coalesced completion is delivered once on the main queue.
    func loadPrioritized(
        path: String,
        completion: @escaping (SessionHistorySnapshot?) -> Void
    ) {
        if let cached = snapshotIfCurrent(path: path) {
            DispatchQueue.main.async {
                completion(cached)
            }
            return
        }
        enqueue(
            path: path,
            queuePriority: .veryHigh,
            qualityOfService: .userInitiated,
            completion: completion
        )
    }

    /// Synchronous test/support hook; production launch work uses `preload(paths:)`.
    @discardableResult
    func loadNow(path: String) -> SessionHistorySnapshot? {
        guard let current = SessionFileIdentity.current(path: path),
              current.size <= byteBudget else {
            return nil
        }
        guard let snapshot = snapshotLoader(path) else { return nil }
        store(snapshot)
        return snapshot
    }

    /// Focused-test synchronization only; AppStore never waits for background preloads.
    func waitForAllLoads() {
        queue.waitUntilAllOperationsAreFinished()
    }

    /// Performs a cheap stat before returning; changed or deleted files are immediate misses.
    func snapshotIfCurrent(path: String) -> SessionHistorySnapshot? {
        guard let current = SessionFileIdentity.current(path: path) else {
            remove(path: path)
            return nil
        }
        lock.lock()
        defer { lock.unlock() }
        guard var entry = entries[path], entry.snapshot.identity == current else {
            if let stale = entries.removeValue(forKey: path) {
                totalBytes -= stale.snapshot.approximateBytes
            }
            return nil
        }
        accessCounter &+= 1
        entry.lastAccess = accessCounter
        entries[path] = entry
        return entry.snapshot
    }

    var cachedPaths: Set<String> {
        lock.lock()
        defer { lock.unlock() }
        return Set(entries.keys)
    }

    private func enqueue(
        path: String,
        queuePriority: Operation.QueuePriority,
        qualityOfService: QualityOfService,
        completion: ((SessionHistorySnapshot?) -> Void)?
    ) {
        guard !path.isEmpty else {
            if let completion {
                DispatchQueue.main.async { completion(nil) }
            }
            return
        }

        lock.lock()
        if var existing = inFlight[path] {
            if let completion {
                existing.completions.append(completion)
            }
            if Self.priorityRank(queuePriority) > Self.priorityRank(existing.operation.queuePriority) {
                existing.operation.queuePriority = queuePriority
            }
            if qualityOfService == .userInitiated {
                existing.operation.qualityOfService = .userInitiated
            }
            inFlight[path] = existing
            lock.unlock()
            return
        }

        let operation = BlockOperation()
        operation.queuePriority = queuePriority
        operation.qualityOfService = qualityOfService
        let completions = completion.map { [$0] } ?? []
        inFlight[path] = InFlightLoad(operation: operation, completions: completions)
        operation.addExecutionBlock { [weak self, weak operation] in
            guard let self, operation?.isCancelled != true else { return }
            let snapshot = self.loadSnapshotIfNeeded(path: path)
            self.finishLoad(path: path, snapshot: snapshot)
        }
        lock.unlock()
        queue.addOperation(operation)
    }

    private static func priorityRank(_ priority: Operation.QueuePriority) -> Int {
        switch priority {
        case .veryLow: return 0
        case .low: return 1
        case .normal: return 2
        case .high: return 3
        case .veryHigh: return 4
        @unknown default: return 2
        }
    }

    private func loadSnapshotIfNeeded(path: String) -> SessionHistorySnapshot? {
        guard let current = SessionFileIdentity.current(path: path),
              current.size <= byteBudget else {
            return nil
        }
        if let cached = cachedSnapshot(path: path, identity: current) {
            return cached
        }
        guard let snapshot = snapshotLoader(path) else { return nil }
        guard SessionFileIdentity.current(path: path) == snapshot.identity,
              snapshot.approximateBytes <= byteBudget else {
            return nil
        }
        store(snapshot)
        return snapshot
    }

    private func cachedSnapshot(
        path: String,
        identity: SessionFileIdentity
    ) -> SessionHistorySnapshot? {
        lock.lock()
        defer { lock.unlock() }
        guard var entry = entries[path], entry.snapshot.identity == identity else {
            return nil
        }
        accessCounter &+= 1
        entry.lastAccess = accessCounter
        entries[path] = entry
        return entry.snapshot
    }

    private func finishLoad(path: String, snapshot: SessionHistorySnapshot?) {
        lock.lock()
        let completions = inFlight.removeValue(forKey: path)?.completions ?? []
        lock.unlock()
        guard !completions.isEmpty else { return }
        DispatchQueue.main.async {
            for completion in completions {
                completion(snapshot)
            }
        }
    }

    private func store(_ snapshot: SessionHistorySnapshot) {
        // A write during parsing invalidates the result instead of publishing a torn snapshot.
        guard SessionFileIdentity.current(path: snapshot.identity.path) == snapshot.identity,
              snapshot.approximateBytes <= byteBudget else {
            return
        }

        lock.lock()
        defer { lock.unlock() }
        if let previous = entries.removeValue(forKey: snapshot.identity.path) {
            totalBytes -= previous.snapshot.approximateBytes
        }
        accessCounter &+= 1
        entries[snapshot.identity.path] = CacheEntry(
            snapshot: snapshot,
            lastAccess: accessCounter
        )
        totalBytes += snapshot.approximateBytes

        while totalBytes > byteBudget,
              let victim = entries.min(by: { $0.value.lastAccess < $1.value.lastAccess }) {
            entries.removeValue(forKey: victim.key)
            totalBytes -= victim.value.snapshot.approximateBytes
        }
    }

    private func remove(path: String) {
        lock.lock()
        if let removed = entries.removeValue(forKey: path) {
            totalBytes -= removed.snapshot.approximateBytes
        }
        lock.unlock()
    }
}

enum SessionHistoryParser {
    private struct Entry {
        let id: String
        let parentId: String?
        let type: String
        let message: [String: Any]?
    }

    static func load(path: String) -> SessionHistorySnapshot? {
        guard let before = SessionFileIdentity.current(path: path),
              let handle = try? FileHandle(forReadingFrom: URL(fileURLWithPath: path)) else {
            return nil
        }
        defer { try? handle.close() }

        var entriesById: [String: Entry] = [:]
        var leafId: String?
        var buffer = Data()

        func consume(_ line: Data) {
            guard !line.isEmpty,
                  let raw = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
                  let id = raw["id"] as? String else {
                return
            }
            let type = raw["type"] as? String ?? ""
            let entry = Entry(
                id: id,
                parentId: raw["parentId"] as? String,
                type: type,
                message: type == "message"
                    ? sanitizedMessage(raw["message"] as? [String: Any])
                    : nil
            )
            entriesById[id] = entry
            leafId = id
        }

        do {
            while let chunk = try handle.read(upToCount: 256 * 1024), !chunk.isEmpty {
                buffer.append(chunk)
                var start = buffer.startIndex
                while let newline = buffer[start...].firstIndex(of: 0x0A) {
                    consume(Data(buffer[start..<newline]))
                    start = buffer.index(after: newline)
                }
                if start > buffer.startIndex {
                    buffer.removeSubrange(buffer.startIndex..<start)
                }
            }
            consume(buffer)
        } catch {
            return nil
        }

        guard SessionFileIdentity.current(path: path) == before else { return nil }

        var chain: [Entry] = []
        var current = leafId
        var visited: Set<String> = []
        while let id = current,
              let entry = entriesById[id],
              visited.insert(id).inserted,
              visited.count < 100_000 {
            chain.append(entry)
            current = entry.parentId
        }
        let activeEntries = Array(chain.reversed())
        let messages = activeEntries.compactMap { entry -> J? in
            guard entry.type == "message", let message = entry.message else { return nil }
            return J(message)
        }
        var built = ChatSession.buildTranscript(from: messages, loadImageData: false)

        let activeJSONEntries = activeEntries.map { entry -> J in
            var raw: [String: Any] = [
                "type": entry.type,
                "id": entry.id,
            ]
            if let parentId = entry.parentId {
                raw["parentId"] = parentId
            }
            if let message = entry.message {
                raw["message"] = message
            }
            return J(raw)
        }
        let branchMessages = MessageActions.activeBranchMessages(
            entries: activeJSONEntries,
            leafId: leafId
        )
        built.items = MessageActions.applyingEntryIds(
            items: built.items,
            branchMessages: branchMessages
        )
        return SessionHistorySnapshot(identity: before, transcript: built)
    }

    /// Preview snapshots intentionally omit image blocks. Authoritative get_messages restores
    /// them shortly after click without retaining/decoding large base64 payloads at launch.
    private static func sanitizedMessage(_ message: [String: Any]?) -> [String: Any]? {
        guard let message, let role = message["role"] as? String else { return nil }
        var sanitized: [String: Any] = ["role": role]
        if let text = message["content"] as? String {
            sanitized["content"] = text
        } else if let blocks = message["content"] as? [[String: Any]] {
            sanitized["content"] = blocks.compactMap { block -> [String: Any]? in
                switch block["type"] as? String {
                case "text":
                    return ["type": "text", "text": block["text"] as? String ?? ""]
                case "thinking":
                    // Drop large provider signatures; transcript conversion only consumes text.
                    return [
                        "type": "thinking",
                        "thinking": block["thinking"] as? String ?? "",
                    ]
                case "toolCall":
                    var kept: [String: Any] = [
                        "type": "toolCall",
                        "id": block["id"] as? String ?? "",
                        "name": block["name"] as? String ?? "tool",
                    ]
                    if let arguments = block["arguments"] {
                        kept["arguments"] = arguments
                    }
                    return kept
                default:
                    // Images and unsupported blocks are restored by authoritative get_messages.
                    return nil
                }
            }
        } else {
            sanitized["content"] = []
        }
        for key in ["toolCallId", "isError", "command", "output"] {
            if let value = message[key] {
                sanitized[key] = value
            }
        }
        return sanitized
    }
}
