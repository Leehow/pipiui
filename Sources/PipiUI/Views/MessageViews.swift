import SwiftUI
import AppKit

/// Adjacent transcript text events form one user-visible message body. Keeping them together
/// gives the AppKit markdown host one NSTextStorage, so selection can cross event boundaries.
enum MessageTextBlocks {
    static func mergeAdjacent(_ blocks: [ChatBlock]) -> [ChatBlock] {
        var merged: [ChatBlock] = []
        for block in blocks {
            guard case .text(let text) = block else {
                merged.append(block)
                continue
            }
            guard case .text(let previous)? = merged.last else {
                merged.append(block)
                continue
            }
            merged[merged.count - 1] = .text(previous + "\n\n" + text)
        }
        return merged
    }
}

/// 单条消息行。只依赖自己的 item 和相关 toolRuns/subagents（Equatable），
/// 流式更新时未变化的行不会重新计算 body。
struct MessageRow: View, Equatable {
    let item: ChatItem
    let toolRuns: [String: ToolRun]
    var subagents: [SubagentInfo] = []
    var isStreaming: Bool = false
    var projectURL: URL? = nil
    /// Bumps Equatable when chat typography changes so `.equatable()` rows re-render.
    var chatFontSize: CGFloat = ChatTypography.defaultFontSize
    var isWorking: Bool = false
    var isEditing: Bool = false
    var onFlash: ((String) -> Void)? = nil
    var onSelectAgent: ((String) -> Void)?
    var onCopy: (() -> Void)? = nil
    var onBranch: (() -> Void)? = nil
    var onBeginEdit: (() -> Void)? = nil
    var onCancelEdit: (() -> Void)? = nil
    var onCommitEdit: ((String) -> Void)? = nil
    @State private var hovered = false
    @State private var draft = ""

