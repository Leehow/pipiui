import SwiftUI

// MARK: - Pure presentation (unit-testable without UI automation)

/// Stable SF Symbol names for plan task rows. Kept as strings so tests can
/// assert icon identity without mounting SwiftUI.
enum PlanTaskStatusIcon: String, Equatable, Sendable {
    case pending = "circle"
    case running = "circle.dotted"
    case completed = "checkmark.circle.fill"
    case failed = "xmark.circle.fill"
    case blocked = "exclamationmark.triangle.fill"
    case skipped = "forward.circle"

    static func forState(_ state: PlanTaskState) -> PlanTaskStatusIcon {
        switch state {
        case .pending: return .pending
        case .running: return .running
        case .completed: return .completed
        case .failed: return .failed
        case .blocked: return .blocked
        case .skipped: return .skipped
        }
    }
}

/// One ordered row in the plan popover task list.
struct PlanStatusTaskRowPresentation: Equatable, Identifiable, Sendable {
    var id: String
    var title: String
    var state: PlanTaskState
    var icon: PlanTaskStatusIcon
    /// Single concise secondary line: prefer `error`, else `detail`.
    var secondaryText: String?
    var isCurrent: Bool
}

/// Headline chip for the active running/blocked task (nil when none of those).
struct PlanStatusCurrentTaskPresentation: Equatable, Sendable {
    var id: String
    var title: String
    var state: PlanTaskState
    var icon: PlanTaskStatusIcon
    var secondaryText: String?
}

/// Pure derivation from `PlanSnapshot` → compact plan chrome.
struct PlanStatusPresentation: Equatable, Sendable {
    var planID: String
    var title: String
    var summary: String?
    var aggregateState: PlanAggregateState
    var lifecycle: PlanLifecycle
    /// True only for app-restart-marked blocked work with one pending resync.
    var hasPendingInterruptionRecovery: Bool
    var doneCount: Int
    var totalCount: Int
    var progressFraction: Double
    var progressLabel: String
    var currentTask: PlanStatusCurrentTaskPresentation?
    var tasks: [PlanStatusTaskRowPresentation]

    /// `nil` means there is no active, failed, or blocked plan chrome to show.
    /// A completed aggregate disappears instead of leaving a subdued completed card.
    static func make(
        from plan: PlanSnapshot?,
        hasPendingInterruptionRecovery: Bool = false
    ) -> PlanStatusPresentation? {
        guard let plan,
              plan.lifecycle != .cancelled,
              plan.aggregateState != .completed else { return nil }
        let progress = plan.progress
        let aggregate = plan.aggregateState
        // Defense in depth for direct presentation callers: a caller-provided
        // flag cannot surface Continue unless an exact restart marker remains.
        let recoveryPending = hasPendingInterruptionRecovery
            && plan.lifecycle == .running
            && plan.tasks.contains {
                $0.state == .blocked
                    && $0.detail == PlanSnapshot.interruptionExplanation
            }
        let currentSnapshot = plan.currentTask
        let currentID: String? = {
            guard let currentSnapshot else { return nil }
            switch currentSnapshot.state {
            case .running, .blocked: return currentSnapshot.id
            case .pending, .completed, .failed, .skipped: return nil
            }
        }()

        let rows: [PlanStatusTaskRowPresentation] = plan.tasks.map { task in
            PlanStatusTaskRowPresentation(
                id: task.id,
                title: task.title,
                state: task.state,
                icon: .forState(task.state),
                secondaryText: Self.secondaryText(detail: task.detail, error: task.error),
                isCurrent: currentID == task.id
            )
        }

        let currentPresentation: PlanStatusCurrentTaskPresentation? = {
            guard let currentID,
                  let task = plan.tasks.first(where: { $0.id == currentID })
            else { return nil }
            return PlanStatusCurrentTaskPresentation(
                id: task.id,
                title: task.title,
                state: task.state,
                icon: .forState(task.state),
                secondaryText: Self.secondaryText(detail: task.detail, error: task.error)
            )
        }()

        return PlanStatusPresentation(
            planID: plan.id,
            title: plan.title,
            summary: plan.summary,
            aggregateState: aggregate,
            lifecycle: plan.lifecycle,
            hasPendingInterruptionRecovery: recoveryPending,
            doneCount: progress.doneCount,
            totalCount: progress.totalCount,
            progressFraction: progress.fraction,
            progressLabel: "\(progress.doneCount)/\(progress.totalCount)",
            currentTask: currentPresentation,
            tasks: rows
        )
    }

    /// Prefer error over detail; empty/whitespace → nil.
    static func secondaryText(detail: String?, error: String?) -> String? {
        let err = error?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let err, !err.isEmpty { return err }
        let det = detail?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let det, !det.isEmpty { return det }
        return nil
    }
}

