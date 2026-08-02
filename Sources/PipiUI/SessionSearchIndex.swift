import Foundation
import SQLite3

struct SessionSearchSource: Hashable, Sendable {
    let projectPath: String
    let projectName: String
    let sessionPath: String
    let title: String
    let modified: Date
    let isArchived: Bool
}

struct SessionSearchLiveSource: Hashable, Sendable {
    let projectPath: String
    let projectName: String
    let key: String
    let title: String
}

enum SessionSearchIndexError: LocalizedError {
    case database(String)

    var errorDescription: String? {
        switch self {
        case .database(let detail): return "会话搜索索引不可用：\(detail)"
        }
    }
}

/// Rebuildable derived index for Pi JSONL sessions. All calls are actor-isolated
/// so SQLite work never runs on the main actor and a single database connection
/// is never used concurrently.
actor SessionSearchIndex {
    static let shared = SessionSearchIndex()
    static let schemaVersion: Int32 = 2
    static let resultCap = 50

    private static let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    private let databaseURL: URL

    init(databaseURL: URL = SessionSearchIndex.defaultDatabaseURL) {
        self.databaseURL = databaseURL
    }

    static var defaultDatabaseURL: URL {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        return root
            .appendingPathComponent("PipiUI", isDirectory: true)
            .appendingPathComponent("Search", isDirectory: true)
            .appendingPathComponent("session-search-v1.sqlite3")
    }

    /// Brings the derived database in sync with the caller's complete source
    /// snapshot. Missing paths are deleted; unchanged files only refresh
    /// metadata; append-only files resume at the last newline boundary.
    func synchronize(sources: [SessionSearchSource]) throws {
        try withRecoveringDatabase { db in
            try Self.exec(db, "BEGIN IMMEDIATE")
            do {
                let unique = Dictionary(sources.map { ($0.sessionPath, $0) }, uniquingKeysWith: { _, newer in newer })
                let currentPaths = Set(unique.keys)
                for path in try Self.indexedPaths(db) where !currentPaths.contains(path) {
                    try Self.removeSession(path: path, db: db)
                }
                for source in unique.values.sorted(by: { $0.sessionPath < $1.sessionPath }) {
                    if Task.isCancelled { throw CancellationError() }
                    try Self.synchronize(source: source, db: db)
                }
                try Self.exec(db, "COMMIT")
            } catch {
                try? Self.exec(db, "ROLLBACK")
                throw error
            }
        }
    }

    func search(query: String, projectPath: String? = nil) throws -> [SessionSearchHit] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }
        return try withRecoveringDatabase { db in
            var hits = try Self.searchMetadata(db: db, query: trimmed, projectPath: projectPath)
            let remaining = max(0, Self.resultCap - hits.count)
            if remaining > 0 {
                hits.append(contentsOf: try Self.searchMessages(
                    db: db,
                    query: trimmed,
                    projectPath: projectPath,
                    limit: remaining
                ))
            }
            return Array(hits.prefix(Self.resultCap))
        }
    }

    /// Test/repair hook. Production callers normally rely on automatic schema
    /// validation and corruption recovery in `withRecoveringDatabase`.
    func rebuild() throws {
        try Self.removeDatabaseFiles(at: databaseURL)
        let db = try openDatabase()
        sqlite3_close(db)
        securePermissions()
    }

    // MARK: - Database lifecycle

    private func withRecoveringDatabase<T>(_ body: (OpaquePointer) throws -> T) throws -> T {
        do {
            let db = try openDatabase()
            defer {
                securePermissions()
                sqlite3_close(db)
            }
            return try body(db)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            // The index is disposable. One clean rebuild handles corrupt files,
            // stale WAL state, and incompatible schemas without touching JSONL.
            try? Self.removeDatabaseFiles(at: databaseURL)
            let db = try openDatabase()
            defer {
                securePermissions()
                sqlite3_close(db)
            }
            return try body(db)
        }
    }

    private func openDatabase() throws -> OpaquePointer {
        try FileManager.default.createDirectory(
            at: databaseURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        var db: OpaquePointer?
        let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX
        guard sqlite3_open_v2(databaseURL.path, &db, flags, nil) == SQLITE_OK, let db else {
            let detail = db.flatMap { String(cString: sqlite3_errmsg($0)) } ?? "open failed"
            if let db { sqlite3_close(db) }
            throw SessionSearchIndexError.database(detail)
        }
        do {
            try Self.exec(db, "PRAGMA journal_mode=WAL")
            try Self.exec(db, "PRAGMA synchronous=NORMAL")
            try Self.ensureSchema(db)
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: databaseURL.path)
            return db
        } catch {
            sqlite3_close(db)
            throw error
        }
    }

    private static func ensureSchema(_ db: OpaquePointer) throws {
        let version = try scalarInt(db, sql: "PRAGMA user_version")
        guard version == 0 || version == schemaVersion else {
            throw SessionSearchIndexError.database("schema version \(version) is incompatible")
        }
        try exec(db, """
            CREATE TABLE IF NOT EXISTS sessions (
                path TEXT PRIMARY KEY,
                project_path TEXT NOT NULL,
                project_name TEXT NOT NULL,
                title TEXT NOT NULL,
                modified REAL NOT NULL,
                archived INTEGER NOT NULL,
                file_size INTEGER NOT NULL,
                file_mtime REAL NOT NULL,
                file_device INTEGER NOT NULL,
                file_inode INTEGER NOT NULL,
                complete_offset INTEGER NOT NULL,
                anchor_head BLOB NOT NULL,
                anchor_tail BLOB NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
                rowid INTEGER PRIMARY KEY,
                session_path TEXT NOT NULL,
                line_offset INTEGER NOT NULL,
                message_id TEXT,
                role TEXT NOT NULL,
                timestamp REAL,
                text TEXT NOT NULL,
                UNIQUE(session_path, line_offset)
            );
            CREATE INDEX IF NOT EXISTS messages_session_path ON messages(session_path);
            CREATE VIRTUAL TABLE IF NOT EXISTS message_fts_unicode
                USING fts5(text, tokenize='unicode61 remove_diacritics 2');
            CREATE VIRTUAL TABLE IF NOT EXISTS message_fts_trigram
                USING fts5(text, tokenize='trigram');
            PRAGMA user_version = 2;
            """)
    }

    private static func removeDatabaseFiles(at url: URL) throws {
        let fm = FileManager.default
        for suffix in ["", "-wal", "-shm"] {
            let path = url.path + suffix
            if fm.fileExists(atPath: path) { try fm.removeItem(atPath: path) }
        }
    }

    // MARK: - Incremental indexing

    private struct FileState {
        let size: Int64
        let mtime: Double
        let device: UInt64
        let inode: UInt64
        let completeOffset: UInt64
        let anchorHead: Data
        let anchorTail: Data
    }

    private struct AnchorBytes {
        let head: Data
        let tail: Data
    }

    private static func synchronize(source: SessionSearchSource, db: OpaquePointer) throws {
        let url = URL(fileURLWithPath: source.sessionPath)
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: source.sessionPath),
              let fileSize = (attrs[.size] as? NSNumber)?.int64Value,
              let modified = attrs[.modificationDate] as? Date
        else {
            try removeSession(path: source.sessionPath, db: db)
            return
        }
        let device = (attrs[.systemNumber] as? NSNumber)?.uint64Value ?? 0
        let inode = (attrs[.systemFileNumber] as? NSNumber)?.uint64Value ?? 0
        let old = try fileState(path: source.sessionPath, db: db)

        var startOffset: UInt64 = 0
        if let old,
           old.device == device,
           old.inode == inode,
           fileSize >= old.size,
           UInt64(fileSize) >= old.completeOffset {
            if fileSize == old.size && modified.timeIntervalSince1970 == old.mtime {
                try upsertSession(source: source, size: fileSize, mtime: modified, device: device, inode: inode,
                                  completeOffset: old.completeOffset, anchors: AnchorBytes(
                                      head: old.anchorHead,
                                      tail: old.anchorTail
                                  ), db: db)
                return
            }
            if fileSize > old.size,
               try anchorsMatch(file: url, completeOffset: old.completeOffset, state: old) {
                startOffset = old.completeOffset
            } else {
                try removeMessages(sessionPath: source.sessionPath, db: db)
            }
        } else if old != nil {
            try removeMessages(sessionPath: source.sessionPath, db: db)
        }

        let completeOffset = try indexCompleteLines(file: url, from: startOffset, db: db)
        let anchors = try anchorBytes(file: url, completeOffset: completeOffset)
        try upsertSession(
            source: source,
            size: fileSize,
            mtime: modified,
            device: device,
            inode: inode,
            completeOffset: completeOffset,
            anchors: anchors,
            db: db
        )
    }

    /// Exact bounded byte windows from both ends of the already-indexed
    /// prefix. They reject in-place rewrites without rehashing an unbounded
    /// history on every append.
    private static func anchorBytes(file: URL, completeOffset: UInt64) throws -> AnchorBytes {
        guard completeOffset > 0 else { return AnchorBytes(head: Data(), tail: Data()) }
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }
        let headLength = Int(min(2 * 1024, completeOffset))
        try handle.seek(toOffset: 0)
        let head = try handle.read(upToCount: headLength) ?? Data()
        let tailLength = Int(min(4 * 1024, completeOffset))
        try handle.seek(toOffset: completeOffset - UInt64(tailLength))
        let tail = try handle.read(upToCount: tailLength) ?? Data()
        guard head.count == headLength, tail.count == tailLength else {
            throw SessionSearchIndexError.database("session changed while indexing")
        }
        return AnchorBytes(head: head, tail: tail)
    }

    private static func anchorsMatch(file: URL, completeOffset: UInt64, state: FileState) throws -> Bool {
        let current = try anchorBytes(file: file, completeOffset: completeOffset)
        return current.head == state.anchorHead && current.tail == state.anchorTail
    }

    private static func indexCompleteLines(file: URL, from offset: UInt64, db: OpaquePointer) throws -> UInt64 {
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }
        try handle.seek(toOffset: offset)
        var pending = Data()
        var pendingStart = offset

        while true {
            if Task.isCancelled { throw CancellationError() }
            guard let chunk = try handle.read(upToCount: 64 * 1024), !chunk.isEmpty else { break }
            pending.append(chunk)
            while let newline = pending.firstIndex(of: 0x0A) {
                let length = pending.distance(from: pending.startIndex, to: newline)
                let line = pending.subdata(in: 0..<length)
                try indexLine(line, sessionPath: file.path, lineOffset: pendingStart, db: db)
                let consumed = UInt64(length + 1)
                pending = pending.subdata(in: (length + 1)..<pending.count)
                pendingStart += consumed
            }
        }
        // pendingStart is deliberately before a trailing partial JSONL line.
        return pendingStart
    }

    private static func indexLine(_ data: Data, sessionPath: String, lineOffset: UInt64, db: OpaquePointer) throws {
        guard !data.isEmpty,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              object["type"] as? String == "message",
              let message = object["message"] as? [String: Any],
              let role = message["role"] as? String,
              role == "user" || role == "assistant"
        else { return }
        let text = SessionSearch.contentText(message["content"])
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        let timestamp = parseTimestamp(object: object, message: message)?.timeIntervalSince1970
        let statement = try prepare(db, """
            INSERT OR IGNORE INTO messages(session_path, line_offset, message_id, role, timestamp, text)
            VALUES(?, ?, ?, ?, ?, ?)
            """)
        defer { sqlite3_finalize(statement) }
        bindText(statement, 1, sessionPath)
        sqlite3_bind_int64(statement, 2, Int64(lineOffset))
        bindOptionalText(statement, 3, object["id"] as? String)
        bindText(statement, 4, role)
        if let timestamp { sqlite3_bind_double(statement, 5, timestamp) } else { sqlite3_bind_null(statement, 5) }
        bindText(statement, 6, text)
        try stepDone(statement, db: db)
        guard sqlite3_changes(db) > 0 else { return }
        let rowID = sqlite3_last_insert_rowid(db)
        try insertFTS(db, table: "message_fts_unicode", rowID: rowID, text: text)
        try insertFTS(db, table: "message_fts_trigram", rowID: rowID, text: text)
    }

    private static func parseTimestamp(object: [String: Any], message: [String: Any]) -> Date? {
        if let milliseconds = message["timestamp"] as? NSNumber {
            return Date(timeIntervalSince1970: milliseconds.doubleValue / 1000)
        }
        guard let raw = object["timestamp"] as? String else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
    }

    private static func upsertSession(
        source: SessionSearchSource,
        size: Int64,
        mtime: Date,
        device: UInt64,
        inode: UInt64,
        completeOffset: UInt64,
        anchors: AnchorBytes,
        db: OpaquePointer
    ) throws {
        let statement = try prepare(db, """
            INSERT INTO sessions(path, project_path, project_name, title, modified, archived,
                                 file_size, file_mtime, file_device, file_inode, complete_offset,
                                 anchor_head, anchor_tail)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(path) DO UPDATE SET
                project_path=excluded.project_path, project_name=excluded.project_name,
                title=excluded.title, modified=excluded.modified, archived=excluded.archived,
                file_size=excluded.file_size, file_mtime=excluded.file_mtime,
                file_device=excluded.file_device, file_inode=excluded.file_inode,
                complete_offset=excluded.complete_offset,
                anchor_head=excluded.anchor_head, anchor_tail=excluded.anchor_tail
            """)
        defer { sqlite3_finalize(statement) }
        bindText(statement, 1, source.sessionPath)
        bindText(statement, 2, source.projectPath)
        bindText(statement, 3, source.projectName)
        bindText(statement, 4, source.title)
        sqlite3_bind_double(statement, 5, source.modified.timeIntervalSince1970)
        sqlite3_bind_int(statement, 6, source.isArchived ? 1 : 0)
        sqlite3_bind_int64(statement, 7, size)
        sqlite3_bind_double(statement, 8, mtime.timeIntervalSince1970)
        sqlite3_bind_int64(statement, 9, Int64(bitPattern: device))
        sqlite3_bind_int64(statement, 10, Int64(bitPattern: inode))
        sqlite3_bind_int64(statement, 11, Int64(completeOffset))
        bindData(statement, 12, anchors.head)
        bindData(statement, 13, anchors.tail)
        try stepDone(statement, db: db)
    }

    private static func fileState(path: String, db: OpaquePointer) throws -> FileState? {
        let statement = try prepare(db, """
            SELECT file_size, file_mtime, file_device, file_inode, complete_offset,
                   anchor_head, anchor_tail
            FROM sessions WHERE path=?
            """)
        defer { sqlite3_finalize(statement) }
        bindText(statement, 1, path)
        let rc = sqlite3_step(statement)
        if rc == SQLITE_DONE { return nil }
        guard rc == SQLITE_ROW else { throw databaseError(db) }
        return FileState(
            size: sqlite3_column_int64(statement, 0),
            mtime: sqlite3_column_double(statement, 1),
            device: UInt64(bitPattern: sqlite3_column_int64(statement, 2)),
            inode: UInt64(bitPattern: sqlite3_column_int64(statement, 3)),
            completeOffset: UInt64(sqlite3_column_int64(statement, 4)),
            anchorHead: columnData(statement, 5),
            anchorTail: columnData(statement, 6)
        )
    }

    private static func indexedPaths(_ db: OpaquePointer) throws -> [String] {
        let statement = try prepare(db, "SELECT path FROM sessions")
        defer { sqlite3_finalize(statement) }
        var paths: [String] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            if let value = sqlite3_column_text(statement, 0) { paths.append(String(cString: value)) }
        }
        return paths
    }

    private static func removeSession(path: String, db: OpaquePointer) throws {
        try removeMessages(sessionPath: path, db: db)
        let statement = try prepare(db, "DELETE FROM sessions WHERE path=?")
        defer { sqlite3_finalize(statement) }
        bindText(statement, 1, path)
        try stepDone(statement, db: db)
    }

    private static func removeMessages(sessionPath: String, db: OpaquePointer) throws {
        let ids = try messageRowIDs(sessionPath: sessionPath, db: db)
        for id in ids {
            for table in ["message_fts_unicode", "message_fts_trigram"] {
                try deleteFTSRow(db, table: table, rowID: id)
            }
        }
        let statement = try prepare(db, "DELETE FROM messages WHERE session_path=?")
        defer { sqlite3_finalize(statement) }
        bindText(statement, 1, sessionPath)
        try stepDone(statement, db: db)
    }

    private static func deleteFTSRow(_ db: OpaquePointer, table: String, rowID: Int64) throws {
        let statement = try prepare(db, "DELETE FROM \(table) WHERE rowid=?")
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_int64(statement, 1, rowID)
        try stepDone(statement, db: db)
    }

    private static func messageRowIDs(sessionPath: String, db: OpaquePointer) throws -> [Int64] {
        let statement = try prepare(db, "SELECT rowid FROM messages WHERE session_path=?")
        defer { sqlite3_finalize(statement) }
        bindText(statement, 1, sessionPath)
        var ids: [Int64] = []
        while sqlite3_step(statement) == SQLITE_ROW { ids.append(sqlite3_column_int64(statement, 0)) }
        return ids
    }

    private static func insertFTS(_ db: OpaquePointer, table: String, rowID: Int64, text: String) throws {
        let statement = try prepare(db, "INSERT INTO \(table)(rowid, text) VALUES(?, ?)")
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_int64(statement, 1, rowID)
        bindText(statement, 2, text)
        try stepDone(statement, db: db)
    }

    // MARK: - Queries

    private static func searchMetadata(db: OpaquePointer, query: String, projectPath: String?) throws -> [SessionSearchHit] {
        let sql = """
            SELECT path, project_path, project_name, title, modified, archived
            FROM sessions
            WHERE (? IS NULL OR project_path = ?)
              AND (title LIKE ? ESCAPE '\\' COLLATE NOCASE
                   OR project_name LIKE ? ESCAPE '\\' COLLATE NOCASE
                   OR project_path LIKE ? ESCAPE '\\' COLLATE NOCASE)
            ORDER BY modified DESC, path ASC
            LIMIT ?
            """
        let statement = try prepare(db, sql)
        defer { sqlite3_finalize(statement) }
        bindOptionalText(statement, 1, projectPath)
        bindOptionalText(statement, 2, projectPath)
        let like = "%" + escapeLike(query) + "%"
        bindText(statement, 3, like)
        bindText(statement, 4, like)
        bindText(statement, 5, like)
        sqlite3_bind_int(statement, 6, Int32(resultCap))
        var hits: [SessionSearchHit] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            hits.append(sessionHit(statement, snippet: nil, titleMatch: true))
        }
        return hits
    }

    private static func searchMessages(
        db: OpaquePointer,
        query: String,
        projectPath: String?,
        limit: Int
    ) throws -> [SessionSearchHit] {
        let compact = query.filter { !$0.isWhitespace }
        let tokens = query.split { character in
            !character.isLetter && !character.isNumber
        }
        if tokens.isEmpty || compact.count < 3 {
            return try searchMessagesLike(db: db, query: query, projectPath: projectPath,
                                          limit: limit)
        }

        var ranked: [(Double, Int64, SessionSearchHit)] = []
        var seenRows = Set<Int64>()
        // Only tokenizer-visible terms enter MATCH. Punctuation-only queries
        // use LIKE above; quotes/operators can never become FTS syntax.
        let phrase = tokens.map { "\"\($0)\"" }.joined(separator: " ")
        for table in compact.count >= 3 ? ["message_fts_unicode", "message_fts_trigram"] : ["message_fts_unicode"] {
            let sql = """
                SELECT m.rowid, bm25(\(table)), m.text, m.message_id, m.role, m.timestamp, m.line_offset,
                       s.path, s.project_path, s.project_name, s.title, s.modified, s.archived
                FROM \(table)
                JOIN messages m ON m.rowid = \(table).rowid
                JOIN sessions s ON s.path = m.session_path
                WHERE \(table) MATCH ? AND (? IS NULL OR s.project_path = ?)
                ORDER BY bm25(\(table)) ASC, COALESCE(m.timestamp, s.modified) DESC, m.rowid ASC
                LIMIT ?
                """
            let statement = try prepare(db, sql)
            bindText(statement, 1, phrase)
            bindOptionalText(statement, 2, projectPath)
            bindOptionalText(statement, 3, projectPath)
            sqlite3_bind_int(statement, 4, Int32(limit * 2))
            while sqlite3_step(statement) == SQLITE_ROW {
                let rowID = sqlite3_column_int64(statement, 0)
                guard seenRows.insert(rowID).inserted else { continue }
                let path = columnText(statement, 7)
                let text = columnText(statement, 2)
                let hit = SessionSearchHit(
                    path: path,
                    title: columnText(statement, 10),
                    modified: Date(timeIntervalSince1970: sqlite3_column_double(statement, 11)),
                    snippet: SessionSearch.snippet(in: text, query: query) ?? String(text.prefix(140)),
                    isTitleMatch: false,
                    isArchived: sqlite3_column_int(statement, 12) != 0,
                    isLive: false,
                    projectPath: columnText(statement, 8),
                    projectName: columnText(statement, 9),
                    messageID: columnOptionalText(statement, 3),
                    messageLineOffset: sqlite3_column_int64(statement, 6),
                    role: columnOptionalText(statement, 4),
                    messageTimestamp: sqlite3_column_type(statement, 5) == SQLITE_NULL
                        ? nil : Date(timeIntervalSince1970: sqlite3_column_double(statement, 5))
                )
                ranked.append((sqlite3_column_double(statement, 1), rowID, hit))
            }
            sqlite3_finalize(statement)
        }
        ranked.sort {
            if $0.0 != $1.0 { return $0.0 < $1.0 }
            let left = $0.2.messageTimestamp ?? $0.2.modified ?? .distantPast
            let right = $1.2.messageTimestamp ?? $1.2.modified ?? .distantPast
            if left != right { return left > right }
            return $0.1 < $1.1
        }
        return Array(ranked.prefix(limit).map(\.2))
    }

    private static func searchMessagesLike(
        db: OpaquePointer,
        query: String,
        projectPath: String?,
        limit: Int
    ) throws -> [SessionSearchHit] {
        let statement = try prepare(db, """
            SELECT m.text, m.message_id, m.role, m.timestamp, m.line_offset,
                   s.path, s.project_path, s.project_name, s.title, s.modified, s.archived
            FROM messages m JOIN sessions s ON s.path=m.session_path
            WHERE (? IS NULL OR s.project_path=?) AND m.text LIKE ? ESCAPE '\\' COLLATE NOCASE
            ORDER BY COALESCE(m.timestamp, s.modified) DESC, m.rowid ASC LIMIT ?
            """)
        defer { sqlite3_finalize(statement) }
        bindOptionalText(statement, 1, projectPath)
        bindOptionalText(statement, 2, projectPath)
        bindText(statement, 3, "%" + escapeLike(query) + "%")
        sqlite3_bind_int(statement, 4, Int32(limit * 2))
        var hits: [SessionSearchHit] = []
        while sqlite3_step(statement) == SQLITE_ROW, hits.count < limit {
            let path = columnText(statement, 5)
            let text = columnText(statement, 0)
            hits.append(SessionSearchHit(
                path: path,
                title: columnText(statement, 8),
                modified: Date(timeIntervalSince1970: sqlite3_column_double(statement, 9)),
                snippet: SessionSearch.snippet(in: text, query: query) ?? String(text.prefix(140)),
                isTitleMatch: false,
                isArchived: sqlite3_column_int(statement, 10) != 0,
                isLive: false,
                projectPath: columnText(statement, 6),
                projectName: columnText(statement, 7),
                messageID: columnOptionalText(statement, 1),
                messageLineOffset: sqlite3_column_int64(statement, 4),
                role: columnOptionalText(statement, 2),
                messageTimestamp: sqlite3_column_type(statement, 3) == SQLITE_NULL
                    ? nil : Date(timeIntervalSince1970: sqlite3_column_double(statement, 3))
            ))
        }
        return hits
    }

    private static func sessionHit(_ statement: OpaquePointer, snippet: String?, titleMatch: Bool) -> SessionSearchHit {
        SessionSearchHit(
            path: columnText(statement, 0),
            title: columnText(statement, 3),
            modified: Date(timeIntervalSince1970: sqlite3_column_double(statement, 4)),
            snippet: snippet,
            isTitleMatch: titleMatch,
            isArchived: sqlite3_column_int(statement, 5) != 0,
            isLive: false,
            projectPath: columnText(statement, 1),
            projectName: columnText(statement, 2)
        )
    }

    // MARK: - SQLite helpers

    private static func exec(_ db: OpaquePointer, _ sql: String) throws {
        var message: UnsafeMutablePointer<CChar>?
        guard sqlite3_exec(db, sql, nil, nil, &message) == SQLITE_OK else {
            let detail = message.map { String(cString: $0) } ?? String(cString: sqlite3_errmsg(db))
            sqlite3_free(message)
            throw SessionSearchIndexError.database(detail)
        }
    }

    private static func prepare(_ db: OpaquePointer, _ sql: String) throws -> OpaquePointer {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
            throw databaseError(db)
        }
        return statement
    }

    private static func scalarInt(_ db: OpaquePointer, sql: String) throws -> Int32 {
        let statement = try prepare(db, sql)
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW else { throw databaseError(db) }
        return sqlite3_column_int(statement, 0)
    }

    private static func stepDone(_ statement: OpaquePointer, db: OpaquePointer) throws {
        guard sqlite3_step(statement) == SQLITE_DONE else { throw databaseError(db) }
    }

    private static func databaseError(_ db: OpaquePointer) -> SessionSearchIndexError {
        .database(String(cString: sqlite3_errmsg(db)))
    }

    private static func bindText(_ statement: OpaquePointer, _ index: Int32, _ value: String) {
        sqlite3_bind_text(statement, index, value, -1, sqliteTransient)
    }

    private static func bindOptionalText(_ statement: OpaquePointer, _ index: Int32, _ value: String?) {
        if let value { bindText(statement, index, value) } else { sqlite3_bind_null(statement, index) }
    }

    private static func bindData(_ statement: OpaquePointer, _ index: Int32, _ value: Data) {
        guard !value.isEmpty else {
            sqlite3_bind_zeroblob(statement, index, 0)
            return
        }
        _ = value.withUnsafeBytes { bytes in
            sqlite3_bind_blob(statement, index, bytes.baseAddress, Int32(value.count), sqliteTransient)
        }
    }

    private static func columnText(_ statement: OpaquePointer, _ index: Int32) -> String {
        columnOptionalText(statement, index) ?? ""
    }

    private static func columnOptionalText(_ statement: OpaquePointer, _ index: Int32) -> String? {
        guard sqlite3_column_type(statement, index) != SQLITE_NULL,
              let value = sqlite3_column_text(statement, index) else { return nil }
        return String(cString: value)
    }

    private static func columnData(_ statement: OpaquePointer, _ index: Int32) -> Data {
        let count = Int(sqlite3_column_bytes(statement, index))
        guard count > 0, let bytes = sqlite3_column_blob(statement, index) else { return Data() }
        return Data(bytes: bytes, count: count)
    }

    private static func escapeLike(_ value: String) -> String {
        value.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "%", with: "\\%")
            .replacingOccurrences(of: "_", with: "\\_")
    }

    private func securePermissions() {
        let fm = FileManager.default
        try? fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: databaseURL.deletingLastPathComponent().path)
        for suffix in ["", "-wal", "-shm"] where fm.fileExists(atPath: databaseURL.path + suffix) {
            try? fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: databaseURL.path + suffix)
        }
    }
}