    static func == (lhs: MessageRow, rhs: MessageRow) -> Bool {
        lhs.item == rhs.item
            && lhs.toolRuns == rhs.toolRuns
            && lhs.subagents == rhs.subagents
            && lhs.isStreaming == rhs.isStreaming
            && lhs.projectURL == rhs.projectURL
            && lhs.chatFontSize == rhs.chatFontSize
            && lhs.isWorking == rhs.isWorking
            && lhs.isEditing == rhs.isEditing
        // Callbacks intentionally excluded.
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
                if isEditing {
                    VStack(alignment: .trailing, spacing: 8) {
                        TextEditor(text: $draft)
                            .font(.body)
                            .frame(minHeight: 60, maxHeight: 180)
                            .padding(8)
                            .background(
                                RoundedRectangle(cornerRadius: 12)
                                    .fill(Color.accentColor.opacity(0.85))
                            )
                        HStack {
                            Button("取消") { onCancelEdit?() }
                            Button("发送") {
                                guard editDraftSendable else {
                                    onFlash?("消息不能为空")
                                    return
                                }
                                onCommitEdit?(draft)
                            }
                            .disabled(!editDraftSendable)
                            .keyboardShortcut(.defaultAction)
                        }
                    }
                    .onAppear {
                        draft = MessageActions.copyableText(from: item)
                    }
                    .onExitCommand {
                        onCancelEdit?()
                    }
                } else {
                    // ScrollView + row each use `.transcriptFlip()` → flips cancel, so
                    // layout order == visual order. Bar after bubble = under the message.
                    userBubble
                    MessageActionSlot(hovered: hovered, alignment: .trailing) {
                        MessageActionBar(
                            alignment: .trailing,
                            showEdit: MessageActions.showsMutatingActions(
                                role: item.role,
                                entryId: item.entryId,
                                displayText: userDisplayText,
                                isWorking: isWorking
                            ) && MessageActions.canEditUserMessage(item),
                            onCopy: { onCopy?() },
                            onEdit: { onBeginEdit?() }
                        )
                    }
                }
            }
            .contentShape(Rectangle())
        }
        .contentShape(Rectangle())
        .onHover { hovered = $0 }
    }


    @ViewBuilder
    private var userBubble: some View {
        if userDisplayText.hasPrefix("[subagent-done]") {
            // System signal from background worker — collapse by default (avoid PathLinkedText on ~8k Result).
            VStack(alignment: .trailing, spacing: 8) {
                userImageThumbnails
                SubagentDoneBubbleView(text: userDisplayText, onFlash: onFlash)
            }
        } else if userDisplayText.hasPrefix("[worktree-merge-failed]") {
            VStack(alignment: .trailing, spacing: 8) {
                userImageThumbnails
                WorktreeMergeFailedBubbleView(text: userDisplayText, onFlash: onFlash)
            }
        } else {
            VStack(alignment: .trailing, spacing: 8) {
                userImageThumbnails
                if !userDisplayText.isEmpty {
                    PathLinkedText(
                        text: userDisplayText,
                        base: {
                            var c = AttributeContainer()
                            c.foregroundColor = Color.white
                            return c
                        }(),
                        linkColor: .white,
                        onFlash: onFlash
                    )
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color.accentColor.opacity(0.88))
            )
        }
    }

    @ViewBuilder
    private var userImageThumbnails: some View {
        ForEach(Array(imageBlocks.enumerated()), id: \.element.id) { index, img in
            ImageThumbnailView(
                data: img.data,
                mimeType: img.mimeType,
                path: img.path,
                maxWidth: 280,
                maxHeight: 200,
                projectURL: projectURL,
                footnotePaths: footnotePaths,
                imageIndex: index,
                onFlash: onFlash
            )
        }
    }

    private var systemView: some View {
        PathLinkedText(
            text: plainText,
            base: {
                var c = AttributeContainer()
                c.foregroundColor = Color.secondary
                return c
            }(),
            monospaced: true,
            onFlash: onFlash
        )
        .font(.caption.monospaced())
        .foregroundStyle(.secondary)
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.primary.opacity(0.04))
        )
    }

    private var assistantView: some View {
        AssistantSegmentsView(
            segments: AssistantBlockLayout.plan(
                blocks: item.blocks,
                groupFinished: !isStreaming,
                toolRuns: toolRuns
            ),
            toolRuns: toolRuns,
            subagents: subagents,
            isStreaming: isStreaming,
            projectURL: projectURL,
            onFlash: onFlash,
            onSelectAgent: onSelectAgent,
            entryId: item.entryId,
            isWorking: isWorking,
            onCopy: onCopy,
            onBranch: onBranch
        )
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

    /// Footnote paths from the full (unstripped) user message for image path resolution.
    private var footnotePaths: [String] {
        ImagePathResolver.attachmentPaths(fromMessageText: plainText)
    }

    private var imageBlocks: [ImageBlock] {
        item.blocks.compactMap { block -> ImageBlock? in
            if case .image(let img) = block { return img }
            return nil
        }
    }

    private var editDraftSendable: Bool {
        MessageActions.isEditDraftSendable(draft)
    }
}

/// Renders planned assistant segments (single message or coalesced tool-round run).
struct AssistantSegmentsView: View, Equatable {
    let segments: [AssistantBlockLayout.Segment]
    let toolRuns: [String: ToolRun]
    var subagents: [SubagentInfo] = []
    var isStreaming: Bool = false
    var projectURL: URL? = nil
    var onFlash: ((String) -> Void)? = nil
    var onSelectAgent: ((String) -> Void)?
    var entryId: String? = nil
    var isWorking: Bool = false
    var onCopy: (() -> Void)? = nil
    var onBranch: (() -> Void)? = nil
    @State private var hovered = false

