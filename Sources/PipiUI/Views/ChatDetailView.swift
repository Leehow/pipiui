import SwiftUI
import AppKit

struct ChatDetailView: View {
    @EnvironmentObject var store: AppStore
    @ObservedObject var session: ChatSession

    var body: some View {
        // Pass subagents each render so warm session switch (no .id teardown) rebinds observation.
        ChatDetailViewBody(session: session, agentStore: session.subagents)
            .environmentObject(store)
    }
}

/// Detail chrome + transcript. Separate from `ChatDetailView` so `@ObservedObject agentStore`
/// always tracks the *current* session's `SubagentStore` after removing `.id(session.id)`.
private struct ChatDetailViewBody: View {
    @EnvironmentObject var store: AppStore
    @ObservedObject var session: ChatSession
    /// 单独观察 subagent 树：它更新时主界面的 subagent 卡片要实时跟着动
    @ObservedObject var agentStore: SubagentStore
    @Environment(\.chatTypography) private var chatTypography

    /// Coalesce jump-to-latest `scrollTo` (not streaming follow — flipped list grows
    /// at the pin edge). Transient; reset on session switch.
    @State private var scrollCoalesceScheduled = false
    @State private var scrollNeedsRetry = false
    @State private var rightPanelWidthRatio: CGFloat?
    @State private var rightPanelDragStartWidth: CGFloat?
    @State private var rightPanelDragWidth: CGFloat?
    @StateObject private var gitBranches = GitBranchStore()

    /// Last settled chat-column width. Width changes (window resize / right panel)
    /// reflow LazyVStack row heights; we re-pin after the width stops moving.
    @State private var settledChatColumnWidth: CGFloat?
    /// Width seen during `NSWindow.inLiveResize` — apply + re-pin only when drag ends.
    @State private var pendingChatColumnWidth: CGFloat?
    @State private var chatColumnWidthSettleWork: DispatchWorkItem?
    /// Cancels in-flight width-recovery scrolls when another width change arrives.
    @State private var widthRecoverGeneration = 0

    private let minimumChatWidth: CGFloat = 360
    private let minimumRightPanelWidth: CGFloat = 300
    private let preferredRightPanelWidth: CGFloat = 460
    private let rightPanelDividerWidth: CGFloat = 16

    init(session: ChatSession, agentStore: SubagentStore) {
        self.session = session
        self.agentStore = agentStore
        self._rightPanelWidthRatio = State(initialValue: LayoutPersistence.rightPanelWidthRatio())
    }

