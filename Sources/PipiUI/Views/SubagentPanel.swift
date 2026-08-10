import SwiftUI
import AppKit

/// 右侧 Subagent 面板：上半是 agent 树列表，下半是选中 agent 的实时详情。
struct SubagentPanel: View {
    @ObservedObject var store: SubagentStore
    /// Session project root (main git worktree) for merge/discard.
    var projectURL: URL
    /// 中止运行中 agent（ChatSession.abortSubagent → /subagent_abort RPC）。
    var onAbort: (String) -> Void
    /// Resolve a terminal failed episode through the Node control plane (never Swift-only for current rows).
    var onResolve: (SubagentInfo) -> Void
    /// UI-only recovery action for agents whose normal status observations went silent.
    var onManualStatusCheck: ([String]) -> Void
    /// 列表贴底跟随：新 agent 到达时若仍贴底则自动滚到最新条目；用户上滚看旧条目即脱离。
    @State private var pinToBottom = true
    /// UI window only: zero is the newest fixed-size page; mounted agent rows never grow with use.
    @State private var panelPageFromNewest = 0
    /// agentList 内 ScrollViewReader 的代理快照：header 徽章点击时滚动列表（reader 只存在于列表分支内）。
    @State private var listScrollProxy: ScrollViewProxy?

    /// 上下分栏比例（列表高度 / 可用高度）。拖拽 onChanged 更新，onEnded 持久化。
    @State private var listHeightRatio = LayoutPersistence.subagentListHeightRatio()
        ?? LayoutPersistence.defaultSubagentListHeightRatio

