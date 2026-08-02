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
    var sessionKey: String = ""
    var presentationScopeID: String = ""
    var isWorking: Bool = false
    var isEditing: Bool = false
    var onFlash: ((String) -> Void)? = nil
    var onSelectAgent: ((String) -> Void)?
    var onOpenFinishedGroup: ((AssistantBlockLayout.FinishedGroupPresentation) -> Void)?
    var onOpenRunningTool: ((RunningToolDetailPresentation) -> Void)?
    var onCopy: (() -> Void)? = nil
    var onResend: (() -> Void)? = nil
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
            && lhs.sessionKey == rhs.sessionKey
            && lhs.presentationScopeID == rhs.presentationScopeID
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
                            showEdit: showsMutatingActions,
                            showResend: showsMutatingActions,
                            onCopy: { onCopy?() },
                            onResend: { onResend?() },
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
                SubagentDoneBubbleView(
                    text: userDisplayText,
                    base: subagentDoneDocumentBase,
                    onFlash: onFlash
                )
            }
        } else if SubagentHeartbeatMessage.parse(userDisplayText) != nil {
            VStack(alignment: .trailing, spacing: 8) {
                userImageThumbnails
                SubagentHeartbeatBubbleView(text: userDisplayText, onFlash: onFlash)
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
                    CollapsibleUserBubbleView(text: userDisplayText, onFlash: onFlash)
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
            sessionKey: sessionKey,
            presentationScopeID: presentationScopeID,
            onOpenFinishedGroup: onOpenFinishedGroup,
            onOpenRunningTool: onOpenRunningTool,
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

    /// 撤回修改 / 重发按钮可见性：user 消息、空闲时显示（带图消息同样可撤回 / 重发）。
    /// `isLocalOnly` 气泡（图片/视频生成提示词）不对应 pi 会话树 entry，无法 fork，故不显示。
    private var showsMutatingActions: Bool {
        !item.isLocalOnly && MessageActions.showsMutatingActions(
            role: item.role,
            entryId: item.entryId,
            displayText: userDisplayText,
            isWorking: isWorking
        )
    }

    /// User bubble text without attachment path footnotes (still sent to the model).
    private var userDisplayText: String {
        ImageAttachment.stripAttachmentPathsForDisplay(plainText)
    }

    private var subagentDoneDocumentBase: URL? {
        guard let agentId = SubagentDoneMessage.parse(userDisplayText)?.agentId else {
            return projectURL?.standardizedFileURL
        }
        let worktreePath = subagents.first(where: { $0.id == agentId })?.worktreePath
        return DocumentReferenceScanner.effectiveBase(
            worktreePath: worktreePath,
            projectURL: projectURL
        )
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
    var sessionKey: String = ""
    var presentationScopeID: String = ""
    var onOpenFinishedGroup: ((AssistantBlockLayout.FinishedGroupPresentation) -> Void)?
    var onOpenRunningTool: ((RunningToolDetailPresentation) -> Void)?
    var entryId: String? = nil
    var isWorking: Bool = false
    var completionText: String? = nil
    var onCopy: (() -> Void)? = nil
    var onBranch: (() -> Void)? = nil
    var onJump: (() -> Void)? = nil
    /// A parent transcript turn may own this state so worker signals do not split one fold.
    var collapsedOverride: Bool? = nil
    var onCollapseToggle: (() -> Void)? = nil
    @State private var hovered = false
    @State private var locallyCollapsed = false

    private var collapsed: Bool { collapsedOverride ?? locallyCollapsed }

    static func == (lhs: AssistantSegmentsView, rhs: AssistantSegmentsView) -> Bool {
        lhs.segments == rhs.segments
            && lhs.toolRuns == rhs.toolRuns
            && lhs.subagents == rhs.subagents
            && lhs.isStreaming == rhs.isStreaming
            && lhs.projectURL == rhs.projectURL
            && lhs.sessionKey == rhs.sessionKey
            && lhs.presentationScopeID == rhs.presentationScopeID
            && lhs.entryId == rhs.entryId
            && lhs.isWorking == rhs.isWorking
            && lhs.completionText == rhs.completionText
            && lhs.collapsedOverride == rhs.collapsedOverride
        // Callbacks intentionally excluded.
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // 折叠态：流式中强制展开（保持正文可见）；否则用一行摘要替换正文 VStack。
            if collapsed && !isStreaming {
                collapsedSummaryView
            } else {
                segmentsBody
            }
            // 操作栏始终保留（折叠/展开按钮始终可达）。
            MessageActionSlot(hovered: hovered, alignment: .leading) {
                MessageActionBar(
                    alignment: .leading,
                    showBranch: showsMutatingActions,
                    onCopy: { onCopy?() },
                    onBranch: { onBranch?() },
                    collapsed: collapsed,
                    onToggleCollapse: showsCollapseAction ? { toggleCollapse() } : nil,
                    onJump: onJump
                )
            }
            if let completionText {
                Text(completionText)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .onHover { hovered = $0 }
    }

    @ViewBuilder
    private var segmentsBody: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(segments.enumerated()), id: \.offset) { index, segment in
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
                        presentation: AssistantBlockLayout.finishedGroupPresentation(
                            sessionKey: sessionKey,
                            scopeID: presentationScopeID,
                            segmentIndex: index,
                            blocks: blocks
                        ),
                        toolRuns: toolRuns,
                        projectURL: projectURL,
                        onOpen: onOpenFinishedGroup
                    )
                }
            }
            if !documentCards.isEmpty {
                DocumentFileCardStack(references: documentCards)
            }
        }
    }

    /// Pure candidate scan. Disk existence and summary reads are deferred to the card stack's
    /// off-main store so SwiftUI body evaluation performs no filesystem IO.
    private var documentCards: [DocumentReference] {
        let text = segments.compactMap { segment -> String? in
            guard case .text(let text) = segment else { return nil }
            return text
        }.joined(separator: "\n")
        return DocumentReferenceScanner.references(in: text, base: projectURL)
    }

    /// 助手消息空闲时的操作可见性（复制/分支/折叠/跳转共用此门）。
    private var showsMutatingActions: Bool {
        MessageActions.showsMutatingActions(
            role: "assistant",
            entryId: entryId,
            displayText: MessageActions.copyableText(from: segments),
            isWorking: isWorking
        )
    }

    /// 折叠按钮可见性：空闲（showsMutatingActions）且非流式。
    private var showsCollapseAction: Bool {
        showsMutatingActions && !isStreaming
    }

    /// 折叠摘要：首个文本段第一行（≤80 字符，超出截断加「…」）；无文本段返回空串。
    private var collapsedSummaryText: String {
        for segment in segments {
            if case .text(let text) = segment {
                let firstLine = text.split(separator: "\n", omittingEmptySubsequences: false)
                    .first
                    .map(String.init) ?? ""
                let trimmed = firstLine.trimmingCharacters(in: .whitespaces)
                let limit = 80
                if trimmed.count <= limit { return trimmed }
                return String(trimmed.prefix(limit)) + "…"
            }
        }
        return ""
    }

    @ViewBuilder
    private var collapsedSummaryView: some View {
        HStack(spacing: 4) {
            Text("（已折叠）")
            Text(collapsedSummaryText.isEmpty ? "AI 消息" : collapsedSummaryText)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .font(.callout)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .onTapGesture { toggleCollapse() }
        .pointingHandCursor()
    }

    /// 折叠/展开切换：禁用大段正文进出动画，避免卡顿（参考 CollapsibleUserBubbleView.collapse）。
    private func toggleCollapse() {
        if let onCollapseToggle {
            onCollapseToggle()
            return
        }
        var t = Transaction()
        t.disablesAnimations = true
        withTransaction(t) {
            locallyCollapsed.toggle()
        }
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
                    onFlash: onFlash,
                    onOpenDetail: onOpenRunningTool.map { open in
                        { open(RunningToolDetailPresentation(call: call)) }
                    }
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

/// One document reference rendered as a whole-card open target.
private struct DocumentFileCardView: View {
    let reference: DocumentReference
    @ObservedObject var store: DocumentSummaryStore
    @Environment(\.openDocument) private var openDocument

    private var entry: DocumentSummaryStore.Entry {
        store.entry(for: reference.id)
    }

    var body: some View {
        Button {
            openDocument?(reference.url)
        } label: {
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 7) {
                    Image(systemName: reference.url.pathExtension.lowercased() == "pdf"
                        ? "doc"
                        : "doc.text")
                        .foregroundStyle(.secondary)
                    Text(reference.title)
                        .font(.callout.weight(.semibold))
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Spacer(minLength: 0)
                    Image(systemName: "arrow.up.forward.app")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }

                Text(reference.url.path)
                    .font(.caption2.monospaced())
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
                    .truncationMode(.middle)

                summaryBody
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(6)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(Color.primary.opacity(0.035))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .strokeBorder(Color.primary.opacity(0.09))
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .pointingHandCursor(openDocument != nil)
        .accessibilityLabel("打开文档 \(reference.title)")
        .accessibilityValue(reference.url.path)
    }

    @ViewBuilder
    private var summaryBody: some View {
        switch entry.state {
        case .loading:
            HStack(spacing: 6) {
                ProgressView().controlSize(.mini)
                Text("读取中…")
            }
        case .loaded(let summary):
            Text(summary.text.isEmpty ? "空文档" : summary.text)
        case .missing:
            Text("文件不存在")
                .foregroundStyle(.red)
        case .tooLarge(let size):
            Text("文件过大（\(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file))）")
        case .unreadable:
            Text("无法读取（权限?）")
                .foregroundStyle(.red)
        }
    }
}

/// Sibling card stack shown below transcript text.
///
/// The stack itself prefetches every candidate before filtering visible cards. That is
/// essential for speculative relative references: they begin hidden while `.loading`, then
/// become visible when the off-main request confirms a present file.
@MainActor
package struct DocumentFileCardStack: View {
    package let references: [DocumentReference]
    @ObservedObject private var store: DocumentSummaryStore

    package init(references: [DocumentReference]) {
        self.references = references
        self.store = .shared
    }

    package init(
        references: [DocumentReference],
        summaryStore: DocumentSummaryStore
    ) {
        self.references = references
        self.store = summaryStore
    }

    package var body: some View {
        let visible = Self.visibleCards(references) { store.entry(for: $0) }
        VStack(alignment: .leading, spacing: 6) {
            ForEach(visible) { reference in
                DocumentFileCardView(reference: reference, store: store)
            }
        }
        .onAppear(perform: prefetchAll)
        .onChange(of: references) { _, _ in prefetchAll() }
    }

    /// Pure visibility policy used by unit tests and body rendering.
    package static func visibleCards(
        _ candidates: [DocumentReference],
        entry: (String) -> DocumentSummaryStore.Entry
    ) -> [DocumentReference] {
        var seen: Set<String> = []
        return candidates.filter { reference in
            guard seen.insert(reference.id).inserted else { return false }
            switch reference.origin {
            case .absolute, .fileURL, .tilde:
                return true
            case .relativeResolved, .uiFallback:
                switch entry(reference.id).state {
                case .loaded, .tooLarge, .unreadable:
                    return true
                case .loading, .missing:
                    return false
                }
            }
        }
    }

    /// Visits every unique candidate before visibility filtering, including speculative
    /// references whose initial `.loading` state keeps their card hidden.
    package static func prefetchCandidates(
        _ candidates: [DocumentReference],
        request: (URL, DocumentKind) -> Void
    ) {
        var seen: Set<String> = []
        for reference in candidates {
            guard seen.insert(reference.id).inserted,
                  let kind = DocumentDetector.kind(for: reference.url)
            else { continue }
            request(reference.url, kind)
        }
    }

    private func prefetchAll() {
        Self.prefetchCandidates(references) { url, kind in
            store.request(for: url, kind: kind)
        }
    }
}

/// 主界面里的 subagent 工具卡片：每个被派出的 agent 一行实时状态。
struct SubagentToolCardView: View {
    let call: ToolCallBlock
    let run: ToolRun?
    let agents: [SubagentInfo]
    var onSelect: ((String) -> Void)?

    var body: some View {
        let presentation = SubagentPresentationScale.cardPresentation(for: agents)
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "person.2")
                    .foregroundStyle(presentation.runningCount > 0 ? Color.blue : Color.green)
                Text("subagent")
                    .font(.callout.weight(.semibold).monospaced())
                Text("共 \(presentation.totalCount) · 运行 \(presentation.runningCount) · 失败 \(presentation.failedCount)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                if presentation.totalCost > 0 {
                    Text(String(format: "$%.3f", presentation.totalCost))
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.tertiary)
                }
                if presentation.runningCount > 0 {
                    ProgressView().controlSize(.mini)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

            Divider()

            VStack(alignment: .leading, spacing: 0) {
                ForEach(presentation.visibleAgents) { agent in
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
                            .foregroundStyle(.primary)
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

                if presentation.hiddenCount > 0 {
                    if let onSelect, let selectionID = presentation.panelSelectionID {
                        Button {
                            onSelect(selectionID)
                        } label: {
                            hiddenAgentsLabel(presentation)
                        }
                        .buttonStyle(.plain)
                        .pointingHandCursor()
                        .accessibilityLabel("打开 Subagents 面板查看另外 \(presentation.hiddenCount) 个子代理")
                    } else {
                        hiddenAgentsLabel(presentation)
                    }
                }
            }
        }
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.primary.opacity(0.03)))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color.primary.opacity(0.08)))
    }

    private func hiddenAgentsLabel(_ presentation: SubagentPresentationScale.CardPresentation) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "ellipsis.circle")
            Text("当前优先显示 \(presentation.visibleAgents.count) 个，另有 \(presentation.hiddenCount) 个")
                .lineLimit(1)
            Spacer(minLength: 4)
            Text("在 Subagents 面板查看全部")
            Image(systemName: "sidebar.right")
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private func statusIcon(_ state: SubagentInfo.State) -> some View {
        switch state {
        case .running: ProgressView().controlSize(.mini).tint(.secondary)
        case .ok: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green).font(.caption)
        case .failed: Image(systemName: "xmark.circle.fill").foregroundStyle(.red).font(.caption)
        case .aborted: Image(systemName: "stop.circle.fill").foregroundStyle(.orange).font(.caption)
        case .interrupted: Image(systemName: "bolt.slash.circle.fill").foregroundStyle(.orange).font(.caption)
        }
    }
}

