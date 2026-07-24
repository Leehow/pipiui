import SwiftUI
import AppKit

/// 右侧 Subagent 面板：上半是 agent 树列表，下半是选中 agent 的实时详情。
struct SubagentPanel: View {
    @ObservedObject var store: SubagentStore
    /// Session project root (main git worktree) for merge/discard.
    var projectURL: URL
    var onClose: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            if store.agents.isEmpty {
                emptyHint
            } else {
                VSplitView {
                    agentList
                        .frame(minHeight: 64, idealHeight: 160)
                    detail
                        .frame(minHeight: 88)
                }
            }
        }
        .background(Color(nsColor: .textBackgroundColor))
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
                    AgentRow(agent: agent, selected: agent.id == store.selectedId)
                        .contentShape(Rectangle())
                        .onTapGesture { store.selectedId = agent.id }
                }
            }
            .padding(8)
        }
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
                    if agent.worktreeLifecycle == .pendingReview || agent.canReviewWorktree {
                        lifecycleBadge(text: "审核", color: .orange)
                    } else if agent.worktreeLifecycle == .merged {
                        lifecycleBadge(text: "已合并", color: .green)
                    } else if agent.worktreeLifecycle == .discarded {
                        lifecycleBadge(text: "已丢弃", color: .secondary)
                    } else if agent.worktreeLifecycle == .active, agent.state == .running {
                        lifecycleBadge(text: "wt", color: .blue)
                    }
                }
                Text(agent.state == .running && !agent.activity.isEmpty ? agent.activity : (agent.title ?? agent.task))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            Spacer()
            if agent.cost > 0 {
                Text(String(format: "$%.3f", agent.cost))
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(selected ? Color.accentColor.opacity(0.12) : Color.clear)
        )
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

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                if let title = agent.title, !title.isEmpty {
                    Text(title)
                        .font(.callout.weight(.medium))
                        .textSelection(.enabled)
                }
                Text(agent.task)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
                    .textSelection(.enabled)
                HStack(spacing: 10) {
                    if let model = agent.model {
                        Text(model).font(.caption2.monospaced()).foregroundStyle(.tertiary)
                    }
                    Text("\(agent.turns) turns").font(.caption2).foregroundStyle(.tertiary)
                    Text(String(format: "$%.4f", agent.cost)).font(.caption2.monospacedDigit()).foregroundStyle(.tertiary)
                    Text(durationText).font(.caption2).foregroundStyle(.tertiary)
                }
                if agent.hasWorktreeMeta {
                    worktreeMeta
                }
            }
            .padding(10)
            Divider()
            if agent.state == .running {
                runningActivity
                Divider()
            }
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 8) {
                        if agent.log.isEmpty {
                            waitingForFirstLog
                        } else {
                            ForEach(agent.log) { item in
                                AgentLogRow(item: item)
                            }
                        }
                        Color.clear
                            .frame(height: 1)
                            .id("agent-bottom")
                            .background(StickToBottomTracker(isPinned: $pinToBottom))
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .overlay(alignment: .bottomTrailing) {
                    if !pinToBottom {
                        Button {
                            pinToBottom = true
                            scrollToBottom(proxy, retry: true)
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
                .onAppear { scrollToBottom(proxy) }
                .onChange(of: agent.log.count) { _, _ in
                    scrollToBottom(proxy)
                }
                .onChange(of: agent.output.count) { _, _ in
                    scrollToBottom(proxy)
                }
                .onChange(of: agent.id) { _, _ in
                    pinToBottom = true
                    showDiffStat = false
                    diffStatText = nil
                    scrollToBottom(proxy, retry: true)
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { scrollToBottom(proxy, retry: true) }
                }
                .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
                    scrollToBottom(proxy, retry: true)
                }
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
            Text("将强制删除该 agent 的 worktree 与本地分支，不会合并进主分支。此操作不可撤销。")
        }
    }

    private var runningActivity: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            ProgressView().controlSize(.mini)
            VStack(alignment: .leading, spacing: 2) {
                Text("正在执行")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                Text(agent.activity.isEmpty ? "等待 agent 返回第一条工作记录…" : agent.activity)
                    .font(.caption.monospaced())
                    .lineLimit(2)
                    .truncationMode(.middle)
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

    private func scrollToBottom(_ proxy: ScrollViewProxy, retry: Bool = false) {
        guard pinToBottom else { return }
        let run = {
            // 在途 async 到达时用户可能已上翻 unpin，必须再检查
            guard pinToBottom else { return }
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                proxy.scrollTo("agent-bottom", anchor: .bottom)
            }
        }
        DispatchQueue.main.async(execute: run)
        if retry {
            // 激活/布局后多档重试，等 clip 尺寸稳定后再贴底
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05, execute: run)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2, execute: run)
        }
    }

    private var durationText: String {
        let end = agent.ended ?? Date()
        let seconds = Int(end.timeIntervalSince(agent.started))
        return seconds < 60 ? "\(seconds)s" : "\(seconds / 60)m\(seconds % 60)s"
    }

    @ViewBuilder
    private var worktreeMeta: some View {
        VStack(alignment: .leading, spacing: 4) {
            // Lifecycle badge + running branch label
            HStack(spacing: 6) {
                lifecycleLabel
                if agent.state == .running, let branch = agent.worktreeBranch, !branch.isEmpty {
                    Text("工作中 · \(branch)")
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }

            if let branch = agent.worktreeBranch, !branch.isEmpty, agent.state != .running {
                HStack(spacing: 4) {
                    Image(systemName: "arrow.triangle.branch")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text(branch)
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            if let path = agent.worktreePath, !path.isEmpty {
                Text(shortenPath(path))
                    .font(.caption2.monospaced())
                    .foregroundStyle(.tertiary)
                    .textSelection(.enabled)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .help(path)
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
                    .lineLimit(4)
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
                    diffStatText = store.worktreeDiffStat(agentId: agent.id, mainProjectURL: projectURL)
                    showDiffStat = true
                }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: showDiffStat ? "chevron.down" : "chevron.right")
                        .font(.caption2)
                    Text(showDiffStat ? "隐藏 diff --stat" : "查看 diff --stat")
                        .font(.caption2)
                }
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .disabled(worktreeBusy)

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
        worktreeBusy = true
        store.worktreeActionError = nil
        // Git CLI is synchronous; keep on main (agent merges are typically small).
        _ = store.mergeWorktree(agentId: agent.id, mainProjectURL: projectURL)
        worktreeBusy = false
    }

    private func runDiscard() {
        worktreeBusy = true
        store.worktreeActionError = nil
        _ = store.discardWorktree(agentId: agent.id, mainProjectURL: projectURL)
        worktreeBusy = false
    }

    /// Prefer last two path components for display; full path remains selectable via help/selection.
    private func shortenPath(_ path: String) -> String {
        let ns = path as NSString
        let last = ns.lastPathComponent
        let parent = (ns.deletingLastPathComponent as NSString).lastPathComponent
        if parent.isEmpty || parent == "/" { return last }
        return "\(parent)/\(last)"
    }
}

/// 工作流水单行：文本走 Markdown，思考灰斜体，工具调用/结果紧凑卡片。
private struct AgentLogRow: View {
    let item: AgentLogItem
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
            HStack(spacing: 6) {
                Image(systemName: "wrench.and.screwdriver")
                    .font(.caption2)
                    .foregroundStyle(.blue)
                Text(item.name)
                    .font(.caption.weight(.semibold).monospaced())
                Text(item.text)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(RoundedRectangle(cornerRadius: 6).fill(Color.blue.opacity(0.06)))
        case "toolResult":
            Text(item.text.isEmpty ? "（无输出）" : item.text)
                .font(.caption.monospaced())
                .foregroundStyle(item.isError ? .red : .secondary)
                .lineLimit(expanded ? nil : 5)
                .textSelection(.enabled)
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(item.isError ? Color.red.opacity(0.06) : Color.primary.opacity(0.035))
                )
                .onTapGesture { expanded.toggle() }
        default:
            MarkdownTextView(text: item.text)
        }
    }
}