// MARK: - Layout (unit-testable; popover remains bounded)

enum PlanStatusLayout: Sendable {
    static let taskRowSpacing: CGFloat = 6
    static let approximateTaskRowHeight: CGFloat = 22
    static let visibleTaskRowBudget: Int = 7
    static let expandedTaskListMaxHeight: CGFloat =
        CGFloat(visibleTaskRowBudget) * approximateTaskRowHeight
        + CGFloat(max(0, visibleTaskRowBudget - 1)) * taskRowSpacing

    static func expandedTaskListViewportHeight(taskCount: Int) -> CGFloat {
        guard taskCount > 0 else { return 0 }
        return expandedTaskListMaxHeight
    }

    static func expandedTaskListRequiresScroll(taskCount: Int) -> Bool {
        taskCount > visibleTaskRowBudget
    }
}

// MARK: - View

/// Compact 28pt plan control displayed beside the panel quick rail. Its details
/// live in a popover so plan updates never consume transcript layout space.
struct PlanStatusView: View {
    @ObservedObject var store: PlanStore
    @ObservedObject var session: ChatSession
    let onExecute: (String) -> ChatSession.PlanActionOutcome
    let onAdjust: (String) -> ChatSession.PlanActionOutcome
    let onContinue: (String) -> ChatSession.PlanActionOutcome
    let onIgnore: (String) -> PlanEventApplyOutcome
    @State private var isPopoverPresented = false

    var body: some View {
        if let presentation = PlanStatusPresentation.make(
            from: store.plan,
            hasPendingInterruptionRecovery: store.hasPendingInterruptionRecovery
        ) {
            Button {
                isPopoverPresented.toggle()
            } label: {
                controlLabel(presentation)
            }
            .buttonStyle(.plain)
            .pointingHandCursor()
            .help("计划进度 \(presentation.progressLabel)")
            .popover(isPresented: $isPopoverPresented, arrowEdge: .trailing) {
                PlanStatusPopover(
                    presentation: presentation,
                    onExecute: { planID in
                        let outcome = onExecute(planID)
                        if let error = outcome.errorMessage { session.flash(error) }
                        if outcome.errorMessage == nil { isPopoverPresented = false }
                    },
                    onAdjust: { planID in
                        let outcome = onAdjust(planID)
                        if let error = outcome.errorMessage { session.flash(error) }
                        if outcome.errorMessage == nil { isPopoverPresented = false }
                    },
                    onContinue: { planID in
                        let outcome = onContinue(planID)
                        if let error = outcome.errorMessage { session.flash(error) }
                        if outcome.errorMessage == nil { isPopoverPresented = false }
                    },
                    onIgnore: { planID in
                        let outcome = onIgnore(planID)
                        if case .rejected(let reason, _) = outcome { session.flash(reason) }
                        if outcome.isApplied { isPopoverPresented = false }
                    }
                )
            }
            .accessibilityIdentifier("PipiUI.PlanStatus")
        }
    }

