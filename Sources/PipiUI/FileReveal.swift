import AppKit
import Foundation
import SwiftUI

/// Shared helpers: reveal/open local files and detect absolute paths in prose.
package enum FileReveal {

    // MARK: - Reveal / open

    /// Test seam: swap these out so tests never spawn a real Finder window.
    nonisolated(unsafe) package static var revealHandler: ([URL]) -> Void = {
        NSWorkspace.shared.activateFileViewerSelecting($0)
    }

    /// Test seam: swap this out so tests never launch a real app.
    nonisolated(unsafe) package static var openHandler: (URL) -> Bool = {
        NSWorkspace.shared.open($0)
    }

    @discardableResult
    package static func revealInFinder(path: String) -> Bool {
        revealInFinder(url: URL(fileURLWithPath: path))
    }

    @discardableResult
    package static func revealInFinder(url: URL) -> Bool {
        let resolved = url.isFileURL ? url : URL(fileURLWithPath: url.path)
        let path = resolved.path
        guard !path.isEmpty, FileManager.default.fileExists(atPath: path) else { return false }
        revealHandler([resolved])
        return true
    }

    @discardableResult
    package static func open(path: String) -> Bool {
        let url = URL(fileURLWithPath: path)
        guard FileManager.default.fileExists(atPath: path) else { return false }
        return openHandler(url)
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
    /// Linear scan: no per-character full-suffix `lowercased()`.
    package static func absolutePathMatches(in text: String) -> [Range<String.Index>] {
        PathLinkCache.shared.matches(in: text)
    }

    /// Path hit target for Cmd+click (UTF-16 `NSRange` in the plain string).
    package struct PathTarget: Equatable {
        package let range: NSRange
        package let url: URL
        package let path: String
    }

    /// Single-scan render payload: visual style + ⌘+click targets.
    package struct PathLinkedContent {
        package let visual: AttributedString
        package let targets: [PathTarget]
    }

    /// Resolved path targets inside free text (visual ranges only; no `.link` attribute).
    package static func pathTargets(in text: String) -> [PathTarget] {
        PathLinkCache.shared.targets(in: text)
    }

    /// Build an AttributedString with path **visual** style (accent + underline) on detected paths.
    /// Does **not** set `.link` — AppKit/SwiftUI link navigation steals clicks and breaks selection.
    /// Cmd+click reveal is handled by `PathLinkedText` via `pathTargets`.
    package static func attributedStringLinkingPaths(
        _ text: String,
        base: AttributeContainer = .init(),
        linkColor: Color? = Color.accentColor
    ) -> AttributedString {
        pathLinkedContent(text: text, base: base, linkColor: linkColor).visual
    }

    /// Inject path **visual** style into an already-markdown-parsed AttributedString (by plain characters).
    /// Does **not** set `.link` on paths. Skips ranges that already have a markdown/http link.
    package static func injectPathLinks(
        into attributed: AttributedString,
        linkColor: Color? = Color.accentColor,
        cache: Bool = true
    ) -> AttributedString {
        pathLinkedContent(attributed: attributed, linkColor: linkColor, cache: cache).visual
    }

    /// Single scan: styled plain text + path targets (shared cache for default styling).
    package static func pathLinkedContent(
        text: String,
        base: AttributeContainer = .init(),
        linkColor: Color? = Color.accentColor
    ) -> PathLinkedContent {
        PathLinkCache.shared.plainContent(text: text, base: base, linkColor: linkColor)
    }

    /// Single scan: inject path style into markdown attributed text + path targets.
    package static func pathLinkedContent(
        attributed: AttributedString,
        linkColor: Color? = Color.accentColor,
        cache: Bool = true
    ) -> PathLinkedContent {
        // Cache only the common markdown-block shape: accent link color + an attributed
        // string carrying no caller-applied foreground color (i.e. exactly what
        // `MarkdownTextView.inlineWithPaths` produces). Callers that restyle (e.g. quote
        // sets `.secondary`) fall through to the scan path — they cannot pollute the cache
        // because the foreground-color guard fails. Document links carry a per-file base URL,
        // so they intentionally bypass this plain-text-keyed cache.
        let cacheable = cache && PathLinkCache.shared.canCacheAttributed(attributed, linkColor: linkColor)
        if cacheable, let hit = PathLinkCache.shared.attributedContent(attributed) {
            return hit
        }

        let plain = String(attributed.characters)
        let targets = pathTargets(in: plain)
        let visual = applyPathStyle(
            to: attributed,
            plain: plain,
            targets: targets,
            linkColor: linkColor,
            skipExistingLinks: true
        )
        let content = PathLinkedContent(visual: visual, targets: targets)

        if cacheable {
            PathLinkCache.shared.storeAttributed(content, for: attributed)
        }
        return content
    }

    /// Test / memory-pressure helper: drop path-scan and plain-render caches.
    package static func clearPathLinkCache() {
        PathLinkCache.shared.removeAllObjects()
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
        // ASCII 分隔符 + CJK 标点/括号/箭头：中文行文里路径后面紧跟的标点不能吞进路径
        //（如 /tmp/a.md」就是正文 → 路径应止于 」前）。
        // 注意 CJK 表意文字本身仍是合法路径字符（/Users/x/文档/a.md），不在此拦截。
        if "<>\"'`()[]{}|,;。，；：、？！…—（）【】《》「」『』〈〉～·→←↑↓".contains(ch) { return false }
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

    /// Linear path scan. Ranges refer to `text` indices.
    fileprivate static func computeAbsolutePathMatches(in text: String) -> [Range<String.Index>] {
        var ranges: [Range<String.Index>] = []
        var i = text.startIndex

        while i < text.endIndex {
            let ch = text[i]

            // file://… (case-insensitive scheme; no full-suffix lowercased())
            if ch == "f" || ch == "F", startsWithFileScheme(at: i, in: text) {
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
            if ch == "/" {
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

    /// Cheap ASCII case-insensitive match for the `file://` scheme at `i`.
    private static func startsWithFileScheme(at i: String.Index, in text: String) -> Bool {
        var j = i
        // "file://"
        let letters: [UInt8] = [0x66, 0x69, 0x6C, 0x65] // f i l e
        for expected in letters {
            guard j < text.endIndex else { return false }
            guard let v = text[j].asciiValue else { return false }
            if (v | 0x20) != expected { return false }
            j = text.index(after: j)
        }
        guard j < text.endIndex, text[j] == ":" else { return false }
        j = text.index(after: j)
        guard j < text.endIndex, text[j] == "/" else { return false }
        j = text.index(after: j)
        guard j < text.endIndex, text[j] == "/" else { return false }
        return true
    }

    fileprivate static func targets(from matches: [Range<String.Index>], in text: String) -> [PathTarget] {
        matches.compactMap { range in
            let raw = String(text[range])
            guard let url = fileURL(fromCandidate: raw) else { return nil }
            let nsRange = NSRange(range, in: text)
            guard nsRange.location != NSNotFound else { return nil }
            return PathTarget(range: nsRange, url: url, path: url.path)
        }
    }

    fileprivate static func applyPathStyle(
        to attributed: AttributedString,
        plain: String,
        targets: [PathTarget],
        linkColor: Color?,
        skipExistingLinks: Bool
    ) -> AttributedString {
        var result = attributed
        for target in targets {
            guard let range = Range(target.range, in: plain) else { continue }
            guard let lower = AttributedString.Index(range.lowerBound, within: result),
                  let upper = AttributedString.Index(range.upperBound, within: result) else { continue }
            if skipExistingLinks, result[lower..<upper].link != nil { continue }
            var style = AttributeContainer()
            // 双 scope 写入：SwiftUI scope 供 SwiftUI Text（PathLinkedText），
            // AppKit scope 供 NSAttributedString 桥接（MarkdownSelectionContent → NSTextView）——
            // SwiftUI Color 不会自动桥接，必须显式写 NSColor。
            if let linkColor {
                style.foregroundColor = linkColor
                style.foregroundColor = NSColor(linkColor)
            }
            style.underlineStyle = .single
            // 文档类路径（md/txt…，可在右侧文档面板打开）加淡色背景高亮，一眼可辨。
            if DocumentDetector.isDocument(target.url) {
                style.backgroundColor = (linkColor ?? Color.accentColor).opacity(0.14)
                style.backgroundColor = NSColor(linkColor ?? Color.accentColor).withAlphaComponent(0.14)
            }
            result[lower..<upper].mergeAttributes(style)
        }
        return result
    }
}

// MARK: - Path scan / attributed render cache

/// Process-wide cache for path matches and default plain-text path renders.
/// Historical chat text is immutable → hits are zero-cost on session switch / view rebuild.
private final class PathLinkCache {
    static let shared = PathLinkCache()

    private let matchCache: NSCache<NSString, MatchBox> = {
        let c = NSCache<NSString, MatchBox>()
        c.countLimit = 500
        return c
    }()

    /// Default-styled plain renders only (`base` empty + accent link color).
    private let plainRenderCache: NSCache<NSString, RenderBox> = {
        let c = NSCache<NSString, RenderBox>()
        c.countLimit = 500
        return c
    }()

    /// Default-shape markdown attributed renders: the input attributed carries only
    /// markdown attributes (no caller-applied foreground color), link color is accent.
    /// Keyed by the plain characters — safe because the cached shape is fully determined
    /// by the input string in this code path (see `canCacheAttributed`).
    private let attributedRenderCache: NSCache<NSString, RenderBox> = {
        let c = NSCache<NSString, RenderBox>()
        c.countLimit = 1000
        return c
    }()

    private init() {}

    /// Stores UTF-16 ranges (not `String.Index`) so results rebind safely to any equal string.
    final class MatchBox {
        let utf16Ranges: [NSRange]
        let targets: [FileReveal.PathTarget]
        init(utf16Ranges: [NSRange], targets: [FileReveal.PathTarget]) {
            self.utf16Ranges = utf16Ranges
            self.targets = targets
        }
    }

    final class RenderBox {
        let visual: AttributedString
        let targets: [FileReveal.PathTarget]
        init(visual: AttributedString, targets: [FileReveal.PathTarget]) {
            self.visual = visual
            self.targets = targets
        }
    }

    func scan(_ text: String) -> MatchBox {
        let key = text as NSString
        if let hit = matchCache.object(forKey: key) {
            return hit
        }
        let computed = FileReveal.computeAbsolutePathMatches(in: text)
        let utf16Ranges = computed.map { NSRange($0, in: text) }.filter { $0.location != NSNotFound }
        let targets = FileReveal.targets(from: computed, in: text)
        let box = MatchBox(utf16Ranges: utf16Ranges, targets: targets)
        matchCache.setObject(box, forKey: key)
        return box
    }

    func targets(in text: String) -> [FileReveal.PathTarget] {
        scan(text).targets
    }

    func matches(in text: String) -> [Range<String.Index>] {
        scan(text).utf16Ranges.compactMap { Range($0, in: text) }
    }

    func plainContent(
        text: String,
        base: AttributeContainer,
        linkColor: Color?
    ) -> FileReveal.PathLinkedContent {
        let useCache = isDefaultPlainStyle(base: base, linkColor: linkColor)
        if useCache, let hit = plainRenderCache.object(forKey: text as NSString) {
            return FileReveal.PathLinkedContent(visual: hit.visual, targets: hit.targets)
        }

        let targets = self.targets(in: text)
        var result = AttributedString(text)
        result.mergeAttributes(base)
        let visual = FileReveal.applyPathStyle(
            to: result,
            plain: text,
            targets: targets,
            linkColor: linkColor,
            skipExistingLinks: false
        )
        if useCache {
            plainRenderCache.setObject(RenderBox(visual: visual, targets: targets), forKey: text as NSString)
        }
        return FileReveal.PathLinkedContent(visual: visual, targets: targets)
    }

    private func isDefaultPlainStyle(base: AttributeContainer, linkColor: Color?) -> Bool {
        // Only cache the common path used by PathLinkedText / Markdown prose.
        // Non-default base attributes are not part of the cache key.
        guard base == AttributeContainer() else { return false }
        guard let linkColor else { return false }
        return linkColor == Color.accentColor
    }

    // MARK: - Attributed (markdown block) render cache

    /// True only for the common markdown-block shape: accent link color and an attributed
    /// string whose runs carry **no** foreground color. `MarkdownTextView.inlineWithPaths`
    /// produces exactly this; callers that restyle (quote → `.secondary`) fail the guard and
    /// bypass the cache, so they cannot collide with a different-styled entry for the same text.
    func canCacheAttributed(_ attributed: AttributedString, linkColor: Color?) -> Bool {
        guard let linkColor, linkColor == Color.accentColor else { return false }
        // `inline` markdown output has no foreground color; a caller-applied override is the
        // only way one appears, and that is exactly the case we must not cache.
        for run in attributed.runs {
            if run.foregroundColor != nil { return false }
        }
        return true
    }

    func attributedContent(_ attributed: AttributedString) -> FileReveal.PathLinkedContent? {
        let key = String(attributed.characters) as NSString
        if let hit = attributedRenderCache.object(forKey: key) {
            return FileReveal.PathLinkedContent(visual: hit.visual, targets: hit.targets)
        }
        return nil
    }

    func storeAttributed(_ content: FileReveal.PathLinkedContent, for attributed: AttributedString) {
        let key = String(attributed.characters) as NSString
        attributedRenderCache.setObject(
            RenderBox(visual: content.visual, targets: content.targets),
            forKey: key
        )
    }

    func removeAllObjects() {
        matchCache.removeAllObjects()
        plainRenderCache.removeAllObjects()
        attributedRenderCache.removeAllObjects()
    }
}