    var body: some View {
        GeometryReader { geometry in
            adaptiveLayout(width: geometry.size.width)
        }
        .background(Color(nsColor: .textBackgroundColor))
        .navigationTitle(session.displayTitle)
        .navigationSubtitle(session.projectURL.lastPathComponent)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                GitBranchMenu(store: gitBranches) { session.lastError = $0 }

                Button {
                    if session.rightPanel == .agents {
                        session.rightPanel = nil
                    } else {
                        session.subagents.selectLatest()
                        session.rightPanel = .agents
                    }
                } label: {
                    Image(systemName: "person.2")
                        .foregroundStyle(session.rightPanel == .agents ? Color.accentColor : Color.secondary)
                        .overlay(alignment: .topTrailing) {
                            if session.subagents.runningCount > 0 {
                                Circle().fill(Color.green).frame(width: 7, height: 7)
                                    .offset(x: 3, y: -3)
                            }
                        }
                }
                .help("Subagent 面板（pi 派出的子 agent 树）")

                Button {
                    session.rightPanel = session.rightPanel == .web ? nil : .web
                } label: {
                    Image(systemName: "globe")
                        .foregroundStyle(session.rightPanel == .web ? Color.accentColor : Color.secondary)
                }
                .help("内置浏览器面板（pi 可通过 browser 工具驱动）")

                Button {
                    session.rightPanel = session.rightPanel == .document ? nil : .document
                } label: {
                    Image(systemName: "doc.text")
                        .foregroundStyle(session.rightPanel == .document ? Color.accentColor : Color.secondary)
                }
                .help("文档面板（⌘+点击聊天中的 md/txt 文档路径在此预览）")
            }
        }
        .onAppear {
            gitBranches.bind(projectURL: session.projectURL)
        }
        .onChange(of: session.id) { _, _ in
            // Safety net for the reused-detail-view path. App.swift currently keeps
            // `.id(session.id)`, so a switch tears this view down and this branch is
            // effectively dead on switch — but it is kept correct in case .id is removed.
            gitBranches.bind(projectURL: session.projectURL)
            scrollCoalesceScheduled = false
            scrollNeedsRetry = false
            rightPanelDragStartWidth = nil
            rightPanelDragWidth = nil
            settledChatColumnWidth = nil
            pendingChatColumnWidth = nil
            chatColumnWidthSettleWork?.cancel()
            chatColumnWidthSettleWork = nil
            widthRecoverGeneration += 1
            // draft / rightPanel / pinTranscriptToBottom / transcriptVisibleCount live on ChatSession.
        }
        .environment(\.openDocument, { url in
            // ⌘+点击聊天中的文档路径 → 右侧文档面板渲染（非文档路径仍走访达）。
            session.documents.open(url)
            session.rightPanel = .document
        })
    }

    private var chatColumn: some View {
        VStack(spacing: 0) {
            transcript
            if let conflicts = store.extensionConflicts[session.id], !conflicts.isEmpty {
                conflictBanner(conflicts)
            }
            if let error = session.lastError {
                errorBanner(error)
            }
            InputBar(session: session)
        }
        .background(
            GeometryReader { geo in
                Color.clear.preference(key: ChatColumnWidthKey.self, value: geo.size.width)
            }
        )
        .frame(minWidth: 0, maxWidth: .infinity, maxHeight: .infinity)
        .layoutPriority(1)
    }

    @ViewBuilder
    private func adaptiveLayout(width: CGFloat) -> some View {
        if width >= 760 {
            // 宽屏恒为 HStack：开关右栏只插入/移除 divider+panel 兄弟节点，
            // chatColumn 视图身份保持不变 → 不再因 HStack↔ZStack 翻转而拆除重建。
            HStack(spacing: 0) {
                chatColumn
                    .frame(minWidth: minimumChatWidth)
                if let panel = session.rightPanel {
                    RightPanelDivider(
                        onChanged: { translation in
                            updateRightPanelDrag(
                                translation: translation / store.uiScale,
                                availableWidth: width
                            )
                        },
                        onEnded: { translation in
                            finishRightPanelDrag(
                                translation: translation / store.uiScale,
                                availableWidth: width
                            )
                        }
                    )
                    .frame(width: rightPanelDividerWidth)
                    panelView(panel)
                        .frame(width: wideRightPanelWidth(for: width))
                }
            }
        } else {
            ZStack(alignment: .trailing) {
                chatColumn

                if let panel = session.rightPanel {
                    panelView(panel)
                        .frame(width: overlayPanelWidth(for: width))
                        .frame(maxHeight: .infinity)
                        .background(Color(nsColor: .textBackgroundColor))
                        .overlay(alignment: .leading) {
                            Divider()
                        }
                        .shadow(color: .black.opacity(0.16), radius: 10, x: -3)
                        .transition(.move(edge: .trailing).combined(with: .opacity))
                }
            }
            .clipped()
            .animation(.easeInOut(duration: 0.18), value: session.rightPanel)
        }
    }

    @ViewBuilder
    private func panelView(_ panel: ChatSession.RightPanel) -> some View {
        Group {
            switch panel {
            case .web:
                WebViewPanel(store: session.webView) {
                    session.rightPanel = nil
                }
            case .agents:
                SubagentPanel(store: session.subagents, projectURL: session.projectURL) {
                    session.rightPanel = nil
                }
            case .document:
                DocumentPanel(store: session.documents) {
                    session.rightPanel = nil
                }
            }
        }
        .overlayScrollers()
    }

    private func overlayPanelWidth(for availableWidth: CGFloat) -> CGFloat {
        let ratio = rightPanelWidthRatio ?? LayoutPersistence.defaultRightPanelWidthRatio
        return min(max(availableWidth * ratio, 280), availableWidth)
    }

    private func wideRightPanelWidth(for availableWidth: CGFloat) -> CGFloat {
        let proposedWidth: CGFloat
        if let rightPanelDragWidth {
            proposedWidth = rightPanelDragWidth
        } else if let rightPanelWidthRatio {
            proposedWidth = availableWidth * rightPanelWidthRatio
        } else {
            proposedWidth = preferredRightPanelWidth
        }
        return clampedRightPanelWidth(proposedWidth, availableWidth: availableWidth)
    }

    private func clampedRightPanelWidth(_ proposedWidth: CGFloat, availableWidth: CGFloat) -> CGFloat {
        let maximumPanelWidth = max(
            minimumRightPanelWidth,
            availableWidth - minimumChatWidth - rightPanelDividerWidth
        )
        return min(max(proposedWidth, minimumRightPanelWidth), maximumPanelWidth)
    }

    private func updateRightPanelDrag(translation: CGFloat, availableWidth: CGFloat) {
        if rightPanelDragStartWidth == nil {
            rightPanelDragStartWidth = wideRightPanelWidth(for: availableWidth)
        }
        guard let rightPanelDragStartWidth else { return }
        rightPanelDragWidth = clampedRightPanelWidth(
            rightPanelDragStartWidth - translation,
            availableWidth: availableWidth
        )
    }

    private func finishRightPanelDrag(translation: CGFloat, availableWidth: CGFloat) {
        let startWidth = rightPanelDragStartWidth ?? wideRightPanelWidth(for: availableWidth)
        let finalWidth = clampedRightPanelWidth(
            startWidth - translation,
            availableWidth: availableWidth
        )

        if abs(translation) >= 1 {
            let ratio = finalWidth / availableWidth
            if let validRatio = LayoutPersistence.saveRightPanelWidthRatio(ratio) {
                rightPanelWidthRatio = validRatio
            }
        }

        rightPanelDragStartWidth = nil
        rightPanelDragWidth = nil
    }

    private var transcript: some View {
        let items = session.transcript
        let visibleCount = session.transcriptVisibleCount
        let hidden = max(0, items.count - visibleCount)
        // T6 布局记忆化：版本 key 未变时直接命中缓存，不再每次 body 求值全量重排。
        let visibleRowsNewestFirst = session.transcriptPlanner
            .rows(
                items: items,
                toolRuns: session.toolRuns,
                visibleCount: visibleCount,
                transcriptVersion: session.transcriptVersion,
                toolOutputVersion: session.toolOutputVersion
            )
            .reversed()
        return ScrollViewReader { proxy in
            ScrollView {
                // Newest-first stack. `.transcriptFlip()` on the ScrollView (below) puts
                // document-start at the visual bottom — no `.defaultScrollAnchor(.bottom)`.
                LazyVStack(alignment: .leading, spacing: chatTypography.messageSpacing) {
                    // Visual bottom / pin edge (document start after scroll-view flip).
                    Color.clear
                        .frame(height: 1)
                        .id("bottom")
                        .background(
                            StickToBottomTracker(
                                isPinned: $session.pinTranscriptToBottom,
                                pinEdge: .documentStart
                            )
                        )
                        .transcriptFlip()

                    if let streaming = session.streamingItem, hasVisibleContent(streaming) {
                        MessageRow(
                            item: streaming,
                            toolRuns: runs(for: streaming),
                            subagents: subagents(for: streaming),
                            isStreaming: session.isStreaming,
                            projectURL: session.projectURL,
                            chatFontSize: chatTypography.fontSize,
                            isWorking: session.isWorking,
                            onFlash: { session.flash($0) },
                            onSelectAgent: selectAgent,
                            onCopy: {
                                session.copySegmentsText(
                                    AssistantBlockLayout.plan(
                                        blocks: streaming.blocks,
                                        groupFinished: !session.isStreaming
                                    )
                                )
                            },
                            onBranch: {
                                guard let entryId = streaming.entryId else { return }
                                session.branchFromAssistant(runLastEntryId: entryId)
                            }
                        )
                        .transcriptFlip()
                    } else if session.isWorking || session.mediaBusy {
                        WaitingPlaceholderView(
                            message: session.mediaBusy
                                ? (session.mediaStatus ?? "正在处理…")
                                : (session.isStopping ? "正在停止…" : "AI 正在思考…")
                        )
                        .id("waiting-placeholder")
                        .transcriptFlip()
                    }

                    ForEach(visibleRowsNewestFirst, id: \.id) { row in
                        switch row {
                        case .leaf(let item):
                            MessageRow(
                                item: item,
                                toolRuns: runs(for: item),
                                subagents: subagents(for: item),
                                projectURL: session.projectURL,
                                chatFontSize: chatTypography.fontSize,
                                isWorking: session.isWorking,
                                isEditing: session.editingItemId == item.id,
                                onFlash: { session.flash($0) },
                                onSelectAgent: selectAgent,
                                onCopy: { session.copyItemText(item) },
                                onResend: { session.resendUserMessage(itemId: item.id) },
                                onBeginEdit: { session.beginEditingUserMessage(itemId: item.id) },
                                onCancelEdit: { session.cancelEditingUserMessage() },
                                onCommitEdit: { session.commitEditingUserMessage(newText: $0) }
                            )
                            .equatable()
                            .id(item.id)
                            .transcriptFlip()
                        case .assistantRun(let id, let entryId, let segments):
                            let callIds = AssistantBlockLayout.toolCallIds(in: segments)
                            AssistantSegmentsView(
                                segments: segments,
                                toolRuns: runs(forToolCallIds: callIds),
                                subagents: subagents(forToolCallIds: callIds),
                                projectURL: session.projectURL,
                                onFlash: { session.flash($0) },
                                onSelectAgent: selectAgent,
                                entryId: entryId,
                                isWorking: session.isWorking,
                                onCopy: { session.copySegmentsText(segments) },
                                onBranch: {
                                    guard let entryId else { return }
                                    session.branchFromAssistant(runLastEntryId: entryId)
                                }
                            )
                            .equatable()
                            .id(id)
                            .transcriptFlip()
                        }
                    }

                    if hidden > 0 {
                        Button("显示更早的 \(hidden) 条消息") {
                            session.transcriptVisibleCount += 200
                        }
                        .buttonStyle(.link)
                        .frame(maxWidth: .infinity)
                        .transcriptFlip()
                    }
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .geometryGroup()
            }
            // Prefer overlay indicators; AppKit style is forced in StickToBottomTracker.
            .scrollIndicators(.automatic)
            // Flip the scroll view itself so document-start maps to the visual bottom.
            .transcriptFlip()
            .overlay(alignment: .bottomTrailing) {
                if !session.pinTranscriptToBottom {
                    Button {
                        session.pinTranscriptToBottom = true
                        jumpToLatest(proxy, retry: true)
                    } label: {
                        Image(systemName: "arrow.down")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(width: 32, height: 32)
                            .background(Circle().fill(Color.accentColor))
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .shadow(color: .black.opacity(0.2), radius: 4, y: 2)
                    .padding(12)
                    .help("跳到最新消息")
                }
            }
            .overlay {
                // Covers the pane while pi boots and the initial transcript is built.
                if session.isInitializing && session.streamingItem == nil {
                    SessionLoadingView()
                        .transition(.opacity)
                }
            }
            .animation(.easeInOut(duration: 0.2), value: session.isInitializing)
            .onChange(of: session.id) { _, _ in
                scrollCoalesceScheduled = false
                scrollNeedsRetry = false
            }
            .onChange(of: session.isInitializing) { wasInitializing, isInitializing in
                // History arrived: one LazyVStack realize nudge at the pin edge.
                // Streaming / new messages do *not* scrollTo — growth is at document start.
                if wasInitializing && !isInitializing, session.pinTranscriptToBottom {
                    jumpToLatest(proxy)
                }
            }
            .onChange(of: session.rightPanel != nil) { _, _ in
                recoverPinAfterColumnWidthChange(proxy)
            }
            .onPreferenceChange(ChatColumnWidthKey.self) { width in
                scheduleChatColumnWidthSettleRepin(proxy, width: width)
            }
            .onReceive(NotificationCenter.default.publisher(for: NSWindow.didEndLiveResizeNotification)) { _ in
                chatColumnWidthSettleWork?.cancel()
                chatColumnWidthSettleWork = nil
                if let pending = pendingChatColumnWidth {
                    settledChatColumnWidth = pending
                    pendingChatColumnWidth = nil
                }
                recoverPinAfterColumnWidthChange(proxy)
            }
        }
    }

    /// Debounce chat-column width changes, then re-pin — but **never** while the window
    /// is in live resize. Mid-drag `scrollTo("bottom")` races LazyVStack reflow and
    /// makes the transcript tremble; window drags only re-pin on `didEndLiveResize`.
    /// Right-panel toggles (not live resize) still settle-then-repin here.
    private func scheduleChatColumnWidthSettleRepin(_ proxy: ScrollViewProxy, width: CGFloat) {
        guard width.isFinite, width > 1 else { return }
        // Ignore sub-point / layout jitter — recovering on noise fights the wheel.
        if let settled = settledChatColumnWidth, abs(settled - width) < 12 {
            return
        }
        if NSApp.keyWindow?.inLiveResize == true {
            pendingChatColumnWidth = width
            chatColumnWidthSettleWork?.cancel()
            chatColumnWidthSettleWork = nil
            return
        }
        chatColumnWidthSettleWork?.cancel()
        let work = DispatchWorkItem {
            // Drag may have started after this work was scheduled.
            if NSApp.keyWindow?.inLiveResize == true {
                pendingChatColumnWidth = width
                return
            }
            let previous = settledChatColumnWidth
            settledChatColumnWidth = width
            // First layout pass only records width — do not yank an initial scroll.
            guard previous != nil else { return }
            recoverPinAfterColumnWidthChange(proxy)
        }
        chatColumnWidthSettleWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12, execute: work)
    }

    /// After chat-column width jumps (right panel / resize end), one pin-edge settle
    /// so LazyVStack realizes rows at the new width. Only when still pinned.
    private func recoverPinAfterColumnWidthChange(_ proxy: ScrollViewProxy) {
        guard session.pinTranscriptToBottom else { return }
        widthRecoverGeneration += 1
        let generation = widthRecoverGeneration
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 32_000_000)
            guard generation == widthRecoverGeneration, session.pinTranscriptToBottom else { return }
            applyJumpToLatest(proxy)
        }
    }

    /// Explicit jump to the pin edge (jump button / init settle / width recover).
    /// Not used for streaming follow — flipped growth stays at document start.
    private func jumpToLatest(_ proxy: ScrollViewProxy, retry: Bool = false) {
        guard session.pinTranscriptToBottom else { return }
        if retry { scrollNeedsRetry = true }
        guard !scrollCoalesceScheduled else { return }
        scrollCoalesceScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            scrollCoalesceScheduled = false
            let needsRetry = scrollNeedsRetry
            scrollNeedsRetry = false
            guard session.pinTranscriptToBottom else { return }
            applyJumpToLatest(proxy)
            if needsRetry {
                for delay in [0.05, 0.2] as [TimeInterval] {
                    DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                        guard session.pinTranscriptToBottom else { return }
                        applyJumpToLatest(proxy)
                    }
                }
            }
        }
    }

    private func applyJumpToLatest(_ proxy: ScrollViewProxy) {
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            // ScrollView is y-flipped: layout `.top` is the visual bottom / pin edge.
            if let newestId = session.transcript.suffix(session.transcriptVisibleCount).last?.id {
                proxy.scrollTo(newestId, anchor: .top)
            }
            proxy.scrollTo("bottom", anchor: .top)
        }
    }

    /// 只取该消息里工具调用对应的 run，让 MessageRow 的 Equatable 比较保持廉价
    private func runs(for item: ChatItem) -> [String: ToolRun] {
        var ids = Set<String>()
        for block in item.blocks {
            if case .toolCall(let call) = block { ids.insert(call.id) }
        }
        return runs(forToolCallIds: ids)
    }

    private func runs(forToolCallIds ids: Set<String>) -> [String: ToolRun] {
        var result: [String: ToolRun] = [:]
        for id in ids {
            if let run = session.toolRuns[id] { result[id] = run }
        }
        return result
    }

    /// 该消息里 subagent 工具调用派出的 agent（含子孙），供卡片实时展示
    private func subagents(for item: ChatItem) -> [SubagentInfo] {
        let callIds = Set(item.blocks.compactMap { block -> String? in
            if case .toolCall(let call) = block, call.name == "subagent" { return call.id }
            return nil
        })
        return subagents(forToolCallIds: callIds)
    }

    private func subagents(forToolCallIds callIds: Set<String>) -> [SubagentInfo] {
        // O(结果数) 索引查询（索引在 agents 变化时惰性重建）。
        agentStore.agents(forToolCallIds: callIds)
    }

    private func selectAgent(_ id: String) {
        session.subagents.selectedId = id
        session.rightPanel = .agents
    }

    /// streamingItem 是否已有可展示内容（空 blocks / 空 text·thinking 不算）
    private func hasVisibleContent(_ item: ChatItem) -> Bool {
        for block in item.blocks {
            switch block {
            case .text(let t), .thinking(let t):
                if !t.isEmpty { return true }
            case .toolCall, .image, .video:
                return true
            }
        }
        return false
    }

    /// 撞名扩展会让 pi 一启动就 exit(1)，这里给出具体路径和一键修复，别让用户只看到崩溃日志
    private func conflictBanner(_ conflicts: [PiExtensionConflict]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.octagon.fill")
                    .foregroundStyle(.red)
                Text("检测到与内置 subagent 冲突的扩展，pi 会启动失败")
                    .font(.callout.weight(.medium))
                Spacer()
                Button("禁用并重启") { store.resolveExtensionConflicts(sessionKey: session.id) }
                    .buttonStyle(HoverButtonStyle(base: .secondary, hovered: .primary))
                Button("忽略") { store.ignoreExtensionConflicts(sessionKey: session.id) }
                    .buttonStyle(HoverButtonStyle(base: .secondary, hovered: .primary))
            }
            ForEach(conflicts) { conflict in
                Text("\(conflict.scopeLabel)：\(conflict.entryPath)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
            Text("「禁用并重启」会在 \(conflicts[0].settingsPath) 的 extensions 里加一条排除规则，不删除任何文件。")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(Color.red.opacity(0.1))
    }

    private func errorBanner(_ error: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
            Text(error)
                .font(.callout)
                .lineLimit(2)
            Spacer()
            Button("关闭") { session.lastError = nil }
                .buttonStyle(HoverButtonStyle(base: .secondary, hovered: .primary))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(Color.orange.opacity(0.1))
    }
}

