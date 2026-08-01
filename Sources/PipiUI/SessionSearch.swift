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

/// Synchronous session keyword scanner. Call from a background queue.
enum SessionSearch {
    private static let maxBytes = 10 * 1024 * 1024
    private static let maxLines = 1000
    private static let resultCap = 50
    private static let snippetRadius = 60

    /// Opens the JSONL, scans for `query` in title (no body) or message body text.
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

        guard let handle = try? FileHandle(forReadingFrom: file) else { return nil }
        defer { try? handle.close() }

        let data = handle.readData(ofLength: maxBytes)
        guard !data.isEmpty, let raw = String(data: data, encoding: .utf8) else { return nil }

        let queryLower = q.lowercased()
        var lineCount = 0
        for line in raw.split(separator: "\n", omittingEmptySubsequences: false) {
            lineCount += 1
            if lineCount > maxLines { break }
            let lineStr = String(line)
            guard lineStr.lowercased().contains(queryLower) else { continue }
            guard let obj = try? JSONSerialization.jsonObject(with: Data(lineStr.utf8)) as? [String: Any],
                  let message = obj["message"] as? [String: Any]
            else { continue }

            let flat = contentText(message["content"])
            guard let snip = snippet(in: flat, query: q) else { continue }

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
        return nil
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

        hits.sort { a, b in
            if a.isTitleMatch != b.isTitleMatch {
                return a.isTitleMatch && !b.isTitleMatch
            }
            let da = a.modified ?? .distantPast
            let db = b.modified ?? .distantPast
            return da > db
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
