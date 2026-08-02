import Foundation

/// Classifies transcript rows emitted by the built-in subagent extension
/// (Sources/PipiUI/PiExt/subagent/index.ts).
///
/// Heartbeats, stall notices, and done-message re-deliveries are background
/// signals delivered as user-role follow-ups. They must not yank the transcript
/// viewport to the bottom while the user is reading a completion summary —
/// the completion summary itself (`[subagent-done]`) still follows as usual.
enum SubagentSignalClassifier {
    /// Returns true only for a user-role item whose plain text opens with a
    /// background subagent signal prefix. First-time `[subagent-done]` summaries,
    /// assistant rows, ordinary user text, and nil all return false.
    static func isBackgroundSignal(item: ChatItem?) -> Bool {
        guard let item, item.role == "user" else { return false }
        let text = ChatSession.plainText(of: item)
        return text.hasPrefix("[subagent-heartbeat]")
            || text.hasPrefix("[subagent-stalled]")
            || text.hasPrefix("(re-delivery")
    }
}