/// Pure, deterministic presentation policy for large subagent fan-outs.
/// It bounds mounted rows without changing execution, aggregate accounting, or access to agents.
enum SubagentPresentationScale {
    static let cardRowLimit = 12
    static let panelRowCap = 100
    private static let panelPriorityReserve = 40

    struct Summary: Equatable {
        let totalCount: Int
        let runningCount: Int
        let failedCount: Int
        let totalCost: Double

        var finishedCount: Int { totalCount - runningCount }
    }

    struct CardPresentation: Equatable {
        let summary: Summary
        let visibleAgents: [SubagentInfo]
        let hiddenCount: Int
        let panelSelectionID: String?

        var totalCount: Int { summary.totalCount }
        var runningCount: Int { summary.runningCount }
        var failedCount: Int { summary.failedCount }
        var totalCost: Double { summary.totalCost }
    }

    struct PanelWindow: Equatable {
        let agents: [SubagentInfo]
        let totalCount: Int
        let hiddenCount: Int
        let pageFromNewest: Int
        let pageCount: Int
        let listIdentity: PanelListIdentity

        var canShowNewer: Bool { pageFromNewest > 0 }
        var canShowOlder: Bool { pageFromNewest + 1 < pageCount }
    }

    struct PanelListIdentity: Equatable {
        let count: Int
        let idFingerprint: UInt64

