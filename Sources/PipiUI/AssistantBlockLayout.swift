import Foundation

/// Render-time plan for assistant `ChatBlock`s: keep live rows individual while streaming;
/// after the turn finishes, collapse consecutive thinking/toolCall runs into one summary group.
///
/// pi emits one assistant `ChatItem` per tool round, so finished transcript grouping must
/// coalesce consecutive assistant items before planning — otherwise each round becomes its
/// own tiny "2 steps" chip instead of one package between text segments.
enum AssistantBlockLayout {
    /// Stable identity for one member of a finished thinking/tool group.
    ///
    /// Identity is derived from the tool-call id or a deterministic content digest,
    /// with an occurrence suffix for duplicate members. It deliberately does not use
    /// the array offset alone: the detail sheet may outlive the lazy transcript row
    /// that opened it.
    struct FinishedGroupMember: Equatable, Identifiable {
        let id: String
        let block: ChatBlock
    }

    /// Value handed from a lazy transcript row to the stable detail-level presenter.
    struct FinishedGroupPresentation: Equatable, Identifiable {
        let id: String
        let sessionKey: String
        let members: [FinishedGroupMember]

        var blocks: [ChatBlock] {
            members.map(\.block)
        }

        func belongs(to sessionKey: String) -> Bool {
            self.sessionKey == sessionKey
        }
    }

    enum Segment: Equatable {
        case text(String)
        case image(ImageBlock)
        case video(VideoBlock)
        /// Single thinking/toolCall shown as its own disclosure (live, or lone finished item).
        case singleton(ChatBlock)
        /// ≥2 consecutive finished thinking/toolCall blocks between text/media boundaries.
        case finishedGroup([ChatBlock])
    }

    /// Finished-transcript display unit. Assistant runs may span multiple `ChatItem`s.
    enum TranscriptRow: Equatable, Identifiable {
        /// user / system (or any non-assistant) row, rendered as a normal `MessageRow`.
        case leaf(ChatItem)
        /// Coalesced consecutive assistant items. `id` is the last item id (scroll target).
        case assistantRun(id: String, entryId: String?, segments: [Segment])

        var id: String {
            switch self {
            case .leaf(let item): return item.id
            case .assistantRun(let id, _, _): return id
            }
        }
    }

    /// A real user prompt and every following assistant run belong to one fold group.
    /// Runtime worker signals use the user role but do not start a new group.
    struct UserTurnGroups: Equatable {
        var groupIDForRowID: [String: String]
        var lastAssistantRunIDForGroupID: [String: String]
    }

    static func userTurnGroups(rows: [TranscriptRow]) -> UserTurnGroups {
        var groupIDForRowID: [String: String] = [:]
        var lastAssistantRunIDForGroupID: [String: String] = [:]
        var currentGroupID: String?

        for row in rows {
            switch row {
            case .leaf(let item):
                guard item.role == "user" else { continue }
                if MessageActions.isUserAuthoredMessage(item) {
                    currentGroupID = item.id
                }
                if let currentGroupID {
                    groupIDForRowID[item.id] = currentGroupID
                }
            case .assistantRun(let id, _, _):
                if let currentGroupID {
                    groupIDForRowID[id] = currentGroupID
                    lastAssistantRunIDForGroupID[currentGroupID] = id
                }
            }
        }

        return UserTurnGroups(
            groupIDForRowID: groupIDForRowID,
            lastAssistantRunIDForGroupID: lastAssistantRunIDForGroupID
        )
    }

    /// - Parameter groupFinished: `true` for settled transcript rows; `false` while streaming.
    /// - Parameter toolRuns: used so toolCalls with result images stay outside finished groups.
    static func plan(
        blocks: [ChatBlock],
        groupFinished: Bool,
        toolRuns: [String: ToolRun] = [:]
    ) -> [Segment] {
        let merged = MessageTextBlocks.mergeAdjacent(blocks)
        guard groupFinished else {
            return merged.map(segment(for:))
        }

        var result: [Segment] = []
        var pending: [ChatBlock] = []

        func flushPending() {
            if pending.count >= 2 {
                result.append(.finishedGroup(pending))
            } else if let only = pending.first {
                result.append(.singleton(only))
            }
            pending.removeAll(keepingCapacity: true)
        }

        for block in merged {
            if isGroupable(block, toolRuns: toolRuns) {
                pending.append(block)
            } else {
                flushPending()
                result.append(segment(for: block))
            }
        }
        flushPending()
        return result
    }

