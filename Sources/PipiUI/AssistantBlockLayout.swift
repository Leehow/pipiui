import Foundation

/// Render-time plan for assistant `ChatBlock`s: keep live rows individual while streaming;
/// after the turn finishes, collapse consecutive thinking/toolCall runs into one summary group.
///
/// pi emits one assistant `ChatItem` per tool round, so finished transcript grouping must
/// coalesce consecutive assistant items before planning — otherwise each round becomes its
/// own tiny "2 steps" chip instead of one package between text segments.
enum AssistantBlockLayout {
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
        case assistantRun(id: String, segments: [Segment])

        var id: String {
            switch self {
            case .leaf(let item): return item.id
            case .assistantRun(let id, _): return id
            }
        }
    }

    /// - Parameter groupFinished: `true` for settled transcript rows; `false` while streaming.
    static func plan(blocks: [ChatBlock], groupFinished: Bool) -> [Segment] {
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
            if isGroupable(block) {
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
    static func planTranscript(items: [ChatItem]) -> [TranscriptRow] {
        var result: [TranscriptRow] = []
        var pending: [ChatItem] = []

        func flushAssistant() {
            guard let last = pending.last else { return }
            let blocks = pending.flatMap(\.blocks)
            let segments = plan(blocks: blocks, groupFinished: true)
            result.append(.assistantRun(id: last.id, segments: segments))
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

    /// Summary like `3 steps · Thinking · read · bash`.
    static func summaryTitle(for blocks: [ChatBlock]) -> String {
        let labels = blocks.compactMap(label(for:))
        let joined = labels.joined(separator: " · ")
        if joined.isEmpty {
            return "\(blocks.count) steps"
        }
        return "\(blocks.count) steps · \(joined)"
    }

    static func isGroupable(_ block: ChatBlock) -> Bool {
        switch block {
        case .thinking, .toolCall: return true
        case .text, .image, .video: return false
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
}