        static let empty = PanelListIdentity(count: 0, idFingerprint: 0)
    }

    /// One pass computes exact aggregate counts/cost while retaining only bounded priority buckets.
    /// Within each bucket the newest input row wins; priority is problems, running, then other/recent.
    static func cardPresentation(
        for agents: [SubagentInfo],
        rowLimit: Int = cardRowLimit
    ) -> CardPresentation {
        let limit = max(0, rowLimit)
        var runningCount = 0
        var failedCount = 0
        var totalCost = 0.0
        var problems: [SubagentInfo] = []
        var running: [SubagentInfo] = []
        var other: [SubagentInfo] = []
        problems.reserveCapacity(limit)
        running.reserveCapacity(limit)
        other.reserveCapacity(limit)

        for agent in agents.reversed() {
            if agent.state == .running { runningCount += 1 }
            if agent.state == .failed { failedCount += 1 }
            totalCost += agent.cost

            if isProblematic(agent) {
                if problems.count < limit { problems.append(agent) }
            } else if agent.state == .running {
                if running.count < limit { running.append(agent) }
            } else if other.count < limit {
                other.append(agent)
            }
        }

        var visible: [SubagentInfo] = []
        visible.reserveCapacity(limit)
        appendPrefix(problems, to: &visible, limit: limit)
        appendPrefix(running, to: &visible, limit: limit)
        appendPrefix(other, to: &visible, limit: limit)

        let summary = Summary(
            totalCount: agents.count,
            runningCount: runningCount,
            failedCount: failedCount,
            totalCost: totalCost
        )
        return CardPresentation(
            summary: summary,
            visibleAgents: visible,
            hiddenCount: max(0, agents.count - visible.count),
            panelSelectionID: visible.first?.id ?? agents.last?.id
        )
    }

    /// Exact summary used by panel chrome, with no parallel filter/reduce passes.
    static func summary(for agents: [SubagentInfo]) -> Summary {
        var runningCount = 0
        var failedCount = 0
        var totalCost = 0.0
        for agent in agents {
            if agent.state == .running { runningCount += 1 }
            if agent.state == .failed { failedCount += 1 }
            totalCost += agent.cost
        }
        return Summary(
            totalCount: agents.count,
            runningCount: runningCount,
            failedCount: failedCount,
            totalCost: totalCost
        )
    }

    /// Keeps every page under a fixed hard cap and in original tree order. Selected and recent
    /// priority rows repeat across pages; all remaining rows are partitioned into bounded pages.
    static func panelWindow(
        for displayOrder: [SubagentInfo],
        pageFromNewest requestedPage: Int,
        selectedID: String?
    ) -> PanelWindow {
        let listIdentity = panelListIdentity(for: displayOrder)
        guard !displayOrder.isEmpty else {
            return PanelWindow(
                agents: [],
                totalCount: 0,
                hiddenCount: 0,
                pageFromNewest: 0,
                pageCount: 0,
                listIdentity: listIdentity
            )
        }

        if displayOrder.count <= panelRowCap {
            return PanelWindow(
                agents: displayOrder,
                totalCount: displayOrder.count,
                hiddenCount: 0,
                pageFromNewest: 0,
                pageCount: 1,
                listIdentity: listIdentity
            )
        }

        var mandatoryIndices: Set<Int> = []
        if let selectedID,
           let selectedIndex = displayOrder.firstIndex(where: { $0.id == selectedID }) {
            mandatoryIndices.insert(selectedIndex)
        }

        let priorityLimit = min(Self.panelPriorityReserve, panelRowCap - mandatoryIndices.count)
        let prioritized = displayOrder.indices
            .filter { isProblematic(displayOrder[$0]) || displayOrder[$0].state == .running }
            .sorted {
                let lhs = displayOrder[$0]
                let rhs = displayOrder[$1]
                if lhs.lastObservedAt != rhs.lastObservedAt {
                    return lhs.lastObservedAt > rhs.lastObservedAt
                }
                return $0 > $1
            }
            .prefix(priorityLimit)
        mandatoryIndices.formUnion(prioritized)

        let ordinaryIndices = displayOrder.indices.filter { !mandatoryIndices.contains($0) }
        let pageCapacity = max(1, panelRowCap - mandatoryIndices.count)
        let pageCount = max(1, (ordinaryIndices.count + pageCapacity - 1) / pageCapacity)
        let pageFromNewest = min(max(0, requestedPage), pageCount - 1)
        let pageEnd = ordinaryIndices.count - pageFromNewest * pageCapacity
        let pageStart = max(0, pageEnd - pageCapacity)
        let pageIndices = ordinaryIndices[pageStart..<pageEnd]

        var visibleIndices = mandatoryIndices
        visibleIndices.formUnion(pageIndices)
        let visible = visibleIndices.sorted().map { displayOrder[$0] }
        assert(visible.count <= panelRowCap)
        return PanelWindow(
            agents: visible,
            totalCount: displayOrder.count,
            hiddenCount: displayOrder.count - visible.count,
            pageFromNewest: pageFromNewest,
            pageCount: pageCount,
            listIdentity: listIdentity
        )
    }