    var body: some View {
        VStack(spacing: 0) {
            header
            TimelineView(.periodic(from: .now, by: 30)) { context in
                statusChannelWarning(at: context.date)
            }
            Divider()
            if store.agents.isEmpty {
                emptyHint
            } else {
                StableSubagentSplitView(
                    ratio: listHeightRatio,
                    onDragEnded: { ratio, translation in
                        listHeightRatio = ratio
                        if abs(translation) >= 1,
                           let saved = LayoutPersistence.saveSubagentListHeightRatio(ratio) {
                            listHeightRatio = saved
                        }
                    }
                ) {
                    agentList
                } detail: {
                    detail
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Color(nsColor: .textBackgroundColor))
        .onAppear {
            Task { @MainActor in
                await store.reconcileWorktreeLifecycles(mainProjectURL: projectURL)
            }
        }
    }

    // MARK: - 上下分栏

    private var header: some View {
        let summary = SubagentPresentationScale.summary(for: store.agents)
        let unit = PricingSettings.unit()
        let rate = ModelPricing.Catalog.shared.exchangeRate
        // 单行布局：左簇（标题/计数/失败处置）占满剩余宽度并在自身内横向裁切；
        // 右簇（费用/清空）fixedSize + 高 layoutPriority 保持完整可见。
        // 宽度不足时溢出从左簇右缘消失，绝不换行成两排。
        return HStack(spacing: 8) {
            HStack(spacing: 8) {
                Label("Subagents", systemImage: "person.2")
                    .font(.callout.weight(.semibold))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .fixedSize(horizontal: true, vertical: false)
                Text("\(summary.totalCount) 个")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .fixedSize(horizontal: true, vertical: false)
                if summary.runningCount > 0 {
                    Text("\(summary.runningCount) 运行中")
                        .font(.caption)
                        .foregroundStyle(.green)
                        .lineLimit(1)
                        .fixedSize(horizontal: true, vertical: false)
                }
                if summary.failedCount > 0 {
                    Button(action: focusOnFailedAgent) {
                        Text(SubagentPresentationScale.failureText(summary))
                            .font(.caption)
                            .foregroundStyle(summary.failedAttentionCount > 0 ? Color.red : Color.green)
                            .lineLimit(1)
                            .fixedSize(horizontal: true, vertical: false)
                    }
                    .buttonStyle(.plain)
                    .help(SubagentPresentationScale.failureHelp(summary))
                }
            }
            .lineLimit(1)
            .fixedSize(horizontal: true, vertical: false)
            .frame(maxWidth: .infinity, alignment: .leading)
            .clipped()
            if summary.totalCost > 0 {
                Text(formatSpend(usdCost: summary.totalCost, unit: unit, rate: rate))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
                    .layoutPriority(1)
            }
            Button {
                panelPageFromNewest = 0
                store.clearFinished()
            } label: {
                Text("清空")
                    .font(.caption)
                    .lineLimit(1)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .disabled(summary.finishedCount == 0)
            .fixedSize(horizontal: true, vertical: false)
            .layoutPriority(1)
            .help("清空已完成")
        }
        .clipped()
        .padding(.horizontal, 12)
        // 6pt matches compact top chrome / panel rail rhythm (was 8 — felt like a dead band).
        .padding(.vertical, 6)
    }

    @ViewBuilder
    private func statusChannelWarning(at now: Date) -> some View {
        let staleAgentIDs = store.staleRunningAgentIDs(now: now)
        if !staleAgentIDs.isEmpty {
            HStack(alignment: .center, spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                Text(statusChannelWarningText(for: staleAgentIDs))
                    .font(.caption)
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 4)
                Button("手动检查") {
                    onManualStatusCheck(staleAgentIDs)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .help("向主会话发出用户主动的状态查询；不会自动重新派发 agent")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(Color.orange.opacity(0.12))
        }
    }

    private func statusChannelWarningText(for staleAgentIDs: [String]) -> String {
        let visibleIDs = staleAgentIDs.prefix(3).joined(separator: "、")
        let suffix = staleAgentIDs.count > 3 ? " 等" : ""
        return "\(staleAgentIDs.count) 个子代理（\(visibleIDs)\(suffix)）超过 10 分钟未收到状态更新；自动状态通道可能不可用，暂时无法确认状态。"
    }

    private var emptyHint: some View {
        VStack(spacing: 10) {
            Image(systemName: "person.2.badge.gearshape")
                .font(.system(size: 32, weight: .light))
                .foregroundStyle(.tertiary)
            Text("还没有 subagent")
                .font(.callout.weight(.medium))
            Text("让 pi 用 subagent 工具委派任务后，这里会实时显示 agent 树。\n例如：「用 explore 并行调研，或派 operator 执行桌面操作 …」")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(20)
    }

    private var agentList: some View {
        let displayOrder = store.displayOrder
        let window = SubagentPresentationScale.panelWindow(
            for: displayOrder,
            pageFromNewest: panelPageFromNewest,
            selectedID: store.selectedId
        )
        return ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 2) {
                    ForEach(window.agents) { agent in
                        AgentRow(
                            agent: agent,
                            selected: agent.id == store.selectedId,
                            abortPending: store.abortPending.contains(agent.id),
                            onSelect: { store.selectedId = agent.id },
                            onAbort: { onAbort(agent.id) },
                            onMarkHandled: { onResolve(agent) }
                        )
                    }
                    if window.pageCount > 1 {
                        HStack(spacing: 10) {
                            Button {
                                panelPageFromNewest = max(0, window.pageFromNewest - 1)
                            } label: {
                                Label("较新的", systemImage: "chevron.down")
                            }
                            .disabled(!window.canShowNewer)

                            Spacer(minLength: 0)
                            Text("从最新起第 \(window.pageFromNewest + 1)/\(window.pageCount) 页")
                                .foregroundStyle(.tertiary)
                            Spacer(minLength: 0)

                            Button {
                                panelPageFromNewest = window.pageFromNewest + 1
                            } label: {
                                Label("较早的", systemImage: "chevron.up")
                            }
                            .disabled(!window.canShowOlder)
                        }
                        .buttonStyle(.borderless)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 7)
                    }
                    // 透明贴底锚点，与行数据解耦：新行插入/旧行移除不影响锚点位置。
                    Color.clear
                        .frame(height: 1)
                        .id(listBottomAnchorID)
                        .background(
                            StickToBottomTracker(
                                isPinned: $pinToBottom,
                                pinEdge: .documentEnd
                            )
                        )
                }
                .padding(8)
                .overlayScrollers()
            }
            .scrollIndicators(.automatic)
            .onAppear {
                DispatchQueue.main.async {
                    listScrollProxy = proxy
                    jumpToListBottom(proxy)
                }
            }
            .onChange(of: displayOrder.max(by: { $0.started < $1.started })?.id) { _, _ in
                // 新 agent 到达（最新启动者变化）时跟随；列表按活动排序后末尾不再代表新到者，
                // 故以最新启动者为锚。状态/费用/活动重排等元素级更新不触发（started 不变），
                // 避免打扰用户浏览旧条目。
                DispatchQueue.main.async {
                    jumpToListBottom(proxy)
                }
            }
            .onChange(of: window.listIdentity) { previous, current in
                panelPageFromNewest = SubagentPresentationScale.panelPageAfterListChange(
                    currentPage: panelPageFromNewest,
                    previousIdentity: previous,
                    newIdentity: current
                )
            }
        }
    }

    private var listBottomAnchorID: String { "subagent-list-bottom" }

    /// 失败徽章点击：选中并滚动到最新的需关注失败 agent；全部已清理时回退到最新失败项。
    /// 失败/需关注行是列表优先行，任何分页下都渲染，故 scrollTo 总能命中，无需翻页。
    private func focusOnFailedAgent() {
        let order = store.displayOrder
        let target = order.last(where: {
            $0.state == .failed && !SubagentPresentationScale.isCleaned($0)
        }) ?? order.last(where: { $0.state == .failed })
        guard let target else { return }
        store.selectedId = target.id
        listScrollProxy?.scrollTo(target.id, anchor: .center)
    }

    /// 非 flip 列表：可视底 = documentEnd，锚点贴底即显示最新条目。
    private func jumpToListBottom(_ proxy: ScrollViewProxy) {
        guard pinToBottom else { return }
        proxy.scrollTo(listBottomAnchorID, anchor: .bottom)
    }

    @ViewBuilder
    private var detail: some View {
        if let agent = store.agents.first(where: { $0.id == store.selectedId }) {
            // Per-agent identity: every @State (pin, top-visible page, expanded
            // groups, diff dialog) is scoped to one agent and resets on switch.
            AgentDetailView(agent: agent, store: store, projectURL: projectURL)
                .id(agent.id)
        } else {
            Text("选择一个 agent 查看详情")
                .font(.caption)
                .foregroundStyle(.tertiary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

/// Pure sizing for the AppKit-backed split. Keeping this independent from the
/// SwiftUI graph makes clamping executable in tests and prevents size feedback.
struct SubagentPanelSplitSizing {
    static let dividerHeight: CGFloat = 6
    static let minimumListHeight: CGFloat = 64
    static let minimumDetailHeight: CGFloat = 56

    struct Resolved: Equatable {
        let availableHeight: CGFloat
        let listHeight: CGFloat
        let detailHeight: CGFloat
    }

    static func resolve(containerHeight: CGFloat, ratio: CGFloat) -> Resolved {
        let finiteHeight = containerHeight.isFinite ? max(0, containerHeight) : 0
        let actualDividerHeight = min(dividerHeight, finiteHeight)
        let availableHeight = max(0, finiteHeight - actualDividerHeight)
        guard availableHeight > 0 else {
            return Resolved(availableHeight: 0, listHeight: 0, detailHeight: 0)
        }

        let finiteRatio = ratio.isFinite ? ratio : LayoutPersistence.defaultSubagentListHeightRatio
        let proposedListHeight = availableHeight * min(max(finiteRatio, 0), 1)

        // When the container can satisfy both minimums, enforce both. At very
        // small heights the list keeps as much of its 64pt minimum as exists;
        // the detail receives the remaining non-negative space.
        let minimumListHeight = min(Self.minimumListHeight, availableHeight)
        let maximumListHeight = max(
            minimumListHeight,
            availableHeight - Self.minimumDetailHeight
        )
        let listHeight = min(max(proposedListHeight, minimumListHeight), maximumListHeight)
        return Resolved(
            availableHeight: availableHeight,
            listHeight: listHeight,
            detailHeight: max(0, availableHeight - listHeight)
        )
    }

    static func draggedRatio(
        startRatio: CGFloat,
        translation: CGFloat,
        containerHeight: CGFloat
    ) -> CGFloat {
        let start = resolve(containerHeight: containerHeight, ratio: startRatio)
        guard start.availableHeight > 0 else { return startRatio }
        let proposedRatio = (start.listHeight + translation) / start.availableHeight
        let resolved = resolve(containerHeight: containerHeight, ratio: proposedRatio)
        return resolved.listHeight / resolved.availableHeight
    }
}

/// Hosts the two SwiftUI panes in a frame-driven AppKit container. The AppKit
/// parent owns measurement and divider movement, so SwiftUI never reads its
/// proposed height and writes that value back into child `.frame(height:)`.
private struct StableSubagentSplitView<ListContent: View, DetailContent: View>: NSViewRepresentable {
    let ratio: CGFloat
    let onDragEnded: (CGFloat, CGFloat) -> Void
    let listContent: ListContent
    let detailContent: DetailContent

    init(
        ratio: CGFloat,
        onDragEnded: @escaping (CGFloat, CGFloat) -> Void,
        @ViewBuilder list: () -> ListContent,
        @ViewBuilder detail: () -> DetailContent
    ) {
        self.ratio = ratio
        self.onDragEnded = onDragEnded
        self.listContent = list()
        self.detailContent = detail()
    }

    func makeNSView(context: Context) -> StableSubagentSplitContainer<ListContent, DetailContent> {
        StableSubagentSplitContainer(
            ratio: ratio,
            listContent: listContent,
            detailContent: detailContent,
            onDragEnded: onDragEnded
        )
    }

    func updateNSView(
        _ nsView: StableSubagentSplitContainer<ListContent, DetailContent>,
        context: Context
    ) {
        nsView.update(
            ratio: ratio,
            listContent: listContent,
            detailContent: detailContent,
            onDragEnded: onDragEnded
        )
    }
}

private protocol StableSubagentSplitDragging: AnyObject {
    func beginDividerDrag(windowY: CGFloat)
    func continueDividerDrag(windowY: CGFloat)
    func endDividerDrag(windowY: CGFloat)
}

private final class StableSubagentSplitContainer<ListContent: View, DetailContent: View>: NSView,
    StableSubagentSplitDragging
{
    private let listHost: NSHostingView<ListContent>
    private let detailHost: NSHostingView<DetailContent>
    private let divider = StableSubagentSplitDivider()
    private var ratio: CGFloat
    private var onDragEnded: (CGFloat, CGFloat) -> Void
    private var dragStartRatio: CGFloat?
    private var dragStartWindowY: CGFloat?

    override var isFlipped: Bool { true }
    override var intrinsicContentSize: NSSize {
        NSSize(width: NSView.noIntrinsicMetric, height: NSView.noIntrinsicMetric)
    }

    init(
        ratio: CGFloat,
        listContent: ListContent,
        detailContent: DetailContent,
        onDragEnded: @escaping (CGFloat, CGFloat) -> Void
    ) {
        self.ratio = ratio
        self.onDragEnded = onDragEnded
        self.listHost = NSHostingView(rootView: listContent)
        self.detailHost = NSHostingView(rootView: detailContent)
        super.init(frame: .zero)

        listHost.translatesAutoresizingMaskIntoConstraints = true
        detailHost.translatesAutoresizingMaskIntoConstraints = true
        divider.translatesAutoresizingMaskIntoConstraints = true
        addSubview(listHost)
        addSubview(divider)
        addSubview(detailHost)
        divider.container = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func update(
        ratio: CGFloat,
        listContent: ListContent,
        detailContent: DetailContent,
        onDragEnded: @escaping (CGFloat, CGFloat) -> Void
    ) {
        listHost.rootView = listContent
        detailHost.rootView = detailContent
        self.onDragEnded = onDragEnded
        if dragStartRatio == nil, self.ratio != ratio {
            self.ratio = ratio
            needsLayout = true
        }
    }

    override func layout() {
        super.layout()
        let sizing = SubagentPanelSplitSizing.resolve(
            containerHeight: bounds.height,
            ratio: ratio
        )
        let dividerHeight = min(SubagentPanelSplitSizing.dividerHeight, bounds.height)
        listHost.frame = NSRect(
            x: 0,
            y: 0,
            width: bounds.width,
            height: sizing.listHeight
        )
        divider.frame = NSRect(
            x: 0,
            y: sizing.listHeight,
            width: bounds.width,
            height: dividerHeight
        )
        detailHost.frame = NSRect(
            x: 0,
            y: sizing.listHeight + dividerHeight,
            width: bounds.width,
            height: sizing.detailHeight
        )
    }

    fileprivate func beginDividerDrag(windowY: CGFloat) {
        dragStartRatio = ratio
        dragStartWindowY = windowY
    }

    fileprivate func continueDividerDrag(windowY: CGFloat) {
        guard let dragStartRatio, let dragStartWindowY else { return }
        let translation = dragStartWindowY - windowY
        ratio = SubagentPanelSplitSizing.draggedRatio(
            startRatio: dragStartRatio,
            translation: translation,
            containerHeight: bounds.height
        )
        needsLayout = true
        layoutSubtreeIfNeeded()
    }

    fileprivate func endDividerDrag(windowY: CGFloat) {
        guard let dragStartWindowY else { return }
        continueDividerDrag(windowY: windowY)
        let translation = dragStartWindowY - windowY
        dragStartRatio = nil
        self.dragStartWindowY = nil
        onDragEnded(ratio, translation)
    }
}

private final class StableSubagentSplitDivider: NSView {
    weak var container: (any StableSubagentSplitDragging)?

    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        NSColor.separatorColor.withAlphaComponent(0.65).setFill()
        NSRect(x: 0, y: floor((bounds.height - 1) / 2), width: bounds.width, height: 1).fill()
    }

    override func resetCursorRects() {
        addCursorRect(bounds, cursor: .resizeUpDown)
    }

    override func mouseDown(with event: NSEvent) {
        super.mouseDown(with: event)
        container?.beginDividerDrag(windowY: event.locationInWindow.y)
    }

    override func mouseDragged(with event: NSEvent) {
        container?.continueDividerDrag(windowY: event.locationInWindow.y)
    }

    override func mouseUp(with event: NSEvent) {
        container?.endDividerDrag(windowY: event.locationInWindow.y)
    }
}

private struct AgentRow: View {
    let agent: SubagentInfo
    let selected: Bool
    var abortPending: Bool = false
    let onSelect: () -> Void
    var onAbort: (() -> Void)? = nil
    var onMarkHandled: (() -> Void)? = nil

    private var lifecyclePresentation: SubagentPresentationScale.RowPresentation {
        SubagentPresentationScale.rowPresentation(for: agent)
    }

    private var hasRunId: Bool {
        guard let runId = agent.runId?.trimmingCharacters(in: .whitespacesAndNewlines) else {
            return false
        }
        return !runId.isEmpty
    }

    var body: some View {
        rowContent
    }

    private var rowContent: some View {
        HStack(spacing: 0) {
            Button(action: onSelect) {
                selectionArea
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity)
            .accessibilityLabel("选择 \(agent.name) 子代理")
            .accessibilityAddTraits(selected ? .isSelected : [])

            if lifecyclePresentation.canMarkHandled, let onMarkHandled {
                Button(hasRunId ? "标记为已处理" : "标记为已处理（旧记录，仅本地）", action: onMarkHandled)
                    .buttonStyle(.borderless)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .help(
                        hasRunId
                            ? "通过运行时控制面标记该失败 episode 已处理，并取消其提醒"
                            : "旧记录没有 runId：只能本地标记，无法取消运行时提醒"
                    )
                    .accessibilityLabel("将 \(agent.name) 标记为已处理")
                    .padding(.trailing, 8)
            }

            if agent.state == .running, let onAbort {
                Button(action: onAbort) {
                    Image(systemName: "stop.circle")
                        .font(.callout)
                }
                .buttonStyle(HoverButtonStyle(base: abortPending ? Color.secondary.opacity(0.4) : .secondary, hovered: .red))
                .disabled(abortPending)
                .help(abortPending ? "正在中止…" : "中止该 agent（/subagent_abort）")
                .accessibilityLabel("中止 \(agent.name) 子代理")
                .padding(.trailing, 8)
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(selected ? Color.accentColor.opacity(0.12) : Color.clear)
        )
    }

    private var selectionArea: some View {
        let unit = PricingSettings.unit()
        let rate = ModelPricing.Catalog.shared.exchangeRate
        return HStack(spacing: 8) {
            // 树形缩进：depth 1 是主会话直接派出的
            if agent.depth > 1 {
                Rectangle().fill(.clear)
                    .frame(width: CGFloat(agent.depth - 1) * 18, height: 1)
                Image(systemName: "arrow.turn.down.right")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            statusDot
            ProviderLogo(modelRef: agent.model, size: 14)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(agent.name)
                        .font(.callout.weight(.medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    if agent.name == "secretary" {
                        Text("收尾")
                            .font(.caption2)
                            .foregroundStyle(.purple)
                            .padding(.horizontal, 4)
                            .padding(.vertical, 1)
                            .background(Capsule().fill(Color.purple.opacity(0.15)))
                    }
                    if let terminalBadgeText = lifecyclePresentation.terminalBadgeText {
                        HStack(spacing: 3) {
                            lifecycleBadge(text: terminalBadgeText, color: lifecyclePresentation.tone.displayColor)
                                .help("状态由本次执行 lifecycle 决定，不会依据最后输出判断成功。")
                            if let handledBadgeText = lifecyclePresentation.handledBadgeText {
                                handledLifecycleBadge(text: handledBadgeText)
                                    .help("已明确处置；保留原终态，不代表本次执行成功。")
                            }
                        }
                        .fixedSize(horizontal: true, vertical: false)
                        .layoutPriority(1)
                    }
                    if agent.state == .running, agent.stalled {
                        lifecycleBadge(
                            text: agent.stalledIdleSec > 0 ? "卡住 \(agent.stalledIdleSec)s" : "卡住",
                            color: .orange
                        )
                        .help("已 \(agent.stalledIdleSec)s 无任何活动，可能卡死；可点右侧 ⏹ 中止")
                    }
                    if agent.worktreeLifecycle == .pendingReview || agent.canReviewWorktree {
                        lifecycleBadge(text: "审核", color: .orange)
                    } else if agent.worktreeLifecycle == .merged {
                        lifecycleBadge(text: "已合并", color: .green)
                    } else if agent.worktreeLifecycle == .mergedCleanupPending {
                        lifecycleBadge(text: "待善后", color: .orange)
                    } else if agent.worktreeLifecycle == .discarded {
                        lifecycleBadge(text: "已丢弃", color: .secondary)
                    } else if agent.worktreeLifecycle == .active, agent.state == .running {
                        lifecycleBadge(text: "wt", color: .blue)
                    }
                }
                Text(agent.listSubtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 1) {
                HStack(spacing: 4) {
                    if agent.state != .running, let ended = agent.ended {
                        Text(TurnDurationFormat.completedAt(ended))
                        Text("·")
                    }
                    durationText
                }
                if agent.cost > 0 {
                    Text(formatSpend(usdCost: agent.cost, unit: unit, rate: rate))
                }
            }
            .font(.caption2.monospacedDigit())
            .foregroundStyle(.tertiary)
        }
    }

    @ViewBuilder
    private var durationText: some View {
        if agent.state == .running {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                Text(DurationFormat.compact(context.date.timeIntervalSince(agent.started)))
            }
        } else {
            Text(DurationFormat.compact((agent.ended ?? agent.started).timeIntervalSince(agent.started)))
        }
    }

    private func lifecycleBadge(text: String, color: Color) -> some View {
        Text(text)
            .font(.caption2)
            .lineLimit(1)
            .fixedSize(horizontal: true, vertical: false)
            .padding(.horizontal, 4)
            .padding(.vertical, 1)
            .background(Capsule().fill(color.opacity(0.15)))
            .foregroundStyle(color)
    }

    private func handledLifecycleBadge(text: String) -> some View {
        Text(text)
            .font(.system(size: 9, weight: .medium))
            .lineLimit(1)
            .fixedSize(horizontal: true, vertical: false)
            .padding(.horizontal, 3)
            .padding(.vertical, 1)
            .background(Capsule().fill(Color.secondary.opacity(0.10)))
            .foregroundStyle(.secondary)
    }

    @ViewBuilder
    private var statusDot: some View {
        if agent.state == .running {
            ProgressView().controlSize(.mini).tint(.secondary)
        } else if let iconName = lifecyclePresentation.iconName {
            Image(systemName: iconName)
                .foregroundStyle(lifecyclePresentation.tone.displayColor)
                .font(.caption)
        } else {
            EmptyView()
        }
    }
}

private struct AgentDetailView: View {
    let agent: SubagentInfo
    @ObservedObject var store: SubagentStore
    var projectURL: URL
    @State private var pinToBottom = true
    /// Top-most visible log segment id, reported by `.scrollPosition(id:anchor:)`.
    /// Deriving the visible page from this id lets the sliding window follow the
    /// viewport without any pagination buttons.
    @State private var scrollTopID: String? = nil
    /// Chrono page of the top-visible log item; the unpinned window anchor.
    /// Synced to the newest page while pinned and re-resolved from the live
    /// scroll id on unpin; used as the clamped fallback when the anchor id is
    /// unknown or evicted by the store cap.
    @State private var topVisiblePage = 0
    @State private var worktreeBusy = false
    @State private var showDiscardConfirm = false
    @State private var showDiffStat = false
    @State private var diffStatText: String?
    @State private var diffBusy = false
    @State private var expandedToolGroupIDs: Set<Int> = []
    /// Per-row expand state, lifted out of `AgentLogRow`: a LazyVStack unmounts
    /// off-screen rows, so row-local `@State` would lose expansion on scroll.
    /// Keyed by the stable log item id; the whole set is `@State` here and resets
    /// when the detail is remounted on agent switch (`.id(agent.id)`), so one
    /// agent's expansion never leaks into another. Tool groups keep their own
    /// `expandedToolGroupIDs` set (keyed by the group leader id, never colliding
    /// with a standalone item id within one agent's log).
    @State private var expandedLogItemIDs: Set<Int> = []
    /// Collapsed by default; resets when the detail view identity changes (`.id(agent.id)`).
    @State private var finalResultExpanded = false
    /// Body font size passed down to `AgentLogRow` so its lightweight `Text`
    /// matches `MarkdownTextView` (which reads this same environment value) and so
    /// a chat-font-size change bumps `Equatable` for re-render.
    @Environment(\.chatTypography) private var chatTypography

    var body: some View {
        // Window anchor with hysteresis: pinned → newest page (follows appended
        // rows); unpinned → keep the committed page while the live top-visible
        // item stays inside its window, sliding only when the item leaves it.
        // Pure `stableAnchorPage` de-duplicates equal windows (no state write for
        // small scroll drift); the resolved range is the hard mount ceiling
        // (`SubagentLogRenderWindow.maxRenderedItems`), independent of log length.
        // Normal document order (oldest top → newest bottom), no flip.
        let effectivePage = pinToBottom
            ? SubagentLogRenderWindow.latestPage(itemCount: agent.log.count)
            : SubagentLogRenderWindow.stableAnchorPage(
                itemCount: agent.log.count,
                committedTopVisiblePage: topVisiblePage,
                liveAnchorIndex: topItemIndex(from: scrollTopID, log: agent.log)
            )
        let window = SubagentLogRenderWindow.resolve(
            itemCount: agent.log.count,
            topVisiblePage: effectivePage
        )
        // Drop only a terminal text row that duplicates agent.output (card owns it).
        let suppressLogID = SubagentFinalResultPresentation.terminalTextLogItemIDToSuppress(
            log: agent.log,
            output: agent.output
        )
        let windowItems = Array(agent.log[window.range]).filter { item in
            suppressLogID.map { $0 != item.id } ?? true
        }
        let segments = SubagentLogLayout.plan(windowItems)
        let showFinalResult = SubagentFinalResultPresentation.shouldShowCard(output: agent.output)

        VStack(alignment: .leading, spacing: 0) {
            metricsHeader
            if let reason = agent.closeoutReason, !reason.isEmpty {
                closeoutSummary(reason)
            }
            if agent.canReviewWorktree
                || agent.worktreeLifecycle == .mergedCleanupPending
                || (agent.worktreeError?.isEmpty == false)
                || (store.worktreeActionError != nil && store.selectedId == agent.id) {
                worktreeMeta
                    .padding(.horizontal, 10)
                    .padding(.bottom, 8)
            }
            Divider()
            if agent.state == .running {
                runningActivity
                Divider()
            }
            ScrollViewReader { proxy in
                ScrollView {
                    // Lazy stack: only on-screen rows (plus SwiftUI's small
                    // overscan) mount. The data window above is the hard ceiling
                    // (`SubagentLogRenderWindow.maxRenderedItems` ≤ 400 items), so
                    // mounted rows are bounded regardless of log length, and
                    // `.scrollPosition(id:)` re-anchors to the stable per-segment id
                    // as rows enter/leave the viewport (same pattern as agentList).
                    LazyVStack(alignment: .leading, spacing: 8) {
                        if segments.isEmpty && !showFinalResult {
                            waitingForFirstLog
                        } else {
                            ForEach(segments) { segment in
                                segmentRow(segment)
                                    .id(segmentRowID(segment))
                            }
                        }

                        if showFinalResult {
                            finalResultCard
                                .id("agent-final-result-\(agent.id)")
                        }

                        // 透明贴底锚点，与行数据解耦：新行插入/旧行移除不影响锚点位置。
                        Color.clear
                            .frame(height: 1)
                            .id(logAnchorID)
                            .background(
                                StickToBottomTracker(
                                    isPinned: $pinToBottom,
                                    pinEdge: .documentEnd
                                )
                            )
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .overlayScrollers()
                }
                .scrollIndicators(.automatic)
                .scrollPosition(id: $scrollTopID, anchor: .top)
                .overlay(alignment: .bottomTrailing) {
                    if !pinToBottom {
                        Button {
                            pinToBottom = true
                            jumpToLatest(proxy)
                        } label: {
                            Image(systemName: "arrow.down")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(.white)
                                .frame(width: 28, height: 28)
                                .background(Circle().fill(Color.accentColor))
                                .contentShape(Circle())
                        }
                        .buttonStyle(.plain)
                        .shadow(color: .black.opacity(0.2), radius: 3, y: 1)
                        .padding(8)
                        .help("跳到最新日志")
                        .transition(.opacity)
                    }
                }
                .animation(.easeInOut(duration: 0.15), value: pinToBottom)
                .onAppear {
                    DispatchQueue.main.async {
                        jumpToLatest(proxy)
                    }
                }
                .onChange(of: scrollTopID) { _, newValue in
                    // Pinned: the anchor is the newest page by definition; the
                    // AppKit pinned clip push does not reliably feed
                    // scrollPosition, so its reports must not overwrite the
                    // synced page. Unpinned: adopt the hysteresis page only when
                    // it actually changes (keeps small drift from re-windowing).
                    guard !pinToBottom else { return }
                    let page = SubagentLogRenderWindow.stableAnchorPage(
                        itemCount: agent.log.count,
                        committedTopVisiblePage: topVisiblePage,
                        liveAnchorIndex: topItemIndex(from: newValue, log: agent.log)
                    )
                    if page != topVisiblePage {
                        topVisiblePage = page
                    }
                }
                .onChange(of: agent.log.count) { _, newCount in
                    // Pinned live growth: keep the cached page deterministically
                    // synced to the newest page so an unpin never inherits a page
                    // cached from before the growth (one-frame stale slice).
                    guard pinToBottom else { return }
                    topVisiblePage = SubagentLogRenderWindow.latestPage(itemCount: newCount)
                }
                .onChange(of: pinToBottom) { _, newValue in
                    // Unpin: seed the committed page at the newest (we just left
                    // the bottom) and let `stableAnchorPage` keep it while the
                    // top-visible item is still inside the newest window; an
                    // unresolvable id (bottom anchor / cap-evicted / nil) keeps
                    // that newest page, so the viewport stays covered.
                    guard !newValue else { return }
                    topVisiblePage = SubagentLogRenderWindow.stableAnchorPage(
                        itemCount: agent.log.count,
                        committedTopVisiblePage: SubagentLogRenderWindow.latestPage(itemCount: agent.log.count),
                        liveAnchorIndex: topItemIndex(from: scrollTopID, log: agent.log)
                    )
                }
            }
            // Replace the scroll hierarchy when changing agents so AppKit does not
            // reuse the previous agent's offset or layout cache.
            .id(agent.id)
        }
        .confirmationDialog(
            "丢弃 worktree？",
            isPresented: $showDiscardConfirm,
            titleVisibility: .visible
        ) {
            Button("丢弃（不合并）", role: .destructive) {
                runDiscard()
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("将强制删除该 agent 的 worktree，不会合并进主分支；对应的 pipiui/ 内部分支也会删除，即使含独有提交。非内部分支会保留。此操作不可撤销。")
        }
    }

    @ViewBuilder
    private func closeoutSummary(_ reason: String) -> some View {
        let isHandledFailure = agent.closeoutDisposition == .cleaned
            && (agent.state == .failed || agent.state == .aborted || agent.state == .interrupted)
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(isHandledFailure ? "已处理（保留原状态）" : "收尾")
                .font(.caption2.weight(.medium))
                .foregroundStyle(isHandledFailure ? Color.secondary : Color.orange)
            Text(reason)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .textSelection(.enabled)
        }
        .padding(.horizontal, 10)
        .padding(.bottom, 7)
    }

    private var documentBase: URL? {
        DocumentReferenceScanner.effectiveBase(
            worktreePath: agent.worktreePath,
            projectURL: projectURL
        )
    }

    private var metricsHeader: some View {
        let parts = SubagentMetricsLine.parts(for: agent)
        return HStack(spacing: 8) {
            ProviderLogo(modelRef: agent.model, size: 14)
            VStack(alignment: .leading, spacing: 1) {
                Text(parts.title)
                    .font(.caption.weight(.medium))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .textSelection(.enabled)
                    .help(agent.task)
                if let model = agent.model, !model.isEmpty {
                    Text(model)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .textSelection(.enabled)
                }
            }
            Spacer(minLength: 4)
            if let context = parts.context {
                Text(context)
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .help("上下文占用")
            }
            if let cache = parts.cache {
                Text(cache)
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .help("累计缓存命中率")
            }
            if let sum = parts.sum {
                Text(sum)
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .help("累计 input+output tokens")
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
    }

    private var runningActivity: some View {
        let summary = ToolCallSummary.summarizeActivity(agent.activity)
        return HStack(alignment: .firstTextBaseline, spacing: 8) {
            ProgressView().controlSize(.mini)
            VStack(alignment: .leading, spacing: 2) {
                Text("正在执行")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                Text(summary.isEmpty ? "等待 agent 返回第一条工作记录…" : summary)
                    .font(.caption.monospaced())
                    .lineLimit(2)
                    .truncationMode(.middle)
                    .help(agent.activity)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.accentColor.opacity(0.06))
    }

    private var waitingForFirstLog: some View {
        VStack(spacing: 8) {
            Image(systemName: agent.state == .running ? "text.line.first.and.arrowtriangle.forward" : "text.alignleft")
                .font(.title3)
                .foregroundStyle(.tertiary)
            Text(agent.state == .running ? "正在等待第一条工作记录…" : "没有可显示的工作记录")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, minHeight: 120)
        .padding(10)
    }

    /// Dedicated final-result card: collapsed ~8-line Markdown preview; expand shows
    /// all stored `agent.output` (no further UI truncation). Own header + expand control.
    private var finalResultCard: some View {
        let lifecycle = SubagentPresentationScale.rowPresentation(for: agent)
        let stripped = SubagentFinalResultPresentation.displayBody(from: agent.output)
        let markdown = stripped.isEmpty ? agent.output : stripped
        let expanded = finalResultExpanded
        let cards = DocumentReferenceScanner.references(in: markdown, base: documentBase)
        return VStack(alignment: .leading, spacing: 8) {
            if let warning = lifecycle.lifecycleWarning {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(lifecycle.tone.displayColor)
                        Text(warning.title)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(lifecycle.tone.displayColor)
                    }
                    Text(warning.message)
                        .font(.caption)
                        .foregroundStyle(.primary)
                    if let reason = warning.reason {
                        Text("状态依据：\(reason)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                            .textSelection(.enabled)
                    }
                }
                .padding(9)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 7).fill(lifecycle.tone.displayColor.opacity(0.12)))
                .overlay(
                    RoundedRectangle(cornerRadius: 7)
                        .strokeBorder(lifecycle.tone.displayColor.opacity(0.28))
                )
            }

            HStack(spacing: 7) {
                Image(systemName: "flag.checkered")
                    .foregroundStyle(.secondary)
                    .imageScale(.medium)
                Text("最终结果")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
                Button {
                    finalResultExpanded.toggle()
                } label: {
                    Image(systemName: expanded ? "chevron.up" : "chevron.down")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(minWidth: 20, minHeight: 20)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help(expanded ? "收起结果" : "展开完整结果")
                .accessibilityLabel(expanded ? "收起结果" : "展开完整结果")
            }

            MarkdownTextView(
                text: markdown,
                lineLimit: expanded ? nil : SubagentFinalResultPresentation.collapsedLineLimit
            )
            .frame(maxWidth: .infinity, alignment: .leading)

            if !cards.isEmpty {
                DocumentFileCardStack(references: cards)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color.primary.opacity(0.035))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(Color.primary.opacity(0.08))
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel("最终结果")
    }

    private func toolGroup(_ items: [AgentLogItem]) -> some View {
        let groupID = items[0].id
        let expanded = expandedToolGroupIDs.contains(groupID)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 7) {
                Image(systemName: "wrench.and.screwdriver")
                    .foregroundStyle(.secondary)
                    .imageScale(.medium)
                Text(SubagentLogLayout.summaryTitle(for: items))
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 0)
                Image(systemName: expanded ? "chevron.down" : "chevron.right")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .contentShape(Rectangle())
            .onTapGesture {
                if expanded {
                    expandedToolGroupIDs.remove(groupID)
                } else {
                    expandedToolGroupIDs.insert(groupID)
                }
            }
            .pointingHandCursor()
            .accessibilityAddTraits(.isButton)
            .accessibilityLabel(SubagentLogLayout.summaryTitle(for: items))
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(Color.primary.opacity(0.035))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(Color.primary.opacity(0.06))
            )

            if expanded {
                ForEach(items) { item in
                    AgentLogRow(
                        item: item,
                        base: documentBase,
                        isExpanded: expandedLogItemIDs.contains(item.id),
                        onToggleExpand: { toggleLogItemExpanded(item.id) },
                        fontSize: chatTypography.fontSize
                    )
                }
            }
        }
    }

    private var logAnchorID: String {
        "agent-log-bottom-\(agent.id)"
    }

    /// Normal top-down layout: the latest edge is the document end, so the anchor
    /// sits at the content end and the jump aligns its bottom to the viewport.
    private func jumpToLatest(_ proxy: ScrollViewProxy) {
        guard pinToBottom else { return }
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            proxy.scrollTo(logAnchorID, anchor: .bottom)
        }
    }

    /// Toggle a log item's expand state in the lifted owner set (stable id key).
    private func toggleLogItemExpanded(_ id: Int) {
        if expandedLogItemIDs.contains(id) {
            expandedLogItemIDs.remove(id)
        } else {
            expandedLogItemIDs.insert(id)
        }
    }

    @ViewBuilder
    private func segmentRow(_ segment: SubagentLogLayout.Segment) -> some View {
        switch segment {
        case .item(let item):
            AgentLogRow(
                item: item,
                base: documentBase,
                isExpanded: expandedLogItemIDs.contains(item.id),
                onToggleExpand: { toggleLogItemExpanded(item.id) },
                fontSize: chatTypography.fontSize
            )
            .equatable()
        case .toolGroup(let items):
            toolGroup(items)
        }
    }

    /// Stable scroll-position id: a segment id is its first log item id, so the
    /// top-visible page derives from a plain `agent.log.firstIndex(id:)` lookup.
    private func segmentRowID(_ segment: SubagentLogLayout.Segment) -> String {
        "agent-log-\(agent.id)-\(segment.id)"
    }

    /// Map the reported top-visible segment id back to its log item index. The
    /// bottom anchor, an unknown id, and an id evicted by the store's 800-item
    /// cap all return nil; `SubagentLogRenderWindow.stableAnchorPage` then keeps
    /// the committed page (newest page right after unpinning, the page the user
    /// is browsing otherwise). Re-run on every body pass, so the anchor follows
    /// the item's current index without waiting for the next scroll event.
    private func topItemIndex(from scrollTopID: String?, log: [AgentLogItem]) -> Int? {
        guard let scrollTopID, scrollTopID != logAnchorID else { return nil }
        let prefix = "agent-log-\(agent.id)-"
        guard scrollTopID.hasPrefix(prefix),
              let segmentID = Int(scrollTopID.dropFirst(prefix.count)),
              let index = log.firstIndex(where: { $0.id == segmentID }) else { return nil }
        return index
    }

    @ViewBuilder
    private var worktreeMeta: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                lifecycleLabel
                if let branch = agent.worktreeBranch, !branch.isEmpty {
                    Text(branch)
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .help(agent.worktreePath ?? branch)
                }
                Spacer(minLength: 0)
            }

            if let err = agent.worktreeError, !err.isEmpty {
                Text(err)
                    .font(.caption2)
                    .foregroundStyle(.orange)
                    .textSelection(.enabled)
                    .lineLimit(2)
            }

            if agent.canReviewWorktree {
                worktreeActions
            }

            if let actionErr = store.worktreeActionError, store.selectedId == agent.id {
                Text(actionErr)
                    .font(.caption2)
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
                    .lineLimit(3)
            }
        }
    }

    @ViewBuilder
    private var lifecycleLabel: some View {
        let (text, color): (String, Color) = {
            switch agent.worktreeLifecycle {
            case .active:
                return agent.state == .running ? ("工作中", .blue) : ("审核中", .orange)
            case .pendingReview:
                return ("审核中", .orange)
            case .merged:
                return ("已合并", .green)
            case .mergedCleanupPending:
                return ("已合并·待善后", .orange)
            case .discarded:
                return ("已丢弃", .secondary)
            case .none:
                if agent.canReviewWorktree {
                    return ("审核中", .orange)
                }
                return ("", .clear)
            }
        }()
        if !text.isEmpty {
            Text(text)
                .font(.caption2.weight(.medium))
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Capsule().fill(color.opacity(0.15)))
                .foregroundStyle(color)
        }
    }

    @ViewBuilder
    private var worktreeActions: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Optional diff stat (collapsed)
            Button {
                if showDiffStat {
                    showDiffStat = false
                } else {
                    guard !diffBusy else { return }
                    diffBusy = true
                    let agentId = agent.id
                    let url = projectURL
                    // git probe + diff --stat 在后台执行，回主线程再填文本。
                    Task { @MainActor in
                        let text = await store.worktreeDiffStat(agentId: agentId, mainProjectURL: url)
                        diffStatText = text
                        showDiffStat = true
                        diffBusy = false
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    if diffBusy {
                        ProgressView().controlSize(.mini)
                    } else {
                        Image(systemName: showDiffStat ? "chevron.down" : "chevron.right")
                            .font(.caption2)
                    }
                    Text(showDiffStat ? "隐藏 diff --stat" : "查看 diff --stat")
                        .font(.caption2)
                }
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .disabled(worktreeBusy || diffBusy)

            if showDiffStat, let diff = diffStatText {
                Text(diff)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .lineLimit(12)
                    .padding(6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 4).fill(Color.primary.opacity(0.04)))
            }

            HStack(spacing: 8) {
                Button {
                    runMerge()
                } label: {
                    if worktreeBusy {
                        ProgressView().controlSize(.mini)
                    }
                    Text("合并到主分支")
                        .font(.caption.weight(.medium))
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .disabled(worktreeBusy)

                Button {
                    showDiscardConfirm = true
                } label: {
                    Text("丢弃 worktree")
                        .font(.caption)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .disabled(worktreeBusy)
            }
        }
        .padding(.top, 2)
    }

    private func runMerge() {
        guard !worktreeBusy else { return }
        worktreeBusy = true
        store.worktreeActionError = nil
        let agentId = agent.id
        let url = projectURL
        // Git CLI 在 store 内部后台执行；busy 防重入，完成后回主线程解除。
        Task { @MainActor in
            _ = await store.mergeWorktree(agentId: agentId, mainProjectURL: url)
            worktreeBusy = false
        }
    }

    private func runDiscard() {
        guard !worktreeBusy else { return }
        worktreeBusy = true
        store.worktreeActionError = nil
        let agentId = agent.id
        let url = projectURL
        Task { @MainActor in
            _ = await store.discardWorktree(agentId: agentId, mainProjectURL: url)
            worktreeBusy = false
        }
    }

}

/// 工作流水单行：文本走 Markdown，思考灰斜体，工具调用对齐主会话 ToolCard 折叠头。
private struct AgentLogRow: View, Equatable {
    let item: AgentLogItem
    var base: URL? = nil
    /// Lifted out of `@State`: a LazyVStack unmounts off-screen rows, which would
    /// discard row-local expand state on scroll. The owner (`AgentDetailView`)
    /// keeps it keyed by the stable log item id, so it survives unmount/remount and
    /// is partitioned per agent by the detail view's `.id(agent.id)` remount.
    var isExpanded: Bool = false
    var onToggleExpand: () -> Void = {}
    /// Body font size sourced from `AgentDetailView`'s `chatTypography`. A
    /// parameter (not `@Environment`) so it bumps `Equatable` and `.equatable()`
    /// rows re-render when the user changes the chat font size — matching the
    /// `MessageRow` pattern. Keeps the lightweight `Text` and `MarkdownTextView`
    /// on one project constant (no font-size jump between adjacent rows).
    var fontSize: CGFloat = ChatTypography.defaultFontSize

    static func == (lhs: AgentLogRow, rhs: AgentLogRow) -> Bool {
        // All render inputs are compared: `item`/`base` skip unchanged historical
        // rows on a log_delta batch, while `isExpanded`/`fontSize` force a re-render
        // when either flips. The toggle closure is behavior, not render input, so it
        // is excluded (same rule as `MessageRow`'s callbacks).
        lhs.item == rhs.item
            && lhs.base == rhs.base
            && lhs.isExpanded == rhs.isExpanded
            && lhs.fontSize == rhs.fontSize
    }

    var body: some View {
        switch item.kind {
        case "thinking":
            Text(MarkdownTextView.thinkingInline(item.text))
                .font(.caption)
                .foregroundStyle(.tertiary)
                .lineLimit(isExpanded ? nil : 2)
                .onTapGesture { onToggleExpand() }
        case "tool":
            toolRow
        case "toolResult":
            Text(item.text.isEmpty ? "（无输出）" : item.text)
                .font(.caption.monospaced())
                .foregroundStyle(item.isError ? .red : .secondary)
                .lineLimit(isExpanded ? nil : 3)
                .textSelection(.enabled)
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(item.isError ? Color.red.opacity(0.06) : Color.primary.opacity(0.035))
                )
                .onTapGesture { onToggleExpand() }
        default:
            VStack(alignment: .leading, spacing: 6) {
                if MarkdownTextView.logTextNeedsRichRendering(item.text) {
                    // Structured/formatted text (headings, lists, code fences,
                    // inline code/bold, …): full NSTextView-backed renderer. The
                    // streaming fast path (append-lineage detection) keeps re-renders
                    // cheap, and `Equatable` skips unchanged historical rows.
                    MarkdownTextView(
                        text: item.text,
                        lineLimit: isExpanded ? nil : 3
                    )
                    .contentShape(Rectangle())
                    .onTapGesture { onToggleExpand() }
                } else {
                    // Lightweight selectable `Text` for plain log lines: no
                    // NSTextView, no markdown parse, no measurement host. This is
                    // the common realtime-log row, kept off the expensive path.
                    Text(item.text)
                        .font(.system(size: fontSize))
                        .foregroundStyle(.primary)
                        .lineLimit(isExpanded ? nil : 3)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                        .contentShape(Rectangle())
                        .onTapGesture { onToggleExpand() }
                }
                let cards = DocumentReferenceScanner.references(in: item.text, base: base)
                if !cards.isEmpty {
                    DocumentFileCardStack(references: cards)
                }
            }
        }
    }

    private var toolSummary: String {
        ToolCallSummary.summarize(name: item.name, argsJSON: item.text).summary
    }

    private var editFilePresentation: FileChangeFilePresentation? {
        guard item.name == "edit",
              let data = item.text.data(using: .utf8),
              let arguments = J.parse(data),
              let payload = FileChangePayload.parse(toolName: "edit", arguments: arguments)
        else {
            return nil
        }
        let callID = "subagent-edit-\(item.id)"
        let call = ToolCallBlock(
            id: callID,
            name: "edit",
            argsSummary: payload.path,
            fileChangePayload: payload
        )
        // Reuse the main transcript's FileChangeGroupPresentation and lineDiff
        // accounting so the +/− totals and line hunks cannot drift.
        return FileChangeGroupPresentation.make(
            blocks: [.toolCall(call)],
            toolRuns: [callID: ToolRun()],
            projectURL: nil
        ).files.first
    }

    @ViewBuilder
    private var toolRow: some View {
        if let file = editFilePresentation {
            editToolRow(file)
        } else {
            genericToolRow
        }
    }

    private var genericToolRow: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Image(systemName: "wrench.and.screwdriver")
                    .font(.caption2)
                    .foregroundStyle(.blue)
                Text(item.name)
                    .font(.caption.weight(.semibold).monospaced())
                Text(toolSummary)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 0)
                if !item.text.isEmpty {
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
            .onTapGesture {
                if !item.text.isEmpty { onToggleExpand() }
            }
            .pointingHandCursor(!item.text.isEmpty)

            if isExpanded, !item.text.isEmpty {
                Divider()
                Text(item.text)
                    .font(.caption2.monospaced())
                    .foregroundStyle(.tertiary)
                    .textSelection(.enabled)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .background(RoundedRectangle(cornerRadius: 6).fill(Color.blue.opacity(0.06)))
    }

    private func editToolRow(_ file: FileChangeFilePresentation) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Image(systemName: "pencil.line")
                    .font(.caption2)
                    .foregroundStyle(.blue)
                Text("edit")
                    .font(.caption.weight(.semibold).monospaced())
                Text(file.displayPath)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text("+\(file.additions)")
                    .foregroundStyle(.green)
                Text("−\(file.deletions)")
                    .foregroundStyle(.red)
                Spacer(minLength: 0)
                Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            .font(.caption.monospacedDigit().weight(.medium))
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
            .onTapGesture { onToggleExpand() }
            .pointingHandCursor(true)

            if isExpanded {
                Divider()
                if let message = file.qualityMessage {
                    Label(message, systemImage: "info.circle")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .padding(8)
                }
                if file.lines.isEmpty {
                    Text("没有行级变化")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(8)
                } else {
                    ScrollView(.horizontal) {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            ForEach(file.lines) { line in
                                editDiffLine(line)
                            }
                        }
                    }
                    .frame(maxHeight: 260)
                }
            }
        }
        .textSelection(.enabled)
        .background(RoundedRectangle(cornerRadius: 6).fill(Color.blue.opacity(0.06)))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("编辑 \(file.displayPath)，新增 \(file.additions) 行，删除 \(file.deletions) 行")
    }

    private func editDiffLine(_ line: FileChangeDiffLine) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            Text(line.oldLineNumber.map(String.init) ?? "")
                .frame(width: 30, alignment: .trailing)
            Text(line.newLineNumber.map(String.init) ?? "")
                .frame(width: 30, alignment: .trailing)
            Text(editDiffMarker(line.kind))
                .frame(width: 18)
            Text(line.text.isEmpty ? " " : line.text)
                .fixedSize(horizontal: true, vertical: false)
        }
        .font(.caption2.monospaced())
        .foregroundStyle(editDiffForeground(line.kind))
        .padding(.vertical, 1)
        .padding(.trailing, 8)
        .background(editDiffBackground(line.kind))
    }

    private func editDiffMarker(_ kind: FileChangeDiffLine.Kind) -> String {
        switch kind {
        case .addition: return "+"
        case .deletion: return "−"
        case .separator: return ""
        }
    }

    private func editDiffForeground(_ kind: FileChangeDiffLine.Kind) -> Color {
        switch kind {
        case .addition: return .green
        case .deletion: return .red
        case .separator: return .secondary
        }
    }

    private func editDiffBackground(_ kind: FileChangeDiffLine.Kind) -> Color {
        switch kind {
        case .addition: return Color.green.opacity(0.09)
        case .deletion: return Color.red.opacity(0.09)
        case .separator: return Color.secondary.opacity(0.06)
        }
    }
}