private struct RightPanelDivider: View {
    let onChanged: (CGFloat) -> Void
    let onEnded: (CGFloat) -> Void
    @State private var isPointerInside = false

    var body: some View {
        ZStack {
            Color.clear
            Rectangle()
                .fill(Color.primary.opacity(0.14))
                .frame(width: 1)
        }
        .contentShape(Rectangle())
        .gesture(
            DragGesture(
                minimumDistance: 1,
                coordinateSpace: .global
            )
                .onChanged { value in
                    onChanged(value.translation.width)
                }
                .onEnded { value in
                    onEnded(value.translation.width)
                }
        )
        .onHover { isInside in
            isPointerInside = isInside
            (isInside ? NSCursor.resizeLeftRight : NSCursor.arrow).set()
        }
        .onDisappear {
            if isPointerInside {
                isPointerInside = false
                NSCursor.arrow.set()
            }
        }
        .help("拖动调整右侧面板宽度")
    }
}

/// Chat column width (transcript + input). Used to re-pin after width settle.
private struct ChatColumnWidthKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

// MARK: - Stick-to-bottom tracking (AppKit)

/// Decides whether a clip-view move is the user scrolling or the app scrolling.
///
/// `didLiveScroll` only covers wheel and trackpad gestures. Dragging the scroller
/// knob moves the clip view silently, so the transcript stayed "pinned to bottom"
/// and every streaming chunk yanked it back under the user's cursor. Clip bounds
/// changes see every scroll — including our own `scrollTo` — so they need a filter.
///
/// A time-based "we just scrolled" window cannot work here: during streaming the app
/// scrolls every ~50 ms, so such a window is permanently open and would swallow the
/// user's drag, which is precisely the case being fixed. A held mouse button, on the
/// other hand, is present for a knob drag and absent for a programmatic scroll.
enum ScrollOrigin {
    case user
    case programmaticOrUnknown

