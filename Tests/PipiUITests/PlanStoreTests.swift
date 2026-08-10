import XCTest
@testable import PipiUI

final class PlanStoreTests: XCTestCase {
    private func tasks(_ state: PlanTaskState = .pending) -> [PlanTaskSnapshot] {
        [PlanTaskSnapshot(id: "task-1", title: "Implement", state: state)]
    }

    private func publish(_ store: PlanStore, id: String = "plan-1") -> PlanEventApplyOutcome {
        store.applyPublish(schemaVersion: 1, planId: id, title: "Ship", summary: nil, tasks: tasks())
    }

    func testPublishAwaitsApprovalAndRejectsRunningTasks() {
        let store = PlanStore()
        XCTAssertEqual(publish(store), .applied(revision: 1))
        XCTAssertEqual(store.plan?.lifecycle, .awaitingApproval)
        XCTAssertEqual(store.plan?.tasks.first?.state, .pending)
        XCTAssertEqual(
            store.applyPublish(schemaVersion: 1, planId: "bad", title: "Bad", summary: nil, tasks: tasks(.running)),
            .rejected(reason: "active plan in progress; finish it before publishing a new plan", currentRevision: 1)
        )

        let fresh = PlanStore()
        XCTAssertEqual(
            fresh.applyPublish(schemaVersion: 1, planId: "bad", title: "Bad", summary: nil, tasks: tasks(.running)),
            .rejected(reason: "published tasks must not be running before approval", currentRevision: nil)
        )
    }

    func testTaskUpdatesAreRejectedUntilApprovedThenApply() {
        let store = PlanStore()
        _ = publish(store)
        XCTAssertEqual(
            store.applyTaskUpdate(schemaVersion: 1, planId: "plan-1", taskId: "task-1", state: .running),
            .rejected(reason: "plan is awaiting approval", currentRevision: 1)
        )
        XCTAssertEqual(store.approve(planId: "plan-1"), .applied(revision: 2))
        XCTAssertEqual(store.plan?.lifecycle, .running)
        XCTAssertEqual(
            store.applyTaskUpdate(schemaVersion: 1, planId: "plan-1", taskId: "task-1", state: .running),
            .applied(revision: 3)
        )
    }

    func testApproveAndCancelCheckIdentityLifecycleAndRevision() {
        let store = PlanStore()
        _ = publish(store)
        XCTAssertEqual(store.approve(planId: "wrong"), .rejected(reason: "planId does not match published plan", currentRevision: 1))
        XCTAssertEqual(store.cancel(planId: "plan-1"), .applied(revision: 2))
        XCTAssertEqual(store.plan?.lifecycle, .cancelled)
        XCTAssertTrue(store.plan?.isTerminal == true)
        XCTAssertEqual(store.approve(planId: "plan-1"), .rejected(reason: "plan is cancelled", currentRevision: 2))
        XCTAssertEqual(store.cancel(planId: "plan-1"), .rejected(reason: "plan is cancelled", currentRevision: 2))
        XCTAssertEqual(
            store.applyTaskUpdate(schemaVersion: 1, planId: "plan-1", taskId: "task-1", state: .running),
            .rejected(reason: "plan is cancelled", currentRevision: 2)
        )
    }

    func testCancelledPlanIsReplaceableButIdCannotBeReused() {
        let store = PlanStore()
        _ = publish(store)
        _ = store.cancel(planId: "plan-1")
        XCTAssertEqual(publish(store, id: "plan-2"), .applied(revision: 3))
        XCTAssertEqual(store.plan?.id, "plan-2")
        XCTAssertEqual(store.plan?.lifecycle, .awaitingApproval)
        XCTAssertEqual(
            publish(store, id: "plan-1"),
            .rejected(reason: "plan.id was already used in this session", currentRevision: 3)
        )
    }

    func testLifecycleBridgeEventsRequirePlanIdentity() {
        let store = PlanStore()
        _ = publish(store)
        XCTAssertEqual(
            store.applyBridgeEvent(J(["event": "approve"])),
            .rejected(reason: "planId is required", currentRevision: 1)
        )
        XCTAssertEqual(
            store.applyBridgeEvent(J(["event": "approve", "planId": "plan-1"])),
            .applied(revision: 2)
        )
        XCTAssertEqual(
            store.applyBridgeEvent(J(["event": "cancel", "planId": "plan-1"])),
            .applied(revision: 3)
        )
    }

    func testLifecyclePersistsAndLegacySnapshotsDecodeRunning() throws {
        let sessionFile = "/tmp/pipiui-plan-lifecycle-\(UUID().uuidString).jsonl"
        let url = PlanStore.persistenceURL(forSessionFile: sessionFile)
        defer { try? FileManager.default.removeItem(at: url) }

        let writer = PlanStore()
        writer.attachPersistence(sessionFile: sessionFile)
        _ = publish(writer)
        writer.saveNow()
        let reader = PlanStore()
        reader.attachPersistence(sessionFile: sessionFile)
        XCTAssertEqual(reader.plan?.lifecycle, .awaitingApproval)

        let legacy = PlanSnapshot(schemaVersion: 1, revision: 9, id: "legacy", title: "Legacy", summary: nil, tasks: tasks(), updatedAt: nil)
        let legacyData = try JSONEncoder().encode(legacy)
        var object = try XCTUnwrap(try JSONSerialization.jsonObject(with: legacyData) as? [String: Any])
        object.removeValue(forKey: "lifecycle")
        let decoded = try JSONDecoder().decode(PlanSnapshot.self, from: JSONSerialization.data(withJSONObject: object))
        XCTAssertEqual(decoded.lifecycle, .running)
    }

