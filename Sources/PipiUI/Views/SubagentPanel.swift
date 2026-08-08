import SwiftUI
import AppKit

/// 右侧 Subagent 面板：上半是 agent 树列表，下半是选中 agent 的实时详情。
struct SubagentPanel: View {
    @ObservedObject var store: SubagentStore
    /// Session project root (main git worktree) for merge/discard.
    var projectURL: URL
    /// 中止运行中 agent（ChatSession.abortSubagent → /subagent_abort RPC）。
    var onAbort: (String) -> Void
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
                            .foregroundStyle(summary.failedAttentionCount > 0 ? Color.red : Color.orange)
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
        .padding(.vertical, 8)
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
                            onMarkCleaned: { store.markCleaned(id: agent.id) }
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

    /// 失败徽章点击：选中并滚动到第一个需关注的失败 agent；全部已清理时回退到第一个失败项。
    /// 失败/需关注行是列表优先行，任何分页下都渲染，故 scrollTo 总能命中，无需翻页。
    private func focusOnFailedAgent() {
        let order = store.displayOrder
        let target = order.first(where: {
            $0.state == .failed && !SubagentPresentationScale.isCleaned($0)
        }) ?? order.first(where: { $0.state == .failed })
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
    var onMarkCleaned: (() -> Void)? = nil

    var body: some View {
        if agent.state == .failed, !SubagentPresentationScale.isCleaned(agent) {
            rowContent.contextMenu {
                Button("标记已处理") {
                    onMarkCleaned?()
                }
            }
        } else {
            rowContent
        }
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
                    if agent.name == "secretary" {
                        Text("收尾")
                            .font(.caption2)
                            .foregroundStyle(.purple)
                            .padding(.horizontal, 4)
                            .padding(.vertical, 1)
                            .background(Capsule().fill(Color.purple.opacity(0.15)))
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
                if agent.cost > 0 {
                    Text(formatSpend(usdCost: agent.cost, unit: unit, rate: rate))
                }
                durationText
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
            .padding(.horizontal, 4)
            .padding(.vertical, 1)
            .background(Capsule().fill(color.opacity(0.15)))
            .foregroundStyle(color)
    }

    @ViewBuilder
    private var statusDot: some View {
        switch agent.state {
        case .running:
            ProgressView().controlSize(.mini).tint(.secondary)
        case .ok:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green).font(.caption)
        case .failed:
            Image(systemName: "xmark.circle.fill").foregroundStyle(.red).font(.caption)
        case .aborted:
            Image(systemName: "stop.circle.fill").foregroundStyle(.orange).font(.caption)
        case .interrupted:
            Image(systemName: "bolt.slash.circle.fill").foregroundStyle(.orange).font(.caption)
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

    var body: some View {
        // Pinned live mode anchors the window at the newest page so appended rows
        // are always rendered; unpinned scrolling anchors it at the top-visible
        // item, re-resolved from the live log on every pass so cap evictions that
        // shift or drop the anchored row move the window deterministically.
        // Normal document order (oldest top → newest bottom), no flip.
        let anchorPage = SubagentLogRenderWindow.anchorPage(
            pinned: pinToBottom,
            topVisibleItemIndex: topItemIndex(from: scrollTopID, log: agent.log),
            previousTopVisiblePage: topVisiblePage,
            itemCount: agent.log.count
        )
        let window = SubagentLogRenderWindow.resolve(
            itemCount: agent.log.count,
            topVisiblePage: anchorPage
        )
        let segments = SubagentLogLayout.plan(Array(agent.log[window.range]))

        VStack(alignment: .leading, spacing: 0) {
            metricsHeader
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
                    // Eager stack: the window slides by dropping/adding a whole page
                    // while `.scrollPosition` keeps the top-visible row anchored;
                    // NSTextView-backed markdown rows need exact heights before the
                    // anchor can settle, so lazy height estimation is avoided (same
                    // choice as the main transcript; ≤ 400 rows).
                    VStack(alignment: .leading, spacing: 8) {
                        if segments.isEmpty {
                            waitingForFirstLog
                        } else {
                            ForEach(segments) { segment in
                                segmentRow(segment)
                                    .id(segmentRowID(segment))
                            }
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
                    // synced page.
                    guard !pinToBottom else { return }
                    let page = SubagentLogRenderWindow.anchorPage(
                        pinned: false,
                        topVisibleItemIndex: topItemIndex(from: newValue, log: agent.log),
                        previousTopVisiblePage: topVisiblePage,
                        itemCount: agent.log.count
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
                    // Unpin: re-resolve the anchor from the live scroll id right
                    // away instead of trusting the cached page; an unresolvable id
                    // (bottom anchor / cap-evicted / nil) falls back to the newest
                    // page — the user just left the bottom, so that window covers
                    // the viewport.
                    guard !newValue else { return }
                    topVisiblePage = SubagentLogRenderWindow.anchorPage(
                        pinned: false,
                        topVisibleItemIndex: topItemIndex(from: scrollTopID, log: agent.log),
                        previousTopVisiblePage: SubagentLogRenderWindow.latestPage(itemCount: agent.log.count),
                        itemCount: agent.log.count
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
                    AgentLogRow(item: item, base: documentBase)
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

    @ViewBuilder
    private func segmentRow(_ segment: SubagentLogLayout.Segment) -> some View {
        switch segment {
        case .item(let item):
            AgentLogRow(item: item, base: documentBase)
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
    /// cap all return nil; `SubagentLogRenderWindow.anchorPage` then decides the
    /// fallback (newest page right after unpinning, clamped previous page while
    /// browsing history). Re-run on every body pass, so the anchor follows the
    /// item's current index without waiting for the next scroll event.
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
private struct AgentLogRow: View {
    let item: AgentLogItem
    var base: URL? = nil
    @State private var expanded = false

    var body: some View {
        switch item.kind {
        case "thinking":
            Text(item.text)
                .font(.caption)
                .italic()
                .foregroundStyle(.tertiary)
                .lineLimit(expanded ? nil : 2)
                .onTapGesture { expanded.toggle() }
        case "tool":
            toolRow
        case "toolResult":
            Text(item.text.isEmpty ? "（无输出）" : item.text)
                .font(.caption.monospaced())
                .foregroundStyle(item.isError ? .red : .secondary)
                .lineLimit(expanded ? nil : 3)
                .textSelection(.enabled)
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(item.isError ? Color.red.opacity(0.06) : Color.primary.opacity(0.035))
                )
                .onTapGesture { expanded.toggle() }
        default:
            VStack(alignment: .leading, spacing: 6) {
                MarkdownTextView(
                    text: item.text,
                    lineLimit: expanded ? nil : 3
                )
                .contentShape(Rectangle())
                .onTapGesture { expanded.toggle() }
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
                    Image(systemName: expanded ? "chevron.up" : "chevron.down")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
            .onTapGesture {
                if !item.text.isEmpty { expanded.toggle() }
            }
            .pointingHandCursor(!item.text.isEmpty)

            if expanded, !item.text.isEmpty {
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
                Image(systemName: expanded ? "chevron.up" : "chevron.down")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            .font(.caption.monospacedDigit().weight(.medium))
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
            .onTapGesture { expanded.toggle() }
            .pointingHandCursor(true)

            if expanded {
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