    private func controlLabel(_ presentation: PlanStatusPresentation) -> some View {
        ZStack {
            Image(systemName: aggregateIcon(presentation.aggregateState))
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(aggregateTint(presentation.aggregateState))
            if presentation.aggregateState == .running {
                Circle()
                    .trim(from: 0, to: max(0.06, presentation.progressFraction))
                    .stroke(Color.accentColor, style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .frame(width: 22, height: 22)
            }
        }
        .frame(width: 28, height: 28)
        .background(
            Color(nsColor: .windowBackgroundColor).opacity(0.94),
            in: RoundedRectangle(cornerRadius: 6, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .accessibilityLabel("计划，进度 \(presentation.progressLabel)")
    }
}

private struct PlanStatusPopover: View {
    let presentation: PlanStatusPresentation
    let onExecute: (String) -> Void
    let onAdjust: (String) -> Void
    let onContinue: (String) -> Void
    let onIgnore: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            ProgressView(value: presentation.progressFraction, total: 1)
                .progressViewStyle(.linear)
                .tint(progressTint)
            if presentation.hasPendingInterruptionRecovery {
                interruptionRecoveryActions
            } else if presentation.lifecycle == .awaitingApproval {
                approvalActions
            }
            if let current = presentation.currentTask {
                currentTaskRow(current)
            }
            if !presentation.tasks.isEmpty {
                Divider()
                taskList
            }
        }
        .padding(12)
        .frame(width: 280, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("PipiUI.PlanStatus.Popover")
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: aggregateIcon(presentation.aggregateState))
                .foregroundStyle(aggregateTint(presentation.aggregateState))
                .frame(width: 16)
            VStack(alignment: .leading, spacing: 2) {
                Text(presentation.title)
                    .font(.callout.weight(.semibold))
                    .lineLimit(2)
                if let summary = presentation.summary, !summary.isEmpty {
                    Text(summary)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 8)
            Text(presentation.progressLabel)
                .font(.caption.monospacedDigit().weight(.medium))
                .accessibilityLabel("进度 \(presentation.progressLabel)")
        }
    }

    private var approvalActions: some View {
        HStack(spacing: 8) {
            Button("执行") { onExecute(planID) }
                .pointingHandCursor()
                .accessibilityIdentifier("PipiUI.PlanStatus.Execute")
            Button("调整") { onAdjust(planID) }
                .pointingHandCursor()
                .accessibilityIdentifier("PipiUI.PlanStatus.Adjust")
            Button("忽略", role: .destructive) { onIgnore(planID) }
                .pointingHandCursor()
                .accessibilityIdentifier("PipiUI.PlanStatus.Ignore")
        }
        .font(.caption.weight(.medium))
    }

    private var interruptionRecoveryActions: some View {
        HStack(spacing: 8) {
            Button("继续计划") { onContinue(planID) }
                .pointingHandCursor()
                .accessibilityIdentifier("PipiUI.PlanStatus.Continue")
            Button("忽略", role: .destructive) { onIgnore(planID) }
                .pointingHandCursor()
                .accessibilityIdentifier("PipiUI.PlanStatus.Ignore")
        }
        .font(.caption.weight(.medium))
    }

    private var planID: String { presentation.planID }

    private var taskList: some View {
        let maxHeight = PlanStatusLayout.expandedTaskListViewportHeight(
            taskCount: presentation.tasks.count
        )
        return ScrollView {
            LazyVStack(alignment: .leading, spacing: PlanStatusLayout.taskRowSpacing) {
                ForEach(presentation.tasks) { row in
                    taskRow(row)
                }
            }
            .padding(.trailing, 2)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxHeight: maxHeight, alignment: .top)
        .accessibilityIdentifier("PipiUI.PlanStatus.TaskList")
    }

    private func currentTaskRow(_ current: PlanStatusCurrentTaskPresentation) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: current.icon.rawValue)
                .foregroundStyle(taskTint(current.state))
                .frame(width: 14)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 2) {
                Text(current.state == .blocked ? "受阻" : "进行中")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(taskTint(current.state))
                Text(current.title)
                    .font(.caption.weight(.medium))
                    .lineLimit(2)
                if let secondary = current.secondaryText {
                    Text(secondary)
                        .font(.caption2)
                        .foregroundStyle(current.state == .blocked ? Color.orange : Color.secondary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(taskTint(current.state).opacity(0.08))
        )
    }

    private func taskRow(_ row: PlanStatusTaskRowPresentation) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: row.icon.rawValue)
                .foregroundStyle(taskTint(row.state))
                .frame(width: 14)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.title)
                    .font(.caption.weight(row.isCurrent ? .semibold : .regular))
                    .foregroundStyle(row.state == .pending ? .secondary : .primary)
                    .lineLimit(2)
                if let secondary = row.secondaryText {
                    Text(secondary)
                        .font(.caption2)
                        .foregroundStyle(
                            row.state == .failed
                                ? Color.red.opacity(0.9)
                                : (row.state == .blocked ? Color.orange : Color.secondary)
                        )
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 0)
        }
        .opacity(row.state == .skipped ? 0.7 : 1)
        .accessibilityLabel("\(row.title), \(row.state.rawValue)")
    }

    private var progressTint: Color {
        switch presentation.aggregateState {
        case .blocked: return .orange
        case .failed: return .red
        case .running, .pending, .none, .completed: return .accentColor
        }
    }
}

private func aggregateIcon(_ state: PlanAggregateState) -> String {
    switch state {
    case .none, .pending, .running: return "list.bullet.rectangle"
    case .completed: return "checkmark.circle.fill"
    case .failed: return "xmark.circle.fill"
    case .blocked: return "exclamationmark.triangle.fill"
    }
}

private func aggregateTint(_ state: PlanAggregateState) -> Color {
    switch state {
    case .none, .pending: return .secondary
    case .running: return .accentColor
    case .completed: return .green
    case .failed: return .red
    case .blocked: return .orange
    }
}

private func taskTint(_ state: PlanTaskState) -> Color {
    switch state {
    case .pending: return .secondary
    case .running: return .accentColor
    case .completed: return .green
    case .failed: return .red
    case .blocked: return .orange
    case .skipped: return .secondary
    }
}