    static func panelPageAfterListChange(
        currentPage: Int,
        previousIdentity: PanelListIdentity,
        newIdentity: PanelListIdentity
    ) -> Int {
        previousIdentity == newIdentity ? max(0, currentPage) : 0
    }

    private static func panelListIdentity(for agents: [SubagentInfo]) -> PanelListIdentity {
        guard !agents.isEmpty else { return .empty }
        // Stable FNV-1a over IDs catches replacement waves even when count/edge IDs are unchanged.
        var fingerprint: UInt64 = 14_695_981_039_346_656_037
        for agent in agents {
            for byte in agent.id.utf8 {
                fingerprint ^= UInt64(byte)
                fingerprint &*= 1_099_511_628_211
            }
            fingerprint ^= 0xff
            fingerprint &*= 1_099_511_628_211
        }
        return PanelListIdentity(count: agents.count, idFingerprint: fingerprint)
    }

    private static func isProblematic(_ agent: SubagentInfo) -> Bool {
        if agent.state == .failed || agent.state == .aborted || agent.state == .interrupted {
            return true
        }
        if agent.stalled || !(agent.worktreeError ?? "").isEmpty || (agent.verifyExit ?? 0) != 0 {
            return true
        }
        return agent.closeoutDisposition == .needsFixer || agent.closeoutDisposition == .needsUser
    }

    private static func appendPrefix(
        _ source: [SubagentInfo],
        to destination: inout [SubagentInfo],
        limit: Int
    ) {
        guard destination.count < limit else { return }
        destination.append(contentsOf: source.prefix(limit - destination.count))
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
            return "已中断（可续跑）"
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

// MARK: - Long user message (collapsed by default)

/// Preview-first user bubble: short messages render immediately; long ones lazy-load
/// full text after expand (spinner + fade-in). Expanded long text uses plain `Text`
/// (not `PathLinkedText`) so path-scan / AttributedString work stays off the hot path.
struct CollapsibleUserBubbleView: View {
    let text: String
    var onFlash: ((String) -> Void)? = nil

    @State private var expanded = false
    @State private var fullReady = false
    @State private var fullOpacity: Double = 0

    private var collapses: Bool { UserMessageCollapse.shouldCollapse(text) }
    private var previewText: String { UserMessageCollapse.preview(text) }

    private var whiteBase: AttributeContainer {
        var c = AttributeContainer()
        c.foregroundColor = Color.white
        return c
    }

    var body: some View {
        if collapses {
            collapsibleBody
        } else {
            PathLinkedText(
                text: text,
                base: whiteBase,
                linkColor: .white,
                onFlash: onFlash
            )
        }
    }

    private var collapsibleBody: some View {
        VStack(alignment: .trailing, spacing: 6) {
            // Toggle stays at the top so「收起」is reachable without scrolling a huge body.
            toggleBar

            if expanded && fullReady {
                Text(text)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .transcriptCopyMenu(text)
                    .opacity(fullOpacity)
                    .onAppear {
                        withAnimation(.easeOut(duration: 0.2)) {
                            fullOpacity = 1
                        }
                    }
                // Duplicate control under long bodies so users who scrolled down can collapse.
                toggleBar
            } else {
                Text(previewText)
                    .foregroundStyle(.white)
                    .lineLimit(UserMessageCollapse.previewMaxLines)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .transcriptCopyMenu(text)
            }
        }
    }

    private var toggleBar: some View {
        HStack(spacing: 6) {
            if expanded && !fullReady {
                ProgressView()
                    .controlSize(.mini)
                    .tint(.white)
            }
            Button {
                if expanded && fullReady {
                    collapse()
                } else if !expanded {
                    beginExpand()
                }
            } label: {
                Text(toggleLabel)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.white.opacity(0.85))
            }
            .buttonStyle(.plain)
            .disabled(expanded && !fullReady)
            .pointingHandCursor(!(expanded && !fullReady))
            .accessibilityAddTraits(.isButton)
            .accessibilityValue(accessibilityExpandValue)
        }
    }

    private var toggleLabel: String {
        if expanded && fullReady { return "收起" }
        if expanded { return "展开中…" }
        return "展开"
    }

    private var accessibilityExpandValue: String {
        if expanded && fullReady { return "已展开" }
        if expanded { return "展开中" }
        return "已折叠"
    }

    private func beginExpand() {
        expanded = true
        fullReady = false
        fullOpacity = 0
        Task { @MainActor in
            await Task.yield()
            guard expanded else { return }
            fullReady = true
        }
    }

    private func collapse() {
        // Avoid animating a huge Text out — that itself can hitch the main thread.
        var t = Transaction()
        t.disablesAnimations = true
        withTransaction(t) {
            expanded = false
            fullReady = false
            fullOpacity = 0
        }
    }
}

// MARK: - [subagent-heartbeat] user message (collapsed by default)

/// Parsed shape of the periodic background-worker heartbeat injected via `pi.sendUserMessage`.
struct SubagentHeartbeatMessage: Equatable {
    struct WorkerSummary: Equatable {
        enum Status: Equatable {
            case running, vanished
        }

        let agentId: String
        let title: String
        let status: Status
        let elapsed: String
        let idleSeconds: Int?
        let rawLine: String

        var state: Status { status }
    }

    let headerLine: String
    let outstanding: Int
    let vanished: Int
    let workers: [WorkerSummary]
    let remainingText: String
    let fullText: String

    var workerSummaries: [WorkerSummary] { workers }

