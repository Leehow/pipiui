import Foundation

/// Settled transcript structural plan cache.
///
/// 之前 `ChatDetailView.transcript` 在 body 里每次求值都全量重算布局计划
/// （InputBar 每次击键、流式 20 次/秒刷新、每条 subagent 桥接事件都会触发）。
/// 现在计划只随「输入版本」变化重算：
///
/// - `transcriptVersion` — ChatSession 在 `transcript` 每次真实修改时递增（didSet，宁滥勿缺）
/// - `toolStructureVersion` — changes when running state or result imagery alters grouping
/// - `visibleCount` — 可见窗口（suffix(N)）大小
///
/// Content-only tool output does not invalidate the settled layout. Tool rows still
/// receive the latest `ToolRun`; only a change between image-free and image-bearing
/// results or running-state transitions can change `AssistantBlockLayout.isGroupable`.
final class TranscriptPlanner {
    struct InputKey: Equatable {
        var transcriptVersion: UInt64
        var toolStructureVersion: UInt64
        var visibleCount: Int
    }

    private var lastKey: InputKey?
    private var cachedPresentation = AssistantBlockLayout.transcriptPresentation(rows: [])
    private(set) var computationCount: UInt64 = 0

    /// Return rows plus all structural presentation maps in one cached value.
    func presentation(
        items: [ChatItem],
        toolRuns: [String: ToolRun],
        visibleCount: Int,
        transcriptVersion: UInt64,
        toolStructureVersion: UInt64
    ) -> AssistantBlockLayout.TranscriptPresentation {
        let key = InputKey(
            transcriptVersion: transcriptVersion,
            toolStructureVersion: toolStructureVersion,
            visibleCount: visibleCount
        )
        if key == lastKey { return cachedPresentation }
        let planned = AssistantBlockLayout.planTranscript(
            items: Array(items.suffix(visibleCount)),
            toolRuns: toolRuns
        )
        lastKey = key
        cachedPresentation = AssistantBlockLayout.transcriptPresentation(rows: planned)
        computationCount &+= 1
        return cachedPresentation
    }

    /// Compatibility helper for non-render callers that only need rows.
    func rows(
        items: [ChatItem],
        toolRuns: [String: ToolRun],
        visibleCount: Int,
        transcriptVersion: UInt64,
        toolStructureVersion: UInt64
    ) -> [AssistantBlockLayout.TranscriptRow] {
        presentation(
            items: items,
            toolRuns: toolRuns,
            visibleCount: visibleCount,
            transcriptVersion: transcriptVersion,
            toolStructureVersion: toolStructureVersion
        ).rows
    }

    /// 显式作废（会话切换等防御性场景；正常靠版本 key 已足够）。
    func invalidate() {
        lastKey = nil
        cachedPresentation = AssistantBlockLayout.transcriptPresentation(rows: [])
    }
}
