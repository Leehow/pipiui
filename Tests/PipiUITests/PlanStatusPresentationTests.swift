import XCTest
@testable import PipiUI

final class PlanStatusPresentationTests: XCTestCase {

    // MARK: - Visibility

    func testNilPlanYieldsNoPresentation() throws {
        XCTAssertNil(PlanStatusPresentation.make(from: nil))
    }

    func testCancelledPlanHasNoPresentation() {
        let plan = PlanSnapshot(
            schemaVersion: 1,
            revision: 2,
            id: "cancelled",
            title: "Cancelled",
            summary: nil,
            tasks: [],
            lifecycle: .cancelled,
            updatedAt: nil
        )
        XCTAssertNil(PlanStatusPresentation.make(from: plan))
    }

    func testPublishedPlanIsVisibleWithTitleAndProgress() throws {
        let plan = PlanSnapshot(
            schemaVersion: 1,
            revision: 1,
            id: "p1",
            title: "Ship feature",
            summary: "end-to-end",
            tasks: [
                PlanTaskSnapshot(id: "t1", title: "Design", state: .completed),
                PlanTaskSnapshot(id: "t2", title: "Implement", state: .running, detail: "wiring UI"),
                PlanTaskSnapshot(id: "t3", title: "Verify", state: .pending),
            ],
            updatedAt: nil
        )
        let presentation = PlanStatusPresentation.make(from: plan)
        XCTAssertNotNil(presentation)
        guard let presentation else { return }
        XCTAssertEqual(presentation.title, "Ship feature")
        XCTAssertEqual(presentation.summary, "end-to-end")
        XCTAssertEqual(presentation.doneCount, 1)
        XCTAssertEqual(presentation.totalCount, 3)
        XCTAssertEqual(presentation.progressLabel, "1/3")
        XCTAssertEqual(presentation.progressFraction, 1.0 / 3.0, accuracy: 0.0001)
        XCTAssertEqual(presentation.aggregateState, .running)
        XCTAssertEqual(presentation.tasks.count, 3)
    }

    // MARK: - Current task (running / blocked only)

    func testCurrentTaskHighlightsRunning() throws {
        let plan = PlanSnapshot(
            schemaVersion: 1,
            revision: 2,
            id: "p1",
            title: "Work",
            summary: nil,
            tasks: [
                PlanTaskSnapshot(id: "t1", title: "Done", state: .completed),
                PlanTaskSnapshot(id: "t2", title: "Now", state: .running, detail: "step A"),
                PlanTaskSnapshot(id: "t3", title: "Later", state: .pending),
            ],
            updatedAt: nil
        )
        let presentation = try XCTUnwrap(PlanStatusPresentation.make(from: plan))
        XCTAssertEqual(presentation.currentTask?.id, "t2")
        XCTAssertEqual(presentation.currentTask?.title, "Now")
        XCTAssertEqual(presentation.currentTask?.state, .running)
        XCTAssertEqual(presentation.currentTask?.icon, .running)
        XCTAssertEqual(presentation.currentTask?.secondaryText, "step A")
        XCTAssertEqual(presentation.tasks.map(\.isCurrent), [false, true, false])
    }

    func testCurrentTaskHighlightsBlockedWhenNoRunning() throws {
        let plan = PlanSnapshot(
            schemaVersion: 1,
            revision: 3,
            id: "p1",
            title: "Work",
            summary: nil,
            tasks: [
                PlanTaskSnapshot(id: "t1", title: "Done", state: .completed),
                PlanTaskSnapshot(
                    id: "t2",
                    title: "Stuck",
                    state: .blocked,
                    detail: PlanSnapshot.interruptionExplanation
                ),
                PlanTaskSnapshot(id: "t3", title: "Later", state: .pending),
            ],
            updatedAt: nil
        )
        let presentation = try XCTUnwrap(PlanStatusPresentation.make(from: plan))
        XCTAssertEqual(presentation.currentTask?.id, "t2")
        XCTAssertEqual(presentation.currentTask?.state, .blocked)
        XCTAssertEqual(presentation.currentTask?.icon, .blocked)
        XCTAssertEqual(
            presentation.currentTask?.secondaryText,
            PlanSnapshot.interruptionExplanation
        )
    }

