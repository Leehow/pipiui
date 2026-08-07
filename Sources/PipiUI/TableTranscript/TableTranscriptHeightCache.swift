import Foundation
import CoreGraphics

/// POC row-height cache for the NSTableView transcript.
///
/// Prefer measured hosting heights. Unmeasured rows fall back to a coarse estimate
/// until the cell lays out and reports back. Phase-2 should feed Markdown
/// `measuredHeight` / TranscriptPlanner estimates before first paint.
final class TableTranscriptHeightCache {
    /// Coarse default used before a cell has measured itself.
    static let defaultEstimate: CGFloat = 72
    static let minimumRowHeight: CGFloat = 28
    static let maximumSaneRowHeight: CGFloat = 20_000

    private var heights: [String: CGFloat] = [:]
    private var widthKey: CGFloat = 0

    /// Invalidate when the chat column width changes enough to reflow markdown.
    func noteContentWidth(_ width: CGFloat) {
        let quantized = quantize(width)
        guard abs(quantized - widthKey) >= 0.5 else { return }
        widthKey = quantized
        heights.removeAll(keepingCapacity: true)
    }

    func height(for id: String) -> CGFloat? {
        heights[id]
    }

    /// - Returns: `true` when the stored height changed enough to notify the table.
    @discardableResult
    func store(id: String, height: CGFloat) -> Bool {
        let clamped = Self.clamp(height)
        if let previous = heights[id], abs(previous - clamped) < 0.5 {
            return false
        }
        heights[id] = clamped
        return true
    }

    func remove(ids: Set<String>) {
        for id in ids { heights.removeValue(forKey: id) }
    }

    static func clamp(_ height: CGFloat) -> CGFloat {
        guard height.isFinite else { return defaultEstimate }
        return min(max(height, minimumRowHeight), maximumSaneRowHeight)
    }

    private func quantize(_ width: CGFloat) -> CGFloat {
        guard width.isFinite, width > 0 else { return 0 }
        return (width * 2).rounded() / 2
    }
}