    static func == (lhs: AssistantSegmentsView, rhs: AssistantSegmentsView) -> Bool {
        lhs.segments == rhs.segments
            && lhs.toolRuns == rhs.toolRuns
            && lhs.subagents == rhs.subagents
            && lhs.isStreaming == rhs.isStreaming
            && lhs.projectURL == rhs.projectURL
            && lhs.entryId == rhs.entryId
            && lhs.isWorking == rhs.isWorking
        // Callbacks intentionally excluded.
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array(segments.enumerated()), id: \.offset) { _, segment in
                    switch segment {
                    case .text(let text):
                        MarkdownTextView(text: text, onFlash: onFlash)
                    case .image(let img):
                        ImageThumbnailView(
                            data: img.data,
                            mimeType: img.mimeType,
                            path: img.path,
                            maxWidth: 360,
                            maxHeight: 240,
                            projectURL: projectURL,
                            onFlash: onFlash
                        )
                    case .video(let vid):
                        VideoBlockView(path: vid.path, onFlash: onFlash)
                    case .singleton(let block):
                        assistantBlockView(block)
                    case .finishedGroup(let blocks):
                        FinishedNonTextGroupView(
                            blocks: blocks,
                            toolRuns: toolRuns,
                            subagents: subagents,
                            projectURL: projectURL,
                            onFlash: onFlash,
                            onSelectAgent: onSelectAgent
                        )
                    }
                }
            }
            // ScrollView + row flips cancel → layout order == visual order.
            MessageActionSlot(hovered: hovered, alignment: .leading) {
                MessageActionBar(
                    alignment: .leading,
                    showBranch: MessageActions.showsMutatingActions(
                        role: "assistant",
                        entryId: entryId,
                        displayText: MessageActions.copyableText(from: segments),
                        isWorking: isWorking
                    ),
                    onCopy: { onCopy?() },
                    onBranch: { onBranch?() }
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .onHover { hovered = $0 }
    }

    @ViewBuilder
    private func assistantBlockView(_ block: ChatBlock) -> some View {
        switch block {
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
                ToolCardView(
                    call: call,
                    run: toolRuns[call.id],
                    isStreaming: isStreaming,
                    projectURL: projectURL,
                    onFlash: onFlash
                )
            }
        case .text, .image, .video:
            EmptyView()
        }
    }

    private func agentsFor(_ call: ToolCallBlock) -> [SubagentInfo] {
        let roots = subagents.filter { $0.toolCallId == call.id }
        guard !roots.isEmpty else { return [] }
        let rootIds = Set(roots.map(\.id))
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
                        Text(SubagentToolCardStatus.line(for: agent))
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
                    .pointingHandCursor(onSelect != nil)
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
}

/// Status subtitle for the main-chat subagent tool card (testable; never shows activity JSON).
enum SubagentToolCardStatus {
    static func line(for agent: SubagentInfo) -> String {
        switch agent.state {
        case .running:
            let title = agent.listSubtitle.trimmingCharacters(in: .whitespacesAndNewlines)
            return title.isEmpty ? "思考中…" : title
        case .ok:
            return "完成 · \(agent.turns) turns · " + String(format: "$%.3f", agent.cost)
        case .failed:
            return "失败 · " + String(agent.listSubtitle.prefix(60))
        case .aborted:
            return "已中止"
        case .interrupted:
            return "已中断（App 重启）"
        }
    }
}

/// chars÷4 estimate for Thinking / write·edit headers (not a real tokenizer).
enum ThinkingTokenEstimate {
    static func tokenCount(charCount: Int) -> Int {
        guard charCount > 0 else { return 0 }
        return max(1, Int((Double(charCount) / 4.0).rounded()))
    }

    static func tokenCount(for text: String) -> Int {
        tokenCount(charCount: text.count)
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
    static func labelSuffix(charCount: Int) -> String? {
        let n = tokenCount(charCount: charCount)
        guard n > 0 else { return nil }
        return "~\(formatCount(n)) tokens"
    }

    static func labelSuffix(for text: String) -> String? {
        labelSuffix(charCount: text.count)
    }
}

// MARK: - [subagent-done] user message (collapsed by default)

/// Parsed shape of a background worker completion message injected via `pi.sendUserMessage`.
struct SubagentDoneMessage: Equatable {
    enum Outcome: Equatable {
        case ok, fail, aborted
    }

    let headerLine: String
    let agentId: String?
    let name: String
    let ok: Bool
    let aborted: Bool
    let cost: String?
    let turns: String?
    let task: String
    let result: String

