import Foundation

struct QueuedMessage: Identifiable {
    let id: UUID
    var text: String
    var images: [DraftImage]

    init(id: UUID = UUID(), text: String, images: [DraftImage] = []) {
        self.id = id
        self.text = text
        self.images = images
    }
}

/// Pure session follow-up queue (no RPC). ChatSession owns one instance.
struct SessionMessageQueue {
    private(set) var items: [QueuedMessage] = []
    private(set) var interceptSendFirst = false

    var isEmpty: Bool { items.isEmpty }
    var count: Int { items.count }

    /// Enqueue a follow-up. `text` should already include attachment path footnotes if any.
    @discardableResult
    mutating func enqueue(text: String, images: [DraftImage] = []) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty || !images.isEmpty else { return false }
        items.append(QueuedMessage(text: text, images: images))
        return true
    }

    mutating func restoreAll() -> (text: String, images: [DraftImage]) {
        let texts = items.map(\.text)
        let images = items.flatMap(\.images)
        items.removeAll()
        interceptSendFirst = false
        return (Self.joinTexts(texts), images)
    }

    static func joinTexts(_ texts: [String]) -> String {
        texts.joined(separator: "\n\n")
    }

    mutating func noteAbort() {
        if !items.isEmpty { interceptSendFirst = true }
    }

    mutating func clearIntercept() {
        interceptSendFirst = false
    }

    /// Pop head when idle and alive. Clears intercept when popping or when queue empty.
    mutating func popForIdleDrain(isStreaming: Bool, processAlive: Bool) -> QueuedMessage? {
        if items.isEmpty {
            interceptSendFirst = false
            return nil
        }
        guard processAlive, !isStreaming else { return nil }
        interceptSendFirst = false
        return items.removeFirst()
    }

    mutating func requeueFront(_ msg: QueuedMessage) {
        items.insert(msg, at: 0)
    }
}
