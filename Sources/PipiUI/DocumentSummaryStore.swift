import Foundation

/// Pure, character-based summary truncation (safe for CJK and composed characters).
package enum DocumentSummaryTruncation {
    package static func truncate(
        _ text: String,
        maxChars: Int = 240,
        maxLines: Int = 6
    ) -> String {
        guard maxChars > 0, maxLines > 0 else { return "" }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }

        let allLines = trimmed.split(separator: "\n", omittingEmptySubsequences: false)
        let wasLineCut = allLines.count > maxLines
        var result = allLines.prefix(maxLines).joined(separator: "\n")
        let wasCharacterCut = result.count > maxChars
        let wasCut = wasLineCut || wasCharacterCut

        if wasCut {
            result = String(result.prefix(max(0, maxChars - 1)))
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return result + "…"
        }
        return result
    }
}

/// Off-main, process-cached summaries used by document reference cards.
///
/// The only method called by SwiftUI rendering is `entry(for:)`, a cache lookup with no
/// filesystem access. `request(for:kind:)` installs `.loading` synchronously, then performs
/// all attributes/data work on a utility queue.
@MainActor
package final class DocumentSummaryStore: ObservableObject {
    package struct Summary: Equatable, Sendable {
        package let text: String
        package init(_ text: String) { self.text = text }
    }

    package struct Entry: Equatable, Sendable {
        package enum State: Equatable, Sendable {
            case loading
            case loaded(Summary)
            case missing
            case tooLarge(size: Int)
            case unreadable
        }

        package let state: State
        package init(state: State) { self.state = state }
    }

    package typealias Loader = @Sendable (URL, DocumentKind) -> Entry
    package static let shared = DocumentSummaryStore()

    private final class Box: NSObject {
        let entry: Entry
        init(_ entry: Entry) { self.entry = entry }
    }

    private let cache: NSCache<NSString, Box>
    private let loader: Loader

    package init(loader: Loader? = nil) {
        let cache = NSCache<NSString, Box>()
        cache.countLimit = 1_000
        self.cache = cache
        self.loader = loader ?? { url, kind in
            Self.compute(url: url, kind: kind)
        }
    }

    /// Synchronous cache lookup only. A cache miss is represented as `.loading`.
    package func entry(for absolutePath: String) -> Entry {
        cache.object(forKey: absolutePath as NSString)?.entry ?? Entry(state: .loading)
    }

    /// Starts at most one load for an absolute path during this cache's lifetime.
    package func request(for url: URL, kind: DocumentKind) {
        let normalizedURL = url.standardizedFileURL
        let path = normalizedURL.path
        let key = path as NSString
        guard cache.object(forKey: key) == nil else { return }

        cache.setObject(Box(Entry(state: .loading)), forKey: key)
        let loader = self.loader
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let result = loader(normalizedURL, kind)
            Task { @MainActor in
                guard let self else { return }
                self.cache.setObject(Box(result), forKey: path as NSString)
                self.objectWillChange.send()
            }
        }
    }

    /// Deterministic cache seam used by pure view-state tests; performs no IO.
    package func setEntryForTesting(_ entry: Entry, for absolutePath: String) {
        cache.setObject(Box(entry), forKey: absolutePath as NSString)
        objectWillChange.send()
    }

    private nonisolated static func compute(url: URL, kind: DocumentKind) -> Entry {
        let path = url.path
        guard FileManager.default.fileExists(atPath: path) else {
            return Entry(state: .missing)
        }

        do {
            let attributes = try FileManager.default.attributesOfItem(atPath: path)
            let size = (attributes[.size] as? NSNumber)?.intValue ?? 0
            let sizeLimit = kind == .pdf
                ? DocumentStore.pdfMaxFileSize
                : DocumentStore.maxFileSize
            guard size <= sizeLimit else {
                return Entry(state: .tooLarge(size: size))
            }

            if kind == .pdf {
                return Entry(state: .loaded(Summary("PDF 文档")))
            }

            let data = try Data(contentsOf: url, options: [.mappedIfSafe])
            let decoded = String(decoding: data, as: UTF8.self)
            return Entry(state: .loaded(Summary(DocumentSummaryTruncation.truncate(decoded))))
        } catch {
            return Entry(state: .unreadable)
        }
    }
}