    /// Coalesce consecutive assistant items, then plan blocks so text/media boundaries
    /// span tool-round messages (finished transcript only).
    static func planTranscript(
        items: [ChatItem],
        toolRuns: [String: ToolRun] = [:]
    ) -> [TranscriptRow] {
        var result: [TranscriptRow] = []
        var pending: [ChatItem] = []

        func flushAssistant() {
            guard let last = pending.last else { return }
            let blocks = pending.flatMap(\.blocks)
            let segments = plan(blocks: blocks, groupFinished: true, toolRuns: toolRuns)
            result.append(.assistantRun(id: last.id, entryId: last.entryId, segments: segments))
            pending.removeAll(keepingCapacity: true)
        }

        for item in items {
            if item.role == "assistant" {
                pending.append(item)
            } else {
                flushAssistant()
                result.append(.leaf(item))
            }
        }
        flushAssistant()
        return result
    }

    /// Tool-call ids referenced by a raw block list (used by the collapse guard).
    static func toolCallIds(in blocks: [ChatBlock]) -> Set<String> {
        var ids = Set<String>()
        for block in blocks {
            if case .toolCall(let call) = block { ids.insert(call.id) }
        }
        return ids
    }

    /// Summary like `3 steps · Thinking · read · bash`.
    static func summaryTitle(for blocks: [ChatBlock]) -> String {
        let labels = blocks.compactMap(label(for:))
        let joined = labels.joined(separator: " · ")
        if joined.isEmpty {
            return "\(blocks.count) steps"
        }
        return "\(blocks.count) steps · \(joined)"
    }

    /// Derive stable, unique identities without making transcript layout depend on
    /// `ForEach` offsets. Duplicate payloads receive deterministic occurrence suffixes.
    static func finishedGroupMembers(_ blocks: [ChatBlock]) -> [FinishedGroupMember] {
        var occurrences: [String: Int] = [:]
        return blocks.map { block in
            let baseID = finishedGroupMemberBaseID(block)
            let occurrence = occurrences[baseID, default: 0]
            occurrences[baseID] = occurrence + 1
            return FinishedGroupMember(
                id: "\(baseID)#\(occurrence)",
                block: block
            )
        }
    }

    /// A presentation id combines the stable logical session, assistant-run scope,
    /// segment position, and member identities. Segment position is only a disambiguator,
    /// never the sole identity.
    static func finishedGroupPresentation(
        sessionKey: String,
        scopeID: String,
        segmentIndex: Int,
        blocks: [ChatBlock]
    ) -> FinishedGroupPresentation {
        let members = finishedGroupMembers(blocks)
        let memberKey = members.map(\.id).joined(separator: "|")
        return FinishedGroupPresentation(
            id: "\(sessionKey):\(scopeID):finished-group:\(segmentIndex):\(memberKey)",
            sessionKey: sessionKey,
            members: members
        )
    }

    /// Tools whose primary UX is a result image — never bury in a finished group,
    /// even before `toolRuns` images arrive (race after `message_end`).
    static let imageResultToolNames: Set<String> = [
        "generate_image",
        "computer",
        "open_application",
    ]

    /// `browser` multiplexes several actions behind one tool; only `screenshot` returns an
    /// image, and the action leads `argsSummary` (see `ToolCallSummary.browserSummary`).
    static func producesImageResult(_ call: ToolCallBlock) -> Bool {
        if imageResultToolNames.contains(call.name) { return true }
        return call.name == "browser" && call.argsSummary.hasPrefix("screenshot")
    }

    static func isGroupable(_ block: ChatBlock, toolRuns: [String: ToolRun] = [:]) -> Bool {
        switch block {
        case .thinking:
            return true
        case .toolCall(let call):
            if producesImageResult(call) { return false }
            // Any other tool that already carries result thumbnails stays visible too.
            if let run = toolRuns[call.id], !run.images.isEmpty { return false }
            return true
        case .text, .image, .video:
            return false
        }
    }

