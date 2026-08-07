import SwiftUI
import AppKit

/// SwiftUI host for the experimental NSTableView transcript.
///
/// Mirrors `StreamingTranscriptRows` presentation planning (window, fold guards,
/// streaming leaf) but feeds a flat oldest→newest entry list into
/// `TableTranscriptRepresentable` instead of an inverted eager VStack.
struct TableTranscriptHost: View {
    @ObservedObject var session: ChatSession
    @ObservedObject var streaming: StreamingState
    @ObservedObject var agentStore: SubagentStore
    @Binding var collapsedUserTurnIDs: Set<String>
    let onOpenFinishedGroup: (AssistantBlockLayout.FinishedGroupPresentation) -> Void
    let onOpenRunningTool: (RunningToolDetailPresentation) -> Void

    @Environment(\.chatTypography) private var chatTypography

    @State private var transcriptOldestLoadedPage: Int?
    @State private var historyPageLoadState = TranscriptHistoryPager.State.idle
    @State private var historyLoadGeneration = 0

    var body: some View {
        let model = buildModel()
        ZStack(alignment: .bottomTrailing) {
            TableTranscriptRepresentable(
                entries: model.entries,
                messageSpacing: chatTypography.messageSpacing,
                isPinned: $session.pinTranscriptToBottom,
                topLoadingEnabled: model.historyLoadingEnabled,
                onApproachHistoryTop: { _ = requestOlderHistoryPage() },
                contentBuilder: { entry in
                    AnyView(rowView(for: entry, model: model))
                }
            )
            .animation(nil, value: session.id)

            if !session.pinTranscriptToBottom {
                Button {
                    session.transcriptPlanner.invalidate()
                    session.pinTranscriptToBottom = true
                    // Pin didSet on the NS view scrolls to bottom.
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

            TranscriptLoadingOverlayTable(session: session, streaming: streaming)
        }
        .onChange(of: session.pinTranscriptToBottom) { _, newValue in
            if newValue {
                transcriptOldestLoadedPage = nil
                historyLoadGeneration += 1
                historyPageLoadState = .idle
                session.transcriptPlanner.invalidate()
            }
        }
        .onChange(of: session.id) { _, _ in
            transcriptOldestLoadedPage = nil
            historyLoadGeneration += 1
            historyPageLoadState = .idle
            session.transcriptPlanner.invalidate()
        }
        .onChange(of: session.bridgeRoutingKey) { _, _ in
            transcriptOldestLoadedPage = nil
            historyLoadGeneration += 1
            historyPageLoadState = .idle
        }
    }

    // MARK: - Model

    private struct Model {
        var entries: [TableTranscriptEntry]
        var presentation: AssistantBlockLayout.TranscriptPresentation
        var runningGuardedGroupIDs: Set<String>
        var browsingHistory: Bool
        var historyLoadingEnabled: Bool
        var forcedVisibleSettledRowID: String?
    }

    private func buildModel() -> Model {
        let items = session.transcript
        let window = TranscriptRenderWindow.resolve(
            itemCount: items.count,
            oldestLoadedPage: transcriptOldestLoadedPage
        )
        let windowItems = Array(items[window.range])
        let browsingHistory = !session.pinTranscriptToBottom && transcriptOldestLoadedPage != nil
        let effectiveStartPage = transcriptOldestLoadedPage
            ?? TranscriptRenderWindow.latestStartPage(itemCount: items.count)
        let historyLoadingEnabled = effectiveStartPage > 0 && historyPageLoadState == .idle
        let presentation = session.transcriptPlanner.presentation(
            items: windowItems,
            toolRuns: streaming.toolRuns,
            visibleCount: windowItems.count,
            transcriptVersion: session.transcriptVersion,
            toolStructureVersion: streaming.toolStructureVersion
        )
        let runningSubagentToolCallIds = Set(
            agentStore.agents.lazy
                .filter { $0.state == .running }
                .compactMap { $0.toolCallId }
        )
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
        let historyPageIsLoading: Bool = {
            if case .loading = historyPageLoadState { return true }
            return false
        }()

        // Oldest → newest (natural chat order for the table).
        var entries: [TableTranscriptEntry] = []

        if historyPageIsLoading {
            entries.append(.historyLoading)
        }
        if window.range.lowerBound == 0, session.isInitializing {
            entries.append(.initializing)
        }

        for row in presentation.rows {
            switch row {
            case .leaf(let item):
                let groupID = presentation.userTurnGroups.groupIDForRowID[item.id]
                let isInternalSignal = groupID != nil
                    && !presentation.userAuthoredLeafIDs.contains(item.id)
                let isFoldedSignal = isInternalSignal
                    && isUserTurnCollapsed(groupID, guarded: runningGuardedGroupIDs)
                if !isFoldedSignal || item.id == forcedVisibleSettledRowID {
                    entries.append(.settledLeaf(item: item))
                }
            case .assistantRun(let id, let entryId, let segments):
                let groupID = presentation.userTurnGroups.groupIDForRowID[id]
                let isFolded = isUserTurnCollapsed(groupID, guarded: runningGuardedGroupIDs)
                let isGroupLastAssistant = groupID.flatMap {
                    presentation.userTurnGroups.lastAssistantRunIDForGroupID[$0]
                } == id
                if !isFolded || isGroupLastAssistant || id == forcedVisibleSettledRowID {
                    entries.append(
                        .settledAssistant(
                            id: id,
                            entryId: entryId,
                            segments: segments,
                            isLastAssistant: id == presentation.lastAssistantRunID,
                            collapsedOverride: isFolded
                        )
                    )
                }
            }
        }

        if !browsingHistory,
           let streamingItem = streaming.streamingItem,
           hasVisibleContent(streamingItem) {
            if let startedAt = session.turnWallClockStartedAt {
                entries.append(.turnElapsed(startedAt: startedAt))
            }
            entries.append(.streamingLeaf(item: streamingItem))
        } else if !browsingHistory && (session.isWorking || session.isCompacting || session.mediaBusy || session.visionCaptionInProgress) {
            let placeholder = WaitingPlaceholderChoice(
                mediaBusy: session.mediaBusy,
                mediaStatus: session.mediaStatus,
                isStopping: session.isStopping,
                isCompacting: session.isCompacting,
                isCaptioning: session.visionCaptionInProgress
            )
            entries.append(
                .waiting(
                    message: placeholder.message,
                    turnStartedAt: placeholder.usesCompactionTimer
                        ? session.compactionStartedAt
                        : session.turnWallClockStartedAt
                )
            )
        }

        if browsingHistory {
            entries.append(.returnLatestBanner)
        }

        if presentation.rows.isEmpty,
           streaming.streamingItem == nil,
           !session.isWorking,
           !session.isCompacting,
           !session.mediaBusy,
           !session.isInitializing {
            entries.append(.emptyPlaceholder)
        }

        return Model(
            entries: entries,
            presentation: presentation,
            runningGuardedGroupIDs: runningGuardedGroupIDs,
            browsingHistory: browsingHistory,
            historyLoadingEnabled: historyLoadingEnabled,
            forcedVisibleSettledRowID: forcedVisibleSettledRowID
        )
    }

    // MARK: - Row views

    @ViewBuilder
    private func rowView(for entry: TableTranscriptEntry, model: Model) -> some View {
        switch entry {
        case .returnLatestBanner:
            HStack {
                Spacer(minLength: 0)
                Button("返回最新消息") {
                    session.transcriptPlanner.invalidate()
                    session.pinTranscriptToBottom = true
                }
                .buttonStyle(.link)
            }
            .frame(maxWidth: .infinity)

        case .historyLoading:
            HStack(spacing: 6) {
                ProgressView().controlSize(.small)
                Text("正在加载更早消息…")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }
            .padding(.vertical, 4)

        case .initializing:
            HStack(spacing: 6) {
                ProgressView().controlSize(.small)
                Text("正在刷新…")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }
            .padding(.vertical, 2)

        case .emptyPlaceholder:
            HStack {
                Spacer(minLength: 0)
                Text("还没有消息")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                Spacer(minLength: 0)
            }
            .padding(.vertical, 12)

        case .waiting(let message, let turnStartedAt):
            WaitingPlaceholderView(message: message, turnStartedAt: turnStartedAt)

        case .turnElapsed(let startedAt):
            TurnElapsedText(startedAt: startedAt)

        case .streamingLeaf(let item):
            MessageRow(
                item: item,
                toolRuns: runs(for: item),
                subagents: subagents(for: item),
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
                            blocks: item.blocks,
                            groupFinished: !session.isStreaming
                        )
                    )
                },
                onBranch: {
                    guard let entryId = item.entryId else { return }
                    session.branchFromAssistant(runLastEntryId: entryId)
                }
            )
            .equatable()
            .frame(maxWidth: .infinity, alignment: .leading)

        case .settledLeaf(let item):
            let callIds = model.presentation.toolCallIDsForRowID[item.id] ?? []
            MessageRow(
                item: item,
                toolRuns: runs(forToolCallIds: callIds),
                subagents: subagents(forToolCallIds: callIds),
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
            .frame(maxWidth: .infinity, alignment: .leading)

        case .settledAssistant(let id, let entryId, let segments, let isLastAssistant, let collapsedOverride):
            let callIds = model.presentation.toolCallIDsForRowID[id] ?? []
            let groupID = model.presentation.userTurnGroups.groupIDForRowID[id]
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
                completionText: !model.browsingHistory && isLastAssistant
                    ? session.turnCompletionText : nil,
                onCopy: { session.copySegmentsText(segments) },
                onBranch: {
                    guard let entryId else { return }
                    session.branchFromAssistant(runLastEntryId: entryId)
                },
                onJump: {
                    // POC: jump-to-user-prompt not wired to table scroll yet.
                },
                collapsedOverride: collapsedOverride,
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
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: - Helpers (mirrors StreamingTranscriptRows)

    private func requestOlderHistoryPage() -> Bool {
        let items = session.transcript
        let startPage = transcriptOldestLoadedPage
            ?? TranscriptRenderWindow.latestStartPage(itemCount: items.count)
        var nextState = historyPageLoadState
        guard let newStart = TranscriptHistoryPager.begin(
            currentStartPage: startPage,
            state: &nextState
        ) else { return false }
        historyPageLoadState = nextState
        historyLoadGeneration += 1
        let generation = historyLoadGeneration
        let sessionKey = session.bridgeRoutingKey
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 60_000_000)
            guard generation == historyLoadGeneration,
                  session.bridgeRoutingKey == sessionKey,
                  historyPageLoadState == .loading(targetPage: newStart) else { return }
            transcriptOldestLoadedPage = newStart
            session.transcriptPlanner.invalidate()
            historyPageLoadState = TranscriptHistoryPager.complete(loadedPage: newStart)
        }
        return true
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

/// Loading veil — kept local so the host does not import private ChatDetail types.
private struct TranscriptLoadingOverlayTable: View {
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