    /// - Parameter windowInLiveResize: AppKit window chrome drag. The mouse button
    ///   is held (same signal as a scroller-knob drag) while transcript width/height
    ///   reflows — that must not unpin, or settle-time `scrollTo("bottom")` is skipped
    ///   and the viewport lands mid-history after LazyVStack re-estimates row heights.
    static func classify(mouseButtonsDown: Int, windowInLiveResize: Bool = false) -> ScrollOrigin {
        if windowInLiveResize { return .programmaticOrUnknown }
        return mouseButtonsDown != 0 ? .user : .programmaticOrUnknown
    }

    /// Only a scroll we can attribute to the user may release the bottom pin;
    /// anything else keeps the old, conservative behaviour (pin-only updates).
    var allowsUnpin: Bool { self == .user }
}

/// Which document edge holds the “latest” chat content for pin tracking.
enum StickPinEdge: Equatable {
    /// Classic top-down transcript: newest at document end.
    case documentEnd
    /// Flipped newest-first transcript: newest at document start.
    case documentStart
}

/// Pure pin/unpin decision for stick-to-bottom (unit-tested).
enum StickToBottomLogic {
    /// Soft band used to *re*-pin when the user scrolls back near the end.
    static let rePinThreshold: CGFloat = 72
    /// On wheel/trackpad live scroll, leave the absolute bottom by more than this → unpin
    /// immediately. A 72pt band let `scrollToBottom` win against small wheel ticks.
    static let liveScrollUnpinDistance: CGFloat = 4