    /// Returns nil for non-heartbeats or malformed headers/worker summary lines.
    static func parse(_ text: String) -> SubagentHeartbeatMessage? {
        guard text.hasPrefix("[subagent-heartbeat]") else { return nil }

        let normalized = text
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        let lines = normalized.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        guard let headerLine = lines.first else { return nil }

        let prefix = "[subagent-heartbeat]"
        guard headerLine == prefix || headerLine.hasPrefix(prefix + " ") else { return nil }
        let fieldsText = headerLine.dropFirst(prefix.count).trimmingCharacters(in: .whitespaces)
        var fields: [String: String] = [:]
        for token in fieldsText.split(separator: " ", omittingEmptySubsequences: true) {
            guard let equals = token.firstIndex(of: "=") else { return nil }
            let key = String(token[..<equals])
            let value = String(token[token.index(after: equals)...])
            guard !key.isEmpty, !value.isEmpty else { return nil }
            fields[key] = value
        }
        guard let outstandingText = fields["outstanding"],
              let outstanding = Int(outstandingText), outstanding >= 0,
              let vanishedText = fields["vanished"],
              let vanished = Int(vanishedText), vanished >= 0 else {
            return nil
        }

        var workers: [WorkerSummary] = []
        var index = 1
        while index < lines.count {
            let line = lines[index]
            guard line.hasPrefix("  "), !line.trimmingCharacters(in: .whitespaces).isEmpty else {
                break
            }
            guard let worker = parseWorkerSummary(line) else { return nil }
            workers.append(worker)
            index += 1
        }

        let remainingText = index < lines.count ? lines[index...].joined(separator: "\n") : ""
        return SubagentHeartbeatMessage(
            headerLine: headerLine,
            outstanding: outstanding,
            vanished: vanished,
            workers: workers,
            remainingText: remainingText,
            fullText: text
        )
    }

    private static func parseWorkerSummary(_ rawLine: String) -> WorkerSummary? {
        let line = rawLine.trimmingCharacters(in: .whitespaces)
        guard let titleStart = line.range(of: " ("),
              let detailStart = line.range(of: ") — ", options: .backwards),
              titleStart.upperBound <= detailStart.lowerBound else {
            return nil
        }

        let agentId = String(line[..<titleStart.lowerBound])
        let title = String(line[titleStart.upperBound..<detailStart.lowerBound])
        let detail = String(line[detailStart.upperBound...])
        guard !agentId.isEmpty,
              !agentId.contains(where: { $0.isWhitespace }),
              !title.isEmpty else {
            return nil
        }

        if detail.hasPrefix("running "),
           let idleRange = detail.range(of: ", idle ", options: .backwards) {
            let elapsed = String(detail[detail.index(detail.startIndex, offsetBy: "running ".count)..<idleRange.lowerBound])
            let idleText = String(detail[idleRange.upperBound...])
            guard !elapsed.isEmpty,
                  idleText.hasSuffix("s"),
                  let idleSeconds = Int(idleText.dropLast()),
                  idleSeconds >= 0 else {
                return nil
            }
            return WorkerSummary(
                agentId: agentId,
                title: title,
                status: .running,
                elapsed: elapsed,
                idleSeconds: idleSeconds,
                rawLine: rawLine
            )
        }

        let vanishedPrefix = "process gone after "
        let vanishedSuffix = ", no result reported"
        guard detail.hasPrefix(vanishedPrefix), detail.hasSuffix(vanishedSuffix) else { return nil }
        let elapsedStart = detail.index(detail.startIndex, offsetBy: vanishedPrefix.count)
        let elapsedEnd = detail.index(detail.endIndex, offsetBy: -vanishedSuffix.count)
        let elapsed = String(detail[elapsedStart..<elapsedEnd])
        guard !elapsed.isEmpty else { return nil }
        return WorkerSummary(
            agentId: agentId,
            title: title,
            status: .vanished,
            elapsed: elapsed,
            idleSeconds: nil,
            rawLine: rawLine
        )
    }
}

/// Compact heartbeat card. The operational guidance remains available only after expansion.
struct SubagentHeartbeatBubbleView: View {
    let text: String
    var onFlash: ((String) -> Void)? = nil
    @State private var expanded = false

    private var parsed: SubagentHeartbeatMessage? { SubagentHeartbeatMessage.parse(text) }
    private var hasVanishedWorkers: Bool { (parsed?.vanished ?? 0) > 0 }

    private var summaryTitle: String {
        guard let parsed else { return "心跳" }
        var parts = ["心跳", "运行中 \(parsed.outstanding)"]
        if parsed.vanished > 0 {
            parts.append("失联 \(parsed.vanished)")
        }
        if let worker = parsed.workers.first {
            parts.append("\(worker.agentId) \(worker.elapsed)")
        }
        return parts.joined(separator: " · ")
    }

    private var statusColor: Color {
        hasVanishedWorkers ? .orange : .secondary
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Image(systemName: "heart.fill")
                    .foregroundStyle(statusColor)
                    .imageScale(.medium)
                Text(summaryTitle)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(statusColor)
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
                .fill(hasVanishedWorkers ? Color.orange.opacity(0.08) : Color.primary.opacity(0.06))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(
                            hasVanishedWorkers ? Color.orange.opacity(0.2) : Color.primary.opacity(0.08),
                            lineWidth: 1
                        )
                )
        )
        .accessibilityLabel(summaryTitle)
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
    var base: URL? = nil
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

    private var documentCards: [DocumentReference] {
        let bodyText = parsed.map { $0.result.isEmpty ? text : $0.result } ?? text
        return DocumentReferenceScanner.references(in: bodyText, base: base)
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
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .transcriptCopyMenu(parsed.task)
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
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .transcriptCopyMenu(text)
                }
                if !documentCards.isEmpty {
                    DocumentFileCardStack(references: documentCards)
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
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .transcriptCopyMenu(text)
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
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .transcriptCopyMenu(chunk)
                    }
                }
            }
            .frame(maxHeight: Self.fullMaxHeight)
        }
    }
}

private extension View {
    /// Transcript fallback for short SwiftUI `Text` nodes. It intentionally
    /// avoids SwiftUI's selection modifier, whose macOS `SelectionOverlay` can dirty
    /// constraints while a long lazy transcript realizes many rows at once.
    func transcriptCopyMenu(_ text: String) -> some View {
        contextMenu {
            Button("复制") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(text, forType: .string)
            }
        }
    }
}

/// Collapsed summary for consecutive finished thinking/toolCall rows between text/media.
enum FileChangeDocumentTarget {
    static func url(path: String, projectURL: URL?) -> URL? {
        let expanded = (path as NSString).expandingTildeInPath
        if (expanded as NSString).isAbsolutePath {
            return URL(fileURLWithPath: expanded).standardizedFileURL
        }
        guard let projectURL else { return nil }
        return projectURL.appendingPathComponent(expanded).standardizedFileURL
    }
}

struct FinishedNonTextGroupView: View {
    let presentation: AssistantBlockLayout.FinishedGroupPresentation
    var toolRuns: [String: ToolRun] = [:]
    var projectURL: URL? = nil
    var onOpen: ((AssistantBlockLayout.FinishedGroupPresentation) -> Void)?
    @Environment(\.openDocument) private var openDocument