    var outcome: Outcome {
        if aborted { return .aborted }
        if ok { return .ok }
        return .fail
    }

    /// Returns nil when text does not start with `[subagent-done]`.
    static func parse(_ text: String) -> SubagentDoneMessage? {
        guard text.hasPrefix("[subagent-done]") else { return nil }

        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n")
        let lines = normalized.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        guard let headerLine = lines.first else { return nil }

        var fields: [String: String] = [:]
        let afterPrefix = headerLine.dropFirst("[subagent-done]".count)
            .trimmingCharacters(in: .whitespaces)
        for token in afterPrefix.split(separator: " ", omittingEmptySubsequences: true) {
            guard let eq = token.firstIndex(of: "=") else { continue }
            let key = String(token[..<eq])
            let value = String(token[token.index(after: eq)...])
            if !key.isEmpty { fields[key] = value }
        }

        let ok = (fields["ok"] ?? "").lowercased() == "true"
        let aborted = (fields["aborted"] ?? "").lowercased() == "true"
        let name = fields["name"].flatMap { $0.isEmpty ? nil : $0 } ?? "agent"

        var task = ""
        var result = ""
        var i = 1
        while i < lines.count && lines[i].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            i += 1
        }
        if i < lines.count {
            let line = lines[i]
            if line.hasPrefix("Task:") {
                task = String(line.dropFirst("Task:".count)).trimmingCharacters(in: .whitespaces)
                i += 1
            }
        }
        while i < lines.count && lines[i].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            i += 1
        }
        if i < lines.count {
            let line = lines[i]
            if line.hasPrefix("Result:") {
                let inline = String(line.dropFirst("Result:".count)).trimmingCharacters(in: .whitespaces)
                i += 1
                let rest = i < lines.count ? lines[i...].joined(separator: "\n") : ""
                if inline.isEmpty {
                    result = rest
                } else if rest.isEmpty {
                    result = inline
                } else {
                    result = inline + "\n" + rest
                }
            }
        }

        return SubagentDoneMessage(
            headerLine: headerLine,
            agentId: fields["agentId"],
            name: name,
            ok: ok,
            aborted: aborted,
            cost: fields["cost"],
            turns: fields["turns"],
            task: task,
            result: result
        )
    }
}

/// Collapsed card for `[subagent-done]` — avoids rendering full Result until expanded.
struct SubagentDoneBubbleView: View {
    let text: String
    var onFlash: ((String) -> Void)? = nil
    @State private var expanded = false

    private var parsed: SubagentDoneMessage? { SubagentDoneMessage.parse(text) }

    private var outcomeIcon: String {
        switch parsed?.outcome {
        case .ok: return "checkmark.circle.fill"
        case .fail: return "xmark.circle.fill"
        case .aborted: return "stop.circle.fill"
        case nil: return "checkmark.seal"
        }
    }

    private var outcomeColor: Color {
        switch parsed?.outcome {
        case .ok: return .green
        case .fail: return .red
        case .aborted: return .orange
        case nil: return .secondary
        }
    }

    private var outcomeLabel: String {
        switch parsed?.outcome {
        case .ok: return "ok"
        case .fail: return "fail"
        case .aborted: return "aborted"
        case nil: return ""
        }
    }

    private var summaryTitle: String {
        guard let parsed else { return "子任务完成" }
        var parts = ["子任务完成", parsed.name, outcomeLabel]
        if let cost = parsed.cost, !cost.isEmpty {
            parts.append("cost \(cost)")
        }
        return parts.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Image(systemName: outcomeIcon)
                    .foregroundStyle(outcomeColor)
                    .imageScale(.medium)
                Text(summaryTitle)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 0)
                Image(systemName: expanded ? "chevron.down" : "chevron.right")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .contentShape(Rectangle())
            .onTapGesture { expanded.toggle() }
            .pointingHandCursor()
            .accessibilityAddTraits(.isButton)
            .accessibilityValue(expanded ? "已展开" : "已折叠")