    /// Distance from the pin edge in document coordinates.
    static func distanceFromPinEdge(
        visible: CGRect,
        contentHeight: CGFloat,
        documentIsFlipped: Bool,
        pinEdge: StickPinEdge
    ) -> CGFloat {
        switch pinEdge {
        case .documentEnd:
            if documentIsFlipped {
                return contentHeight - visible.maxY
            }
            return visible.minY
        case .documentStart:
            if documentIsFlipped {
                return visible.minY
            }
            return contentHeight - visible.maxY
        }
    }

    /// - Returns: `true`/`false` to write pin, or `nil` for no change.
    static func desiredPin(
        currentlyPinned: Bool,
        distanceFromBottom: CGFloat,
        userLiveScroll: Bool,
        allowUnpin: Bool
    ) -> Bool? {
        if userLiveScroll, allowUnpin, currentlyPinned, distanceFromBottom > liveScrollUnpinDistance {
            return false
        }
        let nearBottom = distanceFromBottom <= rePinThreshold
        if nearBottom {
            return currentlyPinned ? nil : true
        }
        if allowUnpin, currentlyPinned {
            return false
        }
        return nil
    }
}

/// 挂到 ScrollView 贴底锚点：只在用户手势滚动时更新 pin 状态。
/// 内容增高导致的「暂时离底」不会取消 pin（由上层 scrollTo 拉回）。
struct StickToBottomTracker: NSViewRepresentable {
    @Binding var isPinned: Bool
    var threshold: CGFloat = StickToBottomLogic.rePinThreshold
    var pinEdge: StickPinEdge = .documentEnd