    func testPendingOnlyPlanHasNoCurrentTaskChip() throws {
        let plan = PlanSnapshot(
            schemaVersion: 1,
            revision: 1,
            id: "p1",
            title: "Queued",
            summary: nil,
            tasks: [
                PlanTaskSnapshot(id: "t1", title: "A", state: .pending),
                PlanTaskSnapshot(id: "t2", title: "B", state: .pending),
            ],
            updatedAt: nil
        )
        let presentation = try XCTUnwrap(PlanStatusPresentation.make(from: plan))
        XCTAssertNil(presentation.currentTask)
        XCTAssertTrue(presentation.tasks.allSatisfy { !$0.isCurrent })
        XCTAssertEqual(presentation.aggregateState, .pending)
    }

    func testRunningPreferredOverBlockedForCurrentTask() throws {
        let plan = PlanSnapshot(
            schemaVersion: 1,
            revision: 4,
            id: "p1",
            title: "Mixed",
            summary: nil,
            tasks: [
                PlanTaskSnapshot(id: "t1", title: "Blocked first", state: .blocked),
                PlanTaskSnapshot(id: "t2", title: "Running later", state: .running),
            ],
            updatedAt: nil
        )
        let presentation = try XCTUnwrap(PlanStatusPresentation.make(from: plan))
        XCTAssertEqual(presentation.currentTask?.id, "t2")
        XCTAssertEqual(presentation.tasks.map(\.isCurrent), [false, true])
    }

    // MARK: - Completed plans disappear

    func testCompletedPlanHasNoPresentation() throws {
        let plan = PlanSnapshot(
            schemaVersion: 1,
            revision: 9,
            id: "p1",
            title: "Finished",
            summary: "all good",
            tasks: [
                PlanTaskSnapshot(id: "t1", title: "A", state: .completed),
                PlanTaskSnapshot(id: "t2", title: "B", state: .skipped),
            ],
            updatedAt: nil
        )
        XCTAssertNil(PlanStatusPresentation.make(from: plan))
    }

    func testSkippedCountsAsDoneInProgressLabel() throws {
        let plan = PlanSnapshot(
            schemaVersion: 1,
            revision: 2,
            id: "p1",
            title: "Partial skip",
            summary: nil,
            tasks: [
                PlanTaskSnapshot(id: "t1", title: "A", state: .completed),
                PlanTaskSnapshot(id: "t2", title: "B", state: .skipped),
                PlanTaskSnapshot(id: "t3", title: "C", state: .running),
            ],
            updatedAt: nil
        )
        let presentation = try XCTUnwrap(PlanStatusPresentation.make(from: plan))
        XCTAssertEqual(presentation.progressLabel, "2/3")
        XCTAssertEqual(presentation.doneCount, 2)
    }

    // MARK: - Stable icons + secondary text