            if expanded {
            VStack(alignment: .leading, spacing: 8) {
                if let parsed {
                    if !parsed.task.isEmpty {
                        Text("Task: \(parsed.task)")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    let bodyText = parsed.result.isEmpty ? text : parsed.result
                    PathLinkedText(
                        text: bodyText,
                        base: {
                            var c = AttributeContainer()
                            c.foregroundColor = Color.primary.opacity(0.85)
                            return c
                        }(),
                        monospaced: true,
                        onFlash: onFlash
                    )
                    .font(.caption.monospaced())
                } else {
                    Text(text)
                        .font(.caption.monospaced())
                        .foregroundStyle(.primary.opacity(0.85))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(.top, 6)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: 420, alignment: .trailing)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.primary.opacity(0.06))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
                )
        )
        .accessibilityLabel(summaryTitle)
    }
}

/// Collapsed card for `[worktree-merge-failed]` — merge error + self-handle hint.
struct WorktreeMergeFailedBubbleView: View {
    let text: String
    var onFlash: ((String) -> Void)? = nil
    @State private var expanded = false

    private var parsed: (headerLine: String, agentId: String?, name: String?, error: String)? {
        WorktreeMergeFailedMessage.parse(text)
    }

    private var summaryTitle: String {
        guard let parsed else { return "Worktree 合并失败" }
        let name = parsed.name ?? "agent"
        return "Worktree 合并失败 · \(name)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                    .imageScale(.medium)
                Text(summaryTitle)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 0)
                Image(systemName: expanded ? "chevron.down" : "chevron.right")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .contentShape(Rectangle())
            .onTapGesture { expanded.toggle() }
            .pointingHandCursor()
            .accessibilityAddTraits(.isButton)

            if expanded {
                PathLinkedText(
                    text: text,
                    base: {
                        var c = AttributeContainer()
                        c.foregroundColor = Color.primary.opacity(0.85)
                        return c
                    }(),
                    monospaced: true,
                    onFlash: onFlash
                )
                .font(.caption.monospaced())
                .padding(.top, 6)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: 420, alignment: .trailing)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.orange.opacity(0.08))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(Color.orange.opacity(0.2), lineWidth: 1)
                )
        )
        .accessibilityLabel(summaryTitle)
    }
}

// MARK: - Thinking block

/// Per-render budget for one thinking chunk: keep each `Text(chunk)` layout job
/// small enough that SwiftUI/CoreText lays it out in a frame or two, while never
/// splitting a line mid-grapheme. Oversized single lines fall through as their
/// own chunk (we don't break words).
enum ThinkingChunkBudget {
    static let maxChars = 4000
    static let maxLines = 80
    /// Tail-window size for streaming-expanded mode (B).
    static let streamingTailChars = 1200
}

/// Cached split of a thinking blob into layout-friendly chunks. Session history
/// is immutable, so a warm re-build reuses the same split instead of rescanning.
/// Mirrors `MarkdownTextView.parseCache`'s NSCache-by-raw-string approach.
enum ThinkingChunkCache {
    private static let cache: NSCache<NSString, NSObject> = {
        let c = NSCache<NSString, NSObject>()
        c.countLimit = 200
        return c
    }()

    /// Splits `text` into chunks of at most ~`maxChars`/`maxLines`, breaking only
    /// at newlines. Result is cached by full text (immutable history → safe key).
    /// `MessageRow.equatable()` skips unchanged rows' bodies, and the cache turns
    /// repeats into O(1), so we always run `splitLines` — a single linear pass that
    /// also honours the line budget (char count alone can't, e.g. 85 two-char lines
    /// is 254 chars but 85 lines).
    static func chunks(for text: String) -> [String] {
        let key = text as NSString
        if let box = cache.object(forKey: key) as? Box { return box.chunks }
        let split = splitLines(text)
        cache.setObject(Box(split), forKey: key)
        return split
    }

