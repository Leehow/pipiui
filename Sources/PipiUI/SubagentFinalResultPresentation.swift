import Foundation

/// Pure helpers for the subagent detail "final result" card: heading strip,
/// collapsed line budget, and terminal-log dedup against `SubagentInfo.output`.
///
/// Upstream caps (do not change here):
/// - text log rows are head-capped at ~4000 chars
/// - `agent.output` is tail-capped at ~8000 chars
enum SubagentFinalResultPresentation {
    /// Collapsed Markdown line budget for the dedicated final-result card.
    static let collapsedLineLimit = 8

    // MARK: - Display

    /// Body shown inside the card. Strips a single leading Outcome/Final-result
    /// Markdown heading so the card chrome is not duplicated. Does not mutate storage.
    static func displayBody(from output: String) -> String {
        stripLeadingResultHeading(output)
    }

    /// True when the detail view should render the final-result card.
    static func shouldShowCard(output: String) -> Bool {
        !output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    // MARK: - Terminal log dedup

    /// Safe rule for suppressing a transcript row that would duplicate the card:
    ///
    /// 1. Consider only the **last** `kind == "text"` log item (earlier distinct
    ///    Outcome/history rows are never touched).
    /// 2. Normalize both sides: unify newlines, strip one leading Outcome /
    ///    Final result / 最终结果 heading, collapse whitespace, trim.
    /// 3. Suppress when normalized strings are equal.
    /// 4. Cap-aware fallback (last text row only): if the shorter normalized
    ///    string has at least `containmentMinChars` characters and is a prefix
    ///    **or** suffix of the longer one, treat as the same final output
    ///    truncated differently (log head-cap 4000 vs output tail-cap 8000).
    ///    Tiny accidental prefix matches are rejected by the length floor.
    /// 5. If equality is still unreliable (e.g. long body where head-4000 and
    ///    tail-8000 barely overlap), keep both — never hide non-equivalent history.
    static func terminalTextLogItemIDToSuppress(
        log: [AgentLogItem],
        output: String
    ) -> Int? {
        guard shouldShowCard(output: output) else { return nil }
        guard let lastText = log.last(where: { $0.kind == "text" }) else { return nil }
        guard isEquivalentFinalOutput(logText: lastText.text, output: output) else {
            return nil
        }
        return lastText.id
    }

    /// Minimum shorter-side length for prefix/suffix containment (cap-aware path).
    static let containmentMinChars = 64

    static func isEquivalentFinalOutput(logText: String, output: String) -> Bool {
        let a = normalizeForComparison(logText)
        let b = normalizeForComparison(output)
        guard !a.isEmpty, !b.isEmpty else { return false }
        if a == b { return true }

        let shorter: String
        let longer: String
        if a.count <= b.count {
            shorter = a
            longer = b
        } else {
            shorter = b
            longer = a
        }
        guard shorter.count >= containmentMinChars else { return false }
        return longer.hasPrefix(shorter) || longer.hasSuffix(shorter)
    }

    // MARK: - Normalization

    /// Comparison form: strip leading result heading, collapse all whitespace runs.
    static func normalizeForComparison(_ text: String) -> String {
        let stripped = stripLeadingResultHeading(text)
        let unified = stripped
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        let parts = unified.split { $0.isWhitespace || $0.isNewline }
        return parts.joined(separator: " ")
    }

    /// Remove one leading ATX heading whose title is Outcome / Final result / 最终结果
    /// (optional trailing colon). Leading blank lines before the heading are dropped
    /// with it; body is otherwise unchanged.
    static func stripLeadingResultHeading(_ markdown: String) -> String {
        let unified = markdown
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        var remainder = Substring(unified)
        while remainder.first == "\n" {
            remainder = remainder.dropFirst()
        }
        guard !remainder.isEmpty else { return "" }

        let firstLine: Substring
        let afterFirst: Substring
        if let nl = remainder.firstIndex(of: "\n") {
            firstLine = remainder[..<nl]
            afterFirst = remainder[remainder.index(after: nl)...]
        } else {
            firstLine = remainder
            afterFirst = Substring()
        }

        guard isResultHeadingLine(String(firstLine)) else {
            return String(remainder)
        }

        var rest = afterFirst
        while rest.first == "\n" {
            rest = rest.dropFirst()
        }
        return String(rest)
    }

    static func isResultHeadingLine(_ line: String) -> Bool {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.first == "#" else { return false }

        var idx = trimmed.startIndex
        var level = 0
        while idx < trimmed.endIndex, trimmed[idx] == "#", level < 6 {
            level += 1
            idx = trimmed.index(after: idx)
        }
        guard level >= 1, idx < trimmed.endIndex else { return false }
        // Markdown ATX headings require space after hashes; tolerate tabs too.
        guard trimmed[idx] == " " || trimmed[idx] == "\t" else { return false }

        var title = trimmed[idx...]
            .trimmingCharacters(in: .whitespacesAndNewlines)
        while title.last == ":" || title.last == "：" {
            title = String(title.dropLast()).trimmingCharacters(in: .whitespaces)
        }
        let key = title.lowercased()
        switch key {
        case "outcome", "final result", "finalresult", "最终结果", "结果":
            return true
        default:
            return false
        }
    }
}
