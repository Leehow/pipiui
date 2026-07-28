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
    let id: String
    let role: String
    let text: String
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

    static func snapshot(
        sessionID: String,
        session: ChatSession,
        homeDirectory: String = FileManager.default.homeDirectoryForCurrentUser.path
    ) -> RemoteSessionSnapshotPayload {
        var items = session.transcript
        if let streaming = session.streamingItem {
            items.append(streaming)
        }
        let messages = normalizedMessages(
            items,
            projectPath: session.projectURL.path,
            homeDirectory: homeDirectory
        )
        return RemoteSessionSnapshotPayload(
            sessionID: sessionID,
            title: sanitizedTitle(session.displayTitle),
            messages: messages,
            isGenerating: session.isStreaming,
            isStopping: session.isStopping,
            isInitializing: session.isInitializing,
            processAlive: session.processAlive,
            queuedPromptCount: session.messageQueue.count,
            error: session.lastError.map {
                redactKnownLocalPaths(
                    $0,
                    projectPath: session.projectURL.path,
                    homeDirectory: homeDirectory
                )
            }
        )
    }

    static func normalizedMessages(
        _ items: [ChatItem],
        projectPath: String,
        homeDirectory: String
    ) -> [RemoteTranscriptMessageDTO] {
        items.enumerated().compactMap { index, item -> RemoteTranscriptMessageDTO? in
            let pieces = item.blocks.compactMap { block -> String? in
                switch block {
                case .text(let text):
                    return text
                case .thinking, .toolCall, .image, .video:
                    // The local MVP exposes conversational text only. Tool payloads,
                    // thinking, media bytes and local media paths stay on the Mac.
                    return nil
                }
            }
            let text = redactKnownLocalPaths(
                pieces.joined(separator: "\n"),
                projectPath: projectPath,
                homeDirectory: homeDirectory
            ).trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return nil }
            let role: String
            switch item.role {
            case "user", "assistant", "system":
                role = item.role
            default:
                role = "system"
            }
            return RemoteTranscriptMessageDTO(id: "m-\(index)", role: role, text: text)
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
