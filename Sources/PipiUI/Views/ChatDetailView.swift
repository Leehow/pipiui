import SwiftUI
import AppKit

// The transcript is laid out normally (oldest at top, newest at bottom).
// Jump targets land at the visible top so the selected turn reads from its start.
private let jumpAnchor: UnitPoint = .top

/// SwiftUI row/anchor identity must be unique across warm session switches.
///
/// `ChatItem.id` is intentionally local to one `ChatSession` (`item-1`, `item-2`, …).
/// Even though the complete transcript root is session-scoped below, delayed ScrollViewReader
/// operations and anchor bookkeeping must never address another session's local row id.
enum TranscriptRenderIdentity {
    static func scoped(sessionKey: String, localID: String) -> String {
        "\(sessionKey):\(localID)"
    }

    /// Inverse of `scoped`; `nil` when the id belongs to another session.
    static func local(fromScoped scopedID: String, sessionKey: String) -> String? {
        let prefix = sessionKey + ":"
        guard scopedID.hasPrefix(prefix) else { return nil }
        return String(scopedID.dropFirst(prefix.count))
    }
}

/// Identity for the complete transcript scroll hierarchy.
///
/// A different ChatSession must receive a fresh outer NSScrollView, not only a
/// fresh scroll hierarchy. Otherwise the old clip offset, layout cache, and nested
/// tool-output ScrollView phase can be reconciled against an unrelated session.
/// `bridgeRoutingKey` is stable when one logical session rebinds its persisted id.
struct TranscriptSessionRootIdentity: Hashable {
    let sessionKey: String
}

/// Settled-history window rendered by the eager transcript stack.
///
/// A small eager window (2+ fixed pages) gives native NSTextView-backed markdown
/// enough room to settle its exact height without reintroducing lazy-stack height
/// estimation. The window is **one-way**: it always ends at the newest transcript
/// item and only ever grows backward while the user browses history. A scroll
/// report can never delete pages, so the old feedback loop
/// `scrollPosition → window shrink → new scrollPosition` is structurally
/// impossible. Pinned/live mode renders the latest two pages (`nil` head);
/// unpinned history prepends one older page at a time.
struct TranscriptRenderWindow: Equatable {
    static let pageSize = 32

    let range: Range<Int>
    let totalCount: Int

    /// The window always includes the newest item (`end == itemCount`) — history
    /// browsing prepends at the old end and never drops the latest end.
    var isLatest: Bool { range.upperBound == totalCount }
    var renderedCount: Int { range.count }

    /// Index of the newest page (`p`); 0 for an empty transcript.
    static func latestPage(itemCount: Int) -> Int {
        let count = max(0, itemCount)
        return max(0, (count + pageSize - 1) / pageSize - 1)
    }

    /// Default (pinned / freshly reset) window start: the newest page minus one.
    static func latestStartPage(itemCount: Int) -> Int {
        max(0, latestPage(itemCount: itemCount) - 1)
    }

    /// Window from `oldestLoadedPage` (history head) through the newest item.
    /// `nil` and out-of-range values clamp to the latest two pages, so a stale
    /// head (transcript reload / session switch) can never render invalid items.
    static func resolve(itemCount: Int, oldestLoadedPage: Int?) -> Self {
        let count = max(0, itemCount)
        let lastPage = latestPage(itemCount: count)
        let startPage: Int
        if let oldestLoadedPage, (0...lastPage).contains(oldestLoadedPage) {
            startPage = oldestLoadedPage
        } else {
            startPage = latestStartPage(itemCount: count)
        }
        let start = startPage * pageSize
        return Self(range: start..<count, totalCount: count)
    }
}

/// One-step prepend decision for history browsing. Pure and unit-tested so the
/// feedback-breaking rule can never regress into a bidirectional window again:
/// the reached top page may only pull **one** older page in, never remove pages
/// at the newest end, and once the start moves the call is naturally idempotent
/// (the reached top then lies below the new start). The trigger is the AppKit
/// clip-geometry near-top edge; the caller reports the oldest loaded page as the
/// reached page, so `prepend(currentStartPage: 5, visiblePage: 5) == 4`.
enum TranscriptHistoryPrepender {
    /// - Returns: the new oldest loaded page (`currentStartPage - 1`) when the
    ///   top-visible page has reached the oldest loaded page and older pages
    ///   exist; `nil` otherwise.
    static func prepend(currentStartPage: Int, visiblePage: Int) -> Int? {
        guard currentStartPage > 0, visiblePage <= currentStartPage else { return nil }
        return currentStartPage - 1
    }
}

/// Layout gravity contract for short pinned transcripts (fold/unfold jump fix).
///
/// A pinned session whose rendered content is shorter than the visible viewport
/// must keep its rows glued to the bottom composer. `StickToBottomTracker` can
/// only express that with clip offsets while the document is taller than the
/// viewport; once contentHeight <= viewport there is no offset to write, so the
/// top anchor of `.scrollPosition(id:anchor:.top)` wins and a fold/unfold height
/// change bounces the whole block between viewport top and bottom.
///
/// The fix is layout-level gravity gated on the pin state: a viewport min-height
/// on the transcript plus a top flexible space. Both must appear together — one
/// without the other would either leave rows at the document top or stranded
/// mid-document — and both must disappear when the user has scrolled away
/// (unpinned) so short content keeps its natural top-aligned layout.
enum ShortTranscriptGravity {
    /// Viewport min-height applied to the transcript. `nil` keeps natural layout:
    /// the unpinned case, and any viewport measurement that is not a real height.
    static func viewportMinHeight(
        pinned: Bool,
        viewportHeight: CGFloat?
    ) -> CGFloat? {
        guard pinned,
              let viewportHeight,
              viewportHeight.isFinite,
              viewportHeight > 1 else { return nil }
        return viewportHeight
    }

    /// The top flexible space must exist exactly when the min-height exists.
    static func usesTopFlexibleSpace(
        pinned: Bool,
        viewportHeight: CGFloat?
    ) -> Bool {
        viewportMinHeight(pinned: pinned, viewportHeight: viewportHeight) != nil
    }
}

/// macOS 14 fallback decision for the session-switch first-frame flash
/// (unit-tested). A fresh pinned scroll root renders its first frame at the
/// window head before the explicit bottom scroll lands (~50ms later), so on
/// macOS 14 — which has no role-scoped initial-offset anchor — the transcript
/// is covered until the current root's pinned bottom jump has been applied.
/// macOS 15+ uses `.defaultScrollAnchor(.bottom, for: .initialOffset)` instead
/// and never needs the cover (`fallbackNeeded == false`).
enum BottomSettledCover {
    /// - Parameters:
    ///   - pinned: session currently pinned to the bottom.
    ///   - settledSessionKey: bridge key of the last scroll root whose pinned
    ///     bottom scroll already landed; `nil` before the first settle.
    ///   - currentSessionKey: current scroll root's bridge key.
    ///   - fallbackNeeded: false on macOS 15+ (the role API owns the initial
    ///     offset, so the cover would be pointless).
    static func needsCover(
        pinned: Bool,
        settledSessionKey: String?,
        currentSessionKey: String,
        fallbackNeeded: Bool
    ) -> Bool {
        guard fallbackNeeded, pinned else { return false }
        return settledSessionKey != currentSessionKey
    }
}

