import SwiftUI
import AppKit

/// 单条消息行。只依赖自己的 item 和相关 toolRuns/subagents（Equatable），
/// 流式更新时未变化的行不会重新计算 body。
struct MessageRow: View, Equatable {
    let item: ChatItem
    let toolRuns: [String: ToolRun]
    var subagents: [SubagentInfo] = []
    var isStreaming: Bool = false
    var onSelectAgent: ((String) -> Void)?

    static func == (lhs: MessageRow, rhs: MessageRow) -> Bool {
        lhs.item == rhs.item
            && lhs.toolRuns == rhs.toolRuns
            && lhs.subagents == rhs.subagents
            && lhs.isStreaming == rhs.isStreaming
    }

    var body: some View {
        switch item.role {
        case "user":
            userView
        case "system":
            systemView
        default:
            assistantView
        }
    }

    private var userView: some View {
        HStack {
            Spacer(minLength: 60)
            VStack(alignment: .trailing, spacing: 8) {
                ForEach(imageBlocks) { img in
                    if let ns = NSImage(data: img.data) {
                        Image(nsImage: ns)
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .frame(maxWidth: 280, maxHeight: 200)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                }
                if !userDisplayText.isEmpty {
                    Text(userDisplayText)
                        .textSelection(.enabled)
                        .foregroundStyle(.white)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color.accentColor)
            )
        }
    }

    private var systemView: some View {
        Text(plainText)
            .font(.caption.monospaced())
            .foregroundStyle(.secondary)
            .textSelection(.enabled)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.primary.opacity(0.04))
            )
    }

    private var assistantView: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(item.blocks.enumerated()), id: \.offset) { _, block in
                switch block {
                case .text(let text):
                    MarkdownTextView(text: text)
                case .thinking(let text):
                    ThinkingBlockView(text: text, isStreaming: isStreaming)
                case .toolCall(let call):
                    if call.name == "subagent", !agentsFor(call).isEmpty {
                        SubagentToolCardView(
                            call: call,
                            run: toolRuns[call.id],
                            agents: agentsFor(call),
                            onSelect: onSelectAgent
                        )
                    } else {
                        ToolCardView(call: call, run: toolRuns[call.id])
                    }
                case .image(let img):
                    if let ns = NSImage(data: img.data) {
                        Image(nsImage: ns)
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .frame(maxWidth: 360, maxHeight: 240)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                case .video(let vid):
                    VideoBlockView(path: vid.path)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var plainText: String {
        item.blocks.compactMap { block -> String? in
            if case .text(let t) = block { return t }
            return nil
        }.joined(separator: "\n")
    }

    /// User bubble text without attachment path footnotes (still sent to the model).
    private var userDisplayText: String {
        ImageAttachment.stripAttachmentPathsForDisplay(plainText)
    }

    private var imageBlocks: [ImageBlock] {
        item.blocks.compactMap { block -> ImageBlock? in
            if case .image(let img) = block { return img }
            return nil
        }
    }

    /// 属于某次 subagent 工具调用的 agent（含它们的子孙）
    private func agentsFor(_ call: ToolCallBlock) -> [SubagentInfo] {
        let roots = subagents.filter { $0.toolCallId == call.id }
        guard !roots.isEmpty else { return [] }
        let rootIds = Set(roots.map(\.id))
        // 子孙：parentId 链上挂在这些根下的（一般就两层，线性扫即可）
        var result = roots
        var frontier = rootIds
        while true {
            let children = subagents.filter { a in
                a.parentId.map { frontier.contains($0) } == true && !result.contains(where: { $0.id == a.id })
            }
            if children.isEmpty { break }
            result.append(contentsOf: children)
            frontier = Set(children.map(\.id))
        }
        return result
    }
}

/// 主界面里的 subagent 工具卡片：每个被派出的 agent 一行实时状态。
struct SubagentToolCardView: View {
    let call: ToolCallBlock
    let run: ToolRun?
    let agents: [SubagentInfo]
    var onSelect: ((String) -> Void)?

    private var runningCount: Int { agents.filter { $0.state == .running }.count }
    private var totalCost: Double { agents.reduce(0) { $0 + $1.cost } }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "person.2")
                    .foregroundStyle(runningCount > 0 ? Color.blue : Color.green)
                Text("subagent")
                    .font(.callout.weight(.semibold).monospaced())
                Text(runningCount > 0 ? "\(runningCount)/\(agents.count) 运行中" : "\(agents.count) 个完成")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                if totalCost > 0 {
                    Text(String(format: "$%.3f", totalCost))
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.tertiary)
                }
                if runningCount > 0 {
                    ProgressView().controlSize(.mini)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

            Divider()

            VStack(alignment: .leading, spacing: 0) {
                ForEach(agents) { agent in
                    HStack(spacing: 8) {
                        if agent.depth > 1 {
                            Image(systemName: "arrow.turn.down.right")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                                .padding(.leading, CGFloat(agent.depth - 1) * 14)
                        }
                        statusIcon(agent.state)
                        Text(agent.name)
                            .font(.caption.weight(.semibold))
                        Text(statusLine(agent))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .contentShape(Rectangle())
                    .onTapGesture { onSelect?(agent.id) }
                }
            }
        }
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.primary.opacity(0.03)))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color.primary.opacity(0.08)))
    }

    @ViewBuilder
    private func statusIcon(_ state: SubagentInfo.State) -> some View {
        switch state {
        case .running: ProgressView().controlSize(.mini)
        case .ok: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green).font(.caption)
        case .failed: Image(systemName: "xmark.circle.fill").foregroundStyle(.red).font(.caption)
        case .aborted: Image(systemName: "stop.circle.fill").foregroundStyle(.orange).font(.caption)
        case .interrupted: Image(systemName: "bolt.slash.circle.fill").foregroundStyle(.orange).font(.caption)
        }
    }

    private func statusLine(_ agent: SubagentInfo) -> String {
        switch agent.state {
        case .running:
            return agent.activity.isEmpty ? "思考中…" : agent.activity
        case .ok:
            return "完成 · \(agent.turns) turns · " + String(format: "$%.3f", agent.cost)
        case .failed:
            return "失败 · " + String(agent.task.prefix(60))
        case .aborted:
            return "已中止"
        case .interrupted:
            return "已中断（App 重启）"
        }
    }
}