    func testTaskIconsAreStablePerState() throws {
        let states: [PlanTaskState] = [
            .pending, .running, .completed, .failed, .blocked, .skipped,
        ]
        let expected: [PlanTaskStatusIcon] = [
            .pending, .running, .completed, .failed, .blocked, .skipped,
        ]
        for (state, icon) in zip(states, expected) {
            XCTAssertEqual(PlanTaskStatusIcon.forState(state), icon, "state \(state)")
        }

        let plan = PlanSnapshot(
            schemaVersion: 1,
            revision: 1,
            id: "p1",
            title: "Icons",
            summary: nil,
            tasks: states.enumerated().map { index, state in
                PlanTaskSnapshot(id: "t\(index)", title: state.rawValue, state: state)
            },
            updatedAt: nil
        )
        let presentation = try XCTUnwrap(PlanStatusPresentation.make(from: plan))
        XCTAssertEqual(presentation.tasks.map(\.icon), expected)
        // SF Symbol raw values stay fixed for UI consistency.
        XCTAssertEqual(PlanTaskStatusIcon.pending.rawValue, "circle")
        XCTAssertEqual(PlanTaskStatusIcon.running.rawValue, "circle.dotted")
        XCTAssertEqual(PlanTaskStatusIcon.completed.rawValue, "checkmark.circle.fill")
        XCTAssertEqual(PlanTaskStatusIcon.failed.rawValue, "xmark.circle.fill")
        XCTAssertEqual(PlanTaskStatusIcon.blocked.rawValue, "exclamationmark.triangle.fill")
        XCTAssertEqual(PlanTaskStatusIcon.skipped.rawValue, "forward.circle")
    }

    func testSecondaryTextPrefersErrorOverDetail() throws {
        XCTAssertEqual(
            PlanStatusPresentation.secondaryText(detail: "detail", error: "boom"),
            "boom"
        )
        XCTAssertEqual(
            PlanStatusPresentation.secondaryText(detail: "detail", error: nil),
            "detail"
        )
        XCTAssertEqual(
            PlanStatusPresentation.secondaryText(detail: "  ", error: "  "),
            nil
        )
        XCTAssertNil(PlanStatusPresentation.secondaryText(detail: nil, error: nil))

        let plan = PlanSnapshot(
            schemaVersion: 1,
            revision: 1,
            id: "p1",
            title: "Err",
            summary: nil,
            tasks: [
                PlanTaskSnapshot(
                    id: "t1",
                    title: "Fail",
                    state: .failed,
                    detail: "was running",
                    error: "exit 1"
                ),
            ],
            updatedAt: nil
        )
        let presentation = try XCTUnwrap(PlanStatusPresentation.make(from: plan))
        XCTAssertEqual(presentation.tasks[0].secondaryText, "exit 1")
        // Failed-only plans have no running/blocked current chip.
        XCTAssertNil(presentation.currentTask)
        XCTAssertEqual(presentation.aggregateState, .failed)
    }

    func testTaskOrderMatchesSnapshotOrder() throws {
        let plan = PlanSnapshot(
            schemaVersion: 1,
            revision: 1,
            id: "p1",
            title: "Order",
            summary: nil,
            tasks: [
                PlanTaskSnapshot(id: "z", title: "Last id first", state: .pending),
                PlanTaskSnapshot(id: "a", title: "First id second", state: .pending),
                PlanTaskSnapshot(id: "m", title: "Middle", state: .pending),
            ],
            updatedAt: nil
        )
        let presentation = try XCTUnwrap(PlanStatusPresentation.make(from: plan))
        XCTAssertEqual(presentation.tasks.map(\.id), ["z", "a", "m"])
        XCTAssertEqual(presentation.tasks.map(\.title), [
            "Last id first", "First id second", "Middle",
        ])
    }

    // MARK: - Expanded list layout bounds (chat-column safety)