    func makeCoordinator() -> Coordinator {
        Coordinator(isPinned: $isPinned, threshold: threshold, pinEdge: pinEdge)
    }

    func makeNSView(context: Context) -> NSView {
        let view = NSView(frame: .zero)
        view.isHidden = true
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        context.coordinator.isPinned = $isPinned
        context.coordinator.threshold = threshold
        context.coordinator.pinEdge = pinEdge
        // Do not re-attach on every SwiftUI body pass — only when not yet wired.
        context.coordinator.ensureAttached(from: nsView)
        // Re-apply only if SwiftUI reset style to legacy (applyIfNeeded is a no-op otherwise).
        if let sv = context.coordinator.attachedScrollView {
            OverlayScrollers.applyIfNeeded(to: sv)
        }
    }

    static func dismantleNSView(_ nsView: NSView, coordinator: Coordinator) {
        coordinator.detach()
    }

    final class Coordinator {
        var isPinned: Binding<Bool>
        var threshold: CGFloat
        var pinEdge: StickPinEdge
        private weak var scrollView: NSScrollView?
        /// Exposed so `updateNSView` can re-apply overlay style after SwiftUI resets it.
        var attachedScrollView: NSScrollView? { scrollView }
        private var liveScrollObs: NSObjectProtocol?
        private var endScrollObs: NSObjectProtocol?
        private var boundsObs: NSObjectProtocol?
        private var attachAttempts = 0
        private var pinWriteScheduled = false
        private var pendingPinValue: Bool?

