import Foundation

/// Deterministic one-line subtitle for the chat detail title bar.
///
/// The primary title stays `session.displayTitle`; the subtitle shows the first
/// real user-authored message (one line, `…`-truncated), falling back to the
/// project basename for empty sessions. Runtime worker signals (`[subagent-done]`,
/// `[worktree-merge-failed]`) and session-title generation markers are never
/// treated as user content.
enum SessionSubtitleLogic {
    /// Character budget for the one-line subtitle display.
    static let maxCharacters = 80

    /// Full (untruncated) text of the first real user-authored message, or `nil`
    /// when the transcript has none.
    static func firstUserMessageText(from transcript: [ChatItem]) -> String? {
        for item in transcript {
            guard MessageActions.isUserAuthoredMessage(item) else { continue }
            let text = MessageActions.copyableText(from: item)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty, !isInternalTitleMarker(text) else { continue }
            return text
        }
        return nil
    }

    /// Deterministic one-line display: whitespace/newlines collapse to single
    /// spaces; text longer than `maxCharacters` keeps a `maxCharacters` prefix
    /// followed by `…`. Short text is returned unchanged (full string preserved
    /// for the detail popover).
    static func oneLine(
        _ text: String,
        maxCharacters: Int = SessionSubtitleLogic.maxCharacters
    ) -> String {
        let collapsed = text
            .split(whereSeparator: { $0.isWhitespace || $0.isNewline })
            .joined(separator: " ")
        guard maxCharacters > 0, collapsed.count > maxCharacters else { return collapsed }
        return String(collapsed.prefix(maxCharacters)) + "…"
    }

    /// Ghost title-generation prompts (old sessions) and orphan side-channel
    /// title sessions are internal bookkeeping, never user content.
    private static func isInternalTitleMarker(_ text: String) -> Bool {
        text.contains(ChatSession.sessionTitleJobMarker)
            || text.contains("Write a short session title")
    }
}