    /// Tail window for streaming-expanded mode: the last ~`maxChars` characters,
    /// advanced to the next newline so the window starts at a line boundary (never
    /// slices a multi-byte grapheme or leaves a leading half-line). Keeps the
    /// ~50 ms streaming ChatItem rebuild re-laying out O(window), not O(n).
    static func tailWindow(of text: String, maxChars: Int = ThinkingChunkBudget.streamingTailChars) -> String {
        guard text.count > maxChars else { return text }
        let from = text.index(text.endIndex, offsetBy: -maxChars, limitedBy: text.startIndex) ?? text.startIndex
        var start = from
        if let nl = text[start...].firstIndex(of: "\n") {
            start = text.index(after: nl)
        }
        return String(text[start...])
    }

    private static func splitLines(_ text: String) -> [String] {
        var out: [String] = []
        var slice = Substring()
        var chars = 0
        var lines = 0
        for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let n = line.count
            // Push the current slice before adding a line that would overflow.
            if !slice.isEmpty,
               chars + n + 1 > ThinkingChunkBudget.maxChars
                || lines + 1 > ThinkingChunkBudget.maxLines {
                out.append(String(slice))
                slice = Substring()
                chars = 0
                lines = 0
            }
            // A single line longer than the budget can't break at a newline, so
            // hard-slice it on Character boundaries into budget-sized chunks.
            // (Without this, one very long line would become one giant Text —
            // exactly the lag we're fixing.) Linear: one forward grapheme walk
            // with a running count; never recomputes `.count` of the remainder
            // (the index(offsetBy:)/distance form was O(n²) on a 12 MB line).
            if slice.isEmpty, n > ThinkingChunkBudget.maxChars {
                let budget = ThinkingChunkBudget.maxChars
                var lo = line.startIndex
                var count = 0
                var hi = lo
                while hi < line.endIndex {
                    line.formIndex(after: &hi)
                    count += 1
                    if count >= budget {
                        out.append(String(line[lo..<hi]))
                        lo = hi
                        count = 0
                    }
                }
                if lo < line.endIndex { out.append(String(line[lo..<hi])) }
                slice = Substring()
                chars = 0
                lines = 0
                continue
            }
            if slice.isEmpty {
                slice = line
                chars = n
            } else {
                slice += "\n"
                slice += line
                chars += 1 + n
            }
            lines += 1
        }
        if !slice.isEmpty { out.append(String(slice)) }
        return out
    }

    private final class Box: NSObject {
        let chunks: [String]
        init(_ chunks: [String]) { self.chunks = chunks }
    }
}

/// Renders an AI reasoning ("thinking") block. Three layered mitigations against
/// the lag of laying out a multi-thousand-char blob as one `Text`:
/// - **A height cap**: content sits in a bounded `ScrollView` (mirrors
///   `ToolCardView`'s `.frame(maxHeight:)` idiom), so the transcript never hosts
///   a full-document-height block.
/// - **B streaming tail window**: while `isStreaming && expanded`, only the last
///   ~1200 chars are rendered, so the ~50 ms streaming `ChatItem` rebuild only
///   re-lays-out the window, not the whole growing blob.
/// - **C chunked LazyVStack**: in the steady state, cached chunks render in a
///   `LazyVStack` so CoreText only lays out visible chunks.
struct ThinkingBlockView: View {
    let text: String
    var isStreaming: Bool = false
    @State private var expanded = false

    private static let fullMaxHeight: CGFloat = 480
    private static let streamingMaxHeight: CGFloat = 240

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
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
                Spacer(minLength: 0)
                Image(systemName: expanded ? "chevron.down" : "chevron.right")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .contentShape(Rectangle())
            .onTapGesture { expanded.toggle() }
            .pointingHandCursor()
            .accessibilityAddTraits(.isButton)
            .accessibilityValue(expanded ? "已展开" : "已折叠")

