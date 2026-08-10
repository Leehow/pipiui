import Foundation

/// Incremental, stable-ID index of real user-authored prompts in a transcript.
///
/// Navigation and seek resolve against this projection rather than scanning
/// the full transcript or the currently mounted viewport window.
///
/// - Only `MessageActions.isNavigationEligibleHumanPrompt` items are indexed
///   (runtime/system injections that reuse the user role are excluded).
/// - Entries keep `ChatItem.id` as the stable message identity.
/// - True tail-append updates are caller-classified (O(1) watermarks) and only
///   scan the new suffix; they never walk prior transcript slots or refresh
///   existing summaries.
/// - Structural edits (insert/delete/reorder/in-place replace/full replace)
///   go through a full reconcile.
/// - Summaries are plain-text only: collapsed whitespace, light truncation,
///   no Markdown rendering. Content changes invalidate via a short UInt64
///   fingerprint — never a retained full-text copy of each prompt.
final class UserPromptIndex {
    struct Entry: Equatable {
        let messageID: String
        let summary: String
    }

    /// Maximum grapheme-cluster length for hover/nav summaries (excluding ellipsis).
    static let maxSummaryLength = 80

    private(set) var entries: [Entry] = []

    /// Transcript length last successfully applied (append watermark).
    private(set) var syncedCount = 0
    /// Parallel to `entries`: short source fingerprint for summary invalidation.
    /// Deliberately not a full-text copy of user input.
    private var sourceFingerprints: [UInt64] = []
    /// messageID → current transcript index.
    private var indexByID: [String: Int] = [:]

    // MARK: - Instrumentation (testable seams)

    /// Times `applyTailAppend` took the suffix-only path (no reconcile fallback).
    private(set) var appendFastPathCount: Int = 0
    /// Times a full reconcile ran (`apply` or append fallback).
    private(set) var reconcileCount: Int = 0
    /// Transcript slots visited on the last successful append fast path (`start..<count`).
    private(set) var lastAppendSuffixScanCount: Int = 0
    /// Existing-entry slots read/refreshed on the last successful append fast path.
    /// Must stay 0: append must not touch prior entries or their source text.
    private(set) var lastAppendExistingEntryTouchCount: Int = 0
    /// Cumulative transcript slots visited by append fast paths (suffix only).
    private(set) var totalAppendSuffixSlotsScanned: Int = 0
    /// Cumulative existing-entry touches during append fast paths (expect 0).
    private(set) var totalAppendExistingEntryTouches: Int = 0

    /// Ordered navigation nodes (oldest → newest).
    var messageIDs: [String] { entries.map(\.messageID) }

    /// Resolve a stable message ID to its current index in `transcript`, if present.
    func transcriptIndex(for messageID: String) -> Int? {
        indexByID[messageID]
    }

    /// Full authoritative sync. Always reconciles; used for structural mutations
    /// and for callers that do not classify the write.
    func apply(_ transcript: [ChatItem]) {
        reconcile(transcript)
    }

    /// Apply only when the watermark does not already match `transcript.count`.
    ///
    /// Used after init-time transcript assignment: `@Published` may or may not
    /// run `didSet` during `init`, so callers seed exactly once without a second
    /// full scan when the observer already advanced `syncedCount`.
    func applyIfStale(_ transcript: [ChatItem]) {
        guard syncedCount != transcript.count else { return }
        apply(transcript)
    }

