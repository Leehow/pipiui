import Foundation

/// Collapse large composer pastes into short markers (pi TUI–compatible).
enum DraftPasteCollapse {
    static let maxLinesWithoutCollapse = 10
    static let maxCharsWithoutCollapse = 1000

    /// Matches `[paste #1 +123 lines]` or `[paste #2 1234 chars]` (optional stats suffix).
    static let markerRegex = try! NSRegularExpression(
        pattern: #"\[paste #(\d+)( (\+\d+ lines|\d+ chars))?\]"#
    )

    static func isLargePaste(_ text: String) -> Bool {
        if text.count > maxCharsWithoutCollapse { return true }
        // split("\n") on "a\nb" → 2 lines; empty string → [""] (1 “line”)
        let lineCount = text.split(separator: "\n", omittingEmptySubsequences: false).count
        return lineCount > maxLinesWithoutCollapse
    }

    static func makeMarker(id: Int, lineCount: Int, charCount: Int) -> String {
        if lineCount > maxLinesWithoutCollapse {
            return "[paste #\(id) +\(lineCount) lines]"
        }
        return "[paste #\(id) \(charCount) chars]"
    }

    static func lineAndCharCount(of text: String) -> (lines: Int, chars: Int) {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false).count
        return (lines, text.count)
    }

    static func expandPasteMarkers(text: String, pastes: [Int: String]) -> String {
        guard !pastes.isEmpty, text.contains("[paste #") else { return text }
        let ns = text as NSString
        let full = NSRange(location: 0, length: ns.length)
        var result = ""
        var lastEnd = 0
        markerRegex.enumerateMatches(in: text, options: [], range: full) { match, _, _ in
            guard let match else { return }
            let markerRange = match.range
            if markerRange.location > lastEnd {
                result += ns.substring(with: NSRange(location: lastEnd, length: markerRange.location - lastEnd))
            }
            let idRange = match.range(at: 1)
            if idRange.location != NSNotFound,
               let pasteId = Int(ns.substring(with: idRange)),
               let body = pastes[pasteId] {
                result += body
            } else {
                result += ns.substring(with: markerRange)
            }
            lastEnd = markerRange.location + markerRange.length
        }
        if lastEnd < ns.length {
            result += ns.substring(with: NSRange(location: lastEnd, length: ns.length - lastEnd))
        }
        return result
    }

    /// Drop paste entries whose markers no longer appear in `text`.
    static func pruneOrphanPastes(text: String, pastes: [Int: String]) -> [Int: String] {
        guard !pastes.isEmpty else { return pastes }
        let present = pasteIds(in: text)
        return pastes.filter { present.contains($0.key) }
    }

    static func pasteIds(in text: String) -> Set<Int> {
        guard text.contains("[paste #") else { return [] }
        let ns = text as NSString
        let full = NSRange(location: 0, length: ns.length)
        var ids = Set<Int>()
        markerRegex.enumerateMatches(in: text, options: [], range: full) { match, _, _ in
            guard let match else { return }
            let idRange = match.range(at: 1)
            if idRange.location != NSNotFound, let id = Int(ns.substring(with: idRange)) {
                ids.insert(id)
            }
        }
        return ids
    }
}