            if expanded {
            content
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 4)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color.primary.opacity(0.035))
        )
    }

    @ViewBuilder
    private var content: some View {
        if isStreaming, expanded {
            // B: tail window keeps the streaming re-layout O(window).
            ScrollView {
                VStack(alignment: .leading, spacing: 6) {
                    Text(ThinkingChunkCache.tailWindow(of: text))
                        .font(.callout)
                        .italic()
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text("正在思考… 已写 \(ThinkingTokenEstimate.formatCount(ThinkingTokenEstimate.tokenCount(for: text))) tokens")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.tertiary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .frame(maxHeight: Self.streamingMaxHeight)
        } else {
            // A + C: bounded scroll view of cached chunks, lazily realized.
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(ThinkingChunkCache.chunks(for: text).enumerated()), id: \.offset) { _, chunk in
                        Text(chunk)
                            .font(.callout)
                            .italic()
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .frame(maxHeight: Self.fullMaxHeight)
        }
    }
}

/// Collapsed summary for consecutive finished thinking/toolCall rows between text/media.
struct FinishedNonTextGroupView: View {
    let blocks: [ChatBlock]
    let toolRuns: [String: ToolRun]
    var subagents: [SubagentInfo] = []
    var projectURL: URL? = nil
    var onFlash: ((String) -> Void)? = nil
    var onSelectAgent: ((String) -> Void)?
    @State private var expanded = false

    private var title: String {
        AssistantBlockLayout.summaryTitle(for: blocks)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Image(systemName: "rectangle.stack")
                    .foregroundStyle(.secondary)
                    .imageScale(.medium)
                Text(title)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 0)
                Image(systemName: expanded ? "chevron.down" : "chevron.right")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .contentShape(Rectangle())
            .onTapGesture { expanded.toggle() }
            .pointingHandCursor()
            .accessibilityAddTraits(.isButton)
            .accessibilityLabel(title)
            .accessibilityValue(expanded ? "已展开" : "已折叠")

            if expanded {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                        memberView(block)
                    }
                }
                .padding(.top, 8)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color.primary.opacity(0.035))
        )
    }

    @ViewBuilder
    private func memberView(_ block: ChatBlock) -> some View {
        switch block {
        case .thinking(let text):
            ThinkingBlockView(text: text, isStreaming: false)
        case .toolCall(let call):
            if call.name == "subagent", !agentsFor(call).isEmpty {
                SubagentToolCardView(
                    call: call,
                    run: toolRuns[call.id],
                    agents: agentsFor(call),
                    onSelect: onSelectAgent
                )
            } else {
                ToolCardView(
                    call: call,
                    run: toolRuns[call.id],
                    projectURL: projectURL,
                    onFlash: onFlash
                )
            }
        case .text, .image, .video:
            EmptyView()
        }
    }

    private func agentsFor(_ call: ToolCallBlock) -> [SubagentInfo] {
        let roots = subagents.filter { $0.toolCallId == call.id }
        guard !roots.isEmpty else { return [] }
        let rootIds = Set(roots.map(\.id))
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

/// Full-pane placeholder shown while a session is still starting (pi spawning +
/// initial transcript building). Distinct from `WaitingPlaceholderView`, which is
/// an inline "AI 正在思考…" row inside an already-populated transcript.
struct SessionLoadingView: View {
    var message: String = "正在启动会话…"

    var body: some View {
        VStack(spacing: 12) {
            ProgressView()
                .controlSize(.large)
            Text(message)
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .textBackgroundColor))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(message)
    }
}

struct ToolCardView: View {
    let call: ToolCallBlock
    let run: ToolRun?
    var isStreaming: Bool = false
    var projectURL: URL? = nil
    var onFlash: ((String) -> Void)? = nil
    @State private var expanded = false

    private var statusColor: Color {
        guard let run else { return isStreaming ? .blue : .secondary }
        if run.isRunning { return .blue }
        return run.isError ? .red : .green
    }

    private var toolImages: [ImageBlock] {
        run?.images ?? []
    }

    private var isLive: Bool {
        isStreaming || run?.isRunning == true
    }

