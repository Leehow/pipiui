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
    var onClose: () -> Void

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
                VSplitView {
                    agentList
                        .frame(minHeight: 64, idealHeight: 160)
                    detail
                        .frame(minHeight: 56)
                }
            }
        }
        .background(Color(nsColor: .textBackgroundColor))
        .onAppear {
            Task { @MainActor in
                await store.reconcileWorktreeLifecycles(mainProjectURL: projectURL)
            }
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Label("Subagents", systemImage: "person.2")
                .font(.callout.weight(.semibold))
            if store.runningCount > 0 {
                Text("\(store.runningCount) 运行中")
                    .font(.caption)
                    .foregroundStyle(.green)
            }
            Spacer()
            if store.totalCost > 0 {
                Text(String(format: "$%.4f", store.totalCost))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            Button("清空已完成") { store.clearFinished() }
                .buttonStyle(.plain)
                .font(.caption)
                .foregroundStyle(.secondary)
                .disabled(store.agents.allSatisfy { $0.state == .running })
            Button(action: onClose) {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
        }
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
            Text("让 pi 用 subagent 工具委派任务后，这里会实时显示 agent 树。\n例如：「用 lead 组织两个 explore 并行调研 …」")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(20)
    }

    private var agentList: some View {
        ScrollView {
            LazyVStack(spacing: 2) {
                ForEach(store.displayOrder) { agent in
                    AgentRow(
                        agent: agent,
                        selected: agent.id == store.selectedId,
                        abortPending: store.abortPending.contains(agent.id),
                        onAbort: { onAbort(agent.id) }
                    )
                        .contentShape(Rectangle())
                        .onTapGesture { store.selectedId = agent.id }
                }
            }
            .padding(8)
            .overlayScrollers()
        }
        .scrollIndicators(.automatic)
    }

    @ViewBuilder
    private var detail: some View {
        if let agent = store.agents.first(where: { $0.id == store.selectedId }) {
            AgentDetailView(agent: agent, store: store, projectURL: projectURL)
        } else {
            Text("选择一个 agent 查看详情")
                .font(.caption)
                .foregroundStyle(.tertiary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

private struct AgentRow: View {
    let agent: SubagentInfo
    let selected: Bool
    var abortPending: Bool = false
    var onAbort: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 8) {
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
                    if agent.name == "lead" {
                        Text("组长")
                            .font(.caption2)
                            .padding(.horizontal, 4)
                            .padding(.vertical, 1)
                            .background(Capsule().fill(Color.accentColor.opacity(0.15)))
                    }
                    if agent.name == "secretary" {
                        Text("收尾")
                            .font(.caption2)
                            .padding(.horizontal, 4)
                            .padding(.vertical, 1)
                            .background(Capsule().fill(Color.purple.opacity(0.15)))
                    }
                    if agent.state == .running, agent.stalled {
                        lifecycleBadge(
                            text: agent.stalledIdleSec > 0 ? "卡住 \(agent.stalledIdleSec)s" : "卡住",
                            color: .yellow
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
                    Text(String(format: "$%.3f", agent.cost))
                }
                durationText
            }
            .font(.caption2.monospacedDigit())
            .foregroundStyle(.tertiary)
            if agent.state == .running, let onAbort {
                Button(action: onAbort) {
                    Image(systemName: "stop.circle")
                        .font(.callout)
                }
                .buttonStyle(HoverButtonStyle(base: abortPending ? Color.secondary.opacity(0.4) : .secondary, hovered: .red))
                .disabled(abortPending)
                .help(abortPending ? "正在中止…" : "中止该 agent（/subagent_abort）")
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(selected ? Color.accentColor.opacity(0.12) : Color.clear)
        )
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
            ProgressView().controlSize(.mini)
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

struct AgentAutoScrollGate {
    struct Token: Equatable {
        let agentID: String
        let generation: UInt
    }

    private(set) var activeToken: Token?
    private var generation: UInt = 0

    static func anchorID(for agentID: String) -> String {
        "agent-bottom-\(agentID)"
    }

    mutating func request(agentID: String, isPinned: Bool) -> Token? {
        guard isPinned else {
            invalidate()
            return nil
        }
        if let activeToken {
            if activeToken.agentID == agentID {
                return nil
            }
            invalidate()
        }
        generation &+= 1
        let token = Token(agentID: agentID, generation: generation)
        activeToken = token
        return token
    }

    func permits(_ token: Token, agentID: String, isPinned: Bool) -> Bool {
        isPinned && token.agentID == agentID && activeToken == token
    }

    @discardableResult
    mutating func complete(_ token: Token) -> Bool {
        guard activeToken == token else { return false }
        activeToken = nil
        return true
    }

    mutating func invalidate() {
        generation &+= 1
        activeToken = nil
    }
}

private struct AgentDetailView: View {
    let agent: SubagentInfo
    @ObservedObject var store: SubagentStore
    var projectURL: URL
    @Environment(\.scenePhase) private var scenePhase
    @State private var pinToBottom = true
    @State private var worktreeBusy = false
    @State private var showDiscardConfirm = false
    @State private var showDiffStat = false
    @State private var diffStatText: String?
    @State private var diffBusy = false
    @State private var autoScrollGate = AgentAutoScrollGate()
    @State private var autoScrollTask: Task<Void, Never>?
    @State private var expandedToolGroupIDs: Set<Int> = []

    var body: some View {
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
                    VStack(spacing: 0) {
                        LazyVStack(alignment: .leading, spacing: 8) {
                            if agent.log.isEmpty {
                                waitingForFirstLog
                            } else {
                                ForEach(SubagentLogLayout.plan(agent.log)) { segment in
                                    switch segment {
                                    case .item(let item):
                                        AgentLogRow(item: item, base: documentBase)
                                    case .toolGroup(let items):
                                        toolGroup(items)
                                    }
                                }
                            }
                            Color.clear
                                .frame(height: 1)
                                .id(AgentAutoScrollGate.anchorID(for: agent.id))
                        }
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    // Keep AppKit observation outside LazyVStack placements. Putting
                    // the representable on the lazy bottom row can make its binding
                    // write participate in the same AttributeGraph layout pass.
                    .background(StickToBottomTracker(isPinned: $pinToBottom))
                    .overlayScrollers()
                }
                .scrollIndicators(.automatic)
                .overlay(alignment: .bottomTrailing) {
                    if !pinToBottom {
                        Button {
                            pinToBottom = true
                            requestAutoScroll(proxy)
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
                        .help("跳到底部")
                        .transition(.opacity)
                    }
                }
                .animation(.easeInOut(duration: 0.15), value: pinToBottom)
                .onAppear { requestAutoScroll(proxy) }
                .onChange(of: agent.log.count) { _, _ in
                    requestAutoScroll(proxy)
                }
                .onChange(of: agent.output.count) { _, _ in
                    requestAutoScroll(proxy)
                }
                .onChange(of: agent.id) { _, _ in
                    cancelAutoScroll()
                    pinToBottom = true
                    showDiffStat = false
                    diffStatText = nil
                    requestAutoScroll(proxy)
                }
                .onChange(of: pinToBottom) { _, pinned in
                    if !pinned {
                        cancelAutoScroll()
                    }
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { requestAutoScroll(proxy) }
                }
                .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
                    requestAutoScroll(proxy)
                }
                .onDisappear { cancelAutoScroll() }
            }
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
            Text("将强制删除该 agent 的 worktree，不会合并进主分支；对应的 pipiui/agent-* 内部分支也会删除，即使含独有提交。非内部分支会保留。此操作不可撤销。")
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

    private func requestAutoScroll(_ proxy: ScrollViewProxy) {
        guard let token = autoScrollGate.request(agentID: agent.id, isPinned: pinToBottom) else {
            return
        }
        autoScrollTask = Task { @MainActor in
            defer {
                if autoScrollGate.complete(token) {
                    autoScrollTask = nil
                }
            }

            // One task owns the complete settle sequence. Log/output bursts and the
            // two activation notifications coalesce into this bounded sequence.
            await Task.yield()
            let settleDelays: [UInt64] = [0, 50_000_000, 150_000_000]
            for delay in settleDelays {
                if delay > 0 {
                    try? await Task.sleep(nanoseconds: delay)
                }
                guard !Task.isCancelled,
                      autoScrollGate.permits(token, agentID: agent.id, isPinned: pinToBottom) else {
                    return
                }
                var transaction = Transaction()
                transaction.disablesAnimations = true
                withTransaction(transaction) {
                    proxy.scrollTo(AgentAutoScrollGate.anchorID(for: token.agentID), anchor: .bottom)
                }
            }
        }
    }

    private func cancelAutoScroll() {
        autoScrollGate.invalidate()
        autoScrollTask?.cancel()
        autoScrollTask = nil
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
                MarkdownTextView(text: item.text)
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

    private var toolRow: some View {
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
}
