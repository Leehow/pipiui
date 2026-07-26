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
    static func candidates(
        projects: [URL],
        sessionsByProject: [String: [SessionMeta]],
        selectedProjectPath: String?,
        preferredSessionPath: String?,
        archivedPaths: Set<String>,
        limit: Int = SidebarListLimits.sessions
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

    private let byteBudget: Int
    private let queue: OperationQueue
    private let snapshotLoader: (String) -> SessionHistorySnapshot?
    private let lock = NSLock()
    private var entries: [String: CacheEntry] = [:]
    private var inFlight: Set<String> = []
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

    func preload(paths: [String]) {
        for path in paths {
            guard reserveLoad(path: path) else { continue }
            queue.addOperation { [weak self] in
                guard let self else { return }
                defer { self.finishLoad(path: path) }
                guard let current = SessionFileIdentity.current(path: path),
                      current.size <= self.byteBudget,
                      !self.contains(path: path, identity: current) else {
                    return
                }
                guard let snapshot = self.snapshotLoader(path) else { return }
                self.store(snapshot)
            }
        }
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

    private func reserveLoad(path: String) -> Bool {
        guard !path.isEmpty else { return false }
        lock.lock()
        defer { lock.unlock() }
        guard !inFlight.contains(path) else { return false }
        inFlight.insert(path)
        return true
    }

    private func contains(path: String, identity: SessionFileIdentity) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return entries[path]?.snapshot.identity == identity
    }

    private func finishLoad(path: String) {
        lock.lock()
        inFlight.remove(path)
        lock.unlock()
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