    func testLifecycleChangesFlushPersistenceImmediately() throws {
        let sessionFile = "/tmp/pipiui-plan-lifecycle-flush-\(UUID().uuidString).jsonl"
        let url = PlanStore.persistenceURL(forSessionFile: sessionFile)
        defer { try? FileManager.default.removeItem(at: url) }
        let store = PlanStore()
        store.attachPersistence(sessionFile: sessionFile)
        _ = publish(store)
        let writes = store.persistenceWriteCount
        XCTAssertEqual(store.approve(planId: "plan-1"), .applied(revision: 2))
        XCTAssertGreaterThan(store.persistenceWriteCount, writes)
        let reread = PlanStore()
        reread.attachPersistence(sessionFile: sessionFile)
        XCTAssertEqual(reread.plan?.lifecycle, .running)
    }

    func testRestartRecoveryIsPersistedOneShotAndResumesOnlyMarkedTasks() throws {
        let sessionFile = "/tmp/pipiui-plan-recovery-\(UUID().uuidString).jsonl"
        let url = PlanStore.persistenceURL(forSessionFile: sessionFile)
        defer { try? FileManager.default.removeItem(at: url) }

        let writer = PlanStore()
        writer.attachPersistence(sessionFile: sessionFile)
        _ = publish(writer)
        _ = writer.approve(planId: "plan-1")
        _ = writer.applyTaskUpdate(
            schemaVersion: 1,
            planId: "plan-1",
            taskId: "task-1",
            state: .running
        )
        writer.saveNow()

        let reader = PlanStore()
        reader.attachPersistence(sessionFile: sessionFile)
        XCTAssertEqual(reader.plan?.lifecycle, .running)
        XCTAssertEqual(reader.plan?.tasks.first?.state, .blocked)
        XCTAssertEqual(reader.plan?.tasks.first?.detail, PlanSnapshot.interruptionExplanation)
        XCTAssertTrue(reader.hasPendingInterruptionRecovery(planId: "plan-1"))
        XCTAssertEqual(reader.interruptedTaskIDsForPendingRecovery(planId: "plan-1"), ["task-1"])
        XCTAssertEqual(
            reader.recoverInterruptedPlan(planId: "wrong"),
            .rejected(reason: "planId does not match published plan", currentRevision: 3)
        )

        let writes = reader.persistenceWriteCount
        XCTAssertEqual(reader.recoverInterruptedPlan(planId: "plan-1"), .applied(revision: 4))
        XCTAssertGreaterThan(reader.persistenceWriteCount, writes)
        XCTAssertEqual(reader.plan?.tasks.first?.state, .running)
        XCTAssertNil(reader.plan?.tasks.first?.detail)
        XCTAssertFalse(reader.hasPendingInterruptionRecovery)
        XCTAssertEqual(
            reader.resumeInterruptedPlan(planId: "plan-1"),
            .rejected(reason: "no pending interruption recovery", currentRevision: 4)
        )

        let consumed = try JSONDecoder().decode(PlanDiskState.self, from: Data(contentsOf: url))
        XCTAssertNil(consumed.pendingInterruptionRecovery)

        // A later abnormal exit sees the running task and arms a new one-shot recovery.
        let afterNewCrash = PlanStore()
        afterNewCrash.attachPersistence(sessionFile: sessionFile)
        XCTAssertTrue(afterNewCrash.hasPendingInterruptionRecovery(planId: "plan-1"))
        XCTAssertEqual(afterNewCrash.plan?.tasks.first?.state, .blocked)
    }

    func testGenuineBusinessBlockNeverBecomesPendingRestartRecovery() {
        let sessionFile = "/tmp/pipiui-plan-business-block-\(UUID().uuidString).jsonl"
        let url = PlanStore.persistenceURL(forSessionFile: sessionFile)
        defer { try? FileManager.default.removeItem(at: url) }

        let writer = PlanStore()
        writer.attachPersistence(sessionFile: sessionFile)
        _ = publish(writer)
        _ = writer.approve(planId: "plan-1")
        _ = writer.applyTaskUpdate(
            schemaVersion: 1,
            planId: "plan-1",
            taskId: "task-1",
            state: .blocked,
            detail: "Waiting for user decision",
            detailProvided: true
        )
        writer.saveNow()

        let reader = PlanStore()
        reader.attachPersistence(sessionFile: sessionFile)
        XCTAssertEqual(reader.plan?.tasks.first?.state, .blocked)
        XCTAssertEqual(reader.plan?.tasks.first?.detail, "Waiting for user decision")
        XCTAssertFalse(reader.hasPendingInterruptionRecovery)
        XCTAssertTrue(reader.interruptedTaskIDsForPendingRecovery(planId: "plan-1").isEmpty)
        XCTAssertEqual(
            reader.recoverInterruptedPlan(planId: "plan-1"),
            .rejected(reason: "no pending interruption recovery", currentRevision: 3)
        )
        XCTAssertEqual(reader.plan?.tasks.first?.state, .blocked)
    }
}
