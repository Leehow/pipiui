import Foundation

struct SessionSearchHit: Identifiable, Equatable {
    let path: String
    let title: String
    let modified: Date?
    let snippet: String?
    let isTitleMatch: Bool
    let isArchived: Bool
    let isLive: Bool

    var id: String { path }
}

/// What the sidebar should do when a search hit is clicked. Pure and
/// unit-tested: archived hits must go through `restoreSession` (AppStore
/// refuses to open paths that are still marked archived).
enum SessionSearchOpenAction: Equatable {
    case selectLive(key: String)
    case openDisk(meta: SessionMeta)
    case restoreArchived(meta: SessionMeta)
}

/// Synchronous session keyword scanner. Call from a background queue.
enum SessionSearch {
    private static let maxBytes = 10 * 1024 * 1024
    private static let maxLines = 1000
    private static let resultCap = 50
    private static let snippetRadius = 60
    private static let chunkSize = 64 * 1024

    static func openAction(for hit: SessionSearchHit) -> SessionSearchOpenAction {
        if hit.isLive {
            return .selectLive(key: hit.path)
        }
        let meta = SessionMeta(
            path: hit.path,
            name: hit.title,
            modified: hit.modified ?? Date(),
            modelRef: nil
        )
        if hit.isArchived {
            return .restoreArchived(meta: meta)
        }
        return .openDisk(meta: meta)
    }

    /// Opens the JSONL and scans complete lines for `query` in the message body.
    ///
    /// The file is read with a FileHandle in bounded chunks; lines are split on
    /// newline *bytes*, so a multibyte scalar or JSONL line cut at a chunk/file
    /// boundary never invalidates earlier lines. Each line is decoded
    /// independently and malformed lines are skipped, not fatal. The byte cap
    /// (10MiB) and line cap (1000) are enforced while streaming; a trailing
    /// unterminated line (EOF or byte-cap cut) is dropped by design.
    static func scan(
        file: URL,
        title: String,
        query: String,
        modified: Date?
    ) -> SessionSearchHit? {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return nil }

        if title.range(of: q, options: .caseInsensitive) != nil {
            return SessionSearchHit(
                path: file.path,
                title: title,
                modified: modified,
                snippet: nil,
                isTitleMatch: true,
                isArchived: false,
                isLive: false
            )
        }

        if Task.isCancelled { return nil }
        guard let handle = try? FileHandle(forReadingFrom: file) else { return nil }
        defer { try? handle.close() }

        var pending = Data()
        var lineCount = 0
        var bytesRead = 0
        var eof = false