    private var showsPayloadTokens: Bool {
        call.name == "write" || call.name == "edit"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: iconName)
                    .foregroundStyle(statusColor)
                Text(call.name)
                    .font(.callout.weight(.semibold).monospaced())
                PathLinkedText(
                    text: call.argsSummary,
                    base: {
                        var c = AttributeContainer()
                        c.foregroundColor = Color.secondary
                        return c
                    }(),
                    monospaced: true,
                    lineLimit: 1,
                    truncationMode: .middle,
                    onFlash: onFlash
                )
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                if showsPayloadTokens,
                   let suffix = ThinkingTokenEstimate.labelSuffix(charCount: call.payloadChars) {
                    Text("· \(suffix)")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .layoutPriority(1)
                }
                Spacer(minLength: 0)
                if isLive {
                    ProgressView().controlSize(.mini)
                } else if run != nil {
                    Image(systemName: run!.isError ? "xmark.circle.fill" : "checkmark.circle.fill")
                        .foregroundStyle(statusColor)
                        .font(.caption)
                }
                // The complete header is the disclosure target; the chevron remains an affordance.
                if hasTextOutput {
                    Image(systemName: expanded ? "chevron.up" : "chevron.down")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .contentShape(Rectangle())
            .onTapGesture {
                if hasTextOutput { expanded.toggle() }
            }
            .pointingHandCursor(hasTextOutput)
            .accessibilityAddTraits(hasTextOutput ? .isButton : [])
            .accessibilityValue(hasTextOutput ? (expanded ? "已展开" : "已折叠") : "")

            // Always show tool result thumbnails (even when collapsed).
            if !toolImages.isEmpty {
                Divider()
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 8) {
                        ForEach(Array(toolImages.enumerated()), id: \.element.id) { index, img in
                            ImageThumbnailView(
                                data: img.data,
                                mimeType: img.mimeType,
                                path: img.path,
                                maxWidth: 200,
                                maxHeight: 140,
                                projectURL: projectURL,
                                imageIndex: index,
                                onFlash: onFlash
                            )
                        }
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                }
                .background(Color.primary.opacity(0.025))
            }

            if hasTextOutput, expanded || run?.isRunning == true {
                Divider()
                VStack(alignment: .leading, spacing: 8) {
                    if let output = run?.output, !output.isEmpty {
                        ScrollView {
                            PathLinkedText(
                                text: trimmedOutput(output),
                                monospaced: true,
                                onFlash: onFlash
                            )
                            .font(.caption.monospaced())
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
        .onAppear {
            // Auto-expand text when images arrived so any caption is visible once.
            if !toolImages.isEmpty, hasTextOutput {
                expanded = true
            }
        }
    }

    private var hasTextOutput: Bool {
        !(run?.output.isEmpty ?? true)
    }

    private var hasOutput: Bool {
        hasTextOutput || !toolImages.isEmpty
    }

    private var hasBody: Bool { hasOutput }

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
    var onFlash: ((String) -> Void)? = nil

    /// T24: `VideoBlock` / `appendMediaResult` live in ChatSession.swift, so the
    /// existence check cannot be hoisted into the model from here. Instead stat
    /// once on first appear and cache in @State — body evaluation stays stat-free.
    /// nil = not yet probed (first body pass before onAppear).
    @State private var fileExists: Bool? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if fileExists == true {
                // macOS: open with default player via link; inline AVPlayer would need AVKit.
                HStack(spacing: 10) {
                    Image(systemName: "film")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("生成的视频")
                            .font(.callout.weight(.semibold))
                        PathLinkedText(
                            text: (path as NSString).lastPathComponent,
                            monospaced: true,
                            lineLimit: 1,
                            onFlash: onFlash
                        )
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("在访达中显示") {
                        if !FileReveal.revealInFinder(path: path) {
                            onFlash?(FileReveal.missingPathMessage(path))
                        }
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    Button("打开") {
                        if !FileReveal.open(path: path) {
                            onFlash?(FileReveal.missingPathMessage(path))
                        }
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
                .padding(12)
                .background(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Color.primary.opacity(0.05))
                )
            } else if fileExists == false {
                Text("视频文件不存在：\(path)")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .frame(maxWidth: 420)
        .onAppear {
            if fileExists == nil {
                fileExists = FileManager.default.fileExists(atPath: path)
            }
        }
    }
}

// MarkdownTextView 现在在 MarkdownView.swift（块级渲染：标题/表格/列表/引用/代码/简图）