    func testExpandedTaskListMaxHeightIsFiniteAndIndependentOfTaskCount() throws {
        let maxH = PlanStatusLayout.expandedTaskListMaxHeight
        XCTAssertGreaterThan(maxH, 0)
        XCTAssertLessThan(
            maxH,
            320,
            "expanded list viewport must stay a compact card region, not a full column"
        )
        XCTAssertEqual(PlanStatusLayout.visibleTaskRowBudget, 7)
        // Viewport height must not grow with task count up through the plan cap.
        XCTAssertEqual(
            PlanStatusLayout.expandedTaskListViewportHeight(taskCount: 1),
            maxH
        )
        XCTAssertEqual(
            PlanStatusLayout.expandedTaskListViewportHeight(taskCount: PlanSnapshot.maxTasks),
            maxH
        )
        XCTAssertEqual(
            PlanStatusLayout.expandedTaskListViewportHeight(taskCount: 0),
            0
        )
        XCTAssertFalse(PlanStatusLayout.expandedTaskListRequiresScroll(taskCount: 1))
        XCTAssertFalse(
            PlanStatusLayout.expandedTaskListRequiresScroll(
                taskCount: PlanStatusLayout.visibleTaskRowBudget
            )
        )
        XCTAssertTrue(
            PlanStatusLayout.expandedTaskListRequiresScroll(
                taskCount: PlanStatusLayout.visibleTaskRowBudget + 1
            )
        )
        XCTAssertTrue(
            PlanStatusLayout.expandedTaskListRequiresScroll(taskCount: PlanSnapshot.maxTasks)
        )
    }

    func testMaxTaskPlanPresentationKeepsFullOrderedListUnderBoundedViewport() throws {
        let tasks = (1...PlanSnapshot.maxTasks).map { i in
            PlanTaskSnapshot(
                id: "t\(i)",
                title: "Task \(i)",
                state: i == 1 ? .running : .pending
            )
        }
        XCTAssertEqual(tasks.count, 100)
        let plan = PlanSnapshot(
            schemaVersion: 1,
            revision: 1,
            id: "big",
            title: "Large plan",
            summary: nil,
            tasks: tasks,
            updatedAt: nil
        )
        let presentation = try XCTUnwrap(PlanStatusPresentation.make(from: plan))
        // Presentation still carries every ordered task (scroll is a viewport, not a filter).
        XCTAssertEqual(presentation.tasks.count, PlanSnapshot.maxTasks)
        XCTAssertEqual(presentation.tasks.first?.id, "t1")
        XCTAssertEqual(presentation.tasks.last?.id, "t100")
        XCTAssertEqual(presentation.progressLabel, "0/100")
        XCTAssertEqual(presentation.currentTask?.id, "t1")
        // Layout policy: expanded list height is capped regardless of 100 rows.
        let viewport = PlanStatusLayout.expandedTaskListViewportHeight(
            taskCount: presentation.tasks.count
        )
        XCTAssertEqual(viewport, PlanStatusLayout.expandedTaskListMaxHeight)
        XCTAssertTrue(
            PlanStatusLayout.expandedTaskListRequiresScroll(taskCount: presentation.tasks.count)
        )
    }