struct ChatDetailView: View {
    @EnvironmentObject var store: AppStore
    let session: ChatSession

    var body: some View {
        // Pass subagents each render so warm session switch (no .id teardown) rebinds observation.
        ChatDetailViewBody(
            session: session,
            streaming: session.streaming,
            agentStore: session.subagents
        )
            .environmentObject(store)
    }
}

/// Detail chrome + transcript. Separate from `ChatDetailView` so `@ObservedObject agentStore`
/// always tracks the *current* session's `SubagentStore` after removing `.id(session.id)`.
private struct ChatDetailViewBody: View {
    @EnvironmentObject var store: AppStore
    @ObservedObject var session: ChatSession
    /// Passed through without observation; `TranscriptScrollView` owns the high-frequency subscription.
    let streaming: StreamingState
    /// 单独观察 subagent 树：它更新时主界面的 subagent 卡片要实时跟着动
    @ObservedObject var agentStore: SubagentStore
    @Environment(\.chatTypography) private var chatTypography

    /// Coalesce explicit/recovery jump-to-latest `scrollTo` operations. Streaming
    /// growth is followed by `StickToBottomTracker` at the AppKit clip-view layer.
    /// Transient; reset on session switch.
    @State private var scrollCoalesceScheduled = false
    @State private var scrollNeedsRetry = false
    @State private var rightPanelWidthRatio: CGFloat?
    @State private var rightPanelDragStartWidth: CGFloat?
    @State private var rightPanelDragWidth: CGFloat?
    /// Real user prompt ids whose complete assistant turn is folded.
    @State private var collapsedUserTurnIDs: Set<String> = []
    /// Top-most visible transcript row id, reported by `.scrollPosition(id:anchor:)`.
    /// It no longer drives history loading (that is the AppKit near-top edge in
    /// `StickToBottomTracker`); it only keeps the anchored row in place while a
    /// page is prepended above it.
    @State private var scrollTopID: String? = nil
    /// macOS 14 fallback: bridge key of the scroll root whose first pinned
    /// bottom scroll has already landed. `nil` until the current root settles,
    /// so a fresh root's first body hides immediately (key mismatch) without
    /// waiting for an onChange round-trip. Reset when the outer `.id` root is
    /// recreated (bridge key change) — returning to an earlier key must also
    /// re-settle. Stale async callbacks are key-guarded and can never reveal a
    /// newer session early.
    @State private var bottomSettledSessionKey: String?
    /// Hosted above the lazy transcript so row recycling cannot dismiss or corrupt it.
    @State private var finishedGroupPresentation: AssistantBlockLayout.FinishedGroupPresentation?
    @State private var runningToolDetail: RunningToolDetailPresentation?
    @StateObject private var gitBranches = GitBranchStore()

    /// Last settled chat-column width. Width changes (window resize / right panel)
    /// reflow transcript row heights; we re-pin after the width stops moving.
    @State private var settledChatColumnWidth: CGFloat?
    /// Width seen during `NSWindow.inLiveResize` — apply + re-pin only when drag ends.
    @State private var pendingChatColumnWidth: CGFloat?
    @State private var chatColumnWidthSettleWork: DispatchWorkItem?
    /// Cancels in-flight width-recovery scrolls when another width change arrives.
    @State private var widthRecoverGeneration = 0
    /// Detail column width measured inside the safe area (not via a root GeometryReader,
    /// which expands under the window toolbar and lets transcript chrome overlap the title).
    @State private var detailLayoutWidth: CGFloat = 0
    /// Visible transcript viewport height, measured at the scroll-container level
    /// (parent-driven frame, not a content proposal) and passed explicitly into the
    /// rows so pinned short transcripts get layout-level bottom gravity.
    @State private var transcriptViewportHeight: CGFloat = 0

    private let minimumChatWidth: CGFloat = 360
    private let minimumRightPanelWidth: CGFloat = 300
    private let preferredRightPanelWidth: CGFloat = 460
    private let rightPanelDividerWidth: CGFloat = 16
    /// Prefer the wide HStack branch until the first in-safe-area width arrives,
    /// so the right panel does not flash as an overlay on ordinary launches.
    private var effectiveDetailLayoutWidth: CGFloat {
        detailLayoutWidth > 1 ? detailLayoutWidth : 1000
    }

    /// macOS 14 lacks the role-scoped initial-offset anchor; the settled-key
    /// cover must hide a fresh pinned scroll root until its explicit bottom
    /// scroll lands. macOS 15+ delegates the first frame to the role API.
    private var bottomSettledFallbackNeeded: Bool {
        if #available(macOS 15.0, *) { return false }
        return true
    }

    /// macOS 14 first-frame cover for session switches: a key mismatch means the
    /// current scroll root has not yet landed at the bottom, so the transcript
    /// stays hidden (background color only) until `markBottomSettledIfCurrent`
    /// records the current key after the explicit jump. Unpinned warm-history
    /// sessions never cover and are never forced to the bottom.
    private var transcriptCoveredByBottomSettle: Bool {
        BottomSettledCover.needsCover(
            pinned: session.pinTranscriptToBottom,
            settledSessionKey: bottomSettledSessionKey,
            currentSessionKey: session.bridgeRoutingKey,
            fallbackNeeded: bottomSettledFallbackNeeded
        )
    }

    init(session: ChatSession, streaming: StreamingState, agentStore: SubagentStore) {
        self.session = session
        self.streaming = streaming
        self.agentStore = agentStore
        self._rightPanelWidthRatio = State(initialValue: LayoutPersistence.rightPanelWidthRatio())
    }

