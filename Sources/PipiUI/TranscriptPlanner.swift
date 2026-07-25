import Foundation

/// T6 transcript 布局记忆化：`AssistantBlockLayout.planTranscript` 的结果缓存。
///
/// 之前 `ChatDetailView.transcript` 在 body 里每次求值都全量重算布局计划
/// （InputBar 每次击键、流式 20 次/秒刷新、每条 subagent 桥接事件都会触发）。
/// 现在计划只随「输入版本」变化重算：
///
/// - `transcriptVersion` — ChatSession 在 `transcript` 每次真实修改时递增（didSet，宁滥勿缺）
/// - `toolOutputVersion` — ChatSession 既有的 toolRuns 版本计数
/// - `visibleCount` — 可见窗口（suffix(N)）大小
///
/// key 未变时直接返回上次的行数组，body 求值退化为一次结构比较。
/// 失效策略刻意保守：任何 transcript/toolRuns 写入都会 bump 版本，宁可多算不可过期。
final class TranscriptPlanner {
    struct InputKey: Equatable {
        var transcriptVersion: UInt64
        var toolOutputVersion: UInt64
        var visibleCount: Int
    }

    private var lastKey: InputKey?
    private var cachedRows: [AssistantBlockLayout.TranscriptRow] = []

    /// 返回当前输入对应的布局行；输入版本未变时命中缓存，不做任何重排。
    func rows(
        items: [ChatItem],
        toolRuns: [String: ToolRun],
        visibleCount: Int,
        transcriptVersion: UInt64,
        toolOutputVersion: UInt64
    ) -> [AssistantBlockLayout.TranscriptRow] {
        let key = InputKey(
            transcriptVersion: transcriptVersion,
            toolOutputVersion: toolOutputVersion,
            visibleCount: visibleCount
        )
        if key == lastKey { return cachedRows }
        let planned = AssistantBlockLayout.planTranscript(
            items: Array(items.suffix(visibleCount)),
            toolRuns: toolRuns
        )
        lastKey = key
        cachedRows = planned
        return planned
    }

    /// 显式作废（会话切换等防御性场景；正常靠版本 key 已足够）。
    func invalidate() {
        lastKey = nil
        cachedRows = []
    }
}