    private var title: String {
        AssistantBlockLayout.summaryTitle(for: presentation.blocks)
    }

    private var fileChanges: FileChangeGroupPresentation {
        FileChangeGroupPresentation.make(
            blocks: presentation.blocks,
            toolRuns: toolRuns,
            projectURL: projectURL
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            Button {
                onOpen?(presentation)
            } label: {
                HStack(spacing: 7) {
                    Image(systemName: "rectangle.stack")
                        .foregroundStyle(.secondary)
                        .imageScale(.medium)
                    Text(title)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer(minLength: 0)
                    Image(systemName: "arrow.up.right.square")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }
                .contentShape(Rectangle())
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(title)
            .accessibilityValue("打开详情")

            if !fileChanges.files.isEmpty {
                Divider()
                Button {
                    onOpen?(presentation)
                } label: {
                    HStack(spacing: 7) {
                        Image(systemName: "doc.badge.gearshape")
                            .foregroundStyle(.secondary)
                        Text("已编辑 \(fileChanges.files.count) 个文件")
                            .font(.caption.weight(.semibold))
                        compactChangeCount(fileChanges.additions, color: .green, prefix: "+")
                        compactChangeCount(fileChanges.deletions, color: .red, prefix: "−")
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(
                    "已编辑 \(fileChanges.files.count) 个文件，新增 \(fileChanges.additions) 行，删除 \(fileChanges.deletions) 行"
                )
                .accessibilityValue("打开详情")

                ForEach(fileChanges.files) { file in
                    Button {
                        guard let documentURL = FileChangeDocumentTarget.url(
                            path: file.path,
                            projectURL: projectURL
                        ) else { return }
                        openDocument?(documentURL)
                    } label: {
                        HStack(spacing: 8) {
                            Text(file.displayPath)
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                            Spacer(minLength: 8)
                            compactChangeCount(file.additions, color: .green, prefix: "+")
                            compactChangeCount(file.deletions, color: .red, prefix: "−")
                        }
                        .contentShape(Rectangle())
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(
                        "\(file.displayPath)，新增 \(file.additions) 行，删除 \(file.deletions) 行"
                    )
                    .accessibilityValue("打开文档")
                    if file.id != fileChanges.files.last?.id {
                        Divider()
                    }
                }
            }
        }
        .pointingHandCursor()
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color.primary.opacity(0.035))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(Color.primary.opacity(0.06))
        )
    }

    @ViewBuilder
    private func compactChangeCount(_ count: Int, color: Color, prefix: String) -> some View {
        if count > 0 {
            Text("\(prefix)\(count)")
                .font(.caption.monospacedDigit().weight(.medium))
                .foregroundStyle(color)
                .layoutPriority(1)
        }
    }
}

/// Stable, detached detail surface for a finished group.
///
/// This view is presented by `ChatDetailViewBody`, outside the transcript's
/// `LazyVStack`, so opening a group never changes the transcript row height.
struct FinishedNonTextGroupDetailView: View {
    let presentation: AssistantBlockLayout.FinishedGroupPresentation
    let toolRuns: [String: ToolRun]
    var subagents: [SubagentInfo] = []
    var projectURL: URL? = nil
    var onFlash: ((String) -> Void)? = nil
    var onSelectAgent: ((String) -> Void)?
    @Environment(\.dismiss) private var dismiss
    @State private var selectedFileID: String?
    @State private var selectedOperationID: String?

    private var title: String {
        AssistantBlockLayout.summaryTitle(for: presentation.blocks)
    }

    private var fileChanges: FileChangeGroupPresentation {
        FileChangeGroupPresentation.make(
            blocks: presentation.blocks,
            toolRuns: toolRuns,
            projectURL: projectURL
        )
    }

    private var selectedFile: FileChangeFilePresentation? {
        fileChanges.files.first { $0.id == selectedFileID }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                if fileChanges.files.isEmpty {
                    Label(title, systemImage: "rectangle.stack")
                        .font(.headline)
                        .lineLimit(1)
                        .truncationMode(.middle)
                } else {
                    Label("已编辑 \(fileChanges.files.count) 个文件", systemImage: "doc.badge.gearshape")
                        .font(.headline)
                    changeCount(fileChanges.additions, color: .green, prefix: "+")
                    changeCount(fileChanges.deletions, color: .red, prefix: "−")
                }
                Spacer(minLength: 16)
                Button("完成") {
                    dismiss()
                }
                .keyboardShortcut(.cancelAction)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)

            Divider()

            HStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        if !fileChanges.files.isEmpty {
                            VStack(spacing: 0) {
                                ForEach(fileChanges.files) { file in
                                    Button {
                                        selectedFileID = file.id
                                        selectedOperationID = nil
                                    } label: {
                                        HStack(spacing: 8) {
                                            Image(systemName: "doc.text")
                                                .foregroundStyle(.secondary)
                                            Text(file.displayPath)
                                                .font(.caption.monospaced())
                                                .foregroundStyle(.primary)
                                                .lineLimit(1)
                                                .truncationMode(.middle)
                                            Spacer(minLength: 8)
                                            changeCount(file.additions, color: .green, prefix: "+")
                                            changeCount(file.deletions, color: .red, prefix: "−")
                                            Image(systemName: "chevron.right")
                                                .font(.caption2)
                                                .foregroundStyle(.tertiary)
                                        }
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 9)
                                        .contentShape(Rectangle())
                                    }
                                    .buttonStyle(.plain)
                                    .background(
                                        selectedFileID == file.id
                                            ? Color.accentColor.opacity(0.1)
                                            : Color.clear
                                    )
                                    .accessibilityLabel(
                                        "\(file.displayPath)，新增 \(file.additions) 行，删除 \(file.deletions) 行"
                                    )
                                    if file.id != fileChanges.files.last?.id {
                                        Divider()
                                    }
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
                            Divider()
                                .padding(.vertical, 4)
                        }

                        ForEach(presentation.members) { member in
                            memberView(member.block)
                        }
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(minWidth: 480)

                if let selectedFile {
                    Divider()
                    FileChangeDiffInspector(
                        file: selectedFile,
                        targetOperationID: selectedOperationID
                    )
                        .id(selectedFile.id)
                        .frame(minWidth: 480, idealWidth: 560)
                }
            }
        }
        .frame(
            minWidth: selectedFile == nil ? 520 : 980,
            idealWidth: selectedFile == nil ? 680 : 1120,
            maxWidth: selectedFile == nil ? 820 : 1280,
            minHeight: 360,
            idealHeight: 560,
            maxHeight: 760
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel("工具组详情 \(title)")
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
                    onFlash: onFlash,
                    onSelectFileChange: selectionAction(for: call.id)
                )
            }
        case .text(let text):
            MarkdownTextView(text: text, onFlash: onFlash)
        case .image(let image):
            ImageThumbnailView(
                data: image.data,
                mimeType: image.mimeType,
                path: image.path,
                maxWidth: 360,
                maxHeight: 240,
                projectURL: projectURL,
                onFlash: onFlash
            )
        case .video(let video):
            VideoBlockView(path: video.path, onFlash: onFlash)
        }
    }

    @ViewBuilder
    private func changeCount(_ count: Int, color: Color, prefix: String) -> some View {
        if count > 0 {
            Text("\(prefix)\(count)")
                .font(.caption.monospacedDigit().weight(.medium))
                .foregroundStyle(color)
                .layoutPriority(1)
        }
    }

    private func selectionAction(for callID: String) -> (() -> Void)? {
        guard let file = fileChanges.file(forCallID: callID) else { return nil }
        return {
            selectedFileID = file.id
            selectedOperationID = callID
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

private struct FileChangeDiffInspector: View {
    let file: FileChangeFilePresentation
    let targetOperationID: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 5) {
                Text(file.displayPath)
                    .font(.callout.monospaced().weight(.semibold))
                    .lineLimit(2)
                    .truncationMode(.middle)
                HStack(spacing: 8) {
                    Text("+\(file.additions)")
                        .foregroundStyle(.green)
                    Text("−\(file.deletions)")
                        .foregroundStyle(.red)
                }
                .font(.caption.monospacedDigit().weight(.medium))
                if let qualityMessage = file.qualityMessage {
                    Label(qualityMessage, systemImage: "info.circle")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityLabel(qualityMessage)
                }
            }
            .padding(14)

            Divider()

            ScrollViewReader { proxy in
                ScrollView([.horizontal, .vertical]) {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        ForEach(Array(file.operations.enumerated()), id: \.element.id) { index, operation in
                            VStack(alignment: .leading, spacing: 0) {
                                HStack(spacing: 8) {
                                    Text(operationTitle(operation, at: index))
                                        .font(.caption.monospaced().weight(.semibold))
                                    Text("+\(operation.additions)")
                                        .foregroundStyle(.green)
                                    Text("−\(operation.deletions)")
                                        .foregroundStyle(.red)
                                    Spacer(minLength: 8)
                                }
                                .font(.caption.monospacedDigit().weight(.medium))
                                .padding(.horizontal, 10)
                                .padding(.vertical, 7)
                                .background(
                                    targetOperationID == operation.id
                                        ? Color.accentColor.opacity(0.14)
                                        : Color.primary.opacity(0.045)
                                )
                                .accessibilityElement(children: .combine)
                                .accessibilityLabel(
                                    "\(operationTitle(operation, at: index))，新增 \(operation.additions) 行，删除 \(operation.deletions) 行"
                                )

                                if let qualityMessage = operation.qualityMessage {
                                    Label(qualityMessage, systemImage: "info.circle")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 6)
                                        .accessibilityLabel(qualityMessage)
                                }

                                if operation.lines.isEmpty {
                                    Text("没有行级变化")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .padding(10)
                                } else {
                                    ForEach(operation.lines) { line in
                                        diffLine(line)
                                    }
                                }
                            }
                            .id(operation.id)
                            .overlay(
                                RoundedRectangle(cornerRadius: 7)
                                    .strokeBorder(
                                        targetOperationID == operation.id
                                            ? Color.accentColor.opacity(0.55)
                                            : Color.primary.opacity(0.08)
                                    )
                            )
                        }
                    }
                    .padding(12)
                    .frame(minWidth: 460, alignment: .leading)
                }
                .onAppear {
                    scrollToTarget(proxy)
                }
                .onChange(of: targetOperationID) { _, _ in
                    scrollToTarget(proxy)
                }
            }
            .textSelection(.enabled)
        }
        .background(Color(nsColor: .textBackgroundColor))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("文件差异 \(file.displayPath)")
    }

    private func operationTitle(
        _ operation: FileChangeOperationPresentation,
        at index: Int
    ) -> String {
        let matching = file.operations.filter { $0.toolName == operation.toolName }
        let ordinal = file.operations.prefix(index + 1)
            .filter { $0.toolName == operation.toolName }
            .count
        if operation.toolName == "edit" || matching.count > 1 {
            return "\(operation.toolName) \(ordinal)"
        }
        return operation.toolName
    }

    private func scrollToTarget(_ proxy: ScrollViewProxy) {
        guard let scrollID = targetOperationID ?? file.operations.first?.id else { return }
        DispatchQueue.main.async {
            withAnimation(.easeOut(duration: 0.18)) {
                proxy.scrollTo(scrollID, anchor: .top)
            }
        }
    }

    private func diffLine(_ line: FileChangeDiffLine) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            Text(line.oldLineNumber.map(String.init) ?? "")
                .frame(width: 38, alignment: .trailing)
            Text(line.newLineNumber.map(String.init) ?? "")
                .frame(width: 38, alignment: .trailing)
            Text(marker(for: line.kind))
                .frame(width: 22, alignment: .center)
            Text(line.text.isEmpty ? " " : line.text)
                .fixedSize(horizontal: true, vertical: false)
        }
        .font(.caption.monospaced())
        .foregroundStyle(foreground(for: line.kind))
        .padding(.vertical, 1)
        .padding(.trailing, 12)
        .background(background(for: line.kind))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel(for: line))
    }

    private func marker(for kind: FileChangeDiffLine.Kind) -> String {
        switch kind {
        case .addition: return "+"
        case .deletion: return "−"
        case .separator: return ""
        }
    }

    private func foreground(for kind: FileChangeDiffLine.Kind) -> Color {
        switch kind {
        case .addition: return .green
        case .deletion: return .red
        case .separator: return .secondary
        }
    }

    private func background(for kind: FileChangeDiffLine.Kind) -> Color {
        switch kind {
        case .addition: return Color.green.opacity(0.09)
        case .deletion: return Color.red.opacity(0.09)
        case .separator: return Color.secondary.opacity(0.06)
        }
    }

    private func accessibilityLabel(for line: FileChangeDiffLine) -> String {
        switch line.kind {
        case .addition: return "新增：\(line.text)"
        case .deletion: return "删除：\(line.text)"
        case .separator: return line.text
        }
    }
}

