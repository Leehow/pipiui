import Foundation
import Combine

/// Lightweight, `Equatable` presentation snapshot of the subagent tree.
///
/// The full `SubagentStore` publishes `objectWillChange` on every ~16ms `log_delta`
/// batch. The chat detail chrome, the sidebar session row, and the left navigation
/// rail only need to react to **lifecycle** changes (a subagent starting/stopping),
/// not to streaming log growth. This value captures exactly that discrete slice so
/// observers can compare and re-render only when it changes — never per batch.
///
/// Log content is never copied here: running agents are summarized to a count and a
/// set of tool-call ids. Live subagent logs are still rendered losslessly by the leaf
/// views that own a full `SubagentStore` subscription (`StreamingTranscriptRows`,
/// `SubagentPanel`).
struct SubagentChatPresentation: Equatable, Sendable {
    /// Number of agents currently in `.running` state.
    var runningCount: Int
    /// `toolCallId` of every running agent (drives transcript user-turn fold guard).
    var runningToolCallIDs: Set<String>

    static let empty = SubagentChatPresentation(runningCount: 0, runningToolCallIDs: [])
}

/// Pure selector: derive the narrow presentation from a snapshot of agents.
///
/// Deterministic and side-effect free so it can be unit-tested without timing,
/// SwiftUI, or Combine. The running set only changes on lifecycle (start/end) or a
/// `toolCallId` rebind — ordinary `log_delta`/`update`/`usage` events leave it equal.
enum SubagentChatProjection {
    static func presentation(for agents: [SubagentInfo]) -> SubagentChatPresentation {
        var runningToolCallIDs: Set<String> = []
        var runningCount = 0
        for agent in agents where agent.state == .running {
            runningCount += 1
            if let toolCallId = agent.toolCallId, !toolCallId.isEmpty {
                runningToolCallIDs.insert(toolCallId)
            }
        }
        return SubagentChatPresentation(
            runningCount: runningCount,
            runningToolCallIDs: runningToolCallIDs
        )
    }
}

/// `ObservableObject` host that re-publishes [`presentation`](SubagentChatPresentation)
/// only when it actually changes.
///
/// Binds to a `SubagentStore` and re-derives on each store `objectWillChange`. Because
/// `objectWillChange` fires *before* the store mutation, the refresh is coalesced onto
/// the next main runloop turn (after the batch flush completed), then `@Published` is
/// written only when the derived value differs from the last snapshot. Observers (the
/// detail chrome badge, the sidebar row) therefore stay stable across ordinary
/// `log_delta` batches and refresh promptly on lifecycle.
///
/// `refresh()` is `internal` so tests can drive the re-derive step deterministically
/// right after a store mutation — no `sleep`/expectation timing required.
@MainActor
final class SubagentChatProjectionHost: ObservableObject {
    /// Narrow snapshot; changes only when the running set changes.
    @Published private(set) var presentation: SubagentChatPresentation = .empty

    private weak var store: SubagentStore?
    private var cancellable: AnyCancellable?
    /// One coalesced refresh per main runloop turn regardless of how many store
    /// `objectWillChange` notifications arrive inside it.
    private var refreshScheduled = false

    init(presentation: SubagentChatPresentation = .empty) {
        self.presentation = presentation
    }

    /// Bind (or rebind) to a store. Idempotent for the same store: re-derives once so
    /// late-bound hosts catch up, but never re-subscribes. Subscribing to a new store
    /// cancels the previous subscription.
    func bind(_ store: SubagentStore) {
        if self.store !== store {
            self.store = store
            cancellable?.cancel()
            cancellable = store.objectWillChange.sink { [weak self] _ in
                self?.scheduleRefresh()
            }
        }
        // Always re-derive synchronously on bind so the host reflects the store's
        // current (final) state immediately, including the very first attach.
        refresh()
    }

    /// True when a store `objectWillChange` has scheduled a deferred refresh that has
    /// not run yet. Lets tests assert the Combine wiring is live without awaiting async.
    var hasScheduledRefresh: Bool { refreshScheduled }

    /// Re-derive `presentation` from the bound store and publish only on change.
    /// `internal` so tests drive it synchronously after a store mutation.
    func refresh() {
        guard let store else { return }
        let next = SubagentChatProjection.presentation(for: store.agents)
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
