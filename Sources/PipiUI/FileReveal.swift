import AppKit
import Foundation
import SwiftUI

/// Shared helpers: reveal/open local files and detect absolute paths in prose.
package enum FileReveal {

    // MARK: - Reveal / open

    @discardableResult
    package static func revealInFinder(path: String) -> Bool {
        revealInFinder(url: URL(fileURLWithPath: path))
    }

    @discardableResult
    package static func revealInFinder(url: URL) -> Bool {
        let resolved = url.isFileURL ? url : URL(fileURLWithPath: url.path)
        let path = resolved.path
        guard !path.isEmpty, FileManager.default.fileExists(atPath: path) else { return false }
        NSWorkspace.shared.activateFileViewerSelecting([resolved])
        return true
    }

    @discardableResult
    package static func open(path: String) -> Bool {
        let url = URL(fileURLWithPath: path)
        guard FileManager.default.fileExists(atPath: path) else { return false }
        return NSWorkspace.shared.open(url)
    }

    package static func missingPathMessage(_ path: String) -> String {
        "找不到文件：\(path)"
    }

    // MARK: - Path classification

    /// True when `string` (trimmed) is a file:// URL or a POSIX absolute path we recognize.
    package static func isAbsoluteFilePath(_ string: String) -> Bool {
        fileURL(fromCandidate: string) != nil
    }

    /// Decode a candidate into a file URL, or nil if not a local absolute path / file URL.
    package static func fileURL(fromCandidate raw: String) -> URL? {
        let trimmed = stripTrailingPunctuation(raw.trimmingCharacters(in: .whitespacesAndNewlines))
        guard !trimmed.isEmpty else { return nil }

        let lower = trimmed.lowercased()
        if lower.hasPrefix("http://") || lower.hasPrefix("https://") {
            return nil
        }

        if lower.hasPrefix("file://") {
            guard let url = URL(string: trimmed), url.isFileURL else {
                // Percent-encoded or partially formed — try standardizing.
                if let encoded = trimmed.addingPercentEncoding(withAllowedCharacters: .urlFragmentAllowed),
                   let url = URL(string: encoded), url.isFileURL {
                    return url
                }
                return nil
            }
            // Reject bare file:// with empty path
            guard !url.path.isEmpty, url.path != "/" else { return nil }
            return url
        }

        guard trimmed.hasPrefix("/") else { return nil }
        // v1: no unquoted spaces
        if trimmed.contains(" ") || trimmed.contains("\t") { return nil }
        guard isRecognizedAbsolutePath(trimmed) else { return nil }
        return URL(fileURLWithPath: trimmed)
    }

    /// Ranges of absolute path / file:// candidates inside free text (no spaces inside path).
    package static func absolutePathMatches(in text: String) -> [Range<String.Index>] {
        var ranges: [Range<String.Index>] = []
        var i = text.startIndex

        while i < text.endIndex {
            // file://…
            if text[i...].lowercased().hasPrefix("file://") {
                let start = i
                var j = text.index(i, offsetBy: "file://".count, limitedBy: text.endIndex) ?? text.endIndex
                while j < text.endIndex, isPathBodyChar(text[j]) {
                    j = text.index(after: j)
                }
                let raw = String(text[start..<j])
                let cleaned = stripTrailingPunctuation(raw)
                if fileURL(fromCandidate: cleaned) != nil {
                    let end = text.index(start, offsetBy: cleaned.count, limitedBy: text.endIndex) ?? j
                    let range = start..<end
                    if ranges.last.map({ $0.upperBound <= start }) ?? true {
                        ranges.append(range)
                    }
                }
                i = j
                continue
            }

            // POSIX absolute starting at /
            if text[i] == "/" {
                // Start after whitespace, punctuation, or CJK (CJK isLetter == true in Swift).
                // Reject mid-token like http://host/Users/... when prev is ASCII word/URL char.
                let canStart: Bool = {
                    if i == text.startIndex { return true }
                    let prev = text[text.index(before: i)]
                    if isASCIIWordOrURLChar(prev) { return false }
                    return true
                }()
                if canStart {
                    var j = i
                    while j < text.endIndex, isPathBodyChar(text[j]) {
                        j = text.index(after: j)
                    }
                    let raw = String(text[i..<j])
                    let cleaned = stripTrailingPunctuation(raw)
                    if fileURL(fromCandidate: cleaned) != nil {
                        let end = text.index(i, offsetBy: cleaned.count, limitedBy: text.endIndex) ?? j
                        ranges.append(i..<end)
                        i = end
                        continue
                    }
                }
            }

            i = text.index(after: i)
        }
        return ranges
    }

    /// Path hit target for Cmd+click (UTF-16 `NSRange` in the plain string).
    package struct PathTarget: Equatable {
        package let range: NSRange
        package let url: URL
        package let path: String
    }

    /// Resolved path targets inside free text (visual ranges only; no `.link` attribute).
    package static func pathTargets(in text: String) -> [PathTarget] {
        absolutePathMatches(in: text).compactMap { range in
            let raw = String(text[range])
            guard let url = fileURL(fromCandidate: raw) else { return nil }
            let nsRange = NSRange(range, in: text)
            guard nsRange.location != NSNotFound else { return nil }
            return PathTarget(range: nsRange, url: url, path: url.path)
        }
    }

    /// Build an AttributedString with path **visual** style (accent + underline) on detected paths.
    /// Does **not** set `.link` — AppKit/SwiftUI link navigation steals clicks and breaks selection.
    /// Cmd+click reveal is handled by `PathLinkedText` via `pathTargets`.
    package static func attributedStringLinkingPaths(
        _ text: String,
        base: AttributeContainer = .init(),
        linkColor: Color? = Color.accentColor
    ) -> AttributedString {
        var result = AttributedString(text)
        result.mergeAttributes(base)

        let matches = absolutePathMatches(in: text)
        for range in matches {
            guard fileURL(fromCandidate: String(text[range])) != nil else { continue }
            guard let lower = AttributedString.Index(range.lowerBound, within: result),
                  let upper = AttributedString.Index(range.upperBound, within: result) else { continue }
            var style = AttributeContainer()
            if let linkColor {
                style.foregroundColor = linkColor
            }
            style.underlineStyle = .single
            result[lower..<upper].mergeAttributes(style)
        }
        return result
    }

    /// Inject path **visual** style into an already-markdown-parsed AttributedString (by plain characters).
    /// Does **not** set `.link` on paths. Skips ranges that already have a markdown/http link.
    package static func injectPathLinks(
        into attributed: AttributedString,
        linkColor: Color? = Color.accentColor
    ) -> AttributedString {
        var result = attributed
        let plain = String(result.characters)
        for range in absolutePathMatches(in: plain) {
            guard fileURL(fromCandidate: String(plain[range])) != nil else { continue }
            guard let lower = AttributedString.Index(range.lowerBound, within: result),
                  let upper = AttributedString.Index(range.upperBound, within: result) else { continue }
            // Skip if already has a link (e.g. markdown [text](url))
            if result[lower..<upper].link != nil { continue }
            var style = AttributeContainer()
            if let linkColor {
                style.foregroundColor = linkColor
            }
            style.underlineStyle = .single
            result[lower..<upper].mergeAttributes(style)
        }
        return result
    }

    // MARK: - Internals

    private static let recognizedPrefixes: [String] = [
        "/Users/",
        "/tmp/",
        "/private/",
        "/var/",
        "/Volumes/",
        "/Applications/",
        "/System/",
        "/Library/",
        "/opt/",
        "/usr/",
        "/bin/",
        "/sbin/",
        "/etc/",
        "/home/",
        "/root/",
        "/dev/",
    ]

    private static func isRecognizedAbsolutePath(_ path: String) -> Bool {
        // Exact short roots alone are not useful as "file paths" in prose
        guard path != "/", !path.isEmpty else { return false }

        let hasPrefix = recognizedPrefixes.contains { path.hasPrefix($0) }
            || path == "/tmp"
            || path.hasPrefix("/tmp")
        guard hasPrefix else {
            // Generic absolute with ≥2 components (e.g. /data/foo) — still allow if ≥2 segments
            let parts = path.split(separator: "/", omittingEmptySubsequences: true)
            return parts.count >= 2 && path.hasPrefix("/")
        }

        // Require ≥2 path components: /Users/name or /tmp/x (not just /Users or /tmp bare root of list)
        let parts = path.split(separator: "/", omittingEmptySubsequences: true)
        if path == "/tmp" || path == "/var" || path == "/opt" || path == "/usr" {
            return false
        }
        // /Users alone → 1 component; /Users/bob → 2
        return parts.count >= 2
    }

    private static func isPathBodyChar(_ ch: Character) -> Bool {
        if ch.isWhitespace { return false }
        // Stop at common delimiters / CJK punctuation (strip handles trailing; body stops early)
        if "<>\"'`()[]{}|,;。，；：、】》".contains(ch) { return false }
        // Allow percent-encoding and typical path chars
        return true
    }

    /// ASCII letters/digits and URL/path joiners — used to avoid matching inside hostnames/URLs.
    private static func isASCIIWordOrURLChar(_ ch: Character) -> Bool {
        if ch == "_" || ch == "." || ch == "-" || ch == ":" || ch == "/" || ch == "@" || ch == "%" {
            return true
        }
        guard let s = ch.unicodeScalars.first, ch.unicodeScalars.count == 1 else { return false }
        let v = s.value
        // 0-9 A-Z a-z only (not CJK “letters”)
        return (v >= 0x30 && v <= 0x39) || (v >= 0x41 && v <= 0x5A) || (v >= 0x61 && v <= 0x7A)
    }

    package static func stripTrailingPunctuation(_ string: String) -> String {
        var s = string
        let trailing = CharacterSet(charactersIn: ".,;:!?)]}>'\"，。；：、）】》」』")
            .union(.whitespacesAndNewlines)
        while let last = s.unicodeScalars.last, trailing.contains(last) {
            s.removeLast()
        }
        return s
    }
}
