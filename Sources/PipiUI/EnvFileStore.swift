import Foundation

/// EnvFileStore — read/write/cache for `~/.pi/agent/.env`.
///
/// Responsibilities:
/// - Parse a standard dotenv subset: `KEY=VALUE` lines, `#` comment lines,
///   blank lines, optional single/double quotes around values.
/// - Round-trip writes preserve comments, blank lines and original ordering:
///   changing a value rewrites only that entry line, never touches comments.
/// - Writes are atomic (temp file + rename) and enforce `0600` permissions
///   (new files are created `0600`; existing files are corrected to `0600`).
/// - In-memory cache invalidated by file mtime so external edits are noticed.
/// - All writes run on a serial queue; completions are delivered on main.
/// - Reads are served from the cache (with mtime revalidation).
///
/// Consumers: subprocess environment injection, Settings UI "is key
/// configured" queries, quota-module fallback lookups.
public final class EnvFileStore {

    /// Default location: `~/.pi/agent/.env`.
    public static var defaultURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".pi", isDirectory: true)
            .appendingPathComponent("agent", isDirectory: true)
            .appendingPathComponent(".env", isDirectory: false)
    }

    public let fileURL: URL

    /// Injectable clock for tests (mtime comparisons).
    var now: () -> Date = { Date() }

    // MARK: - Parsed model

    private enum Line {
        /// Blank line, comment line, or anything unparseable — kept verbatim.
        case raw(String)
        /// Placeholder for a removed/duplicate-collapsed entry — dropped at render.
        case deleted
        /// A `KEY=VALUE` entry. `quote` is the original quoting character
        /// (`"` or `'`) or nil if unquoted.
        case entry(key: String, value: String, quote: Character?)
    }

    // MARK: - Cache state (guarded by `lock`)

    private let lock = NSLock()
    private var cachedLines: [Line]?
    private var cachedValues: [String: String] = [:]
    private var cachedMTime: Date?

    /// Serial queue for all mutations of the on-disk file.
    private let writeQueue = DispatchQueue(label: "pipiui.EnvFileStore.write")

    public init(fileURL: URL = EnvFileStore.defaultURL) {
        self.fileURL = fileURL
    }

    // MARK: - Public read API

    /// All key/value pairs (cache-backed, mtime-revalidated).
    public func all() -> [String: String] {
        revalidateIfNeeded()
        lock.lock()
        defer { lock.unlock() }
        return cachedValues
    }

    /// Value for a key, or nil if absent/empty file.
    public func value(forKey key: String) -> String? {
        all()[key]
    }

    /// True when the key exists with a non-empty value.
    public func isConfigured(forKey key: String) -> Bool {
        guard let v = value(forKey: key) else { return false }
        return !v.isEmpty
    }

    // MARK: - Public write API

    /// Synchronously set a key (blocks until written). Safe to call from any
    /// thread; work is funneled through the serial write queue.
    public func setSync(_ value: String, forKey key: String) throws {
        try performWriteSync { lines in
            Self.upsert(lines: &lines, key: key, value: value)
        }
    }

    /// Synchronously remove a key (blocks until written).
    @discardableResult
    public func removeSync(forKey key: String) throws -> Bool {
        var removed = false
        try performWriteSync { lines in
            removed = Self.remove(lines: &lines, key: key)
        }
        return removed
    }

    /// Async set: runs on the serial write queue, completion on main.
    public func set(_ value: String, forKey key: String,
                    completion: ((Result<Void, Error>) -> Void)? = nil) {
        writeQueue.async {
            do {
                try self.performWriteLocked { lines in
                    Self.upsert(lines: &lines, key: key, value: value)
                }
                DispatchQueue.main.async { completion?(.success(())) }
            } catch {
                DispatchQueue.main.async { completion?(.failure(error)) }
            }
        }
    }

    /// Async remove: runs on the serial write queue, completion on main.
    public func remove(forKey key: String,
                       completion: ((Result<Bool, Error>) -> Void)? = nil) {
        writeQueue.async {
            do {
                var removed = false
                try self.performWriteLocked { lines in
                    removed = Self.remove(lines: &lines, key: key)
                }
                DispatchQueue.main.async { completion?(.success(removed)) }
            } catch {
                DispatchQueue.main.async { completion?(.failure(error)) }
            }
        }
    }

    // MARK: - Write plumbing

    private func performWriteSync(_ mutate: (inout [Line]) -> Void) throws {
        try writeQueue.sync {
            try performWriteLocked(mutate)
        }
    }

    /// Must be called on `writeQueue` (or under its serial guarantee).
    private func performWriteLocked(_ mutate: (inout [Line]) -> Void) throws {
        // Read fresh from disk inside the write queue to avoid lost updates
        // racing external processes between our read-cache and the write.
        var lines = Self.parse(Self.readFile(fileURL) ?? "")
        mutate(&lines)
        let text = Self.render(lines)
        try Self.writeAtomically(text, to: fileURL)
        // Update cache to exactly what we wrote.
        let attrs = try? FileManager.default.attributesOfItem(atPath: fileURL.path)
        lock.lock()
        cachedLines = lines
        cachedValues = Self.values(from: lines)
        cachedMTime = attrs?[.modificationDate] as? Date
        lock.unlock()
    }

    // MARK: - Cache revalidation

    private func revalidateIfNeeded() {
        let fm = FileManager.default
        let attrs = try? fm.attributesOfItem(atPath: fileURL.path)
        let mtime = attrs?[.modificationDate] as? Date

        lock.lock()
        let cached = cachedLines
        let cachedStamp = cachedMTime
        lock.unlock()

        if cached != nil, cachedStamp != nil, mtime != nil, cachedStamp == mtime {
            return // cache fresh
        }
        if cached != nil, cachedStamp == nil, mtime == nil {
            return // file missing and cache reflects that
        }

        // (Re)parse from disk.
        let text = Self.readFile(fileURL)
        let lines = Self.parse(text ?? "")
        let values = Self.values(from: lines)
        lock.lock()
        // Only overwrite if the file state we just read is still newer/unknown;
        // writers always set the cache last under lock, so last-write-wins is fine.
        cachedLines = lines
        cachedValues = values
        cachedMTime = mtime
        lock.unlock()
    }

    // MARK: - Parsing

    private static func readFile(_ url: URL) -> String? {
        guard let data = FileManager.default.contents(atPath: url.path) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func parse(_ text: String) -> [Line] {
        var lines: [Line] = []
        // split preserving empty trailing content is unnecessary; omitting
        // empty subsequences drops nothing meaningful since we re-render.
        for rawSub in text.split(separator: "\n", omittingEmptySubsequences: false) {
            var raw = String(rawSub)
            if raw.hasSuffix("\r") { raw.removeLast() }
            let trimmed = raw.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty || trimmed.hasPrefix("#") {
                lines.append(.raw(raw))
                continue
            }
            guard let eq = raw.firstIndex(of: "=") else {
                lines.append(.raw(raw))
                continue
            }
            let key = raw[..<eq].trimmingCharacters(in: .whitespaces)
            guard !key.isEmpty,
                  key.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "_" }),
                  key.first?.isNumber == false else {
                lines.append(.raw(raw))
                continue
            }
            var value = String(raw[raw.index(after: eq)...])
                .trimmingCharacters(in: .whitespaces)
            var quote: Character? = nil
            if value.count >= 2, let f = value.first, let l = value.last,
               (f == "\"" || f == "'"), l == f {
                quote = f
                value = String(value.dropFirst().dropLast())
            }
            lines.append(.entry(key: key, value: value, quote: quote))
        }
        return lines
    }

    private static func values(from lines: [Line]) -> [String: String] {
        var dict: [String: String] = [:]
        for line in lines {
            if case let .entry(key, value, _) = line {
                dict[key] = value // later duplicates win, matching shell behavior
            }
        }
        return dict
    }

    // MARK: - Mutation helpers

    private static func upsert(lines: inout [Line], key: String, value: String) {
        var found = false
        for i in lines.indices {
            if case let .entry(k, _, quote) = lines[i], k == key {
                if !found {
                    lines[i] = .entry(key: key, value: value, quote: quote)
                    found = true
                } else {
                    lines[i] = .deleted // collapse duplicates
                }
            }
        }
        if !found {
            // Don't append after trailing blank lines of the file.
            while case .raw("")? = lines.last { lines.removeLast() }
            lines.append(.entry(key: key, value: value, quote: nil))
        }
    }

    private static func remove(lines: inout [Line], key: String) -> Bool {
        var removed = false
        for i in lines.indices {
            if case let .entry(k, _, _) = lines[i], k == key {
                lines[i] = .deleted
                removed = true
            }
        }
        return removed
    }

    // MARK: - Rendering

    private static func render(_ lines: [Line]) -> String {
        var out = lines.compactMap { line -> String? in
            switch line {
            case .deleted: return nil
            case .raw(let s): return s
            case .entry(let key, let value, let quote):
                return "\(key)=\(formatValue(value, preferredQuote: quote))"
            }
        }
        // Trim trailing blank lines, keep single trailing newline.
        while out.last?.isEmpty == true { out.removeLast() }
        return out.joined(separator: "\n") + "\n"
    }

    private static func formatValue(_ value: String, preferredQuote: Character?) -> String {
        if value.isEmpty { return "\"\"" }
        let needsQuote = value.contains(where: {
            $0 == " " || $0 == "\t" || $0 == "#" || $0 == "\"" || $0 == "'"
        })
        if let q = preferredQuote {
            // Preserve original quoting style when possible.
            if q == "'", !value.contains("'") {
                return "'\(value)'"
            }
            if q == "\"", !value.contains("\"") {
                return "\"\(value)\""
            }
        }
        if needsQuote {
            let escaped = value.replacingOccurrences(of: "\"", with: "\\\"")
            return "\"\(escaped)\""
        }
        return value
    }

    // MARK: - Atomic write + permissions

    private static func writeAtomically(_ text: String, to url: URL) throws {
        let fm = FileManager.default
        let dir = url.deletingLastPathComponent()
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)

        let tmp = dir.appendingPathComponent(".\(url.lastPathComponent).tmp-\(UUID().uuidString)")
        let data = Data(text.utf8)
        // Create temp with 0600 from the start.
        guard fm.createFile(atPath: tmp.path, contents: data,
                            attributes: [.posixPermissions: 0o600]) else {
            throw CocoaError(.fileWriteUnknown)
        }
        defer { try? fm.removeItem(at: tmp) }

        if fm.fileExists(atPath: url.path) {
            _ = try fm.replaceItemAt(url, withItemAt: tmp)
            // replaceItemAt keeps dest file; enforce 0600 afterwards.
            try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        } else {
            try fm.moveItem(at: tmp, to: url)
            try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        }
    }
}
