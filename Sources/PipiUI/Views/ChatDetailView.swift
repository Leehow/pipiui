import SwiftUI
import AppKit

// The ScrollView is inverted: layout top is the visual bottom. A row target must
// align its layout bottom with the viewport's layout bottom to read at visual top.
private let jumpAnchor: UnitPoint = .bottom

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
/// A small eager latest window (up to four 32-row pages) gives native
/// NSTextView-backed markdown enough room to settle its exact height without
/// reintroducing lazy-stack height estimation. History browsing moves one older
/// page at a time, while the eager stack remains hard-capped at `maxPages` so
/// continuous top-prefetch can never mount the entire session. `nil` is the
/// pinned/live latest warm window; a concrete head selects a bounded history
/// window. Newest-first presentation reverses this storage slice.
struct TranscriptRenderWindow: Equatable {
    static let pageSize = 32
    /// Hard ceiling on eagerly mounted pages (32 × 4 = 128 rows). Mirrors the
    /// subagent log's bounded window so long sessions stay scrollable without
    /// growing the inverted VStack without bound.
    static let maxPages = 4

    let range: Range<Int>
    let totalCount: Int

    /// `true` when the window still includes the newest transcript item.
    var isLatest: Bool { range.upperBound == totalCount }
    var renderedCount: Int { range.count }

    /// Index of the newest page (`p`); 0 for an empty transcript.
    static func latestPage(itemCount: Int) -> Int {
        let count = max(0, itemCount)
        return max(0, (count + pageSize - 1) / pageSize - 1)
    }

    /// Default (pinned / freshly reset) window start: enough pages to warm the
    /// latest bounded window. History moves one older page per admitted request.
    static func latestStartPage(itemCount: Int) -> Int {
        max(0, latestPage(itemCount: itemCount) - (maxPages - 1))
    }

    /// Window from `oldestLoadedPage` (history head), spanning at most `maxPages`.
    /// `nil` and out-of-range values resolve to the latest warm window, so a stale
    /// head (transcript reload / session switch) can never render invalid items.
    /// A history head slides the bounded window toward older pages.
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
        let end = min(count, start + maxPages * pageSize)
        return Self(range: start..<end, totalCount: count)
    }
}

/// One-step expansion decision for history browsing. Pure and unit-tested:
/// the history prefetch edge may only pull **one** older page in per admitted
/// request (decrement the head). Capping / sliding the newest end is owned by
/// `TranscriptRenderWindow.resolve`, not by this expander.
enum TranscriptHistoryExpander {
    /// - Returns: the new oldest loaded page (`currentStartPage - 1`) when an
    ///   older page exists; `nil` when already at page 0.
    static func expand(currentStartPage: Int) -> Int? {
        guard currentStartPage > 0 else { return nil }
        return currentStartPage - 1
    }
}

/// One-page asynchronous history-load state. `begin` is the single admission
/// point: while a page is in flight, repeated AppKit geometry notifications are
/// rejected; page zero is terminal until the session/window is reset.
enum TranscriptHistoryPager {
    enum State: Equatable {
        case idle
        case loading(targetPage: Int)
        case exhausted
    }

    static func begin(currentStartPage: Int, state: inout State) -> Int? {
        guard state == .idle,
              let targetPage = TranscriptHistoryExpander.expand(
                currentStartPage: currentStartPage
              ) else { return nil }
        state = .loading(targetPage: targetPage)
        return targetPage
    }

    static func complete(loadedPage: Int) -> State {
        loadedPage == 0 ? .exhausted : .idle
    }

    /// Drop in-flight loading so a late ~60ms reveal cannot apply after seek,
    /// return-to-latest, user takeover, or session switch. Exhausted stays put
    /// until a hard window/session reset.
    static func invalidateInFlight(_ state: inout State) {
        if case .loading = state {
            state = .idle
        }
    }
}

/// A bounded raw-item window can start inside a collapsed tool-heavy turn. In
/// that case `presentation.rows` is non-empty while every row is filtered out,
/// leaving only transparent layout helpers. Keep exactly the latest row visible
/// as a safety fallback; normal collapse behavior is untouched whenever at
/// least one row is naturally visible.
enum TranscriptVisibleRowFallback {
    static func forcedRowID(
        orderedRowIDs: [String],
        naturallyVisibleRowIDs: Set<String>
    ) -> String? {
        guard naturallyVisibleRowIDs.isEmpty else { return nil }
        return orderedRowIDs.last
    }
}

/// Layout gravity contract for short pinned transcripts (fold/unfold jump fix).
///
/// A pinned session whose rendered content is shorter than the visible viewport
/// must keep its rows glued to the bottom composer. `StickToBottomTracker` can
/// only express that with clip offsets while the document is taller than the
/// viewport; once contentHeight <= viewport there is no offset to write, so the
/// natural top-anchored layout wins and a fold/unfold height change bounces the
/// whole block between viewport top and bottom.
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
/// Lifecycle state for the rail's proxy-backed selection host. A temporary
/// ScrollView disappearance must not turn the still-visible rail permanently inert;
/// the next root bind replaces the captured proxy.
struct UserPromptRailSelectHostState: Equatable {
    private(set) var isBound = false

    mutating func bind() {
        isBound = true
    }

