import Foundation

/// Deterministic scheduling for progressive session-metadata discovery.
/// File content is never touched here: callers stat first, then parse these batches.
enum SessionMetadataProgressiveLoadPlan {
    struct File: Hashable {
        let path: String
        let modified: Date
        let isArchived: Bool
        let isPinned: Bool
    }

    static let firstBatchMinimum = SidebarListLimits.sessions
    static let backgroundBatchSize = 20

    /// Prioritize every active pinned session (needed by the global pinned section),
    /// then the newest active sessions needed for the initial sidebar viewport.
    /// Archived files remain background work. A path appears in exactly one batch.
    static func batches(
        files: [File],
        firstBatchMinimum: Int = firstBatchMinimum,
        backgroundBatchSize: Int = backgroundBatchSize
    ) -> [[File]] {
        let sorted = files.sorted { lhs, rhs in
            if lhs.modified != rhs.modified { return lhs.modified > rhs.modified }
            return lhs.path < rhs.path
        }
        let pinned = sorted.filter { $0.isPinned && !$0.isArchived }
        let newestActive = sorted.filter { !$0.isArchived && !$0.isPinned }
            .prefix(max(0, firstBatchMinimum))
        let first = pinned + newestActive
        let firstPaths = Set(first.map(\.path))
        let remainder = sorted.filter { !firstPaths.contains($0.path) }

        guard !first.isEmpty else {
            return remainder.chunked(into: max(1, backgroundBatchSize))
        }
        return [first] + remainder.chunked(into: max(1, backgroundBatchSize))
    }

    /// A stale refresh must never publish over a newer refresh for the same project.
    static func acceptsPublish(candidateGeneration: UInt, currentGeneration: UInt) -> Bool {
        candidateGeneration == currentGeneration
    }
}

private extension Array {
    func chunked(into size: Int) -> [[Element]] {
        stride(from: 0, to: count, by: size).map { start in
            Array(self[start..<Swift.min(start + size, count)])
        }
    }
}