    /// True tail-append fast path. Caller guarantees `transcript[0..<start]` is the
    /// unchanged prefix previously synced (typically `start == oldValue.count` after
    /// a pure `append`). Only `transcript[start...]` is inspected.
    ///
    /// Falls back to reconcile if `start` does not match the watermark.
    func applyTailAppend(_ transcript: [ChatItem], from start: Int) {
        guard start == syncedCount, start >= 0, transcript.count >= start else {
            reconcile(transcript)
            return
        }

        var suffixScanned = 0
        if transcript.count > start {
            for i in start..<transcript.count {
                suffixScanned &+= 1
                let item = transcript[i]
                guard MessageActions.isNavigationEligibleHumanPrompt(item) else { continue }
                // Defense: skip duplicate IDs (should not appear in a healthy transcript).
                if indexByID[item.id] != nil { continue }
                let text = Self.sourceText(for: item)
                let fp = Self.fingerprint(text)
                entries.append(Entry(messageID: item.id, summary: Self.summarize(text)))
                sourceFingerprints.append(fp)
                indexByID[item.id] = i
            }
        }

        // Intentionally no loop over `entries` / prior transcript prefix.
        lastAppendSuffixScanCount = suffixScanned
        lastAppendExistingEntryTouchCount = 0
        totalAppendSuffixSlotsScanned &+= suffixScanned
        // totalAppendExistingEntryTouches stays 0 by construction on this path.
        appendFastPathCount &+= 1
        syncedCount = transcript.count
    }

    /// Drop all state (session teardown / defensive reset).
    func reset() {
        entries = []
        syncedCount = 0
        sourceFingerprints = []
        indexByID = [:]
        // Keep counters so tests can observe lifetime behavior across resets if needed.
    }

    // MARK: - Summary

    /// Plain-text summary for a transcript item (user-authored or not).
    static func summary(for item: ChatItem) -> String {
        summarize(sourceText(for: item))
    }

    /// Collapse whitespace and lightly truncate. Leaves Markdown syntax intact
    /// as characters — never renders or strips markup structure.
    static func summarize(_ text: String) -> String {
        let collapsed = collapseWhitespace(text)
        guard !collapsed.isEmpty else { return "" }
        return truncate(collapsed, maxLength: maxSummaryLength)
    }

    static func sourceText(for item: ChatItem) -> String {
        MessageActions.copyableText(from: item)
    }

    /// Short stable fingerprint of source text for cache invalidation.
    /// Not cryptographic; only needs low accidental collision rate within a session.
    static func fingerprint(_ text: String) -> UInt64 {
        // FNV-1a 64-bit over UTF-8, mixed with length.
        var hash: UInt64 = 14_695_981_039_346_656_037
        let prime: UInt64 = 1_099_511_628_211
        var length = 0
        for byte in text.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* prime
            length &+= 1
        }
        hash ^= UInt64(length)
        hash = hash &* prime
        return hash
    }

    static func fingerprint(for item: ChatItem) -> UInt64 {
        fingerprint(sourceText(for: item))
    }

    static func collapseWhitespace(_ text: String) -> String {
        text.split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
    }

    static func truncate(_ text: String, maxLength: Int) -> String {
        guard maxLength > 0 else { return "" }
        if text.count <= maxLength { return text }
        let end = text.index(text.startIndex, offsetBy: maxLength)
        return String(text[..<end]) + "…"
    }

    // MARK: - Reconcile

    private func reconcile(_ transcript: [ChatItem]) {
        reconcileCount &+= 1

        var nextEntries: [Entry] = []
        var nextFingerprints: [UInt64] = []
        var nextMap: [String: Int] = [:]
        // Reuse prior summary when id + fingerprint are unchanged (no full-text retain).
        var priorByID: [String: (summary: String, fingerprint: UInt64)] = [:]
        priorByID.reserveCapacity(entries.count)
        for i in entries.indices {
            priorByID[entries[i].messageID] = (entries[i].summary, sourceFingerprints[i])
        }

        nextEntries.reserveCapacity(entries.count)
        nextFingerprints.reserveCapacity(entries.count)

        for (i, item) in transcript.enumerated() {
            guard MessageActions.isNavigationEligibleHumanPrompt(item) else { continue }
            // First occurrence wins; ignore later duplicates.
            if nextMap[item.id] != nil { continue }
            let text = Self.sourceText(for: item)
            let fp = Self.fingerprint(text)
            let summary: String
            if let prior = priorByID[item.id], prior.fingerprint == fp {
                summary = prior.summary
            } else {
                summary = Self.summarize(text)
            }
            nextEntries.append(Entry(messageID: item.id, summary: summary))
            nextFingerprints.append(fp)
            nextMap[item.id] = i
        }

        entries = nextEntries
        sourceFingerprints = nextFingerprints
        indexByID = nextMap
        syncedCount = transcript.count
    }
}
