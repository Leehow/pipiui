import Foundation

/// Collapse long user-message bubbles to a short preview until expanded.
enum UserMessageCollapse {
    static let maxLinesWithoutCollapse = 5
    static let maxCharsWithoutCollapse = 1000
    static let previewMaxLines = 5
    static let previewMaxChars = 400

    static func shouldCollapse(_ text: String) -> Bool {
        if text.count > maxCharsWithoutCollapse { return true }
        let lineCount = text.split(separator: "\n", omittingEmptySubsequences: false).count
        return lineCount > maxLinesWithoutCollapse
    }

    static func preview(
        _ text: String,
        maxLines: Int = previewMaxLines,
        maxChars: Int = previewMaxChars
    ) -> String {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
        let head = lines.prefix(max(0, maxLines)).map(String.init).joined(separator: "\n")
        guard head.count > maxChars else { return head }
        let end = head.index(head.startIndex, offsetBy: maxChars)
        return String(head[..<end])
    }
}
