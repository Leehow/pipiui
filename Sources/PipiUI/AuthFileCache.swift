import Foundation

/// Shared mtime-cached reader for small JSON auth files (`~/.pi/agent/auth.json`,
/// `~/.codex/auth.json`). Stamp-checks (mtime + size, like `AgentCatalog.directoryStamp`)
/// and re-reads only when the file changed, so quota/credential refreshes don't each
/// re-read the file from disk. Thread-safe: callers resolve from background Tasks.
enum AuthFileCache {
    private struct Entry {
        let modificationDate: Date?
        let size: Int
        let data: Data
    }

    private static var cache: [String: Entry] = [:]
    private static let lock = NSLock()

    /// Cached `Data(contentsOf:)`; `nil` when the file is missing/unreadable
    /// (same failure semantics the callers had before).
    static func data(for url: URL) -> Data? {
        let path = url.path
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: path) else {
            return nil
        }
        let mtime = attrs[.modificationDate] as? Date
        let size = (attrs[.size] as? Int) ?? -1

        lock.lock()
        if let hit = cache[path], hit.modificationDate == mtime, hit.size == size {
            lock.unlock()
            return hit.data
        }
        lock.unlock()

        guard let data = try? Data(contentsOf: url) else { return nil }
        lock.lock()
        cache[path] = Entry(modificationDate: mtime, size: size, data: data)
        lock.unlock()
        return data
    }

    /// Drop cached entries (tests / manual invalidation).
    static func invalidate() {
        lock.lock()
        cache.removeAll()
        lock.unlock()
    }
}