    var body: some View {
        // Root GeometryReader expands into the toolbar safe area on macOS unified
        // titlebars, so the first transcript rows paint under navigationTitle /
        // navigationSubtitle (title overlapping "N steps · …"). Measure width in
        // the background and lay out the detail body inside the safe area instead.
        adaptiveLayout(width: effectiveDetailLayoutWidth)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(nsColor: .textBackgroundColor))
            .background {
                GeometryReader { geo in
                    Color.clear.preference(
                        key: ChatDetailLayoutWidthKey.self,
                        value: geo.size.width
                    )
                }
            }
            .onPreferenceChange(ChatDetailLayoutWidthKey.self) { width in
                guard width.isFinite, width > 1 else { return }
                if abs(width - detailLayoutWidth) >= 0.5 {
                    detailLayoutWidth = width
                }
            }
            .navigationTitle(session.displayTitle)
            // Opaque toolbar band so residual underlap cannot show through the title.
            .toolbarBackground(Color(nsColor: .windowBackgroundColor), for: .windowToolbar)
            .toolbarBackground(.visible, for: .windowToolbar)
            .toolbar {
            ToolbarItem(placement: .principal) {
                SessionTitleSubtitleView(session: session)
            }
            ToolbarItemGroup(placement: .primaryAction) {
                GitBranchMenu(store: gitBranches) { session.lastError = $0 }

                if ComputerUseSettings.isEnabled() {
                    ComputerToolbarControl(sessionKey: session.bridgeRoutingKey)
                }

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
        .sheet(item: $finishedGroupPresentation) { presentation in
            FinishedNonTextGroupSheetContent(
                presentation: presentation,
                session: session,
                streaming: streaming,
                agentStore: agentStore,
                onDismiss: { finishedGroupPresentation = nil }
            )
            .dismissOnOutsideClick { finishedGroupPresentation = nil }
        }
        .sheet(item: $runningToolDetail) { presentation in
            RunningToolDetailSheetContent(
                presentation: presentation,
                streaming: streaming,
                onDismiss: { runningToolDetail = nil }
            )
            .dismissOnOutsideClick { runningToolDetail = nil }
        }
        .onAppear {
            gitBranches.bind(projectURL: session.projectURL)
        }
        .onChange(of: session.bridgeRoutingKey) { _, _ in
            // A distinct ChatSession receives a fresh bridge key. Persisted-id
            // rebinding keeps the key stable and must not dismiss an open detail.
            finishedGroupPresentation = nil
            runningToolDetail = nil
            // A fresh scroll root (outer `.id`) will re-report its top row id.
            scrollTopID = nil
            // The fresh root must re-settle before the macOS 14 cover lifts;
            // re-entering an earlier key also needs a fresh settle.
            bottomSettledSessionKey = nil
        }
        .onChange(of: session.id) { _, _ in
            // The detail chrome is reused across sessions. Reset only transient view state;
            // draft, panel selection, and pin state live on ChatSession. The top-visible
            // scroll anchor is transient view state and must reset here.
            gitBranches.bind(projectURL: session.projectURL)
            scrollCoalesceScheduled = false
            scrollNeedsRetry = false
            rightPanelDragStartWidth = nil
            rightPanelDragWidth = nil
            collapsedUserTurnIDs = []
            scrollTopID = nil
            settledChatColumnWidth = nil
            pendingChatColumnWidth = nil
            chatColumnWidthSettleWork?.cancel()
            chatColumnWidthSettleWork = nil
            widthRecoverGeneration += 1
            // draft / rightPanel / pinTranscriptToBottom remain session-owned.
        }
        .environment(\.openDocument, { url in
            // ⌘+点击聊天中的文档路径 → 右侧文档面板渲染（非文档路径仍走访达）。
            session.documents.open(url)
            session.rightPanel = .document
        })
    }

    private var chatColumn: some View {
        VStack(spacing: 0) {
            ComputerConsentBar(sessionKey: session.bridgeRoutingKey)
            transcriptContent
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
                SubagentPanel(
                    store: session.subagents,
                    projectURL: session.projectURL,
                    onAbort: { agentId in session.abortSubagent(agentId) },
                    onManualStatusCheck: { agentIDs in
                        requestManualSubagentStatusCheck(agentIDs)
                    }
                ) {
                    session.rightPanel = nil
                }
                // Same session-identity convention as the transcript root (see
                // TranscriptSessionRootIdentity): warm session switch reuses the
                // ChatDetailView chrome, so without a per-session id the panel would
                // stay bound to the previous session's SubagentStore. bridgeRoutingKey
                // is stable across persisted-id rebinding of one logical session.
                .id(session.bridgeRoutingKey)
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

    /// The scroll container remains a sibling of InputBar. Only its row subtree observes
    /// StreamingState, so 20 Hz token/tool updates do not call ComposerTextView.updateNSView.
    private var transcriptContent: some View {
        ScrollViewReader { proxy in
            ScrollView {
                StreamingTranscriptRows(
                    session: session,
                    streaming: streaming,
                    agentStore: agentStore,
                    collapsedUserTurnIDs: $collapsedUserTurnIDs,
                    viewportHeight: transcriptViewportHeight,
                    onOpenFinishedGroup: presentFinishedGroup,
                    onOpenRunningTool: presentRunningTool,
                    onReturnLatest: {
                        session.transcriptPlanner.invalidate()
                        session.pinTranscriptToBottom = true
                        jumpToLatest(proxy, retry: true)
                    },
                    onJump: { target in
                        var transaction = Transaction()
                        transaction.disablesAnimations = true
                        withTransaction(transaction) {
                            proxy.scrollTo(target, anchor: jumpAnchor)
                        }
                    }
                )
                .padding(16)
                // Pinned short transcripts must hug the bottom composer at the layout
                // level: a viewport min-height with bottom-leading alignment (plus the
                // top flexible space inside the rows) leaves no clip travel for the
                // `.top` scroll anchor to steal. Unpinned sessions get `minHeight: 0`
                // and keep the natural top-anchored layout unchanged.
                .frame(
                    maxWidth: .infinity,
                    minHeight: ShortTranscriptGravity.viewportMinHeight(
                        pinned: session.pinTranscriptToBottom,
                        viewportHeight: transcriptViewportHeight
                    ) ?? 0,
                    alignment: .bottomLeading
                )
            }
            // Same-session identity rebinds may still update session.id without
            // replacing this ScrollView. Never animate that bookkeeping change.
            .animation(nil, value: session.id)
            .scrollIndicators(.automatic)
            // Measure the transcript viewport from the scroll container's own
            // parent-driven frame. An in-content GeometryReader would be sized by
            // the content proposal, which is unstable for short transcripts;
            // bottom gravity must never depend on that.
            .background {
                GeometryReader { geo in
                    Color.clear.preference(
                        key: TranscriptViewportHeightKey.self,
                        value: geo.size.height
                    )
                }
            }
            .onPreferenceChange(TranscriptViewportHeightKey.self) { height in
                guard height.isFinite, height > 1 else { return }
                if abs(height - transcriptViewportHeight) >= 0.5 {
                    transcriptViewportHeight = height
                }
            }
            // Bottom pinning is owned by the explicit `scrollTo("bottom")` +
            // StickToBottomTracker; no default bottom anchor, which would fight
            // the user while browsing history. The `.top` anchor only reports the
            // top-visible row and keeps it in place while a page is prepended.
            .scrollPosition(id: $scrollTopID, anchor: .top)
            // macOS 15+: pin only the *initial* offset of a fresh scroll root to
            // the bottom (role-scoped — unlike the bare `.defaultScrollAnchor`,
            // it never re-applies while the user scrolls through history). Gated
            // on pin so an unpinned warm-history session keeps its natural top
            // first frame. macOS 14 has no public API for the role, so the
            // settled-key cover below hides the first frame instead.
            .modifier(InitialBottomOffsetAnchor(pinned: session.pinTranscriptToBottom))
            // macOS 14 fallback: hide a fresh pinned scroll root until the
            // explicit bottom scroll lands (~50ms), so the window head never
            // flashes before the jump. The loading veil overlay stays visible.
            .opacity(transcriptCoveredByBottomSettle ? 0 : 1)
            .overlay(alignment: .bottomTrailing) {
                if !session.pinTranscriptToBottom {
                    Button {
                        session.transcriptPlanner.invalidate()
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
                TranscriptLoadingOverlay(session: session, streaming: streaming)
            }
            .onAppear {
                jumpToLatest(proxy, retry: true)
            }
            .onChange(of: session.transcriptVersion) { _, _ in
                // Background subagent signals (heartbeat / stalled / done re-delivery)
                // must not yank the viewport: the user may still be reading a summary.
                if SubagentSignalClassifier.isBackgroundSignal(item: session.transcript.last) { return }
                jumpToLatest(proxy)
            }
            .onChange(of: session.isWorking) { _, _ in
                jumpToLatest(proxy)
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
        // Replace the entire transcript scroll hierarchy across ChatSession objects.
        .id(TranscriptSessionRootIdentity(sessionKey: session.bridgeRoutingKey))
    }

    /// Debounce chat-column width changes, then re-pin — but **never** while the window
    /// is in live resize. Mid-drag `scrollTo("bottom")` races transcript reflow and
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
    /// so transcript rows settle at the new width. Only when still pinned.
    private func recoverPinAfterColumnWidthChange(_ proxy: ScrollViewProxy) {
        guard session.pinTranscriptToBottom else { return }
        widthRecoverGeneration += 1
        let generation = widthRecoverGeneration
        let key = session.bridgeRoutingKey
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 32_000_000)
            guard generation == widthRecoverGeneration,
                  session.pinTranscriptToBottom,
                  session.bridgeRoutingKey == key else { return }
            applyJumpToLatest(proxy)
        }
    }

    /// Explicit jump to the pin edge. Normal top-down layout uses this for streaming
    /// follow, the jump button, initial session binding, and width recovery.
    private func jumpToLatest(_ proxy: ScrollViewProxy, retry: Bool = false) {
        guard session.pinTranscriptToBottom else { return }
        if retry { scrollNeedsRetry = true }
        guard !scrollCoalesceScheduled else { return }
        scrollCoalesceScheduled = true
        // Stale guards: the scroll root is recreated per bridge key, so a jump
        // scheduled for an earlier session must never scroll (or settle) a newer
        // session's root.
        let key = session.bridgeRoutingKey
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            scrollCoalesceScheduled = false
            let needsRetry = scrollNeedsRetry
            scrollNeedsRetry = false
            guard session.pinTranscriptToBottom, session.bridgeRoutingKey == key else { return }
            applyJumpToLatest(proxy)
            if needsRetry {
                for delay in [0.05, 0.2] as [TimeInterval] {
                    DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                        guard session.pinTranscriptToBottom, session.bridgeRoutingKey == key else { return }
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
            proxy.scrollTo(transcriptID("bottom"), anchor: .bottom)
        }
        markBottomSettledIfCurrent()
    }

    /// Records the current scroll root as bottom-settled on the next main runloop
    /// so the macOS 14 cover lifts only after `scrollTo` has been applied, not in
    /// the same frame it was scheduled. Key-guarded: a stale callback from a
    /// previous session must never settle (and thus reveal) a newer session's
    /// cover. Disables implicit animation on the reveal.
    private func markBottomSettledIfCurrent() {
        let key = session.bridgeRoutingKey
        DispatchQueue.main.async {
            guard self.session.bridgeRoutingKey == key else { return }
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                self.bottomSettledSessionKey = key
            }
        }
    }

    private func transcriptID(_ localID: String) -> String {
        TranscriptRenderIdentity.scoped(
            sessionKey: session.bridgeRoutingKey,
            localID: localID
        )
    }

    /// User-clicked UI fallback for a potentially unavailable automatic status channel.
    /// This is deliberately a normal prompt, not a direct process probe from the UI.
    private func requestManualSubagentStatusCheck(_ agentIDs: [String]) {
        guard !agentIDs.isEmpty else { return }
        session.sendPrompt(SubagentStatusCheckPrompt.make(agentIDs: agentIDs))
    }

    private func presentFinishedGroup(
        _ presentation: AssistantBlockLayout.FinishedGroupPresentation
    ) {
        guard presentation.belongs(to: session.bridgeRoutingKey) else { return }
        finishedGroupPresentation = presentation
    }

    private func presentRunningTool(_ presentation: RunningToolDetailPresentation) {
        runningToolDetail = presentation
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
            if session.lastErrorCanRetry {
                Button("重试") { session.retryLastRequest() }
                    .buttonStyle(HoverButtonStyle(base: .secondary, hovered: .primary))
            }
            Button("关闭") { session.lastError = nil }
                .buttonStyle(HoverButtonStyle(base: .secondary, hovered: .primary))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(Color.orange.opacity(0.1))
    }
}

/// Keeps finished-group tool/subagent cards live without widening the detail chrome's
/// StreamingState subscription domain.
private struct FinishedNonTextGroupSheetContent: View {
    let presentation: AssistantBlockLayout.FinishedGroupPresentation
    @ObservedObject var session: ChatSession
    @ObservedObject var streaming: StreamingState
    @ObservedObject var agentStore: SubagentStore
    let onDismiss: () -> Void

    var body: some View {
        let callIDs = AssistantBlockLayout.toolCallIds(in: presentation.blocks)
        FinishedNonTextGroupDetailView(
            presentation: presentation,
            toolRuns: runs(forToolCallIDs: callIDs),
            subagents: agentStore.agents(forToolCallIds: callIDs),
            projectURL: session.projectURL,
            onFlash: { session.flash($0) },
            onSelectAgent: { agentID in
                onDismiss()
                session.subagents.selectedId = agentID
                session.rightPanel = .agents
            }
        )
    }

    private func runs(forToolCallIDs ids: Set<String>) -> [String: ToolRun] {
        var result: [String: ToolRun] = [:]
        for id in ids {
            if let run = streaming.toolRuns[id] { result[id] = run }
        }
        return result
    }
}

/// Live tool detail sheet; observes StreamingState so partial output keeps flowing.
private struct RunningToolDetailSheetContent: View {
    let presentation: RunningToolDetailPresentation
    @ObservedObject var streaming: StreamingState
    let onDismiss: () -> Void

    var body: some View {
        RunningToolDetailView(
            call: presentation.call,
            run: streaming.toolRuns[presentation.id],
            onDismiss: onDismiss
        )
    }
}

/// The only transcript subtree that subscribes to high-frequency stream/tool updates.
/// Its parent scroll container and the sibling InputBar receive no StreamingState invalidations.
private struct StreamingTranscriptRows: View {
    @ObservedObject var session: ChatSession
    @ObservedObject var streaming: StreamingState
    @ObservedObject var agentStore: SubagentStore
    @Binding var collapsedUserTurnIDs: Set<String>
    /// Transcript viewport height measured at the scroll-container level by the
    /// parent. Drives the pinned short-content bottom gravity.
    let viewportHeight: CGFloat
    let onOpenFinishedGroup: (AssistantBlockLayout.FinishedGroupPresentation) -> Void
    let onOpenRunningTool: (RunningToolDetailPresentation) -> Void
    let onReturnLatest: () -> Void
    let onJump: (String) -> Void
    @Environment(\.chatTypography) private var chatTypography
    /// History head while unpinned: the oldest rendered page, or `nil` for the
    /// default latest two pages (pinned/live or not yet browsed). Only ever
    /// decreases via one-page prepends; the newest end is never deleted, so a
    /// geometry trigger cannot shrink the window and feed back into itself.
    @State private var transcriptOldestLoadedPage: Int?

    var body: some View {
        let items = session.transcript
        // Pinned/live mode always renders the latest two pages and ignores scroll
        // reports. Unpinned history browsing prepends one page at a time at the old
        // end (`transcriptOldestLoadedPage`); the newest end always stays at the
        // last item, so the window only grows and can never oscillate.
        let window = TranscriptRenderWindow.resolve(
            itemCount: items.count,
            oldestLoadedPage: session.pinTranscriptToBottom ? nil : transcriptOldestLoadedPage
        )
        let windowItems = Array(items[window.range])
        // History pages were prepended; the window end still includes the newest item.
        let browsingHistory = !session.pinTranscriptToBottom && transcriptOldestLoadedPage != nil
        // History-top loading gate for the AppKit near-top edge: unpinned and
        // older pages still exist. True even before the first prepend, so the
        // very first scroll to the top starts history loading.
        let effectiveStartPage = transcriptOldestLoadedPage
            ?? TranscriptRenderWindow.latestStartPage(itemCount: items.count)
        let topLoadingEnabled = !session.pinTranscriptToBottom && effectiveStartPage > 0
        let presentation = session.transcriptPlanner.presentation(
            items: windowItems,
            toolRuns: streaming.toolRuns,
            visibleCount: windowItems.count,
            transcriptVersion: session.transcriptVersion,
            toolStructureVersion: streaming.toolStructureVersion
        )
        let userTurnGroups = presentation.userTurnGroups
        let runningSubagentToolCallIds = Set(
            agentStore.agents.lazy
                .filter { $0.state == .running }
                .compactMap { $0.toolCallId }
        )
        // Ordinary in-flight tool calls also keep their user turn expanded.
        let runningOrdinaryToolCallIds = Set(
            streaming.toolRuns.lazy
                .filter { $0.value.isRunning }
                .map(\.key)
        )
        let runningGuardedGroupIDs = UserTurnCollapseGuard.runningGuardedGroupIDs(
            groupIDForToolCallID: presentation.groupIDForToolCallID,
            runningSubagentToolCallIds: runningSubagentToolCallIds.union(runningOrdinaryToolCallIds)
        )

        // Intentionally eager but bounded to at most 4 fixed pages. The sliding
        // window swaps only boundary pages; rows keep stable ids so SwiftUI diffs
        // incrementally instead of rebuilding the stack (never lazy).
        VStack(alignment: .leading, spacing: chatTypography.messageSpacing) {
            // Pinned-to-bottom sessions get a top flexible space: with the parent's
            // viewport min-height this is layout-level bottom gravity for short
            // transcripts, so fold/unfold height changes cannot bounce the block
            // between viewport top and bottom. Unpinned sessions never get it.
            if ShortTranscriptGravity.usesTopFlexibleSpace(
                pinned: session.pinTranscriptToBottom,
                viewportHeight: viewportHeight
            ) {
                Spacer(minLength: 0)
            }
            if window.range.lowerBound == 0, session.isInitializing {
                HStack(spacing: 6) {
                    ProgressView()
                        .controlSize(.small)
                    Text("正在刷新…")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                }
                .padding(.vertical, 2)
                .transition(.opacity)
            }

            ForEach(presentation.rows, id: \.id) { row in
                switch row {
                case .leaf(let item):
                    let groupID = userTurnGroups.groupIDForRowID[item.id]
                    let isInternalSignal = groupID != nil
                        && !presentation.userAuthoredLeafIDs.contains(item.id)
                    let isFoldedSignal = isInternalSignal
                        && isUserTurnCollapsed(groupID, guarded: runningGuardedGroupIDs)
                    if !isFoldedSignal {
                        MessageRow(
                            item: item,
                            toolRuns: runs(forToolCallIds:
                                presentation.toolCallIDsForRowID[item.id] ?? []),
                            subagents: subagents(forToolCallIds:
                                presentation.toolCallIDsForRowID[item.id] ?? []),
                            projectURL: session.projectURL,
                            chatFontSize: chatTypography.fontSize,
                            sessionKey: session.bridgeRoutingKey,
                            presentationScopeID: transcriptID(item.id),
                            isWorking: session.isWorking,
                            isEditing: session.editingItemId == item.id,
                            onFlash: { session.flash($0) },
                            onSelectAgent: selectAgent,
                            onOpenFinishedGroup: onOpenFinishedGroup,
                            onOpenRunningTool: onOpenRunningTool,
                            onCopy: { session.copyItemText(item) },
                            onResend: { session.resendUserMessage(itemId: item.id) },
                            onBeginEdit: { session.beginEditingUserMessage(itemId: item.id) },
                            onCancelEdit: { session.cancelEditingUserMessage() },
                            onCommitEdit: { session.commitEditingUserMessage(newText: $0) }
                        )
                        .equatable()
                        .id(transcriptID(item.id))
                    }
                case .assistantRun(let id, let entryId, let segments):
                    let groupID = userTurnGroups.groupIDForRowID[id]
                    let isFolded = isUserTurnCollapsed(groupID, guarded: runningGuardedGroupIDs)
                    let isGroupLastAssistant = groupID.flatMap {
                        userTurnGroups.lastAssistantRunIDForGroupID[$0]
                    } == id
                    if !isFolded || isGroupLastAssistant {
                        let callIds = presentation.toolCallIDsForRowID[id] ?? []
                        AssistantSegmentsView(
                            segments: segments,
                            toolRuns: runs(forToolCallIds: callIds),
                            subagents: subagents(forToolCallIds: callIds),
                            projectURL: session.projectURL,
                            onFlash: { session.flash($0) },
                            onSelectAgent: selectAgent,
                            sessionKey: session.bridgeRoutingKey,
                            presentationScopeID: transcriptID(id),
                            onOpenFinishedGroup: onOpenFinishedGroup,
                            onOpenRunningTool: onOpenRunningTool,
                            entryId: entryId,
                            isWorking: session.isWorking,
                            completionText: !browsingHistory && id == presentation.lastAssistantRunID
                                ? session.turnCompletionText : nil,
                            onCopy: { session.copySegmentsText(segments) },
                            onBranch: {
                                guard let entryId else { return }
                                session.branchFromAssistant(runLastEntryId: entryId)
                            },
                            onJump: {
                                onJump(transcriptID(
                                    presentation.jumpTargetForAssistantRunID[id] ?? id
                                ))
                            },
                            collapsedOverride: isFolded,
                            onCollapseToggle: {
                                guard let groupID else { return }
                                if collapsedUserTurnIDs.contains(groupID) {
                                    collapsedUserTurnIDs.remove(groupID)
                                } else {
                                    collapsedUserTurnIDs.insert(groupID)
                                }
                            }
                        )
                        .equatable()
                        .id(transcriptID(id))
                    }
                }
            }

            if !browsingHistory,
               let streamingItem = streaming.streamingItem,
               hasVisibleContent(streamingItem) {
                MessageRow(
                    item: streamingItem,
                    toolRuns: runs(for: streamingItem),
                    subagents: subagents(for: streamingItem),
                    isStreaming: session.isStreaming,
                    projectURL: session.projectURL,
                    chatFontSize: chatTypography.fontSize,
                    sessionKey: session.bridgeRoutingKey,
                    presentationScopeID: transcriptID("streaming"),
                    isWorking: session.isWorking,
                    onFlash: { session.flash($0) },
                    onSelectAgent: selectAgent,
                    onOpenFinishedGroup: onOpenFinishedGroup,
                    onOpenRunningTool: onOpenRunningTool,
                    onCopy: {
                        session.copySegmentsText(
                            AssistantBlockLayout.plan(
                                blocks: streamingItem.blocks,
                                groupFinished: !session.isStreaming
                            )
                        )
                    },
                    onBranch: {
                        guard let entryId = streamingItem.entryId else { return }
                        session.branchFromAssistant(runLastEntryId: entryId)
                    }
                )
                .equatable()
                .id(transcriptID("streaming"))
                if let startedAt = session.turnWallClockStartedAt {
                    TurnElapsedText(startedAt: startedAt)
                        .id(transcriptID("streaming-turn-elapsed"))
                }
            } else if !browsingHistory && (session.isWorking || session.mediaBusy) {
                WaitingPlaceholderView(
                    message: session.mediaBusy
                        ? (session.mediaStatus ?? "正在处理…")
                        : (session.isStopping ? "正在停止…" : "AI 正在思考…"),
                    turnStartedAt: session.turnWallClockStartedAt
                )
                .id(transcriptID("waiting-placeholder"))
            }

            if browsingHistory {
                HStack(spacing: 16) {
                    Spacer(minLength: 0)

                    Button("返回最新消息") {
                        session.transcriptPlanner.invalidate()
                        onReturnLatest()
                    }
                    .buttonStyle(.link)
                }
            }

            Color.clear
                .frame(height: 1)
                .id(transcriptID("bottom"))
                .background {
                    // Always mounted: it owns the "scrolled back near the bottom →
                    // re-pin" decision and the near-top history-prepend edge.
                    StickToBottomTracker(
                        isPinned: $session.pinTranscriptToBottom,
                        pinEdge: .documentEnd,
                        topLoadingEnabled: topLoadingEnabled,
                        onNearTop: requestHistoryPrepend
                    )
                }
        }
        // No window-replacement identity: the container must stay alive across
        // window prepends so `.scrollPosition` can anchor the top-visible row.
        // History loading no longer reads row ids: the AppKit near-top edge in
        // `StickToBottomTracker` fires `requestHistoryPrepend`.
        .onChange(of: session.pinTranscriptToBottom) { _, newValue in
            if newValue {
                // Explicit transition: history browsing ends (jump-to-latest button
                // or scrolled back near the bottom). Drop back to the latest two
                // pages; the viewport is already bottom-pinned by the explicit
                // scroll / StickToBottomTracker, so deleting above is safe.
                transcriptOldestLoadedPage = nil
                session.transcriptPlanner.invalidate()
            }
        }
        .onChange(of: session.id) { _, _ in
            transcriptOldestLoadedPage = nil
            session.transcriptPlanner.invalidate()
        }
        .onChange(of: session.bridgeRoutingKey) { _, _ in
            transcriptOldestLoadedPage = nil
        }
    }

    /// Prepends exactly one older page when the user reaches the document top —
    /// and only while unpinned. Called by `StickToBottomTracker`'s near-top edge
    /// (AppKit clip geometry), never from row ids, so it fires regardless of which
    /// row sits at the viewport top (or whether the 16pt padding leaves the anchor
    /// id nil). The document top is the oldest loaded page, so the pure prepender
    /// gets `visiblePage == startPage`: one page per edge, stops at page 0, and
    /// the newest end is never deleted.
    private func requestHistoryPrepend() {
        guard !session.pinTranscriptToBottom else { return }
        let items = session.transcript
        let startPage = transcriptOldestLoadedPage
            ?? TranscriptRenderWindow.latestStartPage(itemCount: items.count)
        guard let newStart = TranscriptHistoryPrepender.prepend(
            currentStartPage: startPage,
            visiblePage: startPage
        ) else { return }
        transcriptOldestLoadedPage = newStart
        session.transcriptPlanner.invalidate()
    }

    private func transcriptID(_ localID: String) -> String {
        TranscriptRenderIdentity.scoped(sessionKey: session.bridgeRoutingKey, localID: localID)
    }

    private func isUserTurnCollapsed(_ groupID: String?, guarded: Set<String>) -> Bool {
        UserTurnCollapseGuard.isCollapsed(
            groupID: groupID,
            collapsedUserTurnIDs: collapsedUserTurnIDs,
            guardedGroupIDs: guarded
        )
    }

    /// The live item is one small row, so deriving its changing call ids here is cheap;
    /// settled rows use the planner's cached `toolCallIDsForRowID` map above.
    private func runs(for item: ChatItem) -> [String: ToolRun] {
        runs(forToolCallIds: Set(item.blocks.compactMap { block in
            if case .toolCall(let call) = block { return call.id }
            return nil
        }))
    }

    private func subagents(for item: ChatItem) -> [SubagentInfo] {
        subagents(forToolCallIds: Set(item.blocks.compactMap { block in
            if case .toolCall(let call) = block, call.name == "subagent" { return call.id }
            return nil
        }))
    }

    private func runs(forToolCallIds ids: Set<String>) -> [String: ToolRun] {
        var result: [String: ToolRun] = [:]
        for id in ids {
            if let run = streaming.toolRuns[id] { result[id] = run }
        }
        return result
    }

    private func subagents(forToolCallIds callIds: Set<String>) -> [SubagentInfo] {
        agentStore.agents(forToolCallIds: callIds)
    }

    private func selectAgent(_ id: String) {
        session.subagents.selectedId = id
        session.rightPanel = .agents
    }

    private func hasVisibleContent(_ item: ChatItem) -> Bool {
        for block in item.blocks {
            switch block {
            case .text(let text), .thinking(let text):
                if !text.isEmpty { return true }
            case .toolCall, .image, .video:
                return true
            }
        }
        return false
    }
}

/// StreamingState also controls whether the initial loading veil is visible, so keep
/// that narrow observation local to the transcript rather than its InputBar sibling.
private struct TranscriptLoadingOverlay: View {
    @ObservedObject var session: ChatSession
    @ObservedObject var streaming: StreamingState

    var body: some View {
        ZStack {
            if session.isInitializing && streaming.streamingItem == nil {
                SessionLoadingView()
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: session.isInitializing)
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

/// macOS 15+ role-scoped initial-offset bottom anchor. Unlike the bare,
/// role-less default bottom anchor — which re-applies while the user scrolls
/// through history and fights the wheel — `.bottom for .initialOffset` only
/// pins the very first frame of a fresh scroll root. macOS 14 has no public
/// API for the role, so the fallback cover (`BottomSettledCover`) hides the
/// transcript until the explicit pinned scroll lands. Gated on the pin state:
/// an unpinned warm-history session keeps its natural top first frame.
private struct InitialBottomOffsetAnchor: ViewModifier {
    let pinned: Bool

    func body(content: Content) -> some View {
        if #available(macOS 15.0, *), pinned {
            content.defaultScrollAnchor(.bottom, for: .initialOffset)
        } else {
            content
        }
    }
}

/// Visible transcript viewport height (the scroll container's parent-driven
/// frame). Fed to `ShortTranscriptGravity` for pinned bottom alignment.
private struct TranscriptViewportHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

/// Chat column width (transcript + input). Used to re-pin after width settle.
private struct ChatColumnWidthKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

/// Full detail-column width (chat + optional right panel), measured in-safe-area.
private struct ChatDetailLayoutWidthKey: PreferenceKey {
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
    ///   and the viewport lands mid-history after transcript row heights reflow.
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

    /// Distance from the document start (oldest content) in document coordinates.
    /// The normal flipped transcript starts at y=0 and the visible rect's minY
    /// grows as the user scrolls down; non-flipped documents start at the
    /// maximum y, so the distance is `contentHeight - visible.maxY`. At the
    /// document top the distance is 0 and it grows with scroll.
    static func distanceFromDocumentStart(
        visible: CGRect,
        contentHeight: CGFloat,
        documentIsFlipped: Bool
    ) -> CGFloat {
        if documentIsFlipped {
            return visible.minY
        }
        return contentHeight - visible.maxY
    }

    /// Clip-view origin that places the requested document edge at the viewport edge.
    /// Keeping this geometry pure makes AppKit content-growth following testable.
    static func pinnedOriginY(
        contentHeight: CGFloat,
        visibleHeight: CGFloat,
        documentIsFlipped: Bool,
        pinEdge: StickPinEdge
    ) -> CGFloat {
        let maximumOrigin = max(0, contentHeight - visibleHeight)
        switch pinEdge {
        case .documentEnd:
            return documentIsFlipped ? maximumOrigin : 0
        case .documentStart:
            return documentIsFlipped ? 0 : maximumOrigin
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

/// Pure edge state machine for the near-top history trigger (unit-tested).
///
/// The transcript's `StickToBottomTracker` feeds every clip/document geometry
/// change into `step`. A prepend grows the document upward, so the distance from
/// the document start can never be used as a level trigger — the *edge* is: fire
/// exactly once when the viewport enters the top band, never again while it stays
/// inside, and only after it has left the band may the next entry fire again.
/// Disabled (pinned, or no older page left) resets the state and never fires.
enum TranscriptNearTopTrigger {
    /// Viewport is "near the document top" when within this many points of the
    /// document start. Tolerates the transcript's 16pt padding plus slack; never
    /// requires an exact 0.
    static let nearTopThreshold: CGFloat = 96

    struct State: Equatable {
        var isNearTop = false
    }

    /// - Parameters:
    ///   - state: persistent edge state, owned by the coordinator (never written
    ///     into SwiftUI state).
    ///   - distanceFromDocumentStart: `StickToBottomLogic.distanceFromDocumentStart`.
    ///   - enabled: false while pinned or when the effective start page is 0.
    ///   - threshold: top band size; defaults to `nearTopThreshold`.
    /// - Returns: `true` exactly once per `false → true` near-top edge while enabled.
    static func step(
        state: inout State,
        distanceFromDocumentStart: CGFloat,
        enabled: Bool,
        threshold: CGFloat = nearTopThreshold
    ) -> Bool {
        guard enabled else {
            state.isNearTop = false
            return false
        }
        let isNear = distanceFromDocumentStart <= threshold
        defer { state.isNearTop = isNear }
        return isNear && !state.isNearTop
    }
}

/// 挂到 ScrollView 贴底锚点：用户手势更新 pin 状态；内容增高时，如果仍
/// pinned，直接移动 AppKit clip view。这样流式增长不再触发 SwiftUI scrollTo，
/// 也不会把新的状态写回动态高度布局图。同一定位还承担历史顶部加载：通过
/// clip/document 几何边沿触发 `onNearTop`（见 `TranscriptNearTopTrigger`）。
struct StickToBottomTracker: NSViewRepresentable {
    @Binding var isPinned: Bool
    var threshold: CGFloat = StickToBottomLogic.rePinThreshold
    var pinEdge: StickPinEdge = .documentEnd
    /// History-top loading gate: `true` while unpinned and the effective window
    /// start page is above 0. While false the near-top edge state is reset and
    /// `onNearTop` never fires.
    var topLoadingEnabled: Bool = false
    /// Fired exactly once per false→true near-top edge while `topLoadingEnabled`.
    var onNearTop: (() -> Void)? = nil

    func makeCoordinator() -> Coordinator {
        Coordinator(
            isPinned: $isPinned,
            threshold: threshold,
            pinEdge: pinEdge,
            topLoadingEnabled: topLoadingEnabled,
            onNearTop: onNearTop
        )
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
        // Refresh the history-top gate and callback on every body pass so a
        // session rebind/switch can never leave a stale closure behind.
        let loadingGateChanged = context.coordinator.topLoadingEnabled != topLoadingEnabled
        context.coordinator.topLoadingEnabled = topLoadingEnabled
        context.coordinator.onNearTop = onNearTop
        // Do not re-attach on every SwiftUI body pass — only when not yet wired.
        context.coordinator.ensureAttached(from: nsView)
        // The gate just flipped (e.g. the user unpinned while already at the
        // document top, or re-pinned): re-evaluate the near-top edge once with
        // the current geometry so the first prepend does not depend on another
        // scroll event arriving.
        if loadingGateChanged {
            context.coordinator.scheduleNearTopEvaluation()
        }
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
        /// History-top loading gate, refreshed by `updateNSView` each body pass.
        var topLoadingEnabled: Bool
        /// Near-top edge callback, refreshed by `updateNSView` each body pass so a
        /// rebind can never fire a stale session's closure.
        var onNearTop: (() -> Void)?
        private weak var scrollView: NSScrollView?
        /// Exposed so `updateNSView` can re-apply overlay style after SwiftUI resets it.
        var attachedScrollView: NSScrollView? { scrollView }
        private var liveScrollObs: NSObjectProtocol?
        private var endScrollObs: NSObjectProtocol?
        private var boundsObs: NSObjectProtocol?
        private var documentFrameObs: NSObjectProtocol?
        private var documentBoundsObs: NSObjectProtocol?
        private var attachAttempts = 0
        private var pinWriteScheduled = false
        private var pendingPinValue: Bool?
        /// Clip bounds changes arrive for every scroller-knob movement. Process at
        /// most one attributed drag update per main-loop turn so the pin state
        /// machine cannot feed SwiftUI layout back into the drag continuously.
        private var knobDragUpdateScheduled = false
        /// Content can publish more than one frame/bounds notification per layout
        /// pass. Follow at most once per main-loop turn and never mutate SwiftUI.
        private var contentFollowScheduled = false
        /// Near-top evaluation is coalesced the same way: one edge-state entry per
        /// main-loop turn keeps a prepend-triggered layout pass from cascading.
        private var nearTopEvaluationScheduled = false
        /// Edge state owned by the coordinator; scroll positions never enter SwiftUI.
        private var nearTopState = TranscriptNearTopTrigger.State()
        /// Invalidates a queued bounds update if this coordinator is detached and
        /// later attached to another scroll view before the next main-loop turn.
        private var boundsUpdateGeneration = 0

        init(
            isPinned: Binding<Bool>,
            threshold: CGFloat,
            pinEdge: StickPinEdge,
            topLoadingEnabled: Bool,
            onNearTop: (() -> Void)?
        ) {
            self.isPinned = isPinned
            self.threshold = threshold
            self.pinEdge = pinEdge
            self.topLoadingEnabled = topLoadingEnabled
            self.onNearTop = onNearTop
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
                    self?.scheduleNearTopEvaluation()
                }
                endScrollObs = center.addObserver(
                    forName: NSScrollView.didEndLiveScrollNotification,
                    object: sv,
                    queue: .main
                ) { [weak self] _ in
                    guard self?.scrollView?.window?.inLiveResize != true else { return }
                    self?.updatePinFromUserScroll(userLiveScroll: true)
                    self?.scheduleNearTopEvaluation()
                }
                // Catches scroller-knob drags, which post no live-scroll notification.
                let clip = sv.contentView
                clip.postsBoundsChangedNotifications = true
                boundsObs = center.addObserver(
                    forName: NSView.boundsDidChangeNotification,
                    object: clip,
                    queue: .main
                ) { [weak self] _ in
                    guard let self else { return }
                    // Near-top evaluation is geometry-based and origin-agnostic:
                    // programmatic anchoring after a prepend must also re-arm it.
                    self.scheduleNearTopEvaluation()
                    let inLiveResize = self.scrollView?.window?.inLiveResize == true
                    let origin = ScrollOrigin.classify(
                        mouseButtonsDown: Int(NSEvent.pressedMouseButtons),
                        windowInLiveResize: inLiveResize
                    )
                    guard origin.allowsUnpin else { return }
                    // A clip movement with a held mouse button (outside a live
                    // window resize) is a scroller-knob drag. Unlike the old
                    // conservative path, mark it as a live user scroll so a move
                    // farther than 4pt releases the pin before streaming/reflow
                    // can pull the thumb back. Bounds notifications are high
                    // frequency, so coalesce them to one state-machine entry per
                    // runloop.
                    self.scheduleKnobDragPinUpdate()
                }
                if let document = sv.documentView {
                    document.postsFrameChangedNotifications = true
                    document.postsBoundsChangedNotifications = true
                    documentFrameObs = center.addObserver(
                        forName: NSView.frameDidChangeNotification,
                        object: document,
                        queue: .main
                    ) { [weak self] _ in
                        self?.schedulePinnedContentFollow()
                        self?.scheduleNearTopEvaluation()
                    }
                    documentBoundsObs = center.addObserver(
                        forName: NSView.boundsDidChangeNotification,
                        object: document,
                        queue: .main
                    ) { [weak self] _ in
                        self?.schedulePinnedContentFollow()
                        self?.scheduleNearTopEvaluation()
                    }
                }
                // 安装时只允许「确认在底部 → pin」，避免布局未完成时误 unpin
                updatePinFromUserScroll(allowUnpin: false)
                // Seed the near-top edge with the current geometry; later
                // frame/bounds notifications re-evaluate it continuously.
                scheduleNearTopEvaluation()
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
            if let documentFrameObs { center.removeObserver(documentFrameObs) }
            if let documentBoundsObs { center.removeObserver(documentBoundsObs) }
            liveScrollObs = nil
            endScrollObs = nil
            boundsObs = nil
            documentFrameObs = nil
            documentBoundsObs = nil
            scrollView = nil
            pinWriteScheduled = false
            pendingPinValue = nil
            knobDragUpdateScheduled = false
            contentFollowScheduled = false
            nearTopEvaluationScheduled = false
            boundsUpdateGeneration += 1
        }

        private func schedulePinnedContentFollow() {
            guard isPinned.wrappedValue, !contentFollowScheduled else { return }
            contentFollowScheduled = true
            let generation = boundsUpdateGeneration
            DispatchQueue.main.async { [weak self] in
                guard let self, self.boundsUpdateGeneration == generation else { return }
                self.contentFollowScheduled = false
                self.followPinnedContentGrowth()
            }
        }

        /// Near-top evaluation is coalesced to one entry per main-loop turn like
        /// the knob-drag path: geometry notifications are high frequency, and the
        /// prepend it may trigger mutates SwiftUI state. Internal so `updateNSView`
        /// can force a re-evaluation when the loading gate flips.
        func scheduleNearTopEvaluation() {
            guard !nearTopEvaluationScheduled else { return }
            nearTopEvaluationScheduled = true
            let generation = boundsUpdateGeneration
            DispatchQueue.main.async { [weak self] in
                guard let self, self.boundsUpdateGeneration == generation else { return }
                self.nearTopEvaluationScheduled = false
                self.evaluateNearTop()
            }
        }

        /// Feeds the current clip/document geometry into the near-top edge state
        /// machine. Fires `onNearTop` exactly once per false→true edge while
        /// `topLoadingEnabled`. A prepend grows the document, so the distance from
        /// the document start grows past the threshold and the edge re-arms — one
        /// layout pass can never cascade into multiple prepends.
        private func evaluateNearTop() {
            guard let sv = scrollView, let doc = sv.documentView else { return }
            let distance = StickToBottomLogic.distanceFromDocumentStart(
                visible: sv.documentVisibleRect,
                contentHeight: doc.bounds.height,
                documentIsFlipped: doc.isFlipped
            )
            if TranscriptNearTopTrigger.step(
                state: &nearTopState,
                distanceFromDocumentStart: distance,
                enabled: topLoadingEnabled
            ) {
                onNearTop?()
            }
        }

        private func followPinnedContentGrowth() {
            guard isPinned.wrappedValue,
                  let scrollView,
                  let document = scrollView.documentView else { return }
            let clip = scrollView.contentView
            let targetY = StickToBottomLogic.pinnedOriginY(
                contentHeight: document.bounds.height,
                visibleHeight: clip.bounds.height,
                documentIsFlipped: document.isFlipped,
                pinEdge: pinEdge
            )
            guard abs(clip.bounds.origin.y - targetY) > 0.5 else { return }
            clip.scroll(to: NSPoint(x: clip.bounds.origin.x, y: targetY))
            scrollView.reflectScrolledClipView(clip)
        }

        private func scheduleKnobDragPinUpdate() {
            guard !knobDragUpdateScheduled else { return }
            knobDragUpdateScheduled = true
            let generation = boundsUpdateGeneration
            DispatchQueue.main.async { [weak self] in
                guard let self, self.boundsUpdateGeneration == generation else { return }
                self.knobDragUpdateScheduled = false
                self.updatePinFromUserScroll(userLiveScroll: true)
            }
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

/// Custom principal titlebar stack. `.navigationTitle` still sets the window
/// title; the subtitle is the first real user message — one line, `…`-truncated,
/// clickable to reveal the full text in a popover — or the project basename when
/// the transcript has no user message yet.
private struct SessionTitleSubtitleView: View {
    @ObservedObject var session: ChatSession
    @State private var showsFullMessage = false

    var body: some View {
        VStack(spacing: 1) {
            Text(session.displayTitle)
                .font(.system(size: 13))
            if let fullMessage = SessionSubtitleLogic.firstUserMessageText(from: session.transcript) {
                Button {
                    showsFullMessage = true
                } label: {
                    Text(SessionSubtitleLogic.oneLine(fullMessage))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                .buttonStyle(.plain)
                .onHover { hovering in
                    if hovering { NSCursor.pointingHand.push() } else { NSCursor.pop() }
                }
                .popover(isPresented: $showsFullMessage, arrowEdge: .bottom) {
                    ScrollView {
                        Text(fullMessage)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                    }
                    .frame(width: 420, height: 260)
                }
                .help("查看完整消息")
            } else {
                Text(session.projectURL.lastPathComponent)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }
}
