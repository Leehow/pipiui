import Foundation

enum PromptSearchGrantPolicy: Equatable {
    /// Direct local human input replaces the grant with paths in this prompt.
    case localHumanRecordPromptPaths
    /// App-generated orchestration text is not human authorization and leaves
    /// the latest human grant untouched.
    case appAuthoredPreserveLatestHumanGrant
    /// Remote input is not local human authorization and explicitly revokes
    /// any grant inherited from an earlier local turn.
    case remoteClearGrant
}

struct QueuedMessage: Identifiable {
    let id: UUID
    var text: String
    var images: [DraftImage]
    var searchGrantPolicy: PromptSearchGrantPolicy
    /// 该消息已注入非视觉模型 caption：出站 RPC 需剥掉 `images`（缩略图仍保留）。
    var stripImagesForRPC: Bool

    init(
        id: UUID = UUID(),
        text: String,
        images: [DraftImage] = [],
        searchGrantPolicy: PromptSearchGrantPolicy = .localHumanRecordPromptPaths,
        stripImagesForRPC: Bool = false
    ) {
        self.id = id
        self.text = text
        self.images = images
        self.searchGrantPolicy = searchGrantPolicy
        self.stripImagesForRPC = stripImagesForRPC
    }
}

/// Pure session follow-up queue (no RPC). ChatSession owns one instance.
struct SessionMessageQueue {
    private(set) var items: [QueuedMessage] = []
    private(set) var interceptSendFirst = false
    /// Cut-in armed: the next idle drain joins ALL queued messages into one prompt
    /// instead of popping the head. Normal Stop / settle drains stay single-item.
    private(set) var cutInJoinArmed = false

    var isEmpty: Bool { items.isEmpty }
    var count: Int { items.count }

    /// Enqueue a follow-up. `text` should already include attachment path footnotes if any.
    @discardableResult
    mutating func enqueue(
        text: String,
        images: [DraftImage] = [],
        searchGrantPolicy: PromptSearchGrantPolicy = .localHumanRecordPromptPaths,
        stripImagesForRPC: Bool = false
    ) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty || !images.isEmpty else { return false }
        items.append(QueuedMessage(
            text: text,
            images: images,
            searchGrantPolicy: searchGrantPolicy,
            stripImagesForRPC: stripImagesForRPC
        ))
        return true
    }

    mutating func restoreAll() -> (text: String, images: [DraftImage]) {
        let texts = items.map(\.text)
        let images = items.flatMap(\.images)
        items.removeAll()
        interceptSendFirst = false
        cutInJoinArmed = false
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

    /// Arm the cut-in batch join (idempotent; rapid double-clicks must not double-send).
    mutating func armCutInJoin() {
        cutInJoinArmed = true
    }

    /// Cut-in batch pop: only when armed. Returns ALL queued items FIFO and clears the
    /// armed flag + intercept. nil when not armed, still streaming, or process dead;
    /// armed-but-empty consumes the flag and also returns nil.
    mutating func popAllForCutIn(isStreaming: Bool, processAlive: Bool) -> [QueuedMessage]? {
        guard cutInJoinArmed else { return nil }
        guard processAlive, !isStreaming else { return nil }
        cutInJoinArmed = false
        interceptSendFirst = false
        guard !items.isEmpty else { return nil }
        let all = items
        items.removeAll()
        return all
    }

    /// Merge a cut-in batch into one prompt: joinTexts separator, images appended in FIFO
    /// order, and the policy of the last human-authored item (local or remote) — falling
    /// back to app-authored preserve-grant when the batch is purely app-generated.
    static func joinedCutIn(_ batch: [QueuedMessage]) -> QueuedMessage {
        var policy = PromptSearchGrantPolicy.appAuthoredPreserveLatestHumanGrant
        for msg in batch.reversed() where msg.searchGrantPolicy != .appAuthoredPreserveLatestHumanGrant {
            policy = msg.searchGrantPolicy
            break
        }
        return QueuedMessage(
            text: joinTexts(batch.map(\.text)),
            images: batch.flatMap(\.images),
            searchGrantPolicy: policy,
            // 同一会话模型能力一致：仅当整批都经 caption 注入才剥图，避免误伤未注入消息。
            stripImagesForRPC: !batch.isEmpty && batch.allSatisfy(\.stripImagesForRPC)
        )
    }
}