struct TurnElapsedText: View {
    let startedAt: Date

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            Text("已用时 \(TurnDurationFormat.elapsed(context.date.timeIntervalSince(startedAt)))")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

/// 用户已发送、assistant 尚无可展示 block 时的轻量等待提示。
struct WaitingPlaceholderView: View {
    let message: String
    var turnStartedAt: Date? = nil

    var body: some View {
        HStack(spacing: 8) {
            ProgressView()
                .controlSize(.small)
            Text(message)
                .font(.callout)
                .foregroundStyle(.secondary)
            if let turnStartedAt {
                TurnElapsedText(startedAt: turnStartedAt)
            }
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

struct ToolOutputRenderPreview: Equatable {
    let text: String
    let isTruncated: Bool
}

/// Hard display-only budget for tool output. `ToolRun.output` remains intact;
/// only the string handed to AppKit/SwiftUI text layout is bounded.
enum ToolOutputRenderBudget {
    static let expandedUTF16Limit = 12_000
    static let collapsedUTF16Limit = 4_000
    static let collapsedLineLimit = 8

    static func preview(
        output: String,
        expanded: Bool
    ) -> ToolOutputRenderPreview {
        guard !output.isEmpty else {
            return ToolOutputRenderPreview(text: "", isTruncated: false)
        }
        if expanded {
            return bounded(output, limit: expandedUTF16Limit, keepTail: false)
        }

        let characterBounded = bounded(
            output,
            limit: collapsedUTF16Limit,
            keepTail: true
        )
        let lines = characterBounded.text.split(
            separator: "\n",
            omittingEmptySubsequences: false
        )
        guard lines.count > collapsedLineLimit else {
            return characterBounded
        }
        let tail = lines.suffix(collapsedLineLimit).joined(separator: "\n")
        let linePreview =
            "[Earlier lines omitted in collapsed preview. "
            + "Expand for a bounded preview.]\n"
            + tail
        let finalPreview = bounded(
            linePreview,
            limit: collapsedUTF16Limit,
            keepTail: true
        )
        return ToolOutputRenderPreview(
            text: finalPreview.text,
            isTruncated: true
        )
    }

    static func shouldAutoExpand(
        toolName: String,
        hasImages: Bool,
        hasText: Bool
    ) -> Bool {
        guard hasImages, hasText else { return false }
        return toolName != "computer" && toolName != "open_application"
    }

    private static func bounded(
        _ output: String,
        limit: Int,
        keepTail: Bool
    ) -> ToolOutputRenderPreview {
        let sourceLength = output.utf16.count
        guard sourceLength > limit else {
            return ToolOutputRenderPreview(
                text: output,
                isTruncated: false
            )
        }

        // Reserve enough room for the visible truncation note so the final
        // string itself never exceeds the advertised render budget.
        let contentBudget = max(0, limit - 180)
        let retained = keepTail
            ? characterSuffix(output, utf16Limit: contentBudget)
            : characterPrefix(output, utf16Limit: contentBudget)
        let omitted = max(0, sourceLength - retained.utf16.count)
        let note =
            "[Output truncated for display: \(omitted) UTF-16 units omitted. "
            + "Full result remains in session data.]"
        let text = keepTail
            ? "\(note)\n\(retained)"
            : "\(retained)\n\(note)"
        return ToolOutputRenderPreview(text: text, isTruncated: true)
    }

    private static func characterPrefix(
        _ output: String,
        utf16Limit: Int
    ) -> String {
        var result = ""
        var used = 0
        for character in output {
            let width = String(character).utf16.count
            guard used + width <= utf16Limit else { break }
            result.append(character)
            used += width
        }
        return result
    }

    private static func characterSuffix(
        _ output: String,
        utf16Limit: Int
    ) -> String {
        var reversedCharacters: [Character] = []
        var used = 0
        for character in output.reversed() {
            let width = String(character).utf16.count
            guard used + width <= utf16Limit else { break }
            reversedCharacters.append(character)
            used += width
        }
        var result = ""
        for character in reversedCharacters.reversed() {
            result.append(character)
        }
        return result
    }
}

struct ToolCardView: View {
    let call: ToolCallBlock
    let run: ToolRun?
    var isStreaming: Bool = false
    var projectURL: URL? = nil
    var onFlash: ((String) -> Void)? = nil
    /// Present only inside the detached finished-group detail.
    var onSelectFileChange: (() -> Void)? = nil
    /// Open the live run detail sheet (main-transcript running cards).
    var onOpenDetail: (() -> Void)? = nil
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
                if run?.isRunning == true {
                    ProgressView().controlSize(.mini)
                    if onOpenDetail != nil {
                        Image(systemName: "arrow.up.right.square")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.tertiary)
                    }
                } else if isLive {
                    ProgressView().controlSize(.mini)
                } else if run != nil {
                    Image(systemName: run!.isError ? "xmark.circle.fill" : "checkmark.circle.fill")
                        .foregroundStyle(statusColor)
                        .font(.caption)
                }
                // The complete header is the disclosure target; the chevron remains an affordance.
                // Running cards keep the inline preview open and use the detail sheet instead.
                if hasTextOutput, run?.isRunning != true {
                    Image(systemName: expanded ? "chevron.up" : "chevron.down")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .contentShape(Rectangle())
            .onTapGesture {
                if run?.isRunning == true, let onOpenDetail {
                    onOpenDetail()
                } else if let onSelectFileChange {
                    onSelectFileChange()
                } else if hasTextOutput {
                    expanded.toggle()
                }
            }
            .pointingHandCursor(
                (run?.isRunning == true && onOpenDetail != nil)
                    || hasTextOutput
                    || onSelectFileChange != nil
            )
            .accessibilityAddTraits(
                (run?.isRunning == true && onOpenDetail != nil)
                    || hasTextOutput
                    || onSelectFileChange != nil
                    ? .isButton : []
            )
            .accessibilityValue(
                run?.isRunning == true && onOpenDetail != nil
                    ? "打开详情"
                    : (hasTextOutput ? (expanded ? "已展开" : "已折叠") : "")
            )

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
                    if !displayOutput.isEmpty {
                        ScrollView {
                            PathLinkedText(
                                text: ToolOutputRenderBudget.preview(
                                    output: displayOutput,
                                    expanded: expanded
                                ).text,
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

            // Finished calls show wall-clock duration; running calls keep the spinner only.
            if let duration = call.durationSeconds, !isLive {
                Divider()
                HStack(spacing: 4) {
                    Text("耗时 \(DurationFormat.compact(duration))")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
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
            if ToolOutputRenderBudget.shouldAutoExpand(
                toolName: call.name,
                hasImages: !toolImages.isEmpty,
                hasText: hasTextOutput
            ) {
                expanded = true
            }
        }
    }

    /// UI-only: hide opaque computer screenshot markers; raw ToolRun.output stays intact.
    private var displayOutput: String {
        ComputerScreenshotMarker.displayText(run?.output ?? "")
    }

    private var hasTextOutput: Bool {
        !displayOutput.isEmpty
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
        case "computer", "open_application": return "desktopcomputer"
        default: return "wrench.and.screwdriver"
        }
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
