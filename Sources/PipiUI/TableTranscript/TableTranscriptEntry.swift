import Foundation
import CoreGraphics

/// Flat display rows for the experimental table transcript (oldest → newest).
///
/// Unlike the inverted eager VStack (newest-first + flip), the table keeps natural
/// chat order so stick-to-bottom is `documentEnd` and cells need no per-row flip.
enum TableTranscriptEntry: Identifiable, Equatable {
    case returnLatestBanner
    case historyLoading
    case initializing
    case emptyPlaceholder
    case waiting(message: String, turnStartedAt: Date?)
    case turnElapsed(startedAt: Date)
    case streamingLeaf(item: ChatItem)
    case settledLeaf(item: ChatItem)
    case settledAssistant(
        id: String,
        entryId: String?,
        segments: [AssistantBlockLayout.Segment],
        isLastAssistant: Bool,
        collapsedOverride: Bool
    )

    var id: String {
        switch self {
        case .returnLatestBanner: return "meta:return-latest"
        case .historyLoading: return "meta:history-loading"
        case .initializing: return "meta:initializing"
        case .emptyPlaceholder: return "meta:empty"
        case .waiting: return "meta:waiting"
        case .turnElapsed: return "meta:turn-elapsed"
        case .streamingLeaf(let item): return "stream:\(item.id)"
        case .settledLeaf(let item): return "leaf:\(item.id)"
        case .settledAssistant(let id, _, _, _, _): return "run:\(id)"
        }
    }

    /// Coarse first-paint estimate before hosting measurement (phase-1 POC).
    var estimatedHeight: CGFloat {
        switch self {
        case .returnLatestBanner: return 36
        case .historyLoading, .initializing: return 32
        case .emptyPlaceholder: return 48
        case .waiting, .turnElapsed: return 36
        case .streamingLeaf, .settledLeaf:
            return TableTranscriptHeightCache.defaultEstimate
        case .settledAssistant(_, _, let segments, _, let collapsed):
            if collapsed { return 44 }
            // Very rough: text segments dominate; tool cards are taller.
            let base: CGFloat = 48
            let perSegment: CGFloat = 56
            return base + CGFloat(max(1, segments.count)) * perSegment
        }
    }
}
