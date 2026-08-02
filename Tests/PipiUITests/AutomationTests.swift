import XCTest
@testable import PipiUI

@MainActor
final class AutomationTests: XCTestCase {
    private final class SendableBox<T>: @unchecked Sendable {
        var value: T
        init(_ value: T) { self.value = value }
    }

    private func temporaryPersistence() -> AutomationPersistence {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipi-automation-tests-\(UUID().uuidString)", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return AutomationPersistence(fileURL: directory.appendingPathComponent("jobs.json"))
    }

    func testDailyRecurrenceUsesCalendarAcrossDST() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "America/New_York"))
        let beforeDST = try XCTUnwrap(calendar.date(from: DateComponents(
            year: 2026, month: 3, day: 7, hour: 10
        )))
        let next = try XCTUnwrap(AutomationSchedule.daily(hour: 9, minute: 30).nextDate(
            after: beforeDST,
            calendar: calendar
        ))
        let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: next)
        XCTAssertEqual(parts.year, 2026)
        XCTAssertEqual(parts.month, 3)
        XCTAssertEqual(parts.day, 8)
        XCTAssertEqual(parts.hour, 9)
        XCTAssertEqual(parts.minute, 30)
    }

    func testWeeklyAndMinimumIntervalRecurrence() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let monday = try XCTUnwrap(calendar.date(from: DateComponents(
            year: 2026, month: 8, day: 3, hour: 10
        )))
        let friday = try XCTUnwrap(AutomationSchedule.weekly(
            weekday: 6, hour: 8, minute: 15
        ).nextDate(after: monday, calendar: calendar))
        XCTAssertEqual(calendar.component(.weekday, from: friday), 6)
        XCTAssertEqual(calendar.component(.hour, from: friday), 8)
        XCTAssertEqual(
            AutomationSchedule.interval(1).nextDate(after: monday, calendar: calendar),
            monday.addingTimeInterval(AutomationSchedule.minimumInterval)
        )
    }

    func testPersistenceRoundTripAndRestrictivePermissions() throws {
        let persistence = temporaryPersistence()
        try FileManager.default.createDirectory(
            at: persistence.fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o777]
        )
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o777],
            ofItemAtPath: persistence.fileURL.deletingLastPathComponent().path
        )
        let job = AutomationJob(
            title: "日报",
            projectPath: "/tmp/project",
            prompt: "总结进展",
            schedule: .daily(hour: 9, minute: 0),
            skillName: "skill:summary"
        )
        try persistence.save([job])
        XCTAssertEqual(try persistence.load(), [job])
        let attributes = try FileManager.default.attributesOfItem(atPath: persistence.fileURL.path)
        XCTAssertEqual((attributes[.posixPermissions] as? NSNumber)?.intValue, 0o600)
        let directoryAttributes = try FileManager.default.attributesOfItem(
            atPath: persistence.fileURL.deletingLastPathComponent().path
        )
        XCTAssertEqual((directoryAttributes[.posixPermissions] as? NSNumber)?.intValue, 0o700)
    }

    func testDraftRequestDistinguishesMenuFromEmptyDraftAndIsOneShot() {
        var request: AutomationDraftRequest? = AutomationDraftRequestCoordinator.issue(
            prompt: "   ",
            id: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!
        )
        XCTAssertNotNil(request)
        XCTAssertEqual(request?.prompt, "")
        XCTAssertEqual(AutomationDraftRequestCoordinator.consume(&request)?.prompt, "")
        XCTAssertNil(request)

        let first = AutomationDraftRequestCoordinator.issue(prompt: "same")
        let second = AutomationDraftRequestCoordinator.issue(prompt: "same")
        XCTAssertNotEqual(first.id, second.id)
    }

    func testSelectionGuardOnlyChecksImmediateCreationMutation() {
        let before = RemoteDesktopSelectionState(projectPath: "/a", sessionKey: "one")
        XCTAssertTrue(AutomationSelectionGuard.remainedNeutral(
            before: before,
            immediatelyAfterCreation: before
        ))
        XCTAssertFalse(AutomationSelectionGuard.remainedNeutral(
            before: before,
            immediatelyAfterCreation: .init(projectPath: "/a", sessionKey: "two")
        ))
    }

    func testAutomationSessionNotificationModeSuppressesOnlyGenericNotifications() {
        XCTAssertTrue(SessionTaskNotificationMode.standard.allowsGenericNotifications)
        XCTAssertFalse(SessionTaskNotificationMode.schedulerOnly.allowsGenericNotifications)
    }

    func testPersistenceRejectsUnknownSchemaVersion() throws {
        let persistence = temporaryPersistence()
        try FileManager.default.createDirectory(
            at: persistence.fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try Data(#"{"version":99,"jobs":[]}"#.utf8).write(to: persistence.fileURL)
        XCTAssertThrowsError(try persistence.load()) { error in
            XCTAssertEqual(error as? AutomationPersistenceError, .unsupportedVersion(99))
        }
    }

    func testClaimIsPersistedBeforeExecutionAndRepeatedTickIsIdempotent() async throws {
        let persistence = temporaryPersistence()
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let calls = SendableBox(0)
        let started = expectation(description: "executor started")
        let scheduler = AutomationScheduler(
            persistence: persistence,
            clock: { now },
            executor: { _ in
                calls.value += 1
                started.fulfill()
                try? await Task.sleep(nanoseconds: 150_000_000)
                return .success("ok")
            }
        )
        let job = AutomationJob(
            title: "catch up",
            projectPath: "/tmp/project",
            prompt: "go",
            schedule: .interval(3600),
            nextRunAt: now.addingTimeInterval(-7200),
            createdAt: now.addingTimeInterval(-10_000)
        )
        scheduler.upsert(job)
        scheduler.tick()
        scheduler.tick()

        let persisted = try XCTUnwrap(try persistence.load().first)
        XCTAssertNotNil(persisted.claim, "claim must be durable before executor completion")
        await fulfillment(of: [started], timeout: 1)
        try? await Task.sleep(nanoseconds: 250_000_000)
        XCTAssertEqual(calls.value, 1)
        let finished = try XCTUnwrap(scheduler.jobs.first)
        XCTAssertNil(finished.claim)
        XCTAssertEqual(finished.lastOutcome?.status, .succeeded)
        XCTAssertEqual(finished.nextRunAt, now.addingTimeInterval(3600))
    }

    func testReloadConservativelyMarksClaimInterruptedWithoutRerun() throws {
        let persistence = temporaryPersistence()
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let runID = UUID()
        let job = AutomationJob(
            title: "stale",
            projectPath: "/tmp/project",
            prompt: "go",
            schedule: .daily(hour: 9, minute: 0),
            nextRunAt: now.addingTimeInterval(-60),
            claim: AutomationClaim(
                runID: runID,
                occurrenceID: "scheduled:old",
                scheduledAt: now.addingTimeInterval(-60),
                claimedAt: now.addingTimeInterval(-30),
                manual: false
            ),
            createdAt: now.addingTimeInterval(-100)
        )
        try persistence.save([job])
        let calls = SendableBox(0)
        let scheduler = AutomationScheduler(
            persistence: persistence,
            clock: { now },
            executor: { _ in
                calls.value += 1
                return .success("unexpected")
            }
        )
        let recovered = try XCTUnwrap(scheduler.jobs.first)
        XCTAssertNil(recovered.claim)
        XCTAssertEqual(recovered.lastOutcome?.runID, runID)
        XCTAssertEqual(recovered.lastOutcome?.status, .interrupted)
        XCTAssertGreaterThan(try XCTUnwrap(recovered.nextRunAt), now)
        XCTAssertEqual(calls.value, 0)
    }

    func testPauseRunNowAndDelete() async {
        let persistence = temporaryPersistence()
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let called = expectation(description: "manual run")
        let scheduler = AutomationScheduler(
            persistence: persistence,
            clock: { now },
            executor: { _ in called.fulfill(); return .success("manual") }
        )
        let job = AutomationJob(
            title: "manual",
            projectPath: "/tmp/project",
            prompt: "go",
            schedule: .daily(hour: 9, minute: 0),
            nextRunAt: now.addingTimeInterval(60),
            createdAt: now
        )
        scheduler.upsert(job)
        scheduler.setEnabled(false, id: job.id)
        XCTAssertFalse(scheduler.jobs[0].enabled)
        scheduler.runNow(id: job.id)
        await fulfillment(of: [called], timeout: 1)
        try? await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertFalse(scheduler.jobs[0].enabled)
        XCTAssertEqual(scheduler.jobs[0].nextRunAt, job.nextRunAt)
        scheduler.delete(id: job.id)
        XCTAssertTrue(scheduler.jobs.isEmpty)
    }
}
