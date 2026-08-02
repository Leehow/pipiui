import Foundation

struct RemoteProjectDTO: Codable, Equatable, Sendable {
    let id: String
    let name: String
}

struct RemoteSessionSummaryDTO: Codable, Equatable, Sendable {
    let id: String
    let projectID: String
    let title: String
    let isOpen: Bool
    let isGenerating: Bool
}

struct RemoteIndexDTO: Codable, Equatable, Sendable {
    let projects: [RemoteProjectDTO]
    let sessions: [RemoteSessionSummaryDTO]
}

struct RemoteTranscriptMessageDTO: Codable, Equatable, Sendable {
    enum Kind: String, Codable, Equatable, Sendable {
        /// Conversational text (user/assistant/system).
        case text
        /// A tool call record. Only the tool name and the redacted argument
        /// summary leave the Mac; payloads never do.
        case tool
        /// The mere fact that the assistant is/was thinking. The thinking
        /// content itself never leaves the Mac.
        case thinking
    }

    let id: String
    let role: String
    let kind: Kind
    let text: String
    let toolName: String?
    let toolSummary: String?

    init(
        id: String,
        role: String,
        kind: Kind = .text,
        text: String,
        toolName: String? = nil,
        toolSummary: String? = nil
    ) {
        self.id = id
        self.role = role
        self.kind = kind
        self.text = text
        self.toolName = toolName
        self.toolSummary = toolSummary
    }
}

struct RemoteSessionSnapshotPayload: Codable, Equatable, Sendable {
    let sessionID: String
    let title: String
    let messages: [RemoteTranscriptMessageDTO]
    let isGenerating: Bool
    let isStopping: Bool
    let isInitializing: Bool
    let processAlive: Bool
    let queuedPromptCount: Int
    let error: String?
}

struct RemoteSessionSnapshotDTO: Codable, Equatable, Sendable {
    let revision: UInt64
    let snapshot: RemoteSessionSnapshotPayload
}

enum RemoteTranscriptNormalizer {
    private static let genericAbsolutePathRegex = try! NSRegularExpression(
        pattern: #"(?<![A-Za-z0-9_:/])/(?:[^\s/"'<>\[\]\(\)\{\}]+/)+[^\s"'<>\[\]\(\)\{\}]+"#
    )

    static func normalizedMessages(
        _ items: [ChatItem],
        startingIndex: Int = 0,
        projectPath: String,
        homeDirectory: String
    ) -> [RemoteTranscriptMessageDTO] {
        items.enumerated().flatMap { index, item -> [RemoteTranscriptMessageDTO] in
            let role = sanitizedRole(item.role)
            let baseID = "m-\(startingIndex + index)"
            guard role == "assistant" else {
                // User/system entries keep the original behavior: text blocks
                // joined into a single message, everything else stays local.
                let pieces = item.blocks.compactMap { block -> String? in
                    if case .text(let text) = block { return text }
                    return nil
                }
                let text = redactKnownLocalPaths(
                    pieces.joined(separator: "\n"),
                    projectPath: projectPath,
                    homeDirectory: homeDirectory
                ).trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty else { return [] }
                return [RemoteTranscriptMessageDTO(id: baseID, role: role, text: text)]
            }

            // Assistant entries expose the in-between progress in block order:
            // text stays text, tool calls become name + redacted summary
            // records, thinking becomes a content-free indicator. Tool
            // payloads, thinking content, media bytes and local media paths
            // never leave the Mac.
            var entries: [RemoteTranscriptMessageDTO] = []
            for block in item.blocks {
                let entryID = "\(baseID)-\(entries.count)"
                switch block {
                case .text(let rawText):
                    let text = redactKnownLocalPaths(
                        rawText,
                        projectPath: projectPath,
                        homeDirectory: homeDirectory
                    ).trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !text.isEmpty else { continue }
                    entries.append(RemoteTranscriptMessageDTO(
                        id: entryID,
                        role: role,
                        text: text
                    ))
                case .toolCall(let tool):
                    let summary = redactKnownLocalPaths(
                        tool.argsSummary,
                        projectPath: projectPath,
                        homeDirectory: homeDirectory
                    ).trimmingCharacters(in: .whitespacesAndNewlines)
                    entries.append(RemoteTranscriptMessageDTO(
                        id: entryID,
                        role: role,
                        kind: .tool,
                        text: "",
                        toolName: tool.name,
                        toolSummary: summary.isEmpty ? nil : summary
                    ))
                case .thinking:
                    entries.append(RemoteTranscriptMessageDTO(
                        id: entryID,
                        role: role,
                        kind: .thinking,
                        text: ""
                    ))
                case .image, .video:
                    continue
                }
            }
            return entries
        }
    }

    private static func sanitizedRole(_ role: String) -> String {
        switch role {
        case "user", "assistant", "system":
            return role
        default:
            return "system"
        }
    }

    static func redactKnownLocalPaths(
        _ text: String,
        projectPath: String,
        homeDirectory: String
    ) -> String {
        let fullRange = NSRange(text.startIndex..<text.endIndex, in: text)
        var result = genericAbsolutePathRegex.stringByReplacingMatches(
            in: text,
            range: fullRange,
            withTemplate: "[local path]"
        )
        let candidates = [projectPath, homeDirectory]
            .filter { !$0.isEmpty && $0 != "/" }
            .sorted { $0.count > $1.count }
        for path in candidates {
            result = result.replacingOccurrences(
                of: "file://\(path)",
                with: "[local path]"
            )
            result = result.replacingOccurrences(of: path, with: "[local path]")
        }
        return result
    }

    static func sanitizedTitle(_ title: String) -> String {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "新会话" : String(trimmed.prefix(160))
    }
}

enum RemotePromptPolicy {
    static func rejectedBuiltinName(in text: String) -> String? {
        guard let invocation = BuiltinCommands.parseInvocation(text),
              BuiltinCommands.command(named: invocation.name) != nil else {
            return nil
        }
        return invocation.name
    }
}