    /// Tool-call ids referenced by planned segments (for cheap `toolRuns` slicing).
    static func toolCallIds(in segments: [Segment]) -> Set<String> {
        var ids = Set<String>()
        for segment in segments {
            switch segment {
            case .singleton(let block):
                if case .toolCall(let call) = block { ids.insert(call.id) }
            case .finishedGroup(let blocks):
                for block in blocks {
                    if case .toolCall(let call) = block { ids.insert(call.id) }
                }
            case .text, .image, .video:
                break
            }
        }
        return ids
    }

    private static func segment(for block: ChatBlock) -> Segment {
        switch block {
        case .text(let text): return .text(text)
        case .image(let img): return .image(img)
        case .video(let vid): return .video(vid)
        case .thinking, .toolCall: return .singleton(block)
        }
    }

    private static func label(for block: ChatBlock) -> String? {
        switch block {
        case .thinking: return "Thinking"
        case .toolCall(let call): return call.name
        case .text, .image, .video: return nil
        }
    }

    private static func finishedGroupMemberBaseID(_ block: ChatBlock) -> String {
        switch block {
        case .thinking(let text):
            return "thinking:\(stableContentDigest(text))"
        case .toolCall(let call):
            return "tool:\(call.id)"
        case .text(let text):
            return "text:\(stableContentDigest(text))"
        case .image(let image):
            return "image:\(image.id)"
        case .video(let video):
            return "video:\(video.id)"
        }
    }

    /// FNV-1a gives deterministic cross-launch identity; Swift's `Hasher` is randomized.
    private static func stableContentDigest(_ text: String) -> String {
        var hash: UInt64 = 14_695_981_039_346_656_037
        for byte in text.utf8 {
            hash ^= UInt64(byte)
            hash &*= 1_099_511_628_211
        }
        return String(format: "%016llx", hash)
    }
}

/// Pure collapse guard for user-turn fold groups.
///
/// A user turn (group) must stay expanded while any subagent it dispatched is still
/// in-flight, so the live status card / running state never gets hidden by the fold.
/// Once every related agent has reached a terminal state, the existing collapse
/// mechanism applies unchanged.
///
/// The caller derives `runningSubagentToolCallIds` from `SubagentStore` (the set of
/// `toolCallId`s whose dispatched agent is `.running`), keeping this helper free of
/// store/UI dependencies and fully unit-testable.
enum UserTurnCollapseGuard {
    /// Group ids that must NOT be folded because at least one of their rows owns a
    /// tool call whose dispatched subagent is still running.
    static func runningGuardedGroupIDs(
        rows: [AssistantBlockLayout.TranscriptRow],
        groups: AssistantBlockLayout.UserTurnGroups,
        runningSubagentToolCallIds: Set<String>
    ) -> Set<String> {
        guard !runningSubagentToolCallIds.isEmpty else { return [] }
        var guarded: Set<String> = []
        for row in rows {
            let groupID: String?
            let callIds: Set<String>
            switch row {
            case .leaf(let item):
                groupID = groups.groupIDForRowID[item.id]
                callIds = AssistantBlockLayout.toolCallIds(in: item.blocks)
            case .assistantRun(let id, _, let segments):
                groupID = groups.groupIDForRowID[id]
                callIds = AssistantBlockLayout.toolCallIds(in: segments)
            }
            guard let groupID, !callIds.isDisjoint(with: runningSubagentToolCallIds) else { continue }
            guarded.insert(groupID)
        }
        return guarded
    }

    /// Resolve whether a group is currently folded, honouring the running-subagent guard.
    /// - Parameters:
    ///   - groupID: The fold group id (preceding user-authored message id), or nil.
    ///   - collapsedUserTurnIDs: Persisted user fold intent.
    ///   - guardedGroupIDs: Groups forced open by an in-flight subagent.
    /// - Returns: `true` only when the group is folded AND not guarded by a running agent.
    static func isCollapsed(
        groupID: String?,
        collapsedUserTurnIDs: Set<String>,
        guardedGroupIDs: Set<String>
    ) -> Bool {
        guard let groupID else { return false }
        if guardedGroupIDs.contains(groupID) { return false }
        return collapsedUserTurnIDs.contains(groupID)
    }
}