        while true {
            if Task.isCancelled { return nil }

            if !eof && bytesRead < maxBytes {
                let want = min(chunkSize, maxBytes - bytesRead)
                if let chunk = try? handle.read(upToCount: want), !chunk.isEmpty {
                    bytesRead += chunk.count
                    pending.append(chunk)
                } else {
                    eof = true
                }
            } else {
                eof = true
            }

            // Extract and scan complete (newline-terminated) lines. Integer
            // positions only: Data's `firstIndex(of:)`/`removeFirst` misbehave
            // on buffers with a non-zero internal offset, so slicing goes
            // through `subdata` (fresh buffer) instead.
            var lineStart = 0
            var i = 0
            while i < pending.count {
                if pending[i] == 0x0A {
                    let lineData = pending.subdata(in: lineStart..<i)
                    lineCount += 1
                    if lineCount > maxLines { return nil }
                    if let snip = bodySnippet(lineData: lineData, query: q) {
                        return SessionSearchHit(
                            path: file.path,
                            title: title,
                            modified: modified,
                            snippet: snip,
                            isTitleMatch: false,
                            isArchived: false,
                            isLive: false
                        )
                    }
                    lineStart = i + 1
                }
                i += 1
            }
            if lineStart > 0 {
                pending = pending.subdata(in: lineStart..<pending.count)
            }

            if eof { break }
        }
        return nil
    }

    /// Decodes one JSONL line and returns the snippet around the query in the
    /// flattened message text, or nil when the line is malformed / not a match.
    /// Matching happens on the DECODED text (`range(of:options:.caseInsensitive)`),
    /// so queries containing quotes/newlines match their unescaped form.
    private static func bodySnippet(lineData: Data, query: String) -> String? {
        guard let obj = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any],
              let message = obj["message"] as? [String: Any]
        else { return nil }
        let flat = contentText(message["content"])
        return snippet(in: flat, query: query)
    }

    /// Search active metas, archived metas, and live (not-yet-on-disk) session titles.
    /// - Parameter liveEntries: `(key, title)` pairs; title-only matches, `isLive = true`.
    static func search(
        metas: [SessionMeta],
        archived: [SessionMeta],
        query: String,
        liveEntries: [(String, String)]
    ) -> [SessionSearchHit] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return [] }

        var hits: [SessionSearchHit] = []
        var seen = Set<String>()

        func appendUnique(_ hit: SessionSearchHit) {
            guard !seen.contains(hit.path) else { return }
            seen.insert(hit.path)
            hits.append(hit)
        }

        // Title matches first (skip body scan).
        for meta in metas {
            if meta.name.range(of: q, options: .caseInsensitive) != nil {
                appendUnique(SessionSearchHit(
                    path: meta.path,
                    title: meta.name,
                    modified: meta.modified,
                    snippet: nil,
                    isTitleMatch: true,
                    isArchived: false,
                    isLive: false
                ))
            }
        }
        for meta in archived {
            if meta.name.range(of: q, options: .caseInsensitive) != nil {
                appendUnique(SessionSearchHit(
                    path: meta.path,
                    title: meta.name,
                    modified: meta.modified,
                    snippet: nil,
                    isTitleMatch: true,
                    isArchived: true,
                    isLive: false
                ))
            }
        }
        for (key, title) in liveEntries {
            if title.range(of: q, options: .caseInsensitive) != nil {
                appendUnique(SessionSearchHit(
                    path: key,
                    title: title,
                    modified: nil,
                    snippet: nil,
                    isTitleMatch: true,
                    isArchived: false,
                    isLive: true
                ))
            }
        }

        // Body matches for disk sessions not already claimed by a title hit.
        for meta in metas where !seen.contains(meta.path) {
            if Task.isCancelled { return hits }
            if let hit = scan(
                file: URL(fileURLWithPath: meta.path),
                title: meta.name,
                query: q,
                modified: meta.modified
            ), !hit.isTitleMatch {
                appendUnique(hit)
            }
        }
        for meta in archived where !seen.contains(meta.path) {
            if Task.isCancelled { return hits }
            if var hit = scan(
                file: URL(fileURLWithPath: meta.path),
                title: meta.name,
                query: q,
                modified: meta.modified
            ), !hit.isTitleMatch {
                hit = SessionSearchHit(
                    path: hit.path,
                    title: hit.title,
                    modified: hit.modified,
                    snippet: hit.snippet,
                    isTitleMatch: hit.isTitleMatch,
                    isArchived: true,
                    isLive: false
                )
                appendUnique(hit)
            }
        }

        // Title matches first, then modified desc, then path asc (deterministic
        // tie-break so the 50-result boundary is stable).
        hits.sort { a, b in
            if a.isTitleMatch != b.isTitleMatch {
                return a.isTitleMatch && !b.isTitleMatch
            }
            let da = a.modified ?? .distantPast
            let db = b.modified ?? .distantPast
            if da != db { return da > db }
            return a.path < b.path
        }
        if hits.count > resultCap {
            return Array(hits.prefix(resultCap))
        }
        return hits
    }

    // MARK: - Helpers (local; do not depend on ChatSession)

    /// Mirrors `ChatSession.contentText`: String or text parts joined by newlines.
    static func contentText(_ content: Any?) -> String {
        if let s = content as? String { return s }
        guard let arr = content as? [Any] else { return "" }
        return arr.compactMap { item -> String? in
            guard let dict = item as? [String: Any],
                  dict["type"] as? String == "text",
                  let text = dict["text"] as? String
            else { return nil }
            return text
        }.joined(separator: "\n")
    }

    /// Up to ±60 chars around the first case-insensitive match; leading/trailing "…" when truncated.
    static func snippet(in text: String, query: String) -> String? {
        guard let match = text.range(of: query, options: .caseInsensitive) else { return nil }
        let start = text.index(match.lowerBound, offsetBy: -snippetRadius, limitedBy: text.startIndex)
            ?? text.startIndex
        let end = text.index(match.upperBound, offsetBy: snippetRadius, limitedBy: text.endIndex)
            ?? text.endIndex
        var snip = String(text[start..<end])
        if start != text.startIndex { snip = "…" + snip }
        if end != text.endIndex { snip = snip + "…" }
        return snip
    }
}