    mutating func scrollRootDidDisappear() {
        // Keep the last action until the replacement root binds. The rail and its
        // host can overlap during SwiftUI teardown/rebuild.
    }
}

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
    /// Current session's subagent tree, passed through WITHOUT observation so the
    /// ~16ms `log_delta` `objectWillChange` from `SubagentStore` does not invalidate
    /// this whole detail chrome (root + transcript subtree + nav rail + sheets) on
    /// every log batch. Leaves that actually display subagent state/logs
    /// (`StreamingTranscriptRows`, `SubagentPanel`, the finished-group sheet) observe
    /// the store themselves; only the running-count badge reads `subagentProjection`.
    let agentStore: SubagentStore
    /// Narrow subagent projection: re-publishes only when running count / running
    /// tool-call ids change (lifecycle), so the root chrome + rail stay stable across
    /// ordinary `log_delta` batches while terminal/failed/needs-user states refresh
    /// immediately.
    @StateObject private var subagentProjection = SubagentChatProjectionHost()
    @Environment(\.chatTypography) private var chatTypography

    /// Coalesce explicit/recovery jump-to-latest `scrollTo` operations. Streaming
    /// growth is followed by `StickToBottomTracker` at the AppKit clip-view layer.
    /// Transient; reset on session switch.
    @State private var scrollCoalesceScheduled = false
    @State private var scrollNeedsRetry = false
    @State private var rightPanelWidthRatio: CGFloat?
    @State private var rightPanelDragStartWidth: CGFloat?
    @State private var rightPanelDragWidth: CGFloat?
    /// Pre-drag chat-column content width. While non-`nil`, transcript/markdown
    /// layout stays frozen (panel chrome still tracks the cursor). Mirrors
    /// `settledLogicalSize` freeze during window live-resize in `App.swift`.
    @State private var frozenChatColumnWidthDuringRightPanelDrag: CGFloat?
    /// Real user prompt ids whose complete assistant turn is folded.
    @State private var collapsedUserTurnIDs: Set<String> = []
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
    /// Bumped when the experimental table-transcript debug gate toggles so the
    /// branch in `transcriptContent` re-evaluates without a process restart.
    @State private var tableTranscriptRenderEpoch = 0
    /// Detail column width measured inside the safe area (not via a root GeometryReader,
    /// which expands under the window toolbar and lets transcript chrome overlap the title).
    @State private var detailLayoutWidth: CGFloat = 0
    /// Visible transcript viewport height, measured at the scroll-container level
    /// (parent-driven frame, not a content proposal) and passed explicitly into the
    /// rows so pinned short transcripts get layout-level bottom gravity.
    @State private var transcriptViewportHeight: CGFloat = 0
    /// User-prompt seek navigation host (live/history/seek + jump generation).
    @State private var userPromptNavigation = UserPromptNavigationCoordinator()
    /// Synchronous parent-side half of a user-owned prepared-history commit.
    /// It blocks proxy/retry/resize writers before the child changes its window.
    @State private var historyCommitBlocksAutomaticFollow = false
    /// Mounted user-row geometry cache. Preferences refresh this in stable
    /// pre-flip document coordinates; AppKit user-scroll callbacks consume it
    /// with the live clip, so current does not depend on preference re-emission.
    @State private var mountedUserPromptCurrentTrackerStore = MountedUserPromptCurrentTrackerStore()
    /// ScrollViewProxy-bound select action for the left nav rail (legacy path only).
    /// TableTranscript keeps this nil so the rail stays hidden / inert.
    @State private var userPromptRailSelect: ((String) -> Void)?
    @State private var userPromptRailSelectHost = UserPromptRailSelectHostState()
    /// Serial jump / correction work. Cancelled on new navigate, user scroll,
    /// return-to-latest, and session switch (generation bump).
    @State private var userPromptJumpWork: Task<Void, Never>?
    /// Cancelable mount ack for the in-flight first seek scroll (session+generation).
    @State private var seekMountAckBox: SeekMountAcknowledgementBox?
    /// Settled row scoped ids currently in the tree (onAppear/onDisappear).
    /// Lets first-scroll complete immediately when the target is already mounted.
    @State private var appearedSeekRowIDs: Set<String> = []
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
            .navigationSubtitle(session.projectURL.lastPathComponent)
            // Opaque toolbar band so residual underlap cannot show through the title.
            .toolbarBackground(Color(nsColor: .windowBackgroundColor), for: .windowToolbar)
            .toolbarBackground(.visible, for: .windowToolbar)
            .toolbar {
                // One ToolbarItem (not a Group of separate pills) so branch +
                // collapse read as a single compact flat control cluster.
                ToolbarItem(placement: .primaryAction) {
                    detailTopTrailingChrome
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
            subagentProjection.bind(agentStore)
        }
        .onChange(of: session.bridgeRoutingKey) { _, _ in
            // A distinct ChatSession receives a fresh bridge key. Persisted-id
            // rebinding keeps the key stable and must not dismiss an open detail.
            finishedGroupPresentation = nil
            runningToolDetail = nil
            // The fresh root must re-settle before the macOS 14 cover lifts;
            // re-entering an earlier key also needs a fresh settle.
            bottomSettledSessionKey = nil
            // Warm session switch reuses this chrome: re-bind the projection to the
            // new session's store so the running-count badge tracks the right tree.
            subagentProjection.bind(agentStore)
        }
        .onChange(of: session.id) { _, _ in
            // The detail chrome is reused across sessions. Reset only transient view state;
            // draft, panel selection, and pin state live on ChatSession.
            gitBranches.bind(projectURL: session.projectURL)
            scrollCoalesceScheduled = false
            scrollNeedsRetry = false
            rightPanelDragStartWidth = nil
            rightPanelDragWidth = nil
            frozenChatColumnWidthDuringRightPanelDrag = nil
            collapsedUserTurnIDs = []
            settledChatColumnWidth = nil
            pendingChatColumnWidth = nil
            chatColumnWidthSettleWork?.cancel()
            chatColumnWidthSettleWork = nil
            widthRecoverGeneration += 1
            // draft / rightPanel / pinTranscriptToBottom remain session-owned.
        }
        .environment(\.openDocument, { url in
            // ⌘+点击聊天中的文档路径 → 右侧文档面板渲染（非文档路径仍走访达）。
            session.documentTabs.open(url)
            session.rightPanel = .document
        })
    }

    private var chatColumn: some View {
        VStack(spacing: 0) {
            ComputerConsentBar(sessionKey: session.bridgeRoutingKey)
            transcriptContent
                // Rebuild dependency only — do not `.id` the legacy scroll root (that would
                // change production identity). Epoch is read inside `transcriptContent`.
                .onReceive(
                    NotificationCenter.default.publisher(
                        for: .pipiuiTableTranscriptFeatureDidChange
                    )
                ) { _ in
                    tableTranscriptRenderEpoch &+= 1
                }
            if let conflicts = store.extensionConflicts[session.id], !conflicts.isEmpty {
                conflictBanner(conflicts)
            }
            if let error = session.lastError {
                errorBanner(error)
            }
            InputBar(session: session)
        }
        // Right-panel drag: keep content at the pre-drag width so markdown wrap
        // does not remeasure every frame. Outer flexible frame still follows the
        // HStack slot (divider/panel stay live); overflow is clipped.
        .frame(
            width: frozenChatColumnWidthDuringRightPanelDrag,
            alignment: .leading
        )
        .frame(minWidth: 0, maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .clipped()
        // panelQuickRail overlays adaptiveLayout (full chat+divider+panel width)
        // so it can sit on the panel boundary instead of chat-trailing + divider gap.
        .background(
            GeometryReader { geo in
                Color.clear.preference(key: ChatColumnWidthKey.self, value: geo.size.width)
            }
        )
        .layoutPriority(1)
    }

    /// Left-edge Claude-style ticks from the full-session user-prompt index.
    /// Lives in the transcript gutter only (never covers message content, title, or input).
    /// Hidden when empty, on experimental TableTranscript, or before proxy bind.
    @ViewBuilder
    private var userPromptNavigationRailHost: some View {
        let entries = session.userPromptIndex.entries
        if TableTranscriptFeature.isEnabled || entries.isEmpty {
            EmptyView()
        } else {
            let currentID = UserPromptNavigationRailModel.resolvedCurrentMessageID(
                currentUserPromptID: userPromptNavigation.currentUserPromptID,
                pendingUserPromptID: userPromptNavigation.pendingUserPromptID,
                isSeeking: userPromptNavigation.isSeeking,
                entryMessageIDs: entries.map(\.messageID)
            )
            UserPromptNavigationRail(
                entries: entries,
                currentMessageID: currentID,
                onSelect: { messageID in
                    userPromptRailSelect?(messageID)
                }
            )
            .allowsHitTesting(userPromptRailSelectHost.isBound && userPromptRailSelect != nil)
            .padding(.top, UserPromptNavigationRailModel.hostTopInset)
            .padding(.leading, UserPromptNavigationRailModel.hostLeadingInset)
            // Keep hit-testing inside the reserved gutter width.
            .frame(
                width: UserPromptNavigationRailModel.transcriptLeadingGutter,
                alignment: .topLeading
            )
        }
    }

    /// Top-trailing branch + panel collapse/expand. Flat, borderless, ~28pt hits —
    /// one visual group instead of separate oversized toolbar pills. No Computer Use
    /// control here (bottom-left indicator remains the only CU surface).
    private var detailTopTrailingChrome: some View {
        HStack(spacing: 2) {
            GitBranchMenu(store: gitBranches) { session.lastError = $0 }

            // Light hairline between branch and collapse when both are present.
            if gitBranches.status.isRepo {
                Rectangle()
                    .fill(Color.primary.opacity(0.10))
                    .frame(width: 1, height: 14)
                    .padding(.horizontal, 2)
            }

            Button {
                if session.rightPanel != nil {
                    session.rightPanel = nil
                } else if let last = session.lastRightPanel {
                    if last == .agents {
                        session.subagents.selectLatest()
                    }
                    session.rightPanel = last
                }
            } label: {
                Image(systemName: session.rightPanel != nil
                      ? "rectangle.righthalf.inset.filled.arrow.right"
                      : "sidebar.right")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(session.rightPanel != nil ? Color.accentColor : Color.secondary)
                    .frame(width: 28, height: 28)
                    .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            }
            .buttonStyle(ChromeIconButtonStyle(
                isEmphasized: session.rightPanel != nil
            ))
            .help(session.rightPanel != nil ? "收起右侧栏" : "展开右侧栏")
            .disabled(session.rightPanel == nil && session.lastRightPanel == nil)
        }
        .padding(.horizontal, 2)
    }

    /// Top-trailing rail chrome. `trailingInset` is distance from the overlay’s
    /// trailing edge (panel width + 2 when open → hugs panel; 2 when closed).
    private func panelQuickRailOverlay(trailingInset: CGFloat) -> some View {
        HStack(alignment: .top, spacing: 4) {
            // The compact plan popover is overlay-only, so it never changes the
            // transcript scroll root or competes with its viewport ownership.
            PlanStatusView(
                store: session.planStore,
                session: session,
                onExecute: { session.executePublishedPlan(planId: $0) },
                onAdjust: { session.preparePlanAdjustment(planId: $0) },
                onContinue: { session.continueInterruptedPlan(planId: $0) },
                onIgnore: { session.planStore.cancel(planId: $0) }
            )
            panelQuickRail
        }
        .padding(.top, 8)
        .padding(.trailing, trailingInset)
    }

    /// 聊天栏右上角的竖向快捷栏：右面板开关（Subagents / 浏览器 / 文档 / 终端）。
    /// Flat narrow strip — matches the compact top chrome (no floating capsule/shadow).
    private var panelQuickRail: some View {
        VStack(spacing: 2) {
            railButton(
                systemName: "person.2",
                isActive: session.rightPanel == .agents,
                help: "Subagent 面板（pi 派出的子 agent 树）"
            ) {
                if session.rightPanel == .agents {
                    session.rightPanel = nil
                } else {
                    session.subagents.selectLatest()
                    session.rightPanel = .agents
                }
            }
            .overlay(alignment: .topTrailing) {
                if subagentProjection.presentation.runningCount > 0 {
                    Circle().fill(Color.green).frame(width: 7, height: 7)
                        .offset(x: 1, y: -1)
                }
            }

            railButton(
                systemName: "globe",
                isActive: session.rightPanel == .web,
                help: "内置浏览器面板（pi 可通过 browser 工具驱动）"
            ) {
                session.rightPanel = session.rightPanel == .web ? nil : .web
            }

            railButton(
                systemName: "doc.text",
                isActive: session.rightPanel == .document,
                help: "文档面板（⌘+点击聊天中的 md/txt 文档路径在此预览）"
            ) {
                session.rightPanel = session.rightPanel == .document ? nil : .document
            }

            railButton(
                systemName: "terminal",
                isActive: session.rightPanel == .terminal,
                help: "内嵌终端（项目目录）"
            ) {
                if session.rightPanel == .terminal {
                    session.rightPanel = nil
                } else {
                    session.terminalTabs.selectLatest()
                    session.rightPanel = .terminal
                }
            }
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 3)
        .background(
            Color(nsColor: .windowBackgroundColor).opacity(0.94),
            in: RoundedRectangle(cornerRadius: 8, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
        )
        // Rail floats over selectable transcript text; without an explicit cursor
        // the underlying I-beam bleeds through on hover.
        .pointingHandCursor()
    }

    private func railButton(
        systemName: String,
        isActive: Bool,
        help: LocalizedStringKey,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(isActive ? Color.accentColor : Color.secondary)
                .frame(width: 28, height: 28)
                .background {
                    if isActive {
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .fill(Color.accentColor.opacity(0.12))
                    }
                }
                .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
        .buttonStyle(.plain)
        .help(help)
    }

    @ViewBuilder
    private func adaptiveLayout(width: CGFloat) -> some View {
        if width >= 760 {
            // 宽屏恒为 HStack：开关右栏只插入/移除 divider+panel 兄弟节点，
            // chatColumn 视图身份保持不变 → 不再因 HStack↔ZStack 翻转而拆除重建。
            HStack(spacing: 0) {
                chatColumn
                    .padding(.trailing, session.rightPanel != nil ? 24 : 0)
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
            // Rail on full HStack: when panel is open, hug its leading edge
            // (was chat-trailing 8pt + 16pt divider ≈ 24pt visual gap).
            .overlay(alignment: .topTrailing) {
                panelQuickRailOverlay(
                    trailingInset: session.rightPanel != nil
                        ? wideRightPanelWidth(for: width) + 2
                        : 2
                )
            }
        } else {
            ZStack(alignment: .trailing) {
                chatColumn
                    .padding(.trailing, session.rightPanel != nil ? 24 : 0)

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
            .overlay(alignment: .topTrailing) {
                panelQuickRailOverlay(
                    trailingInset: session.rightPanel != nil
                        ? overlayPanelWidth(for: width) + 2
                        : 2
                )
            }
            .animation(.easeInOut(duration: 0.18), value: session.rightPanel)
        }
    }

    @ViewBuilder
    private func panelView(_ panel: ChatSession.RightPanel) -> some View {
        Group {
            switch panel {
            case .web:
                WebViewPanel(store: session.webTabs)
            case .agents:
                SubagentPanel(
                    store: session.subagents,
                    projectURL: session.projectURL,
                    onAbort: { agentId in session.abortSubagent(agentId) },
                    onResolve: { agent in session.resolveSubagent(agent) },
                    onManualStatusCheck: { agentIDs in
                        requestManualSubagentStatusCheck(agentIDs)
                    }
                )
                // Same session-identity convention as the transcript root (see
                // TranscriptSessionRootIdentity): warm session switch reuses the
                // ChatDetailView chrome, so without a per-session id the panel would
                // stay bound to the previous session's SubagentStore. bridgeRoutingKey
                // is stable across persisted-id rebinding of one logical session.
                .id(session.bridgeRoutingKey)
            case .document:
                DocumentPanel(store: session.documentTabs)
            case .terminal:
                TerminalPanel(store: session.terminalTabs)
                    // Same session-identity convention as SubagentPanel: warm session
                    // switch reuses ChatDetailView chrome, so pin the terminal host to
                    // this session's routing key.
                    .id(session.bridgeRoutingKey)
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
            let startWidth = wideRightPanelWidth(for: availableWidth)
            rightPanelDragStartWidth = startWidth
            // Freeze chat content width for the whole drag (App.swift
            // `settledLogicalSize` / `shouldUpdateSettledLayout(inLiveResize:)`).
            // Panel frame still uses `rightPanelDragWidth` so the divider tracks.
            frozenChatColumnWidthDuringRightPanelDrag = max(
                availableWidth - startWidth - rightPanelDividerWidth,
                minimumChatWidth
            )
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
        // Release freeze → one layout pass at final chat width; preference path
        // settle-repins (same flush idea as `didEndLiveResizeNotification`).
        frozenChatColumnWidthDuringRightPanelDrag = nil
    }

    /// The scroll container remains a sibling of InputBar. Only its row subtree observes
    /// StreamingState, so 20 Hz token/tool updates do not call ComposerTextView.updateNSView.
    @ViewBuilder
    private var transcriptContent: some View {
        // Touch epoch so a menu toggle invalidates this body without wrapping the
        // production scroll root in an extra `.id`.
        let _ = tableTranscriptRenderEpoch
        if TableTranscriptFeature.isEnabled {
            // Experimental phase-1 NSTableView path (debug gate). Default remains below.
            TableTranscriptHost(
                session: session,
                streaming: streaming,
                agentStore: agentStore,
                collapsedUserTurnIDs: $collapsedUserTurnIDs,
                onOpenFinishedGroup: presentFinishedGroup,
                onOpenRunningTool: presentRunningTool
            )
            .id(TranscriptSessionRootIdentity(sessionKey: session.bridgeRoutingKey))
        } else {
            legacyInvertedScrollTranscript
        }
    }

    /// Production inverted ScrollView + eager VStack transcript (unchanged default path).
    private var legacyInvertedScrollTranscript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                StreamingTranscriptRows(
                    session: session,
                    streaming: streaming,
                    agentStore: agentStore,
                    collapsedUserTurnIDs: $collapsedUserTurnIDs,
                    viewportHeight: transcriptViewportHeight,
                    seekMountedRange: userPromptNavigation.seekMountedRange,
                    isSeeking: userPromptNavigation.isSeeking,
                    /// Bumps on navigate / return / user takeover / session reset so
                    /// the production history pager drops in-flight 60ms reveals.
                    viewportGeneration: userPromptNavigation.generation,
                    automaticFollowAllowed: allowsAutomaticFollow,
                    automaticFollowGeneration: userPromptNavigation.generation,
                    mayWritePersistentUserUnpin: {
                        userPromptNavigation.viewport.scrollOwner == .user
                    },
                    onUserOwnedHistoryCommitWillBegin: {
                        beginUserOwnedHistoryCommitDetachment()
                    },
                    onHistoryCommitDidFinish: {
                        historyCommitBlocksAutomaticFollow = false
                    },
                    onUserRepinnedLatest: {
                        handleTranscriptUserRepinnedLatest(proxy: proxy)
                    },
                    onOpenFinishedGroup: presentFinishedGroup,
                    onOpenRunningTool: presentRunningTool,
                    onReturnLatest: {
                        returnToLatestTranscript(proxy: proxy)
                    },
                    onUserScroll: { viewport, mountedRange in
                        // StickToBottomTracker only reports attributed user scroll
                        // (wheel/trackpad/knob) — not programmatic scrollTo. It
                        // supplies the current AppKit clip so cached layout anchors
                        // for this exact mounted window can update without a new preference.
                        handleTranscriptUserScroll(
                            proxy: proxy,
                            viewport: viewport,
                            mountedRange: mountedRange
                        )
                    },
                    onMountedUserPromptWindowChanged: { mountedRange in
                        invalidateMountedUserPromptAnchorCache(for: mountedRange)
                    },
                    onJump: { target in
                        // In-message jump targets only while the coordinator is idle.
                        guard !userPromptNavigation.jumpCoordinatorMayWriteScroll else { return }
                        var transaction = Transaction()
                        transaction.disablesAnimations = true
                        withTransaction(transaction) {
                            proxy.scrollTo(target, anchor: jumpAnchor)
                        }
                    },
                    onSeekRowAppeared: { scopedID in
                        appearedSeekRowIDs.insert(scopedID)
                        seekMountAckBox?.acknowledge(rowID: scopedID)
                    },
                    onSeekRowDisappeared: { scopedID in
                        appearedSeekRowIDs.remove(scopedID)
                    }
                )
                // Leading gutter reserves independent rail hit-test space so ticks
                // never overlay message content. Other edges keep the 16pt inset.
                .padding(.top, 16)
                .padding(.bottom, 16)
                .padding(.trailing, 16)
                .padding(.leading, 16 + UserPromptNavigationRailModel.transcriptLeadingGutter)
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
                // This coordinate space is inside the ScrollView document and
                // before the outer `.transcriptFlip()`. Row anchors therefore
                // stay in stable layout/document coordinates while the clip moves.
                .coordinateSpace(name: MountedUserPromptAnchorKey.layoutCoordinateSpaceName)
            }
            // Same-session identity rebinds may still update session.id without
            // replacing this ScrollView. Never animate that bookkeeping change.
            .animation(nil, value: session.id)
            .scrollIndicators(.automatic)
            .transcriptFlip()
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
            .onPreferenceChange(MountedUserPromptAnchorKey.self) { anchors in
                applyMountedUserPromptAnchors(anchors)
            }
            // Bottom pinning stays with explicit `scrollTo("bottom")` + the
            // tracker. The inverted AppKit document-end edge loads history;
            // newest-first layout makes every older page a structural append.
            // macOS 15+: pin only the *initial* offset of a fresh scroll root to
            // the bottom (role-scoped — unlike the bare `.defaultScrollAnchor`,
            // it never re-applies while the user scrolls through history). The
            // modifier stays mounted when pin changes; only its initial anchor
            // value changes, so the native scroll root keeps its identity. An
            // unpinned warm-history session uses a natural top first frame.
            // macOS 14 has no public API for the role, so the
            // settled-key cover below hides the first frame instead.
            .modifier(InitialBottomOffsetAnchor(pinned: session.pinTranscriptToBottom))
            // macOS 14 fallback: hide a fresh pinned scroll root until the
            // explicit bottom scroll lands (~50ms), so the window head never
            // flashes before the jump. The loading veil overlay stays visible.
            .opacity(transcriptCoveredByBottomSettle ? 0 : 1)
            .overlay(alignment: .bottomTrailing) {
                if !session.pinTranscriptToBottom {
                    Button {
                        returnToLatestTranscript(proxy: proxy)
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
            // Rail sits in the reserved leading gutter only — not over bubbles,
            // not over InputBar/title (host is transcript-local, top-leading).
            .overlay(alignment: .topLeading) {
                userPromptNavigationRailHost
            }
            .onAppear {
                bindUserPromptNavigation(proxy: proxy)
                bindUserPromptRailSelect(proxy: proxy)
                jumpToLatest(proxy, retry: true)
            }
            .onDisappear {
                historyCommitBlocksAutomaticFollow = false
                // Retain the host action during teardown; a rebuilt legacy root
                // immediately replaces its proxy binding onAppear.
                userPromptRailSelectHost.scrollRootDidDisappear()
                appearedSeekRowIDs = []
                resetMountedUserPromptCurrentTracker()
                cancelUserPromptJumpWork()
            }
            .onChange(of: session.bridgeRoutingKey) { _, _ in
                appearedSeekRowIDs = []
                bindUserPromptNavigation(proxy: proxy)
                bindUserPromptRailSelect(proxy: proxy)
            }
            .onChange(of: session.transcriptVersion) { _, _ in
                _ = mutateUserPromptNavigation {
                    $0.streamAppended(itemCount: session.transcript.count)
                }
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
            // Right-panel divider drag ended: same flush as didEndLiveResize.
            // Preference may not re-fire if the slot width already matches the last
            // pending frame, so apply pending + re-pin explicitly when freeze lifts.
            .onChange(of: frozenChatColumnWidthDuringRightPanelDrag) { previous, current in
                guard previous != nil, current == nil else { return }
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

    /// True while chat content width must not drive markdown reflow / re-pin:
    /// AppKit window live-resize **or** right-panel divider drag. Same freeze
    /// contract as `ResizeThrottle.shouldUpdateSettledLayout(inLiveResize:)`.
    private var isChatColumnContentWidthFrozen: Bool {
        frozenChatColumnWidthDuringRightPanelDrag != nil
            || NSApp.keyWindow?.inLiveResize == true
    }

    /// Every automatic writer (stream append, document growth, retry, and width
    /// recovery) must respect the viewport's current owner. `StickToBottomTracker`
    /// supplies an additional immediate local suppression during the coalesced
    /// persistent-unpin gap; this host gate prevents proxy jumps from bypassing it.
    private var allowsAutomaticFollow: Bool {
        !historyCommitBlocksAutomaticFollow
            && session.pinTranscriptToBottom
            && userPromptNavigation.streamingMayWriteScroll
    }

    /// Debounce chat-column width changes, then re-pin — but **never** while layout
    /// is frozen for a live drag (window chrome or right-panel divider). Mid-drag
    /// `scrollTo("bottom")` races transcript reflow and makes the transcript tremble;
    /// window drags flush on `didEndLiveResize`, right-panel drags flush when
    /// `frozenChatColumnWidthDuringRightPanelDrag` clears. Toggles still settle-then-repin.
    private func scheduleChatColumnWidthSettleRepin(_ proxy: ScrollViewProxy, width: CGFloat) {
        guard width.isFinite, width > 1 else { return }
        // Ignore sub-point / layout jitter — recovering on noise fights the wheel.
        if let settled = settledChatColumnWidth, abs(settled - width) < 12 {
            return
        }
        if isChatColumnContentWidthFrozen {
            pendingChatColumnWidth = width
            chatColumnWidthSettleWork?.cancel()
            chatColumnWidthSettleWork = nil
            return
        }
        chatColumnWidthSettleWork?.cancel()
        let work = DispatchWorkItem {
            // Drag may have started after this work was scheduled.
            if isChatColumnContentWidthFrozen {
                pendingChatColumnWidth = width
                return
            }
            let previous = settledChatColumnWidth
            settledChatColumnWidth = width
            pendingChatColumnWidth = nil
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
        guard allowsAutomaticFollow else { return }
        widthRecoverGeneration += 1
        let generation = widthRecoverGeneration
        let key = session.bridgeRoutingKey
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 32_000_000)
            guard generation == widthRecoverGeneration,
                  allowsAutomaticFollow,
                  session.bridgeRoutingKey == key else { return }
            applyJumpToLatest(proxy)
        }
    }

    /// Explicit jump to the pin edge. Normal top-down layout uses this for streaming
    /// follow, the jump button, initial session binding, and width recovery.
    private func jumpToLatest(_ proxy: ScrollViewProxy, retry: Bool = false) {
        guard allowsAutomaticFollow else { return }
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
            guard allowsAutomaticFollow,
                  session.bridgeRoutingKey == key else { return }
            applyJumpToLatest(proxy)
            if needsRetry {
                for delay in [0.05, 0.2] as [TimeInterval] {
                    DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                        guard allowsAutomaticFollow,
                              session.bridgeRoutingKey == key else { return }
                        applyJumpToLatest(proxy)
                    }
                }
            }
        }
    }

    // MARK: - User-prompt navigation (seek)

    /// Bind left-rail clicks to the live ScrollViewProxy (legacy inverted path only).
    private func bindUserPromptRailSelect(proxy: ScrollViewProxy) {
        userPromptRailSelect = { messageID in
            navigateToUserPrompt(messageID: messageID, proxy: proxy)
        }
        userPromptRailSelectHost.bind()
    }

    /// Internal entry for the navigation rail: seek by stable user message id.
    private func navigateToUserPrompt(messageID: String, proxy: ScrollViewProxy) {
        // Resolve against the full-session index before mutating viewport state.
        let index = session.userPromptIndex.transcriptIndex(for: messageID)
        let effects = mutateUserPromptNavigation {
            $0.navigateToUserPrompt(
                messageID: messageID,
                transcriptIndex: index,
                itemCount: session.transcript.count,
                sessionKey: session.bridgeRoutingKey
            )
        }
        applyUserPromptNavigationEffects(effects, proxy: proxy)
    }

    private func returnToLatestTranscript(proxy: ScrollViewProxy) {
        historyCommitBlocksAutomaticFollow = false
        session.transcriptPlanner.invalidate()
        let effects = mutateUserPromptNavigation { $0.returnToLatest() }
        applyUserPromptNavigationEffects(effects, proxy: proxy)
        jumpToLatest(proxy, retry: true)
    }

    /// A real user gesture reached the latest edge again. Restore live ownership
    /// without issuing another proxy jump — the user is already at that location.
    private func handleTranscriptUserRepinnedLatest(proxy: ScrollViewProxy) {
        guard !userPromptNavigation.isSeeking else { return }
        historyCommitBlocksAutomaticFollow = false
        session.transcriptPlanner.invalidate()
        let effects = mutateUserPromptNavigation { $0.returnToLatest() }
        applyUserPromptNavigationEffects(effects, proxy: proxy)
    }

    /// A history prefetch admitted by a real user scroll can arrive before the
    /// old geometric 4pt release threshold. Make the user detach durable before
    /// the prepared window mutates; normal pinned safety-backfill returns false.
    private func beginUserOwnedHistoryCommitDetachment() -> Bool {
        guard !userPromptNavigation.isSeeking,
              userPromptNavigation.viewport.scrollOwner == .user
        else { return false }
        historyCommitBlocksAutomaticFollow = true
        _ = mutateUserPromptNavigation { $0.historyCommitBegan() }
        return true
    }

    private func handleTranscriptUserScroll(
        proxy: ScrollViewProxy,
        viewport: UserPromptCurrentAssociation.Viewport,
        mountedRange: Range<Int>
    ) {
        let effects = mutateUserPromptNavigation { nav in
            // StickToBottom owns live pin geometry. Mirror session pin into nav
            // before reduce so the one-way nav→session sync cannot re-pin after
            // a geometry unpin (or clear a re-pin) during ordinary browsing.
            if !nav.isSeeking {
                nav.viewport.pinToBottom = session.pinTranscriptToBottom
            }
            // This call records the AppKit clip, transfers ownership, then uses
            // the already-cached mounted layout anchors immediately. It never
            // waits for a scroll-time Preference re-emission.
            return mountedUserPromptCurrentTrackerStore.tracker.userScrolled(
                navigation: &nav,
                viewport: viewport,
                mountedRange: mountedRange
            )
        }
        applyUserPromptNavigationEffects(effects, proxy: proxy)
    }

    /// Cache all mounted user-row geometry regardless of current scroll owner.
    /// During programmatic seek/live movement this deliberately does not rewrite
    /// current; after a real user takeover `refreshCurrent` uses this exact cache.
    private func applyMountedUserPromptAnchors(
        _ reports: [MountedUserPromptAnchorReport]
    ) {
        guard !reports.isEmpty else { return }
        // A teardown/rebuild can briefly deliver reports from adjacent windows.
        // Keep them range-scoped; user-scroll association reads only the exact
        // range carried by the AppKit callback, so stale rows cannot win.
        var ranges: [Range<Int>] = []
        for report in reports where !ranges.contains(report.mountedRange) {
            ranges.append(report.mountedRange)
        }
        for range in ranges {
            mountedUserPromptCurrentTrackerStore.tracker.replaceMountedAnchors(
                reports
                    .filter { $0.mountedRange == range }
                    .map(\.anchor),
                mountedRange: range
            )
        }
        _ = mutateUserPromptNavigation { nav in
            _ = mountedUserPromptCurrentTrackerStore.tracker.refreshCurrent(navigation: &nav)
            return []
        }
    }

    /// A bounded history/seek/live window replacement invalidates only geometry
    /// that cannot belong to the incoming range. The selected rail node stays
    /// intact until fresh visible anchors arrive, never falling back to latest.
    private func invalidateMountedUserPromptAnchorCache(for mountedRange: Range<Int>) {
        mountedUserPromptCurrentTrackerStore.tracker.mountedWindowDidChange(mountedRange)
    }

    private func resetMountedUserPromptCurrentTracker() {
        mountedUserPromptCurrentTrackerStore.tracker.reset()
    }

    private func bindUserPromptNavigation(proxy: ScrollViewProxy) {
        historyCommitBlocksAutomaticFollow = false
        resetMountedUserPromptCurrentTracker()
        let effects = mutateUserPromptNavigation {
            $0.reset(
                sessionKey: session.bridgeRoutingKey,
                itemCount: session.transcript.count
            )
        }
        applyUserPromptNavigationEffects(effects, proxy: proxy)
    }

    @discardableResult
    private func mutateUserPromptNavigation(
        _ body: (inout UserPromptNavigationCoordinator) -> [TranscriptViewport.Effect]
    ) -> [TranscriptViewport.Effect] {
        var nav = userPromptNavigation
        let effects = body(&nav)
        // Only write the @State when the coordinator actually changed. AppKit may
        // deliver many true-scroll clip snapshots per gesture, but the reference
        // geometry cache is non-observable and this state changes only when the
        // discrete current id / ownership changes. `UserPromptNavigationCoordinator`
        // is `Equatable`, so the comparison is cheap and effects still propagate
        // to the host unchanged.
        if nav != userPromptNavigation {
            userPromptNavigation = nav
        }
        // Keep session pin aligned with viewport ownership (seek forces pin off).
        if session.pinTranscriptToBottom != nav.pinToBottom {
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                session.pinTranscriptToBottom = nav.pinToBottom
            }
        }
        return effects
    }

    private func applyUserPromptNavigationEffects(
        _ effects: [TranscriptViewport.Effect],
        proxy: ScrollViewProxy
    ) {
        for effect in effects {
            switch effect {
            case .cancelPendingJumpWork:
                cancelUserPromptJumpWork()
            case .invalidateHistoryPager:
                // Ownership lives on StreamingTranscriptRows via viewportGeneration
                // observation (bumps historyLoadGeneration + invalidateInFlight).
                // No direct child state access from the parent host.
                break
            case let .scrollToIndex(index, sessionKey, generation):
                scheduleUserPromptSeekScroll(
                    index: index,
                    sessionKey: sessionKey,
                    generation: generation,
                    proxy: proxy
                )
            case let .runCorrection(sessionKey, generation):
                scheduleUserPromptSeekCorrection(
                    sessionKey: sessionKey,
                    generation: generation,
                    proxy: proxy
                )
            }
        }
    }

    private func cancelUserPromptJumpWork() {
        userPromptJumpWork?.cancel()
        userPromptJumpWork = nil
        seekMountAckBox?.cancel()
        seekMountAckBox = nil
    }

    /// First seek scroll: prepare is already in viewport state; wait for a cancelable
    /// target-row mount ack (session+generation), then animation-free scrollTo and
    /// finite corrections. Does not rely on a fixed delay alone.
    private func scheduleUserPromptSeekScroll(
        index: Int,
        sessionKey: String,
        generation: UInt64,
        proxy: ScrollViewProxy
    ) {
        cancelUserPromptJumpWork()
        let key = sessionKey
        let gen = generation
        let targetIndex = index
        guard targetIndex >= 0, targetIndex < session.transcript.count else { return }
        let localID = session.transcript[targetIndex].id
        let target = TranscriptRenderIdentity.scoped(sessionKey: key, localID: localID)
        let request = SeekFirstScrollPipeline.Request(
            targetIndex: targetIndex,
            targetRowID: target,
            sessionKey: key,
            generation: gen
        )
        let box = SeekMountAcknowledgementBox(request: request)
        seekMountAckBox = box
        // Already in the tree (e.g. overlapping seek windows): ack without waiting.
        if appearedSeekRowIDs.contains(target) {
            box.acknowledge(rowID: target)
        }

        userPromptJumpWork = Task { @MainActor in
            // One yield so SwiftUI can commit a newly prepared seek window.
            await Task.yield()
            guard !Task.isCancelled else {
                box.cancel()
                return
            }
            // Re-check after the commit pass — new rows may have appeared.
            if appearedSeekRowIDs.contains(target) {
                box.acknowledge(rowID: target)
            }

            let scrolled = await SeekFirstScrollPipeline.run(
                request: request,
                isCurrent: {
                    userPromptNavigation.isCurrent(sessionKey: key, generation: gen)
                        && userPromptNavigation.jumpCoordinatorMayWriteScroll
                        && session.bridgeRoutingKey == key
                },
                host: .init(
                    waitForMount: { req in
                        // If a newer schedule replaced the box, this wait is stale.
                        guard seekMountAckBox === box,
                              box.request == req
                        else { return .cancelled }
                        return await box.wait(timeoutNanoseconds: 150_000_000)
                    },
                    performScroll: { req in
                        guard userPromptNavigation.isCurrent(
                            sessionKey: req.sessionKey,
                            generation: req.generation
                        ),
                        userPromptNavigation.jumpCoordinatorMayWriteScroll,
                        session.bridgeRoutingKey == req.sessionKey
                        else { return }
                        var transaction = Transaction()
                        transaction.disablesAnimations = true
                        withTransaction(transaction) {
                            proxy.scrollTo(req.targetRowID, anchor: jumpAnchor)
                        }
                    }
                )
            )

            if seekMountAckBox === box {
                seekMountAckBox = nil
            }
            guard !Task.isCancelled, scrolled else { return }
            guard userPromptNavigation.isCurrent(sessionKey: key, generation: gen),
                  userPromptNavigation.jumpCoordinatorMayWriteScroll,
                  session.bridgeRoutingKey == key
            else { return }

            let followUp = mutateUserPromptNavigation {
                $0.jumpScrollApplied(generation: gen)
            }
            await runUserPromptFollowUpEffects(
                followUp,
                sessionKey: key,
                generation: gen,
                targetScopedID: target,
                proxy: proxy
            )
        }
    }

    private func scheduleUserPromptSeekCorrection(
        sessionKey: String,
        generation: UInt64,
        proxy: ScrollViewProxy
    ) {
        // Corrections are normally chained from jumpScrollApplied. A standalone
        // effect still runs under the same serial task + token guards.
        let key = sessionKey
        let gen = generation
        let prior = userPromptJumpWork
        userPromptJumpWork = Task { @MainActor in
            _ = await prior?.result
            guard !Task.isCancelled else { return }
            guard userPromptNavigation.isCurrent(sessionKey: key, generation: gen),
                  userPromptNavigation.jumpCoordinatorMayWriteScroll,
                  session.bridgeRoutingKey == key,
                  let targetIndex = userPromptNavigation.seekTargetIndex,
                  targetIndex >= 0,
                  targetIndex < session.transcript.count
            else { return }
            let localID = session.transcript[targetIndex].id
            let target = TranscriptRenderIdentity.scoped(sessionKey: key, localID: localID)
            await runUserPromptFollowUpEffects(
                [.runCorrection(sessionKey: key, generation: gen)],
                sessionKey: key,
                generation: gen,
                targetScopedID: target,
                proxy: proxy
            )
        }
    }

    private func runUserPromptFollowUpEffects(
        _ effects: [TranscriptViewport.Effect],
        sessionKey: String,
        generation: UInt64,
        targetScopedID: String,
        proxy: ScrollViewProxy
    ) async {
        var queue = effects
        while !queue.isEmpty {
            guard !Task.isCancelled else { return }
            let effect = queue.removeFirst()
            switch effect {
            case .cancelPendingJumpWork, .invalidateHistoryPager:
                continue
            case .scrollToIndex:
                continue
            case let .runCorrection(effectKey, effectGen):
                guard effectKey == sessionKey, effectGen == generation else { return }
                try? await Task.sleep(nanoseconds: 16_000_000)
                guard !Task.isCancelled else { return }
                guard userPromptNavigation.isCurrent(sessionKey: sessionKey, generation: generation),
                      userPromptNavigation.jumpCoordinatorMayWriteScroll,
                      session.bridgeRoutingKey == sessionKey
                else { return }
                var transaction = Transaction()
                transaction.disablesAnimations = true
                withTransaction(transaction) {
                    proxy.scrollTo(targetScopedID, anchor: jumpAnchor)
                }
                let next = mutateUserPromptNavigation {
                    $0.correctionApplied(generation: generation)
                }
                queue.append(contentsOf: next)
            }
        }
    }

    private func applyJumpToLatest(_ proxy: ScrollViewProxy) {
        guard allowsAutomaticFollow else { return }
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            // Inverted scroll: layout top is the visual bottom / latest edge.
            proxy.scrollTo(transcriptID("bottom"), anchor: .top)
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
    /// Passed through WITHOUT observation. The full `SubagentStore` publishes
    /// `objectWillChange` on every ~16ms `log_delta`/`update` batch, which used
    /// to invalidate this entire settled-row group (planner window, fold guards,
    /// and every `MessageRow` equality check) on each batch. Instead,
    /// `transcriptSubagents` re-publishes a narrow per-agent slice that changes
    /// only on lifecycle / display-relevant transitions; this `let` is read
    /// fresh for actual card data whenever the body re-runs.
    let agentStore: SubagentStore
    @Binding var collapsedUserTurnIDs: Set<String>
    /// Transcript viewport height measured at the scroll-container level by the
    /// parent. Drives the pinned short-content bottom gravity.
    let viewportHeight: CGFloat
    /// When non-`nil`, mount this bounded seek slice instead of the live/history
    /// `TranscriptRenderWindow` (never target→latest full span).
    let seekMountedRange: Range<Int>?
    /// Seek mode: history pager off, streaming extras off, pin re-entry blocked.
    let isSeeking: Bool
    /// `UserPromptNavigationCoordinator.generation` — bumps on seek start, return
    /// to latest, user takeover, and session reset so pending history-pager work
    /// is dropped (same ownership as the viewport reducer).
    let viewportGeneration: UInt64
    /// Live-stream / document growth may write only while the viewport remains
    /// live-owned. This flips false immediately on an attributed user scroll,
    /// before the coalesced persistent pin write lands.
    let automaticFollowAllowed: Bool
    /// Explicit return-to-latest / session navigation invalidates any local
    /// immediate suppression held by the AppKit tracker.
    let automaticFollowGeneration: UInt64
    /// A queued false pin write remains valid only while the user still owns the
    /// viewport. This rejects an old unpin after an explicit jump-to-latest.
    let mayWritePersistentUserUnpin: () -> Bool
    /// Called synchronously before a user-owned prepared history commit changes
    /// its mounted window. Returns false for pinned safety-backfill.
    let onUserOwnedHistoryCommitWillBegin: () -> Bool
    /// Called after the committed window has appeared and stale callbacks have
    /// been invalidated; it never itself resumes detached follow.
    let onHistoryCommitDidFinish: () -> Void
    /// The tracker calls this only after a real user re-enters the latest edge.
    let onUserRepinnedLatest: () -> Void
    let onOpenFinishedGroup: (AssistantBlockLayout.FinishedGroupPresentation) -> Void
    let onOpenRunningTool: (RunningToolDetailPresentation) -> Void
    let onReturnLatest: () -> Void
    /// User-driven scroll (wheel / trackpad / knob), with the current AppKit
    /// clip converted into pre-flip document layout coordinates. Programmatic
    /// `scrollTo` never invokes this callback. The mounted raw-item range tags
    /// cached anchors so an old history-window preference cannot win after paging.
    let onUserScroll: (UserPromptCurrentAssociation.Viewport, Range<Int>) -> Void
    /// Fired whenever the bounded mounted raw-item window changes. The parent
    /// drops stale row geometry before fresh preferences replace it.
    let onMountedUserPromptWindowChanged: (Range<Int>) -> Void
    let onJump: (String) -> Void
    /// Settled row appeared (scoped render id). Feeds cancelable seek mount ack.
    let onSeekRowAppeared: (String) -> Void
    /// Settled row left the tree — drop from the host's appeared set.
    let onSeekRowDisappeared: (String) -> Void
    @Environment(\.chatTypography) private var chatTypography

    /// The only production history-pager state. Snapshot planning advances it
    /// preparing → ready → committing; the committed page is its sole window truth.
    @State private var historyPreparation = TranscriptHistoryPreparation.State()
    /// A prepared presentation is immutable and used only when its request still
    /// matches the current session, viewport generation, and render-window identity.
    @State private var preparedHistoryPresentation: PreparedHistoryPresentation?
    /// Reference-only scroll lifecycle gate: no body invalidation for live pulses.
    @State private var historyLiveScrollGate = TranscriptHistoryLiveScrollGate()
    /// Shared with the AppKit tracker. It invalidates queued document follow
    /// synchronously before a prepared history commit mutates rows/window.
    @State private var followIntent = TranscriptFollowIntent()
    /// Narrow per-agent slice that drives re-render only on lifecycle /
    /// display-relevant changes. Ordinary `log_delta`/telemetry batches leave
    /// it equal, so the settled-row group stays stable across streaming.
    @StateObject private var transcriptSubagents = TranscriptSubagentProjectionHost()

    var body: some View {
        let items = session.transcript
        // Read the projection so the body depends on it (establishes
        // observation). Running tool-call ids come from the narrow slice; the
        // actual card data is still read fresh from `agentStore` below.
        let subagentPresentation = transcriptSubagents.presentation
        // Seek: independent bounded range from the jump coordinator.
        // Live/history: existing TranscriptRenderWindow behavior unchanged.
        let window = resolvedRenderWindow(itemCount: items.count)
        let windowItems = Array(items[window.range])
        // History expanded backward (head moved), or directed seek away from live.
        // Return-to-latest uses pin reset / coordinator return.
        let browsingHistory = isSeeking
            || (!session.pinTranscriptToBottom && historyPreparation.committedPage != nil)
        // History loading gate for AppKit near-top prefetch and non-scrollable
        // safety backfill. The explicit pager closes it while one page is loading.
        // Seek must never expand via the unidirectional history pager.
        let effectiveStartPage = historyPreparation.committedPage
            ?? TranscriptRenderWindow.latestStartPage(itemCount: items.count)
        let historyLoadingEnabled = !isSeeking
            && effectiveStartPage > 0
            && !historyPreparation.isLoading
        let preparedMatches = preparedHistoryPresentation?.matches(
            window: window,
            sessionKey: session.bridgeRoutingKey,
            viewportGeneration: viewportGeneration,
            transcriptVersion: session.transcriptVersion,
            toolStructureVersion: streaming.toolStructureVersion
        ) == true
        let presentation = preparedMatches
            ? preparedHistoryPresentation!.presentation
            : session.transcriptPlanner.presentation(
                items: windowItems,
                toolRuns: streaming.toolRuns,
                visibleCount: windowItems.count,
                transcriptVersion: session.transcriptVersion,
                toolStructureVersion: streaming.toolStructureVersion
            )
        let userTurnGroups = presentation.userTurnGroups
        let runningSubagentToolCallIds = subagentPresentation.runningToolCallIDs
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
        let naturallyVisibleSettledRowIDs = naturallyVisibleRowIDs(
            presentation: presentation,
            guardedGroupIDs: runningGuardedGroupIDs
        )
        let forcedVisibleSettledRowID = TranscriptVisibleRowFallback.forcedRowID(
            orderedRowIDs: presentation.rows.map(\.id),
            naturallyVisibleRowIDs: naturallyVisibleSettledRowIDs
        )
        let historyPageIsLoading = historyPreparation.isLoading

        // Intentionally eager but bounded to the one-way window (never lazy).
        // The inverted layout is newest-first: when history expands, older rows
        // are appended at the layout end, so existing row geometry never moves.
        VStack(alignment: .leading, spacing: chatTypography.messageSpacing) {
            // Layout start == visual bottom in the inverted ScrollView.
            Color.clear
                .frame(height: 1)
                .id(transcriptID("bottom"))
                .transcriptFlip()

            if browsingHistory {
                HStack(spacing: 16) {
                    Spacer(minLength: 0)

                    Button("返回最新消息") {
                        session.transcriptPlanner.invalidate()
                        onReturnLatest()
                    }
                    .buttonStyle(.link)
                }
                .transcriptFlip()
            }

            if !browsingHistory,
               let streamingItem = streaming.streamingItem,
               hasVisibleContent(streamingItem) {
                // Layout order is reversed visually. Place elapsed first so the
                // upright visual order remains message, then elapsed, then bottom.
                if let startedAt = session.turnWallClockStartedAt {
                    TurnElapsedText(startedAt: startedAt)
                        .id(transcriptID("streaming-turn-elapsed"))
                        .transcriptFlip()
                }
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
                .transcriptFlip()
            } else if !browsingHistory && (session.isWorking || session.isCompacting || session.mediaBusy || session.visionCaptionInProgress) {
                let placeholder = WaitingPlaceholderChoice(
                    mediaBusy: session.mediaBusy,
                    mediaStatus: session.mediaStatus,
                    isStopping: session.isStopping,
                    isCompacting: session.isCompacting,
                    isCaptioning: session.visionCaptionInProgress
                )
                WaitingPlaceholderView(
                    message: placeholder.message,
                    turnStartedAt: placeholder.usesCompactionTimer
                        ? session.compactionStartedAt
                        : session.turnWallClockStartedAt
                )
                .id(transcriptID("waiting-placeholder"))
                .transcriptFlip()
            }

            // Empty production rows (the reachable initialization state) must not
            // mount the settled container or its tracker at all: an always-declared
            // zero-height VStack is still a real child of the outer VStack and would
            // be counted for outer spacing, adding an extra gap of `messageSpacing`
            // under the initializing state. With rows present this block is
            // the same eager settled-container shape and one observer host.
            if !presentation.rows.isEmpty {
                VStack(alignment: .leading, spacing: chatTypography.messageSpacing) {
                    ForEach(presentation.rows.reversed(), id: \.id) { row in
                        switch row {
                        case .leaf(let item):
                            let groupID = userTurnGroups.groupIDForRowID[item.id]
                            let isInternalSignal = groupID != nil
                                && !presentation.userAuthoredLeafIDs.contains(item.id)
                            let isFoldedSignal = isInternalSignal
                                && isUserTurnCollapsed(groupID, guarded: runningGuardedGroupIDs)
                            if !isFoldedSignal || item.id == forcedVisibleSettledRowID {
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
                                    forceExpandedUserBubble: session.visionCaptionOptimisticID == item.id,
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
                                .background {
                                    // Mounted user prompts only: cache the full pre-flip
                                    // layout rect for current-node association.
                                    if presentation.userAuthoredLeafIDs.contains(item.id) {
                                        MountedUserPromptAnchorReporter(
                                            messageID: item.id,
                                            mountedRange: window.range
                                        )
                                    }
                                }
                                .onAppear { onSeekRowAppeared(transcriptID(item.id)) }
                                .onDisappear { onSeekRowDisappeared(transcriptID(item.id)) }
                                .transcriptFlip()
                            }
                        case .assistantRun(let id, let entryId, let segments):
                            let groupID = userTurnGroups.groupIDForRowID[id]
                            let isFolded = isUserTurnCollapsed(groupID, guarded: runningGuardedGroupIDs)
                            let isGroupLastAssistant = groupID.flatMap {
                                userTurnGroups.lastAssistantRunIDForGroupID[$0]
                            } == id
                            if !isFolded || isGroupLastAssistant || id == forcedVisibleSettledRowID {
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
                                .onAppear { onSeekRowAppeared(transcriptID(id)) }
                                .onDisappear { onSeekRowDisappeared(transcriptID(id)) }
                                .transcriptFlip()
                            }
                        }
                    }
                }
                // Observer only: visual history top is the inverted document end.
                // History expansion appends rows and never asks this tracker to
                // measure or move the clip origin.
                .overlay(alignment: .bottom) {
                    StickToBottomTracker(
                        isPinned: seekAwarePinBinding,
                        pinEdge: .documentStart,
                        automaticFollowAllowed: automaticFollowAllowed,
                        automaticFollowGeneration: automaticFollowGeneration,
                        followIntent: followIntent,
                        topLoadingEnabled: historyLoadingEnabled,
                        historyPrefetchThreshold: TranscriptHistoryPrefetchTrigger.threshold(
                            viewportHeight: viewportHeight
                        ),
                        onReachedTop: requestOlderHistoryPage,
                        onLiveScrollChanged: handleHistoryLiveScroll,
                        onUserRepinnedLatest: onUserRepinnedLatest,
                        onUserScroll: { viewport in
                            onUserScroll(viewport, window.range)
                        }
                    )
                }
            }

            if presentation.rows.isEmpty,
               streaming.streamingItem == nil,
               !session.isWorking,
               !session.isCompacting,
               !session.mediaBusy,
               !session.isInitializing {
                HStack {
                    Spacer(minLength: 0)
                    Text("还没有消息")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                    Spacer(minLength: 0)
                }
                .padding(.vertical, 12)
                .transcriptFlip()
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
                .transcriptFlip()
            }

            // Layout end == visual top. In pinned short transcripts this flexible
            // space therefore keeps the upright content at the visual bottom.
            if ShortTranscriptGravity.usesTopFlexibleSpace(
                pinned: session.pinTranscriptToBottom,
                viewportHeight: viewportHeight
            ) {
                Spacer(minLength: 0)
                    .transcriptFlip()
            }
        }
        // Overlay rather than a conditional transcript row: loading must not
        // alter the inverted document's row tree or append geometry.
        .overlay(alignment: .top) {
            if historyPageIsLoading {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.small)
                    Text("正在加载更早消息…")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(8)
                .background(.regularMaterial, in: Capsule())
                .transcriptFlip()
            }
        }
        // No window-replacement identity: the container must stay alive across
        // history expansion. Loading never reads row ids: the AppKit visual-top
        // edge loads one older page, whose rows append at layout end.
        .onChange(of: session.pinTranscriptToBottom) { _, newValue in
            if newValue { invalidateHistoryPreparation(clearCommittedPage: true) }
        }
        .onChange(of: session.id) { _, _ in
            invalidateHistoryPreparation(clearCommittedPage: true)
        }
        .onChange(of: session.bridgeRoutingKey) { _, _ in
            invalidateHistoryPreparation(clearCommittedPage: true)
        }
        // Seek/navigation changes invalidate ready or pending pages before they
        // can commit into another mounted window.
        .onChange(of: viewportGeneration) { _, _ in
            invalidateHistoryPreparation(clearCommittedPage: isSeeking)
        }
        .onChange(of: window.range) { _, _ in
            // A history page / seek slice / live window shift can unmount rows.
            // Clear only their geometry; current remains selected until fresh
            // mounted anchors prove a new visible reading position.
            onMountedUserPromptWindowChanged(window.range)
            completePreparedHistoryCommitAfterWindowMutation(window)
        }
        .onAppear {
            onMountedUserPromptWindowChanged(window.range)
            // The scroll root is recreated per bridge key (`.id(...)` on the
            // outer ScrollViewReader), so this host is freshly initialized on
            // every session switch and rebinds to the current store here.
            // Persisted-id rebind keeps both the key and `session.subagents`
            // stable, so no separate rebind path is needed.
            transcriptSubagents.bind(agentStore)
        }
        .onDisappear {
            if followIntent.cancelHistoryCommit() {
                onHistoryCommitDidFinish()
            }
        }
    }

    /// Mounted raw-item window for the current viewport mode.
    private func resolvedRenderWindow(itemCount: Int) -> TranscriptRenderWindow {
        if let seekRange = seekMountedRange {
            let lower = max(0, min(seekRange.lowerBound, itemCount))
            let upper = max(lower, min(seekRange.upperBound, itemCount))
            return TranscriptRenderWindow(range: lower..<upper, totalCount: itemCount)
        }
        // Pinned/live mode renders the latest warm window. Unpinned history
        // moves one page at a time toward older pages; resolve hard-caps the eager
        // span at maxPages so deep prefetch cannot mount the session.
        return TranscriptRenderWindow.resolve(
            itemCount: itemCount,
            oldestLoadedPage: historyPreparation.committedPage
        )
    }

    /// Pin binding that blocks accidental re-pin while seeking (local seek-window
    /// bottom is not global latest). User scroll still reports via `onUserScroll`.
    private var seekAwarePinBinding: Binding<Bool> {
        Binding(
            get: { session.pinTranscriptToBottom },
            set: { newValue in
                if isSeeking {
                    // Never re-enter live pin from geometry while a seek window is up.
                    if newValue { return }
                    if session.pinTranscriptToBottom {
                        session.pinTranscriptToBottom = false
                    }
                    return
                }
                // A user-unpin is intentionally deferred. If the user clicked
                // jump-to-latest before that write ran, the parent has already
                // returned ownership to `.live`, so this stale false must no-op.
                if !newValue, !mayWritePersistentUserUnpin() { return }
                session.pinTranscriptToBottom = newValue
            }
        )
    }

    /// Prepare the next immutable window/plan before touching the mounted page.
    /// The async main-turn commit deliberately has no fixed delay: it is only a
    /// safe turn boundary and is rejected if scrolling/session ownership changed.
    private func requestOlderHistoryPage() -> Bool {
        guard !isSeeking, seekMountedRange == nil else { return false }
        var state = historyPreparation
        guard let request = TranscriptHistoryPreparation.request(
            state: &state,
            sessionKey: session.bridgeRoutingKey,
            viewportGeneration: viewportGeneration,
            itemCount: session.transcript.count
        ) else { return false }
        historyPreparation = state
        Log.debug("history prepare begin", category: .session)

        // Snapshot before plan construction; commit never recomputes this window.
        let snapshot = session.transcript
        let windowItems = Array(snapshot[request.window.range])
        let presentation = session.transcriptPlanner.presentation(
            items: windowItems,
            toolRuns: streaming.toolRuns,
            visibleCount: windowItems.count,
            transcriptVersion: session.transcriptVersion,
            toolStructureVersion: streaming.toolStructureVersion
        )
        guard request.window.totalCount == snapshot.count else { return false }
        guard TranscriptHistoryPreparation.prepared(request, state: &state) else { return false }
        historyPreparation = state
        preparedHistoryPresentation = PreparedHistoryPresentation(
            request: request,
            presentation: presentation,
            transcriptVersion: session.transcriptVersion,
            toolStructureVersion: streaming.toolStructureVersion
        )
        Log.debug("history prepare end", category: .session)
        DispatchQueue.main.async {
            commitPreparedHistoryIfPossible(request)
        }
        return true
    }

    private func handleHistoryLiveScroll(_ isLive: Bool) {
        // `didLiveScroll` can arrive once per display frame. This reference-only
        // gate is a lifecycle edge, not a per-pixel state sink or log source.
        guard historyLiveScrollGate.isLiveScrolling != isLive else { return }
        historyLiveScrollGate.isLiveScrolling = isLive
        if !isLive, let request = historyPreparation.request {
            commitPreparedHistoryIfPossible(request)
        }
    }

    private func commitPreparedHistoryIfPossible(_ request: TranscriptHistoryPreparation.Request) {
        guard !historyLiveScrollGate.isLiveScrolling,
              !isSeeking,
              request.sessionKey == session.bridgeRoutingKey,
              request.viewportGeneration == viewportGeneration,
              preparedHistoryPresentation?.request == request
        else { return }
        var state = historyPreparation
        // This only changes a local reducer value. The synchronous detach below
        // must happen before assigning the committed window to SwiftUI.
        guard TranscriptHistoryPreparation.beginCommit(request, state: &state) else { return }
        let historyCommitToken = unpinForPreparedHistoryCommit(request)
        historyPreparation = state
        Log.debug("history commit begin", category: .session)
        guard TranscriptHistoryPreparation.finishCommit(request, state: &state) else {
            if historyCommitToken != nil, followIntent.cancelHistoryCommit() {
                onHistoryCommitDidFinish()
            }
            return
        }
        historyPreparation = state
        Log.debug("history commit end", category: .session)
    }

    /// Begins the shared intent transaction before `finishCommit` changes the
    /// mounted range. Pinned non-scrollable safety backfill deliberately stays
    /// on the normal live path; a real user owner detaches even inside 4pt.
    private func unpinForPreparedHistoryCommit(
        _ request: TranscriptHistoryPreparation.Request
    ) -> TranscriptFollowIntent.HistoryCommitToken? {
        guard onUserOwnedHistoryCommitWillBegin() else { return nil }
        return followIntent.beginHistoryCommit(request: request)
    }

    /// Inverted history appends structurally preserve the visible anchor. Wait
    /// until SwiftUI has observed the target window, then one main turn so any
    /// document-frame callbacks from that layout see the active intent first.
    private func completePreparedHistoryCommitAfterWindowMutation(_ window: TranscriptRenderWindow) {
        guard let token = followIntent.activeHistoryCommit,
              token.request.window == window
        else { return }
        let finish = onHistoryCommitDidFinish
        DispatchQueue.main.async { [followIntent] in
            guard followIntent.completeHistoryCommit(token) else { return }
            finish()
        }
    }

    private func invalidateHistoryPreparation(clearCommittedPage: Bool) {
        if followIntent.cancelHistoryCommit() {
            onHistoryCommitDidFinish()
        }
        var state = historyPreparation
        TranscriptHistoryPreparation.invalidate(&state, clearCommittedPage: clearCommittedPage)
        historyPreparation = state
        preparedHistoryPresentation = nil
    }

    private struct PreparedHistoryPresentation {
        let request: TranscriptHistoryPreparation.Request
        let presentation: AssistantBlockLayout.TranscriptPresentation
        let transcriptVersion: UInt64
        let toolStructureVersion: UInt64

        func matches(
            window: TranscriptRenderWindow,
            sessionKey: String,
            viewportGeneration: UInt64,
            transcriptVersion: UInt64,
            toolStructureVersion: UInt64
        ) -> Bool {
            request.window == window
                && request.sessionKey == sessionKey
                && request.viewportGeneration == viewportGeneration
                && self.transcriptVersion == transcriptVersion
                && self.toolStructureVersion == toolStructureVersion
        }
    }

    private func naturallyVisibleRowIDs(
        presentation: AssistantBlockLayout.TranscriptPresentation,
        guardedGroupIDs: Set<String>
    ) -> Set<String> {
        Set(presentation.rows.compactMap { row in
            switch row {
            case .leaf(let item):
                let groupID = presentation.userTurnGroups.groupIDForRowID[item.id]
                let isInternalSignal = groupID != nil
                    && !presentation.userAuthoredLeafIDs.contains(item.id)
                let hidden = isInternalSignal
                    && isUserTurnCollapsed(groupID, guarded: guardedGroupIDs)
                return hidden ? nil : item.id
            case .assistantRun(let id, _, _):
                let groupID = presentation.userTurnGroups.groupIDForRowID[id]
                let isGroupLastAssistant = groupID.flatMap {
                    presentation.userTurnGroups.lastAssistantRunIDForGroupID[$0]
                } == id
                let hidden = isUserTurnCollapsed(groupID, guarded: guardedGroupIDs)
                    && !isGroupLastAssistant
                return hidden ? nil : id
            }
        })
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

/// macOS 15+ role-scoped initial-offset anchor. The transcript is inverted, so
/// layout `.top` is the visual bottom/latest edge and layout `.bottom` is the
/// visual history top. The role-scoped modifier only pins the first frame;
/// macOS 14 has no public
/// API for the role, so the fallback cover (`BottomSettledCover`) hides the
/// transcript until the explicit pinned scroll lands. On macOS 15+, keep one
/// stable modifier shape across pin changes: only the initial anchor value
/// changes, while an unpinned warm-history root starts naturally at the top.
private struct InitialBottomOffsetAnchor: ViewModifier {
    let pinned: Bool

    func body(content: Content) -> some View {
        if #available(macOS 15.0, *) {
            content.defaultScrollAnchor(pinned ? .top : .bottom, for: .initialOffset)
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

/// Mounted user-row rectangles in pre-flip ScrollView document layout space.
/// Every report carries its bounded raw-item window so a late preference from a
/// previous history page can never be associated with the current AppKit clip.
private struct MountedUserPromptAnchorReport: Equatable {
    let mountedRange: Range<Int>
    let anchor: UserPromptCurrentAssociation.Anchor
}

private struct MountedUserPromptAnchorKey: PreferenceKey {
    static let layoutCoordinateSpaceName = "pipiui.transcriptLayoutDocument"
    static var defaultValue: [MountedUserPromptAnchorReport] = []
    static func reduce(
        value: inout [MountedUserPromptAnchorReport],
        nextValue: () -> [MountedUserPromptAnchorReport]
    ) {
        value.append(contentsOf: nextValue())
    }
}

/// Preference reporter for one mounted user prompt row.
private struct MountedUserPromptAnchorReporter: View {
    let messageID: String
    let mountedRange: Range<Int>

    var body: some View {
        GeometryReader { geo in
            // The named coordinate space sits inside the ScrollView content and
            // before the outer `.transcriptFlip()`, so this frame is stable in
            // document layout coordinates rather than transient viewport space.
            let frame = geo.frame(in: .named(MountedUserPromptAnchorKey.layoutCoordinateSpaceName))
            Color.clear.preference(
                key: MountedUserPromptAnchorKey.self,
                value: [
                    MountedUserPromptAnchorReport(
                        mountedRange: mountedRange,
                        anchor: UserPromptCurrentAssociation.Anchor(
                            messageID: messageID,
                            layoutFrame: frame
                        )
                    ),
                ]
            )
        }
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

    /// Held mouse button on the scroller (not window chrome resize). While true,
    /// pinned content-growth follow and automatic re-pin must not move the clip
    /// origin under the thumb; unpin on drag-away remains allowed.
    var isKnobDrag: Bool { self == .user }
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
    /// Strict edge epsilon used to *re*-pin after an explicit user scroll.
    /// Keep this aligned with the release distance so one upward gesture cannot
    /// unpin and then re-pin itself at `didEndLiveScroll` inside a wider band.
    static let rePinThreshold: CGFloat = 4
    /// On wheel/trackpad live scroll, leave the absolute bottom by more than this → unpin
    /// immediately. The tiny epsilon filters elastic/rounding noise at the edge.
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

    /// Distance from the document end. In the inverted transcript this is the
    /// visual history-top edge (the latest/pin edge is document start).
    static func distanceFromDocumentEnd(
        visible: CGRect,
        contentHeight: CGFloat,
        documentIsFlipped: Bool
    ) -> CGFloat {
        if documentIsFlipped {
            return contentHeight - visible.maxY
        }
        return visible.minY
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

    /// Whether pinned content-growth may rewrite the clip origin.
    ///
    /// A scroller-knob drag holds a mouse button without `didLiveScroll`. Content
    /// frame notifications still fire while streaming; following them mid-drag
    /// yanks the thumb back to the pin edge. Pure and unit-tested so the gate
    /// cannot drift into a time-based throttle.
    static func allowsPinnedContentFollow(
        isPinned: Bool,
        mouseButtonsDown: Int,
        windowInLiveResize: Bool
    ) -> Bool {
        guard isPinned else { return false }
        let origin = ScrollOrigin.classify(
            mouseButtonsDown: mouseButtonsDown,
            windowInLiveResize: windowInLiveResize
        )
        return !origin.isKnobDrag
    }

    /// - Parameters:
    ///   - allowRepin: when `false` (scroller-knob drag), distance may still unpin
    ///     but must not write `true` — re-pin waits until the mouse is released
    ///     and a later live gesture/geometry pass re-evaluates.
    /// - Returns: `true`/`false` to write pin, or `nil` for no change.
    static func desiredPin(
        currentlyPinned: Bool,
        distanceFromBottom: CGFloat,
        userLiveScroll: Bool,
        allowUnpin: Bool,
        allowRepin: Bool = true
    ) -> Bool? {
        // Geometry changes from content growth, layout, or tracker attachment
        // are observations, not user intent. They must never change pin state.
        guard userLiveScroll else { return nil }

        if allowUnpin, currentlyPinned, distanceFromBottom > liveScrollUnpinDistance {
            return false
        }
        let nearBottom = distanceFromBottom <= rePinThreshold
        if allowRepin, !currentlyPinned, nearBottom {
            return true
        }
        return nil
    }
}

/// Pure edge state machine for visual-top history prefetch (unit-tested).
///
/// The transcript's `StickToBottomTracker` feeds every clip/document geometry
/// change into `step`. It fires once when the viewport enters the approach band,
/// never repeats while it stays there, and rearms only after leaving or while the
/// loading gate is disabled. This moves one-page layout work ahead of the hard
/// edge instead of making the user's gesture pay for it at the top.
enum TranscriptHistoryPrefetchTrigger {
    static let minimumThreshold: CGFloat = 640
    /// Compatibility name for the former fixed threshold; the runtime now uses
    /// `threshold(viewportHeight:)` but source-level integrations still refer to it.
    static let approachThreshold: CGFloat = minimumThreshold
    static let maximumThreshold: CGFloat = 2_400

    /// Two visible screens, bounded for tiny and ultrawide viewports.
    static func threshold(viewportHeight: CGFloat) -> CGFloat {
        let height = viewportHeight.isFinite ? max(0, viewportHeight) : 0
        return min(max(height * 2, minimumThreshold), maximumThreshold)
    }

    struct State: Equatable {
        var isInsideApproachBand = false
    }

    /// - Parameters:
    ///   - state: persistent edge state, owned by the coordinator (never written
    ///     into SwiftUI state).
    ///   - distanceFromDocumentStart: distance from the active visual history edge.
    ///   - enabled: false while pinned, when the effective start page is 0, or
    ///     before the user has actually scrolled in this attachment (attach seed
    ///     and programmatic bottom scrolls must never auto-load).
    ///   - threshold: viewport-derived near-top preload distance.
    /// - Returns: `true` exactly once per approach-band entry while enabled.
    static func step(
        state: inout State,
        distanceFromDocumentStart: CGFloat,
        enabled: Bool,
        threshold: CGFloat = minimumThreshold
    ) -> Bool {
        guard enabled else {
            guard state.isInsideApproachBand else { return false }
            state.isInsideApproachBand = false
            return false
        }
        let isInside = distanceFromDocumentStart <= threshold
        guard isInside != state.isInsideApproachBand else { return false }
        state.isInsideApproachBand = isInside
        return isInside
    }
}

/// Pure immediate-follow decision: persistent pin can be coalesced later, but
/// the first upward gesture must stop stream-follow in the same event.
enum TranscriptFollowSuppression {
    /// Reference-owned by the AppKit coordinator. It is deliberately not
    /// Observable: live scroll pulses must not invalidate the transcript body.
    ///
    /// The state separates an immediate user-intent barrier from the coalesced
    /// persistent binding write. A stale automatic re-pin is never allowed to
    /// cross that barrier; only a fresh user re-pin or an explicit latest jump
    /// may resume automatic follow.
    struct State {
        private(set) var isSuppressed = false
        private var pendingPersistentPin: Bool?
        private var writeScheduled = false
        /// Invalidates queued automatic follow work as soon as user intent changes.
        private(set) var generation: UInt64 = 0

        /// Returns true only when the immediate intent barrier actually changes.
        /// Repeated bounds/live-scroll callbacks during one user-owned gesture
        /// must not keep invalidating queued work or mutating coordinator state.
        @discardableResult
        mutating func suppressImmediately() -> Bool {
            // A queued true still needs one invalidation/removal even if another
            // path already marked the user detached. Otherwise this is a no-op.
            guard !isSuppressed || pendingPersistentPin == true else { return false }
            generation &+= 1
            isSuppressed = true
            // An older queued re-pin is not user intent and must not survive the
            // first upward gesture. The caller immediately replaces it with false.
            if pendingPersistentPin == true {
                pendingPersistentPin = nil
            }
            return true
        }

        /// Only a confirmed user return to the latest edge may reopen follow.
        @discardableResult
        mutating func resumeAfterUserRepin() -> Bool {
            guard isSuppressed else { return false }
            generation &+= 1
            isSuppressed = false
            return true
        }

        /// Explicit jump-to-latest / session reset cancels an obsolete deferred
        /// unpin because the host has already made latest the new user intent.
        @discardableResult
        mutating func resumeForExplicitLatest() -> Bool {
            guard isSuppressed || pendingPersistentPin != nil else { return false }
            generation &+= 1
            isSuppressed = false
            pendingPersistentPin = nil
            return true
        }

        mutating func enqueuePersistentPin(_ value: Bool) -> Bool {
            // `true` without an explicit resume is necessarily stale/automatic
            // while detached. False remains admissible so repeated live-scroll
            // pulses coalesce to the one user-unpin write.
            guard !value || !isSuppressed else { return false }
            // Keep a queued value stable across every later bounds callback. A
            // different value may replace an already-scheduled stale write, but
            // reuses its existing main-turn task rather than cancel/requeue it.
            guard pendingPersistentPin != value else { return false }
            pendingPersistentPin = value
            guard !writeScheduled else { return false }
            writeScheduled = true
            return true
        }

        mutating func takePersistentPin() -> Bool? {
            writeScheduled = false
            defer { pendingPersistentPin = nil }
            return pendingPersistentPin
        }

        /// Persistent writes do not change intent. In particular, a delayed true
        /// write must never clear a newer user-unpin suppression.
        mutating func didWritePersistentPin(_: Bool) {}

        func isCurrent(_ scheduledGeneration: UInt64) -> Bool {
            generation == scheduledGeneration
        }

        func allowsFollow(isPinned: Bool) -> Bool {
            isPinned && !isSuppressed
        }
    }
}

/// Shared non-observable follow intent for one transcript root. The tracker and
/// prepared-history host use the same `TranscriptFollowSuppression.State`, so a
/// history window cannot grow between a user detach and its persistent pin write.
final class TranscriptFollowIntent {
    struct HistoryCommitToken: Equatable {
        let request: TranscriptHistoryPreparation.Request
        let generation: UInt64
    }

    private var suppression = TranscriptFollowSuppression.State()
    private var nextHistoryCommitGeneration: UInt64 = 0
    private(set) var activeHistoryCommit: HistoryCommitToken?

    var generation: UInt64 { suppression.generation }
    var isHistoryCommitActive: Bool { activeHistoryCommit != nil }

    func suppressImmediately() {
        suppression.suppressImmediately()
    }

    func resumeAfterUserRepin() {
        // A short in-flight history layout must finish/cancel before a geometry
        // callback can resume latest follow under the user's pointer.
        guard activeHistoryCommit == nil else { return }
        suppression.resumeAfterUserRepin()
    }

    func resumeForExplicitLatest() {
        activeHistoryCommit = nil
        suppression.resumeForExplicitLatest()
    }

    func enqueuePersistentPin(_ value: Bool) -> Bool {
        suppression.enqueuePersistentPin(value)
    }

    func takePersistentPin() -> Bool? {
        suppression.takePersistentPin()
    }

    func didWritePersistentPin(_ value: Bool) {
        suppression.didWritePersistentPin(value)
    }

    func isCurrent(_ scheduledGeneration: UInt64) -> Bool {
        suppression.isCurrent(scheduledGeneration)
    }

    func beginHistoryCommit(
        request: TranscriptHistoryPreparation.Request
    ) -> HistoryCommitToken {
        if let activeHistoryCommit { return activeHistoryCommit }
        nextHistoryCommitGeneration &+= 1
        // Invalidates an already-scheduled document follow immediately. The host
        // writes persistent false synchronously through the viewport reducer.
        suppression.suppressImmediately()
        let token = HistoryCommitToken(
            request: request,
            generation: nextHistoryCommitGeneration
        )
        activeHistoryCommit = token
        return token
    }

    @discardableResult
    func completeHistoryCommit(_ token: HistoryCommitToken) -> Bool {
        guard activeHistoryCommit == token else { return false }
        activeHistoryCommit = nil
        // Do not resume suppression here: completion means layout is stable, not
        // that the user asked to return to the latest edge.
        return true
    }

    @discardableResult
    func cancelHistoryCommit() -> Bool {
        guard activeHistoryCommit != nil else { return false }
        activeHistoryCommit = nil
        return true
    }

    func allowsAutomaticFollow(isPinned: Bool) -> Bool {
        activeHistoryCommit == nil && suppression.allowsFollow(isPinned: isPinned)
    }
}

/// Non-observable: live scroll pulses must not invalidate SwiftUI just to defer
/// a prepared history commit.
private final class TranscriptHistoryLiveScrollGate {
    var isLiveScrolling = false
}

/// ScrollView 的 AppKit 观察器：用户手势更新 pin，pinned 内容增长时跟随
/// document start；倒置历史分页只在真正到达 document end 的 false→true 边缘触发。
/// 旧页作为 newest-first layout 的尾部 append；tracker 不测量新增高度，也不
/// 修改 history expansion 的 clip origin。
struct StickToBottomTracker: NSViewRepresentable {
    @Binding var isPinned: Bool
    var threshold: CGFloat = StickToBottomLogic.rePinThreshold
    var pinEdge: StickPinEdge = .documentEnd
    /// Parent viewport ownership gate. False immediately after user takeover,
    /// even while the persistent pin binding is still coalescing to false.
    var automaticFollowAllowed: Bool = true
    /// Explicit latest/session intent generation used to release local suppression.
    var automaticFollowGeneration: UInt64 = 0
    /// Shared user/history intent. It is reference-only, so a commit can close
    /// follow before SwiftUI mutates the transcript document.
    var followIntent: TranscriptFollowIntent = TranscriptFollowIntent()
    /// History-top loading gate: `true` while unpinned and the effective window
    /// start page is above 0. While false the exact-top edge state is reset and
    /// `onReachedTop` never fires.
    var topLoadingEnabled: Bool = false
    var historyPrefetchThreshold: CGFloat = TranscriptHistoryPrefetchTrigger.minimumThreshold
    /// Fired exactly once per false→true exact-top edge while `topLoadingEnabled`
    /// and the user has scrolled in this attachment. Returns `true` when the
    /// SwiftUI side actually loaded one older page (start page decremented);
    /// `false` when pinned or no older page exists.
    var onReachedTop: (() -> Bool)? = nil
    /// Reference-only lifecycle signal; does not invalidate SwiftUI during pulses.
    var onLiveScrollChanged: ((Bool) -> Void)? = nil
    /// Fired after an actual user re-enters the latest edge and the persistent
    /// pin binding has been written. The parent restores `.live` scroll ownership.
    var onUserRepinnedLatest: (() -> Void)? = nil
    /// Fired on attributed user scroll (live wheel/trackpad or scroller-knob drag)
    /// with the current pre-flip document clip. Seek jump coordination uses this
    /// to cancel finite corrections and rail current uses it to recompute from
    /// cached row geometry without waiting for a SwiftUI preference update.
    var onUserScroll: ((UserPromptCurrentAssociation.Viewport) -> Void)? = nil

    func makeCoordinator() -> Coordinator {
        Coordinator(
            isPinned: $isPinned,
            threshold: threshold,
            pinEdge: pinEdge,
            automaticFollowAllowed: automaticFollowAllowed,
            automaticFollowGeneration: automaticFollowGeneration,
            followIntent: followIntent,
            topLoadingEnabled: topLoadingEnabled,
            historyPrefetchThreshold: historyPrefetchThreshold,
            onReachedTop: onReachedTop,
            onLiveScrollChanged: onLiveScrollChanged,
            onUserRepinnedLatest: onUserRepinnedLatest,
            onUserScroll: onUserScroll
        )
    }

    func makeNSView(context: Context) -> NSView {
        let view = NSView(frame: .zero)
        view.isHidden = true
        return view
    }

    /// Zero-height observer host; it contributes no transcript layout.
    func sizeThatFits(_ proposal: ProposedViewSize, nsView: NSView, context: Context) -> CGSize? {
        CGSize(width: proposal.width ?? 0, height: 0)
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        context.coordinator.isPinned = $isPinned
        context.coordinator.threshold = threshold
        context.coordinator.pinEdge = pinEdge
        context.coordinator.followIntent = followIntent
        context.coordinator.updateAutomaticFollow(
            allowed: automaticFollowAllowed,
            generation: automaticFollowGeneration
        )
        // Refresh the history-top gate and callback on every body pass so a
        // session rebind/switch can never leave a stale closure behind.
        let loadingGateChanged = context.coordinator.topLoadingEnabled != topLoadingEnabled
        context.coordinator.topLoadingEnabled = topLoadingEnabled
        context.coordinator.historyPrefetchThreshold = historyPrefetchThreshold
        context.coordinator.onReachedTop = onReachedTop
        context.coordinator.onLiveScrollChanged = onLiveScrollChanged
        context.coordinator.onUserRepinnedLatest = onUserRepinnedLatest
        context.coordinator.onUserScroll = onUserScroll
        // Do not re-attach on every SwiftUI body pass — only when not yet wired.
        context.coordinator.ensureAttached(from: nsView)
        // The gate just flipped (e.g. the user unpinned while already at the
        // document top, or the start page reached 0): re-evaluate the exact-top
        // edge once with the current geometry so the first history load does not
        // depend on another scroll event arriving.
        if loadingGateChanged {
            context.coordinator.scheduleTopEdgeEvaluation()
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
        /// Viewport ownership denies stream/document/recovery writes immediately
        /// after a user takes scroll ownership.
        var automaticFollowAllowed: Bool
        /// Last explicit latest/session intent observed by this tracker.
        private var automaticFollowGeneration: UInt64
        /// Shared with `StreamingTranscriptRows` so prepared history can
        /// synchronously invalidate a queued document follow before row mutation.
        var followIntent: TranscriptFollowIntent
        /// History-top loading gate, refreshed by `updateNSView` each body pass.
        var topLoadingEnabled: Bool
        var historyPrefetchThreshold: CGFloat
        /// Exact-top edge callback, refreshed by `updateNSView` each body pass so
        /// a rebind can never fire a stale session's closure. Returns `true` only
        /// when the SwiftUI side actually loaded an older page.
        var onReachedTop: (() -> Bool)?
        var onLiveScrollChanged: ((Bool) -> Void)?
        var onUserRepinnedLatest: (() -> Void)?
        /// User-scroll callback, refreshed each body pass with the current
        /// pre-flip layout clip (seek cancel + rail-current path).
        var onUserScroll: ((UserPromptCurrentAssociation.Viewport) -> Void)?
        private weak var scrollView: NSScrollView?
        /// Exposed so `updateNSView` can re-apply overlay style after SwiftUI resets it.
        var attachedScrollView: NSScrollView? { scrollView }
        private var liveScrollObs: NSObjectProtocol?
        private var endScrollObs: NSObjectProtocol?
        private var boundsObs: NSObjectProtocol?
        private var documentFrameObs: NSObjectProtocol?
        private var documentBoundsObs: NSObjectProtocol?
        private var attachAttempts = 0
        /// Clip bounds changes arrive for every scroller-knob movement. Process at
        /// most one attributed drag update per main-loop turn so the pin state
        /// machine cannot feed SwiftUI layout back into the drag continuously.
        private var knobDragUpdateScheduled = false
        /// Content can publish more than one frame/bounds notification per layout
        /// pass. Follow at most once per main-loop turn and never mutate SwiftUI.
        private var contentFollowScheduled = false
        /// Exact-top evaluation is coalesced the same way: one edge-state entry
        /// per main-loop turn keeps a history-expansion layout pass from cascading.
        private var topEdgeEvaluationScheduled = false
        /// Edge state owned by the coordinator; scroll positions never enter SwiftUI.
        private var topEdgeState = TranscriptHistoryPrefetchTrigger.State()
        /// The user must actually scroll in this attachment before the exact-top
        /// edge may load anything. Attach seed, initial layout, and programmatic
        /// bottom scrolls must never auto-load history.
        private var hasObservedUserScroll = false
        /// didLiveScroll is display-rate; the rows host consumes only lifecycle
        /// edges so it never receives a state/log callback for every pixel.
        private var isLiveScrollActive = false
        /// Invalidates a queued bounds update if this coordinator is detached and
        /// later attached to another scroll view before the next main-loop turn.
        private var boundsUpdateGeneration = 0

        init(
            isPinned: Binding<Bool>,
            threshold: CGFloat,
            pinEdge: StickPinEdge,
            automaticFollowAllowed: Bool,
            automaticFollowGeneration: UInt64,
            followIntent: TranscriptFollowIntent,
            topLoadingEnabled: Bool,
            historyPrefetchThreshold: CGFloat,
            onReachedTop: (() -> Bool)?,
            onLiveScrollChanged: ((Bool) -> Void)?,
            onUserRepinnedLatest: (() -> Void)?,
            onUserScroll: ((UserPromptCurrentAssociation.Viewport) -> Void)?
        ) {
            self.isPinned = isPinned
            self.threshold = threshold
            self.pinEdge = pinEdge
            self.automaticFollowAllowed = automaticFollowAllowed
            self.automaticFollowGeneration = automaticFollowGeneration
            self.followIntent = followIntent
            self.topLoadingEnabled = topLoadingEnabled
            self.historyPrefetchThreshold = historyPrefetchThreshold
            self.onReachedTop = onReachedTop
            self.onLiveScrollChanged = onLiveScrollChanged
            self.onUserRepinnedLatest = onUserRepinnedLatest
            self.onUserScroll = onUserScroll
        }

        deinit { detach() }

        /// A new generation is emitted only for an explicit return-to-latest or
        /// session/navigation reset. It is the sole non-user way to clear the
        /// immediate local suppression; ordinary live-scroll end never does.
        func updateAutomaticFollow(allowed: Bool, generation: UInt64) {
            let didReceiveExplicitLatestIntent = automaticFollowGeneration != generation
            if automaticFollowAllowed != allowed {
                automaticFollowAllowed = allowed
            }
            if automaticFollowGeneration != generation {
                automaticFollowGeneration = generation
            }
            guard didReceiveExplicitLatestIntent,
                  allowed,
                  isPinned.wrappedValue else { return }
            followIntent.resumeForExplicitLatest()
        }

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
                    guard let self, self.scrollView?.window?.inLiveResize != true else { return }
                    self.hasObservedUserScroll = true
                    self.reportLiveScrollChange(true)
                    self.reportUserScrollViewport()
                    self.updatePinFromUserScroll(userLiveScroll: true)
                    self.scheduleTopEdgeEvaluation()
                }
                endScrollObs = center.addObserver(
                    forName: NSScrollView.didEndLiveScrollNotification,
                    object: sv,
                    queue: .main
                ) { [weak self] _ in
                    guard let self, self.scrollView?.window?.inLiveResize != true else { return }
                    self.hasObservedUserScroll = true
                    self.reportLiveScrollChange(false)
                    self.reportUserScrollViewport()
                    self.updatePinFromUserScroll(userLiveScroll: true)
                    self.scheduleTopEdgeEvaluation()
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
                    // Exact-top evaluation is geometry-based and origin-agnostic:
                    // programmatic geometry changes must also re-arm the edge.
                    self.scheduleTopEdgeEvaluation()
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
                    self.hasObservedUserScroll = true
                    self.reportUserScrollViewport()
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
                        self?.scheduleTopEdgeEvaluation()
                    }
                    documentBoundsObs = center.addObserver(
                        forName: NSView.boundsDidChangeNotification,
                        object: document,
                        queue: .main
                    ) { [weak self] _ in
                        self?.schedulePinnedContentFollow()
                        self?.scheduleTopEdgeEvaluation()
                    }
                }
                // Attachment only seeds geometry. It must preserve the current pin
                // state; layout-time distances are not evidence of user intent.
                updatePinFromUserScroll(allowUnpin: false)
                // Seed the exact-top edge with the current geometry; later
                // frame/bounds notifications re-evaluate it continuously. The
                // trigger itself is gated on `hasObservedUserScroll`, so this
                // seed can never auto-load history.
                scheduleTopEdgeEvaluation()
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
            knobDragUpdateScheduled = false
            contentFollowScheduled = false
            topEdgeEvaluationScheduled = false
            hasObservedUserScroll = false
            isLiveScrollActive = false
            boundsUpdateGeneration += 1
        }

        private func schedulePinnedContentFollow() {
            guard !contentFollowScheduled, allowsAutomaticFollow() else { return }
            // Freeze follow while the scroller knob is held so streaming reflow
            // cannot steal the origin mid-drag. Capture both attachment and
            // user-intent generations; an unpin between frame notification and
            // this main-turn follow invalidates the pending clip mutation.
            contentFollowScheduled = true
            let boundsGeneration = boundsUpdateGeneration
            let followGeneration = followIntent.generation
            DispatchQueue.main.async { [weak self] in
                guard let self, self.boundsUpdateGeneration == boundsGeneration else { return }
                self.contentFollowScheduled = false
                guard self.followIntent.isCurrent(followGeneration),
                      self.allowsAutomaticFollow()
                else { return }
                self.followPinnedContentGrowth()
            }
        }

        /// One gate for all automatic content-follow paths. The parent ownership
        /// check blocks stream append / proxy recovery after user takeover; the
        /// local intent barrier closes the persistent-pin coalescing gap.
        private func allowsAutomaticFollow() -> Bool {
            guard automaticFollowAllowed else { return false }
            let inLiveResize = scrollView?.window?.inLiveResize == true
            return followIntent.allowsAutomaticFollow(isPinned: isPinned.wrappedValue)
                && StickToBottomLogic.allowsPinnedContentFollow(
                isPinned: isPinned.wrappedValue,
                mouseButtonsDown: Int(NSEvent.pressedMouseButtons),
                windowInLiveResize: inLiveResize
            )
        }

        /// Exact-top evaluation is coalesced to one entry per main-loop turn like
        /// the knob-drag path: geometry notifications are high frequency, and the
        /// page load it may trigger mutates SwiftUI state. Internal so `updateNSView`
        /// can force a re-evaluation when the loading gate flips.
        func scheduleTopEdgeEvaluation() {
            guard !topEdgeEvaluationScheduled else { return }
            topEdgeEvaluationScheduled = true
            let generation = boundsUpdateGeneration
            DispatchQueue.main.async { [weak self] in
                guard let self, self.boundsUpdateGeneration == generation else { return }
                self.topEdgeEvaluationScheduled = false
                self.evaluateTopEdge()
            }
        }

        /// Feeds current geometry into the exact visual-top edge state machine.
        /// For the inverted transcript (`documentStart` pin), history lives at
        /// `documentEnd`; for a classic transcript the opposite mapping applies.
        private func evaluateTopEdge() {
            guard let sv = scrollView, let doc = sv.documentView else { return }
            let visible = sv.documentVisibleRect
            let contentHeight = doc.bounds.height
            let distance: CGFloat
            switch pinEdge {
            case .documentStart:
                distance = StickToBottomLogic.distanceFromDocumentEnd(
                    visible: visible,
                    contentHeight: contentHeight,
                    documentIsFlipped: doc.isFlipped
                )
            case .documentEnd:
                distance = StickToBottomLogic.distanceFromDocumentStart(
                    visible: visible,
                    contentHeight: contentHeight,
                    documentIsFlipped: doc.isFlipped
                )
            }
            // A non-scrollable raw window must backfill without waiting for an
            // impossible user scroll. Once content can scroll, only a real user
            // gesture may enter the near-top prefetch band.
            let documentNeedsBackfill = contentHeight <= visible.height + 1
            if TranscriptHistoryPrefetchTrigger.step(
                state: &topEdgeState,
                distanceFromDocumentStart: distance,
                enabled: topLoadingEnabled && (hasObservedUserScroll || documentNeedsBackfill),
                threshold: historyPrefetchThreshold
            ) {
                _ = onReachedTop?()
            }
        }

        /// Report a real live-scroll lifecycle transition once. The callback is
        /// reference-only, but avoiding display-rate invocation also keeps any
        /// structured lifecycle diagnostics transition-scoped.
        private func reportLiveScrollChange(_ isLive: Bool) {
            guard isLiveScrollActive != isLive else { return }
            isLiveScrollActive = isLive
            onLiveScrollChanged?(isLive)
        }

        /// Snapshot the current AppKit clip on every scroll event positively
        /// attributed to a user. The transcript is visually flipped but its
        /// SwiftUI anchor cache is pre-flip layout space, so convert an
        /// unflipped AppKit document explicitly before emitting the callback.
        /// Programmatic clip changes never call this method.
        private func reportUserScrollViewport() {
            // The parent owns the durable `.user` state, but its next SwiftUI
            // update has not necessarily reached this coordinator yet. Close the
            // local writer gate synchronously so a document-frame callback in
            // this same event cannot write the clip back under the user.
            if automaticFollowAllowed {
                automaticFollowAllowed = false
            }
            guard let scrollView,
                  let document = scrollView.documentView
            else { return }
            let layoutVisibleRect = UserPromptCurrentAssociation.layoutVisibleRect(
                documentVisibleRect: scrollView.documentVisibleRect,
                documentBounds: document.bounds,
                documentIsFlipped: document.isFlipped
            )
            let viewport = UserPromptCurrentAssociation.Viewport(
                layoutVisibleRect: layoutVisibleRect
            )
            guard viewport.isUsable else { return }
            onUserScroll?(viewport)
        }

        private func followPinnedContentGrowth() {
            guard allowsAutomaticFollow(),
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
                // Knob drag may unpin when the user leaves the bottom, but must
                // not auto re-pin while the button is still held.
                self.updatePinFromUserScroll(userLiveScroll: true, allowRepin: false)
            }
        }

        private func updatePinFromUserScroll(
            allowUnpin: Bool = true,
            userLiveScroll: Bool = false,
            allowRepin: Bool = true
        ) {
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
                allowUnpin: allowUnpin,
                allowRepin: allowRepin
            )
            guard let desired else { return }
            // First upward gesture suppresses follow immediately; persistent pin
            // is coalesced onto a safe main turn, never written in didLiveScroll.
            if desired == false, userLiveScroll {
                followIntent.suppressImmediately()
                schedulePinWrite(false)
                return
            }
            if desired {
                // Only an actual user arrival at the latest edge may clear the
                // barrier. didEndLiveScroll / geometry callbacks never do.
                followIntent.resumeAfterUserRepin()
            }
            // Re-pin / other writes: bounce to next runloop (avoid layout feedback).
            schedulePinWrite(desired)
        }

        private func writePin(_ value: Bool) {
            followIntent.didWritePersistentPin(value)
            guard isPinned.wrappedValue != value else { return }
            // Avoid implicit animation / transition thrash on the jump-to-bottom control.
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                isPinned.wrappedValue = value
            }
            if value {
                // A geometry true can only originate in an attributed user scroll
                // (all programmatic geometry returns nil from desiredPin).
                onUserRepinnedLatest?()
            }
        }

        private func schedulePinWrite(_ value: Bool) {
            guard followIntent.enqueuePersistentPin(value) else { return }
            DispatchQueue.main.async { [weak self] in
                guard let self, let pending = self.followIntent.takePersistentPin() else { return }
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