/// chars÷4 estimate for Thinking header (not a real tokenizer).
enum ThinkingTokenEstimate {
    static func tokenCount(for text: String) -> Int {
        guard !text.isEmpty else { return 0 }
        return max(1, Int((Double(text.count) / 4.0).rounded()))
    }

    /// Compact count: 999 → "999"; 1000 → "1k"; 1200 → "1.2k"; 15400 → "15.4k"
    static func formatCount(_ n: Int) -> String {
        guard n >= 1000 else { return String(n) }
        let k = Double(n) / 1000.0
        let raw = String(format: "%.1f", k)
        if raw.hasSuffix(".0") {
            return String(raw.dropLast(2)) + "k"
        }
        return raw + "k"
    }

    /// nil when no tokens to show; otherwise "~1.2k tokens"
    static func labelSuffix(for text: String) -> String? {
        let n = tokenCount(for: text)
        guard n > 0 else { return nil }
        return "~\(formatCount(n)) tokens"
    }
}

struct ThinkingBlockView: View {
    let text: String
    var isStreaming: Bool = false
    @State private var expanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            Text(text)
                .font(.callout)
                .italic()
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 4)
        } label: {
            HStack(spacing: 6) {
                Label("Thinking", systemImage: "brain")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                if let suffix = ThinkingTokenEstimate.labelSuffix(for: text) {
                    Text("· \(suffix)")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                if isStreaming {
                    ProgressView()
                        .controlSize(.mini)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color.primary.opacity(0.035))
        )
    }
}

/// 用户已发送、assistant 尚无可展示 block 时的轻量等待提示。
struct WaitingPlaceholderView: View {
    let message: String

    var body: some View {
        HStack(spacing: 8) {
            ProgressView()
                .controlSize(.small)
            Text(message)
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(message)
    }
}

struct ToolCardView: View {
    let call: ToolCallBlock
    let run: ToolRun?
    @State private var expanded = false

    private var statusColor: Color {
        guard let run else { return .secondary }
        if run.isRunning { return .blue }
        return run.isError ? .red : .green
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: iconName)
                    .foregroundStyle(statusColor)
                Text(call.name)
                    .font(.callout.weight(.semibold).monospaced())
                Text(call.argsSummary)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer()
                if run?.isRunning == true {
                    ProgressView().controlSize(.mini)
                } else if run != nil {
                    Image(systemName: run!.isError ? "xmark.circle.fill" : "checkmark.circle.fill")
                        .foregroundStyle(statusColor)
                        .font(.caption)
                }
                if hasOutput {
                    Button {
                        expanded.toggle()
                    } label: {
                        Image(systemName: expanded ? "chevron.up" : "chevron.down")
                            .font(.caption)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

            if hasBody, expanded || run?.isRunning == true {
                Divider()
                VStack(alignment: .leading, spacing: 8) {
                    if let imgs = run?.images, !imgs.isEmpty {
                        ForEach(imgs) { img in
                            if let ns = NSImage(data: img.data) {
                                Image(nsImage: ns)
                                    .resizable()
                                    .aspectRatio(contentMode: .fit)
                                    .frame(maxWidth: 320, maxHeight: 220)
                                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                                    .padding(.horizontal, 10)
                                    .padding(.top, 8)
                            }
                        }
                    }
                    if let output = run?.output, !output.isEmpty {
                        ScrollView {
                            Text(trimmedOutput(output))
                                .font(.caption.monospaced())
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(10)
                        }
                        .frame(maxHeight: expanded ? 400 : 120)
                    }
                }
                .background(Color.primary.opacity(0.025))
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color.primary.opacity(0.03))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(Color.primary.opacity(0.08))
        )
    }

    private var hasOutput: Bool { hasBody }

    private var hasBody: Bool {
        !(run?.output.isEmpty ?? true) || !(run?.images.isEmpty ?? true)
    }

    private var iconName: String {
        switch call.name {
        case "bash": return "terminal"
        case "read": return "doc.text"
        case "edit", "write": return "pencil"
        case "generate_image": return "wand.and.stars"
        default: return "wrench.and.screwdriver"
        }
    }

    private func trimmedOutput(_ output: String) -> String {
        if expanded { return output }
        let lines = output.split(separator: "\n", omittingEmptySubsequences: false)
        if lines.count <= 8 { return output }
        return lines.suffix(8).joined(separator: "\n")
    }
}

// MARK: - Generated video

struct VideoBlockView: View {
    let path: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if FileManager.default.fileExists(atPath: path) {
                // macOS: open with default player via link; inline AVPlayer would need AVKit.
                HStack(spacing: 10) {
                    Image(systemName: "film")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("生成的视频")
                            .font(.callout.weight(.semibold))
                        Text((path as NSString).lastPathComponent)
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer()
                    Button("打开") {
                        NSWorkspace.shared.open(URL(fileURLWithPath: path))
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
                .padding(12)
                .background(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Color.primary.opacity(0.05))
                )
            } else {
                Text("视频文件不存在：\(path)")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .frame(maxWidth: 420)
    }
}

// MarkdownTextView 现在在 MarkdownView.swift（块级渲染：标题/表格/列表/引用/代码/简图）
