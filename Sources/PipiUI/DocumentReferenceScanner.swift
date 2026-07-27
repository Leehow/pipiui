import Foundation

/// A locally-previewable document mentioned in transcript text.
///
/// `url` is always an absolute, standardized file URL. The source range is retained for
/// future inline-path affordances, while v1 renders a sibling card below the message.
package struct DocumentReference: Equatable, Identifiable {
    package enum Origin: String, Equatable {
        case absolute
        case fileURL
        case tilde
        case relativeResolved
        case uiFallback
    }

    package let url: URL
    package let title: String
    package let sourceRange: NSRange
    package let origin: Origin

    package init(url: URL, title: String, sourceRange: NSRange, origin: Origin) {
        self.url = url.standardizedFileURL
        self.title = title
        self.sourceRange = sourceRange
        self.origin = origin
    }

    package var id: String { url.path }
}

/// Pure path-normalization layer shared by document-reference card surfaces.
///
/// This type never probes the filesystem. Relative references remain speculative until the
/// off-main summary loader publishes their state.
package enum DocumentReferenceScanner {
    package static func references(in text: String, base: URL?) -> [DocumentReference] {
        // FileReveal correctly recognizes the slash portion of "~/x.md" as "/x.md" for its
        // absolute-path UI, but this scanner must let the full tilde token own that range.
        let absoluteRanges = FileReveal.absolutePathMatches(in: text).filter { range in
            guard range.lowerBound > text.startIndex else { return true }
            return text[text.index(before: range.lowerBound)] != "~"
        }
        var candidates: [DocumentReference] = []

        for range in absoluteRanges {
            let raw = String(text[range])
            guard let parsed = FileReveal.fileURL(fromCandidate: raw) else { continue }
            let url = parsed.standardizedFileURL
            guard DocumentDetector.kind(for: url) != nil else { continue }
            candidates.append(DocumentReference(
                url: url,
                title: url.lastPathComponent,
                sourceRange: NSRange(range, in: text),
                origin: raw.lowercased().hasPrefix("file://") ? .fileURL : .absolute
            ))
        }

        for range in tokenRanges(in: text) {
            guard !absoluteRanges.contains(where: { $0.overlaps(range) }) else { continue }
            let raw = String(text[range])
            let token = FileReveal.stripTrailingPunctuation(raw)
            guard !token.isEmpty,
                  let reference = reference(
                    forToken: token,
                    range: NSRange(range, in: text),
                    base: base
                  )
            else { continue }
            candidates.append(reference)
        }

        candidates.sort {
            if $0.sourceRange.location == $1.sourceRange.location {
                return $0.sourceRange.length > $1.sourceRange.length
            }
            return $0.sourceRange.location < $1.sourceRange.location
        }

        var seen: Set<String> = []
        return candidates.filter { seen.insert($0.id).inserted }
    }

    /// Applies the filesystem existence result supplied by an off-main caller.
    ///
    /// Explicit paths remain visible even when missing so the card can explain the failure.
    /// Relative and bare-filename matches are speculative and only survive when confirmed.
    package static func filterExisting(
        _ references: [DocumentReference],
        fileExists: (URL) -> Bool
    ) -> [DocumentReference] {
        references.filter { reference in
            switch reference.origin {
            case .absolute, .fileURL, .tilde:
                return true
            case .relativeResolved, .uiFallback:
                return fileExists(reference.url)
            }
        }
    }

    /// A subagent's worktree is authoritative for its own output; the main project is fallback.
    package static func effectiveBase(worktreePath: String?, projectURL: URL?) -> URL? {
        if let worktreePath,
           !worktreePath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let expanded = (worktreePath as NSString).expandingTildeInPath
            return URL(fileURLWithPath: expanded, isDirectory: true).standardizedFileURL
        }
        return projectURL?.standardizedFileURL
    }

    private static func reference(
        forToken token: String,
        range: NSRange,
        base: URL?
    ) -> DocumentReference? {
        let lower = token.lowercased()
        guard !lower.hasPrefix("http://"), !lower.hasPrefix("https://") else { return nil }

        if token.hasPrefix("~/") {
            let expanded = (token as NSString).expandingTildeInPath
            let url = URL(fileURLWithPath: expanded).standardizedFileURL
            guard DocumentDetector.kind(for: url) != nil else { return nil }
            return makeReference(url: url, range: range, origin: .tilde)
        }

        if token.contains("/") || token.contains("\\") {
            guard !token.hasPrefix("/"), let base else { return nil }
            let normalizedToken = token.replacingOccurrences(of: "\\", with: "/")
            let url = base.appendingPathComponent(normalizedToken).standardizedFileURL
            guard DocumentDetector.kind(for: url) != nil else { return nil }
            return makeReference(url: url, range: range, origin: .relativeResolved)
        }

        guard let base else { return nil }
        let lowerBasename = token.lowercased()
        let ext = (token as NSString).pathExtension.lowercased()
        let recognizedBareName = DocumentDetector.docBasenames.contains(lowerBasename)
        let recognizedExtension =
            DocumentDetector.markdownExtensions.contains(ext)
            || DocumentDetector.plainTextExtensions.contains(ext)
            || DocumentDetector.pdfExtensions.contains(ext)
        guard recognizedBareName || recognizedExtension else { return nil }

        let url = base.appendingPathComponent(token).standardizedFileURL
        guard DocumentDetector.kind(for: url) != nil else { return nil }
        return makeReference(url: url, range: range, origin: .uiFallback)
    }

    private static func makeReference(
        url: URL,
        range: NSRange,
        origin: DocumentReference.Origin
    ) -> DocumentReference {
        DocumentReference(
            url: url,
            title: url.lastPathComponent,
            sourceRange: range,
            origin: origin
        )
    }

    /// Maximal path-like tokens, stopping at whitespace and prose punctuation.
    private static func tokenRanges(in text: String) -> [Range<String.Index>] {
        let breakers = CharacterSet.whitespacesAndNewlines.union(
            CharacterSet(charactersIn: "<>\"'`()[]{}|,;。，；：、？！…—（）【】《》「」『』〈〉～·→←↑↓")
        )
        var ranges: [Range<String.Index>] = []
        var index = text.startIndex

        while index < text.endIndex {
            if text[index].unicodeScalars.contains(where: { breakers.contains($0) }) {
                index = text.index(after: index)
                continue
            }
            let start = index
            while index < text.endIndex,
                  !text[index].unicodeScalars.contains(where: { breakers.contains($0) }) {
                index = text.index(after: index)
            }
            ranges.append(start..<index)
        }
        return ranges
    }
}
