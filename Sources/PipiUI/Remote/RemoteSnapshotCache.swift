import Foundation

struct RemoteSnapshotCacheInput {
    let sessionID: String
    let title: String
    let transcriptVersion: UInt64
    let finalizedItems: [ChatItem]
    let streamingItem: ChatItem?
    let isGenerating: Bool
    let isStopping: Bool
    let isInitializing: Bool
    let processAlive: Bool
    let queuedPromptCount: Int
    let error: String?
    let projectPath: String
    let homeDirectory: String

    init(
        sessionID: String,
        session: ChatSession,
        homeDirectory: String = FileManager.default.homeDirectoryForCurrentUser.path
    ) {
        // Hidden sessions defer expensive live-message conversion until a consumer
        // requests it; snapshots are that consumer for remote viewers.
        session.materializeStreamingForSnapshot()
        self.sessionID = sessionID
        title = session.displayTitle
        transcriptVersion = session.transcriptVersion
        finalizedItems = session.transcript
        streamingItem = session.streamingItem
        isGenerating = session.isStreaming
        isStopping = session.isStopping
        isInitializing = session.isInitializing
        processAlive = session.processAlive
        queuedPromptCount = session.messageQueue.count
        error = session.lastError
        projectPath = session.projectURL.path
        self.homeDirectory = homeDirectory
    }

    init(
        sessionID: String,
        title: String,
        transcriptVersion: UInt64,
        finalizedItems: [ChatItem],
        streamingItem: ChatItem?,
        isGenerating: Bool = false,
        isStopping: Bool = false,
        isInitializing: Bool = false,
        processAlive: Bool = true,
        queuedPromptCount: Int = 0,
        error: String? = nil,
        projectPath: String,
        homeDirectory: String
    ) {
        self.sessionID = sessionID
        self.title = title
        self.transcriptVersion = transcriptVersion
        self.finalizedItems = finalizedItems
        self.streamingItem = streamingItem
        self.isGenerating = isGenerating
        self.isStopping = isStopping
        self.isInitializing = isInitializing
        self.processAlive = processAlive
        self.queuedPromptCount = queuedPromptCount
        self.error = error
        self.projectPath = projectPath
        self.homeDirectory = homeDirectory
    }
}

enum RemoteSnapshotCacheResolution {
    case notModified(revision: UInt64)
    case response(data: Data, revision: UInt64)
}

/// Main-thread-owned snapshot cache. An unchanged poll compares only cheap
/// counters/status plus the single streaming item; it does not traverse or
/// encode the finalized transcript.
final class RemoteSnapshotCache {
    private struct Fingerprint: Equatable {
        let transcriptVersion: UInt64
        let finalizedCount: Int
        let streamingItem: ChatItem?
        let title: String
        let isGenerating: Bool
        let isStopping: Bool
        let isInitializing: Bool
        let processAlive: Bool
        let queuedPromptCount: Int
        let error: String?
        let projectPath: String
        let homeDirectory: String
    }

    private struct Entry {
        let fingerprint: Fingerprint
        let finalizedMessages: [RemoteTranscriptMessageDTO]
        let streamingMessages: [RemoteTranscriptMessageDTO]
        let revision: UInt64
        let responseData: Data
    }

    private var entries: [String: Entry] = [:]
    private(set) var finalizedNormalizationCount = 0
    private(set) var streamingNormalizationCount = 0

    func resolve(
        _ input: RemoteSnapshotCacheInput,
        requestedRevision: UInt64?
    ) -> RemoteSnapshotCacheResolution {
        let fingerprint = Fingerprint(
            transcriptVersion: input.transcriptVersion,
            finalizedCount: input.finalizedItems.count,
            streamingItem: input.streamingItem,
            title: input.title,
            isGenerating: input.isGenerating,
            isStopping: input.isStopping,
            isInitializing: input.isInitializing,
            processAlive: input.processAlive,
            queuedPromptCount: input.queuedPromptCount,
            error: input.error,
            projectPath: input.projectPath,
            homeDirectory: input.homeDirectory
        )
        let previous = entries[input.sessionID]
        if let previous, previous.fingerprint == fingerprint {
            if requestedRevision == previous.revision {
                return .notModified(revision: previous.revision)
            }
            return .response(data: previous.responseData, revision: previous.revision)
        }

        let canReuseFinalized = previous?.fingerprint.transcriptVersion
            == input.transcriptVersion
            && previous?.fingerprint.finalizedCount == input.finalizedItems.count
            && previous?.fingerprint.projectPath == input.projectPath
            && previous?.fingerprint.homeDirectory == input.homeDirectory
        let finalizedMessages: [RemoteTranscriptMessageDTO]
        if canReuseFinalized, let previous {
            finalizedMessages = previous.finalizedMessages
        } else {
            finalizedMessages = RemoteTranscriptNormalizer.normalizedMessages(
                input.finalizedItems,
                projectPath: input.projectPath,
                homeDirectory: input.homeDirectory
            )
            finalizedNormalizationCount += 1
        }

        let canReuseStreaming = canReuseFinalized
            && previous?.fingerprint.streamingItem == input.streamingItem
        let streamingMessages: [RemoteTranscriptMessageDTO]
        if canReuseStreaming, let previous {
            streamingMessages = previous.streamingMessages
        } else if let streamingItem = input.streamingItem {
            streamingMessages = RemoteTranscriptNormalizer.normalizedMessages(
                [streamingItem],
                startingIndex: input.finalizedItems.count,
                projectPath: input.projectPath,
                homeDirectory: input.homeDirectory
            )
            streamingNormalizationCount += 1
        } else {
            streamingMessages = []
        }

        let messages = finalizedMessages + streamingMessages
        let title = RemoteTranscriptNormalizer.redactKnownLocalPaths(
            RemoteTranscriptNormalizer.sanitizedTitle(input.title),
            projectPath: input.projectPath,
            homeDirectory: input.homeDirectory
        )
        let error = input.error.map {
            RemoteTranscriptNormalizer.redactKnownLocalPaths(
                $0,
                projectPath: input.projectPath,
                homeDirectory: input.homeDirectory
            )
        }
        let payload = RemoteSessionSnapshotPayload(
            sessionID: input.sessionID,
            title: title,
            messages: messages,
            isGenerating: input.isGenerating,
            isStopping: input.isStopping,
            isInitializing: input.isInitializing,
            processAlive: input.processAlive,
            queuedPromptCount: input.queuedPromptCount,
            error: error
        )
        let revision = (previous?.revision ?? 0) &+ 1
        let response = RemoteSessionSnapshotDTO(revision: revision, snapshot: payload)
        let data = (try? JSONEncoder().encode(response))
            ?? Data(#"{"error":"response encoding failed"}"#.utf8)
        entries[input.sessionID] = Entry(
            fingerprint: fingerprint,
            finalizedMessages: finalizedMessages,
            streamingMessages: streamingMessages,
            revision: revision,
            responseData: data
        )
        return .response(data: data, revision: revision)
    }

    func removeAll() {
        entries.removeAll()
    }
}
