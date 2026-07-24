import Foundation

enum TaskPinLogic {
    /// Exact-match ack phrases (trimmed, Latin lowercased). Extend carefully — keep unit-tested.
    static let ackBlacklist: Set<String> = [
        "好的", "好", "继续", "ok", "okay", "yes", "y", "a", "b", "嗯", "行",
    ]

    static func plainText(of item: ChatItem) -> String {
        item.blocks.compactMap { block -> String? in
            if case .text(let t) = block { return t }
            return nil
        }.joined(separator: "\n")
    }

    static func displayText(of item: ChatItem) -> String {
        ImageAttachment.stripAttachmentPathsForDisplay(plainText(of: item))
    }

    static func hasImageAttachment(_ item: ChatItem) -> Bool {
        item.blocks.contains { if case .image = $0 { return true }; return false }
    }

    static func isPinnable(_ item: ChatItem) -> Bool {
        guard item.role == "user" else { return false }
        let display = displayText(of: item).trimmingCharacters(in: .whitespacesAndNewlines)
        let hasImage = hasImageAttachment(item)
        if display.hasPrefix("[subagent-done]") { return false }
        if display.contains("PipiUI internal") { return false }
        if display.isEmpty && !hasImage { return false }

        if hasImage { return true }

        let normalized = display.lowercased()
        if ackBlacklist.contains(normalized) { return false }

        // ≤2 grapheme clusters, no attachment → ack-like
        if display.count <= 2 { return false }

        if display.contains(where: \.isNewline) { return true }
        return true
    }

    static func latestPinnableUser(in items: [ChatItem]) -> ChatItem? {
        for item in items.reversed() where isPinnable(item) {
            return item
        }
        return nil
    }
}