        init(isPinned: Binding<Bool>, threshold: CGFloat, pinEdge: StickPinEdge) {
            self.isPinned = isPinned
            self.threshold = threshold
            self.pinEdge = pinEdge
        }

        deinit { detach() }

        /// Idempotent: skip if observers already live on a scroll view.
        func ensureAttached(from view: NSView) {
            if scrollView != nil, liveScrollObs != nil { return }
            attach(from: view)
        }

        func attach(from view: NSView) {
            if scrollView != nil, liveScrollObs != nil { return }
            detach()
            // SwiftUI 嵌入后 enclosingScrollView 可能尚未就绪
            if let sv = view.enclosingScrollView ?? Self.findScrollView(startingAt: view) {
                scrollView = sv
                attachAttempts = 0
                OverlayScrollers.apply(to: sv)
                let center = NotificationCenter.default
                liveScrollObs = center.addObserver(
                    forName: NSScrollView.didLiveScrollNotification,
                    object: sv,
                    queue: .main
                ) { [weak self] _ in
                    guard self?.scrollView?.window?.inLiveResize != true else { return }
                    self?.updatePinFromUserScroll(userLiveScroll: true)
                }
                endScrollObs = center.addObserver(
                    forName: NSScrollView.didEndLiveScrollNotification,
                    object: sv,
                    queue: .main
                ) { [weak self] _ in
                    guard self?.scrollView?.window?.inLiveResize != true else { return }
                    self?.updatePinFromUserScroll(userLiveScroll: true)
                }
                // Catches scroller-knob drags, which post no live-scroll notification.
                let clip = sv.contentView
                clip.postsBoundsChangedNotifications = true
                boundsObs = center.addObserver(
                    forName: NSView.boundsDidChangeNotification,
                    object: clip,
                    queue: .main
                ) { [weak self] _ in
                    let inLiveResize = self?.scrollView?.window?.inLiveResize == true
                    let origin = ScrollOrigin.classify(
                        mouseButtonsDown: Int(NSEvent.pressedMouseButtons),
                        windowInLiveResize: inLiveResize
                    )
                    guard origin.allowsUnpin else { return }
                    self?.updatePinFromUserScroll()
                }
                // 安装时只允许「确认在底部 → pin」，避免布局未完成时误 unpin
                updatePinFromUserScroll(allowUnpin: false)
            } else if attachAttempts < 8 {
                attachAttempts += 1
                DispatchQueue.main.async { [weak self] in
                    self?.attach(from: view)
                }
            }
        }

