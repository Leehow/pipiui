import Foundation
import Combine

/// Narrow, `Equatable` per-agent slice used **only** to decide whether the
/// transcript row subtree (`StreamingTranscriptRows`) must re-render after a
/// `SubagentStore` mutation.
///
/// The full `SubagentStore` publishes `objectWillChange` on every ~16ms
/// `log_delta` / `update` batch. `StreamingTranscriptRows` previously observed
/// the whole store, so every batch invalidated the entire settled-row group
/// (recomputing the planner window, fold guards, and every `MessageRow`
/// equality check). The transcript card only displays a small, mostly
/// lifecycle-driven subset of each agent's fields, so this slice captures
/// exactly that subset and ignores ordinary streaming telemetry.
///
/// Equality is **state-aware**: while an agent is `.running`, the displayed
/// card line is just its title/task, so cost/turns growth (the bulk of
/// `update`/`usage` telemetry) is excluded from the comparison and does not
/// re-render the group. The slice still *carries* cost/turns so that when the
/// agent transitions to a finished state (the moment those fields become
/// visible) the new slice reflects the final values.
///
/// This value is a change-detection key only. The actual rendered card data is
/// read fresh from `agentStore` whenever the body re-runs, so the displayed
/// numbers are always current as of the last projection refresh — they simply
/// do not refresh on a pure telemetry batch.
struct TranscriptSubagentSlice: Equatable, Sendable {
    let id: String
    let parentId: String?
    let toolCallId: String?
    let name: String
    let title: String?
    let task: String
    let depth: Int
    let state: SubagentInfo.State
    /// Resolves the document base for `[subagent-done]` user bubbles.
    let worktreePath: String?
    /// Displayed only on finished cards (`完成 · N turns · $cost`). Excluded
    /// from equality while `.running` so ordinary telemetry is a no-op.
    let turns: Int
    let cost: Double

    static func == (lhs: TranscriptSubagentSlice, rhs: TranscriptSubagentSlice) -> Bool {
        guard lhs.id == rhs.id,
              lhs.parentId == rhs.parentId,
              lhs.toolCallId == rhs.toolCallId,
              lhs.name == rhs.name,
              lhs.title == rhs.title,
              lhs.task == rhs.task,
              lhs.depth == rhs.depth,
              lhs.state == rhs.state,
              lhs.worktreePath == rhs.worktreePath
        else { return false }
        // cost/turns only affect finished-agent display. While running, the
        // card shows title/task only, so telemetry growth must not invalidate.
        // (lhs.state == rhs.state is already checked above.)
        if lhs.state == .running { return true }
        return lhs.turns == rhs.turns && lhs.cost == rhs.cost
    }

    /// Pure derivation from a full agent snapshot. Keeps only display-relevant
    /// fields; `output`, `activity`, `log`, token usage, stall flags, and
    /// closeout bookkeeping are intentionally dropped.
    static func from(_ agent: SubagentInfo) -> TranscriptSubagentSlice {
        TranscriptSubagentSlice(
            id: agent.id,
            parentId: agent.parentId,
            toolCallId: agent.toolCallId,
            name: agent.name,
            title: agent.title,
            task: agent.task,
            depth: agent.depth,
            state: agent.state,
            worktreePath: agent.worktreePath,
            turns: agent.turns,
            cost: agent.cost
        )
    }
}

/// Ordered snapshot of every agent's transcript-display slice. Two snapshots
/// are equal iff no displayed field of any agent changed (and the ordered
/// identity list is identical), so structural changes (start/end) and
/// display-relevant field changes are the only refresh triggers.
struct TranscriptSubagentPresentation: Equatable, Sendable {
    let slices: [TranscriptSubagentSlice]

    static let empty = TranscriptSubagentPresentation(slices: [])

    /// Running agents' tool-call ids — drives the user-turn fold guard without
    /// re-reading the full store on every render.
    var runningToolCallIDs: Set<String> {
        var ids: Set<String> = []
        for slice in slices where slice.state == .running {
            if let toolCallId = slice.toolCallId, !toolCallId.isEmpty {
                ids.insert(toolCallId)
            }
        }
        return ids
    }
}

/// Pure selector: derive the transcript-display presentation from a snapshot.
///
/// Deterministic and side-effect free so it can be unit-tested without timing,
/// SwiftUI, or Combine. Ordinary `log_delta`/`update`/`usage` events that only
/// grow running-agent telemetry leave the presentation equal; lifecycle
/// (start/end/state transition/toolCallId rebind) and display-field changes
/// (title/worktreePath/finished cost) are the only things that alter it.
enum TranscriptSubagentProjection {
    static func presentation(for agents: [SubagentInfo]) -> TranscriptSubagentPresentation {
        TranscriptSubagentPresentation(slices: agents.map(TranscriptSubagentSlice.from))
    }
}

/// `ObservableObject` host that re-publishes
/// [`presentation`](TranscriptSubagentPresentation) only when it actually
/// changes.
///
/// `StreamingTranscriptRows` owns one of these instead of observing the full
/// `SubagentStore`, so the settled-row group stays stable across ordinary
/// `log_delta` batches and refreshes promptly only on lifecycle /
/// display-relevant changes. The host subscribes to `store.objectWillChange`,
/// coalesces refreshes onto the next main runloop turn (after the batch flush
/// completed), then re-derives and writes `@Published` only when the derived
/// value differs from the last snapshot.
///
/// `refresh()` is `internal` so tests drive it deterministically right after a
/// store mutation — no `sleep`/expectation timing required.
@MainActor
final class TranscriptSubagentProjectionHost: ObservableObject {
    /// Narrow snapshot; changes only when a displayed field changes.
    @Published private(set) var presentation: TranscriptSubagentPresentation = .empty

    private weak var store: SubagentStore?
    private var cancellable: AnyCancellable?
    /// One coalesced refresh per main runloop turn regardless of how many store
    /// `objectWillChange` notifications arrive inside it.
    private var refreshScheduled = false

    init(presentation: TranscriptSubagentPresentation = .empty) {
        self.presentation = presentation
    }

    /// Bind (or rebind) to a store. Idempotent for the same store: re-derives
    /// once so late-bound hosts catch up, but never re-subscribes. Subscribing
    /// to a new store cancels the previous subscription.
    func bind(_ store: SubagentStore) {
        if self.store !== store {
            self.store = store
            cancellable?.cancel()
            cancellable = store.objectWillChange.sink { [weak self] _ in
                self?.scheduleRefresh()
            }
        }
        // Always re-derive synchronously on bind so the host reflects the
        // store's current state immediately, including the very first attach.
        refresh()
    }

    /// True when a store `objectWillChange` has scheduled a deferred refresh
    /// that has not run yet. Lets tests assert the Combine wiring is live
    /// without awaiting async.
    var hasScheduledRefresh: Bool { refreshScheduled }

    /// Re-derive `presentation` from the bound store and publish only on
    /// change. `internal` so tests drive it synchronously after a store
    /// mutation.
    func refresh() {
        guard let store else { return }
        let next = TranscriptSubagentProjection.presentation(for: store.agents)
        if next != presentation {
            presentation = next
        }
    }

    private func scheduleRefresh() {
        guard !refreshScheduled else { return }
        refreshScheduled = true
        DispatchQueue.main.async { [weak self] in
            self?.refreshScheduled = false
            self?.refresh()
        }
    }

    deinit {
        cancellable?.cancel()
    }
}
