import Foundation

// MARK: - Report

/// One distinct leaked control token and how often it appeared in visible text.
package struct LeakedTokenRow: Equatable {
    package let token: String
    package let count: Int
}

/// Two signals that distinguish "the model decided not to act" from "the tool call
/// never reached us". They look identical in the transcript, and the fixes differ.
///
/// `toolFreeRounds` counts model choice: a whole user-delimited round where nothing
/// was called. `leakedTokens` counts protocol failure: a chat-template control token
/// that surfaced as prose, which is what a tool call serialized into `content`
/// instead of `tool_calls` looks like from here.
package struct ToolCallHealthReport: Equatable {
    /// User-delimited rounds that contained at least one assistant block.
    package var rounds: Int = 0
    /// Rounds whose assistant blocks contained no tool call at all.
    package var toolFreeRounds: Int = 0
    /// Distinct leaked tokens, most frequent first.
    package var leakedTokens: [LeakedTokenRow] = []

    package var leakedTokenCount: Int {
        leakedTokens.reduce(0) { $0 + $1.count }
    }

    package var isClean: Bool {
        toolFreeRounds == 0 && leakedTokens.isEmpty
    }
}

// MARK: - Analysis

/// Pure analysis over the transcript. Deliberately carries no notion of *why* a
/// round used no tools — "did it refuse" is an open semantic question that only a
/// model can answer, so this reports the countable fact and stops there.
enum ToolCallHealth {
    static func compute(items: [ChatItem]) -> ToolCallHealthReport {
        var report = ToolCallHealthReport()
        var tokenCounts: [String: Int] = [:]

        // A round is delimited by user messages: the unit a person actually means by
        // "I asked it to do something and it didn't touch a single tool". Per-item
        // counting would flag every ordinary closing message, since the assistant
        // item that carries the final prose never carries the calls that preceded it.
        var roundHasAssistantBlock = false
        var roundHasToolCall = false

        func closeRound() {
            guard roundHasAssistantBlock else { return }
            report.rounds += 1
            if !roundHasToolCall { report.toolFreeRounds += 1 }
        }

        for item in items {
            if item.role == "user" {
                closeRound()
                roundHasAssistantBlock = false
                roundHasToolCall = false
                continue
            }
            guard item.role == "assistant" else { continue }
            for block in item.blocks {
                switch block {
                case .toolCall:
                    roundHasAssistantBlock = true
                    roundHasToolCall = true
                case .text(let text):
                    roundHasAssistantBlock = true
                    for token in leakedControlTokens(in: text) {
                        tokenCounts[token, default: 0] += 1
                    }
                case .thinking, .image, .video:
                    roundHasAssistantBlock = true
                }
            }
        }
        closeRound()

        report.leakedTokens = tokenCounts
            .map { LeakedTokenRow(token: $0.key, count: $0.value) }
            .sorted { $0.count != $1.count ? $0.count > $1.count : $0.token < $1.token }
        return report
    }

    // MARK: - Leaked control tokens

    /// Longest plausible inner run. A control token is short by construction; a long
    /// span between two delimiters is ordinary prose that happens to contain both.
    private static let maxTokenBody = 48

    /// Delimiter pairs used by chat templates to fence control tokens. DeepSeek's
    /// family uses the fullwidth form (`<｜tool▁calls▁begin｜>`); the ASCII form is
    /// what the V4 reports show leaking (`<|DSML|…`).
    private static let delimiters: [(open: String, close: String)] = [
        ("<|", "|>"),
        ("<｜", "｜>"),
    ]

    /// Every sentinel-shaped token found in visible text.
    ///
    /// Matched by *shape*, not against a list of known token spellings: a
    /// `<|…|>` sentinel is never legitimate prose, so the shape is the whole rule
    /// and any provider's leaked token is caught without maintaining a registry.
    /// The token is returned verbatim, so an unfamiliar one identifies itself.
    static func leakedControlTokens(in text: String) -> [String] {
        guard !text.isEmpty else { return [] }
        var found: [String] = []
        for (open, close) in delimiters {
            var cursor = text.startIndex
            while let start = text.range(of: open, range: cursor..<text.endIndex) {
                guard let end = text.range(of: close, range: start.upperBound..<text.endIndex) else {
                    break
                }
                let body = text[start.upperBound..<end.lowerBound]
                cursor = end.upperBound
                guard body.count <= maxTokenBody,
                      !body.contains(where: \.isNewline)
                else { continue }
                found.append(String(text[start.lowerBound..<end.upperBound]))
            }
        }
        return found
    }
}