        func detach() {
            let center = NotificationCenter.default
            if let liveScrollObs { center.removeObserver(liveScrollObs) }
            if let endScrollObs { center.removeObserver(endScrollObs) }
            if let boundsObs { center.removeObserver(boundsObs) }
            liveScrollObs = nil
            endScrollObs = nil
            boundsObs = nil
            scrollView = nil
            pinWriteScheduled = false
            pendingPinValue = nil
        }

        private func updatePinFromUserScroll(allowUnpin: Bool = true, userLiveScroll: Bool = false) {
            guard let sv = scrollView, let doc = sv.documentView else { return }
            let visible = sv.documentVisibleRect
            let contentHeight = doc.bounds.height
            let distance = StickToBottomLogic.distanceFromPinEdge(
                visible: visible,
                contentHeight: contentHeight,
                documentIsFlipped: doc.isFlipped,
                pinEdge: pinEdge
            )
            let desired = StickToBottomLogic.desiredPin(
                currentlyPinned: isPinned.wrappedValue,
                distanceFromBottom: distance,
                userLiveScroll: userLiveScroll,
                allowUnpin: allowUnpin
            )
            guard let desired else { return }
            // Unpin from a live wheel/trackpad scroll synchronously so in-flight
            // jump / width-recover see `pin == false` this runloop.
            if desired == false, userLiveScroll {
                pendingPinValue = nil
                writePin(false)
                return
            }
            // Re-pin / other writes: bounce to next runloop (avoid layout feedback).
            schedulePinWrite(desired)
        }

        private func writePin(_ value: Bool) {
            guard isPinned.wrappedValue != value else { return }
            // Avoid implicit animation / transition thrash on the jump-to-bottom control.
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                isPinned.wrappedValue = value
            }
        }

        private func schedulePinWrite(_ value: Bool) {
            pendingPinValue = value
            guard !pinWriteScheduled else { return }
            pinWriteScheduled = true
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.pinWriteScheduled = false
                guard let pending = self.pendingPinValue else { return }
                self.pendingPinValue = nil
                self.writePin(pending)
            }
        }

        private static func findScrollView(startingAt view: NSView) -> NSScrollView? {
            var current: NSView? = view
            while let c = current {
                if let sv = c as? NSScrollView { return sv }
                current = c.superview
            }
            return nil
        }
    }
}