    func testAwaitingApprovalActionControlsHaveStableContracts() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let source = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/Views/PlanStatusView.swift"),
            encoding: .utf8
        )
        XCTAssertTrue(source.contains("presentation.lifecycle == .awaitingApproval"))
        XCTAssertTrue(source.contains("PipiUI.PlanStatus.Execute"))
        XCTAssertTrue(source.contains("PipiUI.PlanStatus.Adjust"))
        XCTAssertTrue(source.contains("PipiUI.PlanStatus.Ignore"))
        XCTAssertTrue(source.contains("onExecute(planID)"))
        XCTAssertTrue(source.contains("onAdjust(planID)"))
        XCTAssertTrue(source.contains("onIgnore(planID)"))
        XCTAssertTrue(
            source.contains(".buttonStyle(.plain)\n            .pointingHandCursor()"),
            "the compact plan trigger must explicitly use the pointing-hand cursor"
        )
        XCTAssertTrue(
            source.contains("Button(\"执行\") { onExecute(planID) }\n                .pointingHandCursor()"),
            "Execute must explicitly use the pointing-hand cursor"
        )
        XCTAssertTrue(
            source.contains("Button(\"调整\") { onAdjust(planID) }\n                .pointingHandCursor()"),
            "Adjust must explicitly use the pointing-hand cursor"
        )
        XCTAssertTrue(
            source.contains("Button(\"忽略\", role: .destructive) { onIgnore(planID) }\n                .pointingHandCursor()"),
            "Ignore must explicitly use the pointing-hand cursor"
        )
    }

    func testPlanStatusViewSourceBoundsExpandedListWithScrollView() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let viewSourceURL = root
            .appendingPathComponent("Sources/PipiUI/Views/PlanStatusView.swift")
        let source = try String(contentsOf: viewSourceURL, encoding: .utf8)
        XCTAssertTrue(source.contains("expandedTaskListMaxHeight"))
        XCTAssertTrue(source.contains("ScrollView"))
        XCTAssertTrue(
            source.contains(".frame(maxHeight: maxHeight, alignment: .top)"),
            "expanded task list must apply a top-aligned maxHeight frame"
        )
        XCTAssertTrue(source.contains("private var taskList"))
        // Header / current task are composed before the bounded scroll body.
        let headerUse = try XCTUnwrap(source.range(of: "header")?.lowerBound)
        let currentUse = try XCTUnwrap(source.range(of: "currentTaskRow(current)")?.lowerBound)
        let taskListUse = try XCTUnwrap(source.range(of: "taskList")?.lowerBound)
        let listIdx = try XCTUnwrap(source.range(of: "private var taskList")?.lowerBound)
        XCTAssertLessThan(headerUse, currentUse)
        XCTAssertLessThan(currentUse, taskListUse)
        let scrollInList = source.range(of: "ScrollView", range: listIdx..<source.endIndex)
        XCTAssertNotNil(scrollInList)
    }

    // MARK: - Main-interface wiring (source contract)

    func testChatDetailViewPlacesPlanNextToPanelQuickRailNotAboveTranscript() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // PlanStatusPresentationTests.swift
            .deletingLastPathComponent() // PipiUITests
            .deletingLastPathComponent() // Tests
        let chatDetail = root
            .appendingPathComponent("Sources/PipiUI/Views/ChatDetailView.swift")
        let source = try String(contentsOf: chatDetail, encoding: .utf8)

        let columnStart = try XCTUnwrap(source.range(of: "private var chatColumn: some View")?.lowerBound)
        let columnEnd = try XCTUnwrap(source.range(of: "private var userPromptNavigationRailHost")?.lowerBound)
        let columnBody = String(source[columnStart..<columnEnd])
        XCTAssertFalse(
            columnBody.contains("PlanStatusView("),
            "plan chrome must not occupy space above the transcript"
        )

        let overlayStart = try XCTUnwrap(source.range(of: "private func panelQuickRailOverlay")?.lowerBound)
        let overlayEnd = try XCTUnwrap(source.range(of: "private var panelQuickRail")?.lowerBound)
        let overlayBody = String(source[overlayStart..<overlayEnd])
        XCTAssertTrue(overlayBody.contains("HStack(alignment: .top, spacing: 4)"))
        let plan = try XCTUnwrap(overlayBody.range(of: "PlanStatusView(")?.lowerBound)
        let rail = try XCTUnwrap(
            overlayBody.range(of: "panelQuickRail", range: plan..<overlayBody.endIndex)?.lowerBound
        )
        XCTAssertLessThan(plan, rail, "plan control must sit immediately left of the rail")
    }

    // MARK: - Store → presentation integration seam

    func testPresentationTracksPlanStorePublishAndUpdate() throws {
        let store = PlanStore()
        XCTAssertNil(PlanStatusPresentation.make(from: store.plan))

        let published = store.applyPublish(
            schemaVersion: 1,
            planId: "plan-ui",
            title: "UI plan",
            summary: nil,
            tasks: [
                PlanTaskSnapshot(id: "t1", title: "One", state: .pending),
                PlanTaskSnapshot(id: "t2", title: "Two", state: .pending),
            ]
        )
        XCTAssertEqual(published, .applied(revision: 1))
        var presentation = try XCTUnwrap(PlanStatusPresentation.make(from: store.plan))
        XCTAssertEqual(presentation.lifecycle, .awaitingApproval)
        XCTAssertEqual(store.approve(planId: "plan-ui"), .applied(revision: 2))
        XCTAssertEqual(presentation.title, "UI plan")
        XCTAssertEqual(presentation.progressLabel, "0/2")
        XCTAssertNil(presentation.currentTask)

        let updated = store.applyTaskUpdate(
            schemaVersion: 1,
            planId: "plan-ui",
            taskId: "t1",
            state: .running,
            detail: "go",
            detailProvided: true
        )
        XCTAssertEqual(updated, .applied(revision: 3))
        presentation = try XCTUnwrap(PlanStatusPresentation.make(from: store.plan))
        XCTAssertEqual(presentation.currentTask?.id, "t1")
        XCTAssertEqual(presentation.currentTask?.secondaryText, "go")
        XCTAssertEqual(presentation.progressLabel, "0/2")

        _ = store.applyTaskUpdate(
            schemaVersion: 1,
            planId: "plan-ui",
            taskId: "t1",
            state: .completed
        )
        _ = store.applyTaskUpdate(
            schemaVersion: 1,
            planId: "plan-ui",
            taskId: "t2",
            state: .completed
        )
        XCTAssertNil(PlanStatusPresentation.make(from: store.plan))
    }

    func testRestartRecoveryPresentationIsDistinctFromGenuineBusinessBlock() throws {
        let restartBlocked = PlanSnapshot(
            schemaVersion: 1,
            revision: 3,
            id: "restart",
            title: "Restarted work",
            summary: nil,
            tasks: [PlanTaskSnapshot(
                id: "t1",
                title: "Resume me",
                state: .blocked,
                detail: PlanSnapshot.interruptionExplanation
            )],
            lifecycle: .running,
            updatedAt: nil
        )
        let restartPresentation = try XCTUnwrap(
            PlanStatusPresentation.make(
                from: restartBlocked,
                hasPendingInterruptionRecovery: true
            )
        )
        XCTAssertTrue(restartPresentation.hasPendingInterruptionRecovery)
        XCTAssertEqual(restartPresentation.lifecycle, .running)

        let businessPresentation = try XCTUnwrap(
            PlanStatusPresentation.make(
                from: restartBlocked,
                hasPendingInterruptionRecovery: false
            )
        )
        XCTAssertFalse(businessPresentation.hasPendingInterruptionRecovery)

        var genuineBusinessBlock = restartBlocked
        genuineBusinessBlock.tasks[0].detail = "Waiting for a user decision"
        let defensivePresentation = try XCTUnwrap(
            PlanStatusPresentation.make(
                from: genuineBusinessBlock,
                hasPendingInterruptionRecovery: true
            )
        )
        XCTAssertFalse(defensivePresentation.hasPendingInterruptionRecovery)
    }

    func testRestartRecoveryPopoverUsesContinueAndIgnoreOnlyWithStableCursorAndIDs() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let view = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/Views/PlanStatusView.swift"),
            encoding: .utf8
        )
        let detail = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/Views/ChatDetailView.swift"),
            encoding: .utf8
        )
        XCTAssertTrue(view.contains("presentation.hasPendingInterruptionRecovery"))
        XCTAssertTrue(view.contains("interruptionRecoveryActions"))
        XCTAssertTrue(view.contains("Button(\"继续计划\") { onContinue(planID) }\n                .pointingHandCursor()"))
        XCTAssertTrue(view.contains("PipiUI.PlanStatus.Continue"))
        XCTAssertTrue(view.contains("PipiUI.PlanStatus.Ignore"))
        XCTAssertTrue(view.contains("} else if presentation.lifecycle == .awaitingApproval {"))
        XCTAssertTrue(detail.contains("onContinue: { session.continueInterruptedPlan(planId: $0) }"))
    }
}
