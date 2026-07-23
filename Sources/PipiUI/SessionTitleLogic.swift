import Foundation

package enum SessionTitleLogic {
    package static let placeholderName = "新会话"

    package static func isPlaceholderName(_ name: String?) -> Bool {
        guard let name else { return true }
        let t = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty || t == placeholderName
    }

    /// Build provisional title from first user message (8–16 ideographs or ~short English).
    package static func provisionalTitle(from userMessage: String, maxChars: Int = 16) -> String? {
        var s = userMessage.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return nil }

        // First line only.
        if let nl = s.firstIndex(of: "\n") {
            s = String(s[..<nl]).trimmingCharacters(in: .whitespacesAndNewlines)
        }

        // Strip attachment footnotes if obvious on the same line.
        if let r = s.range(of: "Attached image", options: .caseInsensitive) {
            s = String(s[..<r.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
        }

        if s.contains("PipiUI internal") { return nil }

        // Collapse whitespace.
        s = s.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).joined(separator: " ")
        guard !s.isEmpty else { return nil }

        // Strip low-information leading fillers before length / language branches.
        s = stripLeadingFiller(s)
        guard !s.isEmpty else { return nil }

        // Too short to be a useful provisional title ("A", "b", "，").
        if s.trimmingCharacters(in: .whitespacesAndNewlines).count < 2 { return nil }

        if isMostlyCJK(s) {
            let chars = Array(s)
            let hard = min(chars.count, max(1, maxChars))
            var end = hard
            // Prefer break at punctuation within the first maxChars (keep some substance).
            if hard > 1 {
                for i in 1..<hard {
                    if isTitleBreakPunctuation(chars[i]) {
                        if i >= 4 {
                            end = i
                            break
                        }
                    }
                }
            }
            let result = String(chars[..<end]).trimmingCharacters(in: .whitespacesAndNewlines)
            return result.isEmpty ? nil : result
        }

        // English: first ~5 words or 40 chars, then hard cap 24.
        let words = s.split(separator: " ", omittingEmptySubsequences: true)
        var taken: [Substring] = []
        for w in words.prefix(5) {
            let candidate = (taken + [w]).joined(separator: " ")
            if !taken.isEmpty && candidate.count > 40 { break }
            taken.append(w)
            if candidate.count >= 40 { break }
        }
        var result = taken.joined(separator: " ")
        if result.count > 40 {
            result = String(result.prefix(40))
        }
        if result.count > 24 {
            result = String(result.prefix(24)).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        // Avoid trailing partial word glue if we mid-cut a long token — keep simple prefix trim.
        result = result.trimmingCharacters(in: .whitespacesAndNewlines)
        return result.isEmpty ? nil : result
    }

    /// Reject junk auto titles: empty, placeholder, ISO session filenames, paths, PipiUI internal, title-prompt fingerprints, pure timestamps, markdown-heavy.
    package static func isJunkAutoTitle(_ name: String) -> Bool {
        let t = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty || isPlaceholderName(t) { return true }
        // Single-character titles are never useful ("A", "b").
        if t.count <= 1 { return true }
        if t.contains("PipiUI internal") { return true }
        // Orphan side-channel title-generation sessions (prompt leaked into name/display).
        if t.contains("Write a short session title") { return true }
        if t.count > 40 { return true }
        if t.hasPrefix("**") || t.hasPrefix("#") { return true }
        if t.contains("/") || t.contains(".jsonl") || t.contains("docs/") { return true }

        // ISO-ish session filename: 2026-07-23T15-31-40-489Z_…
        if t.range(of: #"^\d{4}-\d{2}-\d{2}T\d{2}"#, options: .regularExpression) != nil {
            return true
        }
        return false
    }

    package static func parseModelTitle(_ raw: String, maxChars: Int = 40) -> String? {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if let nl = s.firstIndex(of: "\n") {
            s = String(s[..<nl]).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        // Strip one layer of wrapping quotes
        let wrappers: [(Character, Character)] = [
            ("\"", "\""), ("'", "'"), ("「", "」"), ("『", "』")
        ]
        if let f = s.first, let l = s.last, s.count >= 2 {
            for (a, b) in wrappers where f == a && l == b {
                s = String(s.dropFirst().dropLast()).trimmingCharacters(in: .whitespacesAndNewlines)
                break
            }
        }
        let prefixes = ["标题：", "标题:", "Title:", "title:", "TITLE:"]
        for p in prefixes {
            if s.lowercased().hasPrefix(p.lowercased()) {
                // Use original-case prefix length via range
                if let r = s.range(of: p, options: [.caseInsensitive, .anchored]) {
                    s = String(s[r.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
                }
                break
            }
        }
        guard !s.isEmpty, s.count <= maxChars else { return nil }
        if isJunkAutoTitle(s) { return nil }
        return s
    }

    // MARK: - Helpers

    /// Iteratively strip low-information leading phrases (case-insensitive for Latin).
    private static func stripLeadingFiller(_ s: String) -> String {
        // Longer phrases first so "有个问题，" wins over "有个问题", etc.
        let fillers: [String] = [
            // Chinese
            "有个问题，", "有个问题",
            "我想问一下，", "我想问",
            "请问一下，", "请问",
            "问一下，",
            "是这样的，",
            "对了，",
            "帮我看下，", "帮我", "能帮我",
            "那个",
            "嗯，",
            "如下：", "如下",
            // English (trailing space = word boundary; bare match handled below)
            "can you ", "could you ", "please ",
            "hey ", "hi ", "hello ", "so ",
            "i want to ", "i need to ",
            "how do i ", "what about ",
        ]

        var result = s.trimmingCharacters(in: .whitespacesAndNewlines)
        var changed = true
        while changed && !result.isEmpty {
            changed = false
            let lower = result.lowercased()
            for filler in fillers {
                let f = filler.lowercased()
                if lower.hasPrefix(f) {
                    let idx = result.index(result.startIndex, offsetBy: filler.count)
                    result = String(result[idx...]).trimmingCharacters(in: .whitespacesAndNewlines)
                    changed = true
                    break
                }
                // Exact bare match for space-terminated English fillers ("hi" vs "hi ").
                if f.hasSuffix(" ") {
                    let bare = String(f.dropLast())
                    if lower == bare {
                        result = ""
                        changed = true
                        break
                    }
                }
            }
        }
        return result
    }

    private static func isMostlyCJK(_ s: String) -> Bool {
        var cjk = 0
        var significant = 0
        for ch in s {
            if ch.isWhitespace { continue }
            significant += 1
            if isCJKScalar(ch) { cjk += 1 }
        }
        guard significant > 0 else { return false }
        return Double(cjk) / Double(significant) >= 0.5
    }

    private static func isCJKScalar(_ ch: Character) -> Bool {
        for s in ch.unicodeScalars {
            let v = s.value
            // CJK Unified Ideographs + extension A + common punctuation blocks used in titles
            if (0x4E00...0x9FFF).contains(v) { return true }
            if (0x3400...0x4DBF).contains(v) { return true }
            if (0xF900...0xFAFF).contains(v) { return true }
            if (0x3040...0x30FF).contains(v) { return true } // Hiragana/Katakana
            if (0xAC00...0xD7AF).contains(v) { return true } // Hangul
        }
        return false
    }

    private static func isTitleBreakPunctuation(_ ch: Character) -> Bool {
        if ch.isPunctuation { return true }
        // Common CJK / fullwidth punctuation not always classified as punctuation
        return "，。！？、；：…—·「」『』【】（）()".contains(ch)
    }
}
