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
    @Environment(\.scenePhase) private var scenePhase

    /// Coalesce streaming scrollToBottom calls (~50ms) to avoid layout thrash.
    /// Transient view state. App.swift still applies `.id(session.id)`, so a switch
    /// tears this view down and these reset naturally; the `.onChange(of: session.id)`
    /// below is the safety net for the reused-detail-view path.
    @State private var scrollCoalesceScheduled = false
    @State private var scrollNeedsRetry = false
    @State private var rightPanelWidthRatio: CGFloat?
    @State private var rightPanelDragStartWidth: CGFloat?
    @State private var rightPanelDragWidth: CGFloat?
    @StateObject private var gitBranches = GitBranchStore()

    /// Whether the sticky task bar (latest pinnable user message, scrolled fully above the
    /// transcript viewport) should currently be shown. Driven by `StickyTaskAnchorKey`/
    /// `StickyTaskShowKey` geometry preferences computed inside `transcript`.
    @State private var showStickyTaskBar = false
    /// Last-measured height of the rendered `StickyTaskBar`, used to offset the "fully
    /// above viewport" geometry threshold by the space the bar itself occupies (see
    /// `stickyTaskBarOverlay`). Starts at 0 (pre-inset threshold) until first measured.
    @State private var stickyTaskBarHeight: CGFloat = 0

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
                .help("内置浏览器面板（pi 可通过 browser_* 工具驱动）")
            }
        }
        .onAppear {
            // TEMP SWITCH PERF: time from selectedSessionKey change to first appear of the
            // rebuilt detail view. onAppear fires AFTER the .id-driven rebuild has finished
            // its first layout pass, so this delta approximates the blocked main-thread time.
            if AppStore.lastSwitchAt > 0 {
                let dt = (CFAbsoluteTimeGetCurrent() - AppStore.lastSwitchAt) * 1000
                Log.info("switch end onAppear +\(Int(dt))ms", category: .session)
            }
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
            showStickyTaskBar = false
            stickyTaskBarHeight = 0
            // draft / rightPanel / pinTranscriptToBottom / transcriptVisibleCount live on ChatSession.
        }
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
        switch panel {
        case .web:
            WebViewPanel(store: session.webView) {
                session.rightPanel = nil
            }
        case .agents:
            SubagentPanel(store: session.subagents, projectURL: session.projectURL) {
                session.rightPanel = nil
            }
        }
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
        // Recomputed each body pass; O(n) reverse scan capped at the first hit, cheap for
        // realistic transcript sizes. Nil when no user message in this session is pinnable.
        let stickyTarget = TaskPinLogic.latestPinnableUser(in: items)
        // `items.suffix(visibleCount)` only ever trims *older* items (indices < hidden), so
        // a target whose index falls before that cutoff can never be realized by the
        // LazyVStack — it will never get an anchor via `StickyTaskAnchorKey` no matter how
        // long we wait. Treat that case as "definitely above the viewport" up front instead
        // of depending on geometry that can never arrive.
        let stickyTargetTruncated: Bool = {
            guard let stickyTarget,
                  let idx = items.firstIndex(where: { $0.id == stickyTarget.id }) else { return false }
            return idx < hidden
        }()
        return ScrollViewReader { proxy in
            ScrollView {
                // LazyVStack: only realizes the rows in the visible viewport (~10),
                // not all of suffix(~150). This is what makes a long transcript cheap
                // to re-layout on window resize — an eager VStack realized every row's
                // body on every resize frame.
                //
                // The historical reason this was an eager VStack was that a bottom-
                // anchored LazyVStack left rows above the "bottom" anchor unrealized
                // after `proxy.scrollTo("bottom")`, rendering a blank pane until a real
                // scroll forced realization (ScrollDiagnostics: subviews=1 — BLANK).
                // That is now solved below with a `.task(id: session.id)` that uses
                // `Task.sleep` to yield to the layout pass before scrolling, instead of
                // the old wall-clock `DispatchQueue.main.asyncAfter` retries that raced
                // the layout and lost.
                LazyVStack(alignment: .leading, spacing: 14) {
                    if hidden > 0 {
                        Button("显示更早的 \(hidden) 条消息") {
                            session.transcriptVisibleCount += 200
                        }
                        .buttonStyle(.link)
                        .frame(maxWidth: .infinity)
                    }
                    ForEach(items.suffix(visibleCount)) { item in
                        MessageRow(
                            item: item,
                            toolRuns: runs(for: item),
                            subagents: subagents(for: item),
                            projectURL: session.projectURL,
                            onFlash: { session.flash($0) },
                            onSelectAgent: selectAgent
                        )
                        .equatable()
                        .id(item.id)
                        // Only the sticky-target row publishes its bounds; every other row
                        // publishes nil, which `StickyTaskAnchorKey.reduce` treats as "no change".
                        .anchorPreference(key: StickyTaskAnchorKey.self, value: .bounds) { anchor in
                            item.id == stickyTarget?.id ? anchor : nil
                        }
                    }
                    if let streaming = session.streamingItem, hasVisibleContent(streaming) {
                        MessageRow(
                            item: streaming,
                            toolRuns: runs(for: streaming),
                            subagents: subagents(for: streaming),
                            isStreaming: session.isStreaming,
                            projectURL: session.projectURL,
                            onFlash: { session.flash($0) },
                            onSelectAgent: selectAgent
                        )
                    } else if session.isWorking || session.mediaBusy {
                        WaitingPlaceholderView(
                            message: session.mediaBusy
                                ? (session.mediaStatus ?? "正在处理…")
                                : "AI 正在思考…"
                        )
                        .id("waiting-placeholder")
                    }
                    Color.clear
                        .frame(height: 1)
                        .id("bottom")
                        .background(StickToBottomTracker(isPinned: $session.pinTranscriptToBottom))
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .defaultScrollAnchor(.bottom)
            .stickyTaskBarOverlay(
                showStickyTaskBar: $showStickyTaskBar,
                stickyTaskBarHeight: $stickyTaskBarHeight,
                stickyTarget: stickyTarget,
                stickyTargetTruncated: stickyTargetTruncated,
                onTap: { target in scrollToStickyTarget(proxy, item: target) }
            )
            .overlay(alignment: .bottomTrailing) {
                if !session.pinTranscriptToBottom {
                    Button {
                        session.pinTranscriptToBottom = true
                        scrollToBottom(proxy, retry: true)
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
                    .help("跳到底部并恢复自动跟随")
                    .transition(.opacity.combined(with: .scale(scale: 0.92)))
                }
            }
            .overlay {
                // Fills the pane while pi boots and the initial transcript is built,
                // so a new or resuming session shows progress rather than blank white.
                // Only shown when there is nothing to look at yet — a resumed session
                // whose history is already on screen should not be covered.
                if session.isInitializing && session.transcript.isEmpty && session.streamingItem == nil {
                    SessionLoadingView()
                        .transition(.opacity)
                }
            }
            .animation(.easeInOut(duration: 0.2), value: session.isInitializing)
            .animation(.easeInOut(duration: 0.15), value: session.pinTranscriptToBottom)
            .task(id: session.id) {
                // A freshly built transcript (`.id(session.id)` gives each session its
                // own) starts at `defaultScrollAnchor(.bottom)`, which a LazyVStack can
                // only estimate while its rows are unrealized — the estimate lands the
                // viewport past the real content and the user sees a blank pane.
                //
                // The old fix was `forceScrollToBottom` with wall-clock
                // DispatchQueue.main.asyncAfter retries at 0/0.05/0.2s. Those raced the
                // layout pass and reliably lost against LazyVStack realization timing
                // (ScrollDiagnostics logs: subviews=1 — BLANK). `Task.sleep` actually
                // yields the runloop to the layout pass between scrolls, so the second
                // and third attempts land after LazyVStack has realized the visible rows
                // and recomputed its content size.
                //
                // Unconditional on pin state: this is "land the freshly built view on
                // its content", not "follow new content" — a session that the user had
                // scrolled up in must still resolve its initial anchor.
                applyScrollToBottom(proxy)
                try? await Task.sleep(nanoseconds: 50_000_000)
                applyScrollToBottom(proxy)
                try? await Task.sleep(nanoseconds: 150_000_000)
                applyScrollToBottom(proxy)
            }
            .onChange(of: session.id) { _, _ in
                // After warm switch (no .id rebuild): one stick-to-bottom pass when this
                // session still pins. With .id(session.id) active in App.swift this branch
                // is effectively dead on switch (the view is torn down instead), but it is
                // kept as a safety net for the reused-detail-view path.
                scrollCoalesceScheduled = false
                scrollNeedsRetry = false
                showStickyTaskBar = false
                stickyTaskBarHeight = 0
                if session.pinTranscriptToBottom {
                    scrollToBottom(proxy, retry: true)
                }
            }
            .onChange(of: session.transcript.count) { _, _ in
                // 仅在仍贴底时跟随；上翻阅读历史时不强制拖回
                scrollToBottom(proxy)
            }
            .onChange(of: streamingSize) { _, _ in
                scrollToBottom(proxy)
            }
            .onChange(of: session.isWorking) { _, _ in
                scrollToBottom(proxy)
            }
            .onChange(of: session.mediaBusy) { _, _ in
                scrollToBottom(proxy)
            }
            .onChange(of: session.toolOutputVersion) { _, _ in
                scrollToBottom(proxy)
            }
            .onChange(of: agentStore.agents.count) { _, _ in
                scrollToBottom(proxy)
            }
            .onChange(of: session.rightPanel != nil) { _, _ in
                // 右栏开关会改 transcript 宽度/高度，布局后再贴底
                scrollToBottom(proxy, retry: true)
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active {
                    scrollToBottom(proxy, retry: true)
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
                scrollToBottom(proxy, retry: true)
            }
        }
    }

    /// 贴底滚动：仅当用户仍 pin 在底部时执行；流式更新合并为 ~50ms 一次，避免每分片都触发布局
    private func scrollToBottom(_ proxy: ScrollViewProxy, retry: Bool = false) {
        guard session.pinTranscriptToBottom else { return }
        if retry { scrollNeedsRetry = true }
        guard !scrollCoalesceScheduled else { return }
        scrollCoalesceScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            scrollCoalesceScheduled = false
            let needsRetry = scrollNeedsRetry
            scrollNeedsRetry = false
            performScrollToBottom(proxy)
            if needsRetry {
                // 激活/布局后多档重试，等 clip 尺寸稳定后再贴底
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                    performScrollToBottom(proxy)
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                    performScrollToBottom(proxy)
                }
            }
        }
    }

    private func performScrollToBottom(_ proxy: ScrollViewProxy) {
        // 在途 async 到达时用户可能已上翻 unpin，必须再检查
        guard session.pinTranscriptToBottom else { return }
        applyScrollToBottom(proxy)
    }

    private func applyScrollToBottom(_ proxy: ScrollViewProxy) {
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            proxy.scrollTo("bottom", anchor: .bottom)
        }
    }

    /// Jumps back to the sticky bar's target message, expanding `transcriptVisibleCount`
    /// first if the target has been trimmed out of the currently-rendered suffix.
    private func scrollToStickyTarget(_ proxy: ScrollViewProxy, item: ChatItem) {
        if let idx = session.transcript.firstIndex(where: { $0.id == item.id }) {
            let needed = session.transcript.count - idx
            if session.transcriptVisibleCount < needed {
                session.transcriptVisibleCount = max(session.transcriptVisibleCount, needed + 20)
            }
        }
        // Mirrors the `.task(id: session.id)` bottom-scroll retry pattern above: bumping
        // `transcriptVisibleCount` triggers a LazyVStack re-layout, and the first
        // `scrollTo` can fire before that row is actually realized (same
        // ScrollDiagnostics "subviews=1 — BLANK" race). Retry at 0/50/200ms, yielding to
        // the runloop between attempts, instead of a single best-effort call.
        Task { @MainActor in
            applyScrollToStickyTarget(proxy, itemId: item.id)
            try? await Task.sleep(nanoseconds: 50_000_000)
            applyScrollToStickyTarget(proxy, itemId: item.id)
            try? await Task.sleep(nanoseconds: 150_000_000)
            applyScrollToStickyTarget(proxy, itemId: item.id)
        }
    }

    private func applyScrollToStickyTarget(_ proxy: ScrollViewProxy, itemId: String) {
        withAnimation(.easeInOut(duration: 0.2)) {
            proxy.scrollTo(itemId, anchor: .top)
        }
    }

    /// 只取该消息里工具调用对应的 run，让 MessageRow 的 Equatable 比较保持廉价
    private func runs(for item: ChatItem) -> [String: ToolRun] {
        var result: [String: ToolRun] = [:]
        for block in item.blocks {
            if case .toolCall(let call) = block, let run = session.toolRuns[call.id] {
                result[call.id] = run
            }
        }
        return result
    }

    /// 该消息里 subagent 工具调用派出的 agent（含子孙），供卡片实时展示
    private func subagents(for item: ChatItem) -> [SubagentInfo] {
        let callIds = Set(item.blocks.compactMap { block -> String? in
            if case .toolCall(let call) = block, call.name == "subagent" { return call.id }
            return nil
        })
        guard !callIds.isEmpty else { return [] }
        let all = agentStore.agents
        var keep = all.filter { $0.toolCallId.map(callIds.contains) == true }
        var frontier = Set(keep.map(\.id))
        while !frontier.isEmpty {
            let children = all.filter { a in
                a.parentId.map(frontier.contains) == true && !keep.contains(where: { $0.id == a.id })
            }
            if children.isEmpty { break }
            keep.append(contentsOf: children)
            frontier = Set(children.map(\.id))
        }
        return keep
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

    /// 流式内容长度，用来触发自动滚动
    private var streamingSize: Int {
        guard let item = session.streamingItem else { return 0 }
        return item.blocks.reduce(0) { acc, block in
            switch block {
            case .text(let t): return acc + t.count
            case .thinking(let t): return acc + t.count
            case .toolCall: return acc + 1
            case .image: return acc + 1
            case .video: return acc + 1
            }
        }
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

// MARK: - Sticky task bar geometry

private extension View {
    /// Resolves `StickyTaskAnchorKey` (published from inside the transcript's
    /// `LazyVStack`) against this view's own geometry — since this is attached to the
    /// `ScrollView` itself, not the scrolled content, that geometry *is* the viewport
    /// frame, so no named coordinate space is needed; anchors resolve through whatever
    /// `GeometryReader` reads them.
    ///
    /// This `GeometryReader` sits at a point in the chain *before* `safeAreaInset` below
    /// adds the bar, so `geo`'s frame is the ScrollView's frame as if the bar weren't
    /// occupying space at the top — i.e. `geo`'s origin is the *outer* top edge, not the
    /// top of the area actually left for scrollable content once the bar is showing.
    /// Comparing against `rect.maxY <= 0` would therefore ask the target to clear the
    /// bar's own height *again* on top of clearing the viewport, hiding the bar one
    /// bar-height too early while scrolling back down to the target. Comparing against
    /// `rect.maxY <= stickyTaskBarHeight` (the last-measured rendered height of the bar
    /// below) accounts for that inset, so "fully above viewport" means fully above the
    /// space that remains once the bar's own footprint is subtracted.
    ///
    /// When the target row is not currently realized by the `LazyVStack` (scrolled far
    /// away — still present in `items.suffix(visibleCount)`, just not laid out yet), the
    /// anchor is nil for that render; `showStickyTaskBar` then keeps its last-known value
    /// instead of being forced to `false`, avoiding a visibility flicker while the row is
    /// unrealized. When the target has been trimmed out of `items.suffix(visibleCount)`
    /// entirely (`stickyTargetTruncated`), it can never receive an anchor no matter how
    /// long we wait — since the suffix only ever trims *older* items, "not in the
    /// suffix" always means "above viewport", so that case is shown unconditionally,
    /// bypassing geometry.
    ///
    /// Split out of `transcript`'s modifier chain into its own function — folded into
    /// the same expression, this many chained modifiers made the type-checker time out.
    /// A single unconditional `return` below, so no `@ViewBuilder` is needed (and adding
    /// one only produces an "application ... disabled by explicit 'return'" warning).
    func stickyTaskBarOverlay(
        showStickyTaskBar: Binding<Bool>,
        stickyTaskBarHeight: Binding<CGFloat>,
        stickyTarget: ChatItem?,
        stickyTargetTruncated: Bool,
        onTap: @escaping (ChatItem) -> Void
    ) -> some View {
        let barHeight = stickyTaskBarHeight.wrappedValue
        let effectiveShow = stickyTargetTruncated || showStickyTaskBar.wrappedValue
        return self
            .backgroundPreferenceValue(StickyTaskAnchorKey.self) { anchor in
                GeometryReader { geo in
                    Color.clear
                        .preference(key: StickyTaskShowKey.self, value: anchor.map { geo[$0].maxY <= barHeight })
                }
            }
            .onPreferenceChange(StickyTaskShowKey.self) { known in
                if let known { showStickyTaskBar.wrappedValue = known }
            }
            .onChange(of: stickyTarget?.id) { _, _ in
                // New target picked (new task, or first pinnable message in the session):
                // hide until geometry re-confirms it is actually above the viewport, so a
                // freshly sent (visible) task never flashes the bar. `stickyTargetTruncated`
                // (computed fresh from the new target) still overrides this immediately if
                // the new target itself starts out beyond the visible suffix.
                showStickyTaskBar.wrappedValue = false
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                if effectiveShow, let stickyTarget {
                    StickyTaskBar(text: TaskPinLogic.stickyDisplayText(of: stickyTarget)) {
                        onTap(stickyTarget)
                    }
                    .background(
                        GeometryReader { geo in
                            Color.clear
                                .preference(key: StickyTaskBarHeightKey.self, value: geo.size.height)
                        }
                    )
                    .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .onPreferenceChange(StickyTaskBarHeightKey.self) { height in
                stickyTaskBarHeight.wrappedValue = height
            }
            .animation(.easeInOut(duration: 0.15), value: effectiveShow)
    }
}

/// Bubbles up the sticky-target row's `.bounds` anchor from inside the transcript
/// `LazyVStack`. Every row contributes (most yield `nil`); `reduce` treats a `nil`
/// contribution as "no change" so a still-realized target row's last-known anchor is
/// never clobbered by its non-matching siblings.
private struct StickyTaskAnchorKey: PreferenceKey {
    static var defaultValue: Anchor<CGRect>? = nil
    static func reduce(value: inout Anchor<CGRect>?, nextValue: () -> Anchor<CGRect>?) {
        value = nextValue() ?? value
    }
}

/// Whether the sticky target row is fully above the scroll viewport, resolved from
/// `StickyTaskAnchorKey` against the `ScrollView`'s own geometry. `nil` means "target row
/// not currently realized this render" (see comment at the `backgroundPreferenceValue`
/// call site) — callers should hold their last-known value rather than treat it as hidden.
private struct StickyTaskShowKey: PreferenceKey {
    static var defaultValue: Bool? = nil
    static func reduce(value: inout Bool?, nextValue: () -> Bool?) {
        value = nextValue() ?? value
    }
}

/// Rendered height of the `StickyTaskBar`, measured from inside the `safeAreaInset`
/// content. Used to offset the "fully above viewport" geometry threshold (see
/// `stickyTaskBarOverlay`) by the space the bar itself occupies at the top of the
/// ScrollView. Standard max-reduce: only one publisher exists per render, but `max`
/// is a safe combine if that ever changes.
private struct StickyTaskBarHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
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

    static func classify(mouseButtonsDown: Int) -> ScrollOrigin {
        mouseButtonsDown != 0 ? .user : .programmaticOrUnknown
    }

    /// Only a scroll we can attribute to the user may release the bottom pin;
    /// anything else keeps the old, conservative behaviour (pin-only updates).
    var allowsUnpin: Bool { self == .user }
}

/// 挂到 ScrollView 内容底部：只在用户手势滚动时更新 pin 状态。
/// 内容增高导致的「暂时离底」不会取消 pin（由上层 scrollTo 拉回）。
struct StickToBottomTracker: NSViewRepresentable {
    @Binding var isPinned: Bool
    var threshold: CGFloat = 72

    func makeCoordinator() -> Coordinator {
        Coordinator(isPinned: $isPinned, threshold: threshold)
    }

    func makeNSView(context: Context) -> NSView {
        let view = NSView(frame: .zero)
        view.isHidden = true
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        context.coordinator.isPinned = $isPinned
        context.coordinator.threshold = threshold
        // Do not re-attach on every SwiftUI body pass — only when not yet wired.
        context.coordinator.ensureAttached(from: nsView)
    }

    static func dismantleNSView(_ nsView: NSView, coordinator: Coordinator) {
        coordinator.detach()
    }

    final class Coordinator {
        var isPinned: Binding<Bool>
        var threshold: CGFloat
        private weak var scrollView: NSScrollView?
        private var liveScrollObs: NSObjectProtocol?
        private var endScrollObs: NSObjectProtocol?
        private var boundsObs: NSObjectProtocol?
        private var attachAttempts = 0
        private var pinWriteScheduled = false
        private var pendingPinValue: Bool?

        init(isPinned: Binding<Bool>, threshold: CGFloat) {
            self.isPinned = isPinned
            self.threshold = threshold
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
                let center = NotificationCenter.default
                liveScrollObs = center.addObserver(
                    forName: NSScrollView.didLiveScrollNotification,
                    object: sv,
                    queue: .main
                ) { [weak self] _ in
                    self?.updatePinFromUserScroll()
                }
                endScrollObs = center.addObserver(
                    forName: NSScrollView.didEndLiveScrollNotification,
                    object: sv,
                    queue: .main
                ) { [weak self] _ in
                    self?.updatePinFromUserScroll()
                }
                // Catches scroller-knob drags, which post no live-scroll notification.
                let clip = sv.contentView
                clip.postsBoundsChangedNotifications = true
                boundsObs = center.addObserver(
                    forName: NSView.boundsDidChangeNotification,
                    object: clip,
                    queue: .main
                ) { [weak self] _ in
                    let origin = ScrollOrigin.classify(mouseButtonsDown: Int(NSEvent.pressedMouseButtons))
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

        private func updatePinFromUserScroll(allowUnpin: Bool = true) {
            guard let sv = scrollView, let doc = sv.documentView else { return }
            // documentVisibleRect 在 doc 坐标系下，配合 isFlipped 两种方向都正确
            let visible = sv.documentVisibleRect
            let contentHeight = doc.bounds.height
            let distance: CGFloat
            if doc.isFlipped {
                // y 向下：底部 = contentHeight，距底 = maxY 到 content 底边
                distance = contentHeight - visible.maxY
            } else {
                // y 向上：底部 = 0，距底 = visible.minY
                distance = visible.minY
            }
            let nearBottom = distance <= threshold
            let desired: Bool?
            if nearBottom {
                desired = isPinned.wrappedValue ? nil : true
            } else if allowUnpin, isPinned.wrappedValue {
                desired = false
            } else {
                desired = nil
            }
            guard let desired else { return }
            // Never write @Binding synchronously from scroll/layout — bounce to next runloop.
            schedulePinWrite(desired)
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
                if self.isPinned.wrappedValue != pending {
                    self.isPinned.wrappedValue = pending
                }
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
